import { AGENTS } from "./agents";
import { BRANDS, NEVER_LOGO } from "./brands";
import { CHAPTERS } from "./chapters";
import * as COPY from "./copy";
import { CREDITS } from "./credits";
import { DOCS } from "./docs";
import { GLOSSARY } from "./glossary";
import { linksIn } from "./inline";
import { MEDIA } from "./media";
import { STATIC_PAGES } from "./pages";
import { allRoutes } from "./routes";
import { SHOTS } from "./shots";
import { LOCALES, type L } from "./types";
import { USE_CASES } from "./usecases";

/**
 * Pure checks behind the content tests (spec §7). Each returns human-readable
 * problems; an empty list means the rule holds. Both packages run them.
 */

function isL(v: unknown): v is L<unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).sort().join(",") === "en,vi";
}

/** AC-CNT-01: every L value has non-empty en and vi. */
export function missingTranslations(root: unknown, at = "content"): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (isL(v)) {
      for (const loc of LOCALES) {
        const x = (v as unknown as Record<string, unknown>)[loc];
        const empty = typeof x === "string" ? x.trim() === "" : Array.isArray(x) ? x.length === 0 : x === undefined || x === null;
        if (empty) out.push(`${path}.${loc} is empty`);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(root, at);
  return out;
}

/** All strings under a value, with their paths. */
export function strings(root: unknown, at = "content"): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") out.push({ path, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(root, at);
  return out;
}

/** R3-CNT.4 forbidden claims. A match right after a negation (not/no/never/không/chưa) is allowed. */
export const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\bofficial (partner|integration|app|connector)\b/i, why: "claims an official relationship" },
  { re: /\b(partner(ed|ship)? with|đối tác (của|với))\b/i, why: "claims a partnership" },
  { re: /\bcertified\b|chứng nhận/i, why: "claims certification" },
  { re: /\bendorsed\b|chứng thực/i, why: "claims endorsement" },
  { re: /\bunlimited\b|không giới hạn/i, why: "promises unlimited use" },
  { re: /\bthe only way\b|cách duy nhất/i, why: "claims to be the only way" },
  { re: /\bVibes\b/, why: "Vibes was removed" },
  { re: /\bMuse Studio\b/, why: "old product name" },
  { re: /\bpodcasts?\b/i, why: "podcast is not a promoted feature" },
  { re: /\b(rank(s|ing)? #?1|guaranteed? (ranking|citation)s?)\b|đảm bảo (lên top|xếp hạng)/i, why: "promises rankings" },
  { re: /(bypass|get around|vượt|lách) (the )?(region|regional|quota|limit|giới hạn vùng|hạn mức)/i, why: "frames proxies as a way around limits" },
];

const NEGATION = /\b(not|no|never|isn't|aren't|without)\b[^.]{0,60}$|(không|chưa|chẳng)[^.]{0,60}$/i;

export function forbiddenClaims(items: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of items) {
    for (const f of FORBIDDEN) {
      for (const m of text.matchAll(new RegExp(f.re.source, f.re.flags.includes("g") ? f.re.flags : f.re.flags + "g"))) {
        const before = text.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
        if (NEGATION.test(before)) continue;
        out.push(`${path}: "${m[0]}" — ${f.why}`);
      }
    }
  }
  return out;
}

/** Everything the website and app show, for scanning. */
export function contentRoot() {
  return { docs: DOCS, agents: AGENTS, useCases: USE_CASES, pages: STATIC_PAGES, chapters: CHAPTERS, glossary: GLOSSARY, credits: CREDITS, media: MEDIA, shots: SHOTS, copy: COPY };
}

/** AC-CNT-03: article template. */
export function docTemplateProblems(): string[] {
  const out: string[] = [];
  const slugs = new Set(DOCS.map((d) => d.slug));
  if (slugs.size !== DOCS.length) out.push("duplicate doc slug");
  for (const d of DOCS) {
    for (const loc of LOCALES) {
      const s = d.summary[loc];
      if (s.length < 70 || s.length > 160) out.push(`${d.slug}: summary.${loc} is ${s.length} chars (70–160)`);
    }
    if (d.steps.length < 1) out.push(`${d.slug}: no steps`);
    if (!d.success.en || !d.success.vi) out.push(`${d.slug}: no success check`);
    if (d.troubleshoot.length === 0 && d.related.length === 0) out.push(`${d.slug}: no troubleshooting or related`);
    if (!d.steps.some((s) => s.shot)) out.push(`${d.slug}: no screenshot`);
    for (const r of d.related) if (!slugs.has(r)) out.push(`${d.slug}: related "${r}" does not exist`);
    if (!CHAPTERS.some((c) => c.id === d.chapter)) out.push(`${d.slug}: unknown chapter ${d.chapter}`);
  }
  for (const c of CHAPTERS) if (!DOCS.some((d) => d.chapter === c.id)) out.push(`chapter ${c.id} has no article`);
  return out;
}

/** Non-HTML files the website serves (R3-WEB.6); content may link to them. */
export const MACHINE_PATHS = ["/downloads/muse4ai-skill.zip", "/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt"];

/** Official domains external links may point to (R3-CNT.7). */
export const EXTERNAL_ALLOW = [
  "github.com", "anthropic.com", "claude.com", "claude.ai", "code.claude.com", "support.claude.com", "docs.claude.com",
  "openai.com", "developers.openai.com", "help.openai.com", "chatgpt.com", "cursor.com", "code.visualstudio.com",
  "docs.github.com", "antigravity.google", "google.com", "geminicli.com", "lovable.dev", "docs.lovable.dev",
  "nousresearch.com", "hermes-agent.nousresearch.com", "openclaw.ai", "docs.openclaw.ai", "opencode.ai", "lmstudio.ai",
  "n8n.io", "docs.n8n.io", "cline.bot", "docs.cline.bot", "warp.dev", "docs.warp.dev", "x.ai", "docs.x.ai",
  "manus.im", "windsurf.com", "docs.windsurf.com", "modelcontextprotocol.io", "agentskills.io", "llmstxt.org",
  "muse.ai", "platform.muse.ai", "meta.com", "remotion.dev", "www.remotion.dev", "capcut.com", "www.capcut.com",
  "developer.apple.com", "npmjs.com", "www.npmjs.com", "nodejs.org", "developers.cloudflare.com", "caddyserver.com",
  "jrsoftware.org", "www.warp.dev", "www.anthropic.com", "lovablebrand.lovable.app", "about.google",
];

function hostAllowed(host: string): boolean {
  return EXTERNAL_ALLOW.some((d) => host === d || host.endsWith(`.${d}`));
}

/** AC-CNT-04: internal links resolve, external links are https on official domains. */
export function linkProblems(): string[] {
  const out: string[] = [];
  const paths = new Set([...allRoutes().map((r) => r.path), ...MACHINE_PATHS]);
  const check = (where: string, href: string) => {
    if (href.startsWith("/")) {
      const clean = href.split("#")[0] ?? href;
      if (!paths.has(clean)) out.push(`${where}: internal link ${href} has no page`);
      return;
    }
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      out.push(`${where}: bad link ${href}`);
      return;
    }
    if (u.protocol !== "https:") out.push(`${where}: ${href} is not https`);
    else if (!hostAllowed(u.hostname)) out.push(`${where}: ${u.hostname} is not an official domain`);
  };
  for (const { path, text } of strings(contentRoot())) for (const href of linksIn(text)) check(path, href);
  for (const a of AGENTS) {
    check(`agent ${a.slug}.site`, a.site);
    check(`agent ${a.slug}.docsUrl`, a.docsUrl);
  }
  for (const c of CREDITS) check(`credit ${c.id}`, c.url);
  for (const u of USE_CASES) for (const d of u.docs) if (!DOCS.some((x) => x.slug === d)) out.push(`usecase ${u.slug}: doc ${d} missing`);
  for (const u of USE_CASES) for (const r of u.related) if (!USE_CASES.some((x) => x.slug === r)) out.push(`usecase ${u.slug}: related ${r} missing`);
  return out;
}

/** AC-WEB-SEO-01: title ≤ 60, description 70–160, unique per locale. */
export function seoProblems(): string[] {
  const out: string[] = [];
  const routes = allRoutes();
  for (const loc of LOCALES) {
    const titles = new Map<string, string>();
    const descs = new Map<string, string>();
    for (const r of routes) {
      const t = r.title[loc];
      const d = r.description[loc];
      if (t.length > 60) out.push(`${r.path} title.${loc} ${t.length} chars`);
      if (d.length < 70 || d.length > 160) out.push(`${r.path} description.${loc} ${d.length} chars`);
      if (titles.has(t)) out.push(`${r.path} title.${loc} duplicates ${titles.get(t)}`);
      if (descs.has(d)) out.push(`${r.path} description.${loc} duplicates ${descs.get(d)}`);
      titles.set(t, r.path);
      descs.set(d, r.path);
    }
  }
  return out;
}

/** AC-BRAND-01/02: brand references and logo policy. */
export function brandProblems(): string[] {
  const out: string[] = [];
  for (const a of AGENTS) if (!BRANDS.some((b) => b.id === a.brand)) out.push(`agent ${a.slug}: unknown brand ${a.brand}`);
  for (const b of BRANDS) {
    if (b.policy === "logo" && !b.asset) out.push(`brand ${b.id}: logo policy without a registered asset`);
    if (NEVER_LOGO.includes(b.id) && (b.policy === "logo" || b.asset)) out.push(`brand ${b.id}: logo never allowed`);
  }
  return out;
}

/** AC-WEB-AG-04 (part without file system) + R3-AG.3/5. */
export function agentProblems(): string[] {
  const out: string[] = [];
  const slugs = new Set<string>();
  for (const a of AGENTS) {
    if (slugs.has(a.slug)) out.push(`duplicate agent ${a.slug}`);
    slugs.add(a.slug);
    if (a.status === "verified" && !a.evidence) out.push(`${a.slug}: verified without evidence`);
    if (a.status !== "verified" && a.evidence) out.push(`${a.slug}: evidence present but not verified`);
    if (a.status === "later") {
      if (!a.laterReason) out.push(`${a.slug}: later without a reason`);
      if (a.config) out.push(`${a.slug}: later must not show a config`);
    } else if (a.status !== "hidden" && !a.config) out.push(`${a.slug}: no config`);
    if (a.config && /msk_[A-Za-z0-9_-]{8,}/.test(a.config.text.replaceAll("msk_YOUR_KEY", ""))) out.push(`${a.slug}: config contains a real-looking key`);
    if (a.config && /[?&](key|token|api_key)=/i.test(a.config.text)) out.push(`${a.slug}: key in URL`);
    for (const loc of LOCALES) {
      const s = a.summary[loc];
      if (s.length < 70 || s.length > 160) out.push(`${a.slug}: summary.${loc} ${s.length} chars (70–160)`);
    }
  }
  return out;
}

/** Use cases whose subject needs a disclosure reminder (R3-UC.4). */
export const NEEDS_DISCLOSURE = ["affiliate-videos", "short-ads", "sales-videos", "data-report-videos", "product-photos"];

/** AC-WEB-UC-02/05. */
export function useCaseProblems(): string[] {
  const out: string[] = [];
  for (const u of USE_CASES) {
    if (u.media.length < 1) out.push(`${u.slug}: no sample media`);
    if (u.limits.length < 1) out.push(`${u.slug}: no limits`);
    if (u.docs.length < 1) out.push(`${u.slug}: no docs`);
    if (u.related.length < 2) out.push(`${u.slug}: fewer than 2 related`);
    if (NEEDS_DISCLOSURE.includes(u.slug) && !u.disclosure) out.push(`${u.slug}: missing disclosure`);
    for (const loc of LOCALES) {
      const s = u.summary[loc];
      if (s.length < 70 || s.length > 160) out.push(`${u.slug}: summary.${loc} ${s.length} chars (70–160)`);
    }
  }
  return out;
}

/** AC-SKILL-02 / R3-SHOT: secrets or real addresses in any text. */
export function secretProblems(items: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  const allowedIp = /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
  for (const { path, text } of items) {
    for (const m of text.matchAll(/msk_[A-Za-z0-9_-]{8,}/g)) if (m[0] !== "msk_YOUR_KEY") out.push(`${path}: key-like ${m[0].slice(0, 8)}…`);
    for (const m of text.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)) if (!allowedIp.test(m[1] ?? "")) out.push(`${path}: IP ${m[1]}`);
    if (/C:\\Users\\(?!<|%|YOU)/i.test(text)) out.push(`${path}: user path`);
    for (const m of text.matchAll(/[a-z0-9-]+\.trycloudflare\.com/gi)) if (m[0].toLowerCase() !== "your-tunnel.trycloudflare.com") out.push(`${path}: tunnel host ${m[0]}`);
    for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) out.push(`${path}: email ${m[0]}`);
  }
  return out;
}

/** Shot ids referenced by articles (the capture list for P4). */
export function referencedShots(): string[] {
  const ids = new Set<string>();
  for (const d of DOCS) for (const s of d.steps) if (s.shot) ids.add(s.shot);
  for (const a of AGENTS) for (const s of a.steps) if (s.shot) ids.add(s.shot);
  return [...ids].sort();
}
