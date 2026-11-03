import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { AuthMeResponse } from "../../../shared/vibes";
import { maskRemote } from "../../../shared/vibes";
import type { PageCtl } from "../muse/driver";
import { AbortedError, AdapterError, type MediaRef, type ObserveHooks, type ObserveResult, type SubmitHooks, type SubmitResult, type VibesAdapter, type VibesSubmitSpec, sleep, throwIfAborted } from "../types";
import {
  buildExtendRequest,
  buildGenerateRequest,
  classifyBatchError,
  classifyHttpError,
  extendBatchId,
  frameHandle,
  generateBatchId,
  parseBatch,
  pickProjectId,
  VIBES,
  VIBES_TIMEOUTS,
} from "./protocol";

// Vibes driver over one account's own Vibes page (same partition and proxy as its Muse page, rules B32). Every call is
// a same-origin fetch from that page, so the browser sends the session cookie itself: the app never reads, sets or
// copies a cookie (R39, B33). Remote ids are never put into error messages (R52).

export interface VibesDriverDeps {
  page: () => PageCtl;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

interface ApiResult {
  status: number;
  body: unknown;
}

const js = (fn: string, ...args: unknown[]) => `(${fn})(${args.map((a) => JSON.stringify(a)).join(",")})`;

const FETCH_FN = `async (method, path, body, t) => {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), t);
  try {
    const init = { method, credentials: "include", headers: { accept: "application/json" }, signal: c.signal };
    if (body !== null) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    const r = await fetch(path, init);
    let b = null; const txt = await r.text(); try { b = txt ? JSON.parse(txt) : null; } catch { b = null; }
    return { status: r.status, body: b };
  } catch (e) { return { status: 0, body: null }; } finally { clearTimeout(tm); }
}`;

const DOWNLOAD_FN = `async (u, t) => {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), t);
  try { const r = await fetch(u, { credentials: "include", signal: c.signal }); if (!r.ok) return { ok: false, err: "HTTP " + r.status };
    const b = await r.blob(); const a = new Uint8Array(await b.arrayBuffer());
    let s = ""; for (let i = 0; i < a.length; i += 65536) s += String.fromCharCode.apply(null, a.subarray(i, i + 65536));
    return { ok: true, size: b.size, b64: btoa(s) }; }
  catch (e) { return { ok: false, err: "network" }; } finally { clearTimeout(tm); } }`;

export function classifyPageLoadError(e: unknown): AdapterError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/PROXY|TUNNEL|ERR_INVALID_AUTH_CREDENTIALS|ERR_NO_SUPPORTED_PROXIES/i.test(msg)) return new AdapterError("PROXY_FAILED", "Không kết nối được Vibes qua proxy");
  return new AdapterError("PRE_SUBMIT_TRANSIENT", "Lỗi mạng khi mở Vibes");
}

export class VibesDriver implements VibesAdapter {
  constructor(private d: VibesDriverDeps) {}

  private get page(): PageCtl {
    return this.d.page();
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return (this.d.sleep ?? sleep)(ms, signal);
  }

  private onVibes(): boolean {
    try {
      return new URL(this.page.url()).origin === VIBES.origin;
    } catch {
      return false;
    }
  }

  private async load(): Promise<void> {
    try {
      await this.page.load(VIBES.home, VIBES_TIMEOUTS.pageLoad);
    } catch (e) {
      if (/ERR_ABORTED/.test(e instanceof Error ? e.message : String(e))) return; // client-side redirect
      throw classifyPageLoadError(e);
    }
  }

  private async ensureOrigin(): Promise<void> {
    if (!this.onVibes()) await this.load();
  }

  private api(method: "GET" | "POST", path: string, body: unknown = null, timeoutMs: number = VIBES_TIMEOUTS.api): Promise<ApiResult> {
    return this.page.eval<ApiResult>(js(FETCH_FN, method, path, body, timeoutMs), timeoutMs + 5000);
  }

  /** R42: same-origin GET /api/auth/me from this account's Vibes page. A dead network twice in a row = the proxy. */
  async checkSession(signal?: AbortSignal): Promise<AuthMeResponse> {
    await this.ensureOrigin();
    throwIfAborted(signal);
    let r = await this.api("GET", VIBES.authMe);
    if (r.status === 0) {
      await this.load();
      throwIfAborted(signal);
      r = await this.api("GET", VIBES.authMe);
      if (r.status === 0) throw new AdapterError("PROXY_FAILED", "Không gọi được Vibes qua proxy");
    }
    return { status: r.status, body: r.body };
  }

  /** The account's “Muse4AI” project (found by name, else created once); remembered by the coordinator. */
  private async ensureProject(known: string | null): Promise<string> {
    if (known) return known;
    const list = await this.api("GET", `${VIBES.projects}?limit=25&offset=0&sort=newest&search=${encodeURIComponent(VIBES.projectName)}`);
    if (list.status === 200) {
      const id = pickProjectId(list.body);
      if (id) return id;
    } else if (list.status !== 0 && list.status < 500) {
      const c = classifyHttpError(list.status, list.body, false);
      throw new AdapterError(c.cls, c.message, { definitive: false });
    }
    const made = await this.api("POST", VIBES.projects, { name: VIBES.projectName, composition: { id: "studio-composition", tracks: [], duration: 5 } });
    const id = made.status >= 200 && made.status < 300 ? pickProjectId(made.body) : null;
    if (!id) {
      const c = classifyHttpError(made.status, made.body, false);
      throw new AdapterError(c.cls === "UNKNOWN" ? "PRE_SUBMIT_TRANSIENT" : c.cls, "Không tạo được dự án trên Vibes");
    }
    return id;
  }

  private async uploadFrame(file: string): Promise<ReturnType<typeof frameHandle>> {
    const b64 = fs.readFileSync(file).toString("base64");
    const r = await this.api("POST", VIBES.uploadImage, { image: b64 }, VIBES_TIMEOUTS.upload);
    if (r.status < 200 || r.status >= 300 || !r.body || typeof r.body !== "object") {
      const c = classifyHttpError(r.status, r.body, false);
      throw new AdapterError(c.cls, `Không tải được ảnh khung đầu lên Vibes (${c.message})`, { definitive: c.definitive });
    }
    const h = frameHandle(r.body as Record<string, unknown>);
    if (!h.image_ent_id && !h.oil_handle) throw new AdapterError("UI_CHANGED", "Vibes trả về ảnh tải lên không đúng dạng");
    return h;
  }

  async submit(spec: VibesSubmitSpec, hooks: SubmitHooks): Promise<SubmitResult> {
    await this.ensureOrigin();
    throwIfAborted(hooks.signal);
    const projectId = await this.ensureProject(spec.projectId);
    throwIfAborted(hooks.signal);
    const now = this.now();
    let req;
    if (spec.operation === "extend") {
      if (!spec.source) throw new AdapterError("UNKNOWN", "Thiếu video nguồn", { definitive: true });
      const directive = spec.extendMode === "directive" && spec.directive ? spec.directive : null;
      req = buildExtendRequest({ batchId: extendBatchId(now, randomBytes(4)), projectId: spec.source.projectId || projectId, now, source: spec.source, directive });
    } else {
      const startFrame = spec.mode === "reference" && spec.referencePath ? await this.uploadFrame(spec.referencePath) : null;
      throwIfAborted(hooks.signal);
      req = buildGenerateRequest({ batchId: generateBatchId(now, randomBytes(16)), prompt: spec.prompt, projectId, now, startFrame });
    }
    // R48: the batch id is persisted (submitting + remote_ref) before the first request that names it.
    hooks.onBeforeSend(req.batchId);
    const shell = await this.api("POST", VIBES.batches, req.shell);
    if (shell.status < 200 || shell.status >= 300) {
      // The generation itself was not triggered: a refused shell is a definitive failure, a lost answer is not.
      const lost = shell.status === 0 || shell.status >= 500;
      const c = classifyHttpError(shell.status, shell.body, lost);
      throw new AdapterError(c.cls, c.message, { afterSend: true, definitive: c.definitive, notStarted: !lost });
    }
    await this.wait(VIBES_TIMEOUTS.settleAfterShell, hooks.signal).catch((e) => {
      if (e instanceof AbortedError) throw e;
    });
    const gen = await this.api("POST", VIBES.generateVideos, req.trigger);
    if (gen.status < 200 || gen.status >= 300) {
      const lost = gen.status === 0 || gen.status >= 500;
      const c = classifyHttpError(gen.status, gen.body, true);
      this.d.log?.("vibes trigger refused", { status: gen.status, batch: maskRemote(req.batchId) });
      // A 4xx answer means Vibes refused the trigger (nothing generated); a lost/5xx answer is ambiguous (R48).
      throw new AdapterError(c.cls, c.message, { afterSend: true, definitive: c.definitive, notStarted: !lost });
    }
    return { remoteRef: req.batchId, acceptedAt: this.now(), projectId };
  }

  /** Follows exactly this batch (R48). Never searches by prompt and never takes another batch's items. */
  async observe(batchId: string, hooks: ObserveHooks): Promise<ObserveResult> {
    await this.ensureOrigin();
    const start = this.now();
    let transient = 0;
    while (this.now() - start < hooks.timeoutMs) {
      throwIfAborted(hooks.signal);
      const r = await this.api("GET", `${VIBES.batches}/${encodeURIComponent(batchId)}`);
      if (r.status === 401) throw new AdapterError("SESSION_EXPIRED", "Phiên Vibes đã hết khi đang chờ kết quả", { afterSend: true });
      if (r.status === 404) {
        if (this.now() - start > VIBES_TIMEOUTS.notFoundGrace) throw new AdapterError("AMBIGUOUS_SUBMIT", "Không thấy lượt này trên Vibes", { afterSend: true });
      } else if (r.status === 200) {
        transient = 0;
        const b = parseBatch(r.body, batchId, null);
        if (!b.found) throw new AdapterError("AMBIGUOUS_SUBMIT", "Vibes trả về lượt khác — không nhận", { afterSend: true });
        if (b.hasError) {
          const c = classifyBatchError(b.errorText);
          throw new AdapterError(c.cls, c.message, { afterSend: true, definitive: c.definitive });
        }
        if (b.complete) return { media: b.videos.map((v) => ({ src: v.contentId, kind: "video" as const, remote: v })) };
      } else if (++transient > VIBES_TIMEOUTS.transientPolls) {
        throw new AdapterError("AMBIGUOUS_SUBMIT", "Vibes không trả lời khi đang chờ kết quả", { afterSend: true });
      }
      await this.wait(VIBES_TIMEOUTS.pollEvery, hooks.signal);
    }
    throw new AdapterError("AMBIGUOUS_SUBMIT", "Quá thời gian chờ Vibes trả kết quả", { afterSend: true });
  }

  async download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array> {
    await this.ensureOrigin();
    const urls = [`${VIBES.downloadVideo}?id=${encodeURIComponent(media.src)}`];
    if (media.remote?.videoUrl) urls.push(media.remote.videoUrl);
    let lastErr = "";
    for (let i = 0; i < VIBES_TIMEOUTS.downloadTries; i++) {
      for (const u of urls) {
        throwIfAborted(signal);
        try {
          const r = await this.page.eval<{ ok: boolean; err?: string; size?: number; b64?: string }>(js(DOWNLOAD_FN, u, VIBES_TIMEOUTS.download), VIBES_TIMEOUTS.download + 5000);
          if (r.ok && r.b64 && (r.size ?? 0) > 0) return Uint8Array.from(Buffer.from(r.b64, "base64"));
          lastErr = r.err || "tệp rỗng";
        } catch (e) {
          if (e instanceof AbortedError) throw e;
          lastErr = "lỗi trang";
        }
      }
      await this.wait(2000, signal);
    }
    throw new AdapterError("DOWNLOAD_FAILED", `Tải video từ Vibes lỗi: ${lastErr.slice(0, 60)}`);
  }

  dispose(): void {}
}
