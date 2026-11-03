import type { CapabilityKey, ErrorClass, ExtendMode, JobKind, JobMode, Quota } from "../../shared/types";
import type { AuthMeResponse } from "../../shared/vibes";
import type { MuseCheckpoint } from "../../shared/museExtend";

// Adapter contract — spec §4.6. One adapter instance per account (its own session + proxy).

export interface SubmitSpec {
  jobId: string;
  kind: JobKind;
  mode: JobMode;
  prompt: string;
  referencePaths: string[];
  referenceMedia?: "image" | "video";
}

export interface MediaRef {
  src: string;
  kind: "image" | "video";
  width?: number;
  height?: number;
  /** Vibes output: the remote ids that make it a future extend source (main process only, R52). */
  remote?: VibesRemote;
  museSource?: { conversation: string; turn: string; output: string };
}

/** Remote ids of one Vibes content item (R52: never leave the main process). */
export interface VibesRemote {
  projectId: string | null;
  batchId: string;
  contentId: string;
  entityId: string | null;
  handle: string | null;
  videoUrl: string | null;
  originalPrompt: string | null;
  config: Record<string, unknown> | null;
}

export interface SubmitResult {
  remoteRef: string | null;
  acceptedAt: number;
  /** Vibes: the account's working project (kept for the next job). */
  projectId?: string | null;
}

export interface ObserveResult {
  media: MediaRef[];
  replyText?: string;
}

export type ProgressStage = "preparing" | "submitting" | "generating" | "downloading";

export interface SubmitHooks {
  signal: AbortSignal;
  /**
   * Called synchronously right before the send action; the coordinator persists submit_intent_at here (R12).
   * Vibes passes the batch id it generated so it is stored before the first request (R48).
   */
  onBeforeSend: (remoteRef?: string) => void;
}

export interface ObserveHooks {
  signal: AbortSignal;
  timeoutMs: number;
}

export class AdapterError extends Error {
  constructor(
    public cls: ErrorClass,
    message: string,
    /** definitive: the service itself reported the failure (no doubt it was received) → failed, not needs_review. */
    public detail: {
      resetAt?: number | null;
      afterSend?: boolean;
      definitive?: boolean;
      /** The service refused the request outright, so nothing was generated: safe to queue again (Vibes 429 on trigger). */
      notStarted?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class AbortedError extends Error {
  constructor() {
    super("Đã dừng");
    this.name = "AbortedError";
  }
}

export interface MuseAdapter {
  checkSession(signal?: AbortSignal): Promise<void>;
  probeCapabilities(): Promise<Partial<Record<CapabilityKey, boolean>>>;
  submit(spec: SubmitSpec, hooks: SubmitHooks): Promise<SubmitResult>;
  observe(remoteRef: string | null, kind: JobKind, hooks: ObserveHooks): Promise<ObserveResult>;
  download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array>;
  /** Reconcile without remote ref: look for a recent thread whose first message equals the sent text (R12). */
  findByPrompt(spec: SubmitSpec, since: number): Promise<string | null>;
  readQuota(): Promise<Quota>;
  exitIp(): Promise<{ ip: string; country: string | null }>;
  dispose(): void;
  /** Optional until a driver supplies durable turn attribution; absent means gated. */
  identity?(signal?: AbortSignal): Promise<string | null>;
  submitExtend?(source: { conversation: string; turn: string; output: string }, mode: ExtendMode, directive: string | null, hooks: SubmitHooks & { onCheckpoint: (checkpoint: MuseCheckpoint) => void }): Promise<MuseCheckpoint>;
  observeExtend?(checkpoint: MuseCheckpoint, hooks: ObserveHooks & { onCheckpoint: (checkpoint: MuseCheckpoint) => void }): Promise<ObserveResult>;
}

// ------------------------------------------------------------------ Vibes (spec rev 6 §4.6)
export interface VibesSubmitSpec {
  jobId: string;
  operation: "generate" | "extend";
  /** Generate: the prompt; extend: the source's original prompt (used when no directive). */
  prompt: string;
  mode: JobMode;
  /** Generate from an image (R44): the start frame, from the app's reference store. */
  referencePath: string | null;
  /** Extend: R46 — auto sends no directive anywhere; directive mode sends exactly this text. */
  extendMode: ExtendMode | null;
  directive: string | null;
  source: VibesRemote | null;
  /** The account's project if known; the adapter creates/finds one otherwise. */
  projectId: string | null;
}

export interface VibesAdapter {
  /** GET vibes.ai/api/auth/me from the account's own Vibes page. Throws AdapterError(PROXY_FAILED) on network errors. */
  checkSession(signal?: AbortSignal): Promise<AuthMeResponse>;
  submit(spec: VibesSubmitSpec, hooks: SubmitHooks): Promise<SubmitResult>;
  /** Follows exactly this batch (R48); not found → AdapterError(AMBIGUOUS_SUBMIT, afterSend). */
  observe(batchId: string, hooks: ObserveHooks): Promise<ObserveResult>;
  download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array>;
  dispose(): void;
}

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  country?: string | null;
  latencyMs?: number;
  error?: string;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
