import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { AckResult, ConnectResult, FileNextResult, FileStartResult, FsResult, HistoryResult, PollResult, ProbeResult, SessionsResult, StateResult, StreamResult, type SendItem } from "../../../shared/gateway/bridge";
import { FS_REQUEST_TIMEOUT_MS, uploadTarget, uploadToWorkspace, type FsOp } from "../../../shared/gateway/upload";
import { stripAttachmentMarkers, type GwHistory, type GwSessionState } from "../../../shared/gateway/events";
import { HTTP_PAGE_UNLOAD_MS, type HttpReason } from "../../../shared/execution";
import { GW_CONNECT_TIMEOUT_MS, GW_FETCH_PARALLEL, GW_FETCH_TIMEOUT_MS, GW_FILE_HEAD_TIMEOUT_MS, GW_FILE_PIECE_WAIT_MS, GW_HISTORY_LIMIT, GW_JSON_TIMEOUT_MS, GW_SESSION_LIST_LIMIT, GW_NODE_ID, GW_PROXY_CHECK_URL, isDirect, classifyGatewaySignal, type GatewaySignal } from "./httpProtocol";

// Build 2.0 R94–R96 — main-process side of one account's direct channel. The client itself runs inside the account's
// hidden light page (src/page/gatewayPage.ts); this class only calls its pull API and checks every reply against the
// bridge schema. A reply that fails the schema is a protocol mismatch (R89(c)).

export class ChannelError extends Error {
  constructor(
    message: string,
    /** HttpReason for technical failures; `proxy` = DIRECT/unusable proxy (R96, not an HTTP failure); a Muse signal (R90). */
    readonly reason: HttpReason | "proxy" | GatewaySignal,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface HttpChannel {
  /** Connects (page, proxy check, token, handshake) if not open. */
  connect(signal?: AbortSignal): Promise<void>;
  /** The last successful connect had to wake the suspended Muse machine first (diagnostics only). */
  readonly lastWoke?: boolean;
  /** Last known socket state (refreshed by poll/connect/checkOpen and after any failed call). */
  isOpen(): boolean;
  /**
   * Asks the page whether the socket is really open and refreshes isOpen(). Muse can drop an idle socket (code 1006)
   * while nothing polls it (live 01/11: a probe-opened socket died and the next send hung in reconcile), so a job
   * checks this before it sends.
   */
  checkOpen(): Promise<boolean>;
  send(sessionId: string, items: SendItem[]): Promise<number>;
  ack(stream: number): Promise<AckResult>;
  subscribe(sessionId: string): Promise<void>;
  poll(): Promise<PollResult>;
  history(sessionId: string): Promise<GwHistory>;
  /** R94 — the conversation's state in Muse's conversation list; null when it is not among the newest. */
  sessionState(sessionId: string): Promise<GwSessionState | null>;
  fetchFile(path: string, maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; contentType: string | null }>;
  /** Uploads a file into the account workspace (upload.ts) and returns its path for a `file_ref` item. Throws UploadError. */
  uploadFile(data: Uint8Array, filename: string, signal: AbortSignal): Promise<string>;
  /** R92 — read-only check: token + handshake + one-row session list. Never sends a prompt. */
  probe(): Promise<{ ok: boolean; reason: ChannelError["reason"] | null; message: string }>;
  /**
   * Closes the connection. R94: the light page stays loaded until 5 min without use (the next job reconnects fast);
   * `unloadPage` drops it at once (account removed, paused for an anomaly).
   */
  close(opts?: { unloadPage?: boolean }): void;
  /** Working set of the channel page (diagnostics), when known. */
  memoryBytes?(): number | null;
}

/** What the channel needs from the account's hidden page (AccountManager.channelPage). */
export interface ChannelPage {
  eval<T>(code: string, timeoutMs?: number): Promise<T>;
  resolveProxy(url: string): Promise<string>;
  memoryBytes(): number | null;
  destroy(): void;
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ChannelError(`Kênh trực tiếp trả dữ liệu lạ (${what})`, "protocol_mismatch");
  return r.data;
}

const js = (v: unknown) => JSON.stringify(v);

export class ElectronHttpChannel implements HttpChannel {
  private page: ChannelPage | null = null;
  private open = false;
  private authFails = 0;
  private unloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private deps: {
      /** Opens (or returns) the account's hidden light page, after its proxy is in force. */
      openPage: () => Promise<ChannelPage>;
      /** Page bundle source (dist/main/gateway-page.js). */
      script: () => string;
      /** R94 — a closed channel keeps its page this long (default 5 min), then unloads it. */
      unloadAfterMs?: number;
    },
  ) {}

  isOpen(): boolean {
    return this.open;
  }

  private cancelUnload(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
  }

  /** Whether the light page is loaded (diagnostics/tests). */
  hasPage(): boolean {
    return !!this.page;
  }

  private async ensurePage(): Promise<ChannelPage> {
    this.cancelUnload();
    if (!this.page) this.page = await this.deps.openPage();
    const p = this.page;
    let installed = false;
    try {
      installed = await p.eval<boolean>("typeof window.__msg === 'object' && window.__msg !== null", 5_000);
    } catch {
      this.page = null;
      this.open = false;
      throw new ChannelError("Trang kênh trực tiếp không phản hồi", "connect_failed");
    }
    if (!installed) {
      this.open = false;
      await p.eval(this.deps.script(), 10_000);
    }
    return p;
  }

  private async call<S extends z.ZodTypeAny>(schema: S, expr: string, what: string, timeoutMs = GW_JSON_TIMEOUT_MS + 5_000): Promise<z.infer<S>> {
    const p = await this.ensurePage();
    let raw: unknown;
    try {
      raw = await p.eval(`window.__msg.${expr}`, timeoutMs);
    } catch (e) {
      // The failure may be a socket Muse closed; learn the real state so the next ensureConnected reconnects.
      await this.checkOpen();
      throw new ChannelError(`Kênh trực tiếp lỗi (${what}): ${String((e as Error).message ?? e).slice(0, 120)}`, "stream_lost");
    }
    return parse(schema, raw, what);
  }

  async checkOpen(): Promise<boolean> {
    const p = this.page;
    if (!p || !this.open) return (this.open = this.open && !!p);
    try {
      this.open = parse(StateResult, await p.eval("window.__msg.state()", 5_000), "state").open;
    } catch {
      this.open = false; // page unresponsive or reloaded without the bundle: connect() reinstalls it
    }
    return this.open;
  }

  /** True when the last successful connect had to wake the account's suspended Muse machine first. */
  lastWoke = false;

  async connect(): Promise<void> {
    const p = await this.ensurePage();
    if (this.open) {
      const st = parse(StateResult, await p.eval("window.__msg.state()", 5_000), "state");
      if (st.open) return;
      this.open = false;
    }
    const resolved = await p.resolveProxy(GW_PROXY_CHECK_URL).catch(() => "DIRECT");
    if (isDirect(resolved)) throw new ChannelError("Proxy của tài khoản không dùng được cho kênh trực tiếp", "proxy");
    // Up to: wake wait + socket + handshake, twice when the first socket fails (client.ts connect()).
    const r = await this.call(ConnectResult, "connect()", "connect", GW_CONNECT_TIMEOUT_MS);
    if (r.ok) {
      this.open = true;
      this.authFails = 0;
      this.lastWoke = r.woke === true;
      return;
    }
    const signal = classifyGatewaySignal(r.status, r.step, r.message);
    if (signal === "needs_login") {
      // R90: 401/403 twice in a row → needs_login; once is a technical failure.
      this.authFails++;
      if (this.authFails >= 2) throw new ChannelError(r.message, "needs_login", r.status);
    } else if (signal) throw new ChannelError(r.message, signal, r.status);
    throw new ChannelError(r.message, r.reason, r.status);
  }

  async send(sessionId: string, items: SendItem[]): Promise<number> {
    return (await this.call(StreamResult, `send(${js(sessionId)}, ${js(items)}, ${js(GW_NODE_ID)})`, "send", 60_000)).stream;
  }

  async ack(stream: number): Promise<AckResult> {
    return this.call(AckResult, `ack(${js(stream)})`, "ack", 10_000);
  }

  async subscribe(sessionId: string): Promise<void> {
    await this.call(StreamResult, `subscribe(${js(sessionId)})`, "subscribe", 15_000);
  }

  async poll(): Promise<PollResult> {
    const r = await this.call(PollResult, "poll()", "poll", 10_000);
    this.open = r.open;
    return r;
  }

  async history(sessionId: string): Promise<GwHistory> {
    const r = await this.call(HistoryResult, `history(${js(sessionId)}, ${GW_HISTORY_LIMIT})`, "history", GW_JSON_TIMEOUT_MS + 10_000);
    if (r.status === null) throw new ChannelError("Đọc lịch sử hội thoại quá thời gian", "stream_lost");
    if (r.status === 404) return { turns: [], userMsgs: 0, unknownShape: false };
    if (r.status !== 200) {
      const signal = classifyGatewaySignal(r.status, null, r.reset?.reason ?? null);
      throw new ChannelError(`Đọc lịch sử lỗi HTTP ${r.status}`, signal ?? "stream_lost", r.status);
    }
    if (!r.history) throw new ChannelError("Lịch sử hội thoại có dạng lạ", "protocol_mismatch");
    // The page sends Muse's text as stored; main derives the prompt part itself from the validated text.
    return { ...r.history, turns: r.history.turns.map((t) => ({ ...t, user: { ...t.user, prompt: stripAttachmentMarkers(t.user.text) } })) };
  }

  async sessionState(sessionId: string): Promise<GwSessionState | null> {
    const r = await this.call(SessionsResult, `sessions(${GW_SESSION_LIST_LIMIT})`, "sessions", GW_JSON_TIMEOUT_MS + 10_000);
    if (r.status === null) throw new ChannelError("Đọc danh sách hội thoại quá thời gian", "stream_lost");
    if (r.status !== 200) {
      const signal = classifyGatewaySignal(r.status, null, r.reset?.reason ?? null);
      throw new ChannelError(`Đọc danh sách hội thoại lỗi HTTP ${r.status}`, signal ?? "stream_lost", r.status);
    }
    if (!r.sessions) throw new ChannelError("Danh sách hội thoại có dạng lạ", "protocol_mismatch");
    const hit = r.sessions.find((x) => x.id === sessionId);
    return hit ? { status: hit.status, updatedAtMs: hit.updatedAtMs } : null;
  }

  private fetchSlots = GW_FETCH_PARALLEL;
  private fetchWaiters: (() => void)[] = [];

  async fetchFile(path: string, maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; contentType: string | null }> {
    while (this.fetchSlots <= 0) await new Promise<void>((res) => this.fetchWaiters.push(res));
    this.fetchSlots--;
    try {
      if (signal.aborted) throw new ChannelError("Đã huỷ", "fetch_failed");
      return await this.fetchOne(path, maxBytes, signal);
    } finally {
      this.fetchSlots++;
      this.fetchWaiters.shift()?.();
    }
  }

  private async fetchOne(path: string, maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; contentType: string | null }> {
    // Streamed (R95): the page hands over what arrived since the last pull, so it never holds a whole video.
    const start = await this.call(FileStartResult, `fileStart(${js(path)}, ${maxBytes}, ${GW_FILE_HEAD_TIMEOUT_MS})`, "fileStart", GW_FILE_HEAD_TIMEOUT_MS + 15_000);
    if (!start.fid) throw new ChannelError(`Không tải được tệp (HTTP ${start.status ?? "hết giờ"})`, "fetch_failed", start.status);
    if (start.length !== null && start.length > maxBytes) {
      await this.page?.eval(`window.__msg && window.__msg.fileDone(${js(start.fid)})`, 5_000).catch(() => undefined);
      throw new ChannelError(`Tệp quá lớn (${start.length} byte)`, "fetch_failed");
    }
    const parts: Buffer[] = [];
    let total = 0;
    const deadline = Date.now() + GW_FETCH_TIMEOUT_MS;
    try {
      for (;;) {
        if (signal.aborted) throw new ChannelError("Đã huỷ", "fetch_failed");
        if (Date.now() > deadline) throw new ChannelError(`Tải tệp quá ${Math.round(GW_FETCH_TIMEOUT_MS / 60_000)} phút`, "fetch_failed");
        const r = await this.call(FileNextResult, `fileNext(${js(start.fid)}, ${GW_FILE_PIECE_WAIT_MS})`, "fileNext", GW_FILE_PIECE_WAIT_MS + 15_000);
        if (r.b64) {
          const b = Buffer.from(r.b64, "base64");
          total += b.length;
          if (total > maxBytes) throw new ChannelError(`Tệp quá lớn (> ${maxBytes} byte)`, "fetch_failed");
          parts.push(b);
        }
        if (r.reset) throw new ChannelError(`Không tải được tệp (${r.reset.reason})`, "fetch_failed");
        if (r.done) break;
      }
    } finally {
      await this.page?.eval(`window.__msg && window.__msg.fileDone(${js(start.fid)})`, 5_000).catch(() => undefined);
    }
    if (!total) throw new ChannelError("Tệp rỗng", "fetch_failed");
    if (start.length !== null && total !== start.length) throw new ChannelError(`Tệp thiếu byte (${total}/${start.length})`, "fetch_failed");
    return { data: new Uint8Array(Buffer.concat(parts, total)), contentType: start.contentType };
  }

  private uploadSeq = 0;

  async uploadFile(data: Uint8Array, filename: string, signal: AbortSignal): Promise<string> {
    const target = uploadTarget(filename, this.uploadSeq++, randomUUID().slice(0, 4), randomUUID());
    const fs = (op: FsOp, body: Record<string, unknown>) => this.call(FsResult, `fs(${js(op)}, ${js(body)})`, `fs.${op}`, FS_REQUEST_TIMEOUT_MS + 15_000);
    return uploadToWorkspace({ fs, toBase64: (b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64"), signal }, data, target);
  }

  async probe(): Promise<{ ok: boolean; reason: ChannelError["reason"] | null; message: string }> {
    try {
      const p = await this.ensurePage();
      const resolved = await p.resolveProxy(GW_PROXY_CHECK_URL).catch(() => "DIRECT");
      if (isDirect(resolved)) return { ok: false, reason: "proxy", message: "Proxy của tài khoản không dùng được cho kênh trực tiếp" };
      const r = await this.call(ProbeResult, "probe()", "probe", GW_CONNECT_TIMEOUT_MS + GW_JSON_TIMEOUT_MS + 5_000);
      this.open = r.ok;
      if (r.ok) return { ok: true, reason: null, message: "" };
      const signal = classifyGatewaySignal(r.status, r.step, r.message);
      return { ok: false, reason: signal ?? "connect_failed", message: r.message };
    } catch (e) {
      if (e instanceof ChannelError) return { ok: false, reason: e.reason, message: e.message };
      return { ok: false, reason: "connect_failed", message: String(e).slice(0, 200) };
    }
  }

  close(opts: { unloadPage?: boolean } = {}): void {
    this.open = false;
    this.cancelUnload();
    const p = this.page;
    if (!p) return;
    const closed = p.eval("window.__msg && window.__msg.close()", 3_000).catch(() => undefined);
    const unload = () => {
      if (this.page !== p || this.open) return; // reused meanwhile
      this.page = null;
      void closed.finally(() => p.destroy());
    };
    if (opts.unloadPage) return unload();
    this.unloadTimer = setTimeout(() => {
      this.unloadTimer = null;
      unload();
    }, this.deps.unloadAfterMs ?? HTTP_PAGE_UNLOAD_MS);
    (this.unloadTimer as { unref?: () => void }).unref?.();
  }

  memoryBytes(): number | null {
    return this.page?.memoryBytes() ?? null;
  }
}
