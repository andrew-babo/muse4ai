import type { ErrorClass, JobState } from "./types";

// Spec §4.1 — job lifecycle.

export const JOB_LABEL: Record<JobState, string> = {
  queued: "Đang chờ",
  held: "Tạm giữ",
  preparing: "Đang chuẩn bị",
  submitting: "Đang gửi",
  submitted: "Muse đang tạo",
  generating: "Muse đang tạo",
  downloading: "Đang tải về",
  download_retry: "Đang tải về",
  retry_wait: "Chờ thử lại",
  needs_review: "Cần anh xem",
  completed: "Xong",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

export const TERMINAL: ReadonlySet<JobState> = new Set(["completed", "failed", "cancelled"]);
export const PRE_SUBMIT: ReadonlySet<JobState> = new Set(["queued", "held", "preparing", "retry_wait"]);
export const IN_FLIGHT: ReadonlySet<JobState> = new Set([
  "preparing",
  "submitting",
  "submitted",
  "generating",
  "downloading",
  "download_retry",
]);
export const AFTER_SUBMIT: ReadonlySet<JobState> = new Set(["submitted", "generating", "downloading", "download_retry"]);

export type JobAction =
  | "cancel"
  | "changeAccount"
  | "prioritize"
  | "resumeBatch"
  | "stopWaiting"
  | "retryNow"
  | "importFromHistory"
  | "resend"
  | "dismiss"
  | "recreate"
  | "retry"
  | "editResend";

const ACTIONS: Record<JobState, JobAction[]> = {
  queued: ["cancel", "changeAccount", "prioritize"],
  held: ["resumeBatch", "cancel"],
  preparing: ["cancel"],
  submitting: [],
  submitted: ["stopWaiting"],
  generating: ["stopWaiting"],
  downloading: [],
  download_retry: [],
  retry_wait: ["retryNow", "cancel"],
  needs_review: ["importFromHistory", "resend", "dismiss"],
  completed: ["recreate"],
  failed: ["retry", "editResend"],
  cancelled: ["resend"],
};

/** Errors that a manual or batch "retry failed" may re-run (AC-BAT-04: content refusals are never retried). */
export function isRetryableError(e: ErrorClass | null): boolean {
  return e !== "CONTENT_REFUSED";
}

export function allowedActions(state: JobState, ctx: { errorClass?: ErrorClass | null; remoteRef?: string | null } = {}): JobAction[] {
  let list = ACTIONS[state];
  if (state === "failed" && !isRetryableError(ctx.errorClass ?? null)) list = list.filter((a) => a !== "retry");
  if (state === "needs_review" && !ctx.remoteRef) list = list.filter((a) => a !== "importFromHistory");
  return list;
}

const TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ["preparing", "held", "cancelled", "queued"],
  held: ["queued", "cancelled"],
  preparing: ["submitting", "retry_wait", "queued", "held", "cancelled", "failed"],
  submitting: ["submitted", "retry_wait", "needs_review", "failed", "queued"],
  submitted: ["generating", "downloading", "needs_review", "failed", "cancelled"],
  generating: ["downloading", "needs_review", "failed", "cancelled"],
  downloading: ["completed", "download_retry", "failed", "needs_review"],
  download_retry: ["downloading", "failed", "needs_review"],
  retry_wait: ["queued", "cancelled", "held"],
  needs_review: ["downloading", "queued", "cancelled", "completed"],
  completed: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public from: JobState, public to: JobState) {
    super(`Không thể chuyển lượt từ "${JOB_LABEL[from]}" sang "${JOB_LABEL[to]}"`);
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const ERROR_LABEL: Record<ErrorClass, string> = {
  PRE_SUBMIT_TRANSIENT: "Lỗi mạng hoặc trang chưa sẵn sàng trước khi gửi",
  AMBIGUOUS_SUBMIT: "Không xác minh được Muse đã nhận lượt này",
  SESSION_EXPIRED: "Phiên đăng nhập đã hết",
  CHECKPOINT: "Muse cần xác minh tài khoản",
  QUOTA_LIMIT: "Tài khoản đã hết hạn mức",
  CONTENT_REFUSED: "Muse từ chối nội dung",
  PROVIDER_ERROR: "Muse gặp lỗi kỹ thuật, chưa tạo được tệp",
  PROXY_FAILED: "Proxy không kết nối được",
  UI_CHANGED: "Muse vừa đổi giao diện",
  DOWNLOAD_FAILED: "Không tải được tệp kết quả",
  NOT_ACCEPTED: "Muse chưa nhận lượt này — gửi lại nếu cần",
  EMPTY_RESPONSE: "Muse không trả nội dung",
  HTTP_CONNECT_FAILED: "Kênh trực tiếp không kết nối được",
  HTTP_STREAM_LOST: "Kênh trực tiếp mất kết nối",
  HTTP_PROTOCOL_MISMATCH: "Muse đổi cách trả dữ liệu của kênh trực tiếp",
  HTTP_FETCH_FAILED: "Không tải được tệp qua kênh trực tiếp",
  ANOMALY_REPORTED: "Muse báo hoạt động bất thường",
  UNKNOWN: "Lỗi không xác định",
};

/** Status words for a job, by site (rev 6: “Vibes đang tạo” instead of “Muse đang tạo”). */
export function jobLabel(j: { state: JobState; site?: string }): string {
  if (j.site === "vibes" && (j.state === "submitted" || j.state === "generating")) return "Vibes đang tạo";
  return JOB_LABEL[j.state];
}

export const ERROR_HINT: Partial<Record<ErrorClass, string>> = {
  PRE_SUBMIT_TRANSIENT: "Thử lại",
  SESSION_EXPIRED: "Đăng nhập lại",
  CHECKPOINT: "Mở Điều khiển để xác minh",
  QUOTA_LIMIT: "Chờ hạn mức hoặc dùng tài khoản khác",
  CONTENT_REFUSED: "Sửa prompt rồi gửi lại",
  PROVIDER_ERROR: "Thử lại",
  PROXY_FAILED: "Kiểm tra hoặc đổi proxy",
  UI_CHANGED: "Chờ bản cập nhật",
  DOWNLOAD_FAILED: "Thử lại",
  NOT_ACCEPTED: "Gửi lại",
  EMPTY_RESPONSE: "Thử lại",
  ANOMALY_REPORTED: "Kiểm tài khoản trên Muse rồi cho chạy lại",
};

/**
 * R52 — what may leave the main process of a job: a Vibes batch id is a remote id, so the renderer only learns that a
 * remote reference exists (the “Kiểm lại trên Vibes” action needs that), never its value.
 */
export function publicJob<T extends { site?: string; remoteRef: string | null }>(j: T): T {
  // Build 2.0 R96: the Muse conversation id of an HTTP job (and its reconcile baseline) never leaves the main process.
  const { remoteSessionId: _sid, baselineUserMsgs: _base, ...rest } = j as T & { remoteSessionId?: unknown; baselineUserMsgs?: unknown };
  const out = rest as T;
  if (out.remoteRef) return { ...out, remoteRef: out.site === "vibes" ? "vibes" : "muse" };
  return out;
}
