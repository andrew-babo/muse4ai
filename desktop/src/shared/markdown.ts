// Safe, tiny Markdown reader for Muse answers. Output is plain data rendered by React (escaped) — no HTML ever runs.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "widget"; id: string };

/** Muse embeds interactive widgets as `[[hatch_widget:<id>]]`; they only work inside Muse itself. */
const WIDGET = /^\s*\[\[hatch_widget:([A-Za-z0-9-]+)\]\]\s*$/;
const WIDGET_INLINE = /\[\[hatch_widget:[A-Za-z0-9-]+\]\]/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (m[2]) out.push({ t: "strong", c: parseInline(tok.slice(2, -2)) });
    else out.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    const s = para.join("\n").replace(WIDGET_INLINE, "").trim();
    if (s) out.push({ t: "p", c: parseInline(s) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(WIDGET))) { flush(); out.push({ t: "widget", id: m[1] }); continue; }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) { flush(); out.push({ t: "h", level: Math.min(3, m[1].length) as 1 | 2 | 3, c: parseInline(m[2].replace(/\s*#+\s*$/, "")) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: "hr" }); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      out.push({ t: "quote", c: parseInline(q.join("\n")) });
      continue;
    }
    const ul = /^\s*[-*•+]\s+(.*)$/, ol = /^\s*(\d+)[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      flush();
      const ordered = !ul.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      const start = ordered ? Number(line.match(ol)![1]) : 1;
      while (i < lines.length) {
        const l = lines[i];
        const mm = l.match(re);
        if (mm) items.push(ordered ? mm[2] : mm[1]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += "\n" + l.trim();
        else break;
        i++;
      }
      i--;
      const parsed = items.map((s) => parseInline(s.replace(WIDGET_INLINE, "").trim()));
      out.push(ordered ? { t: "ol", start, items: parsed } : { t: "ul", items: parsed });
      continue;
    }
    if (/^\s*\*\*[^*\n]+\*\*\s*$/.test(line)) { flush(); para.push(line); flush(); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/** Plain text for copying: Markdown markers and widget tokens removed. */
export function plainText(text: string): string {
  return text.replace(WIDGET_INLINE, "").replace(/\*\*([^*\n]+?)\*\*/g, "$1").replace(/(^|\s)\*([^*\s][^*\n]*?)\*/g, "$1$2").replace(/^\s*#{1,6}\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
