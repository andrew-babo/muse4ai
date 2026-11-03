import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/main/db";
import { API_BUCKETS, API_UNFINISHED_PER_KEY } from "../src/shared/api/constants";
import { fixtureMedia, makeApi, rawRequest, type ApiRig, FIXTURES } from "./apiHelpers";
import { job, makeHarness, seedAccounts, settle, sqlite, textJob, type Harness } from "./helpers";

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

/** One account that exists but cannot work yet, so API jobs stay `queued` while a test inspects them. */
async function idleAccount(): Promise<string> {
  const [A] = await seedAccounts(h, ["Mây"]);
  h.repo.updateAccount(A, { state: "needs_login" });
  return A;
}

const PROMPT = "Một tách cà phê trên bàn gỗ";
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

function connectable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

function nonLoopbackIPv4(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (!a.internal && a.family === "IPv4") return a.address;
  return null;
}

async function withMedia(): Promise<void> {
  h = makeHarness({ cfg: () => ({ media: fixtureMedia, generateDelayMs: 0, submitDelayMs: 0 }) });
}

describe("off by default, local only (R23)", () => {
  it("AC-API-01: a fresh install listens on no API port", async () => {
    h = makeHarness();
    rig = await makeApi(h, { enabled: false, keys: false });
    expect(rig.api.status().listening).toBe(false);
    expect(await connectable(rig.port)).toBe(false);
  });

  it("AC-API-02: enabled in 'this machine' mode → bound to 127.0.0.1 only", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const st = rig.api.status();
    expect(st.listening).toBe(true);
    expect(st.localUrl).toBe(`http://127.0.0.1:${rig.port}`);
    expect(await connectable(rig.port)).toBe(true);
    const lan = nonLoopbackIPv4();
    if (lan) expect(await connectable(rig.port, lan)).toBe(false);
  });

  it("turning the API off closes the port at once and keeps it closed", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const t0 = Date.now();
    await rig.api.setEnabled(false);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(await connectable(rig.port)).toBe(false);
    expect(h.coord.settings().apiEnabled).toBe(false);
  });

  it("port taken by another program → clear message, nothing else breaks", async () => {
    h = makeHarness();
    const blocker = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    const port = (blocker.address() as net.AddressInfo).port;
    rig = await makeApi(h, { enabled: false, keys: false });
    h.coord.setSetting("apiPort", port);
    const st = await rig.api.setEnabled(true);
    expect(st.listening).toBe(false);
    expect(st.error).toMatch(new RegExp(`^Cổng ${port} đang bị chương trình khác dùng — `));
    blocker.close();
  });

  it("busy port → offers the next free port; one click on it makes the API listen there", async () => {
    h = makeHarness();
    const a = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => a.once("listening", r));
    const port = (a.address() as net.AddressInfo).port;
    // also occupy port+1 so the suggestion must skip it
    const b = net.createServer().listen(port + 1, "127.0.0.1");
    await new Promise((r) => { b.once("listening", r); b.once("error", r); });
    const plusOneTaken = b.listening;
    rig = await makeApi(h, { enabled: false, keys: false });
    h.coord.setSetting("apiPort", port);
    const st = await rig.api.setEnabled(true);
    expect(st.listening).toBe(false);
    expect(st.suggestedPort).not.toBeNull();
    expect(st.suggestedPort!).toBeGreaterThan(port);
    if (plusOneTaken) expect(st.suggestedPort).not.toBe(port + 1);
    expect(st.error).toBe(`Cổng ${port} đang bị chương trình khác dùng — dùng cổng trống ${st.suggestedPort}`);
    const fixed = await rig.api.setPort(st.suggestedPort!);
    expect(fixed.listening).toBe(true);
    expect(fixed.error).toBeNull();
    expect(fixed.suggestedPort).toBeNull();
    expect(await connectable(st.suggestedPort!)).toBe(true);
    a.close();
    b.close();
  });
});

describe("keys (R24)", () => {
  it("AC-API-03: no key / wrong key / revoked key → 401 invalid_api_key problem+json, delayed", async () => {
    h = makeHarness();
    rig = await makeApi(h, { failDelayMs: 300 });
    const none = await rig.req("GET", "/v1/status");
    const wrong = await rig.req("GET", "/v1/status", { token: rig.gen.slice(0, -2) + "zz" });
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(none.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(none.json).toMatchObject({ status: 401, code: "invalid_api_key" });
    expect(none.json.request_id).toMatch(/^[0-9a-f]{12}$/);
    expect(none.headers["www-authenticate"]).toBe('Bearer realm="muse4ai"');
    expect(wrong.ms).toBeGreaterThanOrEqual(290);
    expect((await rig.req("GET", "/v1/status", { token: rig.gen })).status).toBe(200);
    const id = rig.api.status().keys.find((k) => k.name === "Agent n8n")!.id;
    rig.api.revokeKey(id);
    const revoked = await rig.req("GET", "/v1/status", { token: rig.gen });
    expect(revoked.status).toBe(401);
    expect(revoked.json.code).toBe("invalid_api_key");
    expect((await rig.req("GET", `/v1/status?api_key=${rig.read}`)).status).toBe(401); // never via query string
  });

  it("AC-API-04: the raw key exists only in the createKey result — not in DB, logs, request log or diagnostics", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    await rig.req("GET", "/v1/status", { token: rig.gen });
    await rig.req("GET", "/v1/status", { token: rig.gen + "x" });
    h.repo.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const dbBytes = fs.readFileSync(h.dbFile).toString("latin1");
    const secretPart = rig.gen.slice(13);
    expect(dbBytes.includes(secretPart)).toBe(false);
    expect(dbBytes.includes(rig.gen)).toBe(false);
    expect(dbBytes.includes(sha(Buffer.from(rig.gen)))).toBe(true);
    expect(h.logs.join("\n").includes(secretPart)).toBe(false);
    expect(JSON.stringify(rig.api.requestLog(200)).includes(secretPart)).toBe(false);
    const zip = rig.services.diagnosticsZip().toString("latin1");
    expect(zip.includes(secretPart)).toBe(false);
    expect(JSON.stringify(rig.api.status()).includes(secretPart)).toBe(false);
  });

  it("names are unique among active keys and at most 20 keys are active", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    expect(() => rig!.api.createKey("agent N8N", "read")).toThrow("Đã có khoá cùng tên");
    for (let i = 0; i < 18; i++) rig.api.createKey(`k${i}`, "read");
    expect(() => rig!.api.createKey("k-extra", "read")).toThrow(/Tối đa 20 khoá/);
  });
});

describe("jobs through the API (R25–R27)", () => {
  it("AC-API-05: read key → 403 and no job; generate key → 202 + Location, one queued job tagged with the key", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    const denied = await rig.req("POST", "/v1/jobs", { token: rig.read, json: { kind: "image", prompt: PROMPT } });
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe("insufficient_scope");
    expect(h.repo.queryJobs({}).total).toBe(0);
    const r = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT } });
    expect(r.status).toBe(202);
    expect(r.json.jobs).toHaveLength(1);
    expect(r.headers.location).toBe(`/v1/jobs/${r.json.jobs[0].id}`);
    expect(r.json.jobs[0]).toMatchObject({ status: "queued", state: "queued", kind: "image", mode: "text", prompt: PROMPT });
    const all = h.repo.queryJobs({});
    expect(all.total).toBe(1);
    const row = job(h, r.json.jobs[0].id);
    expect(row.state).toBe("queued");
    expect(rig.api.status().keys.find((k) => k.id === row.apiKeyId)!.name).toBe("Agent n8n");
    expect(row.priority).toBe(0); // same level as batch jobs, after Studio's single jobs (R25)
  });

  it("AC-API-06: same Idempotency-Key ×3 → same job and body; different prompt → 422; still one job", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    const send = (prompt: string) => rig!.req("POST", "/v1/jobs", { token: rig!.gen, json: { kind: "image", prompt }, headers: { "idempotency-key": "k-001" } });
    const a = await send(PROMPT);
    const b = await send(PROMPT);
    const c = await send(PROMPT);
    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]);
    expect(b.json.jobs[0].id).toBe(a.json.jobs[0].id);
    expect(c.json).toEqual(b.json);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    const d = await send(PROMPT + " khác");
    expect(d.status).toBe(422);
    expect(d.json.code).toBe("idempotency_conflict");
    expect(h.repo.queryJobs({}).total).toBe(1);
  });

  it("idempotency is scoped per API key and never collides with Studio requests", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    const other = rig.api.createKey("Agent khác", "generate").token;
    const a = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT }, headers: { "idempotency-key": "same" } });
    const b = await rig.req("POST", "/v1/jobs", { token: other, json: { kind: "image", prompt: PROMPT }, headers: { "idempotency-key": "same" } });
    expect(a.json.jobs[0].id).not.toBe(b.json.jobs[0].id);
    h.coord.createJobs(textJob(PROMPT, { clientRequestId: "same" }));
    expect(h.repo.queryJobs({}).total).toBe(3);
  });

  it("AC-API-07: 4 001 characters / repeat 5 / locked capability → 400 with the right code, no job", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const long = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "a".repeat(4001) } });
    expect(long.status).toBe(400);
    expect(long.json.code).toBe("invalid_request");
    const rep = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT, repeat: 5 } });
    expect(rep.status).toBe(400);
    expect(rep.json.code).toBe("invalid_request");
    h.coord.testSetCapabilities(A, { "video.reference": false });
    const png = fs.readFileSync(path.join(FIXTURES, "coffee.jpg"));
    const up = await rig.req("POST", "/v1/references", { token: rig.gen, body: png, headers: { "content-type": "image/jpeg" } });
    expect(up.status).toBe(201);
    const cap = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "video", prompt: PROMPT, reference_id: up.json.reference_id } });
    expect(cap.status).toBe(400);
    expect(cap.json.code).toBe("capability_unavailable");
    expect(h.repo.queryJobs({}).total).toBe(0);
  });

  it("AC-API-08: 25 MB → 413, GIF → 415, valid 1024×1024 PNG → 201; video job uses exactly that image", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const big = await rig.req("POST", "/v1/references", { token: rig.gen, body: Buffer.alloc(25 * 1024 * 1024, 1), headers: { "content-type": "image/png" } });
    expect(big.status).toBe(413);
    expect(big.json.code).toBe("upload_too_large");
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
    const g = await rig.req("POST", "/v1/references", { token: rig.gen, body: gif, headers: { "content-type": "application/octet-stream" } });
    expect(g.status).toBe(415);
    expect(g.json.code).toBe("unsupported_media_type");
    const png = await makePng(1024, 1024);
    const ok = await rig.req("POST", "/v1/references", { token: rig.gen, body: png, headers: { "content-type": "image/png" } });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ mime: "image/png", width: 1024, height: 1024, bytes: png.length, sha256: sha(png) });
    const r = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "video", prompt: "Cho ảnh chuyển động nhẹ", reference_id: ok.json.reference_id } });
    expect(r.status).toBe(202);
    const row = job(h, r.json.jobs[0].id);
    expect(row.mode).toBe("reference");
    expect(row.referenceIds).toEqual([ok.json.reference_id]);
    expect(h.repo.getRef(row.referenceIds[0])!.sha256).toBe(sha(png));
  });

  it("AC-API-09: wait returns on change; times out on the clock; outputs download with matching sha256 and Range", async () => {
    await withMedia();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.repo.updateAccount(A, { state: "needs_login" });
    rig = await makeApi(h);
    const r = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT } });
    const id = r.json.jobs[0].id;
    // No account can work → the state does not change → returns after ~2 s (shortened from 30 s for the suite).
    const idle = await rig.req("GET", `/v1/jobs/${id}?wait=2`, { token: rig.gen });
    expect(idle.status).toBe(200);
    expect(idle.json.status).toBe("queued");
    expect(idle.ms).toBeGreaterThanOrEqual(1900);
    expect(idle.ms).toBeLessThan(3000);
    // Change while waiting → returns early with the new state.
    const pending = rig.req("GET", `/v1/jobs/${id}?wait=30`, { token: rig.gen });
    await new Promise((res) => setTimeout(res, 150));
    const t0 = Date.now();
    h.repo.updateAccount(A, { state: "ready" });
    h.coord.requestSchedule();
    const changed = await pending;
    await settle(h);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(changed.json.state).not.toBe("queued");
    const done = await rig.req("GET", `/v1/jobs/${id}`, { token: rig.gen });
    expect(done.json.status).toBe("succeeded");
    expect(done.json.outputs).toHaveLength(1);
    const out = done.json.outputs[0];
    const asset = h.repo.getAsset(out.asset_id)!;
    expect(out.sha256).toBe(asset.sha256);
    const u = new URL(out.download_url);
    expect(u.origin).toBe(rig.base);
    const file = await rig.req("GET", u.pathname + u.search);
    expect(file.status).toBe(200);
    expect(sha(file.body)).toBe(asset.sha256);
    expect(file.headers.etag).toBe(`"${asset.sha256}"`);
    expect(file.headers["content-disposition"]).toMatch(/^attachment;/);
    const part = await rig.req("GET", u.pathname + u.search, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.body).toHaveLength(100);
    expect(part.headers["content-range"]).toBe(`bytes 0-99/${asset.bytes}`);
    const bad = await rig.req("GET", u.pathname + u.search, { headers: { range: `bytes=${asset.bytes + 10}-` } });
    expect(bad.status).toBe(416);
    const bearer = await rig.req("GET", `/v1/assets/${out.asset_id}/content`, { token: rig.read });
    expect(bearer.status).toBe(404); // the read key did not create this job (R26)
    const own = await rig.req("HEAD", `/v1/assets/${out.asset_id}/content`, { token: rig.gen });
    expect(own.status).toBe(200);
    expect(Number(own.headers["content-length"])).toBe(asset.bytes);
  });

  it("AC-API-10: other keys and Studio jobs are invisible (404); an edited signed link → 403", async () => {
    await withMedia();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const keyB = rig.api.createKey("Agent B", "generate").token;
    const a1 = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "A1" } })).json.jobs[0].id;
    const a2 = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "A2" } })).json.jobs[0].id;
    const [studio] = h.coord.createJobs(textJob("studio"));
    await settle(h);
    const j1 = (await rig.req("GET", `/v1/jobs/${a1}`, { token: rig.gen })).json;
    const j2 = (await rig.req("GET", `/v1/jobs/${a2}`, { token: rig.gen })).json;
    for (const [m, p] of [
      ["GET", `/v1/jobs/${a1}`],
      ["POST", `/v1/jobs/${a1}/cancel`],
      ["GET", `/v1/assets/${j1.outputs[0].asset_id}/content`],
    ] as const) {
      const r = await rig.req(m, p, { token: keyB });
      expect(r.status).toBe(404);
      expect(r.json.code).toBe("not_found");
    }
    expect((await rig.req("GET", `/v1/jobs/${studio}`, { token: rig.gen })).status).toBe(404);
    const list = await rig.req("GET", "/v1/jobs", { token: keyB });
    expect(list.json.jobs).toHaveLength(0);
    const u1 = new URL(j1.outputs[0].download_url);
    const swapped = `/v1/assets/${j2.outputs[0].asset_id}/content${u1.search}`;
    const forged = await rig.req("GET", swapped);
    expect(forged.status).toBe(403);
    expect(forged.json.code).toBe("download_expired");
    h.clock.t += 3601_000;
    const expired = await rig.req("GET", u1.pathname + u1.search);
    expect(expired.status).toBe(403);
  });

  it("AC-API-11: cancel queued → cancelled; generating → cancelled with the quota note; completed → 409", async () => {
    h = makeHarness({ cfg: () => ({ media: fixtureMedia, submitDelayMs: 0, generateDelayMs: 60_000 }) });
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const q = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "queued one" } })).json.jobs[0].id;
    const c1 = await rig.req("POST", `/v1/jobs/${q}/cancel`, { token: rig.gen });
    expect(c1.status).toBe(200);
    expect(c1.json.status).toBe("cancelled");
    const g = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "generating one" } })).json.jobs[0].id;
    for (let i = 0; i < 200 && job(h, g).state !== "generating"; i++) await new Promise((res) => setTimeout(res, 20));
    expect(job(h, g).state).toBe("generating");
    const c2 = await rig.req("POST", `/v1/jobs/${g}/cancel`, { token: rig.gen });
    expect(c2.json.status).toBe("cancelled");
    expect(c2.json.note).toBe("Đã ngừng chờ trên máy — Muse có thể vẫn tạo và tính hạn mức");
    h.repo.updateJob(q, { state: "completed" }, h.clock.t);
    const c3 = await rig.req("POST", `/v1/jobs/${q}/cancel`, { token: rig.gen });
    expect(c3.status).toBe(409);
    expect(c3.json.code).toBe("job_not_cancellable");
    const ro = await rig.req("POST", `/v1/jobs/${g}/cancel`, { token: rig.read });
    expect(ro.status).toBe(403);
  });

  it("AC-API-12 / AC-AGT-07: frozen clock → create beyond the burst (30) is 429 with Retry-After; at 400 unfinished → 429 queue_full; nothing extra created", async () => {
    h = makeHarness(); // no account → every job stays unfinished
    rig = await makeApi(h);
    const cap = API_BUCKETS.create.capacity;
    expect(cap).toBe(30);
    expect(API_UNFINISHED_PER_KEY).toBe(400);
    const codes: number[] = [];
    let last = null as Awaited<ReturnType<ApiRig["req"]>> | null;
    for (let i = 0; i <= cap; i++) {
      last = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: `p${i}` } });
      codes.push(last.status);
    }
    expect(codes.slice(0, cap).every((c) => c === 202)).toBe(true);
    expect(codes[cap]).toBe(429);
    expect(last!.json.code).toBe("rate_limited");
    expect(Number(last!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(h.repo.queryJobs({}).total).toBe(cap);
    // Fill the key up to the unfinished cap, then try again after the bucket refilled.
    const keyId = h.repo.getJob(h.repo.queryJobs({}).items[0].id)!.apiKeyId!;
    for (let i = cap; i < API_UNFINISHED_PER_KEY; i++) {
      h.repo.insertJob({ batchId: null, kind: "image", mode: "text", prompt: `seed ${i}`, referenceIds: [], accountPref: "auto", state: "queued", priority: 0, clientRequestId: `seed-${i}`, apiKeyId: keyId, apiFingerprint: "x", now: h.clock.t });
    }
    h.clock.t += 60_000;
    const full = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "one more" } });
    expect(full.status).toBe(429);
    expect(full.json.code).toBe("queue_full");
    expect(Number(full.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(h.repo.queryJobs({}).total).toBe(API_UNFINISHED_PER_KEY);
  });

  it("AC-API-21: no account/login/settings routes; unknown MCP tool; needs_review is reported, not handled", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    for (const p of ["/v1/accounts", "/v1/accounts/x/login", "/v1/settings", "/v1/keys", "/v1/library"]) {
      const r = await rig.req("GET", p, { token: rig.gen });
      expect(r.status).toBe(404);
    }
    expect((await rig.req("POST", "/v1/accounts/x/login", { token: rig.gen, json: {} })).status).toBe(404);
    const id = (await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: PROMPT } })).json.jobs[0].id;
    h.repo.updateJob(id, { state: "needs_review" }, h.clock.t);
    const r = await rig.req("GET", `/v1/jobs/${id}`, { token: rig.gen });
    expect(r.json).toMatchObject({ status: "needs_review", needs_human: true });
    const c = await rig.req("POST", `/v1/jobs/${id}/cancel`, { token: rig.gen });
    expect(c.status).toBe(409);
    expect(job(h, id).state).toBe("needs_review");
    const mcp = await rig.req("POST", "/mcp", { token: rig.gen, json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_login", arguments: {} } } });
    expect(mcp.json.error.code).toBe(-32602);
    expect(mcp.json.error.message).toMatch(/Unknown tool/);
  });

  it("list: newest first, status filter and cursor pages", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: `p${i}` } })).json.jobs[0].id);
    const p1 = await rig.req("GET", "/v1/jobs?limit=2", { token: rig.gen });
    expect(p1.json.jobs.map((j: { id: string }) => j.id)).toEqual([ids[4], ids[3]]);
    const p2 = await rig.req("GET", `/v1/jobs?limit=2&cursor=${p1.json.next_cursor}`, { token: rig.gen });
    expect(p2.json.jobs.map((j: { id: string }) => j.id)).toEqual([ids[2], ids[1]]);
    h.repo.updateJob(ids[0], { state: "failed" }, h.clock.t);
    const failed = await rig.req("GET", "/v1/jobs?status=failed", { token: rig.gen });
    expect(failed.json.jobs.map((j: { id: string }) => j.id)).toEqual([ids[0]]);
    expect((await rig.req("GET", "/v1/jobs?status=done", { token: rig.gen })).status).toBe(400);
  });
});

describe("browser and Host protection (R33)", () => {
  it("AC-API-13: Origin → 403, foreign Host → 421, OPTIONS → 403; never any CORS header", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const o = await rig.req("GET", "/v1/status", { token: rig.gen, headers: { origin: "https://evil.example" } });
    expect(o.status).toBe(403);
    expect(o.json.code).toBe("origin_forbidden");
    const host = await rig.req("GET", "/v1/status", { token: rig.gen, host: "evil.example" });
    expect(host.status).toBe(421);
    expect(host.json.code).toBe("misdirected_request");
    const opt = await rig.req("OPTIONS", "/v1/jobs", { token: rig.gen, headers: { "access-control-request-method": "POST" } });
    expect(opt.status).toBe(403);
    for (const r of [o, host, opt, await rig.req("GET", "/v1/status", { token: rig.gen })]) {
      expect(Object.keys(r.headers).some((k) => k.startsWith("access-control-"))).toBe(false);
    }
  });

  it("health and OpenAPI are public; health shows only the instance id", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const health = await rig.req("GET", "/v1/health");
    expect(health.json).toEqual({ ok: true, service: "muse4ai", instance: rig.api.instanceId });
    const doc = await rig.req("GET", "/v1/openapi.json");
    expect(doc.json.openapi).toBe("3.1.0");
    expect(Object.keys(doc.json.paths)).toContain("/v1/jobs/{id}");
  });
});

describe("request log (R31)", () => {
  it("AC-API-20: one row per call with the right status; no key, canary prompt or signature; 14-day pruning", async () => {
    await withMedia();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const canary = "CANARY-PROMPT-5521";
    const first = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: canary } });
    await settle(h);
    const j = (await rig.req("GET", `/v1/jobs/${first.json.jobs[0].id}`, { token: rig.gen })).json;
    const u = new URL(j.outputs[0].download_url);
    await rig.req("GET", u.pathname + u.search);
    const statuses = [202, 200, 200];
    for (let i = 3; i < 100; i++) {
      h.clock.t += 300; // keep under the read rate limit
      const r = i % 10 === 0 ? await rig.req("GET", "/v1/status", { token: "msk_wrong" }) : await rig.req("GET", "/v1/status", { token: rig.read });
      statuses.push(r.status);
    }
    const log = rig.api.requestLog(200);
    expect(log).toHaveLength(100);
    expect(log.map((l) => l.status).reverse()).toEqual(statuses);
    expect(log.find((l) => l.status === 401)!.code).toBe("invalid_api_key");
    expect(log[log.length - 1]).toMatchObject({ method: "POST", route: "/v1/jobs", keyName: "Agent n8n", via: "local" });
    const sig = u.searchParams.get("sig")!;
    const rows = JSON.stringify(h.repo.db.prepare("SELECT * FROM api_requests").all());
    for (const secret of [canary, sig, rig.gen.slice(13), rig.read.slice(13)]) {
      expect(rows.includes(secret)).toBe(false);
      expect(h.logs.join("\n").includes(secret)).toBe(false);
    }
    h.repo.db.prepare("UPDATE api_requests SET ts = ? WHERE seq IN (SELECT seq FROM api_requests ORDER BY seq LIMIT 30)").run(h.clock.t - 15 * 86_400_000);
    expect(rig.api.store.pruneRequests(h.clock.t)).toBe(30);
    expect(rig.api.store.countRequests()).toBe(70);
  });
});

describe("persistence and upgrade", () => {
  it("AC-API-22 (local part): after a restart the API is back with the same mode, keys and jobs", async () => {
    h = makeHarness();
    await idleAccount();
    rig = await makeApi(h);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: `p${i}` } })).json.jobs[0].id);
    const { gen, read, port } = rig;
    await rig.close();
    rig = null;
    const dir = h.dir;
    await h.coord.stop();
    h.close();
    h = makeHarness({ dir });
    expect(h.coord.settings()).toMatchObject({ apiEnabled: true, apiPort: port, apiAccess: "local" });
    rig = await makeApi(h, { keys: false });
    expect(rig.port).not.toBe(port); // makeApi picks a new free port; restore the saved one
    await rig.api.setPort(port);
    for (const id of ids) {
      const r = await rawRequest(port, "GET", `/v1/jobs/${id}`, { token: gen });
      expect(r.status).toBe(200);
    }
    expect((await rawRequest(port, "GET", "/v1/status", { token: read })).status).toBe(200);
  });

  it("AC-API-23 (store part): a v1 store is backed up, then upgraded to v2 with every old row intact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v1-"));
    const file = path.join(dir, "data", "muse.sqlite");
    const backups = path.join(dir, "backups");
    const v1 = openDatabase(sqlite, file, backups, { targetVersion: 1 });
    v1.db.prepare("INSERT INTO jobs(id,kind,mode,prompt,state,created_at,updated_at,rev) VALUES('old-1','image','text','cũ','completed',1,1,1)").run();
    v1.db.close();
    const v2 = openDatabase(sqlite, file, backups, { targetVersion: 2 });
    expect(v2.migratedFrom).toBe(1);
    expect(path.basename(v2.backupPath!)).toMatch(/^before-v2-from-v1-\d+\.sqlite$/);
    const row = v2.db.prepare("SELECT id, prompt, api_key_id FROM jobs WHERE id='old-1'").get() as Record<string, unknown>;
    expect(row).toEqual({ id: "old-1", prompt: "cũ", api_key_id: null });
    expect(v2.db.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toEqual({ n: 0 });
    v2.db.close();
  });
});

/** Valid PNG of the given size (solid colour, zlib-compressed rows). */
async function makePng(w: number, hgt: number): Promise<Buffer> {
  const zlib = await import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: hgt }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
