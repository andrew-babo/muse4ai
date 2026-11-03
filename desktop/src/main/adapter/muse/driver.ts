import { attributeMuseExtend, findMuseAcceptedTurn, museHistoryShown, museSnapshotKey, museSourceIsTip, museThreadReadiness, snapshotOutputs, toTurnSnapshot, type MuseCheckpoint, type MuseItem } from "../../../shared/museExtend";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { VERIFIED_CAPABILITIES } from "../../../shared/capabilities";
import { parseTokenAmount, resetLabelToTime } from "../../../shared/quota";
import type { CapabilityKey, JobKind, Quota } from "../../../shared/types";
import { AbortedError, AdapterError, type MediaRef, type MuseAdapter, type ObserveHooks, type ObserveResult, type SubmitHooks, type SubmitResult, type SubmitSpec, sleep, throwIfAborted } from "../types";
import {
  ATTACHMENTS_FN,
  MUSE_TURNS_FN,
  buildMuseExtendMessage,
  classifyMuseReply,
  MUSE_EXTEND_TEMPLATE_VERSION,
  buildMessage,
  MARK_UPLOAD_INPUT_FN,
  MUSE,
  QUOTA_DIALOG_TEXT_FN,
  QUOTA_MENU_POINT_FN,
  QUOTA_SETTINGS_POINT_FN,
  SCROLL_BOTTOM_JS,
  SEL,
  SEND_BUTTON_FN,
  SEND_MARK,
  TEXT,
  THREAD_PATH_RE,
  TIMEOUTS,
  UPLOAD_CONFIRMED_FN,
  VIDEO_EXT_RE,
} from "./selectors";

/**
 * A finished Muse reply without the requested file → the error class (R6, rev 7.1 R64). A technical failure Muse
 * reports itself is definitive (nothing was made; the account is fine) and never resent automatically.
 */
export function replyError(text: string): AdapterError {
  const quote = `“${String(text ?? "").trim().slice(0, 160)}”`;
  switch (classifyMuseReply(text)) {
    case "quota":
      return new AdapterError("QUOTA_LIMIT", "Muse báo hết hạn mức", { afterSend: true });
    case "provider_error":
      return new AdapterError("PROVIDER_ERROR", `Muse gặp lỗi kỹ thuật, chưa tạo được tệp: ${quote}`, { afterSend: true, definitive: true });
    default:
      return new AdapterError("CONTENT_REFUSED", `Muse không tạo nội dung: ${quote}`, { afterSend: true });
  }
}

interface TurnsState {
  conversation: string;
  items: MuseItem[];
  users: { id: string; text: string }[];
  agents: { id: string; turn: string | null; text: string; media: { output: string; src: string; width: number; height: number }[] }[];
  stop: boolean;
  login?: boolean;
}

// Muse web driver over one account's page (Electron webContents). DOM + in-page fetch only.
// Built on muse2api's proven page logic (MIT, see LICENSES/muse2api.txt): fresh /thread/new per job,
// native-setter prompt entry, composer-local upload, strict per-kind attachment matching with a source
// baseline, inner-scroller scrolling, media-report-aware refusal detection, and Usage-panel quota parsing.
// Deliberately NOT ported: download-folder mtime guessing, automatic follow-up messages, Enter-key resend,
// shared-tab fallback, cookie export/import (R4/R12, B12).

export interface PageCtl {
  url(): string;
  load(url: string, timeoutMs: number): Promise<void>;
  eval<T>(code: string, timeoutMs?: number): Promise<T>;
  click(selector: string): Promise<boolean>;
  clickAt(x: number, y: number): Promise<void>;
  setFiles(selector: string, paths: string[]): Promise<boolean>;
  insertText(text: string): Promise<void>;
  pressEscape(): Promise<void>;
}

export interface DriverDeps {
  page: () => PageCtl;
  exitIp: () => Promise<{ ip: string; country: string | null }>;
  /** Account-wide send pacing shared with HTTP, before the durable send intent. */
  beforeSend?: (signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Injectable for tests (deterministic time). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Diagnostics only (no prompt, no thread path). */
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const js = (fn: string, ...args: unknown[]) => `(${fn})(${args.map((a) => JSON.stringify(a)).join(",")})`;

/** Map Chromium network error codes from loadURL to adapter error classes. */
export function classifyLoadError(e: unknown): AdapterError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/PROXY|TUNNEL|ERR_INVALID_AUTH_CREDENTIALS|ERR_NO_SUPPORTED_PROXIES/i.test(msg)) return new AdapterError("PROXY_FAILED", "Không kết nối được qua proxy");
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK|timeout/i.test(msg)) return new AdapterError("PRE_SUBMIT_TRANSIENT", "Lỗi mạng khi mở Muse");
  return new AdapterError("PRE_SUBMIT_TRANSIENT", `Không mở được Muse (${msg.slice(0, 80)})`);
}

const READY_FN = `(sel, connecting) => {
  const ta = document.querySelector(sel.textarea);
  const h = document.querySelector(sel.hydration);
  const body = document.body ? document.body.innerText : "";
  return {
    ready: document.readyState === "complete" && !!ta && !ta.disabled && (!h || h.getAttribute("data-hatch-shell-hydration-state") === "hydrated") && !body.includes(connecting),
    login: !ta && !!document.querySelector(sel.loginInput),
    loginText: body.slice(0, 3000),
    hasBody: body.length > 50,
    hasTextarea: !!ta,
  };
}`;

export const STATE_FN = `(sel, attFn, flagSrc) => {
  const bubbles = Array.from(document.querySelectorAll(sel.agentBubble));
  const last = bubbles.length ? (bubbles[bubbles.length - 1].innerText || "").trim() : "";
  const ta = document.querySelector(sel.textarea);
  // Short status labels (e.g. "Delivery not confirmed") anywhere on the page: a side panel can push them out of the body tail.
  const flags = [];
  if (document.body && flagSrc) {
    const re = new RegExp(flagSrc, "i");
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; let seen = 0;
    while ((n = w.nextNode()) && seen < 20000) {
      seen++;
      const t = (n.nodeValue || "").trim();
      if (t && t.length < 80 && re.test(t)) { flags.push(t); if (flags.length >= 3) break; }
    }
  }
  return {
    media: attFn(sel),
    stop: !!document.querySelector(sel.stop),
    agentCount: bubbles.length,
    agentText: last.slice(-1200),
    path: location.pathname,
    login: !ta && !!document.querySelector(sel.loginInput),
    tail: (document.body ? document.body.innerText.slice(-1500) : "") + (flags.length ? "\\n" + flags.join("\\n") : ""),
  };
}`;

interface RawMedia {
  tid: string;
  hasVideo: boolean;
  src: string;
  vSrc: string;
  iSrc: string;
  w: number;
  h: number;
}

interface PageState {
  media: RawMedia[];
  stop: boolean;
  agentCount: number;
  agentText: string;
  path: string;
  login: boolean;
  tail: string;
}

/** Strict per-kind match (muse2api `_wait_attachment`): a video job only accepts a real video source. */
export function pickSource(m: RawMedia, kind: JobKind): string {
  if (kind === "video") return m.vSrc || (VIDEO_EXT_RE.test(m.src) ? m.src : "");
  const isVideo = m.hasVideo || VIDEO_EXT_RE.test(m.src);
  return m.tid.includes("image") || !isVideo ? m.iSrc || m.src : "";
}

const allSources = (list: RawMedia[]) => list.flatMap((m) => [m.src, m.vSrc, m.iSrc]).filter(Boolean);

export class MuseDriver implements MuseAdapter {
  /** Media sources that existed before our send, per thread (or "pending" until the thread URL is known). */
  private baselines = new Map<string, Set<string>>();
  private baseAgentCount = new Map<string, number>();

  constructor(private d: DriverDeps) {}

  private get page(): PageCtl {
    return this.d.page();
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return (this.d.sleep ?? sleep)(ms, signal);
  }

  private async load(url: string): Promise<void> {
    try {
      await this.page.load(url, TIMEOUTS.pageLoad);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ERR_ABORTED/.test(msg)) return; // client-side redirect, page still loads
      throw classifyLoadError(e);
    }
  }

  private onMuse(): boolean {
    try {
      return new URL(this.page.url()).origin === MUSE.origin;
    } catch {
      return false;
    }
  }

  private async ensureOrigin(): Promise<void> {
    if (!this.onMuse()) await this.load(MUSE.home);
  }

  private async sessionInfo(): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const code = js(
      `async (api, t) => { const c = new AbortController(); const tm = setTimeout(() => c.abort(), t);
        try { const r = await fetch(api, { credentials: "include", redirect: "manual", signal: c.signal }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; }
        catch (e) { return { status: 0, body: { error: String(e) } }; } finally { clearTimeout(tm); } }`,
      MUSE.sessionApi,
      TIMEOUTS.sessionFetch,
    );
    return this.page.eval(code, TIMEOUTS.sessionFetch + 3000);
  }

  async checkSession(signal?: AbortSignal): Promise<void> {
    await this.ensureOrigin();
    throwIfAborted(signal);
    let info = await this.sessionInfo();
    if (info.status === 0) {
      await this.load(MUSE.home);
      info = await this.sessionInfo();
      if (info.status === 0) throw new AdapterError("PROXY_FAILED", "Không gọi được Muse qua proxy");
    }
    if (info.status === 401) throw new AdapterError("SESSION_EXPIRED", "Phiên đăng nhập Muse đã hết");
    if (info.status === 403) throw new AdapterError("CHECKPOINT", "Muse từ chối truy cập (cần xác minh hoặc vùng không hỗ trợ)");
    if (info.status !== 200 || !info.body || info.body.status !== "assigned") {
      const ready = await this.page.eval<{ login: boolean; loginText: string }>(js(READY_FN, SEL, TEXT.connecting));
      if (ready.login || TEXT.login.test(ready.loginText)) throw new AdapterError("SESSION_EXPIRED", "Muse yêu cầu đăng nhập");
      // Not proven logged out — treat as transient so a healthy account is not disabled.
      throw new AdapterError("PRE_SUBMIT_TRANSIENT", `Muse chưa sẵn sàng (phiên ${info.status}${info.body?.status ? ` · ${String(info.body.status)}` : ""})`);
    }
    if (info.body.vm_state !== "RUNNING" && info.body.vm_state !== "DISABLED" && typeof info.body.vm_id === "string") {
      await this.wake(String(info.body.vm_id), signal);
    }
  }

  private async wake(vmId: string, signal?: AbortSignal): Promise<void> {
    const code = js(
      `async (api, body, t) => { const c = new AbortController(); const tm = setTimeout(() => c.abort(), t);
        try { const r = await fetch(api, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: c.signal }); return r.status; }
        catch (e) { return 0; } finally { clearTimeout(tm); } }`,
      MUSE.wakeApi,
      { vm_id: vmId, retry_count: 0, connect_attempt_id: randomUUID() },
      TIMEOUTS.wakeFetch,
    );
    await this.page.eval(code, TIMEOUTS.wakeFetch + 3000);
    const until = this.now() + TIMEOUTS.wakePoll;
    while (this.now() < until) {
      await this.wait(2000, signal);
      const s = await this.sessionInfo();
      if (s.body?.vm_state === "RUNNING") return;
    }
    throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Máy ảo Muse chưa khởi động xong");
  }

  async probeCapabilities(): Promise<Partial<Record<CapabilityKey, boolean>>> {
    await this.checkSession();
    // Muse capabilities only: Vibes keys are decided by the app version (rules B37), never by a Muse probe.
    const out: Partial<Record<CapabilityKey, boolean>> = {};
    for (const k of ["image.text", "image.reference", "video.text", "video.reference"] as const) out[k] = VERIFIED_CAPABILITIES[k];
    return out;
  }

  private async waitReady(signal: AbortSignal): Promise<void> {
    const until = this.now() + TIMEOUTS.ready;
    let last: { ready: boolean; login: boolean; loginText: string; hasBody: boolean; hasTextarea: boolean } | null = null;
    while (this.now() < until) {
      throwIfAborted(signal);
      last = await this.page.eval(js(READY_FN, SEL, TEXT.connecting));
      if (last?.ready) return;
      if (last?.login) throw new AdapterError("SESSION_EXPIRED", "Muse yêu cầu đăng nhập");
      await this.wait(500, signal);
    }
    if (last && last.hasBody && !last.hasTextarea && !last.login) throw new AdapterError("UI_CHANGED", "Không tìm thấy ô nhập tin nhắn của Muse");
    throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Trang Muse chưa sẵn sàng");
  }

  private async attach(paths: string[], signal: AbortSignal, video = false): Promise<void> {
    for (const p of paths) if (!fs.existsSync(p)) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Ảnh tham chiếu không còn trên máy");
    const marked = await this.page.eval<boolean>(js(MARK_UPLOAD_INPUT_FN, SEL));
    if (!marked) throw new AdapterError("UI_CHANGED", "Không tìm thấy chỗ đính kèm ảnh của Muse");
    const ok = await this.page.setFiles(`[${SEL.uploadMark}="1"]`, paths);
    if (!ok) throw new AdapterError("UI_CHANGED", "Không tìm thấy chỗ đính kèm ảnh của Muse");
    const until = this.now() + (video ? TIMEOUTS.videoUpload : TIMEOUTS.upload);
    while (this.now() < until) {
      await this.wait(300, signal);
      if (await this.page.eval<boolean>(js(UPLOAD_CONFIRMED_FN, SEL, TEXT.removeAttachment.source))) {
        await this.wait(500, signal);
        return;
      }
    }
    throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Muse chưa nhận ảnh tham chiếu");
  }

  private async typePrompt(message: string): Promise<void> {
    const setOk = await this.page.eval<boolean>(
      js(
        `(sel, text) => { const ta = document.querySelector(sel.textarea); if (!ta) return false; ta.scrollIntoView({ block: "center" }); ta.focus();
           const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(ta, text);
           ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true })); return ta.value === text; }`,
        SEL,
        message,
      ),
    );
    if (setOk) return;
    // Fallback: one insertText of the whole prompt (never per-key typing — it dropped the prompt head in Phase 1).
    await this.page.eval(js(`(sel) => { const ta = document.querySelector(sel.textarea); if (ta) { ta.focus(); ta.select(); } }`, SEL));
    await this.page.insertText(message);
    const v = await this.page.eval<string>(js(`(sel) => (document.querySelector(sel.textarea) || {}).value || ""`, SEL));
    if (v !== message) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Không nhập được prompt vào Muse");
  }

  async submit(spec: SubmitSpec, hooks: SubmitHooks): Promise<SubmitResult> {
    const { signal } = hooks;
    await this.checkSession(signal);
    await this.load(MUSE.newThread);
    await this.waitReady(signal);
    if (spec.referencePaths.length) await this.attach(spec.referencePaths, signal, spec.referenceMedia === "video");
    const message = buildMessage(spec.kind, spec.mode, spec.prompt, spec.referenceMedia);
    await this.typePrompt(message);

    const sendUntil = this.now() + TIMEOUTS.sendButton;
    let send = "no-button";
    while (this.now() < sendUntil) {
      send = await this.page.eval<string>(js(SEND_BUTTON_FN, SEL, TEXT.send.source));
      if (send === "ready") break;
      await this.wait(150, signal);
    }
    if (send === "no-button") throw new AdapterError("UI_CHANGED", "Không tìm thấy nút gửi của Muse");
    if (send !== "ready") throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Nút gửi của Muse chưa bật");
    // Final check right before sending: the prompt must still be exactly ours.
    const current = await this.page.eval<string>(js(`(sel) => (document.querySelector(sel.textarea) || {}).value || ""`, SEL));
    if (current !== message) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Prompt trong ô nhập của Muse bị thay đổi");
    const before = await this.state();
    await this.d.beforeSend?.(signal);
    throwIfAborted(signal);
    hooks.onBeforeSend();
    // ---- after this line nothing may be retried automatically (R12). Exactly one click; no Enter fallback.
    try {
      const clicked = await this.page.click(SEND_MARK);
      if (!clicked) throw new Error("click failed");
    } catch {
      throw new AdapterError("AMBIGUOUS_SUBMIT", "Không chắc đã bấm gửi", { afterSend: true });
    }
    const baseline = new Set(allSources(before.media));
    this.baselines.set("pending", baseline);
    this.baseAgentCount.set("pending", before.agentCount);
    const remember = (ref: string | null): SubmitResult => {
      if (ref) {
        this.baselines.set(ref, baseline);
        this.baseAgentCount.set(ref, before.agentCount);
      }
      return { remoteRef: ref, acceptedAt: this.now() };
    };
    const acceptUntil = this.now() + TIMEOUTS.accept;
    while (this.now() < acceptUntil) {
      await this.wait(500, signal); // aborted after the click (takeover now): stop reading the page; the job is already needs_review
      const s = await this.state().catch(() => null);
      if (!s) continue;
      if (THREAD_PATH_RE.test(s.path)) return remember(s.path);
      if (s.agentCount > before.agentCount || s.stop) {
        // The page took the message; give the thread URL a moment to appear.
        const extra = this.now() + 8000;
        while (this.now() < extra) {
          await this.wait(500, signal);
          const s2 = await this.state().catch(() => null);
          if (s2 && THREAD_PATH_RE.test(s2.path)) return remember(s2.path);
        }
        return remember(null);
      }
    }
    throw new AdapterError("AMBIGUOUS_SUBMIT", "Không thấy Muse xác nhận đã nhận tin nhắn", { afterSend: true });
  }

  private async state(): Promise<PageState> {
    await this.page.eval(SCROLL_BOTTOM_JS).catch(() => undefined);
    return this.page.eval<PageState>(`(${STATE_FN})(${JSON.stringify(SEL)}, ${ATTACHMENTS_FN}, ${JSON.stringify(TEXT.deliveryFailed.source)})`);
  }

  private pathNow(): string {
    try {
      return new URL(this.page.url()).pathname;
    } catch {
      return "";
    }
  }

  /** Open the job's own thread (after an app restart, or after the account page was rebuilt mid-wait). */
  private async reopenThread(remoteRef: string, signal: AbortSignal): Promise<void> {
    await this.load(MUSE.origin + remoteRef).catch((e) => {
      throw new AdapterError(e instanceof AdapterError ? e.cls : "PROXY_FAILED", "Không mở lại được lượt trên Muse", { afterSend: true });
    });
    await this.waitReady(signal).catch((e) => {
      if (e instanceof AdapterError) throw new AdapterError(e.cls, e.message, { afterSend: true });
      throw e;
    });
  }

  async observe(remoteRef: string | null, kind: JobKind, hooks: ObserveHooks): Promise<ObserveResult> {
    const { signal } = hooks;
    let resumed = !!remoteRef && this.pathNow() !== remoteRef;
    if (resumed && remoteRef) await this.reopenThread(remoteRef, signal);
    // A thread is created fresh per job, so after a restart everything in it is ours (empty baseline).
    const key = remoteRef ?? "pending";
    let baseline = resumed ? new Set<string>() : (this.baselines.get(key) ?? this.baselines.get("pending") ?? new Set<string>());
    let baseAgents = resumed ? 0 : (this.baseAgentCount.get(key) ?? this.baseAgentCount.get("pending") ?? 0);

    const t0 = this.now();
    let stable = 0;
    let lastKey = "";
    let quietSince = 0;
    let lastText = "";
    let otherStable = 0;
    let lastOtherKey = "";
    let reloaded = false;
    while (this.now() - t0 < hooks.timeoutMs) {
      throwIfAborted(signal);
      await this.wait(TIMEOUTS.pollMs, signal);
      // The page was rebuilt under us (renderer crash/hang recycle): go back to this job's thread.
      if (remoteRef && this.pathNow() !== remoteRef) {
        await this.reopenThread(remoteRef, signal);
        resumed = true;
        baseline = new Set<string>();
        baseAgents = 0;
        stable = 0;
        lastKey = "";
        continue;
      }
      let s: PageState;
      try {
        s = await this.state();
      } catch (e) {
        if (e instanceof AbortedError) throw e;
        continue;
      }
      if (s.login) throw new AdapterError("SESSION_EXPIRED", "Phiên Muse hết trong lúc chờ kết quả", { afterSend: true });
      const elapsed = this.now() - t0;
      const agentReplied = s.agentCount > baseAgents;

      // Gateway never acknowledged the message (muse2api): stop button can show without delivery.
      if (elapsed > (kind === "video" ? TIMEOUTS.deliveryJudgeVideo : TIMEOUTS.deliveryJudge) && !agentReplied && TEXT.deliveryFailed.test(s.tail)) {
        throw new AdapterError("AMBIGUOUS_SUBMIT", "Muse báo chưa nhận được tin nhắn (Still sending)", { afterSend: true });
      }

      const fresh = s.media.filter((m) => !allSources([m]).some((x) => baseline.has(x)));
      const wanted = fresh.map((m) => ({ m, src: pickSource(m, kind) })).filter((x) => x.src);
      const wantedKey = wanted.map((x) => x.src).join("|");
      if (wanted.length) {
        stable = wantedKey === lastKey ? stable + 1 : 1;
        lastKey = wantedKey;
        const sized = wanted.every((x) => x.m.w > 0 && x.m.h > 0);
        // Agent done → accept once sized or stable; stop still shown → only after a longer stable run.
        const settled = s.stop ? stable >= TIMEOUTS.stablePolls + TIMEOUTS.stopGracePolls : sized || stable >= TIMEOUTS.stablePolls;
        if (settled) {
          const turns = kind === "video" ? await this.turns().catch(() => null) : null;
          return { media: wanted.map((x) => {
            const bindings = turns?.agents.flatMap(a => a.media.filter(m => m.src === x.src && m.output && a.id).map(m => ({ conversation: turns.conversation, turn: a.id, output: m.output }))) ?? [];
            return { src: x.src, kind: kind === "video" ? ("video" as const) : ("image" as const), width: x.m.w || undefined, height: x.m.h || undefined, ...(bindings.length === 1 ? { museSource: bindings[0] } : {}) };
          }), replyText: s.agentText };
        }
        continue;
      }
      stable = 0;
      lastKey = "";

      if (s.stop || !agentReplied) {
        quietSince = 0;
        otherStable = 0;
        continue;
      }
      // Agent finished with no media of the requested kind.
      if (s.agentText !== lastText) {
        lastText = s.agentText;
        quietSince = this.now();
        continue;
      }
      if (!quietSince) quietSince = this.now();
      const quietFor = this.now() - quietSince;
      if (TEXT.quota.test(s.agentText)) throw new AdapterError("QUOTA_LIMIT", "Muse báo hết hạn mức", { afterSend: true });
      if (fresh.length) {
        // Only media of the other kind (e.g. a still image for a video job): hand it to the coordinator after the grace.
        const k = allSources(fresh).join("|");
        otherStable = k === lastOtherKey ? otherStable + 1 : 1;
        lastOtherKey = k;
        if (quietFor >= TIMEOUTS.refusalGrace[kind] && otherStable >= TIMEOUTS.refusalPolls) {
          return { media: fresh.map((m) => ({ src: m.vSrc || m.iSrc || m.src, kind: (m.vSrc ? "video" : "image") as "image" | "video", width: m.w || undefined, height: m.h || undefined })), replyText: s.agentText };
        }
        continue;
      }
      const graceOver = quietFor >= TIMEOUTS.refusalGrace[kind] && quietFor >= TIMEOUTS.refusalPolls * TIMEOUTS.pollMs;
      // Muse said its own tool/service failed (upstream 502, INTERNAL …): nothing will arrive — not a refusal (R64).
      if (graceOver && classifyMuseReply(s.agentText) === "provider_error") throw replyError(s.agentText);
      const threadRef = remoteRef ?? (s.path.startsWith("/thread/") ? s.path : null);
      if (graceOver && !reloaded && threadRef) {
        // Reply in, no attachment seen: open the thread once more before judging — a result Muse finished on a page
        // that sat hidden may only show on a fresh load (seen on the reference VPS 27/10/2026). Everything in the
        // job's own thread is ours, so the baseline starts empty, as after a restart.
        reloaded = true;
        this.d.log?.("muse result not seen after reply, re-opening thread", { kind, quietMs: quietFor });
        await this.reopenThread(threadRef, signal);
        resumed = true;
        baseline = new Set<string>();
        baseAgents = 0;
        stable = 0;
        lastKey = "";
        quietSince = 0;
        lastText = "";
        otherStable = 0;
        lastOtherKey = "";
        continue;
      }
      // Says it produced a file, or offers to animate the result — keep waiting for the attachment.
      if (TEXT.mediaReport.test(s.agentText) || TEXT.mediaOffer.test(s.agentText)) continue;
      if (graceOver) throw replyError(s.agentText);
    }
    throw new AdapterError("AMBIGUOUS_SUBMIT", "Quá thời gian chờ Muse trả kết quả", { afterSend: true });
  }

  private async turns(): Promise<TurnsState> {
    await this.page.eval(SCROLL_BOTTOM_JS).catch(() => undefined);
    const s = (await this.page.eval<TurnsState | null>(js(MUSE_TURNS_FN, SEL))) ?? ({} as Partial<TurnsState>);
    const login = await this.page.eval<boolean>(js(`(sel) => !document.querySelector(sel.textarea) && !!document.querySelector(sel.loginInput)`, SEL)).catch(() => false);
    const items = Array.isArray(s.items) ? s.items : [];
    return {
      conversation: typeof s.conversation === "string" ? s.conversation : "",
      items,
      users: Array.isArray(s.users) ? s.users : [],
      agents: Array.isArray(s.agents) ? s.agents : [],
      stop: !!s.stop,
      login,
    };
  }

  /**
   * Reads a just-reopened thread until it can be judged (pure rule `museThreadReadiness`). The composer appears
   * before the history and the source clip streams in after it, and the page may not answer while it does, so
   * failed reads are retried until the deadline. Nothing has been sent: running out of time without any history
   * is transient (the job retries later), never “source gone”.
   */
  private async settledThread(source: { conversation: string; turn: string; output: string }, signal: AbortSignal): Promise<TurnsState> {
    const until = this.now() + TIMEOUTS.threadSettle;
    const reads: { snapshot: TurnsState; key: string }[] = [];
    for (;;) {
      throwIfAborted(signal);
      let s: TurnsState | null = null;
      try {
        s = await this.turns();
      } catch (e) {
        if (e instanceof AbortedError) throw e;
      }
      if (s?.login) throw new AdapterError("SESSION_EXPIRED", "Muse yêu cầu đăng nhập");
      if (s && museHistoryShown(s)) reads.push({ snapshot: s, key: museSnapshotKey(s) });
      const verdict = museThreadReadiness(reads, source, this.now() >= until);
      if (verdict === "ready" || verdict === "judge") return reads[reads.length - 1].snapshot;
      if (verdict === "loading") throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Muse chưa tải xong hội thoại");
      await this.wait(1000, signal);
    }
  }

  async identity(signal?: AbortSignal): Promise<string | null> {
    await this.checkSession(signal);
    return this.page.eval<string | null>(js(`async (url) => { try { const r = await fetch(url, { method: "POST", credentials: "include", cache: "no-store", signal: AbortSignal.timeout(12000) }); if (!r.ok) return null; const b = await r.json(); return b.ok === true && typeof b.viewer_id === "string" ? b.viewer_id : null; } catch { return null; } }`, MUSE.identityApi), 15000);
  }

  async submitExtend(source: { conversation: string; turn: string; output: string }, mode: "auto" | "directive", directive: string | null, hooks: SubmitHooks & { onCheckpoint: (c: MuseCheckpoint) => void }): Promise<MuseCheckpoint> {
    if (!THREAD_PATH_RE.test(source.conversation)) throw new AdapterError("UI_CHANGED", "Nguồn hội thoại Muse không hợp lệ");
    await this.checkSession(hooks.signal);
    // Nothing is sent yet: a failure to open the thread is an ordinary pre-send error (never “after send”).
    // The next step of a chain finds the page already on this thread with the new head playing — reloading would
    // stream the whole cumulative clip through the proxy again (154 s for 40 s / 52 MB, VPS 28/10/2026).
    if (this.pathNow() !== source.conversation) await this.load(MUSE.origin + source.conversation);
    await this.waitReady(hooks.signal);
    const before = await this.settledThread(source, hooks.signal);
    if (before.stop) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Muse vẫn đang trả lời trong hội thoại này");
    const notTip = museSourceIsTip(before, source);
    if (notTip) throw notTip.ui ? new AdapterError("UI_CHANGED", notTip.reason) : new AdapterError("UNKNOWN", notTip.reason, { definitive: true });
    const message = buildMuseExtendMessage(source.output, mode, directive);
    const checkpoint: MuseCheckpoint = {
      conversation: source.conversation,
      sourceTurn: source.turn,
      sourceOutput: source.output,
      baselineUsers: before.users.map((u) => u.id),
      baselineAgents: before.agents.map((a) => a.id),
      baselineOutputs: snapshotOutputs(before),
      message,
      templateVersion: MUSE_EXTEND_TEMPLATE_VERSION,
      acceptedUser: null,
    };
    await this.typePrompt(message);
    const sendUntil = this.now() + TIMEOUTS.sendButton;
    let send = "no-button";
    while (this.now() < sendUntil) {
      send = await this.page.eval<string>(js(SEND_BUTTON_FN, SEL, TEXT.send.source));
      if (send === "ready") break;
      await this.wait(150, hooks.signal);
    }
    if (send === "no-button") throw new AdapterError("UI_CHANGED", "Không tìm thấy nút gửi của Muse");
    if (send !== "ready") throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Nút gửi Muse chưa sẵn sàng");
    const current = await this.page.eval<string>(js(`(sel) => (document.querySelector(sel.textarea) || {}).value || ""`, SEL));
    if (current !== message) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Lời nhắn trong ô nhập của Muse bị thay đổi");
    throwIfAborted(hooks.signal);
    await this.d.beforeSend?.(hooks.signal);
    throwIfAborted(hooks.signal);
    hooks.onCheckpoint(checkpoint);
    hooks.onBeforeSend(source.conversation);
    // ---- after this line nothing may be retried automatically (R12/R58). Exactly one click.
    let clicked = false;
    try {
      clicked = await this.page.click(SEND_MARK);
    } catch {
      clicked = false;
    }
    if (!clicked) throw new AdapterError("AMBIGUOUS_SUBMIT", "Chưa xác định Muse đã nhận lời nhắn hay chưa", { afterSend: true });
    const until = this.now() + TIMEOUTS.accept;
    while (this.now() < until) {
      await this.wait(500, hooks.signal);
      const state = await this.turns().catch(() => null);
      if (!state) continue;
      const accepted = findMuseAcceptedTurn(checkpoint, toTurnSnapshot(state));
      if (accepted) {
        checkpoint.acceptedUser = accepted;
        hooks.onCheckpoint(checkpoint);
        return checkpoint;
      }
    }
    throw new AdapterError("AMBIGUOUS_SUBMIT", "Chưa xác định Muse đã nhận lời nhắn hay chưa", { afterSend: true });
  }

  /**
   * Follows exactly our continuation message (R58): ordered attribution of the reply group, one new validated file,
   * stable for two polls. A finished text-only reply is classified (quota / technical / refusal); anything unclear
   * goes to review — never a resend.
   */
  async observeExtend(checkpoint: MuseCheckpoint, hooks: ObserveHooks & { onCheckpoint: (c: MuseCheckpoint) => void }): Promise<ObserveResult> {
    const afterSend = { afterSend: true } as const;
    if (!THREAD_PATH_RE.test(checkpoint.conversation)) throw new AdapterError("AMBIGUOUS_SUBMIT", "Mất nguồn hội thoại Muse", afterSend);
    if (this.pathNow() !== checkpoint.conversation) await this.reopenThread(checkpoint.conversation, hooks.signal);
    const t0 = this.now();
    let lastKey = "";
    let stable = 0;
    let lastText = "";
    let quietSince = 0;
    let reloaded = false;
    let ambiguousReads = 0;
    while (this.now() - t0 < hooks.timeoutMs) {
      throwIfAborted(hooks.signal);
      if (this.pathNow() !== checkpoint.conversation) {
        await this.reopenThread(checkpoint.conversation, hooks.signal);
        continue;
      }
      let state: TurnsState;
      try {
        state = await this.turns();
      } catch (e) {
        if (e instanceof AbortedError) throw e;
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      if (state.login) throw new AdapterError("SESSION_EXPIRED", "Phiên Muse hết trong lúc chờ video kéo dài", afterSend);
      // Right after a (re)load the list is empty or partial for a few seconds — not evidence of anything.
      if (!museHistoryShown(state)) {
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      const a = attributeMuseExtend(checkpoint, state);
      if (a.kind === "ambiguous") {
        ambiguousReads++;
        if (ambiguousReads >= TIMEOUTS.ambiguousPolls) throw new AdapterError("AMBIGUOUS_SUBMIT", a.reason, afterSend);
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      ambiguousReads = 0;
      if (a.kind === "not_accepted") {
        // After a restart the message may still be rendering; past the acceptance window it is unknown → review.
        if (this.now() - t0 > TIMEOUTS.accept + TIMEOUTS.deliveryJudge) throw new AdapterError("AMBIGUOUS_SUBMIT", "Không thấy lời nhắn kéo dài trên Muse", afterSend);
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      if (checkpoint.acceptedUser !== a.acceptedUser) {
        checkpoint.acceptedUser = a.acceptedUser;
        hooks.onCheckpoint(checkpoint);
      }
      if (a.kind === "video") {
        const key = `${a.answerId}|${a.media.output}|${a.media.src}`;
        stable = key === lastKey ? stable + 1 : 1;
        lastKey = key;
        const settled = state.stop ? stable >= TIMEOUTS.stablePolls + TIMEOUTS.stopGracePolls : stable >= TIMEOUTS.stablePolls;
        if (settled) {
          return {
            media: [{ src: a.media.src, kind: "video", width: a.media.width, height: a.media.height, museSource: { conversation: checkpoint.conversation, turn: a.answerId, output: a.media.output } }],
            replyText: a.answerText,
          };
        }
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      stable = 0;
      lastKey = "";
      if (state.stop || !a.answered) {
        quietSince = 0;
        lastText = "";
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      if (a.answerText !== lastText || !quietSince) {
        lastText = a.answerText;
        quietSince = this.now();
        await this.wait(TIMEOUTS.pollMs, hooks.signal);
        continue;
      }
      if (TEXT.quota.test(a.answerText)) throw new AdapterError("QUOTA_LIMIT", "Muse báo hết hạn mức", afterSend);
      const quietFor = this.now() - quietSince;
      if (quietFor >= TIMEOUTS.refusalGrace.video) {
        const c = classifyMuseReply(a.answerText);
        if (c === "provider_error" || c === "refused") throw replyError(a.answerText);
        if (!reloaded) {
          // A file finished on a hidden page may only show after a fresh load (same as generate).
          reloaded = true;
          this.d.log?.("muse extend result not seen after reply, re-opening thread", { quietMs: quietFor });
          await this.reopenThread(checkpoint.conversation, hooks.signal);
          quietSince = 0;
          lastText = "";
          continue;
        }
        if (c !== "media_pending") throw new AdapterError("AMBIGUOUS_SUBMIT", `Muse trả lời nhưng không có video kéo dài: “${a.answerText.slice(0, 160)}”`, afterSend);
      }
      await this.wait(TIMEOUTS.pollMs, hooks.signal);
    }
    throw new AdapterError("AMBIGUOUS_SUBMIT", "Quá thời gian chờ Muse trả video kéo dài", afterSend);
  }

  async download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array> {
    const code = js(
      `async (u, t) => { const c = new AbortController(); const tm = setTimeout(() => c.abort(), t);
         try { const r = await fetch(u, { signal: c.signal }); if (!r.ok) return { ok: false, err: "HTTP " + r.status };
           const b = await r.blob(); const a = new Uint8Array(await b.arrayBuffer());
           let s = ""; for (let i = 0; i < a.length; i += 65536) s += String.fromCharCode.apply(null, a.subarray(i, i + 65536));
           return { ok: true, mime: b.type || "", size: b.size, b64: btoa(s) }; }
         catch (e) { return { ok: false, err: String(e) }; } finally { clearTimeout(tm); } }`,
      media.src,
      TIMEOUTS.download,
    );
    let lastErr = "";
    for (let i = 0; i < TIMEOUTS.downloadTries; i++) {
      throwIfAborted(signal);
      if (i) await this.wait(2000, signal);
      try {
        const r = await this.page.eval<{ ok: boolean; err?: string; size?: number; b64?: string }>(code, TIMEOUTS.download + 5000);
        if (r.ok && r.b64 && (r.size ?? 0) > 0) return Uint8Array.from(Buffer.from(r.b64, "base64"));
        lastErr = r.err || "tệp rỗng";
      } catch (e) {
        if (e instanceof AbortedError) throw e;
        lastErr = (e as Error).message ?? String(e);
      }
    }
    throw new AdapterError("DOWNLOAD_FAILED", `Tải tệp từ Muse lỗi: ${lastErr.slice(0, 80)}`);
  }

  async findByPrompt(spec: SubmitSpec, _since: number): Promise<string | null> {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const message = norm(buildMessage(spec.kind, spec.mode, spec.prompt, spec.referenceMedia));
    try {
      await this.load(MUSE.home);
      await this.wait(1500);
      await this.page.click(SEL.chatSwitcher).catch(() => false);
      await this.wait(1200);
      const links = await this.page.eval<string[]>(js(`(sel) => Array.from(new Set(Array.from(document.querySelectorAll(sel.threadLink)).map((a) => a.getAttribute("href")))).slice(0, 5)`, SEL));
      for (const href of links) {
        if (!THREAD_PATH_RE.test(href)) continue;
        await this.load(MUSE.origin + href);
        await this.wait(2000);
        // A user message must equal the sent text exactly (R12) — not merely contain it.
        const found = await this.page.eval<boolean>(
          js(`(sel, text) => Array.from(document.querySelectorAll(sel.userBubble)).some((e) => (e.innerText || "").replace(/\\s+/g, " ").trim() === text)`, SEL, message),
        );
        if (found) return href;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async clickPoint(fn: string, error: string): Promise<void> {
    const until = this.now() + TIMEOUTS.quotaClick;
    for (;;) {
      const pt = await this.page.eval<{ x: number; y: number } | null>(js(fn, SEL, TEXT.settingsLabels));
      if (pt) return this.page.clickAt(pt.x, pt.y);
      if (this.now() >= until) throw new AdapterError("UI_CHANGED", error);
      await this.wait(150);
    }
  }

  private async dismissMenus(): Promise<void> {
    for (let i = 0; i < 2; i++) {
      await this.page.pressEscape().catch(() => undefined);
      await this.wait(100);
    }
  }

  async readQuota(): Promise<Quota> {
    await this.ensureOrigin();
    await this.dismissMenus();
    const open = async () => {
      await this.clickPoint(QUOTA_SETTINGS_POINT_FN, "Không mở được Cài đặt của Muse");
      await this.clickPoint(QUOTA_MENU_POINT_FN, "Không thấy mục Settings của Muse");
    };
    try {
      try {
        await open();
      } catch (e) {
        // VPS beta.36: about 1 read in 10 opened the menu without its Settings item (click landed while the dock was
        // still settling). Close and open once more before calling the read failed (R69 keeps the old numbers anyway).
        if (!(e instanceof AdapterError) || e.cls !== "UI_CHANGED") throw e;
        await this.dismissMenus();
        await open();
      }
      const until = this.now() + TIMEOUTS.quotaRead;
      for (;;) {
        const q = parseQuota(await this.page.eval<string>(js(QUOTA_DIALOG_TEXT_FN, SEL)), this.now());
        if (q.usedPercent !== undefined) {
          // The additional-tokens part can render a moment after the weekly part: read once more so a panel that is
          // still filling in is never taken as “no additional tokens” (R69/R73).
          await this.wait(TIMEOUTS.quotaSettle);
          const again = parseQuota(await this.page.eval<string>(js(QUOTA_DIALOG_TEXT_FN, SEL)).catch(() => ""), this.now());
          if (again.usedPercent === undefined) return q;
          return again.additional === null && q.additional ? q : again;
        }
        // A plan label alone is not a successful read — the previous value stays (muse2api).
        if (this.now() >= until) throw new AdapterError("UI_CHANGED", "Không đọc được hạn mức trong Cài đặt của Muse");
        await this.wait(200);
      }
    } finally {
      await this.dismissMenus();
    }
  }

  exitIp(): Promise<{ ip: string; country: string | null }> {
    return this.d.exitIp();
  }

  dispose(): void {
    this.baselines.clear();
    this.baseAgentCount.clear();
  }
}

/**
 * Usage panel → quota (port of muse2api `_parse_quota`, spec rev 8 R69): Usage…Language section, EN/ZH, 0–100 only.
 * Two separate parts: weekly (plan, % used, reset label → earliest local time) and additional tokens (as shown: % used,
 * “5B tokens left”, “Never expires”); no additional part in the panel → `additional: null`. Missing values stay empty.
 */
export function parseQuota(text: string, now: number): Quota {
  let lines = (typeof text === "string" ? text : "").normalize("NFKC").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => (TEXT.usageHeaders as readonly string[]).includes(l.toLowerCase()));
  if (start >= 0) lines = lines.slice(start + 1);
  const end = lines.findIndex((l) => (TEXT.languageHeaders as readonly string[]).includes(l.toLowerCase()));
  if (end >= 0) lines = lines.slice(0, end);
  // Single-line layouts ("Free plan · Weekly limit resets on Nov 2 · 5% used") → split on separators.
  const parts = lines.flatMap((l) => l.split(/\s*[·•|]\s*/)).filter(Boolean);
  const plan = parts.find((l) => TEXT.quotaPlan.test(l));
  const extraAt = parts.findIndex((l) => TEXT.quotaExtra.test(l));
  const weekly = extraAt >= 0 ? parts.slice(0, extraAt) : parts;
  const weeklyText = weekly.join("\n");
  const resetsOn = (TEXT.quotaReset.exec(weeklyText) ?? TEXT.quotaResetZh.exec(weeklyText))?.[1]?.trim();
  const percentIn = (ls: string[]): number | undefined => {
    for (const l of ls) {
      const m = TEXT.quotaPercent.exec(l) ?? TEXT.quotaPercentZh.exec(l);
      if (!m) continue;
      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
    }
    return undefined;
  };
  const usedPercent = percentIn(weekly);
  const q: Quota = { plan, resetsOn, usedPercent, readAt: now };
  if (resetsOn) q.resetAt = resetLabelToTime(resetsOn, now);
  if (usedPercent === undefined) return q; // not a successful read: the caller keeps the previous snapshot
  if (extraAt < 0) {
    q.additional = null;
    return q;
  }
  const rest = parts.slice(extraAt + 1);
  const stop = rest.findIndex((l) => TEXT.quotaStop.test(l));
  const extra = [parts[extraAt], ...(stop >= 0 ? rest.slice(0, stop) : rest)];
  const extraText = extra.join("\n");
  const remainingLabel = TEXT.quotaTokensLeft.exec(extraText)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  q.additional = {
    usedPercent: percentIn(extra) ?? null,
    remainingLabel,
    remainingApprox: parseTokenAmount(remainingLabel),
    expiryLabel: TEXT.quotaExpiry.exec(extraText)?.[1]?.trim() ?? null,
  };
  return q;
}
