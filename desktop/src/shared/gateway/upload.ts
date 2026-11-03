// Build 2.0 — large attachments on the direct channel (live PoC 01/11, docs/build-2.0/evidence/phase-9/).
//
// Muse closes the connection when one request is larger than about 4 MiB on the wire (a 3.25 MiB CSV sent inline was
// cut; 2.5 MiB inline answered exactly). Its own web app uploads bigger files into the account workspace first —
// POST /fs/write in 512 KiB pieces to a hidden `.upload-<uuid>.part`, /fs/stat size check, /fs/rename to the final
// name — and then sends a `file_ref` item. This module is that sequence, written once and checked in plain Node.
// No Electron or page imports.

/** Raw bytes per /fs/write request (base64 ≈ 700 KB on the wire — far below the per-request limit). */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;
/** Largest document sent inline in the chat request itself; bigger ones go through the workspace upload. */
export const INLINE_DOC_MAX_BYTES = 2 * 1024 * 1024;
/** Workspace folder Muse's web app uploads attachments to (paths are relative: Muse refuses absolute ones). */
export const UPLOAD_DIR = "workspace/user/files/";
/** Per-request wait for one /fs/* reply (a 512 KiB piece over a slow proxy took ~10 s live). */
export const FS_REQUEST_TIMEOUT_MS = 120_000;

export type FsOp = "write" | "stat" | "rename" | "delete";

/** Normalised /fs/* reply (what the page returns; checked by the bridge schema in main). */
export interface FsReply {
  status: number | null;
  ok: boolean;
  size: number | null;
  kind: string | null;
  error: string | null;
}

/** Only files directly in the upload folder, plain names, no traversal, no leading slash. */
export function isUploadPath(p: unknown): p is string {
  if (typeof p !== "string" || !p.startsWith(UPLOAD_DIR) || p.length > 300) return false;
  const leaf = p.slice(UPLOAD_DIR.length);
  return /^[A-Za-z0-9._-]{1,200}$/.test(leaf) && leaf !== "." && leaf !== ".." && !leaf.includes("..");
}

/** The /fs/* bodies the page may forward: every path in them must be an upload path. */
export function fsBodyAllowed(op: unknown, body: unknown): op is FsOp {
  if (op !== "write" && op !== "stat" && op !== "rename" && op !== "delete") return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (op === "rename") return isUploadPath(b.source) && isUploadPath(b.destination);
  return isUploadPath(b.path);
}

/** Muse's own naming: safe stem + counter + 4 random chars + safe extension, under UPLOAD_DIR. */
export function uploadTarget(filename: string, seq: number, rand4: string, uuid: string): { final: string; part: string } {
  const dot = filename.lastIndexOf(".");
  const stemRaw = dot > 0 ? filename.slice(0, dot) : filename;
  const extRaw = dot > 0 ? filename.slice(dot) : "";
  const stem = (stemRaw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_").slice(0, 120) || "file").replace(/^\.+/, "_");
  const ext = extRaw.replace(/[^a-zA-Z0-9.]/g, "_").replace(/\.{2,}/g, ".").slice(0, 16);
  const tag = rand4.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "0000";
  return { final: `${UPLOAD_DIR}${stem}_${seq}_${tag}${ext}`, part: `${UPLOAD_DIR}.upload-${uuid.replace(/[^a-f0-9-]/gi, "")}.part` };
}

export interface UploadDeps {
  fs(op: FsOp, body: Record<string, unknown>): Promise<FsReply>;
  toBase64(bytes: Uint8Array): string;
  signal?: AbortSignal;
  onProgress?(sentBytes: number, totalBytes: number): void;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly step: FsOp | "size",
    readonly status: number | null,
  ) {
    super(message);
  }
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadError("Đã huỷ tải tệp lên", "write", null);
}

/**
 * Uploads `data` to `target.part` piece by piece, checks the size, renames it to `target.final` and returns that path.
 * On any failure the part file is deleted (best effort) and an UploadError is thrown — nothing was sent to the chat
 * yet, so the caller may retry the whole job safely.
 */
export async function uploadToWorkspace(deps: UploadDeps, data: Uint8Array, target: { final: string; part: string }): Promise<string> {
  if (!isUploadPath(target.final) || !isUploadPath(target.part)) throw new UploadError("Đường dẫn tải lên không hợp lệ", "write", null);
  const total = data.length;
  const pieces = Math.max(1, Math.ceil(total / UPLOAD_CHUNK_BYTES));
  try {
    for (let i = 0; i < pieces; i++) {
      aborted(deps.signal);
      const piece = data.subarray(i * UPLOAD_CHUNK_BYTES, Math.min(total, (i + 1) * UPLOAD_CHUNK_BYTES));
      const r = await deps.fs("write", { path: target.part, data_base64: deps.toBase64(piece), overwrite: i === 0, append: i !== 0, create_parent: i === 0 });
      if (!r.ok) throw new UploadError(`Muse không nhận phần ${i + 1}/${pieces} của tệp${r.error ? `: ${r.error}` : ""}`, "write", r.status);
      deps.onProgress?.(Math.min(total, (i + 1) * UPLOAD_CHUNK_BYTES), total);
    }
    aborted(deps.signal);
    const st = await deps.fs("stat", { path: target.part });
    if (!st.ok || st.kind !== "file" || st.size !== total) throw new UploadError(`Tệp trên Muse sai kích thước (${st.size ?? "?"}/${total} byte)`, "size", st.status);
    const rn = await deps.fs("rename", { source: target.part, destination: target.final, create_parent: true, overwrite: true });
    if (!rn.ok) throw new UploadError(`Muse không đổi tên tệp đã tải lên${rn.error ? `: ${rn.error}` : ""}`, "rename", rn.status);
    return target.final;
  } catch (e) {
    await deps.fs("delete", { path: target.part, recursive: false }).catch(() => undefined);
    throw e instanceof UploadError ? e : new UploadError(String((e as Error)?.message ?? e).slice(0, 200), "write", null);
  }
}

/** Page side: a raw /fs/* JSON reply → FsReply (never echoes file contents). */
export function normaliseFsReply(status: number | null, data: unknown): FsReply {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const res = d.result && typeof d.result === "object" ? (d.result as Record<string, unknown>) : {};
  const err = d.error && typeof d.error === "object" ? (d.error as Record<string, unknown>) : null;
  const ok = status === 200 && d.ok === true;
  return {
    status,
    ok,
    size: typeof res.size === "number" ? res.size : null,
    kind: typeof res.kind === "string" ? res.kind.slice(0, 40) : null,
    error: err ? `${String(err.code ?? "")} ${String(err.message ?? "")}`.trim().slice(0, 200) || null : ok ? null : status === null ? "timeout" : `HTTP ${status}`,
  };
}
