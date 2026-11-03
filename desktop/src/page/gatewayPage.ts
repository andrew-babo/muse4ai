import { GatewayClient, GatewayError, type GatewayEnv } from "../shared/gateway/client";
import { normaliseAck, normaliseEvent, normaliseHistory, normaliseSessionList } from "../shared/gateway/events";
import { FS_REQUEST_TIMEOUT_MS, fsBodyAllowed, normaliseFsReply } from "../shared/gateway/upload";

// Channel page bundle (Build 2.0 R94–R96). Injected by the main process into the account's hidden light page
// (https://muse.ai/robots.txt, the account's own partition and proxy). Exposes a pull API on `window.__msg` whose
// results are plain JSON checked by the main process (src/shared/gateway/bridge.ts). Tokens, cookies and keys stay in
// this closure; no method returns them.

/** Piece size handed to main per call: small, so the page never holds a large base64 string (live 01/11 memory). */
const CHUNK = 1024 * 1024;
const ORIGIN = "https://muse.ai";

type W = typeof globalThis & { __msg?: unknown };
const w = globalThis as W;

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function failure(err: unknown) {
  if (err instanceof GatewayError) return { ok: false as const, reason: err.reason, step: err.detail.step ?? null, status: err.detail.status ?? null, message: err.message.slice(0, 300) };
  return { ok: false as const, reason: "protocol_mismatch" as const, step: null, status: null, message: String(err).slice(0, 300) };
}

if (!w.__msg) {
  const env: GatewayEnv = {
    fetch: (url, init) => fetch(url.startsWith("/") ? ORIGIN + url : url, { ...init, credentials: "include" }) as never,
    openSocket: (url) => new WebSocket(url) as never,
    randomUUID: () => crypto.randomUUID(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as number),
  };
  const c = new GatewayClient(env);
  const files = new Map<string, { id: number; at: number }>();
  let fileSeq = 0;
  let cursor = 0;

  w.__msg = {
    version: 1,
    state: () => ({ installed: true, open: c.isOpen(), openedAt: c.openedAt, closedCode: c.closed?.code ?? null, errors: c.errors.length }),
    connect: async () => {
      try {
        const r = await c.connect();
        cursor = 0;
        return { ok: true as const, vmState: r.vmState, woke: r.woke };
      } catch (err) {
        return failure(err);
      }
    },
    send: async (sessionId: string, items: unknown[], nodeId: string) => ({ stream: await c.sendChat(sessionId, items, nodeId) }),
    ack: (stream: number) => {
      const st = c.streamInfo(stream);
      if (!st) return { done: true, status: null, ack: null, reset: { code: -4, reason: "unknown stream" } };
      const out = { done: st.done, status: st.status, ack: normaliseAck(st.last), reset: st.reset };
      if (st.done) c.forget(stream);
      return out;
    },
    subscribe: async (sessionId: string) => ({ stream: await c.subscribe(sessionId, 0) }),
    poll: () => {
      const d = c.drain(cursor, 2_000);
      cursor = d.next;
      c.trim(cursor);
      return { next: d.next, dropped: d.dropped, events: d.events.map(normaliseEvent).filter((e) => e.kind !== "other"), open: c.isOpen() };
    },
    history: async (sessionId: string, limit: number) => {
      const r = await c.json("GET", `/chat/history?session_id=${encodeURIComponent(sessionId)}&limit=${Math.max(1, Math.min(500, limit | 0))}`, null, 30_000);
      return { status: r.status, history: r.status === 200 ? normaliseHistory(r.data) : null, reset: r.reset };
    },
    sessions: async (limit: number) => {
      const r = await c.json("GET", `/api/session/list?limit=${Math.max(1, Math.min(200, limit | 0))}`, null, 30_000);
      return { status: r.status, sessions: r.status === 200 ? normaliseSessionList(r.data) : null, reset: r.reset };
    },
    probe: async () => {
      try {
        if (!c.isOpen()) await c.connect();
        const r = await c.json("GET", "/api/session/list?limit=1", null, 30_000);
        return { ok: r.status === 200, status: r.status, step: r.status === 200 ? null : "list", message: r.status === 200 ? "" : `HTTP ${r.status ?? "timeout"}` };
      } catch (err) {
        const f = failure(err);
        return { ok: false, status: f.status, step: f.step, message: f.message };
      }
    },
    /** Workspace upload step (write/stat/rename/delete under workspace/user/files/ only); replies carry no contents. */
    fs: async (op: string, body: unknown) => {
      if (!fsBodyAllowed(op, body)) return { status: null, ok: false, size: null, kind: null, error: "refused by page" };
      try {
        const r = await c.json("POST", `/fs/${op}`, body, FS_REQUEST_TIMEOUT_MS);
        return normaliseFsReply(r.status, r.data);
      } catch (err) {
        return { status: null, ok: false, size: null, kind: null, error: failure(err).message.slice(0, 200) };
      }
    },
    fileStart: async (path: string, maxBytes: number, ms: number) => {
      const id = await c.startFile(path, maxBytes);
      const h = await c.fileHead(id, ms);
      if (h.status !== 200) {
        c.forget(id);
        return { fid: null, status: h.status, contentType: h.contentType, length: h.length, reset: h.reset };
      }
      const fid = `f${++fileSeq}`;
      files.set(fid, { id, at: Date.now() });
      for (const [k, v] of files) if (Date.now() - v.at > 10 * 60_000) {
        c.forget(v.id); // abandoned transfers
        files.delete(k);
      }
      return { fid, status: h.status, contentType: h.contentType, length: h.length, reset: null };
    },
    fileNext: async (fid: string, ms: number) => {
      const f = files.get(fid);
      if (!f) return { b64: "", done: true, reset: { code: -4, reason: "unknown file" }, timedOut: false };
      f.at = Date.now();
      const r = await c.takeFile(f.id, CHUNK, ms);
      return { b64: b64(r.data), done: r.done, reset: r.reset, timedOut: r.timedOut };
    },
    fileDone: (fid: string) => {
      const f = files.get(fid);
      if (f) c.forget(f.id);
      files.delete(fid);
      return true;
    },
    close: () => {
      c.close();
      files.clear();
      return true;
    },
  };
}
