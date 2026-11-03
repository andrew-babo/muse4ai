import { CATALOG } from "./catalog";

// Build 2.0 R120–R122 — two UI languages. Vietnamese is the source language: every UI text is written in Vietnamese
// in the code and is its own key; `catalog/*` maps it to English. One function serves both kinds of text:
//   t("Đã chọn {n}", { n })   a static message with named {placeholders} (renderer, dialogs, tray)
//   t(job.errorMessage)       Vietnamese text the main process stored or sent earlier (already filled in): exact
//                             match first, then the catalog's templates read backwards (R121), else left as is
//                             (text from Muse or the user is never in the catalog and passes through unchanged).
// Pure TypeScript, no Electron/DOM imports, so main, renderer and tests share it.

export type Locale = "vi" | "en";
export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "vi", label: "Tiếng Việt" },
  { id: "en", label: "English" },
];
export const DEFAULT_LOCALE: Locale = "en";
/** Catalog keys `"<Vietnamese>@@<context>"` give one Vietnamese word a second English form (e.g. “Tài khoản” is
 * “Account” in a column but “Accounts” in navigation); see tc(). */
export const CTX = "@@";

export type Params = Record<string, string | number | null | undefined>;
/** An English entry: a template with the same {placeholders} as its key, or a function for plurals and reordering. */
export type EnValue = string | ((p: Record<string, string>) => string);
export type Catalog = Record<string, EnValue>;

export function isLocale(v: unknown): v is Locale {
  return v === "vi" || v === "en";
}

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (!isLocale(l) || l === current) return;
  current = l;
  for (const cb of listeners) cb(l);
}

/**
 * R120/R124 — the language a start uses: the store's saved choice wins; with none saved, a language the installer wrote
 * to the `ui-locale` file becomes the first choice (persist it); otherwise DEFAULT_LOCALE (English), not persisted.
 */
export function resolveStartLocale(stored: unknown, file: unknown): { locale: Locale; persist: boolean } {
  if (isLocale(stored)) return { locale: stored, persist: false };
  if (isLocale(file)) return { locale: file, persist: true };
  return { locale: DEFAULT_LOCALE, persist: false };
}

export function onLocaleChange(cb: (l: Locale) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Picks the first supported language of an HTTP `Accept-Language` header (q-values honoured), or null. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const items = header
    .split(",")
    .map((part, i) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith("q="));
      const w = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), w: Number.isFinite(w) ? w : 0, i };
    })
    .filter((x) => x.tag && x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const it of items) {
    const base = it.tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

import { plural } from "./plural";

export { plural };

const PH = /\{(\w+)\}/g;

function fill(template: string, p: Params): string {
  return template.replace(PH, (m, k: string) => (k in p && p[k] !== null && p[k] !== undefined ? String(p[k]) : m));
}

function asStrings(p: Params | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (p) for (const [k, v] of Object.entries(p)) out[k] = v === null || v === undefined ? "" : String(v);
  return out;
}

/** `{n|job|jobs}` in an English entry prints the singular or plural word for placeholder n. */
const PLURAL = /\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g;

function render(v: EnValue, p: Params | undefined): string {
  if (typeof v === "function") return v(asStrings(p));
  const withPlurals = v.includes("|") ? v.replace(PLURAL, (_m, k: string, one: string, other: string) => plural(p?.[k] ?? "", one, other)) : v;
  return p ? fill(withPlurals, p) : withPlurals;
}

// ---------------------------------------------------------------- reverse templates (R121)

interface Pattern {
  key: string;
  re: RegExp;
  names: string[];
  /** Literal characters in the key — more literal text = more specific, tried first. */
  weight: number;
  /** Literal text before the first placeholder (may be empty). */
  prefix: string;
}

let patterns: Pattern[] | null = null;
let byPrefix: Map<string, Pattern[]> | null = null;
let openPatterns: Pattern[] = [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildPatterns(): void {
  const list: Pattern[] = [];
  for (const key of Object.keys(CATALOG)) {
    if (key.includes(CTX)) continue; // context variants are looked up by tc(), never matched backwards
    if (!key.includes("{")) continue;
    const names: string[] = [];
    let re = "^";
    let last = 0;
    let weight = 0;
    PH.lastIndex = 0;
    for (let m = PH.exec(key); m; m = PH.exec(key)) {
      const lit = key.slice(last, m.index);
      re += escapeRe(lit);
      weight += lit.length;
      re += "([\\s\\S]+?)";
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    if (!names.length) continue;
    const tail = key.slice(last);
    re += `${escapeRe(tail)}$`;
    weight += tail.length;
    // A template that is only placeholders ("{a} · {b}") would match almost anything; it is used forward only.
    if (weight < 2) continue;
    const prefix = key.slice(0, key.indexOf("{"));
    list.push({ key, re: new RegExp(re), names, weight, prefix });
  }
  list.sort((a, b) => b.weight - a.weight);
  patterns = list;
  byPrefix = new Map();
  openPatterns = [];
  for (const p of list) {
    if (p.prefix.length >= 2) {
      const k = p.prefix.slice(0, 2);
      const arr = byPrefix.get(k) ?? [];
      arr.push(p);
      byPrefix.set(k, arr);
    } else openPatterns.push(p);
  }
}

const cache = { en: new Map<string, string>() };
const CACHE_MAX = 5000;

function reverse(text: string, depth: number): string | null {
  if (!patterns) buildPatterns();
  const candidates = [...(byPrefix!.get(text.slice(0, 2)) ?? []), ...openPatterns];
  // A template that starts with its own words is trusted over one that starts with a placeholder ("{alias} hết hạn
  // mức" must not swallow "Lần 3 lỗi: Muse báo hết hạn mức"); then the one with more literal text wins.
  const rank = (p: Pattern) => (p.prefix.length > 0 ? 100_000 : 0) + p.weight;
  let best: { p: Pattern; m: RegExpExecArray } | null = null;
  for (const p of candidates) {
    if (best && rank(p) <= rank(best.p)) continue;
    const m = p.re.exec(text);
    if (m) best = { p, m };
  }
  if (!best) return null;
  const params: Record<string, string> = {};
  best.p.names.forEach((n, i) => {
    const raw = best!.m[i + 1];
    params[n] = depth < 2 ? translateText(raw, depth + 1) : raw;
  });
  return render(CATALOG[best.p.key], params);
}

function translateText(text: string, depth: number): string {
  const exact = text.includes(CTX) ? undefined : CATALOG[text];
  if (exact !== undefined) return render(exact, undefined);
  // Multi-line stored text (an error with a detail line): translate line by line.
  if (text.includes("\n")) return text.split("\n").map((l) => (l.trim() ? translateText(l, depth) : l)).join("\n");
  return reverse(text, depth) ?? joined(text, depth) ?? text;
}

/**
 * Stored text built from several catalog messages joined by " — " or " · " (a DNS step "Đã trỏ tới … — Tên miền trỏ
 * tới IP khác…", the quota line "5B token còn lại · không hết hạn · đã dùng 0 %"): translate each part (AC-APP-I18N-01).
 */
function joined(text: string, depth: number): string | null {
  for (const sep of [" — ", " · "]) {
    if (!text.includes(sep)) continue;
    const parts = text.split(sep);
    const out: string[] = [];
    let changed = false;
    // Longest run of parts first: a catalog message may itself contain the separator.
    for (let i = 0; i < parts.length; ) {
      let took = false;
      for (let j = parts.length; j > i; j--) {
        if (i === 0 && j === parts.length) continue; // the whole text was already tried
        const piece = parts.slice(i, j).join(sep);
        const tr = piece.trim() ? translateText(piece, depth) : piece;
        if (tr !== piece || j === i + 1) {
          out.push(tr);
          changed ||= tr !== piece;
          i = j;
          took = true;
          break;
        }
      }
      if (!took) out.push(parts[i++]!);
    }
    if (changed) return out.join(sep);
  }
  return null;
}

const missing = new Set<string>();
/** Keys looked up with no English entry (diagnostics and E2E only). */
export function missingKeys(): string[] {
  return [...missing];
}

/**
 * Translates `vi` into the current language. With `params` it is a message key with {placeholders}; without, it may
 * also be runtime Vietnamese text (stored errors, notices) which is matched against the catalog's templates.
 */
export function t(vi: string | null | undefined, params?: Params): string {
  return tl(current, vi, params);
}

/** Like t(), but prefers the English entry for `context` (`"Tài khoản@@nav"`) and falls back to the plain key. */
export function tc(context: string, vi: string, params?: Params): string {
  if (current === "en") {
    const v = CATALOG[vi + CTX + context];
    if (v !== undefined) return render(v, params);
  }
  return tl(current, vi, params);
}

/** `t` for an explicit language (an API request's Accept-Language, R122). */
export function tl(locale: Locale, vi: string | null | undefined, params?: Params): string {
  if (vi === null || vi === undefined) return "";
  if (locale === "vi") return params ? fill(vi, params) : vi;
  if (params) {
    const v = CATALOG[vi];
    if (v === undefined) {
      missing.add(vi);
      return fill(vi, params);
    }
    return render(v, params);
  }
  if (!vi) return vi;
  const hit = cache.en.get(vi);
  if (hit !== undefined) return hit;
  const out = translateText(vi, 0);
  if (out === vi && /[\u00c0-\u1ef9]/.test(vi) && CATALOG[vi] === undefined) missing.add(vi);
  if (cache.en.size >= CACHE_MAX) cache.en.clear();
  cache.en.set(vi, out);
  return out;
}

/** Test hook: rebuild reverse templates after a catalog change in a test. */
export function __resetI18nCaches(): void {
  patterns = null;
  byPrefix = null;
  cache.en.clear();
  missing.clear();
}
