import { GLOSSARY } from "./glossary";
import type { Locale } from "./types";

/**
 * Tiny inline markup used inside content strings, rendered the same way by the
 * app and the website: **bold**, `code`, [label](/docs/slug or https://…).
 * Line breaks: "\n\n" starts a new paragraph, "\n- " starts a list item.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "term"; v: string; id: string };

const TOKEN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) out.push({ t: "link", v: m[3], href: m[4] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Every link target in a string (for AC-CNT-04). */
export function linksIn(text: string): string[] {
  return parseInline(text).flatMap((x) => (x.t === "link" ? [x.href] : []));
}

/** Plain text without markup (for search, meta and Markdown mirrors that strip it). */
export function plain(text: string): string {
  return parseInline(text)
    .map((x) => x.v)
    .join("");
}

/** Converts the inline markup to Markdown (/docs/<slug>.md, llms-full.txt). */
export function toMarkdown(text: string, absolute: (href: string) => string): string {
  return parseInline(text)
    .map((x) => {
      if (x.t === "b") return `**${x.v}**`;
      if (x.t === "code") return `\`${x.v}\``;
      if (x.t === "link") return `[${x.v}](${absolute(x.href)})`;
      return x.v;
    })
    .join("");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits plain text tokens so the first use of each glossary term on a page
 * becomes a term link (AC-CNT-06). `seen` carries state across one page.
 */
export function withTerms(tokens: Inline[], locale: Locale, seen: Set<string>): Inline[] {
  const out: Inline[] = [];
  for (const tok of tokens) {
    if (tok.t !== "text") {
      out.push(tok);
      continue;
    }
    let rest = tok.v;
    for (;;) {
      let best: { at: number; len: number; id: string } | undefined;
      for (const g of GLOSSARY) {
        if (seen.has(g.id)) continue;
        for (const word of g.match[locale]) {
          // Not inside paths, file names, keys or URLs: "~/.cursor/mcp.json" has no term.
          const re = new RegExp(`(^|[^\\p{L}\\p{N}_/\\\\.~\\-])(${escapeRe(word)})(?=$|[^\\p{L}\\p{N}_/\\\\\\-]|\\.(?![\\p{L}\\p{N}]))`, "iu");
          const m = re.exec(rest);
          if (m) {
            const at = m.index + (m[1]?.length ?? 0);
            if (!best || at < best.at) best = { at, len: m[2]?.length ?? word.length, id: g.id };
          }
        }
      }
      if (!best) break;
      if (best.at > 0) out.push({ t: "text", v: rest.slice(0, best.at) });
      out.push({ t: "term", v: rest.slice(best.at, best.at + best.len), id: best.id });
      seen.add(best.id);
      rest = rest.slice(best.at + best.len);
    }
    if (rest) out.push({ t: "text", v: rest });
  }
  return out;
}

/** Splits a body into paragraphs and list items. */
export type Block = { t: "p"; v: string } | { t: "ul"; items: string[] };

export function blocks(body: string): Block[] {
  const out: Block[] = [];
  for (const para of body.split(/\n{2,}/)) {
    const lines = para.split("\n");
    const items = lines.filter((x) => x.startsWith("- ")).map((x) => x.slice(2));
    const text = lines.filter((x) => !x.startsWith("- ")).join(" ").trim();
    if (text) out.push({ t: "p", v: text });
    if (items.length) out.push({ t: "ul", items });
  }
  return out;
}

/** Step titles in content may start with "1. "; pages and mirrors number steps themselves. */
export function stepTitle(title: string): string {
  return title.replace(/^\s*\d+\.\s*/, "");
}
