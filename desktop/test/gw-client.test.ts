import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GatewayClient, MAX_FRAME_PAYLOAD, type GatewayEnv, type SocketLike } from "../src/shared/gateway/client";
import { normaliseEvent, normaliseHistory, turnLooksDone, workspacePath } from "../src/shared/gateway/events";
import { responderHandshake, type Transport } from "../src/shared/gateway/noise";
import { bytes, concat, decodeFields, fieldBytes, fieldString, fieldVarint, num, str } from "../src/shared/gateway/proto";
import { classifyGatewaySignal, isDirect } from "../src/main/adapter/muse/httpProtocol";
import { ChannelError, ElectronHttpChannel, type ChannelPage } from "../src/main/adapter/muse/httpChannel";

// A fake Muse gateway speaking Noise XX + the framed request protocol, over an in-memory socket (Build 2.0 P3a).

type Handler = (req: { method: string; path: string; body: unknown }, reply: (frames: { status?: number; headers?: [string, string][]; data?: Uint8Array; end?: boolean }[]) => void) => void;

function fakeGateway(opts: { handler: Handler; challenge?: boolean; tokenStatus?: number; vmStates?: string[]; calls?: { url: string; body?: string }[] }) {
  let server!: { onClient: (m: Uint8Array) => void };
  const states = opts.vmStates ? [...opts.vmStates] : null;
  const env: GatewayEnv = {
    fetch: async (url, init) => {
      opts.calls?.push({ url, body: init?.body });
      if (url.startsWith("/api/session")) {
        const vm_state = states ? (states.length > 1 ? states.shift()! : states[0]) : "live";
        return { ok: true, status: 200, json: async () => ({ endpoint_url: "https://vm-123.metaaivm.com", vm_id: "vm-123", vm_state }) };
      }
      if (url === "/api/hatch/vm/wake") return { ok: true, status: 200, json: async () => ({}) };
      if (url.startsWith("/api/hatch/token")) return { ok: (opts.tokenStatus ?? 200) === 200, status: opts.tokenStatus ?? 200, json: async () => ({ token: "SECRET-TOKEN" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
    openSocket: (url) => {
      expect(url).toContain("wss://hatch.metaaivm.com/v1/noise?");
      const sock: SocketLike = {
        binaryType: "",
        readyState: 1,
        send: (d) => server.onClient(d),
        close: () => {
          sock.readyState = 3;
        },
        onopen: null,
        onerror: null,
        onclose: null,
        onmessage: null,
      };
      const toClient = (m: Uint8Array) => setTimeout(() => sock.onmessage?.({ data: m }), 0);
      const inbox: Uint8Array[] = [];
      let waiter: ((m: Uint8Array) => void) | null = null;
      let tx: Transport | null = null;
      const receive = () => new Promise<Uint8Array>((res) => (inbox.length ? res(inbox.shift()!) : (waiter = res)));
      server = {
        onClient: (m) => {
          if (waiter) {
            const w = waiter;
            waiter = null;
            w(m);
          } else inbox.push(m);
        },
      };
      const serve = async (m: Uint8Array) => {
            const pt = await tx!.recv.decrypt(new Uint8Array(0), m);
            const f = decodeFields(pt);
            const outer = decodeFields(bytes(f, 4)!);
            const inner = decodeFields(bytes(outer, 2)!);
            const sid = num(inner, 1);
            const app = decodeFields(bytes(inner, 2)!);
            const bodyB = bytes(app, 4);
            const req = { method: str(app, 1), path: str(app, 2), body: bodyB ? JSON.parse(new TextDecoder().decode(bodyB)) : null };
            opts.handler(req, (frames) => {
              void (async () => {
                for (const fr of frames) {
                  let frame: Uint8Array;
                  if (fr.status !== undefined) {
                    let head = fieldVarint(1, fr.status);
                    for (const [k, v] of fr.headers ?? []) head = concat(head, fieldBytes(2, concat(fieldString(1, k), fieldString(2, v))));
                    if (fr.data) head = concat(head, fieldBytes(3, fr.data));
                    if (fr.end) head = concat(head, fieldVarint(4, 1));
                    frame = concat(fieldVarint(1, sid), fieldBytes(3, head));
                  } else {
                    let b = fr.data ? fieldBytes(1, fr.data) : new Uint8Array(0);
                    if (fr.end) b = concat(b, fieldVarint(2, 1));
                    frame = concat(fieldVarint(1, sid), fieldBytes(4, b));
                  }
                  const whole = fieldBytes(1, frame);
                  const total = Math.max(1, Math.ceil(whole.length / MAX_FRAME_PAYLOAD));
                  for (let i = 0; i < total; i++) {
                    const part = whole.subarray(i * MAX_FRAME_PAYLOAD, (i + 1) * MAX_FRAME_PAYLOAD);
                    toClient(await tx!.send.encrypt(new Uint8Array(0), concat(fieldVarint(1, 7), fieldVarint(2, i), fieldVarint(3, total), fieldBytes(4, part))));
                  }
                }
              })();
            });
      };
      setTimeout(() => sock.onopen?.(), 0);
      void (async () => {
        const payload2 = opts.challenge ? concat(fieldVarint(1, 1), fieldVarint(2, 1), fieldBytes(3, randomBytes(32))) : fieldVarint(1, 0);
        const r = await responderHandshake({ receive, send: toClient, payload2 });
        tx = r.transport;
        // Transport messages strictly in order (nonces), like a real socket.
        for (;;) await serve(await receive());
      })();
      return sock;
    },
    randomUUID: () => randomUUID(),
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as NodeJS.Timeout),
  };
  return env;
}

describe("Build 2.0 P3a — gateway client (Noise XX over WebCrypto, framed requests)", () => {
  it("connects, sends a JSON request, reassembles a reply larger than one frame", async () => {
    const big = "x".repeat(MAX_FRAME_PAYLOAD * 2 + 123);
    const env = fakeGateway({
      handler: (req, reply) => {
        if (req.path.startsWith("/chat/history")) reply([{ status: 200, headers: [["content-type", "application/json"]], data: new TextEncoder().encode(JSON.stringify({ result: { chat_events: [], big } })), end: true }]);
      },
    });
    const c = new GatewayClient(env);
    await c.connect();
    expect(c.isOpen()).toBe(true);
    const r = await c.json("GET", "/chat/history?session_id=x", null, 5_000);
    expect(r.status).toBe(200);
    expect((r.data as { result: { big: string } }).result.big).toHaveLength(big.length);
    expect(c.errors).toEqual([]);
  });

  it("streams NDJSON events (subscribe) and the final ack record of /chat/stream", async () => {
    const env = fakeGateway({
      handler: (req, reply) => {
        const enc = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);
        if (req.path === "/chat/stream") reply([{ status: 200, data: enc({ event: "message.user", payload: { session_id: (req.body as { session_id: string }).session_id } }) }, { data: new TextEncoder().encode(JSON.stringify({ session_id: (req.body as { session_id: string }).session_id, is_thread: true, ok: true })), end: true }]);
      },
    });
    const c = new GatewayClient(env);
    await c.connect();
    const sid = randomUUID();
    const id = await c.sendChat(sid, [{ type: "text", text: "hi" }], "test");
    const st = await c.wait(id, 5_000);
    expect(st?.done).toBe(true);
    expect(c.streamInfo(id)?.last).toMatchObject({ session_id: sid, is_thread: true });
    const d = c.drain(0);
    expect(d.events.map((e) => normaliseEvent(e).kind)).toEqual(["user", "other"]);
  });

  it("a server challenge or a refused token is a connect failure that never exposes the token", async () => {
    const c1 = new GatewayClient(fakeGateway({ handler: () => undefined, challenge: true }));
    await expect(c1.connect()).rejects.toMatchObject({ reason: "connect_failed", detail: { step: "challenge" } });
    const c2 = new GatewayClient(fakeGateway({ handler: () => undefined, tokenStatus: 401 }));
    const err = await c2.connect().catch((e) => e);
    expect(err).toMatchObject({ reason: "connect_failed", detail: { step: "token", status: 401 } });
    expect(String(err.message) + JSON.stringify(err)).not.toContain("SECRET-TOKEN");
  });

  it("a file larger than the limit is cut (never buffered past the cap)", async () => {
    const env = fakeGateway({
      handler: (req, reply) => {
        if (req.path.startsWith("/fs/raw")) reply([{ status: 200, headers: [["content-type", "video/mp4"]], data: new Uint8Array(5_000) }, { data: new Uint8Array(5_000), end: true }]);
      },
    });
    const c = new GatewayClient(env);
    await c.connect();
    const ok = await c.fetchFile("/workspace/a.mp4", 5_000, 20_000);
    expect(ok).toMatchObject({ status: 200, contentType: "video/mp4" });
    expect(ok.data.length).toBe(10_000);
    const cut = await c.fetchFile("/workspace/a.mp4", 5_000, 6_000);
    expect(cut.reset).toMatchObject({ reason: "too large" });
  });

  it("a streamed download hands out pieces of at most `max` bytes; taken bytes leave the client; the cap still cuts", async () => {
    const env = fakeGateway({
      handler: (req, reply) => {
        if (req.path.startsWith("/fs/raw")) reply([{ status: 200, headers: [["content-type", "video/mp4"], ["content-length", "10000"]], data: new Uint8Array(5_000).fill(1) }, { data: new Uint8Array(5_000).fill(2), end: true }]);
      },
    });
    const c = new GatewayClient(env);
    await c.connect();
    const id = await c.startFile("/workspace/a.mp4", 20_000);
    expect(await c.fileHead(id, 5_000)).toMatchObject({ status: 200, contentType: "video/mp4", length: 10_000, reset: null });
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await c.takeFile(id, 3_000, 5_000);
      if (r.data.length) pieces.push(r.data);
      if (r.done) break;
    }
    expect(pieces.every((p) => p.length <= 3_000)).toBe(true);
    const all = Buffer.concat(pieces);
    expect(all.length).toBe(10_000);
    expect(all[4_999]).toBe(1);
    expect(all[5_000]).toBe(2);
    const cutId = await c.startFile("/workspace/a.mp4", 6_000);
    await c.fileHead(cutId, 5_000);
    let last = await c.takeFile(cutId, 100_000, 5_000);
    while (!last.done) last = await c.takeFile(cutId, 100_000, 5_000);
    expect(last.reset).toMatchObject({ reason: "too large" });
  });
});

describe("Build 2.0 — gateway data normalisation", () => {
  it("history → turns with the final text, readiness and files of each turn; user attachments are not outputs", () => {
    const h = normaliseHistory({
      result: {
        chat_events: [
          { event_name: "message.user", display_text: "Câu 1", attachments: [{ path: "/workspace/in.csv" }] },
          { event_name: "message.assistant", display_text: "Phần 1", display_text_ready: true, display_text_updated_at_ms: 10, payload: { status: "completed", metadata: { message_kind: "message" } } },
          { event_name: "message.assistant", display_text: "Phần 2", display_text_ready: true, display_text_updated_at_ms: 20, payload: { status: "completed", metadata: { message_kind: "message" } }, presentation: { files: [{ path: "sandbox:///workspace/out/a.csv", mime: "text/csv", byte_len: 12 }] } },
          { event_name: "message.user", display_text: "Câu 2" },
          { event_name: "message.assistant", display_text: "", display_text_ready: false },
        ],
      },
    })!;
    expect(h.userMsgs).toBe(2);
    expect(h.turns[0].assistant).toEqual({ text: "Phần 1\n\nPhần 2", ready: true, final: true, updatedAtMs: 20 });
    expect(h.turns[0].files).toEqual([{ path: "/workspace/out/a.csv", mime: "text/csv", byteLen: 12, name: null }]);
    expect(turnLooksDone(h.turns[0])).toBe(true);
    expect(turnLooksDone(h.turns[1])).toBe(false);
    expect(normaliseHistory({ unexpected: true })).toBeNull();
    expect(workspacePath("https://x/fs/raw/workspace/b.png?sig=1")).toBe("/workspace/b.png");
  });

  it("live 01/11 long answer: a commentary preamble and the first streamed words are 'ready' but not done; the completed answer is, without the preamble", () => {
    const user = { event_name: "message.user", display_text: "Mã kiểm tra: C1. Viết bài 1200 từ" };
    const commentary = (text: string, ready: boolean, status?: string) => ({ event_name: "message.assistant", display_text: text, display_text_ready: ready, display_text_updated_at_ms: 100, payload: { ...(status ? { status } : {}), metadata: { message_kind: "commentary", public_commentary: true } } });
    const answer = (text: string, status?: string) => ({ event_name: "message.assistant", display_text: text, display_text_ready: true, display_text_updated_at_ms: 200, payload: { ...(status ? { status } : {}), metadata: { message_kind: "message" } } });
    const at = (...ev: unknown[]) => normaliseHistory({ result: { chat_events: [user, ...ev] } })!.turns[0];
    // Snapshots in the order the capture saw them (every 1.5 s).
    expect(turnLooksDone(at(commentary("", false)))).toBe(false);
    const pre = at(commentary("Mình sẽ viết bài khoảng 1200 từ…", true, "completed"));
    expect(pre.assistant).toMatchObject({ text: "Mình sẽ viết bài khoảng 1200 từ…", final: false });
    expect(turnLooksDone(pre)).toBe(false);
    const streaming = at(commentary("Mình sẽ viết bài khoảng 1200 từ…", true, "completed"), answer("Lịch s"));
    expect(streaming.assistant).toMatchObject({ text: "Lịch s", ready: true, final: false });
    expect(turnLooksDone(streaming)).toBe(false);
    const done = at(commentary("Mình sẽ viết bài khoảng 1200 từ…", true, "completed"), answer("Lịch sử …\ncode=C1", "completed"));
    expect(done.assistant).toEqual({ text: "Lịch sử …\ncode=C1", ready: true, final: true, updatedAtMs: 200 });
    expect(turnLooksDone(done)).toBe(true);
    // A second answer message still streaming after a finished one keeps the turn open.
    expect(turnLooksDone(at(answer("Phần 1", "completed"), answer("Phần")))).toBe(false);
  });
});

describe("Build 2.0 R90/R96 — signals and proxy guard", () => {
  it("classifies Muse's own signals; unknown errors are technical", () => {
    expect(classifyGatewaySignal(403, null, "We've detected unusual activity")).toBe("anomaly");
    expect(classifyGatewaySignal(200, "checkpoint_required", null)).toBe("checkpoint");
    expect(classifyGatewaySignal(429, null, null)).toBe("quota");
    expect(classifyGatewaySignal(401, null, null)).toBe("needs_login");
    expect(classifyGatewaySignal(502, null, "bad gateway")).toBeNull();
  });
  it("DIRECT anywhere in the proxy resolution blocks the channel", () => {
    expect(isDirect("PROXY 10.0.0.1:8080")).toBe(false);
    expect(isDirect("SOCKS5 10.0.0.1:1080")).toBe(false);
    expect(isDirect("DIRECT")).toBe(true);
    expect(isDirect("PROXY 10.0.0.1:8080; DIRECT")).toBe(true);
  });
});

describe("Build 2.0 AC-GW-09 — every page reply is schema-checked", () => {
  const page = (answers: Record<string, unknown>, proxy = "PROXY 10.0.0.1:8080"): ChannelPage => ({
    eval: async <T,>(code: string) => {
      if (code.startsWith("typeof window.__msg")) return true as T;
      for (const [k, v] of Object.entries(answers)) if (code.includes(`__msg.${k}(`)) return v as T;
      return undefined as T;
    },
    resolveProxy: async () => proxy,
    memoryBytes: () => null,
    destroy: () => undefined,
  });

  it("a malformed or oversized reply is a protocol mismatch; a DIRECT proxy never connects", async () => {
    const bad = new ElectronHttpChannel({ openPage: async () => page({ connect: { ok: true, vmState: null }, poll: { events: "nope" } }), script: () => "" });
    await bad.connect();
    await expect(bad.poll()).rejects.toMatchObject({ reason: "protocol_mismatch" });
    const huge = new ElectronHttpChannel({
      openPage: async () => page({ connect: { ok: true, vmState: null }, fileStart: { fid: "f1", status: 200, contentType: "image/png", length: null, reset: null }, fileNext: { b64: "A".repeat(6_000_000), done: true, reset: null, timedOut: false } }),
      script: () => "",
    });
    await huge.connect();
    await expect(huge.fetchFile("/workspace/a.png", 10_000_000, new AbortController().signal)).rejects.toMatchObject({ reason: "protocol_mismatch" });
    const direct = new ElectronHttpChannel({ openPage: async () => page({ connect: { ok: true, vmState: null } }, "DIRECT"), script: () => "" });
    await expect(direct.connect()).rejects.toBeInstanceOf(ChannelError);
    await expect(direct.connect()).rejects.toMatchObject({ reason: "proxy" });
  });

  it("downloads are streamed: pieces arrive over several pulls, at most 2 files per page at once, lengths are checked", async () => {
    let live = 0;
    let peak = 0;
    const pulls = new Map<string, number>();
    let seq = 0;
    const ch = new ElectronHttpChannel({
      openPage: async () => ({
        eval: async <T,>(code: string) => {
          if (code.startsWith("typeof window.__msg")) return true as T;
          if (code.includes("__msg.connect(")) return { ok: true, vmState: null } as T;
          if (code.includes("__msg.fileStart(")) {
            live++;
            peak = Math.max(peak, live);
            const short = code.includes("short.mp4");
            return { fid: `f${++seq}${short ? "s" : ""}`, status: 200, contentType: "video/mp4", length: short ? 9 : 6, reset: null } as T;
          }
          if (code.includes("__msg.fileNext(")) {
            const fid = /fileNext\("([^"]+)"/.exec(code)![1];
            const n = (pulls.get(fid) ?? 0) + 1;
            pulls.set(fid, n);
            await new Promise((r) => setTimeout(r, 5));
            // 1st pull: nothing yet; 2nd and 3rd: 3 bytes each; the 3rd is the end.
            if (n === 1) return { b64: "", done: false, reset: null, timedOut: true } as T;
            return { b64: Buffer.from(n === 2 ? [1, 2, 3] : [4, 5, 6]).toString("base64"), done: n >= 3, reset: null, timedOut: false } as T;
          }
          if (code.includes("__msg.fileDone(")) {
            live--;
            return true as T;
          }
          return undefined as T;
        },
        resolveProxy: async () => "PROXY 10.0.0.1:8080",
        memoryBytes: () => null,
        destroy: () => undefined,
      }),
      script: () => "",
    });
    await ch.connect();
    const got = await Promise.all([1, 2, 3, 4, 5].map((i) => ch.fetchFile(`/workspace/v${i}.mp4`, 1_000, new AbortController().signal)));
    expect(got.map((g) => [...g.data])).toEqual(Array(5).fill([1, 2, 3, 4, 5, 6]));
    expect(peak).toBe(2);
    expect(live).toBe(0);
    // Muse said 9 bytes but the stream ended after 6 → a failed download, never a short file.
    await expect(ch.fetchFile("/workspace/short.mp4", 1_000, new AbortController().signal)).rejects.toMatchObject({ reason: "fetch_failed", message: expect.stringMatching(/thiếu byte \(6\/9\)/) });
    // More bytes than the job allows → refused while streaming.
    await expect(ch.fetchFile("/workspace/v6.mp4", 4, new AbortController().signal)).rejects.toMatchObject({ reason: "fetch_failed", message: expect.stringMatching(/quá lớn/) });
    expect(live).toBe(0);
  });

  it("live 01/11: a socket Muse closed while nothing polled is noticed by checkOpen and by any failed call, so the next use reconnects", async () => {
    let socketOpen = false;
    let connects = 0;
    const ch = new ElectronHttpChannel({
      openPage: async () => ({
        eval: async <T,>(code: string) => {
          if (code.startsWith("typeof window.__msg")) return true as T;
          if (code.includes("__msg.state()")) return { installed: true, open: socketOpen, openedAt: null, closedCode: socketOpen ? null : 1006, errors: 0 } as T;
          if (code.includes("__msg.connect(")) {
            connects++;
            socketOpen = true;
            return { ok: true, vmState: null } as T;
          }
          if (code.includes("__msg.history(")) {
            if (!socketOpen) throw new Error("Kết nối đã đóng");
            return { status: 200, history: { turns: [], userMsgs: 0, unknownShape: false }, reset: null } as T;
          }
          return undefined as T;
        },
        resolveProxy: async () => "PROXY 10.0.0.1:8080",
        memoryBytes: () => null,
        destroy: () => undefined,
      }),
      script: () => "",
    });
    await ch.connect();
    expect([ch.isOpen(), connects]).toEqual([true, 1]);
    socketOpen = false; // code 1006 while idle: the last known state still says open
    expect(ch.isOpen()).toBe(true);
    expect(await ch.checkOpen()).toBe(false);
    expect(ch.isOpen()).toBe(false);
    await ch.connect();
    expect([ch.isOpen(), connects]).toEqual([true, 2]);
    await ch.connect(); // still open: no second socket
    expect(connects).toBe(2);
    socketOpen = false;
    await expect(ch.history("s1")).rejects.toMatchObject({ reason: "stream_lost" });
    expect(ch.isOpen()).toBe(false);
  });

  it("AC-GW-05/R94: an idle close keeps the light page for the unload delay (the next job reuses it), then unloads it; unloadPage drops it at once", async () => {
    let opened = 0;
    let destroyed = 0;
    let socketCloses = 0;
    const mk = () =>
      new ElectronHttpChannel({
        openPage: async () => {
          opened++;
          return {
            eval: async <T,>(code: string) => {
              if (code.startsWith("typeof window.__msg")) return true as T;
              if (code.includes("__msg.connect(")) return { ok: true, vmState: null } as T;
              if (code.includes("__msg.close()")) {
                socketCloses++;
                return true as T;
              }
              return undefined as T;
            },
            resolveProxy: async () => "PROXY 10.0.0.1:8080",
            memoryBytes: () => null,
            destroy: () => void destroyed++,
          };
        },
        script: () => "",
        unloadAfterMs: 60,
      });
    const ch = mk();
    await ch.connect();
    ch.close();
    expect(ch.isOpen()).toBe(false);
    expect(ch.hasPage()).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(socketCloses).toBe(1);
    expect(destroyed).toBe(0);
    // Used again before the delay: same page, no reload, and the pending unload is cancelled.
    await ch.connect();
    expect(opened).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(destroyed).toBe(0);
    ch.close();
    await new Promise((r) => setTimeout(r, 90));
    expect(destroyed).toBe(1);
    expect(ch.hasPage()).toBe(false);
    // The next job opens a fresh page normally.
    await ch.connect();
    expect(opened).toBe(2);
    expect(ch.isOpen()).toBe(true);
    ch.close({ unloadPage: true });
    await new Promise((r) => setTimeout(r, 5));
    expect(destroyed).toBe(2);
    expect(ch.hasPage()).toBe(false);
  });

  it("401/403 once is a technical failure; twice in a row is needs_login (R90)", async () => {
    const ch = new ElectronHttpChannel({ openPage: async () => page({ connect: { ok: false, reason: "connect_failed", step: "token", status: 401, message: "unauthorized" } }), script: () => "" });
    await expect(ch.connect()).rejects.toMatchObject({ reason: "connect_failed" });
    await expect(ch.connect()).rejects.toMatchObject({ reason: "needs_login" });
  });

  describe("a suspended Muse machine is woken before connecting (live 01/11: idle accounts report SUSPENDED)", () => {
    // Virtual clock: each 2 s wait between session reads advances time without sleeping.
    const fastClock = (env: GatewayEnv) => {
      let t = 0;
      env.now = () => t;
      env.setTimeout = (fn, ms) => (ms === 2_000 ? ((t += ms), setTimeout(fn, 0)) : setTimeout(fn, ms));
      return env;
    };
    it("SUSPENDED → POST /api/hatch/vm/wake {vm_id, retry_count:0} → RUNNING → connects", async () => {
      const calls: { url: string; body?: string }[] = [];
      const c = new GatewayClient(fastClock(fakeGateway({ handler: () => undefined, vmStates: ["SUSPENDED", "SUSPENDED", "RUNNING"], calls })));
      const r = await c.connect();
      expect(r).toMatchObject({ vmState: "RUNNING", woke: true });
      expect(c.isOpen()).toBe(true);
      const wakes = calls.filter((x) => x.url === "/api/hatch/vm/wake").map((x) => JSON.parse(x.body!));
      expect(wakes).toEqual([{ vm_id: "vm-123", retry_count: 0 }]);
      // The token is asked for only after the machine reports RUNNING.
      const order = calls.map((x) => x.url.split("?")[0]);
      expect(order.indexOf("/api/hatch/token")).toBeGreaterThan(order.lastIndexOf("/api/session"));
    });
    it("a running machine is not woken", async () => {
      const calls: { url: string; body?: string }[] = [];
      const c = new GatewayClient(fastClock(fakeGateway({ handler: () => undefined, vmStates: ["RUNNING"], calls })));
      expect(await c.connect()).toMatchObject({ woke: false });
      expect(calls.some((x) => x.url === "/api/hatch/vm/wake")).toBe(false);
    });
    it("a machine that never wakes fails as connect_failed step wake after 90 s, re-sending the wake every 10 s", async () => {
      const calls: { url: string; body?: string }[] = [];
      const c = new GatewayClient(fastClock(fakeGateway({ handler: () => undefined, vmStates: ["SUSPENDED"], calls })));
      await expect(c.connect()).rejects.toMatchObject({ reason: "connect_failed", detail: { step: "wake" } });
      const wakes = calls.filter((x) => x.url === "/api/hatch/vm/wake").map((x) => JSON.parse(x.body!).retry_count);
      expect(wakes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(calls.some((x) => x.url === "/api/hatch/token")).toBe(false);
    });
  });
});

