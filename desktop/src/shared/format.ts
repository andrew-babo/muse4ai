import { getLocale } from "./i18n";

// Number/date/size formatting in the UI language (spec §8, Build 2.0 R120).
// vi: 1.234.567 · 02/11/2026 · 1,5 MB    en: 1,234,567 · Nov 2, 2026 · 1.5 MB    both: 24-hour clock.

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const en = () => getLocale() === "en";
const groupSep = () => (en() ? "," : ".");
const decimal = (s: string) => (en() ? s : s.replace(".", ","));

export function formatNumber(n: number): string {
  const s = Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, groupSep());
  return (n < 0 ? "-" : "") + s;
}

/** One decimal place in the UI language: 1,5 (vi) / 1.5 (en). */
export function formatDecimal(n: number, digits = 1): string {
  return decimal(n.toFixed(digits));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(t: number): string {
  const d = new Date(t);
  if (en()) return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Day and month only: 02/11 (vi) / Nov 2 (en). */
export function formatDayMonth(t: number): string {
  const d = new Date(t);
  return en() ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function formatTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** “00:00 · 02/11” when `t` is not on the same day as `now`, else “15:40” (R75). */
export function formatUntil(t: number, now: number): string {
  const a = new Date(t);
  const b = new Date(now);
  const same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return same ? formatTime(t) : `${formatTime(t)} · ${formatDayMonth(t)}`;
}

export function formatDateTime(t: number): string {
  return `${formatTime(t)} · ${formatDate(t)}`;
}

/** Elapsed: seconds up to 59 s, then m:ss (screens §5). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${decimal((b / 1024 ** 2).toFixed(1))} MB`;
  return `${decimal((b / 1024 ** 3).toFixed(1))} GB`;
}

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Proxy latency: "850 ms" / "1,3 s" — never "1.296 ms", which reads as about one millisecond in Vietnamese. */
export function formatLatency(ms: number | null | undefined): string {
  if (!ms) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${decimal((ms / 1000).toFixed(1))} s`;
}
