import { formatNumber } from "./format";
// Build 2.0 — generic bridge “Hỏi đáp” (spec R81–R84). Pure TypeScript: validation, naming, output limits.

export const CHAT_PROMPT_MAX = 32_000; // R81
export const CHAT_ATTACH_MAX = 10; // R82
export const CHAT_ATTACH_FILE_MAX = 20 * 1024 * 1024; // R82 = local transport cap (R10/R78)
export const CHAT_ATTACH_TOTAL_MAX = 50 * 1024 * 1024; // R82
export const CHAT_FILENAME_MAX = 120; // R82
export const CHAT_TEXT_MAX_BYTES = 1024 * 1024; // R83(a)
export const CHAT_OUTPUT_FILES_MAX = 20; // R83(c)
export const CHAT_OUTPUT_TURN_MAX_BYTES = 2 * 1024 ** 3; // R83(c)
export const CHAT_OUTPUT_FILE_MAX_BYTES = 1024 ** 3; // R83(c)
export const CHAT_PREVIEW_TEXT_MAX_BYTES = 2 * 1024 * 1024; // R84
/** MCP inline files (R110). */
export const MCP_INLINE_FILES_MAX = 4;
export const MCP_INLINE_TOTAL_MAX = 8 * 1024 * 1024;
export const CHAT_LIBRARY_FOLDER = "Hỏi đáp";

export type ChatPromptResult = { ok: true; value: string } | { ok: false; error: string };

/** R81 — trimmed, 1–32 000 characters (code points), sent verbatim. */
export function validateChatPrompt(text: unknown): ChatPromptResult {
  if (typeof text !== "string") return { ok: false, error: "Nhập lời nhắn cho Muse" };
  const value = text.trim();
  if (!value) return { ok: false, error: "Nhập lời nhắn cho Muse" };
  const len = [...value].length;
  if (len > CHAT_PROMPT_MAX) return { ok: false, error: `Lời nhắn dài ${formatNumber(len)} ký tự — tối đa ${formatNumber(CHAT_PROMPT_MAX)}` };
  return { ok: true, value };
}

export type DocumentMime = "text/csv" | "text/plain" | "text/markdown" | "application/json" | "application/pdf";
export const DOCUMENT_EXT: Record<DocumentMime, string> = {
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "application/pdf": "pdf",
};
const EXT_TO_DOC: Record<string, DocumentMime> = { csv: "text/csv", txt: "text/plain", text: "text/plain", md: "text/markdown", markdown: "text/markdown", json: "application/json", pdf: "application/pdf" };

export function extOf(name: string | null | undefined): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name ?? ""));
  return m ? m[1].toLowerCase() : "";
}

/** R82 — the name claims a Hỏi đáp document type (CSV/TXT/MD/JSON/PDF); its bytes still decide whether it is one. */
export function claimsDocument(name: string | null | undefined): boolean {
  return extOf(name) in EXT_TO_DOC;
}

function startsWith(b: Uint8Array, s: string, at = 0): boolean {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type DocumentCheck = { ok: true; mime: DocumentMime } | { ok: false; error: string };

/**
 * R82 — a document is decided by its bytes: PDF needs `%PDF-` and `%%EOF`; CSV/TXT/MD/JSON must be valid UTF-8
 * without NUL bytes, JSON must parse. The extension only picks between the text types (bytes cannot tell CSV from TXT).
 */
export function checkDocument(bytes: Uint8Array, filename: string | null | undefined): DocumentCheck {
  if (bytes.length === 0) return { ok: false, error: "Tệp rỗng" };
  if (startsWith(bytes, "%PDF-")) {
    const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
    return tail.includes("%%EOF") ? { ok: true, mime: "application/pdf" } : { ok: false, error: "Tệp PDF bị cắt hoặc hỏng" };
  }
  const ext = extOf(filename);
  if (EXT_TO_DOC[ext] === "application/pdf") return { ok: false, error: "Tệp không phải PDF hợp lệ" };
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // UTF-8 BOM
  const body = bytes.subarray(start);
  if (body.includes(0)) return { ok: false, error: "Tệp không phải văn bản (có byte nhị phân)" };
  const text = utf8(body);
  if (text === null) return { ok: false, error: "Tệp văn bản phải là UTF-8" };
  const wantJson = EXT_TO_DOC[ext] === "application/json";
  if (wantJson || (!ext && /^\s*[[{]/.test(text))) {
    try {
      JSON.parse(text);
      return { ok: true, mime: "application/json" };
    } catch {
      if (wantJson) return { ok: false, error: "Tệp JSON không đọc được" };
    }
  }
  const mime = EXT_TO_DOC[ext];
  if (mime) return { ok: true, mime };
  if (ext && !mime) return { ok: false, error: `Không nhận tệp .${ext}` };
  return { ok: true, mime: "text/plain" };
}

const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * R82 — display/storage name: no folders, no control or Windows-reserved characters, ≤ 120 characters, keeps a valid
 * extension; empty → `tep-{n}.{ext}`.
 */
export function sanitizeFilename(name: string | null | undefined, fallbackExt: string, n = 1): string {
  let base = String(name ?? "").normalize("NFC");
  base = base.split(/[\\/]/).pop() ?? "";
  base = base.replace(BAD_NAME, "").replace(/^[.\s]+|[.\s]+$/g, "").replace(/\s+/g, " ");
  const ext = extOf(base) || fallbackExt.replace(/^\./, "").toLowerCase();
  let stem = extOf(base) ? base.slice(0, -(extOf(base).length + 1)) : base;
  stem = stem.replace(/[.\s]+$/g, "");
  if (!stem || RESERVED.test(stem)) stem = stem ? `${stem}-` : `tep-${n}`;
  const room = Math.max(1, CHAT_FILENAME_MAX - (ext ? ext.length + 1 : 0));
  if ([...stem].length > room) stem = [...stem].slice(0, room).join("").replace(/[.\s]+$/g, "") || `tep-${n}`;
  return ext ? `${stem}.${ext}` : stem;
}

/** R83(a) — cut UTF-8 text at a character boundary to at most `maxBytes`. */
export function truncateUtf8(text: string, maxBytes = CHAT_TEXT_MAX_BYTES): { text: string; truncated: boolean } {
  const enc = new TextEncoder().encode(text);
  if (enc.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (enc[end] & 0xc0) === 0x80) end--; // never split a multi-byte character
  return { text: new TextDecoder().decode(enc.subarray(0, end)), truncated: true };
}

export interface DeclaredFile {
  path: string;
  mime: string | null;
  byteLen: number | null;
  name?: string | null;
}

/** R83(c) — keep files in Muse's order up to 20 files / 2 GiB per turn; one file above 1 GiB is skipped. */
export function limitOutputs<T extends DeclaredFile>(files: T[]): { kept: T[]; truncated: boolean } {
  const kept: T[] = [];
  let total = 0;
  let truncated = false;
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    if (kept.length >= CHAT_OUTPUT_FILES_MAX) {
      truncated = true;
      continue;
    }
    const size = f.byteLen ?? 0;
    if (size > CHAT_OUTPUT_FILE_MAX_BYTES || total + size > CHAT_OUTPUT_TURN_MAX_BYTES) {
      truncated = true;
      continue;
    }
    total += size;
    kept.push(f);
  }
  return { kept, truncated };
}

/** Extensions Windows can run or script: never opened from the app (R84), only “Mở thư mục”. */
export const RISKY_EXT = new Set([
  "exe", "dll", "bat", "cmd", "com", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "lnk", "hta", "cpl", "reg",
  "jar", "pif", "application", "gadget", "msc", "scf", "url", "inf", "sys", "html", "htm", "svg", "xml", "iso", "img", "vhd", "vhdx",
]);
/** File types the app may open with the system viewer on the user's click (R84). */
const OPENABLE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "webm", "mp3", "wav", "m4a", "ogg", "pdf", "txt", "md", "csv", "json"]);

export function canOpenFile(filename: string): boolean {
  const ext = extOf(filename);
  return OPENABLE_EXT.has(ext) && !RISKY_EXT.has(ext);
}

export function canPreviewText(filename: string, bytes: number): boolean {
  return ["txt", "md", "csv", "json"].includes(extOf(filename)) && bytes <= CHAT_PREVIEW_TEXT_MAX_BYTES;
}

/** Zone.Identifier stream content (R84): marks a downloaded file as from the Internet so Windows warns before running it. */
export const ZONE_IDENTIFIER = "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n";

/** Best extension for a stored output: sniffed type first, then the sanitized original. */
export function outputExt(sniffedExt: string | null, declaredName: string | null | undefined, declaredMime: string | null | undefined): string {
  if (sniffedExt) return sniffedExt;
  const fromName = extOf(declaredName);
  if (fromName) return fromName;
  const m = String(declaredMime ?? "").toLowerCase();
  const map: Record<string, string> = { "text/csv": "csv", "text/plain": "txt", "text/markdown": "md", "application/json": "json", "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3" };
  return map[m] ?? "bin";
}

/** Leaf name of a file path, `/` or `\\` separated (`/workspace/out/a b.csv` → `a b.csv`). */
export function leafName(path: string): string {
  const p = String(path ?? "").split("?")[0];
  const leaf = p.split(/[\\/]/).pop() ?? "";
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

/** One exact comparison of a sent prompt with Muse's copy of the user message (R68/R93): whitespace ends trimmed only. */
export function samePrompt(sent: string, seen: string | null | undefined): boolean {
  return String(seen ?? "").replace(/^\s*(You:|User message:)\s*/i, "").replace(/\s*👍\s*$/u, "").trim() === sent.trim();
}

const TURN_DONE = new Set(["completed", "failed", "cancelled"]);
/** R85 — a job continuing a conversation holds it until it ends (needs_review keeps it: the send may still be unresolved). */
export function nextBusyConversations(busy: Record<string, string> | undefined, j: { id: string; conversationId: string | null; state: string }): Record<string, string> | undefined {
  if (!j.conversationId) return busy;
  const cur = busy ?? {};
  if (!TURN_DONE.has(j.state)) return cur[j.conversationId] === j.id ? busy : { ...cur, [j.conversationId]: j.id };
  if (cur[j.conversationId] !== j.id) return busy;
  const next = { ...cur };
  delete next[j.conversationId];
  return next;
}

export type AnswerPart = { kind: "text"; text: string } | { kind: "code"; text: string; lang: string | null };
/**
 * S03c / AC-VIEW-04 — split an answer into plain text and fenced ``` code blocks (shown monospace). Every character of
 * the answer is kept: joining the parts back with their fences gives the original text; nothing is parsed as HTML.
 */
export function splitAnswer(text: string): AnswerPart[] {
  const out: AnswerPart[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "code", text: m[2].replace(/\n$/, ""), lang: m[1].trim() || null });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export type LinkPart = { kind: "text"; text: string } | { kind: "link"; text: string; url: string };
/** http(s) links inside answer text; trailing punctuation stays text. Other schemes (javascript:, file:) are never links. */
export function splitLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let url = m[0];
    while (/[.,;:!?)\]}»”’]$/.test(url)) url = url.slice(0, -1);
    if (!safeHttpUrl(url)) continue;
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "link", text: url, url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Only absolute http/https URLs (≤ 2 048 chars) may be opened outside the app. */
export function safeHttpUrl(url: string): boolean {
  if (url.length > 2048) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}
