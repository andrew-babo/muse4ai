import type { L, Locale } from "./types";

/** Picks the string for a locale. */
export function pick<T>(value: L<T>, locale: Locale): T {
  return locale === "vi" ? value.vi : value.en;
}

/** Shorthand to build an L value. */
export function l(en: string, vi: string): L {
  return { en, vi };
}

/** "/agents/cursor" → "/vi/agents/cursor"; "/" → "/vi". */
export function localizedPath(path: string, locale: Locale): string {
  if (locale === "en") return path;
  return path === "/" ? "/vi" : `/vi${path}`;
}

/** "/vi/agents/cursor" → { locale: "vi", path: "/agents/cursor" }. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  if (pathname === "/vi" || pathname === "/vi/") return { locale: "vi", path: "/" };
  if (pathname.startsWith("/vi/")) return { locale: "vi", path: pathname.slice(3) };
  return { locale: "en", path: pathname || "/" };
}

/**
 * Lower-cases and strips Vietnamese diacritics so "hang cho" finds "Hàng chờ"
 * (AC-APP-GUIDE-05, AC-WEB-SRCH-01).
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
