import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, seedAccounts, settle, textJob, type Harness } from "./helpers";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";

let h: Harness;
let api: ApiRig | undefined;
afterEach(async () => { await api?.close(); api = undefined; h?.close(); });

describe("R115–R116 Muse-only product", () => {
  it("AC-NVB-01 logs into Muse only even when legacy Vibes is enabled", async () => {
    h = makeHarness({ museOnly: true });
    const [id] = await seedAccounts(h, ["Thử"]);
    h.repo.updateAccount(id, { state: "new" });
    h.repo.updateVibes(id, { enabled: true, identityFp: "legacy-identity", status: "ready" });
    h.coord.openLogin(id);
    await new Promise(r => setTimeout(r, 30));
    expect(h.logins).toEqual([{ accountId: id, site: "muse" }]);
    expect(h.vibes.size).toBe(0);
    expect(() => h.coord.openLogin(id, "vibes")).toThrow();
    expect(() => h.coord.setVibesEnabled(id, true)).toThrow();
    expect(() => h.coord.takeoverStart(id, "now", "vibes")).toThrow();
  });

  it("AC-NVB-02 REST and MCP reject Vibes, while Muse still completes", async () => {
    h = makeHarness({ museOnly: true });
    await seedAccounts(h, ["Thử"]);
    api = await makeApi(h);
    const rejected = await api.req("POST", "/v1/jobs", { token: api.gen, json: { kind: "video", site: "vibes", prompt: "Tổng hợp" } });
    expect([rejected.status, rejected.json.code]).toEqual([400, "capability_unavailable"]);
    const mcp = await mcpPost(api, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "video", site: "vibes", prompt: "Tổng hợp" } } });
    expect(mcp.json.result?.isError || !!mcp.json.error).toBe(true);
    expect(h.repo.queryJobs({}).total).toBe(0);
    const accepted = await api.req("POST", "/v1/jobs", { token: api.gen, json: { kind: "image", prompt: "Cốc cà phê tổng hợp" } });
    expect(accepted.status).toBe(202);
    await settle(h, 8);
    const readback = await api.req("GET", `/v1/jobs/${accepted.json.jobs[0].id}`, { token: api.gen });
    expect(readback.json.status).toBe("succeeded");
    expect(readback.json.site).toBe("muse");
    const status = await api.req("GET", "/v1/status", { token: api.gen });
    expect(status.json.sites).toBeUndefined();
  });

  it("AC-NVB-03 preserves old Vibes rows/files without scheduling them", async () => {
    h = makeHarness({ museOnly: true });
    const [id] = await seedAccounts(h, ["Thử"]);
    const old = h.repo.insertJob({ ...textJob(), site: "vibes", kind: "video", batchId: null, state: "queued", priority: 1, now: h.clock.t });
    const path = `${h.dir}/old.mp4`;
    fs.writeFileSync(path, "legacy-file");
    const asset = h.repo.insertAsset({ jobId: old.id, batchId: null, path, sha256: "old-hash", kind: "video", mime: "video/mp4", bytes: 11, width: 1, height: 1, durationMs: 1000, createdAt: h.clock.t, site: "vibes", accountAlias: "Thử", prompt: "cũ" });
    h.repo.updateVibes(id, { enabled: true, status: "ready", identityFp: "legacy-identity" });
    const before = h.repo.getAsset(asset.id);
    await settle(h, 3);
    expect(h.repo.getJob(old.id)?.state).toBe("queued");
    expect(h.repo.getAsset(asset.id)).toEqual(before);
    expect(fs.readFileSync(path, "utf8")).toBe("legacy-file");
    expect(h.repo.getAccount(id)?.vibes.hasIdentity).toBe(true);
    expect(h.vibes.size).toBe(0);
    expect(() => h.coord.startExtend({ assetId: asset.id, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "new-chain" })).toThrow();
  });
});