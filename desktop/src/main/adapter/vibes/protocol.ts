import type { ErrorClass } from "../../../shared/types";
import type { VibesRemote } from "../types";

// Every Vibes URL, payload shape and error text the app relies on lives in this one file (AGENTS.md: one adapter
// module per web app). Payload shapes are ported from mir-ashiq/VibesAI-api (MIT, snapshot 1aa1210f — see
// LICENSES/VibesAI-api.txt): generate = batch shell + /api/generate/videos with `type: "prompt"` inputs; extend =
// `extend-{ms}-{hex8}` shell + one `type: "extend"` input with model `midjen-extend`. Deliberately NOT ported:
// auto re-login, replaying a POST after 401, picking the first content item when ids do not match, background
// session keep-alive, broad inheritance of a previous directive (spec R46, research-vibes §5.2).

export const VIBES = {
  origin: "https://vibes.ai",
  home: "https://vibes.ai/",
  authMe: "/api/auth/me",
  projects: "/api/projects",
  batches: "/api/generation-batches",
  generateVideos: "/api/generate/videos",
  uploadImage: "/api/upload-image",
  downloadVideo: "/api/download/video",
  projectName: "Muse4AI",
} as const;

/** Origins a Meta login popup may open in during a Vibes login step (rules B32). */
export const VIBES_LOGIN_ORIGINS = [
  "https://vibes.ai",
  "https://auth.meta.com",
  "https://auth.meta.ai",
  "https://www.facebook.com",
  "https://m.facebook.com",
  "https://www.instagram.com",
] as const;

/**
 * Vibes' own under-18 block, shown on vibes.ai right after the Meta login step (seen live 27/10/2026 on both test
 * accounts: the page shows this dialog while /api/auth/me stays 401 NoToken, so the session check alone never ends).
 */
const VIBES_AGE_BLOCK = /teens under 18 can.?t use vibes|teens under 18 can no longer use vibes/i;

export function isVibesAgeBlock(pageText: string): boolean {
  return VIBES_AGE_BLOCK.test(pageText);
}

/** Hosts that receive nothing while “Dùng Vibes cho tài khoản này” is off (R39). */
export const VIBES_HOSTS = ["vibes.ai", "auth.meta.com", "auth.meta.ai"] as const;

export function isVibesHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return VIBES_HOSTS.some((v) => h === v || h.endsWith(`.${v}`));
  } catch {
    return false;
  }
}

export function isLoginPopupAllowed(url: string): boolean {
  try {
    const o = new URL(url).origin.toLowerCase();
    return (VIBES_LOGIN_ORIGINS as readonly string[]).includes(o);
  } catch {
    return false;
  }
}

/**
 * Generation defaults. Aspect ratio / resolution / duration are not user controls until a live trial proves they are
 * real controls (spec R44, §4.7); these are the web app's documented defaults for one variation.
 */
export const VIBES_DEFAULTS = {
  videoModel: "midjen-short",
  extendModel: "midjen-extend",
  imageModel: "midjen-base",
  promptModel: "gemini-2.5-flash",
  resolution: "720p",
  aspectRatio: "9:16",
  variations: 1,
} as const;

export const VIBES_TIMEOUTS = {
  pageLoad: 45_000,
  api: 30_000,
  upload: 90_000,
  pollEvery: 3_000,
  /** A batch created a moment ago may 404 for a short while (server-side race seen by VibesAI-api). */
  notFoundGrace: 20_000,
  transientPolls: 4,
  download: 180_000,
  downloadTries: 3,
  settleAfterShell: 1_000,
} as const;

// ------------------------------------------------------------------ ids
/** RFC 9562 UUID v7 (the web app derives the batch time from the high bits). */
export function uuidV7(now: number, rand: Uint8Array): string {
  const b = new Uint8Array(16);
  b.set(rand.subarray(0, 16));
  let t = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function generateBatchId(now: number, rand: Uint8Array): string {
  return `batch-${uuidV7(now, rand)}`;
}

export function extendBatchId(now: number, rand: Uint8Array): string {
  const hex = Array.from(rand.subarray(0, 4), (x) => x.toString(16).padStart(2, "0")).join("");
  return `extend-${Math.floor(now)}-${hex}`;
}

// ------------------------------------------------------------------ requests
export interface FrameHandle {
  oil_handle: string | null;
  image_url: string | null;
  image_ent_id: string | null;
  source: "upload";
}

export function frameHandle(upload: Record<string, unknown>): FrameHandle {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    oil_handle: str(upload.imageHandle) ?? str(upload.oil_handle),
    image_url: str(upload.imageUrl) ?? str(upload.image_url),
    image_ent_id: str(upload.mediaEntId) ?? str(upload.image_ent_id),
    source: "upload",
  };
}

export interface VibesRequest {
  batchId: string;
  shell: Record<string, unknown>;
  trigger: Record<string, unknown>;
}

/** R44 — one variation, from text or from one start frame. */
export function buildGenerateRequest(o: { batchId: string; prompt: string; projectId: string; now: number; startFrame?: FrameHandle | null }): VibesRequest {
  const genType = o.startFrame ? "i2v" : "t2v";
  const config: Record<string, unknown> = {
    videoModel: VIBES_DEFAULTS.videoModel,
    imageModel: VIBES_DEFAULTS.imageModel,
    promptModel: VIBES_DEFAULTS.promptModel,
    resolution: VIBES_DEFAULTS.resolution,
    aspectRatio: VIBES_DEFAULTS.aspectRatio,
    batchVariation: VIBES_DEFAULTS.variations > 1,
    generationType: genType,
    directGeneration: true,
  };
  if (o.startFrame) config.directPromptImageHandle = o.startFrame;
  const inputConfig: Record<string, unknown> = { ...config };
  delete inputConfig.batchVariation;
  delete inputConfig.directGeneration;
  const shell = {
    id: o.batchId,
    type: "videos",
    prompt: o.prompt,
    timestamp: o.now,
    isComplete: false,
    config,
    projectId: o.projectId,
    content: Array.from({ length: VIBES_DEFAULTS.variations }, (_, i) => ({ id: `${o.batchId}-content-${i}`, type: "video", isLoading: true })),
  };
  const inputs = Array.from({ length: VIBES_DEFAULTS.variations }, () => ({ type: "prompt", value: o.prompt, original_prompt: o.prompt, config: inputConfig }));
  return { batchId: o.batchId, shell, trigger: { batchId: o.batchId, inputs, config } };
}

/** Keys of a previous step that must never be carried into the next one (R46: Auto never sends a directive). */
const NEVER_INHERIT = ["extendDirective", "directive", "manualPrompt"];

/** R46 — native Extend of one Vibes output. `directive` null = Tự động (no directive anywhere in the payload). */
export function buildExtendRequest(o: { batchId: string; projectId: string; now: number; source: VibesRemote; directive: string | null }): VibesRequest {
  const src = o.source;
  const inherited: Record<string, unknown> = { ...(src.config ?? {}) };
  for (const k of NEVER_INHERIT) delete inherited[k];
  const config: Record<string, unknown> = {
    ...inherited,
    videoModel: VIBES_DEFAULTS.extendModel,
    imageModel: (typeof inherited.imageModel === "string" && inherited.imageModel) || VIBES_DEFAULTS.imageModel,
    generationType: "extend",
    directGeneration: true,
    sourceContentItemIds: [{ id: src.contentId, source: "extend_video" }],
  };
  if (src.handle) config.sourceVideoHandle = src.handle;
  if (src.videoUrl && !config.sourceVideoUrl) config.sourceVideoUrl = src.videoUrl;
  if (o.directive) config.extendDirective = o.directive;
  const prompt = o.directive || src.originalPrompt || "";
  const shell = {
    id: o.batchId,
    type: "videos",
    prompt,
    timestamp: o.now,
    content: [],
    isComplete: false,
    config,
    promptModel: config.promptModel,
    imageModel: config.imageModel,
    videoModel: config.videoModel,
    generationStartTime: o.now,
    isDirectGeneration: true,
    projectId: o.projectId,
  };
  const input: Record<string, unknown> = { type: "extend", mediaEntId: src.entityId, videoUrl: src.videoUrl, prompt, config: { ...config } };
  if (o.directive) input.extendDirective = o.directive;
  return { batchId: o.batchId, shell, trigger: { batchId: o.batchId, inputs: [input], config } };
}

// ------------------------------------------------------------------ responses
export interface ParsedBatch {
  found: boolean;
  complete: boolean;
  hasError: boolean;
  errorText: string | null;
  videos: VibesRemote[];
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

function jsonish(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return obj(v);
}

/** Reads GET /api/generation-batches/{id}. Only items of THIS batch are returned — never a fallback to another one. */
export function parseBatch(raw: unknown, batchId: string, projectId: string | null): ParsedBatch {
  const root = obj(raw);
  const b = obj(root?.batch) ?? root;
  if (!b || (b.id !== undefined && String(b.id) !== batchId)) return { found: false, complete: false, hasError: false, errorText: null, videos: [] };
  const errorText = str(b.error) ?? str(obj(b.error)?.message) ?? str(obj(b.error)?.detail) ?? null;
  const content = Array.isArray(b.content) ? b.content : [];
  const videos: VibesRemote[] = [];
  for (const it of content) {
    const item = obj(it);
    if (!item || item.isLoading === true || item.hasError === true) continue;
    const url = str(item.videoUrl);
    const id = str(item.id);
    if (!id || !url || (item.type !== undefined && item.type !== "video")) continue;
    const structured = jsonish(item.structuredOutput) ?? {};
    const config = obj(item.config) ?? {};
    const data = jsonish(item.data) ?? {};
    videos.push({
      projectId,
      batchId,
      contentId: id,
      entityId: str(data.videoGenEntId) ?? str(data.videoEntId),
      handle: str(item.videoHandle) ?? str(structured.sourceVideoHandle) ?? str(config.sourceVideoHandle),
      videoUrl: url,
      originalPrompt: str(item.prompt) ?? str(item.videoPrompt) ?? str(item.imagePrompt) ?? str(b.prompt),
      config: { ...structured, ...config },
    });
  }
  return { found: true, complete: b.isComplete === true, hasError: b.hasError === true, errorText, videos };
}

/** The project list / create responses. */
export function pickProjectId(raw: unknown, name: string = VIBES.projectName): string | null {
  const r = obj(raw);
  const one = obj(r?.project);
  if (one && str(one.id)) return str(one.id);
  const list = Array.isArray(r?.projects) ? r!.projects : Array.isArray(r?.items) ? r!.items : Array.isArray(raw) ? (raw as unknown[]) : [];
  for (const p of list as unknown[]) {
    const o = obj(p);
    if (o && str(o.id) && String(o.name ?? "").trim() === name) return str(o.id);
  }
  return null;
}

const REFUSED_RE = /policy|safety|violat|not allowed|inappropriate|guideline|prohibited|blocked content|community standards/i;
const QUOTA_RE = /limit|quota|too many|rate|exceeded|credits?/i;

export interface ClassifiedError {
  cls: ErrorClass;
  message: string;
  definitive: boolean;
}

/** A failed batch (hasError): the service itself said no (definitive). Messages never echo the response body (R52). */
export function classifyBatchError(errorText: string | null): ClassifiedError {
  const t = errorText ?? "";
  if (REFUSED_RE.test(t)) return { cls: "CONTENT_REFUSED", message: "Vibes từ chối nội dung này", definitive: true };
  if (QUOTA_RE.test(t)) return { cls: "QUOTA_LIMIT", message: "Vibes báo hết lượt", definitive: false };
  return { cls: "UNKNOWN", message: "Vibes báo tạo lỗi", definitive: true };
}

/** An HTTP error of one Vibes API call. `sent` = the trigger may have been received. */
export function classifyHttpError(status: number, body: unknown, sent: boolean): ClassifiedError {
  const text = JSON.stringify(body ?? "").slice(0, 2000);
  if (status === 401) return { cls: "SESSION_EXPIRED", message: "Phiên Vibes đã hết", definitive: false };
  if (status === 403) return { cls: "CHECKPOINT", message: "Vibes từ chối truy cập", definitive: false };
  if (status === 429 || (status >= 400 && status < 500 && QUOTA_RE.test(text) && /limit|quota/i.test(text))) return { cls: "QUOTA_LIMIT", message: "Vibes báo hết lượt", definitive: false };
  if (status >= 400 && status < 500 && REFUSED_RE.test(text)) return { cls: "CONTENT_REFUSED", message: "Vibes từ chối nội dung này", definitive: true };
  if (status >= 400 && status < 500) return { cls: "UNKNOWN", message: `Vibes không nhận yêu cầu (HTTP ${status})`, definitive: true };
  if (sent) return { cls: "AMBIGUOUS_SUBMIT", message: status ? `Vibes trả lỗi ${status} sau khi gửi` : "Mất kết nối sau khi gửi tới Vibes", definitive: false };
  return { cls: "PRE_SUBMIT_TRANSIENT", message: status ? `Vibes chưa sẵn sàng (HTTP ${status})` : "Lỗi mạng khi gọi Vibes", definitive: false };
}
