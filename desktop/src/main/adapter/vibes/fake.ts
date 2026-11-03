import type { ErrorClass } from "../../../shared/types";
import type { AuthMeResponse } from "../../../shared/vibes";
import { AdapterError, type MediaRef, type ObserveHooks, type ObserveResult, type SubmitHooks, type SubmitResult, type VibesAdapter, type VibesRemote, type VibesSubmitSpec, sleep, throwIfAborted } from "../types";
import { buildExtendRequest, buildGenerateRequest, extendBatchId, generateBatchId, type VibesRequest } from "./protocol";

// Scripted Vibes for tests and the app's test mode (rules B38). Never touches the network. It builds the same request
// payloads as the real driver (protocol.ts), so tests can check what would be sent (AC-EXT-04).

export type FakeVibesStep =
  | { phase: "submit"; error: ErrorClass; afterSend?: boolean; resetAt?: number; definitive?: boolean }
  | { phase: "observe"; error: ErrorClass; resetAt?: number; definitive?: boolean }
  | { phase: "download"; error: "DOWNLOAD_FAILED" };

export interface FakeVibesConfig {
  /** Session answers, consumed in order; the last one repeats. "network" = proxy failure. */
  me?: (AuthMeResponse | "network")[];
  /** Output length: generate → base; extend → source + growth (cumulative output, like the web app). */
  durations?: (op: "generate" | "extend", sourceMs: number | null, n: number) => number;
  /** Output is only the appended segment (R49 check). */
  segmentOnly?: boolean;
  submitDelayMs?: number;
  generateDelayMs?: number;
  script?: FakeVibesStep[];
  /** Remote ids to hand out (AC-EXT-17 canaries). */
  ids?: { content?: (n: number) => string; handle?: (n: number) => string; url?: (n: number) => string };
  /** Batches that exist on "Vibes" (reconcile after a crash, AC-EXT-09). */
  batches?: Map<string, { remote: VibesRemote; durationMs: number }>;
  /** Called at the moment of the first request naming the batch (tests check what is already persisted). */
  onSend?: (batchId: string) => void;
  /** Real media bytes for the app's test mode (duration → payload). */
  media?: (durationMs: number, seed: number) => Uint8Array;
}

/** Minimal MP4-looking payload whose length the test probe reads back (marker `DURA` + uint32 ms). */
export function fakeVibesMp4(durationMs: number, seed: number): Uint8Array {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4, "ascii");
  b.write("isom", 8, "ascii");
  b.writeUInt32BE(seed >>> 0, 32);
  b.write("DURA", 40, "ascii");
  b.writeUInt32BE(Math.max(1, Math.round(durationMs)), 44);
  return Uint8Array.from(b);
}

export interface SentRecord {
  jobId: string;
  operation: "generate" | "extend";
  batchId: string;
  request: VibesRequest;
  at: number;
  sourceContentId: string | null;
}

export class FakeVibesAdapter implements VibesAdapter {
  calls = { session: 0, submit: 0, observe: 0, download: 0 };
  sent: SentRecord[] = [];
  /** Ordered events: "intent:<batch>" (onBeforeSend done) before "send:<batch>". */
  events: string[] = [];
  private n = 0;
  private outputs = new Map<string, { remote: VibesRemote; durationMs: number }>();
  private durationOf = new Map<string, number>(); // contentId → ms
  constructor(public accountId: string, public cfg: FakeVibesConfig = {}, private clock: () => number = Date.now) {}

  private take(phase: FakeVibesStep["phase"]): FakeVibesStep | undefined {
    const s = this.cfg.script;
    if (!s) return undefined;
    const i = s.findIndex((x) => x.phase === phase);
    return i < 0 ? undefined : s.splice(i, 1)[0];
  }

  async checkSession(signal?: AbortSignal): Promise<AuthMeResponse> {
    this.calls.session++;
    throwIfAborted(signal);
    const list = this.cfg.me ?? [{ status: 200, body: { user: { id: "u-1", username: "may.vn" } } }];
    const r = list.length > 1 ? list.shift()! : list[0];
    if (r === "network") throw new AdapterError("PROXY_FAILED", "Không gọi được Vibes qua proxy");
    return r;
  }

  async submit(spec: VibesSubmitSpec, hooks: SubmitHooks): Promise<SubmitResult> {
    this.calls.submit++;
    await sleep(this.cfg.submitDelayMs ?? 5, hooks.signal);
    const step = this.take("submit") as Extract<FakeVibesStep, { phase: "submit" }> | undefined;
    if (step && !step.afterSend) throw new AdapterError(step.error, "fake vibes pre-send error", { resetAt: step.resetAt ?? null, definitive: step.definitive });
    throwIfAborted(hooks.signal);
    const now = this.clock();
    const rand = Uint8Array.from({ length: 16 }, (_, i) => (this.n * 31 + i * 7 + this.calls.submit) & 0xff);
    const projectId = spec.projectId ?? "fake-project";
    const request =
      spec.operation === "extend"
        ? buildExtendRequest({ batchId: extendBatchId(now, rand), projectId, now, source: spec.source!, directive: spec.extendMode === "directive" ? spec.directive : null })
        : buildGenerateRequest({ batchId: generateBatchId(now, rand), prompt: spec.prompt, projectId, now });
    hooks.onBeforeSend(request.batchId);
    this.events.push(`intent:${request.batchId}`);
    this.cfg.onSend?.(request.batchId);
    this.events.push(`send:${request.batchId}`);
    this.sent.push({ jobId: spec.jobId, operation: spec.operation, batchId: request.batchId, request, at: now, sourceContentId: spec.source?.contentId ?? null });
    if (step?.afterSend) throw new AdapterError(step.error, "fake vibes after-send error", { afterSend: true, definitive: step.definitive });
    const k = ++this.n;
    const sourceMs = spec.source ? (this.durationOf.get(spec.source.contentId) ?? null) : null;
    const total = this.cfg.durations ? this.cfg.durations(spec.operation, sourceMs, k) : spec.operation === "extend" ? (sourceMs ?? 5000) + 5000 : 5000;
    const durationMs = this.cfg.segmentOnly && spec.operation === "extend" ? Math.max(1000, total - (sourceMs ?? 0)) : total;
    const contentId = this.cfg.ids?.content?.(k) ?? `${request.batchId}-content-0`;
    const remote: VibesRemote = {
      projectId,
      batchId: request.batchId,
      contentId,
      entityId: `ent-${this.accountId.slice(0, 4)}-${k}`,
      handle: this.cfg.ids?.handle?.(k) ?? `hdl-${k}`,
      videoUrl: this.cfg.ids?.url?.(k) ?? `https://video.example.invalid/v/${k}.mp4?token=t${k}`,
      originalPrompt: spec.operation === "extend" ? (spec.source?.originalPrompt ?? spec.prompt) : spec.prompt,
      config: { videoModel: spec.operation === "extend" ? "midjen-extend" : "midjen-short", aspectRatio: "9:16", ...(spec.extendMode === "directive" && spec.directive ? { extendDirective: spec.directive } : {}) },
    };
    this.durationOf.set(contentId, durationMs);
    this.outputs.set(request.batchId, { remote, durationMs });
    this.cfg.batches?.set(request.batchId, { remote, durationMs });
    return { remoteRef: request.batchId, acceptedAt: now, projectId };
  }

  async observe(batchId: string, hooks: ObserveHooks): Promise<ObserveResult> {
    this.calls.observe++;
    await sleep(this.cfg.generateDelayMs ?? 10, hooks.signal);
    const step = this.take("observe") as Extract<FakeVibesStep, { phase: "observe" }> | undefined;
    if (step) throw new AdapterError(step.error, "fake vibes observe error", { afterSend: true, resetAt: step.resetAt ?? null, definitive: step.definitive });
    const out = this.outputs.get(batchId) ?? this.cfg.batches?.get(batchId);
    if (!out) throw new AdapterError("AMBIGUOUS_SUBMIT", "Không thấy lượt này trên Vibes", { afterSend: true });
    this.durationOf.set(out.remote.contentId, out.durationMs);
    return { media: [{ src: out.remote.contentId, kind: "video", remote: out.remote }] };
  }

  async download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array> {
    this.calls.download++;
    throwIfAborted(signal);
    const step = this.take("download");
    if (step) throw new AdapterError("DOWNLOAD_FAILED", "fake vibes download error");
    const ms = this.durationOf.get(media.src) ?? 5000;
    let seed = this.calls.download * 1000;
    for (const ch of media.src) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    return this.cfg.media ? this.cfg.media(ms, seed) : fakeVibesMp4(ms, seed);
  }

  dispose(): void {}
}
