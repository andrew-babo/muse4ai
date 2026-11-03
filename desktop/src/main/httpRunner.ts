import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { CHAT_OUTPUT_FILE_MAX_BYTES, leafName, limitOutputs, outputExt, samePrompt, truncateUtf8 } from "../shared/chat";
import type { SendItem } from "../shared/gateway/bridge";
import { sessionSaysDone, turnLooksDone, TERMINAL_STATUS, type GwEvent, type GwFile, type GwHistory, type GwTurn } from "../shared/gateway/events";
import type { HttpReason } from "../shared/execution";
import { ERROR_LABEL } from "../shared/jobMachine";
import type { Asset, ErrorClass, JobState } from "../shared/types";
import { AdapterError, sleep, throwIfAborted, AbortedError } from "./adapter/types";
import { ChannelError, type HttpChannel } from "./adapter/muse/httpChannel";
import { INLINE_DOC_MAX_BYTES, UploadError } from "../shared/gateway/upload";
import { classifyGatewaySignal } from "./adapter/muse/httpProtocol";
import { buildMessage, classifyMuseReply } from "./adapter/muse/selectors";
import { buildMuseExtendMessage, museSandboxLocator, MUSE_EXTEND_TIMEOUT_MS } from "../shared/museExtend";
import type { ExecutionManager } from "./execution";
import { InvalidMediaError, type MediaStore } from "./media";
import type { JobRow, Repo } from "./repo";

// Build 2.0 R93–R95 — one job on the direct channel: intent before send, ack, reconcile, tracking, outputs. The
// coordinator owns scheduling and account state; this runner only moves its own job through the job machine.

/** Prefix of the main-only conversation key of an HTTP chat (the Muse session id follows). */
export const GW_CONV_PREFIX = "gw:";

/** Owner mark of a Muse source made on the channel (repo ASSET_SELECT treats it as the owner account's own). */
export const httpSourceFp = (accountId: string) => `${GW_CONV_PREFIX}${accountId}`;

export interface RunnerOps {
  repo: Repo;
  exec: ExecutionManager;
  media(): MediaStore;
  now(): number;
  setJob(job: JobRow | string, state: JobState, patch?: Partial<JobRow>): JobRow;
  emitJob(job: JobRow | null): void;
  emitAsset(asset: Asset): void;
  log(level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>): void;
  /** Muse signal or proxy problem: account side effects + the job outcome, as for the UI path (R7, R90). */
  fail(jobId: string, accountId: string, err: unknown, afterSend: boolean, attemptId: string): void;
  diskPaused(): boolean;
  refreshDisk(): Promise<void>;
  accountAlias(accountId: string): string | null;
  /** Account worked: last active + today count (R16 counters). */
  worked(accountId: string): void;
  /** Image/video asset with lineage (same as the UI path); a video carries its `gw:` Muse source so it can be extended. */
  insertMediaAsset(job: JobRow, accountId: string, stored: { path: string; sha256: string; mime: string; width: number; height: number; durationMs: number | null; bytes: number }, museSource?: { conversation: string; turn: string; output: string }): Asset;
  completeChainStep?(jobId: string): void;
}

const SIGNAL_CLASS: Record<string, ErrorClass> = { needs_login: "SESSION_EXPIRED", checkpoint: "CHECKPOINT", quota: "QUOTA_LIMIT", anomaly: "ANOMALY_REPORTED", proxy: "PROXY_FAILED" };
const TECH: HttpReason[] = ["connect_failed", "stream_lost", "protocol_mismatch", "fetch_failed", "no_ack"];
const TECH_CLASS: Record<string, ErrorClass> = { connect_failed: "HTTP_CONNECT_FAILED", stream_lost: "HTTP_STREAM_LOST", protocol_mismatch: "HTTP_PROTOCOL_MISMATCH", fetch_failed: "HTTP_FETCH_FAILED", no_ack: "HTTP_STREAM_LOST" };

class TurnFailed extends Error {
  constructor(
    readonly cls: ErrorClass,
    message: string,
    readonly review = false,
  ) {
    super(message);
  }
}

export class HttpJobRunner {
  constructor(private o: RunnerOps) {}

  /**
   * Runs (or resumes) one job on the account's direct channel. The first state change happens synchronously, before
   * any await (R66). Never sends the same job twice: once the intent is written, only reconciliation decides.
   */
  async run(jobId: string, accountId: string, abort: AbortController, reconcile: boolean): Promise<void> {
    let job = this.o.repo.getJob(jobId);
    if (!job) return;
    const acc = this.o.repo.getAccount(accountId);
    if (!acc) return;
    const mode = acc.execMode;
    const extend = job.operation === "extend";
    if (!reconcile) job = this.o.setJob(job, "preparing", { accountId, execPath: "http", startedAt: this.o.now(), attemptNo: job.attemptNo + 1, errorClass: null, errorMessage: null, stateUntil: null });
    const attemptId = this.o.repo.insertAttempt({ jobId, accountId, proxyId: acc.proxyId, phase: reconcile ? "reconcile" : extend ? "extend" : "generate", startedAt: this.o.now(), path: "http" });
    const seen = new Set<HttpReason>(); // R89: at most one failure event of each kind per job
    const fail = (reason: HttpReason) => {
      if (seen.has(reason)) return;
      seen.add(reason);
      this.o.exec.recordFailure(accountId, reason, mode);
    };
    let afterSend = reconcile;
    // R94: the idle close counts this run as use from its first step to its last download (uploads, the pacing wait
    // and downloads track no turn; before 01/11 a close in that gap made a queued send look lost → NOT_ACCEPTED).
    const release = this.o.exec.hold(accountId);
    try {
      if (!reconcile) {
        let ch;
        try {
          ch = await this.o.exec.ensureConnected(accountId, abort.signal, true);
        } catch (e) {
          return this.beforeSend(job.id, accountId, e, attemptId, fail);
        }
        // Attachments are inline or uploaded to the workspace before the intent: nothing reached the chat yet.
        // An extend step sends one text: the fixed template naming the exact source file (no attachments).
        const source = extend ? this.extendSource(job, accountId) : null;
        let items: SendItem[];
        try {
          items = source ? [{ type: "text", text: this.text(job, accountId) }] : await this.items(job, ch, abort.signal);
        } catch (e) {
          if (!(e instanceof UploadError)) throw e;
          throwIfAborted(abort.signal);
          const signal = e.status === null ? null : classifyGatewaySignal(e.status, null, e.message);
          if (signal && signal !== "needs_login") return this.beforeSend(job.id, accountId, new ChannelError(e.message, signal, e.status), attemptId, fail);
          // Muse refused the file itself (bad type/size): retrying cannot help.
          if (!signal && e.status !== null && e.status >= 400 && e.status < 500) throw new TurnFailed("PROVIDER_ERROR", `Muse không nhận tệp đính kèm: ${e.message}`.slice(0, 300));
          return this.beforeSend(job.id, accountId, new ChannelError(e.message, "stream_lost", e.status), attemptId, fail);
        }
        let sessionId: string;
        let baseline: number | null = null;
        if (source) {
          // The source's own session, proven on this login before anything is sent: its newest video turn must hold
          // the exact source file (a re-login to another Muse user, or a newer video in the thread, stops here).
          sessionId = source.conversation.slice(GW_CONV_PREFIX.length);
          let hist: GwHistory;
          try {
            hist = await ch.history(sessionId);
          } catch (e) {
            return this.beforeSend(job.id, accountId, e, attemptId, fail);
          }
          const proof = sourceInHistory(hist, source.output);
          if (proof !== "ok") throw new TurnFailed("UNKNOWN", proof === "missing" ? "Không thấy video nguồn trong hội thoại Muse của tài khoản này (phiên đã đổi tài khoản?)" : "Video nguồn không còn là video mới nhất của hội thoại Muse");
          baseline = hist.userMsgs;
        } else if (job.conversationId) {
          const conv = this.o.repo.museConversationById(job.conversationId);
          if (!conv || !conv.conversation.startsWith(GW_CONV_PREFIX) || conv.accountId !== accountId) throw new TurnFailed("UNKNOWN", "Không tìm thấy hội thoại để hỏi tiếp");
          sessionId = conv.conversation.slice(GW_CONV_PREFIX.length);
          try {
            baseline = (await ch.history(sessionId)).userMsgs;
          } catch (e) {
            return this.beforeSend(job.id, accountId, e, attemptId, fail);
          }
        } else sessionId = randomUUID();
        await this.o.exec.paced(accountId, abort.signal);
        throwIfAborted(abort.signal);
        // R93: the conversation id (and baseline) are written before the send, in one store transaction. An extend
        // step also marks its conversation unresolved until a result or a settled failure (no second chain meanwhile).
        if (source) this.o.repo.markMuseUnresolved(accountId, source.conversation, job.id);
        job = this.o.setJob(job.id, "submitting", { remoteSessionId: sessionId, baselineUserMsgs: baseline, submitIntentAt: this.o.now() });
        afterSend = true;
        let stream: number | null = null;
        try {
          stream = await ch.send(sessionId, items);
        } catch (e) {
          if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) throw e;
          stream = null; // unknown whether Muse got it → reconcile
        }
        const ack = stream === null ? null : await this.waitAck(ch, stream, abort.signal);
        if (ack && ack.status === 200 && ack.ack?.ok !== false && !ack.ack?.error) {
          const sid = ack.ack?.sessionId && ack.ack.sessionId !== sessionId ? ack.ack.sessionId : null;
          job = this.o.setJob(job.id, "submitted", { acceptedAt: this.o.now(), ...(sid ? { remoteSessionId: sid } : {}) });
          this.o.exec.recordSuccess(accountId);
        } else if (ack && ack.done && (ack.ack?.error || (ack.status !== null && ack.status !== 200))) {
          // Muse answered the send with an error: it did not take this turn.
          const signal = classifyAck(ack.status, ack.ack?.error?.code ?? null, ack.ack?.error?.message ?? null);
          const msg = ack.ack?.error?.message ?? `Muse từ chối lượt gửi (HTTP ${ack.status})`;
          if (signal) throw new AdapterError(SIGNAL_CLASS[signal], msg, { notStarted: true });
          this.o.repo.endAttempt(attemptId, { endedAt: this.o.now(), outcome: "refused", errorClass: "PROVIDER_ERROR", note: msg });
          this.o.setJob(job.id, "failed", { errorClass: "PROVIDER_ERROR", errorMessage: `Muse từ chối lượt gửi: ${msg}`.slice(0, 300) });
          this.o.repo.releaseConversationTurn(job.id);
          return;
        } else {
          const ok = await this.reconcile(job.id, accountId, abort.signal, fail);
          if (!ok) return;
          job = this.o.repo.getJob(job.id)!;
        }
      } else if (job.state === "submitting") {
        const ok = await this.reconcile(job.id, accountId, abort.signal, fail);
        if (!ok) return;
        job = this.o.repo.getJob(job.id)!;
      }
      if (job.state === "submitted") job = this.o.setJob(job.id, "generating");
      if (!["generating", "downloading", "download_retry"].includes(job.state)) return;
      const turn = await this.follow(job.id, accountId, abort.signal, fail);
      if (!turn) return;
      throwIfAborted(abort.signal);
      this.o.repo.endAttempt(attemptId, { endedAt: this.o.now(), outcome: "generated" });
      await this.collect(job.id, accountId, turn.turn, turn.files, abort.signal, fail, turn.earlier);
    } catch (e) {
      if (abort.signal.aborted || e instanceof AbortedError) {
        this.o.fail(jobId, accountId, new AbortedError(), afterSend, attemptId);
        return;
      }
      if (e instanceof TurnFailed) {
        this.o.repo.endAttempt(attemptId, { endedAt: this.o.now(), outcome: e.review ? "review" : "failed", errorClass: e.cls, note: e.message });
        this.o.setJob(jobId, e.review ? "needs_review" : "failed", { errorClass: e.cls, errorMessage: e.message });
        this.o.repo.releaseConversationTurn(jobId);
        return;
      }
      if (e instanceof AdapterError) return this.o.fail(jobId, accountId, e, afterSend && !e.detail.notStarted, attemptId);
      if (e instanceof ChannelError) {
        const cls = SIGNAL_CLASS[e.reason] ?? TECH_CLASS[e.reason] ?? "UNKNOWN";
        if (TECH.includes(e.reason as HttpReason)) fail(e.reason as HttpReason);
        if (!afterSend) return this.beforeSend(jobId, accountId, e, attemptId, fail);
        return this.o.fail(jobId, accountId, new AdapterError(cls, e.message, { afterSend: true }), true, attemptId);
      }
      throw e;
    } finally {
      release();
    }
  }

  // ------------------------------------------------------------------ inputs
  /**
   * R82 — prompt verbatim; attachments (types/sizes the HTTP path is proven for; the scheduler checked them): images
   * inline, documents/videos inline up to INLINE_DOC_MAX_BYTES, bigger ones uploaded to the account workspace and sent
   * as `file_ref` (upload.ts).
   */
  private async items(job: JobRow, ch: HttpChannel, signal: AbortSignal): Promise<SendItem[]> {
    const items: SendItem[] = [];
    for (const id of job.referenceIds) {
      const ref = this.o.repo.getRef(id);
      if (!ref) throw new TurnFailed("UNKNOWN", "Tệp đính kèm không còn trên máy");
      const bytes = fs.readFileSync(ref.path);
      const filename = attachmentName(ref);
      if (ref.kind === "image") {
        // Images always go inline (Muse's web app does the same); the scheduler kept bigger ones off HTTP.
        if (bytes.length > INLINE_DOC_MAX_BYTES) throw new TurnFailed("UNKNOWN", "Ảnh lớn hơn mức kênh trực tiếp gửi được");
        items.push({ type: "image", mime_type: ref.mime, data_base64: bytes.toString("base64"), filename });
        continue;
      }
      if (bytes.length <= INLINE_DOC_MAX_BYTES) {
        items.push({ type: "file", mime_type: ref.mime, data_base64: bytes.toString("base64"), filename });
        continue;
      }
      const t0 = this.o.now();
      const path = await ch.uploadFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), filename, signal);
      this.o.log("info", "job", "job.upload", { jobId: job.id, bytes: bytes.length, ms: this.o.now() - t0 });
      items.push({ type: "file_ref", mime_type: ref.mime, path, filename });
    }
    items.push({ type: "text", text: sentText(job, this.refMedia(job)) });
    return items;
  }

  /**
   * Read-only source recovery for HTTP videos made before sources were saved: one history read per session, never a
   * send. A video is bound only when its job's turn is found exactly (same rule as reconcile), that turn holds exactly
   * one video and its size equals the stored file; anything else stays without a source.
   */
  async findOldSources(accountId: string, items: { assetId: string; job: JobRow; bytes: number }[], signal: AbortSignal): Promise<{ assetId: string; museSource: { conversation: string; turn: string; output: string }; tip: boolean }[]> {
    const out: { assetId: string; museSource: { conversation: string; turn: string; output: string }; tip: boolean }[] = [];
    const bySession = new Map<string, typeof items>();
    for (const it of items) if (it.job.remoteSessionId) bySession.set(it.job.remoteSessionId, [...(bySession.get(it.job.remoteSessionId) ?? []), it]);
    for (const [sid, group] of bySession) {
      throwIfAborted(signal);
      let hist: GwHistory;
      try {
        const ch = await this.o.exec.ensureConnected(accountId, signal);
        hist = await ch.history(sid);
      } catch (e) {
        if (e instanceof AbortedError) throw e;
        this.o.log("info", "job", "source.recover.skip", { accountId, reason: e instanceof ChannelError ? e.reason : "error" });
        continue;
      }
      for (const it of group) {
        const m = matchTurn(hist, this.text(it.job, accountId), it.job.baselineUserMsgs);
        if (m.kind !== "found") continue;
        const vids = wantedMedia("video", m.turn.files);
        if (vids.length !== 1 || vids[0].byteLen === null || vids[0].byteLen !== it.bytes) continue;
        const output = museSandboxLocator(vids[0].path);
        if (!output) continue;
        out.push({ assetId: it.assetId, museSource: { conversation: `${GW_CONV_PREFIX}${sid}`, turn: `t${it.job.baselineUserMsgs ?? 0}`, output }, tip: sourceInHistory(hist, output) === "ok" });
      }
    }
    return out;
  }

  /** The exact text this job sends (and reconcile/tracking match on): the extend template for an extend step. */
  private text(job: JobRow, accountId: string): string {
    if (job.operation !== "extend") return sentText(job, this.refMedia(job));
    return buildMuseExtendMessage(this.extendSource(job, accountId).output, job.extendMode ?? "auto", job.directive);
  }

  /** The `gw:` Muse source of an extend step's video, owned by this account; otherwise the step cannot run here. */
  private extendSource(job: JobRow, accountId: string): { conversation: string; turn: string; output: string } {
    const sourceId = job.sourceAssetId ? this.o.repo.assetRemoteSourceId(job.sourceAssetId) : null;
    const s = sourceId ? this.o.repo.getRemoteSource(sourceId) : null;
    if (!s?.museSource || s.provider !== "muse" || s.ownerAccountId !== accountId || !s.museSource.conversation.startsWith(GW_CONV_PREFIX)) {
      throw new TurnFailed("UNKNOWN", "Mất nguồn hội thoại Muse của video này");
    }
    return s.museSource;
  }

  /** Same rule as the UI path (coordinator): any MP4 reference makes it a video edit. */
  private refMedia(job: JobRow): "image" | "video" | undefined {
    if (job.kind === "chat" || job.mode !== "reference") return undefined;
    return job.referenceIds.some((id) => this.o.repo.getRef(id)?.mime === "video/mp4") ? "video" : "image";
  }

  /** Technical failure before anything left: the job goes back to the queue (another account or the UI path). */
  private beforeSend(jobId: string, accountId: string, e: unknown, attemptId: string, fail: (r: HttpReason) => void): void {
    if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) {
      return this.o.fail(jobId, accountId, new AdapterError(SIGNAL_CLASS[e.reason], e.message, { notStarted: true }), false, attemptId);
    }
    if (e instanceof AbortedError) return this.o.fail(jobId, accountId, e, false, attemptId);
    const reason: HttpReason = e instanceof ChannelError && TECH.includes(e.reason as HttpReason) ? (e.reason as HttpReason) : "connect_failed";
    fail(reason);
    const msg = e instanceof Error ? e.message : String(e);
    this.o.repo.endAttempt(attemptId, { endedAt: this.o.now(), outcome: "not_sent", errorClass: TECH_CLASS[reason], note: msg });
    const job = this.o.repo.getJob(jobId);
    if (job && job.state === "preparing") this.o.setJob(job, "queued", { accountId: null, execPath: null, errorClass: TECH_CLASS[reason], errorMessage: ERROR_LABEL[TECH_CLASS[reason]] });
  }

  private async waitAck(ch: ReturnType<ExecutionManager["ensureConnected"]> extends Promise<infer C> ? C : never, stream: number, signal: AbortSignal) {
    const end = Date.now() + this.o.exec.t.ackTimeoutMs;
    const step = Math.max(5, Math.min(250, this.o.exec.t.ackTimeoutMs / 10));
    for (;;) {
      const a = await ch.ack(stream).catch(() => null);
      if (a?.done) return a;
      if (Date.now() >= end) return null;
      await sleep(Math.min(step, Math.max(1, end - Date.now())), signal);
    }
  }

  // ------------------------------------------------------------------ R93 reconcile
  /** Returns true when Muse has the turn (job → submitted); otherwise the job got its final state here. */
  private async reconcile(jobId: string, accountId: string, signal: AbortSignal, fail: (r: HttpReason) => void): Promise<boolean> {
    const t = this.o.exec.t;
    const started = Date.now();
    const gap = t.reconcileReads > 1 ? t.reconcileSpanMs / (t.reconcileReads - 1) : 0;
    let reads = 0;
    let noAckCounted = false;
    for (;;) {
      throwIfAborted(signal);
      const job = this.o.repo.getJob(jobId)!;
      const sid = job.remoteSessionId;
      if (!sid) {
        this.o.setJob(jobId, "failed", { errorClass: "NOT_ACCEPTED", errorMessage: ERROR_LABEL.NOT_ACCEPTED });
        return false;
      }
      let hist: GwHistory | null = null;
      try {
        const ch = await this.o.exec.ensureConnected(accountId, signal, true);
        hist = await ch.history(sid);
      } catch (e) {
        if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) throw e;
        if (e instanceof AbortedError) throw e;
        hist = null;
      }
      if (hist) {
        reads++;
        const verdict = matchTurn(hist, this.text(job, accountId), job.baselineUserMsgs);
        this.o.log("info", "job", "job.reconcile", { jobId, read: reads, verdict: verdict.kind });
        if (verdict.kind === "found") {
          this.o.setJob(jobId, "submitted", { acceptedAt: job.acceptedAt ?? this.o.now() });
          this.o.exec.recordSuccess(accountId);
          return true;
        }
        if (verdict.kind === "ambiguous") {
          this.o.setJob(jobId, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Hội thoại có tin khác với lời nhắn đã gửi — cần anh xem" });
          this.o.repo.releaseConversationTurn(jobId);
          return false;
        }
        if (!noAckCounted) {
          noAckCounted = true;
          fail("no_ack"); // R89(e): no ack and not reconciled (yet)
        }
        if (reads >= t.reconcileReads && Date.now() - started >= t.reconcileSpanMs) {
          this.o.setJob(jobId, "failed", { errorClass: "NOT_ACCEPTED", errorMessage: ERROR_LABEL.NOT_ACCEPTED });
          this.o.repo.releaseConversationTurn(jobId);
          return false;
        }
      } else if (Date.now() - started >= t.reconcileGiveUpMs) {
        this.o.setJob(jobId, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Chưa xác minh được Muse đã nhận lượt này — kênh trực tiếp lỗi" });
        return false;
      }
      await sleep(hist ? gap : Math.min(t.reconnectDelaysMs[t.reconnectDelaysMs.length - 1] ?? 10_000, 60_000), signal);
    }
  }

  // ------------------------------------------------------------------ R94 tracking
  private async follow(jobId: string, accountId: string, signal: AbortSignal, fail: (r: HttpReason) => void): Promise<{ turn: GwTurn; files: GwFile[]; earlier: Set<string> } | null> {
    const t = this.o.exec.t;
    let job = this.o.repo.getJob(jobId)!;
    const sid = job.remoteSessionId!;
    const kind = job.kind;
    const timeout = job.operation === "extend" ? Math.max(t.timeoutMs[kind], MUSE_EXTEND_TIMEOUT_MS) : t.timeoutMs[kind];
    const start = Date.now();
    let wake: (() => void) | null = null;
    let completed = false;
    let channelDownSince: number | null = null;
    const eventFiles: GwFile[] = [];
    const off = this.o.exec.track(accountId, sid, (e) => {
      if (e.kind === "channel") channelDownSince = e.open ? null : (channelDownSince ?? Date.now());
      else if ((e as GwEvent).kind === "status" && TERMINAL_STATUS.has((e as GwEvent).status ?? "")) completed = true;
      else if ((e as GwEvent).kind === "files") for (const f of (e as GwEvent).files ?? []) if (!eventFiles.some((x) => x.path === f.path)) eventFiles.push(f);
      wake?.();
    });
    let lastDone: { at: number; updated: number | null } | null = null;
    let streamLostCounted = false;
    // A media turn that looks done without its image/video yet: re-read for up to mediaGraceMs (HTTP_MEDIA_GRACE_MS).
    let mediaWaitSince: number | null = null;
    // A reply with no final answer message (files only, live 01/11): the conversation list must say done on two reads
    // a stable gap apart with the same output, so a list that still shows the previous turn never ends this one.
    let sessionDoneSince: { at: number; sig: string } | null = null;
    let sessionCheckedAt = 0;
    try {
      for (;;) {
        throwIfAborted(signal);
        const waitMs = mediaWaitSince !== null || sessionDoneSince ? t.stableGapMs : completed ? 0 : lastDone ? t.stableGapMs : t.historyFallbackMs;
        if (waitMs > 0) {
          await new Promise<void>((res) => {
            const timer = setTimeout(res, waitMs);
            wake = () => {
              clearTimeout(timer);
              res();
            };
            signal.addEventListener("abort", () => res(), { once: true });
          });
          wake = null;
        }
        throwIfAborted(signal);
        job = this.o.repo.getJob(jobId)!;
        let hist: GwHistory | null = null;
        try {
          const ch = await this.o.exec.ensureConnected(accountId, signal);
          hist = await ch.history(sid);
          channelDownSince = null;
        } catch (e) {
          if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) throw e;
          if (e instanceof AbortedError) throw e;
          channelDownSince ??= Date.now();
          if (!streamLostCounted && e instanceof ChannelError) {
            streamLostCounted = true;
            fail(TECH.includes(e.reason as HttpReason) ? (e.reason as HttpReason) : "stream_lost");
          }
        }
        if (!hist) {
          // R91: no UI read path for HTTP conversations yet (§4.2) → wait for HTTP; after 2 h → needs_review.
          if (channelDownSince !== null && Date.now() - channelDownSince >= t.reconcileGiveUpMs) throw new TurnFailed("HTTP_STREAM_LOST", "Chưa lấy được kết quả — kênh trực tiếp lỗi", true);
          continue;
        }
        const m = matchTurn(hist, this.text(job, accountId), job.baselineUserMsgs);
        const turn = m.kind === "found" ? m.turn : null;
        const files = () => mergeFiles(turn?.files ?? [], eventFiles);
        // Workspace files of the turns before this one (an extend reply re-attaches its source: never the result).
        const result = (): { turn: GwTurn; files: GwFile[]; earlier: Set<string> } => ({ turn: turn!, files: files(), earlier: new Set(hist!.turns.slice(0, Math.max(0, hist!.turns.indexOf(turn!))).flatMap((x) => x.files.map((f) => f.path))) });
        const looksDone = !!turn && turnLooksDone(turn);
        let sessionDone = false;
        // Only a turn with output is checked (one list read per stable gap): Muse still thinking costs no extra reads.
        if (turn && !looksDone && (files().length > 0 || !!turn.assistant?.text) && Date.now() - sessionCheckedAt >= t.stableGapMs - 5) {
          sessionCheckedAt = Date.now();
          const st = await this.sessionState(accountId, sid, signal);
          const sig = `${files().length}|${turn.assistant?.updatedAtMs ?? ""}|${turn.assistant?.text.length ?? -1}`;
          if (!sessionSaysDone(st, turn, files().length)) sessionDoneSince = null;
          else if (sessionDoneSince && sessionDoneSince.sig === sig && Date.now() - sessionDoneSince.at >= t.stableGapMs - 5) sessionDone = true;
          else if (!sessionDoneSince || sessionDoneSince.sig !== sig) sessionDoneSince = { at: Date.now(), sig };
        } else if (looksDone) sessionDoneSince = null;
        if (turn && (looksDone || sessionDone)) {
          const upd = turn.assistant?.updatedAtMs ?? null;
          const prev = lastDone as { at: number; updated: number | null } | null;
          const done = sessionDone || completed || (!!turn.status && TERMINAL_STATUS.has(turn.status)) || (!!prev && prev.updated === upd && Date.now() - prev.at >= t.stableGapMs - 5);
          if (done) {
            const waitForMedia = kind !== "chat" && turn.status !== "failed" && !wantedMedia(kind, files()).length;
            if (!waitForMedia) return result();
            mediaWaitSince ??= Date.now();
            if (Date.now() - mediaWaitSince >= t.mediaGraceMs) return result();
          }
          if (!done || prev?.updated !== upd) lastDone = { at: Date.now(), updated: upd };
        } else lastDone = null;
        if (Date.now() - start >= timeout) {
          // R94/AC-GW-10: this read was the last; a turn still running is never taken as done (partial text was
          // returned as the answer before 01/11) and never resent — it goes to review.
          if (turn && (turnLooksDone(turn) || sessionDone)) return result();
          throw new TurnFailed("UNKNOWN", `Muse chưa xong sau ${Math.round(timeout / 60_000)} phút`, true);
        }
      }
    } finally {
      off();
    }
  }

  /** The conversation-list state, or null when it cannot be read now (history decides channel health). */
  private async sessionState(accountId: string, sid: string, signal: AbortSignal) {
    try {
      const ch = await this.o.exec.ensureConnected(accountId, signal);
      return await ch.sessionState(sid);
    } catch (e) {
      if (e instanceof AbortedError) throw e;
      if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) throw e;
      return null;
    }
  }

  // ------------------------------------------------------------------ R83/R95 outputs
  private async collect(jobId: string, accountId: string, turn: GwTurn, files: GwFile[], signal: AbortSignal, fail: (r: HttpReason) => void, earlier: Set<string> = new Set()): Promise<void> {
    let job = this.o.repo.getJob(jobId)!;
    if (job.state !== "downloading") job = this.o.setJob(job, "downloading");
    const text = turn.assistant?.text ?? "";
    if (job.kind !== "chat") return this.collectMedia(job, accountId, turn, files, signal, fail, earlier);
    // Chat: the text + every file Muse attached to this turn (R83).
    const cut = truncateUtf8(text);
    const { kept, truncated } = limitOutputs(files.map((f) => ({ ...f, byteLen: f.byteLen })));
    const shas: string[] = [];
    let n = 0;
    if (cut.truncated) {
      n++;
      const stored = await this.o.media().storeChatOutput({ jobId, n, bytes: new TextEncoder().encode(text), declaredName: "tra-loi-day-du.md", declaredMime: "text/markdown", declaredBytes: null, at: this.o.now(), existingShas: shas });
      if (!("duplicateOf" in stored)) {
        shas.push(stored.sha256);
        this.insertOutput(job, accountId, stored);
      }
    }
    for (const f of kept) {
      n++;
      const bytes = await this.fetchWithRetry(job, accountId, f, CHAT_OUTPUT_FILE_MAX_BYTES, signal, fail);
      if (!bytes) return; // job already needs_review
      try {
        const stored = await this.o.media().storeChatOutput({ jobId, n, bytes, declaredName: f.name ?? leafName(f.path), declaredMime: f.mime, declaredBytes: f.byteLen, at: this.o.now(), existingShas: shas });
        if ("duplicateOf" in stored) continue;
        shas.push(stored.sha256);
        this.insertOutput(job, accountId, stored);
      } catch (e) {
        if (!(e instanceof InvalidMediaError)) throw e;
        this.o.setJob(jobId, "needs_review", { errorClass: "DOWNLOAD_FAILED", errorMessage: `Tệp Muse trả không hợp lệ: ${e.message}` });
        return;
      }
    }
    this.o.media().cleanupStaging(jobId);
    if (!cut.text && shas.length === 0) {
      this.o.setJob(jobId, "failed", { errorClass: "EMPTY_RESPONSE", errorMessage: ERROR_LABEL.EMPTY_RESPONSE });
      this.o.repo.releaseConversationTurn(jobId);
      return;
    }
    const conversationId = job.conversationId ?? this.o.repo.ensureChatConversation(accountId, `${GW_CONV_PREFIX}${job.remoteSessionId}`, job.apiKeyId);
    this.o.repo.releaseConversationTurn(jobId);
    this.o.setJob(jobId, "completed", { resultText: cut.text, resultTextTruncated: cut.truncated, outputsTruncated: truncated, conversationId, errorClass: null, errorMessage: null, completedAt: this.o.now() });
    this.o.exec.recordSuccess(accountId);
    this.o.worked(accountId);
  }

  private insertOutput(job: JobRow, accountId: string, stored: Awaited<ReturnType<MediaStore["storeChatOutput"]>> & { kind: string }): void {
    if ("duplicateOf" in stored) return;
    const asset = this.o.repo.insertAsset({
      jobId: job.id,
      batchId: job.batchId,
      path: stored.path,
      sha256: stored.sha256,
      kind: stored.kind,
      mime: stored.mime,
      width: stored.width,
      height: stored.height,
      durationMs: stored.durationMs,
      bytes: stored.bytes,
      filename: stored.filename,
      zoneMarked: stored.zoneMarked,
      accountAlias: this.o.accountAlias(accountId),
      prompt: job.prompt,
      createdAt: this.o.now(),
      site: "muse",
    });
    this.o.emitAsset(asset);
  }

  private async collectMedia(job: JobRow, accountId: string, turn: GwTurn, files: GwFile[], signal: AbortSignal, fail: (r: HttpReason) => void, earlier: Set<string>): Promise<void> {
    const source = job.operation === "extend" ? this.extendSource(job, accountId) : null;
    // Live 03/11: an extend reply re-attaches the source MP4 next to the cumulative one. Only a new file can be the
    // result: not the source locator, not a file of an earlier turn, and (after download) not a byte copy of the source.
    const wanted = wantedMedia(job.kind, files).filter((f) => !source || (museSandboxLocator(f.path) !== source.output && !earlier.has(f.path)));
    if (!wanted.length) {
      // R6/R64 — what a finished reply without the requested file means (same rules as the UI path).
      const other = files.length && job.kind === "video" && files.some((f) => f.mime?.startsWith("image/"));
      if (other) throw new TurnFailed("UNKNOWN", "Muse trả về ảnh thay vì video");
      const text = turn.assistant?.text ?? "";
      const cls = classifyMuseReply(text);
      if (cls === "quota") throw new AdapterError("QUOTA_LIMIT", "Muse báo hết hạn mức", { afterSend: true });
      if (cls === "refused") throw new TurnFailed("CONTENT_REFUSED", text.slice(0, 300) || ERROR_LABEL.CONTENT_REFUSED);
      if (cls === "provider_error" || turn.status === "failed") throw new TurnFailed("PROVIDER_ERROR", `Muse gặp lỗi kỹ thuật, chưa tạo được tệp${text ? `: “${text.slice(0, 160)}”` : ""}`);
      if (cls === "media_pending") throw new TurnFailed("UNKNOWN", "Muse báo đã tạo tệp nhưng lượt không có tệp nào", true);
      throw new TurnFailed("UNKNOWN", "Muse không trả về tệp nào");
    }
    // R58 — an extend step accepts exactly one new video with a valid workspace locator; anything else goes to review
    // (never re-sent), like the UI path. Candidates are fetched first so nothing ambiguous reaches the library.
    let picked: { f: GwFile; bytes: Uint8Array | null }[] = wanted.map((f) => ({ f, bytes: null }));
    if (source) {
      const srcSha = job.sourceAssetId ? (this.o.repo.getAsset(job.sourceAssetId)?.sha256 ?? null) : null;
      picked = [];
      for (const f of wanted) {
        const bytes = await this.fetchWithRetry(job, accountId, f, CHAT_OUTPUT_FILE_MAX_BYTES, signal, fail);
        if (!bytes) return;
        if (srcSha && createHash("sha256").update(bytes).digest("hex") === srcSha) continue;
        picked.push({ f, bytes });
      }
      if (picked.length !== 1 || !museSandboxLocator(picked[0].f.path)) throw new TurnFailed("AMBIGUOUS_SUBMIT", "Không xác định được video tích luỹ", true);
    }
    const sessionKey = job.remoteSessionId ? `${GW_CONV_PREFIX}${job.remoteSessionId}` : null;
    // R85/AC-CHAT-09 — an HTTP image/video turn lives in a Muse conversation the owner (this job's key, or Studio) can
    // continue with Hỏi đáp; the handle is app-issued and the Muse id stays in the main process. It is created before
    // the asset, so the conversation stays a Hỏi đáp one when the video becomes its extendable head.
    const conversationId = source ? job.conversationId : job.conversationId ?? (sessionKey ? this.o.repo.ensureChatConversation(accountId, sessionKey, job.apiKeyId) : null);
    // A video bound to exactly one workspace file of this turn carries its gw: source, so it can be extended later.
    const bindable = job.kind === "video" && !!sessionKey && picked.length === 1;
    const batch = job.batchId ? this.o.repo.getBatch(job.batchId) : null;
    const shas = this.o.repo.assetsForJob(job.id).map((a) => a.sha256);
    const chain = job.chainId ? { id: job.chainId, step: job.stepIndex ?? 1 } : null;
    for (let i = 0; i < picked.length; i++) {
      while (this.o.diskPaused()) {
        await sleep(5000, signal);
        await this.o.refreshDisk();
      }
      const bytes = picked[i].bytes ?? (await this.fetchWithRetry(job, accountId, picked[i].f, CHAT_OUTPUT_FILE_MAX_BYTES, signal, fail));
      if (!bytes) return;
      try {
        const stored = await this.o.media().store({ jobId: job.id, n: i + 1, bytes, expectedKind: job.kind === "video" ? "video" : "image", batchName: batch?.name ?? null, at: this.o.now(), existingShas: shas, chain });
        if ("duplicateOf" in stored) continue;
        shas.push(stored.sha256);
        const output = bindable ? museSandboxLocator(picked[i].f.path) : null;
        const museSource = output && sessionKey ? { conversation: sessionKey, turn: `t${job.baselineUserMsgs ?? 0}`, output } : undefined;
        this.o.emitAsset(this.o.insertMediaAsset(job, accountId, stored, museSource));
      } catch (e) {
        if (!(e instanceof InvalidMediaError)) throw e;
        this.o.setJob(job.id, "needs_review", { errorClass: "DOWNLOAD_FAILED", errorMessage: e.message });
        return;
      }
    }
    this.o.media().cleanupStaging(job.id);
    this.o.exec.recordSuccess(accountId);
    this.o.worked(accountId);
    if (job.chainId && this.o.completeChainStep) {
      this.o.completeChainStep(job.id);
      return;
    }
    this.o.setJob(job.id, "completed", { errorClass: null, errorMessage: null, conversationId, completedAt: this.o.now() });
  }

  /** R89(d) — 3 retries (2/5/15 s); then one HTTP failure and the job needs review (never re-sent). */
  private async fetchWithRetry(job: JobRow, accountId: string, f: GwFile, maxBytes: number, signal: AbortSignal, fail: (r: HttpReason) => void): Promise<Uint8Array | null> {
    const delays = this.o.exec.t.fetchRetryDelaysMs;
    let last = "";
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      throwIfAborted(signal);
      const att = this.o.repo.insertAttempt({ jobId: job.id, accountId, proxyId: this.o.repo.getAccount(accountId)?.proxyId ?? null, phase: "download", startedAt: this.o.now(), path: "http" });
      this.o.repo.updateJob(job.id, { downloadAttempts: (this.o.repo.getJob(job.id)?.downloadAttempts ?? 0) + 1 }, this.o.now());
      try {
        const ch = await this.o.exec.ensureConnected(accountId, signal);
        const r = await ch.fetchFile(f.path, maxBytes, signal);
        if (f.byteLen !== null && r.data.length !== f.byteLen) throw new ChannelError(`Tệp thiếu byte (${r.data.length}/${f.byteLen})`, "fetch_failed");
        this.o.repo.endAttempt(att, { endedAt: this.o.now(), outcome: "downloaded" });
        if (this.o.repo.getJob(job.id)?.state === "download_retry") this.o.setJob(job.id, "downloading");
        return r.data;
      } catch (e) {
        if (e instanceof AbortedError) throw e;
        if (e instanceof ChannelError && (SIGNAL_CLASS[e.reason] || e.reason === "proxy")) throw e;
        last = e instanceof Error ? e.message : String(e);
        this.o.repo.endAttempt(att, { endedAt: this.o.now(), outcome: "download_failed", errorClass: "HTTP_FETCH_FAILED", note: last });
        if (attempt < delays.length) {
          this.o.setJob(job.id, "download_retry", { errorMessage: last });
          await sleep(delays[attempt], signal);
        }
      }
    }
    fail("fetch_failed");
    this.o.setJob(job.id, "needs_review", { errorClass: "DOWNLOAD_FAILED", errorMessage: `Tải tệp qua kênh trực tiếp lỗi ${delays.length + 1} lần: ${last}`.slice(0, 300) });
    this.o.repo.releaseConversationTurn(job.id);
    return null;
  }
}

function classifyAck(status: number | null, code: string | null, message: string | null): "anomaly" | "checkpoint" | "needs_login" | "quota" | null {
  return classifyGatewaySignal(status, code, message);
}

/** The exact text sent to Muse: chat verbatim (R81); image/video with the same templates as the UI path. */
/** The image/video files of a media turn (by MIME, else by extension). */
export function wantedMedia(kind: JobRow["kind"], files: GwFile[]): GwFile[] {
  const want = kind === "video" ? "video/" : "image/";
  return files.filter((f) => (f.mime ? f.mime.startsWith(want) : kind === "video" ? /\.(mp4|mov|webm)$/i.test(f.path) : /\.(png|jpe?g|webp|gif)$/i.test(f.path)));
}

/**
 * Name Muse sees for an attachment: the name the user/agent gave, else a neutral `ref-<sha>.<ext>` — never the local
 * path, which would leak the Windows user folder (live 01/11: a path-derived name reached Muse).
 */
export function attachmentName(ref: { filename?: string | null; sha256: string; mime: string }): string {
  const given = (ref.filename ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  return given || `ref-${ref.sha256.slice(0, 12)}.${outputExt(null, null, ref.mime)}`;
}

/** The exact text sent for a job (reconcile matches on it); a video reference picks the edit-video template like the UI path. */
export function sentText(job: Pick<JobRow, "kind" | "mode" | "prompt">, referenceMedia?: "image" | "video"): string {
  return job.kind === "chat" ? job.prompt : buildMessage(job.kind, job.mode, job.prompt, referenceMedia);
}

/**
 * Before an extend send on the channel: the session's newest turn with a video must hold the exact source file.
 * `missing` = not in this login's session at all (re-login to another Muse user, deleted thread); `not_tip` = a newer
 * video follows it, so “the video above” would no longer be the source.
 */
export function sourceInHistory(h: GwHistory, output: string): "ok" | "missing" | "not_tip" {
  const videoTurns = h.turns.filter((t) => wantedMedia("video", t.files).length > 0);
  const holds = (t: GwTurn) => t.files.some((f) => museSandboxLocator(f.path) === output);
  if (!videoTurns.some(holds)) return "missing";
  return holds(videoTurns[videoTurns.length - 1]) ? "ok" : "not_tip";
}

function mergeFiles(a: GwFile[], b: GwFile[]): GwFile[] {
  const out = [...a];
  for (const f of b) if (!out.some((x) => x.path === f.path)) out.push(f);
  return out;
}

/**
 * R93 — find this job's turn. New conversation: a user message equal to the prompt (exactly one). Continuation: the
 * (baseline+1)-th user message must be equal to the prompt and be the only new one.
 */
export function matchTurn(h: GwHistory, prompt: string, baseline: number | null): { kind: "found"; turn: GwTurn } | { kind: "missing" } | { kind: "ambiguous" } {
  if (baseline === null) {
    const hits = h.turns.filter((t) => userSaid(prompt, t));
    if (hits.length === 1) return { kind: "found", turn: hits[0] };
    if (hits.length > 1 || (h.turns.length > 0 && hits.length === 0)) return h.turns.length ? { kind: "ambiguous" } : { kind: "missing" };
    return { kind: "missing" };
  }
  if (h.userMsgs <= baseline) return { kind: "missing" };
  const t = h.turns[baseline];
  if (h.userMsgs === baseline + 1 && t && userSaid(prompt, t)) return { kind: "found", turn: t };
  return { kind: "ambiguous" };
}

/** Exact match with Muse's copy, as stored or without its attachment marker lines (a sent text never carries them). */
function userSaid(prompt: string, t: GwTurn): boolean {
  return samePrompt(prompt, t.user.text) || (t.user.prompt !== t.user.text && samePrompt(prompt, t.user.prompt));
}
