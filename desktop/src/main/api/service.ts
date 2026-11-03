import { randomUUID } from "node:crypto";
import { BRAND } from "../../shared/brand";
import fs from "node:fs";
import { enabledCapabilities } from "../../shared/capabilities";
import {
  API_BUCKETS,
  API_CHAT_JSON_MAX_BYTES,
  API_JSON_MAX_BYTES,
  API_LIST_DEFAULT,
  API_SIGNED_URL_TTL_S,
  API_UNFINISHED_PER_KEY,
  API_UPLOAD_MAX_BYTES,
  API_WAIT_MAX_S,
  API_WAITS_PER_KEY,
  API_WAITS_TOTAL,
} from "../../shared/api/constants";
import { apiStatus, chainSettled, isSettled, statesFor, toApiChain, toApiJob, toApiOutput, type ApiChain, type ApiJob, type ApiJobStatus, type ApiOutput } from "../../shared/api/jobView";
import { MUSE_EXTEND_MAX_STEPS, museExtendEligibility } from "../../shared/museExtend";
import { ApiError } from "../../shared/api/problem";
import { chatCreateSchema, createJobSchema, extendSchema, normaliseChat, normaliseCreate, normaliseExtend, parseOrThrow, type NormalisedExtend } from "../../shared/api/schemas";
import { CHAT_ATTACH_MAX, CHAT_PROMPT_MAX, claimsDocument, extOf } from "../../shared/chat";
import type { AccountExecution } from "../../shared/execution";
import { capKey } from "../../shared/scheduler";
import { vibesStatus } from "../../shared/vibes";
import { quotaView } from "../../shared/quota";
import { downloadSignature, fingerprint, verifyDownloadSignature } from "../../shared/api/signing";
import { REF_MIMES } from "../../shared/constants";
import { TERMINAL } from "../../shared/jobMachine";
import type { Account, AccountState, ApiScope, Asset, CapabilityKey, ExtendChain, VibesStatus } from "../../shared/types";
import { sniffMediaMime, validatePrompt } from "../../shared/validate";
import { CommandError, type Coordinator } from "../coordinator";
import type { JobRow, Repo } from "../repo";
import type { Services } from "../services";
import type { ApiStore } from "./store";
import { apiLocale } from "./requestLocale";

// The operations behind REST and MCP (spec §4.8). Everything goes through the same Coordinator/Services
// as the Studio UI (R25, AGENTS.md: one authoritative source per record).

const iso = (t: number | null | undefined) => (typeof t === "number" && t > 0 ? new Date(t).toISOString() : null);

/**
 * R76 — one account as an agent sees it: the alias it can pass as `account`, its group, and the stored Usage snapshot
 * (as Muse shows it; never a read, never identity/proxy/raw errors).
 */
export function accountItem(a: Account, now: number, exec?: AccountExecution | null) {
  const v = quotaView(a.quota, now);
  const q = v.known ? a.quota! : null;
  const add = q?.additional ?? null;
  return {
    alias: a.alias,
    group: ACCOUNT_GROUP[a.state],
    waiting_until: a.state === "limit_reached" || a.state === "cooling_down" ? iso(a.stateUntil) : null,
    quota: {
      plan: q?.plan ?? null,
      weekly_used_percent: v.weeklyUsed,
      weekly_resets_label: q?.resetsOn ?? null,
      weekly_resets_at: iso(q?.resetAt ?? null),
      additional_remaining_label: add?.remainingLabel ?? null,
      additional_used_percent: add?.usedPercent ?? null,
      additional_expiry_label: add?.expiryLabel ?? null,
      observed_at: iso(q?.readAt ?? null),
      stale: v.stale,
      tier: v.tier,
    },
    // Build 2.0 R109 — how this account sends now (no proxy, identity or raw error text).
    ...(exec
      ? {
          execution: {
            mode: exec.mode,
            active_path: exec.activePath,
            http_state: exec.httpState,
            reason: exec.reason,
            since: iso(exec.since),
            next_probe_at: iso(exec.nextProbeAt),
            running_http: exec.runningHttp,
            running_ui: exec.runningUi,
            max_concurrent: exec.maxConcurrent,
            ui_max_concurrent: exec.uiMaxConcurrent,
          },
        }
      : {}),
  };
}

export interface KeyCtx {
  id: string;
  name: string;
  scope: ApiScope;
  /** Set when the caller arrived with an OAuth access token instead of an API key (R136). */
  oauth?: boolean;
}

export interface ApiServiceDeps {
  coord: Coordinator;
  services: Services;
  repo: Repo;
  store: ApiStore;
  now: () => number;
  version: string;
  signingSecret: () => Buffer;
  /** Job change events from the coordinator; returns an unsubscribe function. */
  subscribe: (fn: (job: JobRow) => void) => () => void;
}

const ACCOUNT_GROUP: Record<AccountState, "ready" | "busy" | "waiting" | "needs_user" | "paused"> = {
  ready: "ready",
  busy: "busy",
  cooling_down: "waiting",
  limit_reached: "waiting",
  new: "needs_user",
  logging_in: "needs_user",
  needs_login: "needs_user",
  checkpoint: "needs_user",
  proxy_error: "needs_user",
  takeover: "needs_user",
  paused: "paused",
};

const VIBES_GROUP: Record<VibesStatus, "ready" | "waiting" | "needs_user" | "unavailable" | "off"> = {
  ready: "ready",
  limit_reached: "waiting",
  cooling_down: "waiting",
  logged_out: "needs_user",
  logging_in: "needs_user",
  needs_login: "needs_user",
  checkpoint: "needs_user",
  identity_changed: "needs_user",
  restricted: "unavailable",
  off: "off",
};

const CAP_API_NAME: Record<CapabilityKey, string> = {
  "image.text": "image_from_text",
  "image.reference": "image_edit",
  "video.text": "video_from_text",
  "video.reference": "video_from_image",
  "vibes.video.text": "vibes.video.text",
  "vibes.video.reference": "vibes.video.reference",
  "vibes.video.extend": "vibes.video.extend",
  "muse.video.extend": "muse.video.extend",
  "chat.text": "chat",
};

export class ApiService {
  private waitsByKey = new Map<string, number>();
  private waitsTotal = 0;

  constructor(private d: ApiServiceDeps) {}

  requireScope(ctx: KeyCtx, scope: ApiScope): void {
    if (scope === "generate" && ctx.scope !== "generate") throw new ApiError(403, "insufficient_scope", "Khoá này chỉ có quyền xem — tạo khoá “Tạo và huỷ” để gửi lượt");
  }

  // ---------------------------------------------------------------- status
  status(ctx: KeyCtx) {
    const accounts = this.d.repo.listAccounts();
    const caps = enabledCapabilities(accounts, this.d.coord.verified());
    const groups = { ready: 0, busy: 0, waiting: 0, needs_user: 0, paused: 0 };
    for (const a of accounts) groups[ACCOUNT_GROUP[a.state]]++;
    const vibes = { ready: 0, waiting: 0, needs_user: 0, unavailable: 0, off: 0 };
    for (const a of accounts) vibes[VIBES_GROUP[vibesStatus(a.vibes)]]++;
    const execs = this.d.coord.executionViews();
    const br = this.d.coord.engineStatus().bridge;
    return {
      service: BRAND.id,
      version: this.d.version,
      capabilities: Object.fromEntries((Object.keys(caps) as CapabilityKey[]).map((k) => [CAP_API_NAME[k], caps[k]])),
      accounts: { total: accounts.length, ...groups, items: accounts.map((a) => accountItem(a, this.d.now(), execs.get(a.id) ?? null)) },
      // Build 2.0 R97/R109 — the direct channel app-wide (never tokens or Muse ids).
      bridge: { http_enabled: br?.httpEnabled ?? false, http_compat: br?.compat ?? "unknown", last_check_at: iso(br?.lastCheckAt ?? null), last_check_ok: br?.lastCheckOk ?? null },
      // R53 (7): Vibes side of the same accounts — logging in and switching Vibes happen only in the app (R26).
      ...(this.d.coord.supportsVibes() ? { sites: { vibes: { total: accounts.length, ...vibes } } } : {}),
      key: { name: ctx.name, scope: ctx.scope, unfinished_jobs: this.d.store.countUnfinished(ctx.id) },
      limits: {
        create_per_minute: API_BUCKETS.create.perMinute,
        create_burst: API_BUCKETS.create.capacity,
        read_per_minute: API_BUCKETS.read.perMinute,
        upload_per_minute: API_BUCKETS.upload.perMinute,
        unfinished_jobs_per_key: API_UNFINISHED_PER_KEY,
        wait_max_seconds: API_WAIT_MAX_S,
        json_body_max_bytes: API_JSON_MAX_BYTES,
        upload_max_bytes: API_UPLOAD_MAX_BYTES,
        prompt_max_chars: 4000,
        repeat_max: 4,
        chat_prompt_max_chars: CHAT_PROMPT_MAX,
        chat_attachments_max: CHAT_ATTACH_MAX,
        chat_json_body_max_bytes: API_CHAT_JSON_MAX_BYTES,
      },
      // R104 — said wherever an agent reads the account list.
      notes: ["Muse4AI returns exactly what Muse returns and does not verify content.", "Jobs on one Muse account share that account's Muse memory and history; use a separate account (and turn Muse memory off yourself) to keep agents apart."],
    };
  }

  // ---------------------------------------------------------------- create (R25, R27)
  async createJobs(ctx: KeyCtx, raw: unknown, idemKey: string | null, base: string): Promise<{ replayed: boolean; jobs: ApiJob[] }> {
    this.requireScope(ctx, "generate");
    if (raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "chat") return this.createChat(ctx, raw, idemKey, base);
    const n = normaliseCreate(parseOrThrow(createJobSchema, raw));
    const fp = fingerprint(n);
    const crid = `api:${ctx.id}:${idemKey ?? randomUUID()}`;
    if (idemKey) {
      const replay = this.replay(crid, fp, base, ctx);
      if (replay) return { replayed: true, jobs: replay };
    }
    const p = validatePrompt(n.prompt);
    if (!p.ok) throw new ApiError(400, "invalid_request", p.reason, { errors: [{ path: "prompt", message: p.reason }] });
    if (this.d.store.countUnfinished(ctx.id) + n.repeat > API_UNFINISHED_PER_KEY) {
      throw new ApiError(429, "queue_full", `Khoá này đã có ${API_UNFINISHED_PER_KEY} lượt chưa xong — chờ bớt rồi gửi tiếp`, { retryAfterS: 60 });
    }
    const accounts = this.d.repo.listAccounts();
    const accountPref = this.resolveAccount(n.account, accounts);
    const site = n.site ?? "muse";
    if (site === "vibes" && !this.d.coord.supportsVibes()) throw new ApiError(400, "capability_unavailable", "Vibes đã được bỏ khỏi Muse4AI");
    if (site === "vibes" && n.kind !== "video") throw new ApiError(400, "capability_unavailable", "Vibes chỉ tạo video — dùng kind \"video\" hoặc bỏ site");
    const caps = enabledCapabilities(accounts, this.d.coord.verified());
    if (!caps[capKey(n.kind, n.mode, site)]) {
      throw new ApiError(400, "capability_unavailable", site === "vibes" ? "Tạo trên Vibes chưa được bật trên phiên bản Muse4AI này (xem /v1/status → capabilities)" : "Kiểu tạo này đang khoá trên Muse4AI (xem /v1/status → capabilities)");
    }
    let refIds: string[] = [];
    const missing = (path: string) => new ApiError(400, "invalid_request", "Không có ảnh tham chiếu này — tải lên lại qua POST /v1/references", { errors: [{ path, message: "không tồn tại" }] });
    if (n.reference_ids?.length) {
      for (const id of n.reference_ids) if (!this.d.repo.getRef(id)) throw missing("reference_ids");
      refIds = n.reference_ids;
    } else if (n.reference_id) {
      if (!this.d.repo.getRef(n.reference_id)) throw missing("reference_id");
      refIds = [n.reference_id];
    } else if (n.reference_asset_id) {
      refIds = [(await this.referenceFromOwnAsset(ctx, n.reference_asset_id)).id];
    }
    let ids: string[];
    try {
      ids = this.d.coord.createJobs({
        kind: n.kind,
        mode: n.mode,
        prompt: n.prompt,
        referenceIds: refIds,
        accountPref,
        repeat: n.repeat,
        clientRequestId: crid,
        api: { keyId: ctx.id, fingerprint: fp },
        site,
      });
    } catch (e) {
      if (e instanceof CommandError) throw new ApiError(400, e.code === "capability" ? "capability_unavailable" : "invalid_request", e.message);
      throw e;
    }
    const jobs = ids.map((id) => this.d.repo.getJob(id)!);
    // A concurrent request with the same key may have won the race inside createJobs (it dedupes by clientRequestId).
    if (jobs.some((j) => j.apiKeyId !== ctx.id || j.apiFingerprint !== fp)) throw this.conflict();
    const views = jobs.map((j) => this.view(j, base, ctx.id));
    // R27: a retry gets exactly this body back, even after the jobs moved on (INSERT OR IGNORE: the first writer wins a race).
    if (idemKey) this.d.store.saveReply(crid, JSON.stringify(views), this.d.now());
    return { replayed: false, jobs: views };
  }

  /** Build 2.0 R81/R109 — one Hỏi đáp job (same queue, idempotency and limits as image/video). */
  private createChat(ctx: KeyCtx, raw: unknown, idemKey: string | null, base: string): { replayed: boolean; jobs: ApiJob[] } {
    const att = (raw as { attachments?: unknown }).attachments;
    // R82/AC-CHAT-02: too many attachments is attachment_limit, not a generic schema error.
    if (Array.isArray(att) && att.length > CHAT_ATTACH_MAX) throw new ApiError(400, "attachment_limit", `Tối đa ${CHAT_ATTACH_MAX} tệp đính kèm`);
    const n = normaliseChat(parseOrThrow(chatCreateSchema, raw));
    const fp = fingerprint(n);
    const crid = `api:${ctx.id}:${idemKey ?? randomUUID()}`;
    if (idemKey) {
      const replay = this.replay(crid, fp, base, ctx);
      if (replay) return { replayed: true, jobs: replay };
    }
    if (this.d.store.countUnfinished(ctx.id) + 1 > API_UNFINISHED_PER_KEY) {
      throw new ApiError(429, "queue_full", `Khoá này đã có ${API_UNFINISHED_PER_KEY} lượt chưa xong — chờ bớt rồi gửi tiếp`, { retryAfterS: 60 });
    }
    const accountPref = this.resolveAccount(n.account, this.d.repo.listAccounts());
    for (const id of n.attachments) {
      if (!this.d.repo.getRef(id)) throw new ApiError(400, "invalid_request", "Không có tệp đính kèm này — tải lên lại qua POST /v1/references", { errors: [{ path: "attachments", message: "không tồn tại" }] });
    }
    if (n.conversation_id && this.d.repo.conversationMeta(n.conversation_id)?.kind === "media") {
      // A video conversation from the UI path (its handle came with this key's video): same 404 when it is not this
      // key's; busy while an extend chain holds it (AC-CHAT-09); otherwise Hỏi đáp cannot continue it on this build.
      const { row } = this.ownConversation(ctx, n.conversation_id);
      if (row.chain || row.unresolved) throw new ApiError(409, "conversation_busy", "Hội thoại này đang có chuỗi kéo dài hoặc lượt chưa đối soát — chờ xong rồi gửi tiếp");
      throw new ApiError(422, "capability_unavailable", "Hội thoại video này tạo qua giao diện Muse — bản này chưa hỏi tiếp được bằng Hỏi đáp");
    }
    let id: string;
    try {
      id = this.d.coord.createChatJob({ prompt: n.prompt, referenceIds: n.attachments, accountPref, clientRequestId: crid, conversationId: n.conversation_id, api: { keyId: ctx.id, fingerprint: fp } });
    } catch (e) {
      if (e instanceof CommandError) throw chatError(e);
      throw e;
    }
    const job = this.d.repo.getJob(id)!;
    if (job.apiKeyId !== ctx.id || job.apiFingerprint !== fp) throw this.conflict();
    const views = [this.view(job, base, ctx.id)];
    if (idemKey) this.d.store.saveReply(crid, JSON.stringify(views), this.d.now());
    return { replayed: false, jobs: views };
  }

  private replay(crid: string, fp: string, base: string, ctx: KeyCtx): ApiJob[] | null {
    const existing = this.d.repo.jobsByClientRequest(crid);
    if (!existing.length) return null;
    if (existing.some((j) => j.apiFingerprint !== fp)) throw this.conflict();
    const saved = this.d.store.getReply(crid);
    if (saved) {
      try {
        return JSON.parse(saved) as ApiJob[];
      } catch {
        /* fall through to the current view */
      }
    }
    return existing.map((j) => this.view(j, base, ctx.id));
  }

  /** An identical reference image already stored (references are de-duplicated by SHA-256), so retries need no upload. */
  referenceIdBySha(sha256: string): string | null {
    return this.d.repo.findRefBySha(sha256)?.id ?? null;
  }

  private conflict(): ApiError {
    return new ApiError(422, "idempotency_conflict", "Idempotency-Key này đã dùng cho một yêu cầu khác — dùng khoá mới cho nội dung mới");
  }

  private resolveAccount(alias: string, accounts: Account[]): string {
    if (alias.toLowerCase() === "auto") return "auto";
    const want = alias.trim().toLocaleLowerCase("vi");
    const a = accounts.find((x) => x.alias.toLocaleLowerCase("vi") === want);
    if (!a) throw new ApiError(400, "invalid_request", `Không có tài khoản tên “${alias}” — dùng "auto" hoặc đúng tên gọi trong app`, { errors: [{ path: "account", message: "không tồn tại" }] });
    return a.id;
  }

  private async referenceFromOwnAsset(ctx: KeyCtx, assetId: string) {
    const a = this.d.repo.getAsset(assetId);
    if (!a || this.d.store.assetOwner(assetId) !== ctx.id) throw new ApiError(400, "invalid_request", "Không tìm thấy tác phẩm này trong các lượt của khoá", { errors: [{ path: "reference_asset_id", message: "không tồn tại" }] });
    if (a.trashedAt || a.missing) throw new ApiError(410, "asset_gone", "Tác phẩm này đã bị xoá hoặc di chuyển trên máy");
    try {
      return await this.d.services.referenceFromAsset(assetId);
    } catch (e) {
      if (e instanceof CommandError) throw new ApiError(400, "invalid_request", e.message);
      throw e;
    }
  }

  // ---------------------------------------------------------------- read
  private own(ctx: KeyCtx, jobId: string): JobRow {
    const j = this.d.repo.getJob(jobId);
    if (!j || j.apiKeyId !== ctx.id) throw new ApiError(404, "not_found", "Không có lượt này trong các lượt của khoá");
    return j;
  }

  async getJob(ctx: KeyCtx, jobId: string, opts: { waitS: number; afterVersion: number | null; base: string; until?: "change" | "settled"; signal?: AbortSignal }): Promise<ApiJob> {
    let j = this.own(ctx, jobId);
    if (opts.waitS > 0) {
      const start = j;
      const done =
        opts.until === "settled"
          ? (x: JobRow) => isSettled(x.state)
          : opts.afterVersion !== null
            ? (x: JobRow) => x.rev > opts.afterVersion! || isSettled(x.state)
            : (x: JobRow) => x.state !== start.state || isSettled(x.state);
      if (!done(start)) j = await this.waitFor(ctx, jobId, opts.waitS, done, opts.signal);
    }
    return this.view(j, opts.base, ctx.id);
  }

  /** Resolves with the newest job row once `done(row)` holds, or after `seconds` with the current row (R28 wait). */
  private waitFor(ctx: KeyCtx, jobId: string, seconds: number, done: (j: JobRow) => boolean, signal?: AbortSignal): Promise<JobRow> {
    return this.waitUntil(ctx, seconds, () => this.d.repo.getJob(jobId)!, done, (row) => row.id === jobId, signal);
  }

  /**
   * R28 long-poll: resolves with `read()` once `done` holds (re-checked on every matching job event, after the event's
   * transaction has finished), or after `seconds`. Counts against the per-key / total wait limits.
   */
  private waitUntil<T>(ctx: KeyCtx, seconds: number, read: () => T, done: (t: T) => boolean, matches: (row: JobRow) => boolean, signal?: AbortSignal): Promise<T> {
    const mine = this.waitsByKey.get(ctx.id) ?? 0;
    if (mine >= API_WAITS_PER_KEY || this.waitsTotal >= API_WAITS_TOTAL) {
      throw new ApiError(429, "too_many_waits", `Tối đa ${API_WAITS_PER_KEY} lần chờ đồng thời mỗi khoá — gọi lại sau`, { retryAfterS: 2 });
    }
    // The caller may already be gone (client disconnected while we read): answer without holding a wait slot.
    if (signal?.aborted) return Promise.resolve(read());
    this.waitsByKey.set(ctx.id, mine + 1);
    this.waitsTotal++;
    return new Promise<T>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener("abort", finish);
        const left = (this.waitsByKey.get(ctx.id) ?? 1) - 1;
        if (left <= 0) this.waitsByKey.delete(ctx.id);
        else this.waitsByKey.set(ctx.id, left);
        this.waitsTotal--;
        resolve(read());
      };
      const check = () => {
        if (!finished && done(read())) finish();
      };
      const unsubscribe = this.d.subscribe((row) => {
        if (row && matches(row)) setImmediate(check);
      });
      const timer = setTimeout(finish, seconds * 1000);
      signal?.addEventListener("abort", finish, { once: true });
      // The record may have changed between the first read and subscribing.
      check();
    });
  }

  waitsInFlight(): number {
    return this.waitsTotal;
  }

  listJobs(ctx: KeyCtx, opts: { status: ApiJobStatus | null; limit: number | null; cursor: string | null; base: string }) {
    let cursor: number | null = null;
    if (opts.cursor) {
      if (!/^\d{1,15}$/.test(opts.cursor)) throw new ApiError(400, "invalid_request", "`cursor` không hợp lệ — dùng đúng `next_cursor` của trang trước", { errors: [{ path: "cursor", message: "sai định dạng" }] });
      cursor = Number(opts.cursor);
    }
    const page = this.d.store.jobIdsPage(ctx.id, opts.status ? statesFor(opts.status) : null, cursor, opts.limit ?? API_LIST_DEFAULT);
    return {
      jobs: page.ids.map((id) => this.view(this.d.repo.getJob(id)!, opts.base, ctx.id)),
      next_cursor: page.nextCursor === null ? null : String(page.nextCursor),
    };
  }

  // ---------------------------------------------------------------- Kéo dài (R53, rev 7.1 R65)
  /** POST /v1/assets/{id}/extend — same checks as the app (startExtend), scoped to this key's own outputs (R26). */
  extend(ctx: KeyCtx, assetId: string, raw: unknown, idemKey: string | null, base: string): { replayed: boolean; chain: ApiChain; jobs: ApiJob[] } {
    this.requireScope(ctx, "generate");
    const body = parseOrThrow(extendSchema, raw ?? {});
    // Muse sources have their own step cap (R55); a foreign/unknown asset gets the default so nothing about it leaks.
    const own = this.d.store.assetOwner(assetId) === ctx.id ? this.d.repo.getAsset(assetId) : null;
    const n = normaliseExtend(assetId, body, own?.site === "muse" ? MUSE_EXTEND_MAX_STEPS : this.d.coord.settings().extendMaxSteps);
    const fp = fingerprint(n);
    const crid = `api:${ctx.id}:${idemKey ?? randomUUID()}`;
    const replay = idemKey ? this.replayChain(crid, fp, base, ctx) : null;
    if (replay) return replay;
    if (!own) throw new ApiError(404, "not_found", "Không có tác phẩm này trong các lượt của khoá");
    return this.startChain(ctx, assetId, n, fp, crid, idemKey, base);
  }

  /**
   * POST /v1/conversations/{id}/extend — continue the CURRENT confirmed head of one of this key's Muse conversations.
   * Possessing the id is not authorization: the key must own the head video; unknown, other keys' and Studio-owned
   * conversations are the same 404. The replay lookup runs before the head is resolved, so a retry after the head
   * moved on still returns the original chain (R27).
   */
  extendConversation(ctx: KeyCtx, conversationId: string, raw: unknown, idemKey: string | null, base: string): { replayed: boolean; chain: ApiChain; jobs: ApiJob[] } {
    this.requireScope(ctx, "generate");
    const body = parseOrThrow(extendSchema, raw ?? {});
    const plan = normaliseExtend("", body, MUSE_EXTEND_MAX_STEPS);
    const n = { conversation_id: conversationId, mode: plan.mode, directive: plan.directive, plan: plan.plan };
    const fp = fingerprint(n);
    const crid = `api:${ctx.id}:${idemKey ?? randomUUID()}`;
    const replay = idemKey ? this.replayChain(crid, fp, base, ctx) : null;
    if (replay) return replay;
    const { row, tip } = this.ownConversation(ctx, conversationId);
    if (row.unresolved || row.chain) throw new ApiError(409, "conversation_busy", "Hội thoại này đang có chuỗi kéo dài hoặc lượt chưa đối soát — chờ xong rồi gửi tiếp");
    return this.startChain(ctx, tip.id, plan, fp, crid, idemKey, base);
  }

  /**
   * GET /v1/conversations/{id} for a Hỏi đáp conversation (R109): this key's turns in order; foreign → same 404.
   * An HTTP video conversation also lists the extend steps sent into it and, when its head video is this key's,
   * that video and whether it can be extended now — so one handle tells an agent both "ask on" and "extend".
   */
  chatConversation(ctx: KeyCtx, conversationId: string, base: string) {
    const meta = this.d.repo.conversationMeta(conversationId);
    const row = this.d.repo.museConversationById(conversationId);
    if (!meta || !row || meta.kind !== "chat" || meta.ownerApiKeyId !== ctx.id) throw new ApiError(404, "not_found", "Không có hội thoại này trong các lượt của khoá");
    const turns = [...this.d.repo.jobsForConversation(conversationId), ...this.d.repo.extendJobsForConversation(row.accountId, row.conversation)]
      .filter((j, i, all) => j.apiKeyId === ctx.id && all.findIndex((x) => x.id === j.id) === i)
      .sort((x, y) => x.seq - y.seq);
    const tip = row.tip ? this.d.repo.getAsset(row.tip) : null;
    const video = tip && tip.site === "muse" && tip.kind === "video" && this.d.store.assetOwner(tip.id) === ctx.id ? this.videoHead(ctx, row, tip, base) : null;
    return {
      conversation_id: row.id,
      account: this.d.repo.getAccount(row.accountId)?.alias ?? null,
      kind: "chat" as const,
      // A chat turn, an extend chain or an unresolved step all keep the next send waiting (409 conversation_busy).
      busy: !!meta.busyJobId || !!row.chain || !!row.unresolved,
      turns: turns.map((j) => ({ job_id: j.id, operation: j.operation === "extend" ? ("extend" as const) : j.kind === "chat" ? ("chat" as const) : ("generate" as const), status: apiStatus(j.state), created_at: iso(j.createdAt) })),
      video,
    };
  }

  /** Chat conversations answer with their turns; Muse video conversations with their head (R65). */
  conversation(ctx: KeyCtx, conversationId: string, base: string) {
    return this.d.repo.conversationMeta(conversationId)?.kind === "chat" ? this.chatConversation(ctx, conversationId, base) : this.getConversation(ctx, conversationId, base);
  }

  /** GET /v1/conversations/{id} — the head video and whether it can be continued now (same ownership rule). */
  getConversation(ctx: KeyCtx, conversationId: string, base: string): { conversation_id: string; site: "muse" } & ReturnType<ApiService["videoHead"]> {
    const { row, tip } = this.ownConversation(ctx, conversationId);
    return { conversation_id: row.id, site: "muse", ...this.videoHead(ctx, row, tip, base) };
  }

  /** The head video of a Muse conversation this key owns, and whether (and why not) it can be extended right now. */
  private videoHead(ctx: KeyCtx, row: { chain: string | null; unresolved: string | null }, tip: Asset, base: string): {
    status: "ready" | "busy" | "needs_review";
    can_extend: boolean;
    reason: string | null;
    active_chain_id: string | null;
    latest_output: ApiOutput;
  } {
    const chain = row.chain ? this.d.repo.getChain(row.chain) : null;
    const pending = row.unresolved ? this.d.repo.getJob(row.unresolved) : null;
    const owner = tip.sourceOwnerId ? this.d.repo.getAccount(tip.sourceOwnerId) : null;
    const info = museExtendEligibility(tip, owner, !!this.d.coord.verified()["muse.video.extend"], { httpOn: this.d.coord.extendHttpOn() });
    const status = pending?.state === "needs_review" ? "needs_review" : row.unresolved || row.chain ? "busy" : "ready";
    const busyReason = status === "needs_review" ? "Một lần kéo dài đang chờ người dùng xem trong Muse4AI" : status === "busy" ? "Đang có chuỗi kéo dài trong hội thoại này" : null;
    return {
      status,
      can_extend: status === "ready" && !!info?.ok,
      reason: busyReason ?? (info?.ok ? info.waitNote : (info?.reason ?? "Không kéo dài được video này")),
      active_chain_id: chain && chain.apiKeyId === ctx.id ? chain.id : null,
      latest_output: toApiOutput(tip, (a) => this.link(base, a, ctx.id), (a) => this.conversationOf(a)),
    };
  }

  private ownConversation(ctx: KeyCtx, conversationId: string) {
    const notFound = () => new ApiError(404, "not_found", "Không có hội thoại này trong các lượt của khoá");
    const row = this.d.repo.museConversationById(conversationId);
    const tip = row?.tip ? this.d.repo.getAsset(row.tip) : null;
    if (!row || !tip || tip.site !== "muse" || this.d.store.assetOwner(tip.id) !== ctx.id) throw notFound();
    return { row, tip };
  }

  private conversationOf(a: Asset): string | null {
    return a.site === "muse" && a.kind === "video" ? this.d.repo.museConversationIdForAsset(a.id) : null;
  }

  private replayChain(crid: string, fp: string, base: string, ctx: KeyCtx): { replayed: boolean; chain: ApiChain; jobs: ApiJob[] } | null {
    const existing = this.d.repo.chainByClientRequest(crid);
    if (!existing) return null;
    if (existing.apiFingerprint !== fp) throw this.conflict();
    const saved = this.d.store.getReply(crid);
    if (saved) {
      try {
        return { replayed: true, ...(JSON.parse(saved) as { chain: ApiChain; jobs: ApiJob[] }) };
      } catch {
        /* fall through to the current view */
      }
    }
    return { replayed: true, chain: this.chainView(existing.id, base, ctx.id), jobs: this.d.repo.jobsForChain(existing.id).slice(0, 1).map((j) => this.view(j, base, ctx.id)) };
  }

  private startChain(ctx: KeyCtx, assetId: string, n: Pick<NormalisedExtend, "mode" | "directive" | "plan">, fp: string, crid: string, idemKey: string | null, base: string): { replayed: boolean; chain: ApiChain; jobs: ApiJob[] } {
    if (this.d.store.countUnfinished(ctx.id) + 1 > API_UNFINISHED_PER_KEY) {
      throw new ApiError(429, "queue_full", `Khoá này đã có ${API_UNFINISHED_PER_KEY} lượt chưa xong — chờ bớt rồi gửi tiếp`, { retryAfterS: 60 });
    }
    let r: ReturnType<Coordinator["startExtend"]>;
    try {
      r = this.d.coord.startExtend({ assetId, mode: n.mode, directive: n.directive, plan: n.plan, clientRequestId: crid, api: { keyId: ctx.id, fingerprint: fp } });
    } catch (e) {
      if (e instanceof CommandError) {
        if (e.code === "not_found") throw new ApiError(404, "not_found", e.message);
        if (e.code === "not_extendable") throw new ApiError(409, "source_not_extendable", e.message);
        if (e.code === "conversation_busy") throw new ApiError(409, "conversation_busy", e.message);
        if (e.code === "capability") throw new ApiError(422, "capability_unavailable", e.message);
        throw new ApiError(400, "invalid_request", e.message);
      }
      throw e;
    }
    // A concurrent request with the same key may have won the race (startExtend dedupes by clientRequestId).
    if (r.replayed && this.d.repo.getChain(r.chain.id)?.apiFingerprint !== fp) throw this.conflict();
    const out = { chain: this.chainView(r.chain.id, base, ctx.id), jobs: r.jobIds.map((id) => this.view(this.d.repo.getJob(id)!, base, ctx.id)) };
    if (idemKey) this.d.store.saveReply(crid, JSON.stringify(out), this.d.now());
    return { replayed: r.replayed, ...out };
  }

  private ownChain(ctx: KeyCtx, chainId: string) {
    const c = this.d.repo.getChain(chainId);
    if (!c || c.apiKeyId !== ctx.id) throw new ApiError(404, "not_found", "Không có chuỗi kéo dài này trong các lượt của khoá");
    return c;
  }

  /** GET /v1/extend-chains/{id}?wait= — returns as soon as the chain's status or finished steps change (R28). */
  async getChain(ctx: KeyCtx, chainId: string, opts: { waitS: number; base: string; until?: "change" | "settled"; signal?: AbortSignal }): Promise<ApiChain> {
    const row = this.ownChain(ctx, chainId);
    if (opts.waitS > 0) {
      const read = (): ExtendChain => this.d.coord.chainView(this.d.repo.getChain(chainId)!);
      const start = this.d.coord.chainView(row);
      const done =
        opts.until === "settled"
          ? (c: ExtendChain) => chainSettled(c.status)
          : (c: ExtendChain) => chainSettled(c.status) || c.status !== start.status || c.stepsDone !== start.stepsDone;
      if (!done(start)) await this.waitUntil(ctx, opts.waitS, read, done, (j) => j.chainId === chainId, opts.signal);
    }
    return this.chainView(chainId, opts.base, ctx.id);
  }

  /** POST /v1/extend-chains/{id}/cancel — Dừng chuỗi (R47). */
  cancelChain(ctx: KeyCtx, chainId: string, base: string): ApiChain {
    this.requireScope(ctx, "generate");
    this.ownChain(ctx, chainId);
    try {
      this.d.coord.cancelChain(chainId);
    } catch (e) {
      if (e instanceof CommandError) throw new ApiError(409, "chain_not_cancellable", e.message);
      throw e;
    }
    return this.chainView(chainId, base, ctx.id);
  }

  chainView(chainId: string, base: string, keyId: string): ApiChain {
    const d = this.d.coord.chainDetail(chainId);
    const asset = (id: string | null) => (id ? this.d.repo.getAsset(id) : null);
    const conversationId = d.chain.site === "muse" ? this.d.repo.museConversationIdForAsset(d.chain.rootAssetId) : null;
    return toApiChain(
      d.chain,
      d.steps.map((s) => ({ step: s.step, jobId: s.jobId, state: s.state, asset: asset(s.assetId) })),
      d.chain.stepsDone > 0 ? asset(d.chain.lastAssetId) : null,
      (a) => this.link(base, a, keyId),
      conversationId,
      (a) => this.conversationOf(a),
      apiLocale(),
    );
  }

  // ---------------------------------------------------------------- cancel (R9, R26)
  cancel(ctx: KeyCtx, jobId: string, base: string): ApiJob {
    this.requireScope(ctx, "generate");
    const j = this.own(ctx, jobId);
    if (j.state === "needs_review") throw new ApiError(409, "job_not_cancellable", "Lượt đang chờ người dùng xem trong Muse4AI — chỉ xử lý được trong app");
    if (TERMINAL.has(j.state)) throw new ApiError(409, "job_not_cancellable", `Lượt đã kết thúc (${apiStatus(j.state)}) — không huỷ được`);
    try {
      return this.view(this.d.coord.cancelJob(jobId), base, ctx.id);
    } catch (e) {
      if (e instanceof CommandError) throw new ApiError(409, "job_not_cancellable", e.message);
      throw e;
    }
  }

  // ---------------------------------------------------------------- references (R10)
  async uploadReference(ctx: KeyCtx, bytes: Uint8Array, filename: string | null = null) {
    this.requireScope(ctx, "generate");
    const mime = sniffMediaMime(bytes);
    const media = !!mime && ((REF_MIMES as readonly string[]).includes(mime) || mime === "video/mp4");
    try {
      if (media) {
        const r = await this.d.services.addReferenceBytes(bytes, filename ?? "API");
        return { reference_id: r.id, kind: mime === "video/mp4" ? ("video" as const) : ("image" as const), mime: r.mime, filename: filename ? r.name : null, width: r.width, height: r.height, duration_ms: r.durationMs, bytes: r.bytes, sha256: r.sha256 };
      }
      // Build 2.0 R82 — Hỏi đáp documents (CSV/TXT/MD/JSON/PDF); their name is what Muse sees.
      const r = await this.d.services.addChatAttachmentBytes(bytes, filename ?? "tep");
      return { reference_id: r.id, kind: "document" as const, mime: r.mime, filename: r.filename ?? r.name, width: null, height: null, duration_ms: null, bytes: r.bytes, sha256: r.sha256 };
    } catch (e) {
      if (e instanceof CommandError) {
        if (e.code === "unsupported_file") {
          // R82/R109: a file named as a document whose bytes are not one → the new 415 unsupported_attachment; anything
          // else keeps Build 1.0's unsupported_media_type so existing agents see the same code (AC-AGT-09).
          if (claimsDocument(filename)) throw new ApiError(415, "unsupported_attachment", `Tệp “${filename}” không phải ${extOf(filename).toUpperCase()} hợp lệ: ${e.message}`.slice(0, 300));
          throw new ApiError(415, "unsupported_media_type", "Chỉ nhận PNG, JPEG, WEBP, MP4 hoặc tài liệu CSV, TXT, MD, JSON, PDF");
        }
        if (e.code === "attachment_limit") throw new ApiError(413, "upload_too_large", e.message);
        throw new ApiError(400, "invalid_request", e.message);
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- downloads (R26, R32)
  /** Bearer access: the asset must belong to a job of this key. */
  assetForKey(ctx: KeyCtx, assetId: string): Asset {
    if (this.d.store.assetOwner(assetId) !== ctx.id) throw new ApiError(404, "not_found", "Không có tệp này trong các lượt của khoá");
    return this.available(assetId);
  }

  /** Signed-link access (no Authorization header). */
  assetForSignature(assetId: string, q: { exp: string | null; kid: string | null; sig: string | null }): { asset: Asset; keyId: string } {
    const bad = () => new ApiError(403, "download_expired", "Link tải sai hoặc đã hết hạn — gọi lại GET /v1/jobs/{id} để lấy link mới");
    if (!q.exp || !q.kid || !q.sig || !/^\d{1,12}$/.test(q.exp)) throw bad();
    const key = this.d.store.getKey(q.kid);
    if (!key || key.revokedAt !== null) throw bad();
    const ok = verifyDownloadSignature(this.d.signingSecret(), assetId, q.kid, Number(q.exp), q.sig, Math.floor(this.d.now() / 1000), API_SIGNED_URL_TTL_S);
    if (!ok || this.d.store.assetOwner(assetId) !== q.kid) throw bad();
    return { asset: this.available(assetId), keyId: q.kid };
  }

  private available(assetId: string): Asset {
    const a = this.d.repo.getAsset(assetId);
    if (!a) throw new ApiError(404, "not_found", "Không có tệp này");
    if (a.trashedAt || a.missing || !fs.existsSync(a.path)) throw new ApiError(410, "asset_gone", "Tệp đã bị xoá hoặc di chuyển trên máy");
    return a;
  }

  link(base: string, asset: Asset, keyId: string): { url: string; expiresAt: number } {
    const exp = Math.floor(this.d.now() / 1000) + API_SIGNED_URL_TTL_S;
    const sig = downloadSignature(this.d.signingSecret(), asset.id, keyId, exp);
    return { url: `${base}/v1/assets/${encodeURIComponent(asset.id)}/content?exp=${exp}&kid=${encodeURIComponent(keyId)}&sig=${sig}`, expiresAt: exp };
  }

  view(j: JobRow, base: string, keyId: string): ApiJob {
    const alias = j.accountId ? (this.d.repo.getAccount(j.accountId)?.alias ?? null) : null;
    return toApiJob(j, this.d.repo.assetsForJob(j.id), alias, (a) => this.link(base, a, keyId), (a) => this.conversationOf(a), apiLocale());
  }

  async thumbnail(assetId: string): Promise<Buffer | null> {
    const p = await this.d.services.thumbFor(assetId).catch(() => null);
    if (!p) return null;
    try {
      const b = fs.readFileSync(p);
      return b.length <= 512 * 1024 ? b : null;
    } catch {
      return null;
    }
  }
}

/** Coordinator refusals of a chat create → the R109 API codes. */
function chatError(e: CommandError): ApiError {
  switch (e.code) {
    case "attachment_limit":
      return new ApiError(400, "attachment_limit", e.message);
    case "conversation_busy":
      return new ApiError(409, "conversation_busy", e.message);
    case "conversation_account_mismatch":
      return new ApiError(422, "conversation_account_mismatch", e.message);
    case "capability":
      return new ApiError(422, "capability_unavailable", e.message);
    case "not_found":
      return new ApiError(404, "not_found", e.message);
    default:
      return new ApiError(400, "invalid_request", e.message);
  }
}
