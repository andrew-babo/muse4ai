// Build 2.0 — execution paths per account (spec docs/build-2.0/spec.md §3.1, R86–R92, R97–R99). Pure TypeScript.

export type ExecMode = "auto" | "http" | "ui";
export type ExecPath = "http" | "ui";
export type HttpState = "unknown" | "healthy" | "degraded" | "down" | "off";
/** Why HTTP is not the path in use (plain-words label in EXEC_REASON_LABEL). */
export type HttpReason = "connect_failed" | "stream_lost" | "protocol_mismatch" | "fetch_failed" | "no_ack" | "global_off" | "incompatible" | "mode_ui";

/** R98/R99 defaults and ranges (A4: proposed numbers; the user changes them in the app). */
export const EXEC_DEFAULTS = {
  mode: "auto" as ExecMode,
  maxConcurrent: 10,
  uiMaxConcurrent: 2,
  globalConcurrency: 40,
  uiPages: 8,
} as const;
export const MAX_CONCURRENT_RANGE = { min: 1, max: 20 } as const;
export const UI_MAX_RANGE = { min: 1, max: 5 } as const;
export const GLOBAL_CONCURRENCY_RANGE = { min: 1, max: 100 } as const;
export const UI_PAGES_RANGE = { min: 1, max: 8 } as const;

/** R89 — technical failures within this window: 1–2 → degraded, 3 → down. */
export const HTTP_FAIL_WINDOW_MS = 10 * 60_000;
export const HTTP_FAIL_LIMIT = 3;
/** R92 — read-only HTTP probe while down; manual probe ignored when repeated within 30 s. */
export const HTTP_PROBE_EVERY_MS = 15 * 60_000;
export const HTTP_MANUAL_PROBE_GAP_MS = 30_000;
/** R89 — the same protocol mismatch on ≥ 2 accounts within 10 minutes turns HTTP off app-wide. */
export const INCOMPATIBLE_ACCOUNTS = 2;
/** R97 — self-check: 60 s after the first frame and every 6 h, only when no HTTP turn succeeded for 6 h. */
export const SELF_CHECK_FIRST_MS = 60_000;
export const SELF_CHECK_EVERY_MS = 6 * 60 * 60_000;
/** R89(a)(b) reconnect ladder, R89(d) fetch retries, R93/R94 timings. */
export const HTTP_RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000] as const;
export const HTTP_FETCH_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;
export const HTTP_ACK_TIMEOUT_MS = 15_000;
export const HTTP_RECONCILE_READS = 3;
export const HTTP_RECONCILE_SPAN_MS = 120_000;
export const HTTP_RECONCILE_GIVE_UP_MS = 2 * 60 * 60_000;
export const HTTP_STABLE_READ_GAP_MS = 5_000;
/** A media turn that looks finished but shows no image/video yet is re-read this long: Muse posts the media presentation
 * a moment after the final message (live 01/11: 0.3 s, one of 10 images was missed). */
export const HTTP_MEDIA_GRACE_MS = 30_000;
export const HTTP_IDLE_CLOSE_MS = 60_000;
export const HTTP_PAGE_UNLOAD_MS = 5 * 60_000;
/** R101 — pacing between two sends on one account (any path). */
export const SUBMIT_GAP_MIN_MS = 400;
export const SUBMIT_GAP_MAX_MS = 1_200;
/** R99 — an extra UI work page opens only with this much free memory; closes after 60 s idle. */
export const UI_PAGE_MIN_FREE_BYTES = 1.5 * 1024 ** 3;
export const UI_PAGE_IDLE_CLOSE_MS = 60_000;
/** R94 — after Muse accepted: give up waiting (then one history read) per kind. */
export const HTTP_TIMEOUT_MS = { chat: 20 * 60_000, image: 12 * 60_000, video: 25 * 60_000 } as const;

export const EXEC_MODE_LABEL: Record<ExecMode, string> = { auto: "Tự động", http: "Chỉ HTTP", ui: "Chỉ giao diện" };
export const EXEC_MODE_HINT: Record<ExecMode, string> = {
  auto: "Ưu tiên HTTP nhẹ. Lỗi kỹ thuật 3 lần trong 10 phút thì chạy qua giao diện, 15 phút thử lại HTTP. Muse báo bất thường thì tạm dừng, không đổi đường.",
  http: "Nhẹ nhất. HTTP lỗi thì tài khoản ngừng nhận việc, việc tự động sang tài khoản khác.",
  ui: "Điều khiển trang Muse như bản 1.0. Tốn RAM hơn, chạy ít việc cùng lúc.",
};
export const EXEC_PATH_LABEL: Record<ExecPath, string> = { http: "HTTP", ui: "Giao diện" };
export const EXEC_REASON_LABEL: Record<HttpReason, string> = {
  connect_failed: "không kết nối được",
  stream_lost: "mất kết nối",
  protocol_mismatch: "Muse đổi cách trả dữ liệu",
  fetch_failed: "không tải được tệp",
  no_ack: "không nhận được xác nhận gửi",
  global_off: "kênh trực tiếp đã tắt",
  incompatible: "kênh trực tiếp không tương thích",
  mode_ui: "chọn chỉ giao diện",
};
/** Shared-context note (R104), shown in S07e and S02-chat. */
export const SHARED_CONTEXT_NOTE = "Các việc trên cùng tài khoản dùng chung bộ nhớ Muse. Muốn tách dữ liệu giữa agent, dùng tài khoản riêng.";

export function clampInt(v: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

export function inRange(v: unknown, range: { min: number; max: number }): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= range.min && v <= range.max;
}

/** R98 — effective UI cap: never above the account total. */
export function effectiveUiMax(maxConcurrent: number, uiMaxConcurrent: number): number {
  return Math.max(1, Math.min(uiMaxConcurrent, maxConcurrent));
}

// ------------------------------------------------------------------ HTTP health (in memory, R89)
export interface HttpHealth {
  state: HttpState;
  /** Technical failures inside the sliding window. */
  failTimes: number[];
  reason: HttpReason | null;
  /** When `down` started (also `off` because of incompatibility). */
  since: number | null;
  nextProbeAt: number | null;
  lastOkAt: number | null;
  lastManualProbeAt: number | null;
}

export function initialHealth(): HttpHealth {
  return { state: "unknown", failTimes: [], reason: null, since: null, nextProbeAt: null, lastOkAt: null, lastManualProbeAt: null };
}

/** R89 — one technical failure. Returns the new health and whether it just went down. */
export function recordHttpFailure(h: HttpHealth, reason: HttpReason, now: number, opts: { probe?: boolean } = {}): { health: HttpHealth; wentDown: boolean } {
  if (h.state === "down" || h.state === "off") {
    // Already not in use: only a failed probe moves the next probe; a late error of an older job changes nothing.
    if (h.state === "down" && opts.probe) return { health: { ...h, reason, nextProbeAt: now + HTTP_PROBE_EVERY_MS }, wentDown: false };
    return { health: h, wentDown: false };
  }
  const failTimes = [...h.failTimes.filter((t) => now - t < HTTP_FAIL_WINDOW_MS), now];
  if (failTimes.length >= HTTP_FAIL_LIMIT) {
    return { health: { ...h, state: "down", failTimes, reason, since: now, nextProbeAt: now + HTTP_PROBE_EVERY_MS }, wentDown: true };
  }
  return { health: { ...h, state: "degraded", failTimes, reason }, wentDown: false };
}

/** R89 — one success clears the window; a successful probe ends `down`. Never lifts `off` (that is decided app-wide). */
export function recordHttpSuccess(h: HttpHealth, now: number): HttpHealth {
  if (h.state === "off") return { ...h, lastOkAt: now };
  return { ...h, state: "healthy", failTimes: [], reason: null, since: null, nextProbeAt: null, lastOkAt: now };
}

/** Sliding-window expiry: old failures fall out, `degraded` becomes `healthy` again (or `unknown` if never ok). */
export function ageHttpHealth(h: HttpHealth, now: number): HttpHealth {
  if (h.state !== "degraded") return h;
  const failTimes = h.failTimes.filter((t) => now - t < HTTP_FAIL_WINDOW_MS);
  if (failTimes.length === h.failTimes.length) return h;
  if (failTimes.length) return { ...h, failTimes };
  return { ...h, failTimes, state: h.lastOkAt !== null ? "healthy" : "unknown", reason: null };
}

/** HTTP may take new sends. */
export function httpUsable(h: HttpHealth): boolean {
  return h.state === "unknown" || h.state === "healthy" || h.state === "degraded";
}

export function probeDue(h: HttpHealth, now: number): boolean {
  return h.state === "down" && h.nextProbeAt !== null && h.nextProbeAt <= now;
}

/** R92 — a manual probe repeated within 30 s is ignored. */
export function manualProbeAllowed(h: HttpHealth, now: number): boolean {
  return h.lastManualProbeAt === null || now - h.lastManualProbeAt >= HTTP_MANUAL_PROBE_GAP_MS;
}

/** Path for new sends from the account's mode and HTTP usability (§3.1 “Đang dùng”). */
export function activePath(mode: ExecMode, http: boolean): ExecPath | "none" {
  if (mode === "ui") return "ui";
  if (http) return "http";
  return mode === "auto" ? "ui" : "none";
}

/** Accounts whose mode needs HTTP (probes, self-check, “Kiểm ngay”). */
export function usesHttp(mode: ExecMode): boolean {
  return mode === "auto" || mode === "http";
}

// ------------------------------------------------------------------ app-wide incompatibility (R89)
/** Protocol mismatch seen per account (time); ≥ 2 accounts within 10 minutes → HTTP off app-wide. */
export function incompatibleAppWide(seen: ReadonlyMap<string, number>, now: number): boolean {
  let n = 0;
  for (const t of seen.values()) if (now - t < HTTP_FAIL_WINDOW_MS) n++;
  return n >= INCOMPATIBLE_ACCOUNTS;
}

// ------------------------------------------------------------------ pacing (R101)
export function submitGap(rand: () => number = Math.random): number {
  return Math.round(SUBMIT_GAP_MIN_MS + (SUBMIT_GAP_MAX_MS - SUBMIT_GAP_MIN_MS) * Math.min(1, Math.max(0, rand())));
}

/** Runtime view of one account's execution (renderer, /v1/status). */
export interface AccountExecution {
  mode: ExecMode;
  activePath: ExecPath | "none";
  httpState: HttpState;
  reason: HttpReason | null;
  since: number | null;
  nextProbeAt: number | null;
  runningHttp: number;
  runningUi: number;
  maxConcurrent: number;
  uiMaxConcurrent: number;
  /** A manual/automatic probe is running right now. */
  probing: boolean;
  /** Technical failures inside the 10-minute window (degraded label). */
  failCount: number;
}

/** App-wide bridge status (Settings › Chạy việc, `/v1/status.bridge`). */
export interface BridgeStatus {
  httpEnabled: boolean;
  compat: "ok" | "incompatible" | "unknown";
  lastCheckAt: number | null;
  lastCheckOk: boolean | null;
  /** Per account result of the last “Kiểm ngay”/self-check (alias, ok, plain reason). */
  results: { accountId: string; alias: string; ok: boolean; at: number; reason: string | null }[];
  checking: boolean;
}

/**
 * R91 — why a queued job waits. A job pinned to an `http` account whose direct channel is down/off waits for that
 * channel ("Chờ HTTP của {tên}"), never for the UI path; anything else keeps the Build 1.0 wording.
 */
export function queuedWaitLabel(
  job: { accountPref: string },
  account: { id: string; alias: string; execution?: Pick<AccountExecution, "mode" | "httpState"> | null } | null | undefined,
): string {
  if (account && job.accountPref === account.id && account.execution?.mode === "http" && (account.execution.httpState === "down" || account.execution.httpState === "off")) return `Chờ HTTP của ${account.alias}`;
  return "Đang chờ tài khoản";
}

export function stateLabel(e: Pick<AccountExecution, "mode" | "activePath" | "httpState" | "reason" | "failCount" | "since" | "nextProbeAt">, fmtTime: (t: number) => string): string {
  const since = e.since;
  const next = e.nextProbeAt;
  if (e.httpState === "off") return e.reason === "incompatible" ? "Kênh trực tiếp không tương thích" : e.mode === "ui" ? "Đang dùng Giao diện" : "HTTP đã tắt";
  if (e.httpState === "down") {
    const at = since ? ` lúc ${fmtTime(since)}` : "";
    const retry = next ? ` · thử lại ${fmtTime(next)}` : "";
    // Tự động keeps working through the UI page: say so first, then why and when HTTP is tried again (S07 concept).
    return `${e.activePath === "ui" ? "Đang dùng Giao diện · " : ""}HTTP lỗi${at}${retry}`;
  }
  if (e.activePath === "ui") return "Đang dùng Giao diện";
  if (e.httpState === "degraded") return `HTTP chập chờn (${Math.max(1, e.failCount)} lỗi)`;
  if (e.httpState === "unknown") return "HTTP chưa kiểm";
  return "Đang dùng HTTP";
}

/**
 * S09g line under “Kiểm ngay”. R97 runs the self-check only after 6 h without a successful HTTP turn, so “never checked”
 * while sends succeed would read as a problem: say the check is not needed instead.
 */
export function bridgeCheckLine(bridge: Pick<BridgeStatus, "lastCheckAt" | "lastCheckOk"> | null, anyHealthy: boolean, fmt: (ms: number) => string): string {
  if (bridge?.lastCheckAt) return `Tự kiểm gần nhất ${fmt(bridge.lastCheckAt)} · ${bridge.lastCheckOk ? "đạt" : "có lỗi"}`;
  return anyHealthy ? "Chưa cần tự kiểm · HTTP đang chạy tốt" : "Chưa tự kiểm lần nào";
}
