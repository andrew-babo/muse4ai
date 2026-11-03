import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { API_BUCKETS } from "../src/shared/api/constants";
import { makeApi, mcpPost, type ApiRig, type Res } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Spec rev 6 R53 — Vibes and Kéo dài through REST and MCP (AC-EXT-15, -16, -17 API part, -18).

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

const VCAPS = { "vibes.video.text": true, "vibes.video.reference": true, "vibes.video.extend": true };

async function setup(vibesCfg?: Parameters<typeof makeHarness>[0] extends infer O ? (O extends { vibesCfg?: infer V } ? V : never) : never) {
  h = makeHarness({ vibesCfg });
  const [A] = await seedAccounts(h, ["Mây"]);
  h.coord.testSetVerified(VCAPS);
  await h.coord.checkVibes(A);
  rig = await makeApi(h);
  return A;
}

async function stepClock(n: number) {
  for (let i = 0; i < n; i++) {
    h.clock.t += 6_000;
    await settle(h, 6);
  }
}

/** One finished job of this key → its first output. */
async function makeVideo(body: Record<string, unknown>, token = rig!.gen) {
  const r = await rig!.req("POST", "/v1/jobs", { token, json: { kind: "video", prompt: "sóng biển", ...body } });
  expect(r.status).toBe(202);
  await stepClock(1);
  const j = await rig!.req("GET", `/v1/jobs/${r.json.jobs[0].id}`, { token });
  expect(j.json.status).toBe("succeeded");
  return j.json;
}

const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;

describe("AC-EXT-15 REST: key × source × scope", () => {
  it("Vibes video, extend with idempotency, scoping errors, wait until completed, download matches", async () => {
    await setup();
    const responses: Res[] = [];
    const call = async (m: string, p: string, o: Parameters<ApiRig["req"]>[2] = {}) => {
      const r = await rig!.req(m, p, { token: rig!.gen, ...o });
      responses.push(r);
      return r;
    };

    const img = await call("POST", "/v1/jobs", { json: { kind: "image", site: "vibes", prompt: "ảnh" } });
    expect(img.status).toBe(400);
    expect(img.json.code).toBe("capability_unavailable");
    expect(h.repo.queryJobs({}).total).toBe(0);

    const vid = await makeVideo({ site: "vibes" });
    expect(vid).toMatchObject({ site: "vibes", operation: "generate", chain_id: null, step: null });
    const asset = vid.outputs[0].asset_id as string;

    const e1 = await call("POST", `/v1/assets/${asset}/extend`, { json: { mode: "auto", times: 2 }, headers: { "idempotency-key": "e-1" } });
    expect(e1.status).toBe(202);
    expect(e1.headers.location).toBe(`/v1/extend-chains/${e1.json.chain.id}`);
    expect(e1.json.chain).toMatchObject({ status: "running", plan: { times: 2 }, steps_done: 0, source_asset_id: asset, account: "Mây" });
    expect(e1.json.jobs[0]).toMatchObject({ site: "vibes", operation: "extend", source_asset_id: asset, chain_id: e1.json.chain.id, step: 1 });
    const e2 = await call("POST", `/v1/assets/${asset}/extend`, { json: { mode: "auto", times: 2 }, headers: { "idempotency-key": "e-1" } });
    expect(e2.status).toBe(202);
    expect(e2.headers["idempotent-replayed"]).toBe("true");
    expect(e2.json).toEqual(e1.json);
    expect(h.repo.listChains()).toHaveLength(1);
    const e3 = await call("POST", `/v1/assets/${asset}/extend`, { json: { mode: "auto", times: 3 }, headers: { "idempotency-key": "e-1" } });
    expect(e3.status).toBe(422);
    expect(e3.json.code).toBe("idempotency_conflict");

    const keyB = rig!.api.createKey("Khoá B", "generate").token;
    const b = await call("POST", `/v1/assets/${asset}/extend`, { token: keyB, json: {} });
    expect(b.status).toBe(404);
    const ro = await call("POST", `/v1/assets/${asset}/extend`, { token: rig!.read, json: {} });
    expect(ro.status).toBe(403);
    expect(ro.json.code).toBe("insufficient_scope");
    const bad = await call("POST", `/v1/assets/${asset}/extend`, { json: { mode: "directive", directive: "   " } });
    expect(bad.status).toBe(400);
    const both = await call("POST", `/v1/assets/${asset}/extend`, { json: { times: 2, target_seconds: 30 } });
    expect(both.status).toBe(400);
    const tooMany = await call("POST", `/v1/assets/${asset}/extend`, { json: { times: 21 } });
    expect(tooMany.status).toBe(400);

    // Studio asset (not created by a key) and a Muse asset of this key
    const [studioJob] = h.coord.createJobs({ kind: "video", mode: "text", prompt: "studio", referenceIds: [], accountPref: "auto", repeat: 1, clientRequestId: "studio-1", site: "vibes" });
    const muse = await makeVideo({});
    await stepClock(1);
    const studioAsset = h.repo.assetsForJob(studioJob)[0]?.id ?? "missing";
    const st = await call("POST", `/v1/assets/${studioAsset}/extend`, { json: {} });
    expect(st.status).toBe(404);
    const mu = await call("POST", `/v1/assets/${muse.outputs[0].asset_id}/extend`, { json: {} });
    expect(mu.status).toBe(409);
    expect(mu.json.code).toBe("source_not_extendable");
    expect(mu.json.detail).toBe("Video này chưa có nguồn hội thoại Muse — video tạo trước bản này hoặc một lượt Muse trả nhiều video; tạo video mới để kéo dài");

    // Wait: drive the chain while a long-poll is open; it returns at the change.
    const chainId = e1.json.chain.id as string;
    for (let i = 0; i < 6 && h.repo.getChain(chainId)!.stepsDone < 1; i++) await stepClock(1);
    expect(h.repo.getChain(chainId)!.stepsDone).toBe(1);
    const waiting = call("GET", `/v1/extend-chains/${chainId}?wait=30`);
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 6 && h.repo.getChain(chainId)!.status === "running"; i++) await stepClock(1);
    const done = await waiting;
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ status: "completed", stop_reason: "Đã kéo dài 2 lần", steps_done: 2 });
    expect(done.json.steps.map((s: { step: number; status: string; duration_ms: number }) => [s.step, s.status, s.duration_ms])).toEqual([
      [1, "succeeded", 10_000],
      [2, "succeeded", 15_000],
    ]);
    const latest = done.json.latest_output;
    expect(latest.duration_ms).toBe(15_000);
    const file = await rig!.req("GET", pathOf(latest.download_url), { token: null });
    expect(file.status).toBe(200);
    expect(createHash("sha256").update(file.body).digest("hex")).toBe(latest.sha256);

    // Cancel a finished chain → 409; the job list shows the steps with their chain
    const cancel = await call("POST", `/v1/extend-chains/${chainId}/cancel`);
    expect(cancel.status).toBe(409);
    expect(cancel.json.code).toBe("chain_not_cancellable");
    const other = await call("GET", `/v1/extend-chains/${chainId}`, { token: keyB });
    expect(other.status).toBe(404);

    // R52: no remote id of Vibes in any answer
    const remote = h.vibes.get(h.repo.listAccounts()[0].id)!.sent.flatMap((s) => [s.batchId, s.sourceContentId ?? "batch-none"]);
    const text = responses.map((r) => r.body.toString("utf8")).join("\n");
    for (const id of remote) expect(text).not.toContain(id);
    expect(text).not.toContain("token=t");
    expect(text).not.toContain("hdl-");
  });

  it("a chain of this key can be stopped through the API (R47)", async () => {
    const A = await setup();
    const vid = await makeVideo({ site: "vibes" });
    h.repo.updateVibes(A, { status: "needs_login" }); // chain waits on its owner
    const e = await rig!.req("POST", `/v1/assets/${vid.outputs[0].asset_id}/extend`, { token: rig!.gen, json: { times: 3 } });
    expect(e.status).toBe(202);
    const c = await rig!.req("POST", `/v1/extend-chains/${e.json.chain.id}/cancel`, { token: rig!.gen });
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ status: "cancelled", stop_reason: "Anh đã dừng chuỗi" });
    expect(c.json.steps[0].status).toBe("cancelled");
  });
});

describe("AC-EXT-16 MCP", () => {
  const call = (name: string, args: Record<string, unknown>, token?: string) =>
    mcpPost(rig!, { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }, { token, headers: { "mcp-protocol-version": "2025-11-25" } });

  it("read key gets insufficient_scope with no chain; the 11th create-type call is rate limited", async () => {
    await setup();
    const ro = await call("muse_extend_video", { asset_id: "x" }, rig!.read);
    expect(ro.json.result.isError).toBe(true);
    expect(ro.json.result.content[0].text).toMatch(/^insufficient_scope:/);
    expect(h.repo.listChains()).toHaveLength(0);
    for (let i = 0; i < API_BUCKETS.create.capacity; i++) {
      const r = await call("muse_generate", { kind: "video", site: "vibes", prompt: `sóng ${i}`, request_id: `r-${i}` });
      expect(r.json.result.isError).toBe(false);
    }
    const eleventh = await call("muse_extend_video", { asset_id: "x" });
    expect(eleventh.json.result.isError).toBe(true);
    expect(eleventh.json.result.content[0].text).toMatch(/^rate_limited:/);
  });

  it("muse_generate site=vibes → muse_extend_video waits until the chain stops → muse_get_extend", async () => {
    await setup();
    const g = await call("muse_generate", { kind: "video", site: "vibes", prompt: "mèo", request_id: "g-1" });
    const jobId = g.json.result.structuredContent.jobs[0].id as string;
    await stepClock(1);
    const job = await call("muse_get_job", { job_id: jobId });
    const asset = job.json.result.structuredContent.job.outputs[0].asset_id as string;
    const pending = call("muse_extend_video", { asset_id: asset, mode: "directive", directive: "máy quay lùi xa", times: 1, request_id: "x-1", wait_seconds: 20 });
    await new Promise((r) => setTimeout(r, 50));
    await stepClock(2);
    const r = await pending;
    expect(r.json.result.isError).toBe(false);
    const chain = r.json.result.structuredContent.chain;
    expect(chain).toMatchObject({ status: "completed", mode: "directive", directive: "máy quay lùi xa", steps_done: 1 });
    const again = await call("muse_get_extend", { chain_id: chain.id });
    expect(again.json.result.structuredContent.chain.latest_output.duration_ms).toBe(10_000);
    expect(again.json.result.content[0].text).toContain(`chain ${chain.id}: completed`);
  });
});

describe("AC-EXT-18 discovery", () => {
  it("current discovery offers Muse only while legacy fixture status stays readable", async () => {
    await setup();
    const doc = await rig!.req("GET", "/v1/openapi.json", { token: null });
    const paths = Object.keys(doc.json.paths);
    expect(paths).toEqual(expect.arrayContaining(["/v1/assets/{id}/extend", "/v1/extend-chains/{id}", "/v1/extend-chains/{id}/cancel"]));
    expect(doc.json.components.schemas.CreateJob.properties.site.enum).toEqual(["muse"]);
    expect(JSON.stringify(doc.json)).toContain("not guaranteed");
    const st = await rig!.req("GET", "/v1/status", { token: rig!.read });
    expect(st.json.sites.vibes).toMatchObject({ total: 1, ready: 1 });
    expect(st.json.capabilities["vibes.video.extend"]).toBe(true);
    const list = await mcpPost(rig!, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { headers: { "mcp-protocol-version": "2025-11-25" } });
    const ext = list.json.result.tools.find((t: { name: string }) => t.name === "muse_extend_video");
    expect(ext.inputSchema.properties.times.maximum).toBe(6);
    expect(ext.description).toContain("NOT guaranteed");
  });
});
