import { HandshakeError, initiatorHandshake, type Transport } from "./noise";
import { bytes, concat, decodeFields, fieldBytes, fieldString, fieldVarint, num, ProtoError, str, utf8Decoder, utf8Encoder } from "./proto";

// Muse “hatch” gateway client (Build 2.0 R93–R95). Pure TypeScript: the page bundle runs it inside the account's own
// hidden page (cookies, proxy and proxy login stay in Chromium); tests run it in Node against a fake responder.
// Tokens never leave this object: nothing here returns or logs them.

export const APP_ID = "hatch-web";
export const GATEWAY_URL = "wss://hatch.metaaivm.com/v1/noise";
/** Largest plaintext per transport frame (AES-GCM tag + framing fit the gateway's 64 KiB limit). */
export const MAX_FRAME_PAYLOAD = 65_489;
export const CHAT_CAPABILITIES = ["chat_cancel", "delta_stream", "custom_reactions", "custom_reactions_facebook_thumbs_up_v1"];
/** Event buffer cap (the main process drains it every poll). */
export const EVENT_BUFFER_MAX = 20_000;

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onmessage: ((ev: { data: ArrayBuffer | Uint8Array }) => void) | null;
}

export interface GatewayEnv {
  fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  openSocket: (url: string) => SocketLike;
  randomUUID: () => string;
  randomBytes: (n: number) => Uint8Array;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

export type ConnectFailure = "session" | "wake" | "token" | "socket" | "handshake" | "challenge";
/** Longest wait for a suspended Muse machine to report RUNNING after a wake request. */
export const VM_WAKE_WAIT_MS = 90_000;
/** A missing state is treated as running (older responses); any other non-running state is woken first. */
export function vmRunning(state: unknown): boolean {
  return typeof state !== "string" || state === "" || /^(running|live|ready)$/i.test(state);
}
export class GatewayError extends Error {
  constructor(
    message: string,
    /** connect_failed | stream_lost | protocol_mismatch | fetch_failed — maps to HttpReason (R89). */
    readonly reason: "connect_failed" | "stream_lost" | "protocol_mismatch" | "fetch_failed",
    readonly detail: { step?: ConnectFailure; status?: number } = {},
  ) {
    super(message);
  }
}

interface Stream {
  id: number;
  kind: "plain" | "ndjson";
  status: number | null;
  headers: [string, string][];
  body: Uint8Array[];
  bytes: number;
  done: boolean;
  reset: { code: number; reason: string } | null;
  buf: string;
  last: Record<string, unknown> | null;
  t0: number;
  tEnd: number | null;
  /** Bytes allowed before the stream is cut (file downloads). */
  limit: number;
  waiters: (() => void)[];
}

/** One NDJSON record from a subscribe/stream response, with the stream it came from. */
export interface RawEvent {
  stream: number;
  at: number;
  rec: Record<string, unknown>;
  final?: boolean;
}

export class GatewayClient {
  private ws: SocketLike | null = null;
  private tx: Transport | null = null;
  private nextStream = 1;
  private streams = new Map<number, Stream>();
  private assembling = new Map<string, { parts: Map<number, Uint8Array>; total: number }>();
  private recvChain: Promise<void> = Promise.resolve();
  private sendChain: Promise<void> = Promise.resolve();
  private events: RawEvent[] = [];
  /** Index of the first event in `events` (monotonic cursor for pollers). */
  private base = 0;
  private dropped = 0;
  openedAt: number | null = null;
  closed: { at: number; code: number | null } | null = null;
  errors: string[] = [];
  private handshakeWaiter: ((m: Uint8Array) => void) | null = null;

  constructor(private env: GatewayEnv) {}

  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === 1 && !!this.tx;
  }

  /**
   * Session info → (wake a sleeping machine) → token → notary token → WebSocket → Noise XX. A socket that will not open
   * is retried once after a wake request. Throws GatewayError(connect_failed).
   */
  async connect(): Promise<{ vmState: string | null; woke: boolean }> {
    try {
      return await this.connectOnce(false);
    } catch (err) {
      if (!(err instanceof GatewayError) || err.detail.step !== "socket") throw err;
      return this.connectOnce(true);
    }
  }

  private async readSession(): Promise<{ info: Record<string, unknown>; status: number }> {
    const r = await this.env.fetch("/api/session?vm_state=live", { headers: { "x-app-id": APP_ID } }).catch(() => null);
    const info = (r?.ok ? ((await r.json().catch(() => ({}))) ?? {}) : {}) as Record<string, unknown>;
    return { info, status: r?.status ?? 0 };
  }

  /**
   * Muse suspends an idle account's machine; its own web app then sends POST /api/hatch/vm/wake {vm_id, retry_count}
   * and connects once the session reports RUNNING. Same here: wake, re-ask every 2 s, repeat the wake every 10 s,
   * give up after VM_WAKE_WAIT_MS.
   */
  private async wake(vmId: string): Promise<Record<string, unknown>> {
    const t0 = this.env.now();
    let retry = 0;
    let lastWake = -Infinity;
    let info: Record<string, unknown> = {};
    while (this.env.now() - t0 < VM_WAKE_WAIT_MS) {
      if (this.env.now() - lastWake >= 10_000) {
        lastWake = this.env.now();
        await this.env.fetch("/api/hatch/vm/wake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vm_id: vmId, retry_count: retry++ }) }).catch(() => null);
      }
      await new Promise<void>((res) => this.env.setTimeout(res, 2_000));
      info = (await this.readSession()).info;
      if (vmRunning(info.vm_state)) return info;
    }
    throw new GatewayError("Máy chạy Muse của tài khoản chưa thức dậy", "connect_failed", { step: "wake" });
  }

  private async connectOnce(forceWake: boolean): Promise<{ vmState: string | null; woke: boolean }> {
    this.close();
    const H = { "content-type": "application/json", "x-app-id": APP_ID };
    const s = await this.readSession();
    let info = s.info;
    const endpoint = String(info.endpoint_url ?? info.endpointUrl ?? "");
    if (!endpoint) throw new GatewayError("Muse chưa cấp máy chạy cho phiên này", "connect_failed", { step: "session", status: s.status });
    let vm = String(info.vm_id ?? info.vmId ?? "");
    let host = "";
    try {
      host = new URL(endpoint).hostname;
    } catch {
      throw new GatewayError("Địa chỉ máy chạy Muse không hợp lệ", "protocol_mismatch", { step: "session" });
    }
    if (!vm && host.endsWith(".metaaivm.com")) vm = host.split(".")[0];
    let woke = false;
    if (forceWake || !vmRunning(info.vm_state)) {
      if (!vm) throw new GatewayError("Muse chưa cấp máy chạy cho phiên này", "connect_failed", { step: "session", status: s.status });
      info = { ...info, ...(await this.wake(vm)) };
      woke = true;
    }
    const tr = await this.env.fetch("/api/hatch/token", { method: "POST", headers: H, body: JSON.stringify({ vmAddress: endpoint, vmName: vm }) }).catch(() => null);
    const tok = (tr?.ok ? await tr.json().catch(() => ({})) : {}) as Record<string, unknown>;
    if (typeof tok.token !== "string" || !tok.token) throw new GatewayError("Không lấy được mã kết nối của Muse", "connect_failed", { step: "token", status: tr?.status ?? 0 });
    let notary = typeof tok.notary_token === "string" ? tok.notary_token : "";
    try {
      const nr = await this.env.fetch("/api/hatch/noise-notary-token", { method: "POST", headers: H, body: JSON.stringify({ vmName: vm }) });
      if (nr.ok) {
        const nt = (await nr.json()) as Record<string, unknown>;
        if (typeof nt.notaryToken === "string" && nt.notaryToken) notary = nt.notaryToken.trim();
      }
    } catch {
      /* optional */
    }
    const q = new URLSearchParams({ vm_id: vm, auth_token: tok.token });
    if (notary) q.set("notary_token", notary);
    q.set("app_id", APP_ID);
    q.set("request_id", this.env.randomUUID());
    const ws = this.env.openSocket(`${GATEWAY_URL}?${q.toString()}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    await new Promise<void>((res, rej) => {
      const t = this.env.setTimeout(() => rej(new GatewayError("Hết thời gian mở kết nối", "connect_failed", { step: "socket" })), 30_000);
      ws.onopen = () => {
        this.env.clearTimeout(t);
        res();
      };
      ws.onerror = () => {
        this.env.clearTimeout(t);
        rej(new GatewayError("Không mở được kết nối tới Muse", "connect_failed", { step: "socket" }));
      };
    });
    ws.onclose = (e) => {
      this.closed = { at: this.env.now(), code: e?.code ?? null };
      this.failAll("stream closed");
    };
    ws.onmessage = (ev) => {
      const raw = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
      if (this.handshakeWaiter) {
        const w = this.handshakeWaiter;
        this.handshakeWaiter = null;
        w(raw);
        return;
      }
      this.recvChain = this.recvChain.then(() => this.onTransport(raw)).catch((err) => this.noteError(err));
    };
    try {
      this.tx = await initiatorHandshake({
        payload1: fieldBytes(1, this.env.randomBytes(32)),
        exchange: (m1) =>
          new Promise<Uint8Array>((res, rej) => {
            const t = this.env.setTimeout(() => rej(new HandshakeError("handshake timeout", "message2")), 30_000);
            this.handshakeWaiter = (m) => {
              this.env.clearTimeout(t);
              res(m);
            };
            ws.send(m1);
          }),
        deliver: (m3) => ws.send(m3),
        isChallenge: (p2) => {
          try {
            const f = decodeFields(p2);
            const kind = num(f, 2, 0);
            const c = bytes(f, 3);
            return !!f[1] && (kind === 1 || kind === 2) && !!c && c.length === 32;
          } catch {
            return false;
          }
        },
      });
    } catch (err) {
      this.close();
      if (err instanceof HandshakeError && err.step === "challenge") throw new GatewayError("Muse yêu cầu xác minh thêm cho kết nối", "connect_failed", { step: "challenge" });
      throw new GatewayError("Bắt tay mã hoá với Muse thất bại", "connect_failed", { step: "handshake" });
    }
    this.openedAt = this.env.now();
    this.closed = null;
    return { vmState: typeof info.vm_state === "string" ? info.vm_state : null, woke };
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.tx = null;
    this.handshakeWaiter = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.failAll("closed");
  }

  private failAll(reason: string): void {
    for (const st of this.streams.values()) {
      if (!st.done) {
        st.done = true;
        st.reset = st.reset ?? { code: -1, reason };
        st.tEnd = this.env.now();
        for (const w of st.waiters.splice(0)) w();
      }
    }
  }

  private noteError(err: unknown): void {
    this.errors.push(String(err).slice(0, 200));
    if (this.errors.length > 20) this.errors.splice(0, this.errors.length - 20);
  }

  private async onTransport(raw: Uint8Array): Promise<void> {
    if (!this.tx) return;
    const pt = await this.tx.recv.decrypt(new Uint8Array(0), raw);
    const f = decodeFields(pt);
    const cid = String(num(f, 1, 0));
    const idx = num(f, 2, 0);
    const total = num(f, 3, 1) || 1;
    const payload = bytes(f, 4) ?? new Uint8Array(0);
    let whole = payload;
    if (total !== 1) {
      if (total > 100_000 || idx >= total) throw new ProtoError("bad chunk index");
      const a = this.assembling.get(cid) ?? { parts: new Map<number, Uint8Array>(), total };
      a.parts.set(idx, payload.slice());
      this.assembling.set(cid, a);
      if (a.parts.size < total) return;
      this.assembling.delete(cid);
      whole = concat(...Array.from({ length: total }, (_, i) => a.parts.get(i) ?? new Uint8Array(0)));
    }
    const sr = decodeFields(whole);
    const inner = bytes(sr, 1);
    if (!inner) throw new ProtoError("missing frame");
    const frame = decodeFields(inner);
    const sid = num(frame, 1, 0);
    const st = this.streams.get(sid);
    if (!st) return; // a stream we no longer track
    let data: Uint8Array | null = null;
    let end = false;
    const head = bytes(frame, 3);
    const body = bytes(frame, 4);
    const rst = bytes(frame, 5);
    if (head) {
      const r = decodeFields(head);
      st.status = num(r, 1, 0);
      st.headers = (r[2] ?? []).map((h) => {
        const hf = decodeFields(h as Uint8Array);
        return [str(hf, 1), str(hf, 2)] as [string, string];
      });
      data = bytes(r, 3);
      end = num(r, 4, 0) === 1;
    } else if (body) {
      const b = decodeFields(body);
      data = bytes(b, 1);
      end = num(b, 2, 0) === 1;
    } else if (rst) {
      const r = decodeFields(rst);
      st.reset = { code: num(r, 1, 0), reason: str(r, 2).slice(0, 200) };
      st.done = true;
      st.tEnd = this.env.now();
      for (const w of st.waiters.splice(0)) w();
      return;
    }
    if (data && data.length) {
      if (st.kind === "ndjson") {
        st.buf += utf8Decoder.decode(data, { stream: true });
        if (st.buf.length > 8 * 1024 * 1024) throw new ProtoError("event line too long");
        let i: number;
        while ((i = st.buf.indexOf("\n")) >= 0) {
          const line = st.buf.slice(0, i);
          st.buf = st.buf.slice(i + 1);
          if (line.trim()) this.pushEvent(st, line, false);
        }
      } else {
        st.bytes += data.length;
        if (st.bytes > st.limit) {
          st.reset = { code: -2, reason: "too large" };
          st.done = true;
        } else st.body.push(data); // a view into this frame's fresh plaintext: no second copy of every file byte
      }
    }
    if (end || st.done) {
      if (st.kind === "ndjson" && st.buf.trim()) this.pushEvent(st, st.buf, true);
      st.buf = "";
      st.done = true;
      st.tEnd = this.env.now();
      for (const w of st.waiters.splice(0)) w();
    }
    if (st.status !== null) for (const w of st.waiters.splice(0)) w();
  }

  private pushEvent(st: Stream, line: string, final: boolean): void {
    let rec: Record<string, unknown>;
    try {
      const v = JSON.parse(line);
      rec = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { raw: String(line).slice(0, 300) };
    } catch {
      rec = { raw: line.slice(0, 300) };
    }
    if (final) st.last = rec;
    this.events.push({ stream: st.id, at: this.env.now(), rec, ...(final ? { final: true } : {}) });
    if (this.events.length > EVENT_BUFFER_MAX) {
      const cut = this.events.length - EVENT_BUFFER_MAX;
      this.events.splice(0, cut);
      this.base += cut;
      this.dropped += cut;
    }
  }

  private enqueue(plain: Uint8Array): Promise<void> {
    this.sendChain = this.sendChain.then(async () => {
      if (!this.ws || !this.tx) throw new GatewayError("Kết nối đã đóng", "stream_lost");
      const hi = this.env.randomBytes(8);
      let cid = 0n;
      for (const b of hi) cid = (cid << 8n) | BigInt(b);
      cid &= (1n << 63n) - 1n;
      const total = Math.max(1, Math.ceil(plain.length / MAX_FRAME_PAYLOAD));
      for (let i = 0; i < total; i++) {
        const part = plain.subarray(i * MAX_FRAME_PAYLOAD, (i + 1) * MAX_FRAME_PAYLOAD);
        const fr = concat(fieldVarint(1, cid), fieldVarint(2, i), fieldVarint(3, total), fieldBytes(4, part));
        this.ws.send(await this.tx.send.encrypt(new Uint8Array(0), fr));
      }
    });
    const p = this.sendChain;
    this.sendChain = this.sendChain.catch(() => undefined);
    return p;
  }

  /** Opens one request stream (HTTP over the tunnel). Resolves once the request is handed to the socket. */
  async request(method: string, path: string, body: unknown, kind: "plain" | "ndjson" = "plain", limit = 64 * 1024 * 1024): Promise<number> {
    if (!this.isOpen()) throw new GatewayError("Kết nối đã đóng", "stream_lost");
    const id = this.nextStream++;
    const hdrs: [string, string][] = [["x-app-id", APP_ID], ["accept-encoding", "identity"]];
    const b = body == null ? new Uint8Array(0) : utf8Encoder.encode(JSON.stringify(body));
    if (b.length) hdrs.push(["content-type", "application/json"]);
    let app = concat(fieldString(1, method), fieldString(2, path));
    for (const [k, v] of hdrs) app = concat(app, fieldBytes(3, concat(fieldString(1, k), fieldString(2, v))));
    if (b.length) app = concat(app, fieldBytes(4, b));
    app = concat(app, fieldVarint(5, 1));
    this.streams.set(id, { id, kind, status: null, headers: [], body: [], bytes: 0, done: false, reset: null, buf: "", last: null, t0: this.env.now(), tEnd: null, limit, waiters: [] });
    await this.enqueue(concat(fieldVarint(1, 0), fieldBytes(2, concat(fieldVarint(1, id), fieldBytes(2, app)))));
    return id;
  }

  /** Waits until the stream ends (or has a status when `needDone` is false), at most `ms`. */
  wait(id: number, ms: number, needDone = true): Promise<Stream | null> {
    const st = this.streams.get(id);
    if (!st) return Promise.resolve(null);
    const ready = () => (needDone ? st.done : st.status !== null || st.done);
    if (ready()) return Promise.resolve(st);
    return new Promise((res) => {
      const t = this.env.setTimeout(() => res(st), ms);
      const check = () => {
        if (ready()) {
          this.env.clearTimeout(t);
          res(st);
        } else st.waiters.push(check);
      };
      st.waiters.push(check);
    });
  }

  forget(id: number): void {
    this.streams.delete(id);
  }

  streamInfo(id: number): { status: number | null; done: boolean; reset: { code: number; reason: string } | null; last: Record<string, unknown> | null; tEnd: number | null } | null {
    const st = this.streams.get(id);
    return st ? { status: st.status, done: st.done, reset: st.reset, last: st.last, tEnd: st.tEnd } : null;
  }

  async json(method: string, path: string, body: unknown, ms = 30_000): Promise<{ status: number | null; data: unknown; reset: { code: number; reason: string } | null }> {
    const id = await this.request(method, path, body);
    const st = await this.wait(id, ms, true);
    this.forget(id);
    if (!st || !st.done) return { status: null, data: null, reset: { code: -3, reason: "timeout" } };
    const txt = utf8Decoder.decode(concat(...st.body));
    let data: unknown = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = { raw: txt.slice(0, 300) };
    }
    return { status: st.status, data, reset: st.reset };
  }

  subscribe(sessionId: string, afterStreamSeq = 0): Promise<number> {
    return this.request("POST", "/chat/subscribe", { after_stream_seq: afterStreamSeq, after_chat_event_seq: 0, capabilities: CHAT_CAPABILITIES, session_id: sessionId }, "ndjson");
  }

  /** Sends one chat turn into `sessionId` (a new id creates the conversation). The returned stream ends with the ack. */
  sendChat(sessionId: string, items: unknown[], nodeId: string): Promise<number> {
    return this.request("POST", "/chat/stream", { items, node_id: nodeId, capabilities: CHAT_CAPABILITIES, session_id: sessionId, timezone: "UTC" }, "ndjson");
  }

  async fetchFile(path: string, ms: number, limit: number): Promise<{ status: number | null; contentType: string | null; data: Uint8Array; reset: { code: number; reason: string } | null }> {
    const r = await this.fetchFileParts(path, ms, limit);
    return { status: r.status, contentType: r.contentType, data: concat(...r.parts), reset: r.reset };
  }

  /** Starts a file download whose bytes are taken piece by piece (takeFile), so the page never holds the whole file. */
  startFile(path: string, limit: number): Promise<number> {
    return this.request("GET", `/fs/raw${path}`, null, "plain", limit);
  }

  /** The download's response head, waiting up to `ms` (status null = none in time). `length` = content-length if sent. */
  async fileHead(id: number, ms: number): Promise<{ status: number | null; contentType: string | null; length: number | null; reset: { code: number; reason: string } | null }> {
    const st = await this.wait(id, ms, false);
    if (!st || st.status === null) return { status: null, contentType: null, length: null, reset: st?.reset ?? { code: -3, reason: "timeout" } };
    const h = (k: string) => st.headers.find(([x]) => x.toLowerCase() === k)?.[1] ?? null;
    const len = Number(h("content-length"));
    return { status: st.status, contentType: h("content-type"), length: Number.isSafeInteger(len) && len >= 0 && h("content-length") !== null ? len : null, reset: st.reset };
  }

  /**
   * Takes up to `max` received bytes of a download, waiting up to `ms` for some. Taken bytes leave the client, so a
   * page's memory stays at what the network delivered since the last take. `done` once the end was received and taken.
   */
  async takeFile(id: number, max: number, ms: number): Promise<{ data: Uint8Array; done: boolean; reset: { code: number; reason: string } | null; timedOut: boolean }> {
    const st = this.streams.get(id);
    if (!st) return { data: new Uint8Array(0), done: true, reset: { code: -4, reason: "unknown stream" }, timedOut: false };
    if (!st.body.length && !st.done) {
      await new Promise<void>((res) => {
        const t = this.env.setTimeout(() => res(), ms);
        const check = () => {
          if (st.body.length || st.done) {
            this.env.clearTimeout(t);
            res();
          } else st.waiters.push(check);
        };
        st.waiters.push(check);
      });
    }
    const out: Uint8Array[] = [];
    let n = 0;
    while (st.body.length && n < max) {
      const head = st.body[0];
      const room = max - n;
      if (head.length <= room) {
        out.push(head);
        n += head.length;
        st.body.shift();
      } else {
        out.push(head.subarray(0, room));
        st.body[0] = head.subarray(room);
        n += room;
      }
    }
    const done = st.done && !st.body.length;
    return { data: out.length === 1 ? out[0] : concat(...out), done, reset: done ? st.reset : null, timedOut: !n && !st.done };
  }

  /** Same as fetchFile but keeps the received pieces as they are (no whole-file copy; the page serves slices). */
  async fetchFileParts(path: string, ms: number, limit: number): Promise<{ status: number | null; contentType: string | null; parts: Uint8Array[]; size: number; reset: { code: number; reason: string } | null }> {
    const id = await this.request("GET", `/fs/raw${path}`, null, "plain", limit);
    const st = await this.wait(id, ms, true);
    this.forget(id);
    if (!st) return { status: null, contentType: null, parts: [], size: 0, reset: { code: -3, reason: "timeout" } };
    const ctype = st.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? null;
    const parts = st.done ? st.body : [];
    return { status: st.status, contentType: ctype, parts, size: parts.reduce((n, p) => n + p.length, 0), reset: st.done ? st.reset : { code: -3, reason: "timeout" } };
  }

  /** Events from `cursor` on (cursor = index returned last time). */
  drain(cursor: number, max = 2_000): { events: RawEvent[]; next: number; dropped: number } {
    const from = Math.max(cursor, this.base);
    const slice = this.events.slice(from - this.base, from - this.base + max);
    return { events: slice, next: from + slice.length, dropped: Math.max(0, this.base - cursor) };
  }

  /** Releases buffered events below `cursor` (the main process has them). */
  trim(cursor: number): void {
    const n = Math.min(this.events.length, cursor - this.base);
    if (n > 0) {
      this.events.splice(0, n);
      this.base += n;
    }
  }
}
