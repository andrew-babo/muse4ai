import type { AckResult, PollResult, SendItem } from "../../shared/gateway/bridge";
import type { GwEvent, GwFile, GwHistory, GwSessionState, GwTurn } from "../../shared/gateway/events";
import { ChannelError, type HttpChannel } from "./muse/httpChannel";
import { randomUUID } from "node:crypto";
import { fakeMp4, fakePng } from "./fake";
import { fakeVibesMp4 } from "./vibes/fake";
import { uploadTarget, uploadToWorkspace, type FsOp, type FsReply } from "../../shared/gateway/upload";

// Scripted fake of one account's direct channel (Build 2.0 tests and demo/E2E mode). Simulates Muse conversations
// in memory: acks, completion events, history, files. Never touches the network.

export interface FakeReply {
  text?: string;
  files?: { name: string; mime: string; bytes: Uint8Array; declaredBytes?: number | null }[];
  status?: "completed" | "failed";
  /** The files show up in history only this long after the turn is done (no files event) — Muse's late presentation. */
  filesLateMs?: number;
  /**
   * Live 01/11 ("make run.bat", no explanation): the reply is only a file widget. History then has no answer message
   * and no task status for the turn; only the conversation list says "completed". Implies emitCompleted=false for it.
   */
  filesOnly?: boolean;
  /**
   * Before the turn is done, history already shows an assistant message marked ready but not finished (live 01/11:
   * a "commentary" preamble, or the answer's first streamed words, both with display_text_ready=true and no status).
   */
  early?: { text: string; fromMs?: number };
}

export type FakeGwStep =
  | { phase: "connect"; error: ChannelError["reason"]; status?: number }
  | { phase: "send"; error: ChannelError["reason"] }
  /** The ack carries a Muse error (R90 signals, provider refusal). */
  | { phase: "ack"; ackError: { status: number; code?: string; message: string } }
  /** No ack ever arrives; `delivered` decides whether Muse got the message (reconcile finds it or not). */
  | { phase: "ack"; noAck: true; delivered: boolean }
  | { phase: "history"; error: ChannelError["reason"] }
  | { phase: "sessions"; error: ChannelError["reason"] }
  | { phase: "fetch"; error: ChannelError["reason"] }
  | { phase: "poll"; drop: true }
  | { phase: "probe"; error: ChannelError["reason"] }
  /** The next workspace /fs/write answers with this status (null = no reply in time). */
  | { phase: "upload"; status: number | null };

export interface FakeGwConfig {
  ackDelayMs?: number;
  completeMs?: number;
  /** Completion is announced by a `task.status completed` event (default) or only visible in history (image turns). */
  emitCompleted?: boolean;
  reply?: (prompt: string, items: SendItem[], turnIndex: number, sessionId: string) => FakeReply;
  script?: FakeGwStep[];
  /** Every send (session, prompt, items) — duplicate-send checks. */
  sent?: { sessionId: string; prompt: string; items: SendItem[] }[];
  connects?: number;
  /** Every workspace /fs/* call (op + path), in order — upload checks. */
  fsCalls?: { op: FsOp; path: string }[];
  /**
   * Muse drops the socket server-side the next time the channel is used, without the app noticing (isOpen() keeps the
   * last known state until checkOpen() or a failed call), like the live 01/11 code-1006 close of an idle socket.
   */
  serverDrop?: boolean;
  /** A send arrives at Muse while `open` is false? (true = Muse got it despite the socket dying) */
  memory?: number;
}

interface Turn {
  user: string;
  items: SendItem[];
  at: number;
  doneAt: number;
  reply: FakeReply;
  announced: boolean;
}

/** Default fake Muse: the app's image/video templates get a file (seeded by the prompt), anything else a text answer. */
export function defaultFakeReply(prompt: string, _items?: unknown, turnIndex = 0): FakeReply {
  // An extend step (buildMuseExtendMessage) in a conversation whose first turn made a 10 s video: one cumulative MP4
  // of (turn + 1) × 10 s, as live Muse did on 03/11 (the source re-attachment is modelled in the tests that need it).
  if (prompt.startsWith("Extend the exact video")) return { text: "Here is the cumulative video", files: [{ name: `extended-${turnIndex}.mp4`, mime: "video/mp4", bytes: fakeVibesMp4((turnIndex + 1) * 10_000, turnIndex) }] };
  if (/^(Generate an image|Edit the attached image)/.test(prompt)) return { text: "Here is your image", files: [{ name: "image.png", mime: "image/png", bytes: fakePng(prompt.length) }] };
  if (/^(Generate a short video|Animate the attached image|Edit the attached video)/.test(prompt)) return { text: "Here is your video", files: [{ name: "video.mp4", mime: "video/mp4", bytes: fakeMp4(prompt.length) }] };
  return { text: `Trả lời: ${prompt.slice(0, 200)}` };
}

export class FakeHttpChannel implements HttpChannel {
  static sessions = new Map<string, { account: string; turns: Turn[] }>();
  /** Per-account fake workspace: `${account}|${path}` → bytes. */
  static workspace = new Map<string, Uint8Array>();
  private uploadSeq = 0;
  private open = false;
  private nextStream = 1;
  private acks = new Map<number, { sessionId: string; readyAt: number; result: AckResult | null }>();
  private subscribed = new Set<string>();
  private queue: GwEvent[] = [];
  closedCount = 0;

  constructor(
    public accountId: string,
    public cfg: FakeGwConfig = {},
  ) {}

  private take<P extends FakeGwStep["phase"]>(phase: P): Extract<FakeGwStep, { phase: P }> | undefined {
    const s = this.cfg.script;
    if (!s) return undefined;
    const i = s.findIndex((x) => x.phase === phase);
    return i < 0 ? undefined : (s.splice(i, 1)[0] as Extract<FakeGwStep, { phase: P }>);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** The socket is gone at Muse; true when the app still believed it open (a call on it fails and refreshes state). */
  private dead(): boolean {
    if (this.cfg.serverDrop) {
      this.cfg.serverDrop = false;
      this.dropped = true;
      this.subscribed.clear();
    }
    if (this.dropped) this.open = false;
    return this.dropped;
  }
  private dropped = false;

  async checkOpen(): Promise<boolean> {
    this.dead();
    return this.open;
  }

  async connect(): Promise<void> {
    this.cfg.connects = (this.cfg.connects ?? 0) + 1;
    this.dropped = false;
    const step = this.take("connect");
    if (step) {
      this.open = false;
      throw new ChannelError(`fake connect ${step.error}`, step.error, step.status ?? null);
    }
    this.open = true;
  }

  private async fs(op: FsOp, body: Record<string, unknown>): Promise<FsReply> {
    const path = String(op === "rename" ? body.source : body.path);
    (this.cfg.fsCalls ??= []).push({ op, path });
    const key = (p: unknown) => `${this.accountId}|${String(p)}`;
    const ws = FakeHttpChannel.workspace;
    if (op === "write") {
      const step = this.take("upload");
      if (step) return { status: step.status, ok: false, size: null, kind: null, error: step.status === null ? "timeout" : `HTTP ${step.status}` };
      const piece = Buffer.from(String(body.data_base64 ?? ""), "base64");
      const prev = body.append === true ? (ws.get(key(path)) ?? new Uint8Array(0)) : new Uint8Array(0);
      ws.set(key(path), new Uint8Array(Buffer.concat([prev, piece])));
      return { status: 200, ok: true, size: null, kind: null, error: null };
    }
    if (op === "stat") {
      const f = ws.get(key(path));
      return f ? { status: 200, ok: true, size: f.length, kind: "file", error: null } : { status: 404, ok: false, size: null, kind: null, error: "not_found" };
    }
    if (op === "rename") {
      const f = ws.get(key(body.source));
      if (!f) return { status: 404, ok: false, size: null, kind: null, error: "not_found" };
      ws.delete(key(body.source));
      ws.set(key(body.destination), f);
      return { status: 200, ok: true, size: null, kind: null, error: null };
    }
    ws.delete(key(path));
    return { status: 200, ok: true, size: null, kind: null, error: null };
  }

  async uploadFile(data: Uint8Array, filename: string, signal: AbortSignal): Promise<string> {
    if (!this.open) throw new ChannelError("closed", "stream_lost");
    const target = uploadTarget(filename, this.uploadSeq++, Math.random().toString(36).slice(2, 6), randomUUID());
    return uploadToWorkspace({ fs: (op, body) => this.fs(op, body), toBase64: (b) => Buffer.from(b).toString("base64"), signal }, data, target);
  }

  /** Bytes of a workspace file this account uploaded (tests). */
  static uploaded(accountId: string, path: string): Uint8Array | undefined {
    return FakeHttpChannel.workspace.get(`${accountId}|${path}`);
  }

  async send(sessionId: string, items: SendItem[]): Promise<number> {
    if (this.dead() || !this.open) throw new ChannelError("closed", "stream_lost");
    const step = this.take("send");
    if (step) throw new ChannelError(`fake send ${step.error}`, step.error);
    // Muse resolves a file_ref in the account's own workspace; a missing file is refused in the ack.
    const missingRef = items.some((i) => i.type === "file_ref" && !FakeHttpChannel.workspace.has(`${this.accountId}|${i.path}`));
    if (missingRef) {
      const id = this.nextStream++;
      this.acks.set(id, { sessionId, readyAt: Date.now(), result: { done: true, status: 400, ack: { sessionId: null, isThread: null, ok: false, error: { code: "file_not_found", message: "attachment not found" } }, reset: null } });
      return id;
    }
    const prompt = items.filter((i): i is Extract<SendItem, { type: "text" }> => i.type === "text").map((i) => i.text).join("\n");
    const ackStep = this.take("ack");
    const id = this.nextStream++;
    const now = Date.now();
    const deliver = !ackStep || !("noAck" in ackStep) || ackStep.delivered;
    const refused = ackStep && "ackError" in ackStep ? ackStep.ackError : null;
    if (deliver && !refused) {
      (this.cfg.sent ??= []).push({ sessionId, prompt, items });
      let conv = FakeHttpChannel.sessions.get(sessionId);
      if (!conv) {
        conv = { account: this.accountId, turns: [] };
        FakeHttpChannel.sessions.set(sessionId, conv);
      }
      const reply = (this.cfg.reply ?? defaultFakeReply)(prompt, items, conv.turns.length, sessionId);
      conv.turns.push({ user: prompt, items, at: now, doneAt: now + (this.cfg.completeMs ?? 20), reply, announced: false });
    }
    const result: AckResult | null =
      ackStep && "noAck" in ackStep
        ? null
        : refused
          ? { done: true, status: refused.status, ack: { sessionId: null, isThread: null, ok: false, error: { code: refused.code ?? null, message: refused.message } }, reset: null }
          : { done: true, status: 200, ack: { sessionId, isThread: true, ok: true, error: null }, reset: null };
    this.acks.set(id, { sessionId, readyAt: now + (this.cfg.ackDelayMs ?? 5), result });
    return id;
  }

  async ack(stream: number): Promise<AckResult> {
    const a = this.acks.get(stream);
    if (!a) return { done: true, status: null, ack: null, reset: { code: -4, reason: "unknown stream" } };
    if (!a.result || Date.now() < a.readyAt) return { done: false, status: null, ack: null, reset: null };
    this.acks.delete(stream);
    return a.result;
  }

  async subscribe(sessionId: string): Promise<void> {
    if (!this.open) throw new ChannelError("closed", "stream_lost");
    this.subscribed.add(sessionId);
  }

  async poll(): Promise<PollResult> {
    this.dead();
    const drop = this.take("poll");
    if (drop) {
      this.open = false;
      this.subscribed.clear();
      this.closedCount++;
    }
    const now = Date.now();
    if (this.open && this.cfg.emitCompleted !== false) {
      for (const sid of this.subscribed) {
        const conv = FakeHttpChannel.sessions.get(sid);
        for (const t of conv?.turns ?? []) {
          if (!t.announced && now >= t.doneAt) {
            t.announced = true;
            if (t.reply.filesOnly) continue; // no live completion event either: only history + the conversation list
            if (t.reply.files?.length && !t.reply.filesLateMs) this.queue.push({ sess: sid, seq: null, kind: "files", files: t.reply.files.map((f, i) => this.fileRef(sid, conv!.turns.indexOf(t), i, f)), at: now });
            this.queue.push({ sess: sid, seq: null, kind: "status", status: t.reply.status ?? "completed", at: now });
          }
        }
      }
    }
    const events = this.queue.splice(0);
    return { next: 0, dropped: 0, events, open: this.open };
  }

  private fileRef(sid: string, turn: number, i: number, f: { name: string; mime: string; bytes: Uint8Array; declaredBytes?: number | null }): GwFile {
    return { path: `/workspace/${sid.slice(0, 8)}/t${turn}/${i}-${f.name}`, mime: f.mime, byteLen: f.declaredBytes === undefined ? f.bytes.length : f.declaredBytes, name: f.name };
  }

  async history(sessionId: string): Promise<GwHistory> {
    const step = this.take("history");
    if (step) throw new ChannelError(`fake history ${step.error}`, step.error);
    if (this.dead() || !this.open) throw new ChannelError("closed", "stream_lost");
    const conv = FakeHttpChannel.sessions.get(sessionId);
    if (!conv) return { turns: [], userMsgs: 0, unknownShape: false };
    const now = Date.now();
    const turns: GwTurn[] = conv.turns.map((t, idx) => {
      const done = now >= t.doneAt;
      const early = !!t.reply.early && now >= t.at + (t.reply.early.fromMs ?? 0);
      return {
        user: { text: museUserText(t.user, t.items), prompt: t.user, atMs: t.at },
        assistant:
          done && t.reply.text !== undefined && !t.reply.filesOnly
            ? { text: t.reply.text, ready: true, final: true, updatedAtMs: t.doneAt }
            : done
              ? null
              : early
                ? { text: t.reply.early!.text, ready: true, final: false, updatedAtMs: t.at + (t.reply.early!.fromMs ?? 0) }
                : { text: "", ready: false, final: false, updatedAtMs: null },
        // Real history carries no task status: a streaming turn only differs by its message status (R94). A files-only
        // reply (live 01/11) has neither an answer message nor a status once done.
        status: done ? (t.reply.filesOnly ? null : (t.reply.status ?? "completed")) : early ? null : "running",
        files: done && now >= t.doneAt + (t.reply.filesLateMs ?? 0) ? (t.reply.files ?? []).map((f, i) => this.fileRef(sessionId, idx, i, f)) : [],
      };
    });
    return { turns, userMsgs: turns.length, unknownShape: false };
  }

  /** Muse's conversation list: "running" until the last turn is done, then its status; Muse stores seconds. */
  async sessionState(sessionId: string): Promise<GwSessionState | null> {
    const step = this.take("sessions");
    if (step) throw new ChannelError(`fake sessions ${step.error}`, step.error);
    if (this.dead() || !this.open) throw new ChannelError("closed", "stream_lost");
    const conv = FakeHttpChannel.sessions.get(sessionId);
    const last = conv?.turns[conv.turns.length - 1];
    if (!last) return null;
    const done = Date.now() >= last.doneAt;
    return { status: done ? (last.reply.status ?? "completed") : "running", updatedAtMs: Math.floor((done ? last.doneAt : last.at) / 1000) * 1000 };
  }

  async fetchFile(path: string, maxBytes: number): Promise<{ data: Uint8Array; contentType: string | null }> {
    const step = this.take("fetch");
    if (step) throw new ChannelError(`fake fetch ${step.error}`, step.error);
    const m = /^\/workspace\/([0-9a-f-]{8})\/t(\d+)\/(\d+)-/.exec(path);
    if (!m) throw new ChannelError("not found", "fetch_failed", 404);
    for (const [sid, conv] of FakeHttpChannel.sessions) {
      if (!sid.startsWith(m[1])) continue;
      const f = conv.turns[Number(m[2])]?.reply.files?.[Number(m[3])];
      if (!f) break;
      if (f.bytes.length > maxBytes) throw new ChannelError("too large", "fetch_failed");
      return { data: f.bytes, contentType: f.mime };
    }
    throw new ChannelError("not found", "fetch_failed", 404);
  }

  async probe(): Promise<{ ok: boolean; reason: ChannelError["reason"] | null; message: string }> {
    const step = this.take("probe");
    if (step) return { ok: false, reason: step.error, message: `fake probe ${step.error}` };
    this.open = true;
    return { ok: true, reason: null, message: "" };
  }

  /** Last close asked to unload the page at once (R94: only removal/anomaly do). */
  lastCloseUnloaded: boolean | null = null;
  close(opts: { unloadPage?: boolean } = {}): void {
    this.open = false;
    this.subscribed.clear();
    this.closedCount++;
    this.lastCloseUnloaded = !!opts.unloadPage;
  }
}

/** Muse's stored copy of a user message: one marker line per attachment before the text (live 01/11). */
export function museUserText(prompt: string, items: SendItem[]): string {
  const marks = items.flatMap((i) => {
    if (i.type === "image") return [`[image:${i.mime_type} workspace/user/media_library/image/${i.filename}]`];
    if (i.type === "file") return [`[file:${i.mime_type} workspace/user/files/${i.filename}]`];
    if (i.type === "file_ref") return [`[file:${i.mime_type} ${i.path}]`];
    return [];
  });
  return marks.length ? `${marks.join("\n")}\n${prompt}` : prompt;
}
