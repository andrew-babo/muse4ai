import { afterEach, describe, expect, it } from "vitest";
import type { FakeConfig } from "../src/main/adapter/fake";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Spec rev 7.1 R65 — an agent continues a Muse video by the app-issued conversation id it kept (AC-MEX-21…24),
// plus R64 (PROVIDER_ERROR) through the whole stack. Real coordinator + SQLite + REST/MCP, fake Muse page.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

type MuseCfg = NonNullable<FakeConfig["museExtend"]>;

async function setup(muse: MuseCfg = {}) {
  h = makeHarness({ cfg: () => ({ museExtend: muse }) });
  const [A] = await seedAccounts(h, ["Mây"]);
  h.coord.testSetVerified({ "muse.video.extend": true });
  rig = await makeApi(h);
  return { A, muse };
}

async function stepClock(n: number) {
  for (let i = 0; i < n; i++) {
    h.clock.t += 6_000;
    await settle(h, 6);
  }
}

async function museVideo(token = rig!.gen) {
  const r = await rig!.req("POST", "/v1/jobs", { token, json: { kind: "video", prompt: "thuyền giấy trôi trên suối" } });
  expect(r.status).toBe(202);
  await stepClock(1);
  const j = await rig!.req("GET", `/v1/jobs/${r.json.jobs[0].id}`, { token });
  expect(j.json.status).toBe("succeeded");
  return j.json.outputs[0] as { asset_id: string; conversation_id: string; duration_ms: number };
}

async function untilSettled(chainId: string, token = rig!.gen) {
  for (let i = 0; i < 12; i++) {
    const c = await rig!.req("GET", `/v1/extend-chains/${chainId}`, { token });
    if (["completed", "stopped", "cancelled", "needs_review"].includes(c.json.status)) return c.json;
    await stepClock(1);
  }
  return (await rig!.req("GET", `/v1/extend-chains/${chainId}`, { token })).json;
}

const tool = (name: string, args: Record<string, unknown>, token = rig!.gen) =>
  mcpPost(rig!, { jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } }, { token, headers: { "mcp-protocol-version": "2025-11-25" } });

describe("AC-MEX-21: Muse outputs carry an opaque conversation id; private locators never leave", () => {
  it("video output → mc_ handle; GET conversation shows the head; no thread path or sandbox path anywhere", async () => {
    await setup();
    const v = await museVideo();
    expect(v.conversation_id).toMatch(/^mc_[0-9a-f-]{36}$/);
    const c = await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen });
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ conversation_id: v.conversation_id, site: "muse", status: "ready", can_extend: true, active_chain_id: null, latest_output: { asset_id: v.asset_id, conversation_id: v.conversation_id } });
    const img = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "image", prompt: "ảnh" } });
    await stepClock(1);
    const ij = await rig!.req("GET", `/v1/jobs/${img.json.jobs[0].id}`, { token: rig!.gen });
    expect(ij.json.outputs[0].conversation_id).toBeNull();
    for (const body of [c.body.toString(), JSON.stringify(ij.json)]) expect(body).not.toMatch(/\/thread\/|sandbox:\/\//);
  });
});

describe("AC-MEX-22: extend by conversation id — cumulative chain, replay after the head moved, conflicts", () => {
  it("times 2 → 20 s then 30 s from the same conversation; replay returns the same chain; the old asset is no longer the head", async () => {
    const { muse } = await setup();
    const v = await museVideo();
    const e1 = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: { times: 2 }, headers: { "idempotency-key": "conv-1" } });
    expect(e1.status).toBe(202);
    expect(e1.headers.location).toBe(`/v1/extend-chains/${e1.json.chain.id}`);
    expect(e1.json.chain).toMatchObject({ site: "muse", conversation_id: v.conversation_id, source_asset_id: v.asset_id, plan: { times: 2 }, max_steps: 6 });
    const done = await untilSettled(e1.json.chain.id);
    expect(done.status).toBe("completed");
    expect(done.steps.map((s: { duration_ms: number }) => s.duration_ms)).toEqual([20_000, 30_000]);
    expect(done.latest_output.conversation_id).toBe(v.conversation_id);
    // Step 2 continued step 1's cumulative file inside the same conversation (never the original again).
    expect(muse.sent).toHaveLength(2);
    expect(new Set(muse.sent!.map((s) => s.conversation)).size).toBe(1);
    expect(muse.sent![1].output).not.toBe(muse.sent![0].output);

    const replay = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: { times: 2 }, headers: { "idempotency-key": "conv-1" } });
    expect(replay.status).toBe(202);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json.chain.id).toBe(e1.json.chain.id);
    expect(h.repo.listChains()).toHaveLength(1);
    const conflict = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: { times: 1 }, headers: { "idempotency-key": "conv-1" } });
    expect(conflict.status).toBe(422);
    expect(conflict.json.code).toBe("idempotency_conflict");

    const head = await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen });
    expect(head.json.latest_output.asset_id).toBe(done.latest_output.asset_id);
    const oldAsset = await rig!.req("POST", `/v1/assets/${v.asset_id}/extend`, { token: rig!.gen, json: {} });
    expect(oldAsset.status).toBe(409);
    expect(oldAsset.json.code).toBe("source_not_extendable");
    const next = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {} });
    expect(next.status).toBe(202);
    expect(next.json.chain.source_asset_id).toBe(done.latest_output.asset_id);
  });

  it("Muse limits: times ≤ 6, target ≤ 60 s and longer than the head", async () => {
    await setup();
    const v = await museVideo();
    const post = (json: unknown) => rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json });
    expect((await post({ times: 7 })).status).toBe(400);
    expect((await post({ target_seconds: 70 })).status).toBe(400);
    expect((await post({ target_seconds: 10 })).status).toBe(400);
    expect((await post({ times: 2, target_seconds: 30 })).status).toBe(400);
    expect(h.repo.listChains()).toHaveLength(0);
  });
});

describe("AC-MEX-23: possessing an id is not authorization", () => {
  it("other key, read key, Studio-made head, unknown and malformed ids are the same 404; read key cannot create", async () => {
    await setup();
    const v = await museVideo();
    const keyB = rig!.api.createKey("Khoá B", "generate").token;
    const ids = [v.conversation_id, "mc_00000000-0000-0000-0000-000000000000", "abc", "%2Fthread%2Fx"];
    const bodies = new Set<string>();
    for (const id of ids.slice(1)) {
      const r = await rig!.req("GET", `/v1/conversations/${id}`, { token: rig!.gen });
      expect(r.status).toBe(404);
      bodies.add(`${r.json.code}|${r.json.detail}`);
    }
    for (const token of [keyB]) {
      const g = await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token });
      const p = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token, json: {} });
      expect([g.status, p.status]).toEqual([404, 404]);
      bodies.add(`${g.json.code}|${g.json.detail}`);
      bodies.add(`${p.json.code}|${p.json.detail}`);
    }
    expect(bodies.size).toBe(1);
    const ro = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.read, json: {} });
    expect(ro.status).toBe(403);
    expect(ro.json.code).toBe("insufficient_scope");
    // The user extends the agent's video in the Studio: the new head belongs to the Studio, so the agent sees 404.
    h.coord.startExtend({ assetId: v.asset_id, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "studio-1" });
    await stepClock(3);
    expect((await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen })).status).toBe(404);
    expect(h.repo.listChains().filter((c) => c.apiKeyId)).toHaveLength(0);
  });
});

describe("AC-MEX-24: busy conversations and MCP selector", () => {
  it("an open chain makes the conversation busy (409, no second chain); the owner sees its chain id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await setup({ gate });
    const v = await museVideo();
    const e1 = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {} });
    expect(e1.status).toBe(202);
    // The step is held inside observeExtend: drive the scheduler without waiting for idle.
    for (let i = 0; i < 10 && h.repo.getJob(e1.json.jobs[0].id)!.state !== "generating"; i++) {
      h.clock.t += 6_000;
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(h.repo.getJob(e1.json.jobs[0].id)!.state).toBe("generating");
    const busy = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {}, headers: { "idempotency-key": "other" } });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe("conversation_busy");
    const g = await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen });
    expect(g.json).toMatchObject({ status: "busy", can_extend: false, active_chain_id: e1.json.chain.id });
    expect(h.repo.listChains()).toHaveLength(1);
    release();
    const done = await untilSettled(e1.json.chain.id);
    expect(done.status).toBe("completed");
    expect((await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen })).json.status).toBe("ready");
  });

  it("muse_extend_video takes exactly one of asset_id / conversation_id", async () => {
    await setup();
    const v = await museVideo();
    const both = await tool("muse_extend_video", { asset_id: v.asset_id, conversation_id: v.conversation_id });
    expect(both.json.result.isError).toBe(true);
    expect(both.json.result.content[0].text).toMatch(/^invalid_request:/);
    const none = await tool("muse_extend_video", {});
    expect(none.json.result.isError).toBe(true);
    const ok = await tool("muse_extend_video", { conversation_id: v.conversation_id, request_id: "m-1", times: 1 });
    expect(ok.json.result.isError).toBe(false);
    const chain = ok.json.result.structuredContent.chain;
    expect(chain).toMatchObject({ site: "muse", conversation_id: v.conversation_id });
    const again = await tool("muse_extend_video", { conversation_id: v.conversation_id, request_id: "m-1", times: 1 });
    expect(again.json.result.structuredContent.chain.id).toBe(chain.id);
    expect(again.json.result.structuredContent.replayed).toBe(true);
  });
});

describe("AC-CHAT-09 ca 2: Hỏi đáp on a video conversation that has an extend chain", () => {
  it("open chain → 409 conversation_busy (no chat job); after it ends → 422 capability_unavailable; another key → 404", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await setup({ gate });
    const v = await museVideo();
    const e1 = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {} });
    expect(e1.status).toBe(202);
    for (let i = 0; i < 10 && h.repo.getJob(e1.json.jobs[0].id)!.state !== "generating"; i++) {
      h.clock.t += 6_000;
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 20));
    }
    const chatJobs = () => (h.repo.db.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='chat'").get() as { n: number }).n;
    const busy = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Video này có mấy cảnh?", conversation_id: v.conversation_id } });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe("conversation_busy");
    const k2 = rig!.api.createKey("K2", "generate");
    const foreign = await rig!.req("POST", "/v1/jobs", { token: k2.token, json: { kind: "chat", prompt: "x", conversation_id: v.conversation_id } });
    expect(foreign.status).toBe(404);
    expect(chatJobs()).toBe(0);
    release();
    expect((await untilSettled(e1.json.chain.id)).status).toBe("completed");
    const after = await rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "chat", prompt: "Video này có mấy cảnh?", conversation_id: v.conversation_id } });
    expect(after.status).toBe(422);
    expect(after.json.code).toBe("capability_unavailable");
  });
});

describe("R57/R58: an unclear send keeps the conversation reserved until the user decides", () => {
  it("lost acknowledgement → needs_review, conversation needs_review/busy (409); dismiss in the app frees it; nothing resent", async () => {
    const { muse } = await setup({ script: ["ambiguous_after_send"] });
    const v = await museVideo();
    const e = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {} });
    const chain = await untilSettled(e.json.chain.id);
    expect(chain.status).toBe("needs_review");
    const g = await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen });
    expect(g.json).toMatchObject({ status: "needs_review", can_extend: false });
    const again = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: {}, headers: { "idempotency-key": "after-review" } });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("conversation_busy");
    expect(muse.sent).toHaveLength(1);
    h.coord.resolveReview(chain.steps[0].job_id, "dismiss");
    await stepClock(1);
    expect((await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen })).json.status).toBe("ready");
    expect(muse.sent).toHaveLength(1);
  });
});

describe("R64 through the stack: Muse's technical failure is PROVIDER_ERROR, never resent", () => {
  it("a continuation that Muse reports as upstream 502 fails the step, stops the chain and frees the conversation", async () => {
    const { muse } = await setup({ script: ["provider_error"] });
    const v = await museVideo();
    const e = await rig!.req("POST", `/v1/conversations/${v.conversation_id}/extend`, { token: rig!.gen, json: { times: 2 } });
    const done = await untilSettled(e.json.chain.id);
    expect(done.status).toBe("stopped");
    expect(done.stop_reason).toContain("Muse gặp lỗi kỹ thuật");
    const step = await rig!.req("GET", `/v1/jobs/${done.steps[0].job_id}`, { token: rig!.gen });
    expect(step.json.error.code).toBe("PROVIDER_ERROR");
    expect(muse.sent).toHaveLength(1);
    expect(h.repo.listAccounts()[0].state).toBe("ready");
    expect((await rig!.req("GET", `/v1/conversations/${v.conversation_id}`, { token: rig!.gen })).json.status).toBe("ready");
  });
});
