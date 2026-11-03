import { ACCOUNT_LABEL, type StatusTone } from "./accountMachine";
import type { Account, AccountState, Asset, ChainPlan, ExtendInfo, VibesSite, VibesStatus } from "./types";
import { formatDecimal, formatNumber } from "./format";

// Spec rev 6 §4.9 (R39–R53): Vibes in the same account profile and Kéo dài video. Pure rules, unit-tested.
// Numbers in brackets in the spec are proposed defaults (A10); they live here so a change is one edit.

export const VIBES_SUBMIT_GAP_MS = 5_000; // R43
/** R42 — a successful session check this recent counts as the pre-job check (no two requests in a row). */
export const VIBES_CHECK_FRESH_MS = 10_000;
export const VIBES_LIMIT_DEFAULT_MS = 60 * 60_000; // R51
export const LOGIN_STEP_TIMEOUT_MS = 15 * 60_000; // R41f
export const EXTEND_DIRECTIVE_MAX = 1_000; // R46
export const EXTEND_MAX_STEPS_DEFAULT = 20; // R46
export const EXTEND_MAX_STEPS_MIN = 1;
export const EXTEND_MAX_STEPS_MAX = 60;
export const EXTEND_TARGET_MIN_S = 15;
export const EXTEND_TARGET_MAX_S = 300;
export const EXTEND_TARGET_STEP_S = 5;
/** Vibes Kéo dài sheet starts at 3 steps (screens rev 6 §11.4). */
export const VIBES_EXTEND_DEFAULT_STEPS = 3;
export const EXTEND_MIN_GROWTH_MS = 1_000; // R47 (3)

export const VIBES_LABEL: Record<VibesStatus, string> = {
  off: "Đang tắt",
  logged_out: "Chưa đăng nhập",
  logging_in: "Đang đăng nhập",
  ready: "Sẵn sàng",
  needs_login: "Cần đăng nhập lại",
  checkpoint: "Cần xác minh",
  restricted: "Chưa dùng được",
  identity_changed: "Đã đổi tài khoản Vibes",
  limit_reached: "Hết lượt Vibes",
  cooling_down: "Nghỉ",
};

export const VIBES_TONE: Record<VibesStatus, StatusTone> = {
  off: "neutral",
  logged_out: "neutral",
  logging_in: "accent",
  ready: "ok",
  needs_login: "attention",
  checkpoint: "attention",
  restricted: "danger",
  identity_changed: "attention",
  limit_reached: "attention",
  cooling_down: "attention",
};

export const DEFAULT_VIBES: VibesSite = {
  enabled: true,
  status: "logged_out",
  statusUntil: null,
  note: null,
  identityMasked: null,
  hasIdentity: false,
  pendingIdentityMasked: null,
  checkedAt: null,
};

/** What the user sees for the Vibes side; `off` whenever the switch is off. */
export function vibesStatus(v: Pick<VibesSite, "enabled" | "status">): VibesStatus {
  return v.enabled ? v.status : "off";
}

export function vibesLabel(v: Pick<VibesSite, "enabled" | "status" | "statusUntil">, fmtTime: (t: number) => string): string {
  const st = vibesStatus(v);
  const base = VIBES_LABEL[st];
  if ((st === "limit_reached" || st === "cooling_down") && v.statusUntil) return `${base} đến ${fmtTime(v.statusUntil)}`;
  return base;
}

/** S07 sidebar — the small amber dot on the avatar: Vibes needs the user (not just waits). Null when it does not. */
export function vibesAttention(v: Pick<VibesSite, "enabled" | "status">): string | null {
  const st = vibesStatus(v);
  if (st === "needs_login") return "Vibes cần đăng nhập lại";
  if (st === "checkpoint") return "Vibes cần xác minh";
  if (st === "identity_changed") return "Vibes đã đổi tài khoản";
  return null;
}

/** R40 — only `ready` takes Vibes work. */
export function vibesAcceptsWork(v: Pick<VibesSite, "enabled" | "status">): boolean {
  return v.enabled && v.status === "ready";
}

/** Timed Vibes states end by themselves (the next Vibes job re-checks the session). */
export function vibesTimedOut(v: Pick<VibesSite, "status" | "statusUntil">, now: number): boolean {
  return (v.status === "limit_reached" || v.status === "cooling_down") && v.statusUntil !== null && v.statusUntil <= now;
}

/** `may.vn` → `ma•••vn` (R42). Never shows more than 4 characters of the name. */
export function maskName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (n.length <= 4) return `${n.slice(0, 1)}•••`;
  return `${n.slice(0, 2)}•••${n.slice(-2)}`;
}

/** Masks a remote id for logs: only the last 4 characters (R52). */
export function maskRemote(id: string | null | undefined): string {
  const s = String(id ?? "");
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

// ------------------------------------------------------------------ session check (R42)
export type AuthMeResponse = { status: number; body: unknown };

export type AuthMeOutcome =
  | { kind: "ready"; userId: string; username: string | null }
  | { kind: "state"; status: VibesStatus; note: string }
  | { kind: "transient"; note: string };

/** Shown on the account card and in the notice when Vibes refuses the Meta account as under 18. */
export const VIBES_AGE_NOTE = "Vibes chặn tài khoản Meta dưới 18 tuổi";

const RESTRICTED_CODES = ["AccountPending", "AccountRevoked", "AccountInactive", "PublicAccessDenied", "VibesAgeRestricted"];
const EXPIRED_CODES = ["NoToken", "SessionExpired", "InvalidToken"];

function errorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const e = b.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.type ?? o.code ?? o.title ?? o.name ?? "");
  }
  return String(b.type ?? b.code ?? "");
}

/**
 * Classifies `GET vibes.ai/api/auth/me` seen from the account's own page. Network errors (status 0), 5xx and 429 keep
 * the previous state: a network problem must never turn into “Chưa đăng nhập”.
 */
export function classifyAuthMe(r: AuthMeResponse, hasIdentity: boolean): AuthMeOutcome {
  const code = errorCode(r.body);
  if (RESTRICTED_CODES.some((c) => code.includes(c))) return { kind: "state", status: "restricted", note: "Tài khoản này chưa dùng được Vibes" };
  if (r.status === 200) {
    const user = r.body && typeof r.body === "object" ? (r.body as Record<string, unknown>).user : undefined;
    const u = user && typeof user === "object" ? (user as Record<string, unknown>) : null;
    const id = u && (typeof u.id === "string" || typeof u.id === "number") ? String(u.id).trim() : "";
    if (id) {
      const name = u ? [u.username, u.handle, u.name, u.displayName].find((x) => typeof x === "string" && x.trim()) : null;
      return { kind: "ready", userId: id, username: (name as string | undefined) ?? null };
    }
    return { kind: "state", status: hasIdentity ? "needs_login" : "logged_out", note: "Vibes chưa đăng nhập" };
  }
  // 401 (NoToken / SessionExpired / InvalidToken or no code at all) = not logged in on Vibes.
  if (r.status === 401) {
    const expired = EXPIRED_CODES.some((c) => code.includes(c));
    return { kind: "state", status: hasIdentity ? "needs_login" : "logged_out", note: hasIdentity ? (expired ? "Phiên Vibes đã hết" : "Vibes yêu cầu đăng nhập lại") : "Vibes chưa đăng nhập" };
  }
  if (r.status === 403) {
    if (/checkpoint|verif/i.test(code)) return { kind: "state", status: "checkpoint", note: "Meta yêu cầu xác minh tài khoản" };
    return { kind: "state", status: "restricted", note: "Tài khoản này chưa dùng được Vibes" };
  }
  if (r.status === 0) return { kind: "transient", note: "Không gọi được Vibes qua proxy" };
  return { kind: "transient", note: `Vibes chưa trả lời được (HTTP ${r.status})` };
}

// ------------------------------------------------------------------ login plan (R41)
export type LoginSite = "muse" | "vibes";

export function loginPlan(museState: AccountState, vibes: Pick<VibesSite, "enabled" | "status">, only?: LoginSite): LoginSite[] {
  const wantMuse = museState !== "ready" && museState !== "busy";
  const wantVibes = vibes.enabled && vibes.status !== "ready" && vibes.status !== "restricted";
  if (only === "muse") return ["muse"];
  if (only === "vibes") return vibes.enabled ? ["vibes"] : [];
  const out: LoginSite[] = [];
  if (wantMuse) out.push("muse");
  if (wantVibes) out.push("vibes");
  return out;
}

// ------------------------------------------------------------------ waiting reasons (R45, R47)
/** Why an account cannot run a Vibes job right now, in words for “{lý do}” (null = it can). */
export function vibesWaitReason(acc: Pick<Account, "alias" | "state" | "stateUntil" | "vibes">, fmtTime: (t: number) => string): string | null {
  const a = acc.alias;
  if (acc.state === "paused") return `${a} đang tạm dừng`;
  if (acc.state === "proxy_error") return `proxy của ${a} được sửa`;
  if (acc.state === "takeover") return `anh trả lại điều khiển ${a}`;
  const v = acc.vibes;
  const st = vibesStatus(v);
  switch (st) {
    case "ready":
      return null;
    case "off":
      return `bật Vibes cho ${a}`;
    case "logged_out":
    case "logging_in":
    case "needs_login":
      return `${a} đăng nhập lại Vibes`;
    case "checkpoint":
      return `${a} xác minh tài khoản Vibes`;
    case "restricted":
      return `${a} dùng được Vibes`;
    case "identity_changed":
      return `anh chọn tài khoản Vibes cho ${a}`;
    case "limit_reached":
      return `${a} hết giới hạn Vibes${v.statusUntil ? ` đến ${fmtTime(v.statusUntil)}` : ""}`;
    case "cooling_down":
      return `${a} nghỉ Vibes${v.statusUntil ? ` đến ${fmtTime(v.statusUntil)}` : ""}`;
  }
}

/** The amber line under the Kéo dài sheet when the owner account waits (R45). */
export function ownerWaitNote(acc: Pick<Account, "alias" | "state" | "stateUntil" | "vibes">, fmtTime: (t: number) => string): string | null {
  const st = vibesStatus(acc.vibes);
  const a = acc.alias;
  if (acc.state === "paused") return `${a} đang tạm dừng — chuỗi sẽ chờ`;
  if (acc.state === "proxy_error") return `Proxy của ${a} đang lỗi — chuỗi sẽ chờ`;
  if (st === "needs_login" || st === "logged_out" || st === "logging_in") return `${a} cần đăng nhập lại Vibes — chuỗi sẽ chờ`;
  if (st === "checkpoint") return `${a} cần xác minh Vibes — chuỗi sẽ chờ`;
  if (st === "limit_reached") return `${a} hết lượt Vibes${acc.vibes.statusUntil ? ` đến ${fmtTime(acc.vibes.statusUntil)}` : ""} — chuỗi sẽ chờ`;
  if (st === "cooling_down") return `${a} đang nghỉ Vibes — chuỗi sẽ chờ`;
  if (st === "off") return `Vibes đang tắt cho ${a} — chuỗi sẽ chờ`;
  return null;
}

// ------------------------------------------------------------------ extend eligibility (R45)
export const EXTEND_REASON = {
  notVibes: "Video tạo trên Muse chưa kéo dài được — tạo video trên Vibes để dùng Kéo dài",
  ownerRemoved: "Tài khoản tạo video này đã bị xoá",
  identityChanged: (alias: string) => `Phiên Vibes của ${alias} đã đổi tài khoản`,
  unverified: "Kéo dài chưa được kiểm trên phiên bản này",
  trashed: "Video này đang trong Thùng rác",
  restricted: (alias: string) => `${alias} chưa dùng được Vibes`,
} as const;

export function extendEligibility(
  asset: Pick<Asset, "kind" | "site" | "sourceStatus" | "sourceOwnerId" | "trashedAt" | "missing">,
  owner: Pick<Account, "alias" | "state" | "stateUntil" | "vibes"> | null,
  verified: boolean,
  fmtTime: (t: number) => string,
): ExtendInfo | null {
  if (asset.kind !== "video") return null; // images have no Kéo dài button
  if (asset.trashedAt) return { ok: false, reason: EXTEND_REASON.trashed, waitNote: null };
  if (asset.site !== "vibes" || !asset.sourceStatus) return { ok: false, reason: EXTEND_REASON.notVibes, waitNote: null };
  if (asset.sourceStatus === "owner_removed" || !owner) return { ok: false, reason: EXTEND_REASON.ownerRemoved, waitNote: null };
  if (asset.sourceStatus === "identity_changed" || owner.vibes.status === "identity_changed") return { ok: false, reason: EXTEND_REASON.identityChanged(owner.alias), waitNote: null };
  if (!verified) return { ok: false, reason: EXTEND_REASON.unverified, waitNote: null };
  if (owner.vibes.status === "restricted" && owner.vibes.enabled) return { ok: false, reason: EXTEND_REASON.restricted(owner.alias), waitNote: null };
  return { ok: true, reason: null, waitNote: ownerWaitNote(owner, fmtTime) };
}

// ------------------------------------------------------------------ options and chain (R46, R47)
export function normaliseDirective(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

/** Returns an error message, or null when the options are valid. */
export function validateExtend(input: { mode: "auto" | "directive"; directive?: string | null; plan: ChainPlan }, maxSteps: number): string | null {
  if (input.mode === "directive") {
    const d = normaliseDirective(input.directive);
    if (!d) return "Nhập mô tả cho Theo mô tả";
    if (d.length > EXTEND_DIRECTIVE_MAX) return `Mô tả tối đa ${formatNumber(EXTEND_DIRECTIVE_MAX)} ký tự`;
  }
  const v = input.plan.value;
  if (input.plan.type === "steps") {
    if (!Number.isInteger(v) || v < 1) return "Số lần phải từ 1";
    if (v > maxSteps) return `Tối đa ${maxSteps} lần mỗi chuỗi (chỉnh trong Cài đặt)`;
  } else {
    if (!Number.isInteger(v) || v < EXTEND_TARGET_MIN_S || v > EXTEND_TARGET_MAX_S || v % EXTEND_TARGET_STEP_S !== 0) {
      return `Đến khoảng phải từ ${EXTEND_TARGET_MIN_S} đến ${EXTEND_TARGET_MAX_S} giây, bước ${EXTEND_TARGET_STEP_S}`;
    }
  }
  return null;
}

export type ChainDecision = { action: "continue" } | { action: "complete"; reason: string } | { action: "stop"; reason: string };

const secs = (ms: number) => formatDecimal(ms / 1000, 1);

/** R47 — after step k completed (checked in this exact order). `stepsDone` already counts step k. */
export function nextChainStep(input: { plan: ChainPlan; maxSteps: number; stepsDone: number; sourceMs: number | null; outputMs: number | null }): ChainDecision {
  const { plan, maxSteps, stepsDone } = input;
  if (plan.type === "steps" && stepsDone >= plan.value) return { action: "complete", reason: `Đã kéo dài ${plan.value} lần` };
  if (plan.type === "target" && input.outputMs !== null && input.outputMs >= plan.value * 1000) {
    return { action: "complete", reason: `Đã đạt khoảng ${plan.value} giây` };
  }
  if (input.outputMs === null || input.sourceMs === null || input.outputMs - input.sourceMs < EXTEND_MIN_GROWTH_MS) {
    return { action: "stop", reason: "Vibes không kéo dài thêm" };
  }
  if (stepsDone >= maxSteps) return { action: "stop", reason: `Đã đủ ${maxSteps} lần` };
  return { action: "continue" };
}

/** True when the output looks like an appended segment rather than a longer video (R49: then never chain on). */
export function looksLikeSegment(sourceMs: number | null, outputMs: number | null): boolean {
  return sourceMs !== null && outputMs !== null && outputMs + 500 < sourceMs;
}

/** Steps still allowed when a stopped/cancelled chain continues (R47 Tiếp tục). */
export function remainingSteps(plan: ChainPlan, stepsDone: number, maxSteps: number): number {
  const cap = Math.max(0, maxSteps - stepsDone);
  return plan.type === "steps" ? Math.min(cap, Math.max(0, plan.value - stepsDone)) : cap;
}

export function chainProgressLabel(c: { plan: ChainPlan; stepsDone: number; maxSteps: number; lastDurationMs: number | null }): string {
  const total = c.plan.type === "steps" ? Math.min(c.plan.value, c.maxSteps) : c.maxSteps;
  const len = c.lastDurationMs !== null ? ` · ${secs(c.lastDurationMs)} s` : "";
  return `Chuỗi kéo dài · lần ${Math.min(c.stepsDone + 1, total)}/${total}${len}`;
}

export function formatSeconds(ms: number | null): string {
  return ms === null ? "—" : `${secs(ms)} s`;
}

export { ACCOUNT_LABEL };
