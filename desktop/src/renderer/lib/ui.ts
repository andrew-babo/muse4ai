import a0 from "../assets/avatars/a0.png";
import a1 from "../assets/avatars/a1.png";
import a2 from "../assets/avatars/a2.png";
import a3 from "../assets/avatars/a3.png";
import a4 from "../assets/avatars/a4.png";
import a5 from "../assets/avatars/a5.png";
import a6 from "../assets/avatars/a6.png";
import a7 from "../assets/avatars/a7.png";
import { ACCOUNT_LABEL, ACCOUNT_TONE, type StatusTone } from "@shared/accountMachine";
import { formatTime, formatUntil } from "@shared/format";
import { JOB_LABEL } from "@shared/jobMachine";
import { quotaView } from "@shared/quota";
import type { Account, JobState } from "@shared/types";
import { getLocale, t } from "@shared/i18n";

export const AVATARS = [a0, a1, a2, a3, a4, a5, a6, a7];
export const AVATAR_NAMES = ["Mây", "Sương", "Gió", "Nắng", "Mưa", "Sao", "Trăng", "Hoa"];
/** The avatars' names in English. Kept out of the translation catalog: they double as suggested account names, and a
 * catalog entry would also rewrite an account called “Mây” inside stored messages (R121 keeps names verbatim). */
const AVATAR_NAMES_EN = ["Cloud", "Mist", "Breeze", "Sunny", "Rain", "Star", "Moon", "Blossom"];
/** Avatar names (labels and suggested account names) in the current UI language. */
export const avatarNames = (): string[] => (getLocale() === "en" ? AVATAR_NAMES_EN : AVATAR_NAMES);

export const JOB_TONE: Record<JobState, StatusTone> = {
  queued: "neutral",
  held: "neutral",
  preparing: "accent",
  submitting: "accent",
  submitted: "accent",
  generating: "accent",
  downloading: "accent",
  download_retry: "attention",
  retry_wait: "attention",
  needs_review: "attention",
  completed: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export const TONE_CLASS: Record<StatusTone, { pill: string; dot: string; text: string }> = {
  ok: { pill: "bg-ok-soft text-ok-ink", dot: "bg-ok", text: "text-ok-ink" },
  accent: { pill: "bg-accent-soft text-accent-ink", dot: "bg-accent", text: "text-accent-ink" },
  attention: { pill: "bg-attention-soft text-attention-ink", dot: "bg-attention", text: "text-attention-ink" },
  danger: { pill: "bg-danger-soft text-danger-ink", dot: "bg-danger", text: "text-danger-ink" },
  neutral: { pill: "bg-neutral-soft text-ink-2", dot: "bg-neutral", text: "text-ink-2" },
};

/** Job phase dots (screens §5): Chuẩn bị · Gửi · Tạo · Tải về. */
export function jobPhase(state: JobState): number {
  if (state === "preparing") return 0;
  if (state === "submitting") return 1;
  if (state === "submitted" || state === "generating") return 2;
  if (state === "downloading" || state === "download_retry") return 3;
  return -1;
}
export const PHASES = ["Chuẩn bị", "Gửi", "Tạo", "Tải về"];

export const jobLabel = (s: JobState) => t(JOB_LABEL[s]);

export function accountStatus(a: Pick<Account, "state" | "stateUntil" | "stateNote">): { label: string; tone: StatusTone } {
  let label = t(ACCOUNT_LABEL[a.state]);
  if ((a.state === "cooling_down" || a.state === "limit_reached") && a.stateUntil) label = t("{label} đến {stateUntil}", { label, stateUntil: formatUntil(a.stateUntil, Date.now()) });
  return { label, tone: ACCOUNT_TONE[a.state] };
}

/** Muse account line in pickers (screens rev 8 §13): “Sẵn sàng · tuần 51 %” / “… · chưa đọc hạn mức”. */
export function museAccountLine(a: Pick<Account, "state" | "stateUntil" | "stateNote" | "quota">): string {
  const v = quotaView(a.quota, Date.now());
  return `${accountStatus(a).label} · ${v.known ? t("tuần {weeklyUsed} %{value}", { weeklyUsed: v.weeklyUsed, value: v.stale ? t(" (cũ)") : "" }) : t("chưa đọc hạn mức")}`;
}

export const assetUrl = (id: string) => `muse-media://asset/${encodeURIComponent(id)}`;
export const thumbUrl = (id: string, rev = 0) => `muse-media://thumb/${encodeURIComponent(id)}${rev ? `?r=${rev}` : ""}`;
export const refUrl = (id: string) => `muse-media://ref/${encodeURIComponent(id)}`;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
