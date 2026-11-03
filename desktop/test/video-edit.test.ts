import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateVideoReference } from "../src/shared/validate";
import { buildMessage } from "../src/main/adapter/muse/selectors";
import { makeHarness, seedAccounts, type Harness } from "./helpers";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";

const mp4 = () => fs.readFileSync(path.join(__dirname, "fixtures/media/waves.mp4"));
describe("R77–80 MP4 video edit", () => {
  let h: Harness;
  let r: ApiRig;
  beforeEach(async () => { h = makeHarness(); await seedAccounts(h, ["A"]); r = await makeApi(h); });
  afterEach(async () => { await r.close(); h.close(); });
  it("validates transport and finite positive decoded duration without imposing a Muse duration limit", () => {
    const meta = { mime: "video/mp4", bytes: 1000, width: 1280, height: 720, durationMs: 10000 };
    expect(validateVideoReference(meta).ok).toBe(true);
    expect(validateVideoReference({ ...meta, durationMs: 300000 }).ok).toBe(true);
    for (const durationMs of [0, NaN, Infinity, null]) expect(validateVideoReference({ ...meta, durationMs }).ok).toBe(false);
    expect(validateVideoReference({ ...meta, bytes: 20 * 1024 * 1024 + 1 }).ok).toBe(false);
    expect(validateVideoReference({ ...meta, bytes: 0 }).ok).toBe(false);
  });
  it("imports MP4 with probe duration and rejects disguised HTML", async () => {
    const ref = await r.services.addReferenceBytes(mp4(), "source.mp4");
    expect(ref.mime).toBe("video/mp4"); expect(ref.durationMs).toBe(10000);
    expect(fs.readFileSync(h.repo.getRef(ref.id)?.path ?? "")).toEqual(mp4());
    await expect(r.services.addReferenceBytes(Buffer.from("<html>not video</html>"), "fake.mp4")).rejects.toThrow();
  });
  it("rejects MP4 for image or Vibes at the shared writer", async () => {
    const ref = await r.services.addReferenceBytes(mp4(), "x.mp4");
    const input = { kind: "video" as const, mode: "reference" as const, prompt: "edit", referenceIds: [ref.id], accountPref: "auto", repeat: 1, clientRequestId: "video-edit-local" };
    expect(() => h.coord.createJobs({ ...input, kind: "image" })).toThrow(/chỉ dùng/);
    expect(() => h.coord.createJobs({ ...input, site: "vibes" })).toThrow(/chỉ dùng/);
    const ids = h.coord.createJobs(input);
    expect(h.coord.createJobs(input)).toEqual(ids);
  });
  it("one MP4 plus images is one edit turn; a second MP4 in the same turn is refused", async () => {
    const v1 = await r.services.addReferenceBytes(mp4(), "a.mp4");
    const v2 = await r.services.addReferenceBytes(fs.readFileSync(path.join(__dirname, "fixtures/media/mountains.mp4")), "b.mp4");
    const img = await r.services.addReferenceBytes(fs.readFileSync(path.join(__dirname, "fixtures/media/coffee.jpg")), "hat.jpg");
    const base = { kind: "video" as const, mode: "reference" as const, prompt: "add the hat", accountPref: "auto", repeat: 1 };
    expect(h.coord.createJobs({ ...base, referenceIds: [v1.id, img.id], clientRequestId: "mix-ok" })).toHaveLength(1);
    expect(() => h.coord.createJobs({ ...base, referenceIds: [v1.id, v2.id, img.id], clientRequestId: "mix-2v" })).toThrow(/1 video/);
  });
  it("REST uploads MP4, queues and replays once, refuses changed prompt and read scope", async () => {
    const up = await r.req("POST", "/v1/references", { token: r.gen, body: mp4(), headers: { "content-type": "video/mp4" } });
    expect(up.status).toBe(201); expect(up.json.duration_ms).toBe(10000);
    const opts = { token: r.gen, json: { kind: "video", prompt: "change red to blue", reference_id: up.json.reference_id }, headers: { "idempotency-key": "edit-test" } };
    const first = await r.req("POST", "/v1/jobs", opts);
    expect(first.status).toBe(202);
    const replay = await r.req("POST", "/v1/jobs", opts);
    expect(replay.status).toBe(202); expect(replay.json).toEqual(first.json);
    expect((await r.req("POST", "/v1/jobs", { ...opts, json: { ...opts.json, prompt: "other edit" } })).status).toBe(422);
    expect((await r.req("POST", "/v1/references", { token: r.read, body: mp4(), headers: { "content-type": "video/mp4" } })).status).toBe(403);
  });
  it("MCP queues MP4 reference but refuses MP4 in the image inline field", async () => {
    const up = await r.req("POST", "/v1/references", { token: r.gen, body: mp4() });
    const call = (args: unknown) => mcpPost(r, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_generate", arguments: args } });
    const result = await call({ kind: "video", prompt: "restyle", reference_id: up.json.reference_id, request_id: "edit-mcp" });
    expect(result.json.result.isError).not.toBe(true);
    const bad = await call({ kind: "video", prompt: "restyle", reference_image_base64: mp4().toString("base64") });
    expect(bad.json.result.isError).toBe(true);
  });
  it("does not allow another API key's video asset as reference", async () => {
    const alien = await r.req("POST", "/v1/jobs", { token: r.gen, json: { kind: "video", prompt: "base" } });
    const id = alien.json.jobs[0].id;
    const asset = h.repo.insertAsset({ jobId: id, batchId: null, path: path.join(__dirname, "fixtures/media/waves.mp4"), sha256: "a".repeat(64), kind: "video", mime: "video/mp4", width: 720, height: 1280, durationMs: 10000, bytes: mp4().length, accountAlias: "A", prompt: "base", createdAt: h.clock.t });
    const own = await r.req("POST", "/v1/jobs", { token: r.gen, json: { kind: "video", prompt: "edit", reference_asset_id: asset.id } });
    expect(own.status).toBe(202);
    const other = r.api.createKey("Other", "generate").token;
    const denied = await r.req("POST", "/v1/jobs", { token: other, json: { kind: "video", prompt: "edit", reference_asset_id: asset.id } });
    expect(denied.status).toBe(400);
  });
  it("video edit prompt never asks to animate an image", () => {
    const message = buildMessage("video", "reference", "blue car", "video");
    expect(message).toContain("Edit the attached video");
    expect(message).not.toContain("first frame");
    expect(buildMessage("video", "reference", "blue car")).toContain("first frame");
  });
});