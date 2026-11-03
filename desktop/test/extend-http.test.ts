import { afterEach, describe, expect, it } from "vitest";
import type { FakeReply } from "../src/main/adapter/fakeGateway";
import { fakeVibesMp4 } from "../src/main/adapter/vibes/fake";
import { sourceInHistory } from "../src/main/httpRunner";
import type { GwHistory, GwTurn } from "../src/shared/gateway/events";
import { museSandboxLocator } from "../src/shared/museExtend";
import { anyPathSupports, jobNeeds } from "../src/shared/pathCapability";
import { makeApi, type ApiRig } from "./apiHelpers";
import { job, makeHarness, seedAccounts, textJob, type Harness } from "./helpers";

// Extend for videos made over HTTP (roadmap "Kéo dài video cho mọi đường chạy"): the video keeps its `gw:` Muse
// source, each step runs on the channel in that same session, never on the page; live evidence
// docs/build-3.0/evidence/extend-http-poc-2026-11-03.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

const SEC = 1_000;

/** Fake Muse on the channel: a video prompt gets a 10 s MP4; an extend step gets (turn+1)×10 s and re-attaches the source like live 03/11. */
function museReply(prompt: string, _items: unknown, turn: number): FakeReply {
  if (prompt.startsWith("Extend the exact video")) {
    const source = /sandbox:\/\/workspace\/[^\s]+\.mp4/.exec(prompt)?.[0] ?? "";
    return {
      text: "Here is the cumulative video",
      files: [
        { name: "extended.mp4", mime: "video/mp4", bytes: fakeVibesMp4((turn + 1) * 10 * SEC, turn) },
        // The source again (live: Muse attached the unchanged original next to the result).
        ...(source ? [{ name: "source-copy.mp4", mime: "video/mp4", bytes: fakeVibesMp4(turn * 10 * SEC, turn - 1) }] : []),
      ],
    };
  }
  if (prompt.startsWith("Generate a short video")) return { text: "Here is your video", files: [{ name: "video.mp4", mime: "video/mp4", bytes: fakeVibesMp4(10 * SEC, 0) }] };
  return { text: `Trả lời: ${prompt.slice(0, 80)}` };
}

async function until(cond: () => boolean, ms = 6_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 10));
  }
}
const settled = (id: string) => ["completed", "failed", "needs_review", "cancelled"].includes(job(h, id).state);
const chainDone = (id: string) => ["completed", "stopped", "cancelled", "needs_review"].includes(h.repo.getChain(id)!.status);

async function httpVideo() {
  h = makeHarness({ gw: () => ({ reply: museReply }) });
  const [a] = await seedAccounts(h, ["Mây"]);
  h.coord.testSetVerified({ "muse.video.extend": true });
  const [id] = h.coord.createJobs(textJob("Một chiếc thuyền giấy trôi trên suối", { kind: "video" }));
  await until(() => settled(id));
  expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
  const [asset] = h.repo.assetsForJob(id);
  return { a, id, asset };
}

describe("HTTP-made videos keep their Muse source", () => {
  it("a 10 s HTTP video carries a gw: source on its account, can be extended, and its conversation stays a Hỏi đáp one", async () => {
    const { a, id, asset } = await httpVideo();
    expect(asset).toMatchObject({ kind: "video", durationMs: 10 * SEC, sourceStatus: "ok", sourceOwnerId: a });
    const src = h.repo.getRemoteSource(h.repo.assetRemoteSourceId(asset.id)!)!;
    expect(src.museSource?.conversation).toBe(`gw:${job(h, id).remoteSessionId}`);
    expect(src.museSource?.output).toMatch(/^sandbox:\/\/workspace\/.+\.mp4$/);
    const conv = job(h, id).conversationId!;
    expect(conv).toMatch(/^mc_[0-9a-f-]{36}$/);
    expect(h.repo.conversationMeta(conv)?.kind).toBe("chat"); // Hỏi đáp can still continue it (AC-CHAT-09)
    expect(h.repo.museConversationById(conv)?.tip).toBe(asset.id); // and it is the extendable head
  });
});

describe("Extend over HTTP runs in the source's own session", () => {
  it("AC-MEX-27: 2 steps → 20 s then 30 s, each sent once into the same gw: session with the exact source; the page is never used", async () => {
    const { a, id, asset } = await httpVideo();
    const sid = job(h, id).remoteSessionId!;
    const { chain } = h.coord.startExtend({ assetId: asset.id, mode: "auto", plan: { type: "steps", value: 2 }, clientRequestId: "x-1" });
    await until(() => chainDone(chain.id));
    expect(h.repo.getChain(chain.id)!.status).toBe("completed");
    const steps = h.repo.jobsForChain(chain.id);
    expect(steps.map((s) => [s.state, s.execPath])).toEqual([
      ["completed", "http"],
      ["completed", "http"],
    ]);
    const outs = steps.map((s) => h.repo.assetsForJob(s.id));
    expect(outs.map((o) => o.length)).toEqual([1, 1]); // the re-attached source copy is never stored
    expect(outs.map((o) => o[0].durationMs)).toEqual([20 * SEC, 30 * SEC]);
    const sent = h.gwCfg(a).sent!;
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((x) => x.sessionId))).toEqual(new Set([sid]));
    const firstSource = h.repo.getRemoteSource(h.repo.assetRemoteSourceId(asset.id)!)!.museSource!.output;
    expect(sent[1].prompt).toContain(firstSource);
    expect(sent[2].prompt).toContain(h.repo.getRemoteSource(h.repo.assetRemoteSourceId(outs[0][0].id)!)!.museSource!.output);
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0);
    // The newest step is the head; the conversation is free again.
    const conv = h.repo.museConversation(a, `gw:${sid}`)!;
    expect(conv).toMatchObject({ tip: outs[1][0].id, chain: null, unresolved: null });
  });

  it("AC-MEX-28: a source that is not in this login's session stops the step before anything is sent", async () => {
    const { a, asset } = await httpVideo();
    // Another Muse user behind the same account: the session no longer holds that file.
    const srcId = h.repo.assetRemoteSourceId(asset.id)!;
    const s = h.repo.getRemoteSource(srcId)!;
    h.repo.db.prepare("UPDATE remote_sources SET muse_source=? WHERE id=?").run(JSON.stringify({ ...s.museSource!, output: s.museSource!.output.replace(/\.mp4$/, "-other.mp4") }), srcId);
    const { chain } = h.coord.startExtend({ assetId: asset.id, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "x-2" });
    await until(() => chainDone(chain.id) || h.repo.jobsForChain(chain.id).every((j) => settled(j.id)));
    const [step] = h.repo.jobsForChain(chain.id);
    expect(step.state).toBe("failed");
    expect(step.errorMessage).toContain("Không thấy video nguồn");
    expect(h.gwCfg(a).sent).toHaveLength(1); // only the original video
  });

  it("AC-MEX-29: an account set to the page path still extends its HTTP video (over HTTP); Hỏi đáp waits while a chain holds the conversation", async () => {
    const { a, id, asset } = await httpVideo();
    h.coord.setExecution(a, { mode: "ui", maxConcurrent: 6, uiMaxConcurrent: 1 });
    const { chain } = h.coord.startExtend({ assetId: asset.id, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "x-4" });
    h.coord.setExecution(a, { mode: "auto", maxConcurrent: 6, uiMaxConcurrent: 1 }); // Hỏi đáp follows the account mode
    expect(() => h.coord.createChatJob({ prompt: "Video dài bao nhiêu giây?", referenceIds: [], accountPref: "auto", clientRequestId: "c-1", conversationId: job(h, id).conversationId })).toThrow(/đang có một lượt chưa xong/);
    await until(() => chainDone(chain.id));
    expect(h.repo.getChain(chain.id)!.status).toBe("completed");
    expect(h.repo.jobsForChain(chain.id).map((x) => x.execPath)).toEqual(["http"]);
  });
});

describe("an agent reads an HTTP video conversation over the API", () => {
  async function pumped<T>(p: Promise<T>): Promise<T> {
    let done = false;
    p.finally(() => (done = true)).catch(() => {});
    while (!done) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 10));
    }
    return p;
  }

  it("AC-MEX-31: GET /v1/conversations/{id} lists the video, the extend step and the new head; busy while the chain runs", async () => {
    h = makeHarness({ gw: () => ({ reply: museReply }) });
    await seedAccounts(h, ["Mây"]);
    h.coord.testSetVerified({ "muse.video.extend": true });
    rig = await makeApi(h);
    const made = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "video", prompt: "Một chiếc thuyền giấy trôi trên suối" } });
    const vid = made.json.jobs[0].id as string;
    await until(() => settled(vid));
    const first = await rig.req("GET", `/v1/jobs/${vid}`, { token: rig.gen });
    const conv = first.json.outputs[0].conversation_id as string;
    expect(conv).toMatch(/^mc_/);
    const before = await rig.req("GET", `/v1/conversations/${conv}`, { token: rig.gen });
    expect(before.json).toMatchObject({ kind: "chat", busy: false, turns: [{ job_id: vid, operation: "generate", status: "succeeded" }], video: { status: "ready", can_extend: true } });
    expect(before.json.video.latest_output).toMatchObject({ asset_id: first.json.outputs[0].asset_id, duration_ms: 10 * SEC, conversation_id: conv });

    const ext = await rig.req("POST", `/v1/conversations/${conv}/extend`, { token: rig.gen, json: { mode: "auto", times: 1 } });
    expect(ext.status).toBe(202);
    const during = await rig.req("GET", `/v1/conversations/${conv}`, { token: rig.gen });
    expect(during.json).toMatchObject({ busy: true, video: { status: "busy", can_extend: false, active_chain_id: ext.json.chain.id } });
    const chain = await pumped(rig.req("GET", `/v1/extend-chains/${ext.json.chain.id}?wait=10`, { token: rig.gen }));
    expect(chain.json.status).toBe("completed");
    const after = await rig.req("GET", `/v1/conversations/${conv}`, { token: rig.gen });
    const step = ext.json.chain.steps[0].job_id as string;
    expect(after.json.turns.map((t: { job_id: string; operation: string }) => [t.job_id, t.operation])).toEqual([
      [vid, "generate"],
      [step, "extend"],
    ]);
    expect(after.json).toMatchObject({ busy: false, video: { status: "ready", can_extend: true } });
    expect(after.json.video.latest_output).toMatchObject({ duration_ms: 20 * SEC, conversation_id: conv });
    expect(JSON.stringify(after.json)).not.toMatch(/gw:|sandbox:|workspace\//); // private Muse ids never leave main
    // Another key sees nothing.
    const k2 = rig.api.createKey("K2", "generate");
    expect((await rig.req("GET", `/v1/conversations/${conv}`, { token: k2.token })).status).toBe(404);
  });
});

describe("read-only recovery of older HTTP videos", () => {
  it("AC-MEX-30: an HTTP video saved without a source gets it back from one history read, becomes the head, and nothing is sent", async () => {
    const { a, id, asset } = await httpVideo();
    const conv = job(h, id).conversationId!;
    // As on beta.25: no source, no head.
    h.repo.db.prepare("UPDATE assets SET remote_source_id=NULL WHERE id=?").run(asset.id);
    h.repo.db.prepare("UPDATE muse_conversations SET tip_asset_id=NULL WHERE id=?").run(conv);
    expect(h.repo.getAsset(asset.id)!.sourceStatus).toBeNull();
    const sentBefore = h.gwCfg(a).sent!.length;
    expect(await h.coord.recoverHttpSources()).toBe(1);
    expect(h.repo.getAsset(asset.id)).toMatchObject({ sourceStatus: "ok", sourceOwnerId: a });
    expect(h.repo.museConversationById(conv)?.tip).toBe(asset.id);
    expect(h.gwCfg(a).sent!.length).toBe(sentBefore);
    expect(await h.coord.recoverHttpSources()).toBe(0); // once per run
  });

  it("AC-MEX-30: a stored file whose size differs from Muse's copy stays without a source", async () => {
    const { asset } = await httpVideo();
    h.repo.db.prepare("UPDATE assets SET remote_source_id=NULL, bytes=bytes+1 WHERE id=?").run(asset.id);
    expect(await h.coord.recoverHttpSources()).toBe(0);
    expect(h.repo.getAsset(asset.id)!.sourceStatus).toBeNull();
  });
});

describe("pure rules", () => {
  it("only a /workspace/…mp4 path becomes a source locator", () => {
    expect(museSandboxLocator("/workspace/user/media/a b.mp4")).toBe("sandbox://workspace/user/media/a b.mp4");
    for (const bad of ["/workspace/../etc/a.mp4", "/workspace/a.mov", "/tmp/a.mp4", "/workspace//a.mp4", "/workspace/a%2e.mp4", "/workspace/a\u0000.mp4", "workspace/a.mp4"]) expect(museSandboxLocator(bad)).toBeNull();
  });

  it("the source must be the newest video of the session", () => {
    const turn = (paths: string[]): GwTurn => ({ user: { text: "x", prompt: "x" }, assistant: null, status: "completed", files: paths.map((p) => ({ path: p, mime: "video/mp4", byteLen: 1, name: null })) }) as unknown as GwTurn;
    const hist = (turns: GwTurn[]): GwHistory => ({ turns, userMsgs: turns.length }) as unknown as GwHistory;
    const A = "sandbox://workspace/a.mp4";
    expect(sourceInHistory(hist([turn(["/workspace/a.mp4"])]), A)).toBe("ok");
    expect(sourceInHistory(hist([turn(["/workspace/a.mp4"]), turn([])]), A)).toBe("ok"); // a later Hỏi đáp turn without video
    expect(sourceInHistory(hist([turn(["/workspace/a.mp4"]), turn(["/workspace/b.mp4"])]), A)).toBe("not_tip");
    expect(sourceInHistory(hist([turn(["/workspace/b.mp4"])]), A)).toBe("missing");
  });

  it("AC-MEX-29: an extend step needs the path that made its source; no cross-path fallback", () => {
    const http = jobNeeds({ kind: "video", mode: "text", operation: "extend", extendSource: "http" });
    const ui = jobNeeds({ kind: "video", mode: "text", operation: "extend", extendSource: "ui" });
    expect(anyPathSupports(http, ["http"], true)).toBe(true);
    expect(anyPathSupports(http, ["auto"], true)).toBe(true);
    expect(anyPathSupports(http, ["ui"], true)).toBe(false);
    expect(anyPathSupports(http, ["auto"], false)).toBe(false); // direct channel off
    expect(anyPathSupports(ui, ["ui"], true)).toBe(true);
    expect(anyPathSupports(ui, ["http"], true)).toBe(false);
  });
});
