import { z } from "zod";
import { REF_MAX_PER_JOB, REPEAT_MAX, REPEAT_MIN } from "../constants";
import type { ChainPlan, ExtendMode } from "../types";
import { EXTEND_DIRECTIVE_MAX, EXTEND_TARGET_MAX_S, EXTEND_TARGET_MIN_S, EXTEND_TARGET_STEP_S, normaliseDirective } from "../vibes";
import { API_IDEMPOTENCY_MAX, API_LIST_MAX, API_WAIT_MAX_S } from "./constants";
import { ApiError } from "./problem";
import { tl, type Locale } from "../i18n";

// §4.8 request bodies. Unknown fields are refused so typos surface instead of being ignored.

export const createJobSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    prompt: z.string(),
    mode: z.enum(["text", "reference"]).optional(),
    reference_id: z.string().min(1).max(100).optional(),
    reference_asset_id: z.string().min(1).max(100).optional(),
    reference_ids: z.array(z.string().min(1).max(100)).min(1).max(REF_MAX_PER_JOB).optional(),
    repeat: z.number().int().optional(),
    account: z.string().min(1).max(100).optional(),
    site: z.enum(["muse", "vibes"]).optional(),
  })
  .strict();
export type CreateJobBody = z.infer<typeof createJobSchema>;

/** Build 2.0 R109 — the generic Hỏi đáp body. No `repeat`/`mode`/`site` (strict → 400). */
export const chatCreateSchema = z
  .object({
    kind: z.literal("chat"),
    prompt: z.string(),
    attachments: z.array(z.string().min(1).max(100)).max(10).optional(),
    conversation_id: z.string().min(1).max(100).optional(),
    account: z.string().min(1).max(100).optional(),
  })
  .strict();
export type ChatCreateBody = z.infer<typeof chatCreateSchema>;
export interface NormalisedChat {
  kind: "chat";
  prompt: string;
  attachments: string[];
  conversation_id: string | null;
  account: string;
}
/** Defaults filled so equal requests have equal fingerprints (R27). Attachment order is kept (it is what Muse gets). */
export function normaliseChat(b: ChatCreateBody): NormalisedChat {
  return { kind: "chat", prompt: b.prompt, attachments: b.attachments ?? [], conversation_id: b.conversation_id ?? null, account: (b.account ?? "auto").trim() || "auto" };
}

export interface NormalisedCreate {
  kind: "image" | "video";
  mode: "text" | "reference";
  prompt: string;
  reference_id: string | null;
  reference_asset_id: string | null;
  /** Present only when the caller sent the array, so single-reference fingerprints stay as before (R27). */
  reference_ids?: string[];
  repeat: number;
  account: string;
  /** Present only for Vibes, so the fingerprint of a Muse request is the same as before rev 6 (R27). */
  site?: "vibes";
}

/** Fills defaults so equal requests have equal fingerprints (R27). Range checks for repeat live here (R11). */
export function normaliseCreate(b: CreateJobBody): NormalisedCreate {
  const ids = b.reference_ids ?? (b.reference_id ? [b.reference_id] : []);
  const hasRef = !!(ids.length || b.reference_asset_id);
  if (b.reference_id && b.reference_asset_id) throw invalid("Chỉ gửi một trong `reference_id` hoặc `reference_asset_id`", "reference_id");
  if (b.reference_ids && (b.reference_id || b.reference_asset_id)) throw invalid("`reference_ids` không dùng kèm `reference_id` hoặc `reference_asset_id`", "reference_ids");
  const mode = b.mode ?? (hasRef ? "reference" : "text");
  if (mode === "reference" && !hasRef) throw invalid("Chế độ “Từ ảnh” cần `reference_id` hoặc `reference_asset_id`", "mode");
  if (mode === "text" && hasRef) throw invalid("Chế độ “Từ chữ” không dùng ảnh tham chiếu", "mode");
  if (b.reference_ids && b.reference_ids.length > REF_MAX_PER_JOB) throw invalid(`Nhiều nhất ${REF_MAX_PER_JOB} ảnh tham chiếu cho một lượt`, "reference_ids");
  const repeat = b.repeat ?? 1;
  if (repeat < REPEAT_MIN || repeat > REPEAT_MAX) throw invalid(`Số lần lặp phải từ ${REPEAT_MIN} đến ${REPEAT_MAX}`, "repeat");
  return {
    kind: b.kind,
    mode,
    prompt: b.prompt,
    reference_id: b.reference_id ?? null,
    reference_asset_id: b.reference_asset_id ?? null,
    // Only when the caller sent the array, so a single-reference request keeps the fingerprint it had before (R27).
    ...(b.reference_ids ? { reference_ids: ids } : {}),
    repeat,
    account: (b.account ?? "auto").trim() || "auto",
    ...(b.site === "vibes" ? { site: "vibes" as const } : {}),
  };
}

// ---------------------------------------------------------------- Kéo dài (R53)
export const extendSchema = z
  .object({
    mode: z.enum(["auto", "directive"]).optional(),
    directive: z.string().max(EXTEND_DIRECTIVE_MAX * 4).optional(),
    times: z.number().int().optional(),
    target_seconds: z.number().int().optional(),
  })
  .strict();
export type ExtendBody = z.infer<typeof extendSchema>;

export interface NormalisedExtend {
  asset_id: string;
  mode: ExtendMode;
  directive: string | null;
  plan: ChainPlan;
}

/** Exactly one of times / target_seconds (neither = times 1); directive only for mode "directive". */
export function normaliseExtend(assetId: string, b: ExtendBody, maxSteps: number): NormalisedExtend {
  const mode = b.mode ?? "auto";
  if (b.times !== undefined && b.target_seconds !== undefined) throw invalid("Chỉ gửi một trong `times` hoặc `target_seconds`", "times");
  const plan: ChainPlan = b.target_seconds !== undefined ? { type: "target", value: b.target_seconds } : { type: "steps", value: b.times ?? 1 };
  if (plan.type === "steps" && (plan.value < 1 || plan.value > maxSteps)) throw invalid(`\`times\` phải từ 1 đến ${maxSteps} (tối đa mỗi chuỗi trong Cài đặt)`, "times");
  if (plan.type === "target" && (plan.value < EXTEND_TARGET_MIN_S || plan.value > EXTEND_TARGET_MAX_S || plan.value % EXTEND_TARGET_STEP_S !== 0)) {
    throw invalid(`\`target_seconds\` phải từ ${EXTEND_TARGET_MIN_S} đến ${EXTEND_TARGET_MAX_S}, bước ${EXTEND_TARGET_STEP_S}`, "target_seconds");
  }
  if (mode === "auto" && b.directive !== undefined && normaliseDirective(b.directive)) throw invalid("Chế độ \"auto\" không dùng `directive` — dùng mode \"directive\"", "directive");
  const directive = mode === "directive" ? normaliseDirective(b.directive) : null;
  if (mode === "directive" && !directive) throw invalid("Chế độ \"directive\" cần `directive` (mô tả đoạn kéo dài)", "directive");
  if (directive && directive.length > EXTEND_DIRECTIVE_MAX) throw invalid(`\`directive\` tối đa ${EXTEND_DIRECTIVE_MAX} ký tự`, "directive");
  return { asset_id: assetId, mode, directive, plan };
}

function invalid(detail: string, path: string): ApiError {
  return new ApiError(400, "invalid_request", detail, { errors: [{ path, message: detail }] });
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const errors = r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join(".") || "(body)", message: issueText(i) }));
  const detailFor = (locale: Locale) => tl(locale, "Yêu cầu không hợp lệ: {value}", { value: errors.map((e) => `${e.path} — ${tl(locale, e.message)}`).join("; ") });
  throw new ApiError(400, "invalid_request", detailFor("vi"), { errors, detailFor });
}

function issueText(i: z.core.$ZodIssue): string {
  switch (i.code) {
    case "invalid_type":
      return `cần kiểu ${i.expected}`;
    case "invalid_value":
      return `chỉ nhận ${i.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "unrecognized_keys":
      return `trường không hỗ trợ: ${i.keys.join(", ")}`;
    case "too_big":
      return `quá dài/lớn (tối đa ${String(i.maximum)})`;
    case "too_small":
      return `quá ngắn/nhỏ (tối thiểu ${String(i.minimum)})`;
    default:
      return i.message;
  }
}

/** R27 — 1–100 printable ASCII characters (space included; HTTP already trims the ends of a header value). */
export const IDEMPOTENCY_RE = /^[\x20-\x7e]+$/;

export function checkIdempotencyKey(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length > API_IDEMPOTENCY_MAX || !IDEMPOTENCY_RE.test(v)) {
    throw new ApiError(400, "invalid_request", `Idempotency-Key phải gồm 1–${API_IDEMPOTENCY_MAX} ký tự ASCII in được`, { errors: [{ path: "Idempotency-Key", message: "sai định dạng" }] });
  }
  return v;
}

/** Integer query parameter within [min, max]; missing → default. */
export function intParam(raw: string | null, name: string, min: number, max: number, dflt: number): number {
  if (raw === null || raw === "") return dflt;
  if (!/^\d+$/.test(raw)) throw new ApiError(400, "invalid_request", `\`${name}\` phải là số nguyên ${min}–${max}`, { errors: [{ path: name, message: "không phải số nguyên" }] });
  const n = Number(raw);
  if (n < min || n > max) throw new ApiError(400, "invalid_request", `\`${name}\` phải trong khoảng ${min}–${max}`, { errors: [{ path: name, message: "ngoài khoảng" }] });
  return n;
}

export const waitParam = (raw: string | null) => intParam(raw, "wait", 0, API_WAIT_MAX_S, 0);
export const limitParam = (raw: string | null, dflt: number) => intParam(raw, "limit", 1, API_LIST_MAX, dflt);

/** MCP tool arguments (validated the same way; errors become tool results with isError). */
export const mcpGenerateSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    prompt: z.string(),
    reference_image_base64: z.string().max(11_200_000).optional(),
    reference_id: z.string().min(1).max(100).optional(),
    reference_asset_id: z.string().min(1).max(100).optional(),
    reference_ids: z.array(z.string().min(1).max(100)).min(1).max(REF_MAX_PER_JOB).optional(),
    repeat: z.number().int().optional(),
    account: z.string().min(1).max(100).optional(),
    site: z.enum(["muse", "vibes"]).optional(),
    request_id: z.string().min(1).max(API_IDEMPOTENCY_MAX).regex(/^[\x20-\x7e]+$/, "chỉ ký tự ASCII in được").optional(),
    wait_seconds: z.number().int().min(0).max(API_WAIT_MAX_S).optional(),
  })
  .strict();

export const mcpExtendSchema = z
  .object({
    asset_id: z.string().min(1).max(100).optional(),
    conversation_id: z.string().min(1).max(100).optional(),
    mode: z.enum(["auto", "directive"]).optional(),
    directive: z.string().max(EXTEND_DIRECTIVE_MAX * 4).optional(),
    times: z.number().int().optional(),
    target_seconds: z.number().int().optional(),
    request_id: z.string().min(1).max(API_IDEMPOTENCY_MAX).regex(/^[\x20-\x7e]+$/, "chỉ ký tự ASCII in được").optional(),
    wait_seconds: z.number().int().min(0).max(API_WAIT_MAX_S).optional(),
  })
  .strict()
  .refine((a) => (a.asset_id === undefined) !== (a.conversation_id === undefined), { message: "gửi đúng một trong asset_id hoặc conversation_id", path: ["asset_id"] });
export const mcpGetExtendSchema = z.object({ chain_id: z.string().min(1).max(100), wait_seconds: z.number().int().min(0).max(API_WAIT_MAX_S).optional() }).strict();

/** Build 2.0 R110 — muse_chat: attachments by reference id or inline (≤ 4 inline files, ≤ 8 MiB decoded). */
export const mcpChatSchema = z
  .object({
    prompt: z.string(),
    attachments: z
      .array(
        z.union([
          z.object({ reference_id: z.string().min(1).max(100) }).strict(),
          z.object({ filename: z.string().min(1).max(300), mime: z.string().max(100).optional(), data_base64: z.string().max(11_200_000) }).strict(),
        ]),
      )
      .max(10)
      .optional(),
    conversation_id: z.string().min(1).max(100).optional(),
    account: z.string().min(1).max(100).optional(),
    request_id: z.string().min(1).max(API_IDEMPOTENCY_MAX).regex(/^[\x20-\x7e]+$/, "chỉ ký tự ASCII in được").optional(),
    wait_seconds: z.number().int().min(0).max(API_WAIT_MAX_S).optional(),
  })
  .strict();
export const mcpGetJobSchema = z.object({ job_id: z.string().min(1).max(100), wait_seconds: z.number().int().min(0).max(API_WAIT_MAX_S).optional() }).strict();
export const mcpListSchema = z
  .object({
    status: z.enum(["queued", "running", "needs_review", "succeeded", "failed", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(API_LIST_MAX).optional(),
    cursor: z.string().max(40).optional(),
  })
  .strict();
export const mcpCancelSchema = z.object({ job_id: z.string().min(1).max(100) }).strict();
export const mcpStatusSchema = z.object({}).strict();
