import { API_BUCKETS } from "../src/shared/api/constants";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureMedia, makeApi, mcpPost, modernMeta, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, type Harness } from "./helpers";

let h: Harness;
let rig: ApiRig | null = null;
let client: Client | null = null;
afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = null;
  await rig?.close();
  rig = null;
  if (h) {
    await Promise.race([h.coord.idle(), new Promise((r) => setTimeout(r, 3000))]);
    await h.coord.stop();
    h.close();
  }
});

/** Official SDK client. `pinVersion` rewrites the initialize request, as an SDK pinned to that revision would send it. */
async function sdkClient(r: ApiRig, token: string, pinVersion?: string): Promise<{ client: Client; seen: { method: string; status: number; version: string | null }[] }> {
  const seen: { method: string; status: number; version: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    let body = init?.body;
    if (pinVersion && typeof body === "string" && body.includes('"initialize"')) {
      const j = JSON.parse(body);
      j.params.protocolVersion = pinVersion;
      body = JSON.stringify(j);
    }
    const res = await fetch(input, { ...init, body });
    const headers = new Headers(init?.headers);
    seen.push({ method: init?.method ?? "GET", status: res.status, version: headers.get("mcp-protocol-version") });
    return res;
  };
  const transport = new StreamableHTTPClientTransport(new URL(`${r.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: fetchImpl });
  const c = new Client({ name: "muse-test", version: "1.0.0" });
  await c.connect(transport);
  return { client: c, seen };
}

describe("MCP legacy era (initialize)", () => {
  it("AC-API-14 / AC-EXT-16: official SDK pinned to 2025-06-18 → 7 tools, muse_generate creates exactly 1 job, muse_get_job reads it; GET /mcp → 405", async () => {
    h = makeHarness({ cfg: () => ({ media: fixtureMedia, submitDelayMs: 0, generateDelayMs: 0 }) });
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const s = await sdkClient(rig, rig.gen, "2025-06-18");
    client = s.client;
    expect(s.client.getServerVersion()).toMatchObject({ name: "muse4ai" });
    const tools = await s.client.listTools();
    // Build 2.0 R110 adds muse_chat (8 tools with write).
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["muse_cancel_job", "muse_chat", "muse_extend_video", "muse_generate", "muse_get_extend", "muse_get_job", "muse_list_jobs", "muse_status"]);
    // After initialize the SDK sends the negotiated version on every request.
    expect(s.seen.filter((x) => x.method === "POST").slice(1).every((x) => x.version === "2025-06-18")).toBe(true);
    const gen = await s.client.callTool({ name: "muse_generate", arguments: { kind: "image", prompt: "Một tách cà phê trên bàn gỗ", request_id: "mcp-1" } });
    expect(gen.isError).toBe(false);
    const sc = gen.structuredContent as { jobs: { id: string; status: string }[] };
    expect(sc.jobs).toHaveLength(1);
    expect(h.repo.queryJobs({}).total).toBe(1);
    const again = await s.client.callTool({ name: "muse_generate", arguments: { kind: "image", prompt: "Một tách cà phê trên bàn gỗ", request_id: "mcp-1" } });
    expect((again.structuredContent as { jobs: { id: string }[] }).jobs[0].id).toBe(sc.jobs[0].id);
    expect(h.repo.queryJobs({}).total).toBe(1);
    const got = await s.client.callTool({ name: "muse_get_job", arguments: { job_id: sc.jobs[0].id, wait_seconds: 10 } });
    const job = (got.structuredContent as { job: { id: string; status: string; outputs: { download_url: string }[] } }).job;
    expect(job.id).toBe(sc.jobs[0].id);
    expect(job.status).toBe("succeeded");
    const content = got.content as { type: string; mimeType?: string; uri?: string }[];
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/jpeg")).toBe(true);
    expect(content.some((c) => c.type === "resource_link" && c.uri === job.outputs[0].download_url)).toBe(true);
    const get = await rig.req("GET", "/mcp", { token: rig.gen, headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    expect((await rig.req("DELETE", "/mcp", { token: rig.gen })).status).toBe(405);
  });

  it("official SDK at its default revision (2025-11-25) works end to end", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const s = await sdkClient(rig, rig.gen);
    client = s.client;
    const st = await s.client.callTool({ name: "muse_status", arguments: {} });
    expect(st.isError).toBe(false);
    expect((st.structuredContent as { key: { name: string } }).key.name).toBe("Agent n8n");
    expect(await s.client.ping()).toEqual({});
  });

  it("2025-03-26 clients get no structuredContent / resource_link / outputSchema", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const init = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "old", version: "1" } } });
    expect(init.json.result.protocolVersion).toBe("2025-03-26");
    expect(init.json.result.serverInfo).toEqual({ name: "muse4ai", version: "test" });
    expect((await mcpPost(rig, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await mcpPost(rig, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { headers: { "mcp-protocol-version": "2025-03-26" } });
    expect(list.json.result.tools[0]).not.toHaveProperty("outputSchema");
    const call = await mcpPost(rig, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "muse_status", arguments: {} } }, { headers: { "mcp-protocol-version": "2025-03-26" } });
    expect(call.json.result).not.toHaveProperty("structuredContent");
    expect(call.json.result.content[0].type).toBe("text");
    const unknownVer = await mcpPost(rig, { jsonrpc: "2.0", id: 4, method: "tools/list" }, { headers: { "mcp-protocol-version": "2024-01-01" } });
    expect(unknownVer.status).toBe(400);
    const future = await mcpPost(rig, { jsonrpc: "2.0", id: 5, method: "initialize", params: { protocolVersion: "2030-01-01", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    expect(future.json.result.protocolVersion).toBe("2025-11-25");
    // Batches belong to 2025-03-26 only (see api-review-fixes): refused once a newer version header is sent.
    const batch = await mcpPost(rig, [{ jsonrpc: "2.0", id: 6, method: "ping" }], { headers: { "mcp-protocol-version": "2025-11-25" } });
    expect(batch.status).toBe(400);
    expect(batch.json.error.code).toBe(-32600);
    const bad = await rig.req("POST", "/mcp", { token: rig.gen, body: "{not json", headers: { "content-type": "application/json" } });
    expect(bad.json.error.code).toBe(-32700);
  });
});

describe("MCP modern era (2026-07-28)", () => {
  const headers = (method: string, name?: string, version = "2026-07-28"): Record<string, string> => ({
    "mcp-protocol-version": version,
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
  });

  it("AC-API-15: server/discover, tools/list and tools/call with _meta + headers; header mismatch -32020; unknown version -32022", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const disc = await mcpPost(rig, { jsonrpc: "2.0", id: "d1", method: "server/discover", params: { _meta: modernMeta() } }, { headers: headers("server/discover") });
    expect(disc.status).toBe(200);
    expect(disc.json.result.resultType).toBe("complete");
    expect(disc.json.result.supportedVersions).toEqual(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
    expect(disc.json.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "muse4ai" });
    const list = await mcpPost(rig, { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: modernMeta() } }, { headers: headers("tools/list") });
    expect(list.json.result.resultType).toBe("complete");
    expect(list.json.result.tools).toHaveLength(8); // Build 2.0 R110: + muse_chat
    const call = await mcpPost(
      rig,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: "Mèo trên mái nhà", request_id: "m-1" }, _meta: modernMeta() } },
      { headers: headers("tools/call", "muse_generate") },
    );
    expect(call.json.result.resultType).toBe("complete");
    expect(call.json.result.isError).toBe(false);
    const jobId = call.json.result.structuredContent.jobs[0].id;
    const get = await mcpPost(rig, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "muse_get_job", arguments: { job_id: jobId }, _meta: modernMeta() } }, { headers: headers("tools/call", "muse_get_job") });
    expect(get.json.result.structuredContent.job.id).toBe(jobId);
    expect(h.repo.queryJobs({}).total).toBe(1);

    const mismatch = await mcpPost(rig, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "muse_status", arguments: {}, _meta: modernMeta() } }, { headers: headers("tools/call", "muse_generate") });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.error.code).toBe(-32020);
    const methodMismatch = await mcpPost(rig, { jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: modernMeta() } }, { headers: headers("tools/call") });
    expect(methodMismatch.json.error.code).toBe(-32020);
    const verMismatch = await mcpPost(rig, { jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: modernMeta() } }, { headers: { ...headers("tools/list"), "mcp-protocol-version": "2025-11-25" } });
    expect(verMismatch.json.error.code).toBe(-32020);
    const future = await mcpPost(rig, { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: modernMeta("2099-01-01") } }, { headers: headers("tools/list", undefined, "2099-01-01") });
    expect(future.status).toBe(400);
    expect(future.json.error.code).toBe(-32022);
    expect(future.json.error.data.supported).toEqual(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
    const unknown = await mcpPost(rig, { jsonrpc: "2.0", id: 9, method: "prompts/list", params: { _meta: modernMeta() } }, { headers: headers("prompts/list") }); // resources/* exist since Build 3.0 (AC-MCP-02)
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe(-32601);
    const noCaps = await mcpPost(rig, { jsonrpc: "2.0", id: 10, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }, { headers: headers("tools/list") });
    expect(noCaps.json.error.code).toBe(-32602);
    const b64 = await mcpPost(
      rig,
      { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "muse_status", arguments: {}, _meta: modernMeta() } },
      { headers: { ...headers("tools/call"), "mcp-name": `=?base64?${Buffer.from("muse_status").toString("base64")}?=` } },
    );
    expect(b64.json.result.isError).toBe(false);
  });
});

describe("MCP access control", () => {
  it("AC-API-16: no key → 401; read key sees 4 read tools and muse_generate returns isError insufficient_scope with no job", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const noKey = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } } }, { token: null });
    expect(noKey.status).toBe(401);
    // Build 3.1: the 401 also points an agent at this install's OAuth server (RFC 9728).
    expect(noKey.headers["www-authenticate"]).toContain('Bearer realm="muse4ai"');
    expect(noKey.headers["www-authenticate"]).toContain(`resource_metadata="${rig.base}/.well-known/oauth-protected-resource"`);
    const s = await sdkClient(rig, rig.read);
    client = s.client;
    const tools = await s.client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["muse_status", "muse_get_job", "muse_list_jobs", "muse_get_extend"]);
    const r = await s.client.callTool({ name: "muse_generate", arguments: { kind: "image", prompt: "x" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/^insufficient_scope:/);
    expect(h.repo.queryJobs({}).total).toBe(0);
  });

  it("MCP tool rate limit: muse_generate uses the create bucket", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const results: boolean[] = [];
    const cap = API_BUCKETS.create.capacity; // Build 2.0 R109: burst 30 (was 10)
    for (let i = 0; i <= cap; i++) {
      const r = await mcpPost(rig, { jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: `p${i}` } } });
      results.push(r.json.result.isError);
    }
    expect(results.slice(0, cap).every((x) => x === false)).toBe(true);
    expect(results[cap]).toBe(true);
    expect(h.repo.queryJobs({}).total).toBe(cap);
  });

  it("muse_generate accepts a base64 reference image and links it", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const img = Buffer.from(fixtureMedia("image", 0));
    const r = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: "đổi nền thành biển", reference_image_base64: img.toString("base64") } } }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(r.json.result.content[0].text).not.toMatch(/^[a-z_]+:/);
    expect(r.json.result.isError).toBe(false);
    const job = h.repo.getJob(r.json.result.structuredContent.jobs[0].id)!;
    expect(job.mode).toBe("reference");
    expect(job.referenceIds).toHaveLength(1);
  });
});
