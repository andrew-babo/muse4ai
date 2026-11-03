import { ALIAS_MAX, PROMPT_MAX, REF_MAX_BYTES, REF_MAX_EDGE, REF_MIMES } from "./constants";
import { formatNumber } from "./format";

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

/** R17 — 1–4.000 characters after trimming. AC-GEN-03. */
export function validatePrompt(raw: string): Check<string> {
  const v = (raw ?? "").trim();
  if (v.length === 0) return { ok: false, reason: "Nhập mô tả trước khi gửi" };
  if (v.length > PROMPT_MAX) return { ok: false, reason: `Prompt quá ${formatNumber(PROMPT_MAX)} ký tự (đang là ${formatNumber(v.length)})` };
  return { ok: true, value: v };
}

export interface RefMeta {
  mime: string;
  bytes: number;
  width: number;
  height: number;
}

/** R10 — PNG/JPEG/WEBP, ≤ 20 MB, edge ≤ 8.192 px. AC-GEN-04. */
export function validateReference(m: RefMeta): Check<RefMeta> {
  if (!(REF_MIMES as readonly string[]).includes(m.mime)) return { ok: false, reason: "Chỉ nhận ảnh PNG, JPEG hoặc WEBP" };
  if (m.bytes > REF_MAX_BYTES) return { ok: false, reason: `Ảnh vượt ${REF_MAX_BYTES / 1024 / 1024} MB` };
  if (m.bytes <= 0) return { ok: false, reason: "Tệp ảnh trống" };
  if (m.width <= 0 || m.height <= 0) return { ok: false, reason: "Không đọc được kích thước ảnh" };
  if (m.width > REF_MAX_EDGE || m.height > REF_MAX_EDGE) return { ok: false, reason: `Cạnh ảnh vượt ${formatNumber(REF_MAX_EDGE)} px` };
  return { ok: true, value: m };
}

/** R78 — transport bound, not a claimed provider video-duration limit. */
export function validateVideoReference(m: RefMeta & { durationMs: number | null }): Check<typeof m> {
  if (m.mime !== "video/mp4") return { ok: false, reason: "Chỉ nhận video MP4" };
  if (!Number.isFinite(m.bytes) || m.bytes <= 0 || m.bytes > REF_MAX_BYTES) return { ok: false, reason: "Video phải có dữ liệu và không vượt 20 MB" };
  if (![m.width, m.height, m.durationMs].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return { ok: false, reason: "Không đọc được kích thước hoặc độ dài video" };
  return { ok: true, value: m };
}

/** Sniff image type from magic bytes (do not trust file extensions). */
export function sniffImageMime(buf: Uint8Array): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "image/webp";
  if (buf.length >= 6 && ascii(buf, 0, 4) === "GIF8") return "image/gif";
  return null;
}

/** Sniff media type of a downloaded result (R13, AC-JOB-07: HTML named .mp4 is rejected). */
export function sniffMediaMime(buf: Uint8Array): string | null {
  const img = sniffImageMime(buf);
  if (img) return img;
  if (buf.length >= 12 && ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (brand.startsWith("qt")) return "video/quicktime";
    return "video/mp4";
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

function ascii(buf: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
}

export const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Account alias: required, 1–32 chars, unique case-insensitively (AC-ACC-01). */
export function validateAlias(raw: string, existing: string[], selfAlias?: string): Check<string> {
  const v = (raw ?? "").trim();
  if (v.length === 0) return { ok: false, reason: "Nhập tên gọi" };
  if (v.length > ALIAS_MAX) return { ok: false, reason: `Tên gọi tối đa ${ALIAS_MAX} ký tự` };
  const lower = v.toLocaleLowerCase("vi");
  if (existing.some((e) => e.toLocaleLowerCase("vi") === lower && e !== selfAlias)) return { ok: false, reason: `Đã có tài khoản tên “${v}”` };
  return { ok: true, value: v };
}
