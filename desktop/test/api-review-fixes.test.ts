import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { API_BUCKETS, API_WAITS_PER_KEY } from "../src/shared/api/constants";
import { fixtureMedia, makeApi, mcpPost, modernMeta, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Regression tests for the independent review of Phase 8 (27/10/2026). Each test names the rule it protects.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  if (h) {
    await Promise.race([h.coord.idle(), new Promise((r) => setTimeout(r, 3000))]);
    await h.coord.stop();
    h.close();
  }
});

const PROMPT = "Một tách cà phê trên bàn gỗ";

/** Starts a GET that the client abandons after `ms` (socket destroyed, no response read). */
function abandonedGet(port: number, path: string, token: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${port}` } });
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.end();
    setTimeout(() => req.destroy(), ms);
  });
}

describe("R28 wait: a client that disconnects frees its wait slot", () => {
  it(`${API_WAITS_PER_KEY} abandoned waits do not block the next wait (no 429 too_many_waits)`, async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.repo.updateAccount(A, { state: "needs_login" }); // nothing runs → every wait would last the full 30 s
    rig = await makeApi(h);
    const id = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT } })).json.jobs[0].id;
    await Promise.all(Array.from({ length: API_WAITS_PER_KEY }, () => abandonedGet(rig!.port, `/v1/jobs/${id}?wait=30`, rig!.gen, 200)));
    await new Promise((r) => setTimeout(r, 100));
    const next = await rig.req("GET", `/v1/jobs/${id}?wait=1`, { token: rig.gen });
    expect(next.status).toBe(200);
    expect(next.json.status).toBe("queued");
  });

  it("a wait the client keeps open still lasts until the timeout (not cut short when the request body ends)", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.repo.updateAccount(A, { state: "needs_login" });
    rig = await makeApi(h);
    const id = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT } })).json.jobs[0].id;
    const r = await rig.req("GET", `/v1/jobs/${id}?wait=2`, { token: rig.gen });
    expect(r.ms).toBeGreaterThanOrEqual(1900);
  });
});

describe("R27 idempotency: a retry gets the original body", () => {
  it("same Idempotency-Key after the job finished → identical 202 body (status queued), Idempotent-Replayed, still 1 job", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const first = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT }, headers: { "idempotency-key": "retry 001" } });
    expect(first.status).toBe(202);
    await settle(h);
    const now = await rig.req("GET", `/v1/jobs/${first.json.jobs[0].id}`, { token: rig.gen });
    expect(now.json.status).toBe("succeeded");
    const again = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT }, headers: { "idempotency-key": "retry 001" } });
    expect(again.status).toBe(202);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.toString()).toBe(first.body.toString());
    expect(again.headers.location).toBe(first.headers.location);
    expect(h.repo.queryJobs({}).total).toBe(1);
  });

  it("MCP muse_generate retried with the same request_id and the same base64 picture → replayed, no second upload", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const img = Buffer.from(fixtureMedia("image", 1)).toString("base64");
    const call = (id: number) =>
      mcpPost(rig!, { jsonrpc: "2.0", id, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: "đổi nền thành biển", reference_image_base64: img, request_id: "agent-req-7" } } }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    const first = await call(1);
    expect(first.json.result.isError).toBe(false);
    const jobId = first.json.result.structuredContent.jobs[0].id;
    // More retries than the upload bucket allows (burst 5): none may fail, none may upload again.
    for (let i = 2; i < 2 + API_BUCKETS.upload.capacity + 2; i++) {
      const r = await call(i);
      expect(r.json.result.isError).toBe(false);
      expect(r.json.result.structuredContent.replayed).toBe(true);
      expect(r.json.result.structuredContent.jobs[0].id).toBe(jobId);
    }
    expect(h.repo.queryJobs({}).total).toBe(1);
  });
});

describe("R28 MCP: one rate-limit token per request", () => {
  it(`tools/list costs exactly one read token: ${API_BUCKETS.read.capacity} calls pass, the next is 429`, async () => {
    h = makeHarness();
    rig = await makeApi(h); // the test clock is frozen → no refill
    const list = (id: number) => mcpPost(rig!, { jsonrpc: "2.0", id, method: "tools/list" }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    for (let i = 0; i < API_BUCKETS.read.capacity; i++) expect((await list(i)).status).toBe(200);
    const over = await list(999);
    expect(over.status).toBe(429);
    expect(Number(over.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });
});

describe("MCP message validation", () => {
  const modernHeaders = (method: string) => ({ "mcp-protocol-version": "2026-07-28", "mcp-method": method });

  it("modern notification with a header that does not match → 400 -32020; a matching one → 202 with no body", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const note = { jsonrpc: "2.0", method: "notifications/cancelled", params: { _meta: modernMeta(), requestId: 1 } };
    const bad = await mcpPost(rig, note, { headers: modernHeaders("notifications/progress") });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe(-32020);
    const ok = await mcpPost(rig, note, { headers: modernHeaders("notifications/cancelled") });
    expect(ok.status).toBe(202);
    expect(ok.body.length).toBe(0);
  });

  it('{"jsonrpc":"2.0"} alone → 400 -32600; a legacy client response → 202; a modern client response → 400', async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const empty = await mcpPost(rig, { jsonrpc: "2.0" });
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe(-32600);
    const both = await mcpPost(rig, { jsonrpc: "2.0", id: 1, result: {}, error: { code: 1, message: "x" } });
    expect(both.status).toBe(400);
    const legacyResponse = await mcpPost(rig, { jsonrpc: "2.0", id: 1, result: {} }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(legacyResponse.status).toBe(202);
    const modernResponse = await mcpPost(rig, { jsonrpc: "2.0", id: 1, result: {} }, { headers: { "mcp-protocol-version": "2026-07-28" } });
    expect(modernResponse.status).toBe(400);
    expect(modernResponse.json.error.code).toBe(-32600);
  });
});

describe("MCP 2025-03-26 batches", () => {
  it("batch without version header (2025-03-26) → one reply per request, notifications skipped; batches refused for 2025-06-18 and for initialize", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ];
    const r = await mcpPost(rig, batch);
    expect(r.status).toBe(200);
    expect(r.json.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    expect(r.json[1].result.tools).toHaveLength(8); // Build 2.0 R110: + muse_chat
    const newer = await mcpPost(rig, batch, { headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(newer.status).toBe(400);
    const init = await mcpPost(rig, [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }]);
    expect(init.status).toBe(400);
    const notesOnly = await mcpPost(rig, [{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(notesOnly.status).toBe(202);
  });
});

describe("R31 request log records MCP error codes", () => {
  it("read key calling muse_generate → log row for POST /mcp has code insufficient_scope; unknown method → method_not_found", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const r = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: PROMPT } } }, { token: rig.read, headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(r.json.result.isError).toBe(true);
    await mcpPost(rig, { jsonrpc: "2.0", id: 2, method: "prompts/list" }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    await new Promise((res) => setTimeout(res, 50));
    const codes = rig.api.requestLog(10).filter((l) => l.route === "/mcp").map((l) => l.code);
    expect(codes).toContain("insufficient_scope");
    expect(codes).toContain("method_not_found");
  });
});
