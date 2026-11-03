import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chatRelParts, libraryRelParts } from "../shared/naming";
import { checkDocument, DOCUMENT_EXT, extOf, outputExt, sanitizeFilename, ZONE_IDENTIFIER } from "../shared/chat";
import type { JobKind } from "../shared/types";
import { MIME_EXT, sniffImageMime, sniffMediaMime, validateReference, validateVideoReference } from "../shared/validate";

// R10 (references) and R13 (download → staging → verify → sha256 → atomic rename).

export interface ProbeResult {
  width: number;
  height: number;
  durationMs: number | null;
  thumbnail?: Uint8Array | null; // JPEG
}

/** Decodes a file with the real media engine (hidden Chromium window in the app; fake in tests). Throws if not decodable. */
export type MediaProbe = (filePath: string, mime: string) => Promise<ProbeResult>;

export class InvalidMediaError extends Error {}

export interface StoredMedia {
  path: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number;
}

/** A stored chat output (R83/R84): media goes through the same decode check as R13, anything else is a file. */
export interface StoredOutput extends StoredMedia {
  kind: "image" | "video" | "file";
  filename: string;
  zoneMarked: boolean;
}

export class MediaStore {
  constructor(
    private opts: {
      libraryDir: () => string;
      thumbsDir: string;
      refsDir: string;
      probe: MediaProbe;
    },
  ) {}

  stagingRoot(): string {
    return path.join(this.opts.libraryDir(), ".muse-staging");
  }

  stagingDir(jobId: string): string {
    return path.join(this.stagingRoot(), jobId);
  }

  thumbPath(sha256: string): string {
    return path.join(this.opts.thumbsDir, `${sha256}.jpg`);
  }

  /** B8 — staging lives on the library volume so the final rename is atomic. */
  async store(opts: {
    jobId: string;
    n: number;
    bytes: Uint8Array;
    expectedKind: JobKind;
    batchName: string | null;
    at: number;
    existingShas: string[];
    chain?: { id: string; step: number } | null;
  }): Promise<StoredMedia | { duplicateOf: string }> {
    if (!opts.bytes || opts.bytes.length === 0) throw new InvalidMediaError("Tệp tải về rỗng");
    const mime = sniffMediaMime(opts.bytes);
    if (!mime) throw new InvalidMediaError("Tệp tải về không phải ảnh/video hợp lệ");
    const kind: JobKind = mime.startsWith("video/") ? "video" : "image";
    if (kind !== opts.expectedKind) throw new InvalidMediaError(kind === "image" ? "Muse trả về ảnh thay vì video" : "Muse trả về video thay vì ảnh");
    const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
    if (opts.existingShas.includes(sha256)) return { duplicateOf: sha256 };
    const dir = this.stagingDir(opts.jobId);
    fs.mkdirSync(dir, { recursive: true });
    hideOnWindows(this.stagingRoot());
    const ext = MIME_EXT[mime] ?? "bin";
    const tmp = path.join(dir, `${randomUUID()}.${ext}.part`);
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, opts.bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    let probe: ProbeResult;
    try {
      probe = await this.opts.probe(tmp, mime);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new InvalidMediaError(`Không giải mã được tệp: ${(e as Error).message}`);
    }
    if (!(probe.width > 0 && probe.height > 0) || (kind === "video" && !(probe.durationMs && probe.durationMs > 0))) {
      fs.rmSync(tmp, { force: true });
      throw new InvalidMediaError("Tệp không có kích thước/độ dài hợp lệ");
    }
    const parts = libraryRelParts({ at: opts.at, batchName: opts.batchName, kind, jobId: opts.jobId, n: opts.n, ext, chain: opts.chain ?? null });
    const fileName = parts[parts.length - 1];
    const finalDir = path.join(this.opts.libraryDir(), ...parts.slice(0, -1));
    fs.mkdirSync(finalDir, { recursive: true });
    let finalPath = path.join(finalDir, fileName);
    let k = 1;
    while (fs.existsSync(finalPath)) finalPath = path.join(finalDir, fileName.replace(/\.(\w+)$/, `-${k++}.$1`));
    fs.renameSync(tmp, finalPath);
    if (probe.thumbnail?.length) {
      fs.mkdirSync(this.opts.thumbsDir, { recursive: true });
      fs.writeFileSync(this.thumbPath(sha256), probe.thumbnail);
    }
    return { path: finalPath, sha256, mime, width: probe.width, height: probe.height, durationMs: probe.durationMs, bytes: opts.bytes.length };
  }

  /**
   * Build 2.0 R83(b)/R84 — one file Muse returned for a chat turn: staging → size check → SHA-256 → type by bytes.
   * Images/videos are decoded (R13) and become library media; anything else is a file marked as downloaded from the
   * Internet (Zone.Identifier ZoneId=3). Never opened or executed here.
   */
  async storeChatOutput(opts: { jobId: string; n: number; bytes: Uint8Array; declaredName: string | null; declaredMime: string | null; declaredBytes: number | null; at: number; existingShas: string[] }): Promise<StoredOutput | { duplicateOf: string }> {
    if (!opts.bytes || opts.bytes.length === 0) throw new InvalidMediaError("Tệp tải về rỗng");
    if (opts.declaredBytes !== null && opts.declaredBytes !== opts.bytes.length) throw new InvalidMediaError(`Tệp thiếu byte (${opts.bytes.length}/${opts.declaredBytes})`);
    const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
    if (opts.existingShas.includes(sha256)) return { duplicateOf: sha256 };
    const media = sniffMediaMime(opts.bytes);
    let mime: string;
    let ext: string;
    let kind: StoredOutput["kind"];
    if (media) {
      mime = media;
      ext = MIME_EXT[media] ?? "bin";
      kind = media.startsWith("video/") ? "video" : "image";
    } else {
      const doc = checkDocument(opts.bytes, opts.declaredName);
      mime = doc.ok ? doc.mime : "application/octet-stream";
      ext = doc.ok ? DOCUMENT_EXT[doc.mime] : outputExt(null, opts.declaredName, opts.declaredMime);
      kind = "file";
    }
    const base = sanitizeFilename(opts.declaredName, ext, opts.n);
    const filename = extOf(base) === ext ? base : sanitizeFilename(`${base.replace(/\.[A-Za-z0-9]{1,10}$/, "")}.${ext}`, ext, opts.n);
    const dir = this.stagingDir(opts.jobId);
    fs.mkdirSync(dir, { recursive: true });
    hideOnWindows(this.stagingRoot());
    const tmp = path.join(dir, `${randomUUID()}.${ext}.part`);
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, opts.bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    let width = 0;
    let height = 0;
    let durationMs: number | null = null;
    let thumb: Uint8Array | null | undefined = null;
    if (kind !== "file") {
      let probe: ProbeResult;
      try {
        probe = await this.opts.probe(tmp, mime);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw new InvalidMediaError(`Không giải mã được tệp: ${(e as Error).message}`);
      }
      if (!(probe.width > 0 && probe.height > 0) || (kind === "video" && !(probe.durationMs && probe.durationMs > 0))) {
        fs.rmSync(tmp, { force: true });
        throw new InvalidMediaError("Tệp không có kích thước/độ dài hợp lệ");
      }
      ({ width, height, durationMs } = probe);
      thumb = probe.thumbnail;
    }
    const parts = chatRelParts({ at: opts.at, jobId: opts.jobId, n: opts.n, filename });
    const finalDir = path.join(this.opts.libraryDir(), ...parts.slice(0, -1));
    fs.mkdirSync(finalDir, { recursive: true });
    let finalPath = path.join(finalDir, parts[parts.length - 1]);
    let k = 1;
    while (fs.existsSync(finalPath)) finalPath = path.join(finalDir, parts[parts.length - 1].replace(/(\.[A-Za-z0-9]{1,10})?$/, (m) => `-${k++}${m}`));
    fs.renameSync(tmp, finalPath);
    let zoneMarked = false;
    if (kind === "file") zoneMarked = markFromInternet(finalPath);
    if (thumb?.length) {
      fs.mkdirSync(this.opts.thumbsDir, { recursive: true });
      fs.writeFileSync(this.thumbPath(sha256), thumb);
    }
    return { path: finalPath, sha256, mime, width, height, durationMs, bytes: opts.bytes.length, kind, filename: path.basename(finalPath), zoneMarked };
  }

  /** Build 2.0 R82 — a document attachment (CSV/TXT/MD/JSON/PDF) copied into app staging by hash. */
  importDocument(bytes: Uint8Array, filename: string | null): { sha256: string; path: string; mime: string; bytes: number; filename: string } {
    const doc = checkDocument(bytes, filename);
    if (!doc.ok) throw new InvalidMediaError(doc.error);
    const ext = DOCUMENT_EXT[doc.mime];
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.mkdirSync(this.opts.refsDir, { recursive: true });
    const file = path.join(this.opts.refsDir, `${sha256}.${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
    return { sha256, path: file, mime: doc.mime, bytes: bytes.length, filename: sanitizeFilename(filename, ext, 1) };
  }

  cleanupStaging(jobId: string): void {
    fs.rmSync(this.stagingDir(jobId), { recursive: true, force: true });
  }

  /** Removes orphan staging folders on startup (B8). */
  cleanupOrphans(activeJobIds: Set<string>): number {
    const root = this.stagingRoot();
    if (!fs.existsSync(root)) return 0;
    let n = 0;
    for (const d of fs.readdirSync(root)) {
      if (!activeJobIds.has(d)) {
        fs.rmSync(path.join(root, d), { recursive: true, force: true });
        n++;
      }
    }
    return n;
  }

  async regenerateThumb(filePath: string, mime: string, sha256: string): Promise<string | null> {
    const r = await this.opts.probe(filePath, mime);
    if (!r.thumbnail?.length) return null;
    fs.mkdirSync(this.opts.thumbsDir, { recursive: true });
    fs.writeFileSync(this.thumbPath(sha256), r.thumbnail);
    return this.thumbPath(sha256);
  }

  /** R10 — copy reference into app staging by hash; never send arbitrary paths/URLs. */
  async importReference(bytes: Uint8Array): Promise<{ sha256: string; path: string; mime: string; width: number; height: number; bytes: number; durationMs: number | null }> {
    const mime = sniffMediaMime(bytes) ?? "application/octet-stream";
    const isVideo = mime === "video/mp4";
    const pre = isVideo ? validateVideoReference({ mime, bytes: bytes.length, width: 1, height: 1, durationMs: 1 }) : validateReference({ mime, bytes: bytes.length, width: 1, height: 1 });
    if (!pre.ok) throw new InvalidMediaError(pre.reason);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.mkdirSync(this.opts.refsDir, { recursive: true });
    const file = path.join(this.opts.refsDir, `${sha256}.${MIME_EXT[mime]}`);
    const created = !fs.existsSync(file);
    if (created) fs.writeFileSync(file, bytes);
    let probe: ProbeResult;
    try {
      probe = await this.opts.probe(file, mime);
    } catch {
      if (created) fs.rmSync(file, { force: true });
      throw new InvalidMediaError("Không giải mã được tệp tham chiếu");
    }
    const meta = { mime, bytes: bytes.length, width: probe.width, height: probe.height, durationMs: probe.durationMs };
    const v = isVideo ? validateVideoReference(meta) : validateReference(meta);
    if (!v.ok) {
      if (created) fs.rmSync(file, { force: true });
      throw new InvalidMediaError(v.reason);
    }
    return { sha256, path: file, ...meta };
  }
}

/** R84 — Zone.Identifier stream (NTFS only): Windows then warns before opening the file. Best effort elsewhere. */
function markFromInternet(p: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    fs.writeFileSync(`${p}:Zone.Identifier`, ZONE_IDENTIFIER);
    return true;
  } catch {
    return false;
  }
}

function hideOnWindows(p: string): void {
  if (process.platform !== "win32") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:child_process").execFile("attrib", ["+h", p], () => undefined);
  } catch {
    /* best effort */
  }
}

/** Minimal image size reader for tests/fallback (PNG/JPEG/WEBP headers). */
export function readImageSize(buf: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (mime === "image/png" && buf.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (mime === "image/webp" && buf.length >= 30) {
    const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (chunk === "VP8X") return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}
