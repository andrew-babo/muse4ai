import { COOLDOWN_MS, FAIL_LIMIT, FAIL_WINDOW_MS, LIMIT_DEFAULT_MS } from "./constants";
import type { Account, AccountState } from "./types";

// Spec §4.2 + R5–R8.

export const ACCOUNT_LABEL: Record<AccountState, string> = {
  new: "Chưa đăng nhập",
  logging_in: "Đang đăng nhập",
  ready: "Sẵn sàng",
  busy: "Đang làm",
  takeover: "Anh đang điều khiển",
  cooling_down: "Nghỉ",
  limit_reached: "Hết hạn mức",
  needs_login: "Cần đăng nhập lại",
  checkpoint: "Cần xác minh",
  proxy_error: "Proxy lỗi",
  paused: "Đã tạm dừng",
};

export type StatusTone = "ok" | "accent" | "attention" | "danger" | "neutral";

export const ACCOUNT_TONE: Record<AccountState, StatusTone> = {
  new: "neutral",
  logging_in: "accent",
  ready: "ok",
  busy: "accent",
  takeover: "accent",
  cooling_down: "attention",
  limit_reached: "attention",
  needs_login: "attention",
  checkpoint: "attention",
  proxy_error: "danger",
  paused: "neutral",
};

/** States in which the scheduler may hand the account new work (R3). */
export function acceptsWork(state: AccountState): boolean {
  return state === "ready" || state === "busy";
}

export function accountLabel(a: Pick<Account, "state" | "stateUntil">, fmtTime: (t: number) => string): string {
  const base = ACCOUNT_LABEL[a.state];
  if ((a.state === "cooling_down" || a.state === "limit_reached") && a.stateUntil) return `${base} đến ${fmtTime(a.stateUntil)}`;
  return base;
}

export interface AccountPatch {
  state: AccountState;
  stateUntil: number | null;
  failTimes: number[];
  stateNote?: string | null;
}

/** R8 — generic account failure: cooling_down 120 s, or paused after 3 failures within 15 minutes. */
export function onGenericFailure(failTimes: number[], now: number): AccountPatch {
  const recent = [...failTimes.filter((t) => now - t < FAIL_WINDOW_MS), now];
  if (recent.length >= FAIL_LIMIT) {
    return { state: "paused", stateUntil: null, failTimes: [], stateNote: `Lỗi ${recent.length} lần trong 15 phút` };
  }
  return { state: "cooling_down", stateUntil: now + COOLDOWN_MS, failTimes: recent };
}

/** R5 — quota exhausted until Muse's reset time, else 60 minutes. Never touches the proxy. */
export function onQuotaLimit(now: number, resetAt: number | null): { state: AccountState; stateUntil: number } {
  return { state: "limit_reached", stateUntil: resetAt && resetAt > now ? resetAt : now + LIMIT_DEFAULT_MS };
}

/** Timed states that end by themselves; the caller then re-checks the session. */
export function isExpiredTimedState(a: Pick<Account, "state" | "stateUntil">, now: number): boolean {
  return (a.state === "cooling_down" || a.state === "limit_reached") && a.stateUntil !== null && a.stateUntil <= now;
}
