import { AGENTS } from "./agents";
import { DOCS } from "./docs";
import { fold, pick } from "./i18n";
import type { Locale } from "./types";
import { USE_CASES } from "./usecases";

export interface SearchEntry {
  /** English path; callers localize it. */
  path: string;
  kind: "doc" | "agent" | "usecase";
  title: string;
  summary: string;
  /** Folded (lower-case, no diacritics) text used for matching. */
  haystack: string;
  /** Folded title, weighted higher. */
  titleKey: string;
}

/** Search index for one language, built from content only (R3-WEB.11, R3-APP.5). */
export function buildIndex(locale: Locale): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const d of DOCS) {
    const title = pick(d.title, locale);
    const summary = pick(d.summary, locale);
    const body = d.steps.map((s) => `${pick(s.title, locale)} ${pick(s.body, locale)}`).join(" ");
    out.push({ path: `/docs/${d.slug}`, kind: "doc", title, summary, haystack: fold(`${title} ${summary} ${body}`), titleKey: fold(title) });
  }
  for (const a of AGENTS) {
    if (a.status === "hidden") continue;
    const title = a.name;
    const summary = pick(a.summary, locale);
    out.push({ path: `/agents/${a.slug}`, kind: "agent", title, summary, haystack: fold(`${a.name} ${a.vendor} ${summary}`), titleKey: fold(title) });
  }
  for (const u of USE_CASES) {
    const title = pick(u.title, locale);
    const summary = pick(u.summary, locale);
    out.push({ path: `/use-cases/${u.slug}`, kind: "usecase", title, summary, haystack: fold(`${title} ${summary} ${pick(u.who, locale)}`), titleKey: fold(title) });
  }
  return out;
}

/** Every word of the query must appear; title matches rank first. */
export function search(index: SearchEntry[], query: string, limit = 12): SearchEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of index) {
    if (!words.every((w) => e.haystack.includes(w))) continue;
    let score = 0;
    if (e.titleKey.includes(phrase)) score += 10;
    if (e.titleKey.startsWith(words[0] ?? "")) score += 4;
    score += words.filter((w) => e.titleKey.includes(w)).length * 2;
    if (e.haystack.includes(phrase)) score += 1;
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title)).slice(0, limit).map((s) => s.e);
}

/** Shown when a search finds nothing (AC-APP-GUIDE-05). */
export const SUGGESTED_PATHS = ["/docs/install", "/docs/create-image", "/docs/connect-overview"] as const;
