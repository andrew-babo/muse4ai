import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, seedAccounts, type Harness } from "./helpers";
import { fixtureMedia, makeApi, mcpPost, type ApiRig } from "./apiHelpers";

// Build 2.0 R109/R110 — Hỏi đáp over REST and MCP (AC-AGT-01…06, 08).

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

/** Drives the scheduler while an API call or condition is pending (the harness has no timers of its own). */
async function pump<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.finally(() => (done = true)).catch(() => undefined);
  while (!done) {
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 10));
  }
  return p;
}
async function untilJob(id: string, token: string, status: string[] = ["succeeded", "failed", "cancelled", "needs_review"]) {
  const end = Date.now() + 5_000;
  for (;;) {
    h.coord.runScheduler();
    const r = await rig!.req("GET", `/v1/jobs/${id}`, { token });
    if (status.includes(r.json.status) || Date.now() > end) return r;
    await new Promise((res) => setTimeout(res, 15));
  }
}

async function setup(gw: Parameters<typeof makeHarness>[0] = {}) {
  h = makeHarness({ gw: () => ({}), ...gw });
  const ids = await seedAccounts(h, ["Mây", "Sương"]);
  rig = await makeApi(h);
  return ids;
}

describe("AC-AGT-01 — POST /v1/jobs kind=chat", () => {
  it("202 + Location; repeat → 400; 300 KB → 413; replay → same body; changed prompt → 422", async () => {
    await setup();
    const body = { kind: "chat", prompt: "Liệt kê 3 loại cà phê" };
    const r = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: body, headers: { "idempotency-key": "chat-1" } });
    expect(r.status).toBe(202);
    expect(r.headers.location).toBe(`/v1/jobs/${r.json.jobs[0].id}`);
    expect(r.json.jobs[0]).toMatchObject({ kind: "chat", status: "queued", prompt: body.prompt, result: null, warnings: [] });
    const rep = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: body, headers: { "idempotency-key": "chat-1" } });
    expect(rep.status).toBe(202);
    expect(rep.headers["idempotent-replayed"]).toBe("true");
    expect(rep.json.jobs[0].id).toBe(r.json.jobs[0].id);
    const changed = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { ...body, prompt: "khác" }, headers: { "idempotency-key": "chat-1" } });
    expect(changed.status).toBe(422);
    expect(changed.json.code).toBe("idempotency_conflict");
    const rep2 = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { ...body, repeat: 2 } });
    expect(rep2.status).toBe(400);
    expect(rep2.json.code).toBe("invalid_request");
    const big = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "x".repeat(300 * 1024) } });
    expect(big.status).toBe(413);
    // 100 KB chat body is fine (≤ 256 KB) but the prompt cap is 32 000 characters → 400, never 413.
    const long = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "y".repeat(100 * 1024) } });
    expect(long.status).toBe(400);
    // Image bodies keep 64 KB.
    const img = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "image", prompt: "z".repeat(70 * 1024) } });
    expect(img.status).toBe(413);
    // A read-only key cannot send.
    const ro = await rig!.req("POST", "/v1/jobs", { token: rig!.read, json: body });
    expect(ro.status).toBe(403);
  });
});

describe("AC-AGT-02 — POST /v1/references for documents", () => {
  it("CSV with X-File-Name → 201 document; unknown type → 415; 21 MiB → 413", async () => {
    await setup();
    const csv = Buffer.from("tháng,doanh thu\n1,10\n2,12\n");
    const r = await rig!.req("POST", "/v1/references", { token: rig!.gen, body: csv, headers: { "content-type": "text/csv", "x-file-name": "b%C3%A1o-c%C3%A1o.csv" } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: "document", filename: "báo-cáo.csv", mime: "text/csv", bytes: csv.length });
    expect(r.json.sha256).toMatch(/^[0-9a-f]{64}$/);
    const exe = await rig!.req("POST", "/v1/references", { token: rig!.gen, body: Buffer.from("MZ\u0090\u0000binary"), headers: { "content-type": "application/octet-stream", "x-file-name": "a.exe" } });
    expect(exe.status).toBe(415);
    const huge = await rig!.req("POST", "/v1/references", { token: rig!.gen, body: Buffer.alloc(21 * 1024 * 1024, 65), headers: { "content-type": "text/plain", "x-file-name": "big.txt" } });
    expect(huge.status).toBe(413);
  });
});

describe("AC-AGT-03/04 — results and conversations", () => {
  it("a finished chat shows result.text, outputs with filename and a working signed link, path, account, conversation_id; no Muse id", async () => {
    await setup({
      gw: () => ({ reply: () => ({ text: "Đây là bảng", files: [{ name: "bang.csv", mime: "text/csv", bytes: new TextEncoder().encode("a,b\n1,2\n") }, { name: "ghi-chu.txt", mime: "text/plain", bytes: new TextEncoder().encode("ok") }] }) }),
    });
    const c = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Tạo bảng", account: "Mây" } });
    const done = await untilJob(c.json.jobs[0].id, rig!.gen);
    expect(done.json).toMatchObject({ status: "succeeded", kind: "chat", path: "http", account: "Mây", result: { text: "Đây là bảng", text_truncated: false } });
    expect(done.json.conversation_id).toMatch(/^mc_/);
    expect(done.json.outputs.map((o: { kind: string; filename: string }) => [o.kind, o.filename.replace(/^.*_\d+_/, "")])).toEqual([
      ["file", "bang.csv"],
      ["file", "ghi-chu.txt"],
    ]);
    const url = new URL(done.json.outputs[0].download_url);
    const file = await rig!.req("GET", url.pathname + url.search, { token: null });
    expect(file.status).toBe(200);
    expect(file.body.toString()).toBe("a,b\n1,2\n");
    const sid = h.repo.getJob(done.json.id)!.remoteSessionId!;
    expect(JSON.stringify(done.json)).not.toContain(sid);
  });

  it("GET /v1/conversations/{id}: 3 turns of K1 in order, busy while one runs; another key → 404; continuing on another account → 422", async () => {
    await setup({ gw: () => ({ completeMs: 60 }) });
    const first = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Lượt 1", account: "Mây" } });
    const one = await untilJob(first.json.jobs[0].id, rig!.gen);
    const conv = one.json.conversation_id as string;
    const t2 = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Lượt 2", conversation_id: conv } });
    expect(t2.status).toBe(202);
    const busy = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Chen ngang", conversation_id: conv } });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe("conversation_busy");
    // The renderer's “Hỏi tiếp” reads the same reservation from the snapshot (R85 / AC-VIEW-05).
    expect(h.coord.snapshot().busyConversations).toEqual({ [conv]: t2.json.jobs[0].id });
    const wrong = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Sai tài khoản", conversation_id: conv, account: "Sương" } });
    expect(wrong.status).toBe(422);
    expect(wrong.json.code).toBe("conversation_account_mismatch");
    await untilJob(t2.json.jobs[0].id, rig!.gen);
    expect(h.coord.snapshot().busyConversations).toEqual({});
    const t3 = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Lượt 3", conversation_id: conv } });
    const view = await rig!.req("GET", `/v1/conversations/${conv}`, { token: rig!.gen });
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({ conversation_id: conv, account: "Mây", kind: "chat", busy: true });
    expect(view.json.turns.map((t: { job_id: string }) => t.job_id)).toEqual([first.json.jobs[0].id, t2.json.jobs[0].id, t3.json.jobs[0].id]);
    // Another key (even with generate scope) sees nothing and cannot continue it.
    const k2 = rig!.api.createKey("K2", "generate");
    const other = await rig!.req("GET", `/v1/conversations/${conv}`, { token: k2.token });
    expect(other.status).toBe(404);
    const steal = await rig!.req("POST", "/v1/jobs", { token: k2.token, json: { kind: "chat", prompt: "x", conversation_id: conv } });
    expect(steal.status).toBe(404);
    const unknown = await rig!.req("GET", `/v1/conversations/mc_00000000-0000-4000-8000-000000000000`, { token: rig!.gen });
    expect(unknown.status).toBe(404);
  });
});

describe("AC-AGT-05 — status shows execution and bridge", () => {
  it("each account's mode/path/HTTP state/counts and the bridge; readable with a read-only key", async () => {
    const [a, b] = await setup();
    h.coord.setExecution(b, { mode: "ui", maxConcurrent: 6, uiMaxConcurrent: 1 });
    const st = await rig!.req("GET", "/v1/status", { token: rig!.read });
    expect(st.status).toBe(200);
    const items = st.json.accounts.items as { alias: string; execution: Record<string, unknown> }[];
    expect(items.find((i) => i.alias === "Mây")!.execution).toMatchObject({ mode: "auto", active_path: "http", running_http: 0, running_ui: 0, max_concurrent: 10, ui_max_concurrent: 2 });
    expect(items.find((i) => i.alias === "Sương")!.execution).toMatchObject({ mode: "ui", active_path: "ui", max_concurrent: 6, ui_max_concurrent: 1 });
    expect(st.json.bridge).toMatchObject({ http_enabled: true });
    expect(st.json.capabilities.chat).toBe(true);
    expect(st.json.limits).toMatchObject({ chat_prompt_max_chars: 32000, chat_attachments_max: 10 });
    expect(JSON.stringify(st.json)).not.toMatch(/remoteSession|token|cookie/i);
    void a;
  });
});

describe("AC-AGT-06 — MCP muse_chat", () => {
  const call = (args: Record<string, unknown>, token?: string, version = "2025-11-25") =>
    mcpPost(rig!, { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name: "muse_chat", arguments: args } }, { token, headers: { "mcp-protocol-version": version } });

  it("wait 50 returns the final answer in one call; inline CSV is attached; 9 MiB inline → error; replay → same job; read key cannot see the tool", async () => {
    await setup({ gw: () => ({ completeMs: 300, reply: (_p, items) => ({ text: `Đã nhận ${items.length - 1} tệp` }) }) });
    const csv = Buffer.from("qty\n1\n2\n").toString("base64");
    const r = await pump(call({ prompt: "Cộng cột qty", attachments: [{ filename: "don-hang.csv", mime: "text/csv", data_base64: csv }], request_id: "mc-1", wait_seconds: 50 }));
    expect(r.json.result.isError).toBe(false);
    const job = r.json.result.structuredContent.job;
    expect(job).toMatchObject({ status: "succeeded", kind: "chat", result: { text: "Đã nhận 1 tệp" } });
    expect(r.json.result.content[0].text).toContain("Muse answered");
    expect(r.json.result.content[0].text).toContain(`conversation_id=${job.conversation_id}`);
    const sent = [...h.channels.values()].flatMap((c) => c.cfg.sent ?? []);
    expect(sent).toHaveLength(1);
    expect(sent[0].items[0]).toMatchObject({ type: "file", filename: "don-hang.csv", mime_type: "text/csv" });
    const again = await pump(call({ prompt: "Cộng cột qty", attachments: [{ filename: "don-hang.csv", mime: "text/csv", data_base64: csv }], request_id: "mc-1" }));
    expect(again.json.result.structuredContent).toMatchObject({ replayed: true, job: { id: job.id } });
    expect([...h.channels.values()].flatMap((c) => c.cfg.sent ?? [])).toHaveLength(1);
    // 8.5 MiB decoded fits the 12 MiB MCP body but exceeds the 8 MiB inline cap → tool parameter error.
    const over = await call({ prompt: "x", attachments: [{ filename: "a.txt", data_base64: Buffer.alloc(8.5 * 1024 * 1024, 66).toString("base64") }] });
    expect(over.json.result.isError).toBe(true);
    expect(over.json.result.content[0].text).toMatch(/^invalid_request:/);
    // 9 MiB decoded is 12 MiB of base64: the request itself is over the 12 MiB MCP body cap → 413, nothing created.
    const huge = await call({ prompt: "x", attachments: [{ filename: "a.txt", data_base64: Buffer.alloc(9 * 1024 * 1024, 66).toString("base64") }] });
    expect(huge.status).toBe(413);
    expect(h.repo.queryJobs({}).total).toBe(1);
    const list = await mcpPost(rig!, { jsonrpc: "2.0", id: 9, method: "tools/list" }, { token: rig!.read, headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(list.json.result.tools.map((t: { name: string }) => t.name)).not.toContain("muse_chat");
    const ro = await call({ prompt: "x" }, rig!.read);
    expect(ro.json.result.isError).toBe(true);
    expect(ro.json.result.content[0].text).toMatch(/^insufficient_scope:/);
  });

  it("works on the oldest supported protocol too (2025-03-26, no structured content)", async () => {
    await setup({ gw: () => ({ completeMs: 50 }) });
    const r = await pump(call({ prompt: "Chào", wait_seconds: 10 }, undefined, "2025-03-26"));
    expect(r.json.result.isError).toBe(false);
    expect(r.json.result.structuredContent).toBeUndefined();
    expect(r.json.result.content[0].text).toContain("Trả lời: Chào");
  });
});

describe("AC-AGT-08 — OpenAPI", () => {
  it("documents chat, outputs and execution, and says the app does not verify content and that accounts share Muse memory", async () => {
    await setup();
    const doc = await rig!.req("GET", "/v1/openapi.json", { token: null });
    expect(doc.json.openapi).toBe("3.1.0");
    expect(doc.json.components.schemas.CreateChat.properties.kind.const).toBe("chat");
    // The documented states are exactly the ones status returns (HttpState), so agents can switch on them.
    expect(doc.json.components.schemas.Execution.properties.http_state.enum).toEqual(["unknown", "healthy", "degraded", "down", "off"]);
    const st = await rig!.req("GET", "/v1/status", { token: rig!.read });
    expect(st.json.accounts.items.length).toBeGreaterThan(0);
    for (const a of st.json.accounts.items) expect(doc.json.components.schemas.Execution.properties.http_state.enum).toContain(a.execution.http_state);
    expect(doc.json.components.schemas.Output.properties.kind.enum).toContain("file");
    expect(doc.json.info.description).toContain("does not verify content");
    expect(doc.json.info.description).toContain("share that account's Muse memory");
  });
});

describe("AC-CHAT-02 — attachment limits and types over REST", () => {
  // Each upload spends one token of the upload bucket (burst 10, 60/min): step the clock 1 s so the bucket refills.
  const up = (body: Uint8Array | Buffer, name: string, type = "application/octet-stream") => {
    h.clock.t += 1_000;
    return rig!.req("POST", "/v1/references", { token: rig!.gen, body: Buffer.from(body), headers: { "content-type": type, "x-file-name": encodeURIComponent(name) } });
  };

  it("10 accepted; 11 → 400 attachment_limit; 51 MiB in total → 400; three wrong documents → 415 unsupported_attachment; ..\\..\\a.csv is stored as a.csv", async () => {
    await setup();
    const docs: [Uint8Array | Buffer, string][] = [
      [fixtureMedia("image", 0), "anh.jpg"],
      [fixtureMedia("video", 0), "clip.mp4"],
      [Buffer.from("thang,doanh thu\n1,10\n"), "a1.csv"],
      [Buffer.from("ghi chú một"), "b1.txt"],
      [Buffer.from("# Tiêu đề\n"), "c1.md"],
      [Buffer.from('{"a":1}'), "d1.json"],
      [Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"), "e1.pdf"],
      [Buffer.from("x,y\n2,3\n"), "a2.csv"],
      [Buffer.from("ghi chú hai"), "b2.txt"],
      [Buffer.from('{"b":2}'), "d2.json"],
      [Buffer.from("# Mười một\n"), "f1.md"],
    ];
    const ids: string[] = [];
    for (const [b, n] of docs) {
      const r = await up(b, n);
      expect(r.status, n).toBe(201);
      ids.push(r.json.reference_id);
    }
    expect(new Set(ids).size).toBe(11);
    const ten = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Tóm tắt các tệp", attachments: ids.slice(0, 10) } });
    expect(ten.status).toBe(202);
    const eleven = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Quá nhiều", attachments: ids } });
    expect(eleven.status).toBe(400);
    expect(eleven.json.code).toBe("attachment_limit");
    // 3 × 17 MiB = 51 MiB > 50 MiB (each file is under the 20 MiB transport cap).
    const big: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await up(Buffer.alloc(17 * 1024 * 1024, 65 + i), `lon-${i}.txt`, "text/plain");
      expect(r.status).toBe(201);
      big.push(r.json.reference_id);
    }
    const total = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Tổng quá lớn", attachments: big } });
    expect(total.status).toBe(400);
    expect(total.json.code).toBe("attachment_limit");
    // Wrong documents: binary renamed .csv, CSV that is not UTF-8, PDF without %PDF-.
    for (const [b, n] of [
      [Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), "chuong-trinh.csv"],
      [Buffer.from([0x61, 0x2c, 0xff, 0xfe, 0x0a]), "sai-ma.csv"],
      [Buffer.from("xin chao\n%%EOF\n"), "khong-phai.pdf"],
    ] as const) {
      const r = await up(b, n);
      expect(r.status, n).toBe(415);
      expect(r.json.code, n).toBe("unsupported_attachment");
    }
    // A non-document upload keeps Build 1.0's code (AC-AGT-09).
    const exe = await up(Buffer.from("MZ\u0090\u0000binary"), "a.exe");
    expect(exe.json.code).toBe("unsupported_media_type");
    const named = await up(Buffer.from("k,v\n1,2\n"), "..\\..\\a.csv", "text/csv");
    expect(named.status).toBe(201);
    expect(named.json.filename).toBe("a.csv");
  });
});

describe("AC-CHAT-08 — continuing a conversation that is not this key's", () => {
  it("K2 with K1's id, a Studio job's id, an unknown id and a malformed id get the same 404; a read-only key gets 403", async () => {
    const [may] = await setup();
    const k1 = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Của K1", account: "Mây" } });
    const k1Conv = (await untilJob(k1.json.jobs[0].id, rig!.gen)).json.conversation_id as string;
    const studioId = h.coord.createChatJob({ prompt: "Hỏi trong Studio", referenceIds: [], accountPref: may, clientRequestId: "studio-chat-1" });
    for (let i = 0; i < 200 && h.repo.getJob(studioId)!.state !== "completed"; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 10));
    }
    const studioConv = h.repo.getJob(studioId)!.conversationId!;
    expect(studioConv).toMatch(/^mc_/);
    const k2 = rig!.api.createKey("K2", "generate");
    const tries = [
      [k2.token, k1Conv],
      [rig!.gen, studioConv],
      [rig!.gen, "mc_00000000-0000-4000-8000-000000000000"],
      [rig!.gen, "khong-dung-dang"],
    ] as const;
    const bodies: string[] = [];
    for (const [token, conversation_id] of tries) {
      const r = await rig!.req("POST", "/v1/jobs", { token, json: { kind: "chat", prompt: "Hỏi tiếp", conversation_id } });
      expect(r.status, conversation_id).toBe(404);
      const { code, title, detail, status } = r.json;
      bodies.push(JSON.stringify({ code, title, detail, status }));
    }
    expect(new Set(bodies).size).toBe(1);
    const ro = await rig!.req("POST", "/v1/jobs", { token: rig!.read, json: { kind: "chat", prompt: "Hỏi tiếp", conversation_id: k1Conv } });
    expect(ro.status).toBe(403);
  });
});

describe("AC-CHAT-09 — Hỏi đáp continues the conversation of an HTTP image", () => {
  it("an image made over HTTP has conversation_id; a chat continuing it runs in the same Muse conversation and keeps the image Muse returns", async () => {
    await setup({
      gw: () => ({
        reply: (prompt: string) =>
          /^Generate an image/.test(prompt)
            ? { text: "Here is your image", files: [{ name: "image.png", mime: "image/png", bytes: fixtureMedia("image", 1) }] }
            : { text: "Đã đổi nền", files: [{ name: "nen-do.jpg", mime: "image/jpeg", bytes: fixtureMedia("image", 2) }] },
      }),
    });
    const img = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "image", prompt: "con mèo ngồi trên ghế", account: "Mây" } });
    const done = await untilJob(img.json.jobs[0].id, rig!.gen);
    expect(done.json).toMatchObject({ status: "succeeded", path: "http" });
    expect(done.json.conversation_id).toMatch(/^mc_/);
    const c = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Đổi nền ảnh vừa rồi sang màu đỏ", conversation_id: done.json.conversation_id } });
    expect(c.status).toBe(202);
    const chat = await untilJob(c.json.jobs[0].id, rig!.gen);
    expect(chat.json).toMatchObject({ status: "succeeded", path: "http", account: "Mây", conversation_id: done.json.conversation_id, result: { text: "Đã đổi nền" } });
    expect(chat.json.outputs.map((o: { kind: string; mime: string }) => [o.kind, o.mime])).toEqual([["image", "image/jpeg"]]);
    const a = h.repo.listAccounts().find((x) => x.alias === "Mây")!;
    const sent = h.gwCfg(a.id).sent!;
    expect(sent).toHaveLength(2);
    expect(sent[1].sessionId).toBe(sent[0].sessionId);
    expect(JSON.stringify(chat.json)).not.toContain(sent[0].sessionId);
  });
});
