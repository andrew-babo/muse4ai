import type { MuseCheckpoint } from "../../shared/museExtend";
import type { CapabilityKey, ErrorClass, ExtendMode, JobKind, Quota } from "../../shared/types";
import { fakeVibesMp4 } from "./vibes/fake";
import { parseQuota } from "./muse/driver";
import { AdapterError, type MediaRef, type MuseAdapter, type ObserveHooks, type ObserveResult, type SubmitHooks, type SubmitResult, type SubmitSpec, sleep, throwIfAborted } from "./types";

// Scripted fake adapter for tests and demo/E2E mode (B19). Never touches the network.

export type FakeStep =
  | { phase: "session"; error: ErrorClass }
  | { phase: "probe"; error: ErrorClass }
  | { phase: "submit"; error: ErrorClass; afterSend?: boolean; resetAt?: number }
  | { phase: "observe"; error: ErrorClass; resetAt?: number }
  | { phase: "download"; error: "DOWNLOAD_FAILED" | "HTML" }
  | { phase: "observe-image-for-video" };

export interface FakeConfig {
  submitDelayMs?: number;
  sessionDelayMs?: number;
  /** The Muse identity read takes this long (a real page fetch does), so other scheduler passes run meanwhile. */
  identityDelayMs?: number;
  generateDelayMs?: number;
  script?: FakeStep[]; // consumed in order, one per matching phase
  history?: Map<string, string>; // prompt → remoteRef (for findByPrompt)
  ip?: string;
  country?: string;
  proxyDown?: boolean; // the account's proxy refuses connections (exit-IP and session checks fail)
  results?: number; // media per job
  media?: (kind: "image" | "video", seed: number) => Uint8Array; // realistic payloads for demo/E2E mode
  /** Documentation lab: the real output pinned to this exact prompt (fixtures prompts.json), or null. */
  mediaForPrompt?: (prompt: string, kind: "image" | "video") => Uint8Array | null;
  /**
   * Usage panel (spec rev 8 R69): a snapshot, or Usage text parsed like the real panel, or a function (called per read).
   * Throwing makes the read fail. Default: Free plan 5 %, no additional part. `quotaReads` counts reads.
   */
  quota?: Quota | string | (() => Quota | string | Promise<Quota | string>);
  quotaDelayMs?: number;
  quotaReads?: number;
  /** Clock for parsing Usage text (tests pass the harness clock). */
  now?: () => number;
  /**
   * Muse conversation simulation (rev 7): videos carry a conversation source and can be continued in it.
   * Each continuation returns one cumulative video `growMs` longer than its source; `script` scripts outcomes.
   */
  museExtend?: {
    identity?: string;
    baseMs?: number;
    growMs?: number;
    script?: ("provider_error" | "ambiguous_after_send" | "not_tip" | "no_growth")[];
    /** Every continuation actually sent (conversation, source output, mode, directive). */
    sent?: { conversation: string; output: string; mode: ExtendMode; directive: string | null }[];
    /** Hold observeExtend until this resolves (crash/concurrency tests). */
    gate?: Promise<void>;
  };
}

// Minimal valid media payloads.
export const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);
export function fakeMp4(seed = 0): Uint8Array {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4, "ascii");
  b.write("isom", 8, "ascii");
  b.writeUInt32BE(seed, 32);
  return Uint8Array.from(b);
}
export function fakePng(seed: number): Uint8Array {
  const out = new Uint8Array(PNG_1PX.length + 4);
  out.set(PNG_1PX);
  new DataView(out.buffer).setUint32(PNG_1PX.length, seed);
  return out;
}

export class FakeAdapter implements MuseAdapter {
  calls: { submit: number; observe: number; download: number; session: number } = { submit: 0, observe: 0, download: 0, session: 0 };
  sentPrompts: string[] = [];
  private counter = 0;
  private readonly promptByRef = new Map<string, string>();
  constructor(public accountId: string, public cfg: FakeConfig = {}) {}

  private take(phase: FakeStep["phase"]): FakeStep | undefined {
    const s = this.cfg.script;
    if (!s) return undefined;
    const i = s.findIndex((x) => x.phase === phase);
    if (i < 0) return undefined;
    return s.splice(i, 1)[0];
  }

  async checkSession(): Promise<void> {
    this.calls.session++;
    if (this.cfg.sessionDelayMs) await sleep(this.cfg.sessionDelayMs);
    if (this.cfg.proxyDown) throw new AdapterError("PROXY_FAILED", "Không kết nối được qua proxy");
    const step = this.take("session");
    if (step && "error" in step) throw new AdapterError(step.error as ErrorClass, "fake session error");
  }

  async probeCapabilities(): Promise<Partial<Record<CapabilityKey, boolean>>> {
    const step = this.take("probe");
    if (step && "error" in step) throw new AdapterError(step.error as ErrorClass, "fake probe error");
    return { "image.text": true, "image.reference": true, "video.text": true, "video.reference": true };
  }

  async submit(spec: SubmitSpec, hooks: SubmitHooks): Promise<SubmitResult> {
    this.calls.submit++;
    await sleep(this.cfg.submitDelayMs ?? 5, hooks.signal);
    const step = this.take("submit") as Extract<FakeStep, { phase: "submit" }> | undefined;
    if (step && !step.afterSend) throw new AdapterError(step.error, "fake pre-send error", { resetAt: step.resetAt ?? null });
    throwIfAborted(hooks.signal);
    hooks.onBeforeSend();
    this.sentPrompts.push(spec.prompt);
    if (step?.afterSend) throw new AdapterError(step.error, "fake after-send error", { afterSend: true });
    const ref = `fake-thread-${this.accountId}-${++this.counter}`;
    this.cfg.history?.set(spec.prompt, ref);
    this.promptByRef.set(ref, spec.prompt);
    return { remoteRef: ref, acceptedAt: Date.now() };
  }

  async observe(remoteRef: string | null, kind: JobKind, hooks: ObserveHooks): Promise<ObserveResult> {
    this.calls.observe++;
    await sleep(this.cfg.generateDelayMs ?? 10, hooks.signal);
    const step = this.take("observe");
    if (step && "error" in step) throw new AdapterError(step.error as ErrorClass, "fake observe error", { resetAt: (step as { resetAt?: number }).resetAt ?? null, afterSend: true });
    if (this.take("observe-image-for-video")) return { media: [{ src: `${remoteRef}#0`, kind: "image" }] };
    const n = this.cfg.results ?? 1;
    const conv = remoteRef ? `/thread/${remoteRef.replace(/[^0-9a-z-]/gi, "").slice(-40).padStart(8, "0")}` : null;
    return {
      media: Array.from({ length: n }, (_, i) => ({
        src: `${remoteRef}#${i}`,
        kind: kind === "video" ? ("video" as const) : ("image" as const),
        ...(this.cfg.museExtend && kind === "video" && conv ? { museSource: { conversation: conv, turn: `${remoteRef}-a${i}`, output: `sandbox://workspace/${remoteRef}-${i}.mp4` } } : {}),
      })),
    };
  }

  // ------------------------------------------------------------ Muse conversation continuation (rev 7)
  private extendCounter = 0;
  /** Cumulative length per output locator (source → continuation). */
  private lengths = new Map<string, number>();

  async identity(signal?: AbortSignal): Promise<string | null> {
    if (this.cfg.identityDelayMs) await sleep(this.cfg.identityDelayMs, signal);
    return this.cfg.museExtend ? (this.cfg.museExtend.identity ?? `viewer-${this.accountId}`) : null;
  }

  async submitExtend(source: { conversation: string; turn: string; output: string }, mode: ExtendMode, directive: string | null, hooks: SubmitHooks & { onCheckpoint: (c: MuseCheckpoint) => void }): Promise<MuseCheckpoint> {
    const cfg = this.cfg.museExtend;
    if (!cfg) throw new AdapterError("UI_CHANGED", "fake: Muse extend not simulated");
    await sleep(this.cfg.submitDelayMs ?? 5, hooks.signal);
    const next = cfg.script?.[0];
    if (next === "not_tip") {
      cfg.script!.shift();
      throw new AdapterError("UNKNOWN", "Video nguồn không còn là đầu nhánh trong hội thoại Muse", { definitive: true });
    }
    const checkpoint: MuseCheckpoint = { conversation: source.conversation, sourceTurn: source.turn, sourceOutput: source.output, baselineUsers: [], baselineAgents: [source.turn], baselineOutputs: [source.output], message: `extend ${source.output}`, templateVersion: "fake", acceptedUser: null };
    throwIfAborted(hooks.signal);
    hooks.onCheckpoint(checkpoint);
    hooks.onBeforeSend(source.conversation);
    (cfg.sent ??= []).push({ conversation: source.conversation, output: source.output, mode, directive });
    if (next === "ambiguous_after_send") {
      cfg.script!.shift();
      throw new AdapterError("AMBIGUOUS_SUBMIT", "Chưa xác định Muse đã nhận lời nhắn hay chưa", { afterSend: true });
    }
    checkpoint.acceptedUser = `u-ext-${++this.extendCounter}`;
    hooks.onCheckpoint(checkpoint);
    return checkpoint;
  }

  async observeExtend(checkpoint: MuseCheckpoint, hooks: ObserveHooks & { onCheckpoint: (c: MuseCheckpoint) => void }): Promise<ObserveResult> {
    const cfg = this.cfg.museExtend;
    if (!cfg) throw new AdapterError("AMBIGUOUS_SUBMIT", "fake: Muse extend not simulated", { afterSend: true });
    if (cfg.gate) await cfg.gate;
    await sleep(this.cfg.generateDelayMs ?? 10, hooks.signal);
    const step = cfg.script?.[0];
    if (step === "provider_error") {
      cfg.script!.shift();
      throw new AdapterError("PROVIDER_ERROR", "Muse gặp lỗi kỹ thuật, chưa tạo được tệp: “upstream 502”", { afterSend: true, definitive: true });
    }
    const k = checkpoint.acceptedUser ?? `u-ext-${++this.extendCounter}`;
    const base = this.lengths.get(checkpoint.sourceOutput) ?? cfg.baseMs ?? 10_000;
    const grow = step === "no_growth" ? (cfg.script!.shift(), 0) : (cfg.growMs ?? 10_000);
    const output = `sandbox://workspace/${k}-cumulative.mp4`;
    this.lengths.set(output, base + grow);
    return { media: [{ src: `${checkpoint.conversation}#${k}`, kind: "video", width: 1280, height: 720, museSource: { conversation: checkpoint.conversation, turn: `${k}-answer`, output } }], replyText: "Here is the extended video" };
  }

  async download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array> {
    this.calls.download++;
    throwIfAborted(signal);
    const step = this.take("download") as Extract<FakeStep, { phase: "download" }> | undefined;
    if (step?.error === "DOWNLOAD_FAILED") throw new AdapterError("DOWNLOAD_FAILED", "fake download error");
    let seed = this.calls.download * 1000;
    for (const ch of media.src) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    if (step?.error === "HTML") return new TextEncoder().encode("<!doctype html><html><body>error</body></html>");
    const prompt = this.promptByRef.get(media.src.split("#")[0]);
    const pinned = prompt !== undefined ? this.cfg.mediaForPrompt?.(prompt, media.kind === "video" ? "video" : "image") : null;
    if (pinned) return pinned;
    if (this.cfg.museExtend && media.kind === "video") {
      const ms = (media.museSource && this.lengths.get(media.museSource.output)) || this.cfg.museExtend.baseMs || 10_000;
      return fakeVibesMp4(ms, seed);
    }
    if (this.cfg.media) return this.cfg.media(media.kind, seed);
    return media.kind === "video" ? fakeMp4(seed) : fakePng(seed);
  }

  async findByPrompt(spec: SubmitSpec): Promise<string | null> {
    return this.cfg.history?.get(spec.prompt) ?? null;
  }

  async readQuota(): Promise<Quota> {
    this.cfg.quotaReads = (this.cfg.quotaReads ?? 0) + 1;
    if (this.cfg.quotaDelayMs) await sleep(this.cfg.quotaDelayMs);
    const src = typeof this.cfg.quota === "function" ? await this.cfg.quota() : this.cfg.quota;
    const now = this.cfg.now ? this.cfg.now() : Date.now();
    if (src === undefined) return { plan: "Free plan", usedPercent: 5, resetsOn: "Nov 2", readAt: now, additional: null };
    if (typeof src !== "string") return { ...src, readAt: now };
    const q = parseQuota(src, now);
    if (q.usedPercent === undefined) throw new AdapterError("UI_CHANGED", "Không đọc được hạn mức trong Cài đặt của Muse");
    return q;
  }

  async exitIp(): Promise<{ ip: string; country: string | null }> {
    if (this.cfg.proxyDown) throw new AdapterError("PROXY_FAILED", "net::ERR_PROXY_CONNECTION_FAILED");
    return { ip: this.cfg.ip ?? "10.0.0.1", country: this.cfg.country ?? "US" };
  }

  dispose(): void {}
}
