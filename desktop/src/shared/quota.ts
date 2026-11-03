import {
  LIMIT_DEFAULT_MS,
  QUOTA_BACKOFF_MS,
  QUOTA_LOW_PERCENT,
  QUOTA_COUNT_READ_GAP_MS,
  QUOTA_READ_AGE_MS,
  QUOTA_READ_EVERY,
  QUOTA_STALE_MS,
} from "./constants";
import type { Quota } from "./types";

// Spec rev 8 §13 (R69–R76). Pure functions: no Electron, no clock of their own.

const DAY_MS = 24 * 60 * 60_000;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * A14 — “Nov 2” (also “November 2”, “2 Nov”, “Nov 2, 2026”, “11月2日”) → 00:00 of that date in local time, the earliest
 * moment Muse could reset. Without a year, the date nearest to `now` that a weekly reset can have (from 2 days before to
 * 9 days after the read) is used; anything else → null (the label is still shown as is).
 */
export function resetLabelToTime(label: string | null | undefined, now: number): number | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const t = label.normalize("NFKC").trim().toLowerCase();
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  const zh = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/.exec(t);
  const md = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/.exec(t);
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s*(\d{4}))?/.exec(t);
  if (zh) {
    month = Number(zh[2]) - 1;
    day = Number(zh[3]);
    year = zh[1] ? Number(zh[1]) : null;
  } else if (md && md[1] in MONTHS) {
    month = MONTHS[md[1]];
    day = Number(md[2]);
    year = md[3] ? Number(md[3]) : null;
  } else if (dm && dm[2] in MONTHS) {
    month = MONTHS[dm[2]];
    day = Number(dm[1]);
    year = dm[3] ? Number(dm[3]) : null;
  }
  if (month === null || day === null || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const at = (y: number): number | null => {
    const d = new Date(y, month!, day!, 0, 0, 0, 0);
    return d.getMonth() === month && d.getDate() === day ? d.getTime() : null; // “Feb 30” → invalid
  };
  if (year !== null) return at(year);
  const y0 = new Date(now).getFullYear();
  for (const y of [y0, y0 + 1, y0 - 1]) {
    const v = at(y);
    if (v !== null && v >= now - 2 * DAY_MS && v <= now + 9 * DAY_MS) return v;
  }
  return null;
}

/** “5B tokens left” → 5e9, “1.2M” → 1.2e6, “800K” → 8e5, “12,345 tokens left” → 12345, “0 tokens left” → 0. Approximate by design. */
export function parseTokenAmount(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const m = /(\d+(?:[.,]\d+)*)\s*([kmbt])?\b/i.exec(label.normalize("NFKC"));
  if (!m) return null;
  const raw = m[1];
  const unit = (m[2] ?? "").toLowerCase();
  // “1,234,567” (thousands) vs “1.2” / “1,2” (decimal): commas followed by exactly three digits are separators.
  const num = /^\d{1,3}(?:,\d{3})+$/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
  if (!Number.isFinite(num) || num < 0) return null;
  const mult = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "b" ? 1e9 : unit === "t" ? 1e12 : 1;
  return Math.round(num * mult);
}

export type AdditionalState = "none" | "unknown" | "available" | "exhausted";

/** R69/R73 — what the additional-tokens part says. Older snapshots (field missing) are “unknown”, never “none”. */
export function additionalState(q: Quota | null | undefined): AdditionalState {
  if (!q || q.additional === undefined) return "unknown";
  if (q.additional === null) return "none";
  const { remainingApprox: left, usedPercent: used } = q.additional;
  if (left === 0 || (used !== null && used >= 100)) return "exhausted";
  if ((left !== null && left > 0) || (used !== null && used < 100)) return "available";
  return "unknown";
}

/** R72 groups. `weekly_full`: weekly 100 % and the additional part could not be read. */
export type QuotaTier = "ok" | "low" | "additional" | "weekly_full" | "exhausted" | "unknown";

export interface QuotaView {
  /** A successful read with a weekly % exists. */
  known: boolean;
  weeklyUsed: number | null;
  /** The reset time has passed since the read (R70): the numbers say nothing about now. */
  expired: boolean;
  /** Older than 6 h or expired (R70). */
  stale: boolean;
  /** The last attempt failed (the numbers shown are from `readAt`). */
  failed: boolean;
  additional: AdditionalState;
  tier: QuotaTier;
}

export function hasSnapshot(q: Quota | null | undefined): q is Quota & { usedPercent: number } {
  return !!q && q.readAt > 0 && typeof q.usedPercent === "number";
}

export function quotaView(q: Quota | null | undefined, now: number): QuotaView {
  const known = hasSnapshot(q);
  const expired = known && typeof q!.resetAt === "number" && q!.resetAt <= now && q!.readAt < q!.resetAt;
  const stale = known && (expired || now - q!.readAt > QUOTA_STALE_MS);
  const add = additionalState(q);
  const failed = !!q && (q.failures ?? 0) > 0;
  let tier: QuotaTier = "unknown";
  if (known && !expired) {
    const used = q!.usedPercent!;
    if (used >= 100) tier = add === "available" ? "additional" : add === "unknown" ? "weekly_full" : "exhausted";
    else tier = used >= QUOTA_LOW_PERCENT ? "low" : "ok";
  }
  return { known, weeklyUsed: known ? q!.usedPercent! : null, expired, stale, failed, additional: add, tier };
}

/** R72 — order inside “Tự động”: lower first. Unknown is not penalised. */
export function quotaRank(tier: QuotaTier): number {
  switch (tier) {
    case "ok":
    case "unknown":
      return 0;
    case "low":
      return 1;
    case "additional":
    case "weekly_full":
      return 2;
    case "exhausted":
      return 3;
  }
}

export interface QuotaBlock {
  until: number;
  reason: string;
}

/**
 * R73/R74 — the snapshot says the account has nothing left: weekly ≥ 100 % and no additional tokens (none shown, used up
 * or 0 left). Until = the reset time if still ahead, else 60 minutes (re-check, never a hot loop). Expired snapshots and
 * an unreadable additional part never block (R5 stays the safety net).
 */
export function quotaBlock(q: Quota | null | undefined, now: number): QuotaBlock | null {
  const v = quotaView(q, now);
  if (v.tier !== "exhausted") return null;
  const resetAt = q!.resetAt ?? null;
  const until = resetAt !== null && resetAt > now ? resetAt : now + LIMIT_DEFAULT_MS;
  let label = "";
  if (resetAt !== null && resetAt > now) {
    const d = new Date(resetAt);
    label = ` · đặt lại ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  } else if (resetAt !== null) label = " · đọc lại sau 60 phút"; // Muse still shows a reset day that has passed
  else if (q!.resetsOn) label = ` · đặt lại ${q!.resetsOn}`;
  return { until, reason: `Hết hạn mức tuần (Muse báo ${v.weeklyUsed} %)${label}` };
}

export type QuotaReadReason = "pending" | "unknown" | "expired" | "count" | "age";

export interface QuotaReadInput {
  q: Quota | null | undefined;
  now: number;
  /** Muse jobs sent on this account after `q.readAt` (from the store). */
  sentSinceRead: number;
  /** A one-off read was asked for: start-up check, end of a limit, Muse reported a limit (R71 d–f). */
  pending: boolean;
  /** A queued Muse job this account could take exists. */
  hasWork: boolean;
}

/** R71 back-off after failed attempts: 10 min after the first, 30 min from the second in a row. */
export function quotaBackoffUntil(q: Quota | null | undefined): number | null {
  const f = q?.failures ?? 0;
  if (f <= 0 || typeof q?.checkedAt !== "number") return null;
  return q.checkedAt + (f >= 2 ? QUOTA_BACKOFF_MS[1] : QUOTA_BACKOFF_MS[0]);
}

/** R71 — why an automatic read is due now (null = not due). The caller checks lease/state/proxy. */
export function quotaReadReason(i: QuotaReadInput): QuotaReadReason | null {
  if (i.pending) return "pending";
  const backoff = quotaBackoffUntil(i.q);
  if (backoff !== null && i.now < backoff) return null;
  const v = quotaView(i.q, i.now);
  if (!v.known) return i.hasWork ? "unknown" : null;
  if (v.expired) return i.hasWork ? "expired" : null;
  // R103: (b)(c) at most once per 10 minutes per account, counted from the last read or attempt.
  if (i.now - Math.max(i.q!.readAt, i.q!.checkedAt ?? 0) < QUOTA_COUNT_READ_GAP_MS) return null;
  const every = v.tier === "low" || v.tier === "additional" || v.tier === "weekly_full" || v.tier === "exhausted" ? 1 : QUOTA_READ_EVERY;
  if (i.sentSinceRead >= every) return "count";
  if (i.sentSinceRead >= 1 && i.now - i.q!.readAt >= QUOTA_READ_AGE_MS) return "age";
  return null;
}

/** Start-up (R71 d): read after the session check when the snapshot is missing or older than 30 minutes. */
export function quotaWantsStartupRead(q: Quota | null | undefined, now: number): boolean {
  return !hasSnapshot(q) || now - q.readAt >= QUOTA_READ_AGE_MS;
}

/** Merge a fresh read into the stored snapshot (time = the coordinator's clock): keeps `limitFrom`, clears the failure state. */
export function mergeQuotaRead(prev: Quota | null | undefined, read: Quota, now: number): Quota {
  return { ...read, readAt: now, checkedAt: now, error: null, failures: 0, limitFrom: prev?.limitFrom ?? null };
}

/** R69 — a failed read keeps every number of the previous snapshot; only the attempt is recorded. */
export function failQuotaRead(prev: Quota | null | undefined, error: string, now: number): Quota {
  return { ...(prev ?? { readAt: 0 }), checkedAt: now, error, failures: (prev?.failures ?? 0) + 1 };
}

// ------------------------------------------------------------------ display (R75)

/** “5B tokens left” → “5B token còn lại”; unknown labels are kept verbatim. */
export function additionalLeftText(label: string | null): string | null {
  if (!label) return null;
  const m = /^\s*([\d.,]+\s*[KMBT]?)\s+tokens?\s+left\s*$/i.exec(label.normalize("NFKC"));
  return m ? `${m[1].replace(/\s+/g, "")} token còn lại` : label;
}

/** “Never expires” → “không hết hạn”; other labels verbatim. */
export function additionalExpiryText(label: string | null): string | null {
  if (!label) return null;
  return /^\s*never\s+expires?\s*$/i.test(label) ? "không hết hạn" : label;
}

export const QUOTA_TIER_CHIP: Partial<Record<QuotaTier, string>> = {
  low: "Sắp hết hạn mức tuần",
  additional: "Đang dùng token bổ sung",
  weekly_full: "Hết hạn mức tuần · chưa rõ token bổ sung",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayMonth = (t: number) => {
  const d = new Date(t);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
};
const clock = (t: number, now: number) => {
  const a = new Date(t);
  const b = new Date(now);
  const hm = `${pad2(a.getHours())}:${pad2(a.getMinutes())}`;
  return a.toDateString() === b.toDateString() ? hm : `${hm} · ${dayMonth(t)}`;
};

export interface QuotaPanelText {
  /** “đã dùng 51 % · đặt lại 02/11” (label as Muse wrote it when no date could be derived). */
  weekly: string | null;
  /** “5B token còn lại · không hết hạn · đã dùng 0 %”, “Không có”, “Đã dùng hết” or “Chưa đọc được”. */
  additional: string | null;
  /** “Đọc lúc 14:32” (date added when not today). */
  readAt: string | null;
  /** “Không đọc được lúc 14:40 — đang hiện số đọc lúc 13:10”. */
  error: string | null;
}

/** R75 — the text of the quota block on an account card (screens rev 8 §13). */
export function quotaPanelText(q: Quota | null | undefined, now: number): QuotaPanelText {
  const v = quotaView(q, now);
  const known = v.known ? q! : null;
  let weekly: string | null = null;
  let additional: string | null = null;
  if (known) {
    const reset = typeof known.resetAt === "number" ? dayMonth(known.resetAt) : known.resetsOn ?? null;
    weekly = `đã dùng ${v.weeklyUsed} %${reset ? ` · đặt lại ${reset}` : ""}`;
    if (v.additional === "none") additional = "Không có";
    else if (v.additional === "exhausted") additional = "Đã dùng hết";
    else if (v.additional === "unknown") additional = "Chưa đọc được";
    else {
      const a = known.additional!;
      additional =
        [additionalLeftText(a.remainingLabel), additionalExpiryText(a.expiryLabel), a.usedPercent !== null ? `đã dùng ${a.usedPercent} %` : null].filter(Boolean).join(" · ") ||
        "Còn token bổ sung";
    }
  }
  const error =
    v.failed && typeof q?.checkedAt === "number"
      ? `Không đọc được lúc ${clock(q.checkedAt, now)}${known ? ` — đang hiện số đọc lúc ${clock(known.readAt, now)}` : ""}`
      : null;
  return { weekly, additional, readAt: known ? `Đọc lúc ${clock(known.readAt, now)}` : null, error };
}
