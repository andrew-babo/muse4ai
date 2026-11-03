import { z } from "zod";
import { INLINE_DOC_MAX_BYTES, isUploadPath } from "./upload";

// Build 2.0 §4.6 — every message from the channel page is checked here before the main process uses it. A message
// that fails the schema (or is too large) is a protocol mismatch (R89(c)). Nothing in these shapes can carry a token.

export const BRIDGE_CHUNK_MAX = 4 * 1024 * 1024; // R95
const B64_CHUNK_MAX = Math.ceil(BRIDGE_CHUNK_MAX / 3) * 4;

const shortStr = (n: number) => z.string().max(n);
const reset = z.object({ code: z.number().int(), reason: shortStr(200) }).nullable();
const gwError = z.object({ code: shortStr(100).nullable(), message: shortStr(300).nullable() });
const gwFile = z.object({ path: shortStr(4_000), mime: shortStr(200).nullable(), byteLen: z.number().nonnegative().nullable(), name: shortStr(400).nullable() });

export const ConnectResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), vmState: shortStr(50).nullable(), woke: z.boolean().optional() }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["connect_failed", "stream_lost", "protocol_mismatch", "fetch_failed"]),
    step: shortStr(30).nullable(),
    status: z.number().int().nullable(),
    message: shortStr(300),
  }),
]);
export type ConnectResult = z.infer<typeof ConnectResult>;

export const StreamResult = z.object({ stream: z.number().int().positive() });

export const AckResult = z.object({
  done: z.boolean(),
  status: z.number().int().nullable(),
  ack: z.object({ sessionId: shortStr(100).nullable(), isThread: z.boolean().nullable(), ok: z.boolean().nullable(), error: gwError.nullable() }).nullable(),
  reset,
});
export type AckResult = z.infer<typeof AckResult>;

export const PollResult = z.object({
  next: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  events: z
    .array(
      z.object({
        sess: shortStr(100).nullable(),
        seq: z.number().nullable(),
        kind: z.enum(["status", "files", "user", "done", "error", "other"]),
        status: shortStr(50).optional(),
        files: z.array(gwFile).max(200).optional(),
        error: gwError.optional(),
        at: z.number(),
      }),
    )
    .max(2_000),
  open: z.boolean(),
});
export type PollResult = z.infer<typeof PollResult>;

const turn = z.object({
  user: z.object({ text: shortStr(40_000), atMs: z.number().nullable() }),
  assistant: z.object({ text: shortStr(8 * 1024 * 1024), ready: z.boolean(), final: z.boolean(), updatedAtMs: z.number().nullable() }).nullable(),
  status: shortStr(50).nullable(),
  files: z.array(gwFile).max(500),
});
export const HistoryResult = z.object({
  status: z.number().int().nullable(),
  history: z.object({ turns: z.array(turn).max(1_000), userMsgs: z.number().int().nonnegative(), unknownShape: z.boolean() }).nullable(),
  reset,
});
export type HistoryResult = z.infer<typeof HistoryResult>;

/** `/api/session/list` reduced to id + state (R94 done signal for replies without an answer message). */
export const SessionsResult = z.object({
  status: z.number().int().nullable(),
  sessions: z.array(z.object({ id: shortStr(100), status: shortStr(50).nullable(), updatedAtMs: z.number().nullable() })).max(200).nullable(),
  reset,
});
export type SessionsResult = z.infer<typeof SessionsResult>;

/** Start of a streamed download (R95): the page holds only what arrived since main's last `fileNext`. */
export const FileStartResult = z.object({
  fid: shortStr(40).nullable(),
  status: z.number().int().nullable(),
  contentType: shortStr(200).nullable(),
  /** Content-length when Muse sent one; the total taken must then match it. */
  length: z.number().int().nonnegative().nullable(),
  reset,
});
export type FileStartResult = z.infer<typeof FileStartResult>;

export const FileChunkResult = z.string().max(B64_CHUNK_MAX).regex(/^[A-Za-z0-9+/]*={0,2}$/);

/** The next piece of a streamed download (≤ BRIDGE_CHUNK_MAX bytes); `done` after the last one. */
export const FileNextResult = z.object({ b64: FileChunkResult, done: z.boolean(), reset, timedOut: z.boolean() });
export type FileNextResult = z.infer<typeof FileNextResult>;

export const ProbeResult = z.object({ ok: z.boolean(), status: z.number().int().nullable(), step: shortStr(30).nullable(), message: shortStr(300) });
export type ProbeResult = z.infer<typeof ProbeResult>;

export const StateResult = z.object({ installed: z.boolean(), open: z.boolean(), openedAt: z.number().nullable(), closedCode: z.number().int().nullable(), errors: z.number().int().nonnegative() });
export type StateResult = z.infer<typeof StateResult>;

/** Inline file item for `/chat/stream` (the web composer's shape, research §7.4 IO-G1). Built in main, checked again here. */
export const SendItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(32_000) }),
  z.object({ type: z.literal("file"), mime_type: shortStr(100), data_base64: z.string().max(Math.ceil(INLINE_DOC_MAX_BYTES / 3) * 4 + 4), filename: shortStr(120) }),
  /** Inline image (Muse's web app always sends images this way). */
  z.object({ type: z.literal("image"), mime_type: shortStr(100), data_base64: z.string().max(Math.ceil(INLINE_DOC_MAX_BYTES / 3) * 4 + 4), filename: shortStr(120) }),
  /** A file already uploaded into the account workspace (upload.ts) — how Muse's web app attaches big files. */
  z.object({ type: z.literal("file_ref"), mime_type: shortStr(100), path: z.string().refine(isUploadPath, "upload path"), filename: shortStr(120) }),
]);
export type SendItem = z.infer<typeof SendItem>;

/** One /fs/* reply of the workspace upload (upload.ts normaliseFsReply). Carries sizes and error text only. */
export const FsResult = z.object({ status: z.number().int().nullable(), ok: z.boolean(), size: z.number().nonnegative().nullable(), kind: shortStr(40).nullable(), error: shortStr(200).nullable() });
export type FsResult = z.infer<typeof FsResult>;
