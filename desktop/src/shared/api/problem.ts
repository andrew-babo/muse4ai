import { getLocale, tl, type Locale } from "../i18n";

// R24–R33 — RFC 9457 problem details with stable machine codes and titles (English). `detail` is written in Vietnamese
// and sent in the caller's language (Build 2.0 R122: Accept-Language, else the app language).

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_api_key"
  | "insufficient_scope"
  | "not_found"
  | "method_not_allowed"
  | "upload_too_large"
  | "body_too_large"
  | "unsupported_media_type"
  | "capability_unavailable"
  | "idempotency_conflict"
  | "rate_limited"
  | "queue_full"
  | "too_many_waits"
  | "job_not_cancellable"
  | "source_not_extendable"
  | "conversation_busy"
  | "attachment_limit"
  | "unsupported_attachment"
  | "conversation_account_mismatch"
  | "chain_not_cancellable"
  | "asset_gone"
  | "download_expired"
  | "origin_forbidden"
  | "forbidden_network"
  | "misdirected_request"
  | "internal_error";

const TITLES: Record<ApiErrorCode, string> = {
  invalid_request: "Invalid request",
  invalid_api_key: "Invalid API key",
  insufficient_scope: "Insufficient scope",
  not_found: "Not found",
  method_not_allowed: "Method not allowed",
  upload_too_large: "Upload too large",
  body_too_large: "Request body too large",
  unsupported_media_type: "Unsupported media type",
  capability_unavailable: "Capability unavailable",
  idempotency_conflict: "Idempotency key reused with a different request",
  rate_limited: "Rate limited",
  queue_full: "Too many unfinished jobs",
  too_many_waits: "Too many concurrent waits",
  job_not_cancellable: "Job cannot be cancelled",
  source_not_extendable: "This video cannot be extended",
  conversation_busy: "This conversation is reserved or unresolved",
  attachment_limit: "Too many or too large attachments",
  unsupported_attachment: "Attachment type not supported on this path",
  conversation_account_mismatch: "Conversation belongs to another account",
  chain_not_cancellable: "Extend chain cannot be cancelled",
  asset_gone: "File no longer available",
  download_expired: "Download link invalid or expired",
  origin_forbidden: "Browser origins are not allowed",
  forbidden_network: "Source network not allowed",
  misdirected_request: "Unknown host",
  internal_error: "Internal error",
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    public detail: string,
    /** `detailFor` rebuilds a detail made of several app messages in another language (R122). */
    public extra: { retryAfterS?: number; errors?: { path: string; message: string }[]; detailFor?: (locale: Locale) => string } = {},
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ApiErrorCode;
  request_id: string;
  errors?: { path: string; message: string }[];
  retry_after?: number;
}

/** The error's human text in `locale` (R122). */
export function problemDetail(e: ApiError, locale: Locale = getLocale()): string {
  return e.extra.detailFor ? e.extra.detailFor(locale) : tl(locale, e.detail);
}

export function toProblem(e: ApiError, requestId: string, locale: Locale = getLocale()): Problem {
  const p: Problem = { type: `https://musestudio.local/errors/${e.code}`, title: TITLES[e.code], status: e.status, detail: problemDetail(e, locale), code: e.code, request_id: requestId };
  if (e.extra.errors?.length) p.errors = e.extra.errors.map((x) => ({ path: x.path, message: tl(locale, x.message) }));
  if (e.extra.retryAfterS) p.retry_after = e.extra.retryAfterS;
  return p;
}

export const errTitle = (c: ApiErrorCode) => TITLES[c];
