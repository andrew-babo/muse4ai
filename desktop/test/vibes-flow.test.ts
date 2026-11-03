import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, SCHEMA_VERSION } from "../src/main/db";
import { Repo } from "../src/main/repo";
import type { FakeVibesConfig } from "../src/main/adapter/vibes/fake";
import { makeHarness, seedAccounts, settle, job, textJob, sqlite, type Harness } from "./helpers";

// Spec rev 6 §4.9 — Vibes in the same account profile + Kéo dài video (AC-VIB-*, AC-EXT-*), against the fake Vibes.

let h: Harness;
afterEach(() => h?.close());

const VCAPS = { "vibes.video.text": true, "vibes.video.reference": true, "vibes.video.extend": true } as const;
const tick = () => new Promise((r) => setTimeout(r, 5));
async function flush(n = 6) {
  for (let i = 0; i < n; i++) await tick();
}

async function setup(aliases = ["A", "B"], opts: Parameters<typeof makeHarness>[0] = {}): Promise<string[]> {
  h = makeHarness(opts);
  const ids = await seedAccounts(h, aliases);
  h.coord.testSetVerified(VCAPS);
  for (const id of ids) await h.coord.checkVibes(id);
  return ids;
}

const vjob = (prompt = "sóng biển lúc bình minh", extra: Record<string, unknown> = {}) => ({ ...textJob(prompt), kind: "video" as const, site: "vibes" as const, ...extra });

/** Vibes generate on one account → its asset id. */
async function generateOn(acc: string, prompt?: string): Promise<string> {
  h.clock.t += 6_000;
  const [id] = h.coord.createJobs(vjob(prompt, { accountPref: acc }));
  await settle(h, 8);
  expect(job(h, id).state).toBe("completed");
  return h.repo.assetsForJob(id)[0].id;
}

/** Advances past the R43 gap and runs the scheduler, `n` times. */
async function stepClock(n: number, ms = 5_000) {
  for (let i = 0; i < n; i++) {
    h.clock.t += ms;
    await settle(h, 6);
  }
}

const chainJobs = (chainId: string) => h.repo.jobsForChain(chainId);
const allText = () => JSON.stringify(h.events) + JSON.stringify(h.notices) + h.logs.join("\n");

describe("AC-VIB-01 store v2 → v3", () => {
  it("backs up first, keeps every Muse row, and adds Vibes logged_out for each account", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v2-"));
    const file = path.join(dir, "data", "muse.sqlite");
    const backups = path.join(dir, "backups");
    const v2 = openDatabase(sqlite, file, backups, { targetVersion: 2 });
    v2.db.prepare("INSERT INTO accounts(id,alias,alias_key,state,capabilities,created_at,rev) VALUES('acc-a','Mây','mây','ready','{}',1,1),('acc-b','Sương','sương','needs_login','{}',1,2)").run();
    v2.db.prepare("INSERT INTO jobs(id,kind,mode,prompt,state,created_at,updated_at,rev) VALUES('j1','video','text','cũ','completed',1,1,3)").run();
    v2.db.prepare("INSERT INTO assets(id,job_id,path,sha256,kind,mime,bytes,created_at,rev) VALUES('as1','j1','x.mp4','abc','video','video/mp4',10,1,4)").run();
    v2.db.close();
    const v3 = openDatabase(sqlite, file, backups);
    expect(v3.migratedFrom).toBe(2);
    expect(path.basename(v3.backupPath!)).toMatch(new RegExp(`^before-v${SCHEMA_VERSION}-from-v2-\\d+\\.sqlite$`));
    expect(fs.existsSync(v3.backupPath!)).toBe(true);
    const repo = new Repo(v3.db);
    const accs = repo.listAccounts();
    expect(accs.map((a) => [a.alias, a.state, a.vibes.enabled, a.vibes.status])).toEqual([
      ["Mây", "ready", true, "logged_out"],
      ["Sương", "needs_login", true, "logged_out"],
    ]);
    const j = repo.getJob("j1")!;
    expect([j.site, j.operation, j.state]).toEqual(["muse", "generate", "completed"]);
    expect(repo.getAsset("as1")).toMatchObject({ site: "muse", sourceStatus: null, chainId: null });
    v3.db.close();
  });
});

describe("AC-VIB-02 .. AC-VIB-04 two-step login under one lease", () => {
  it("AC-VIB-02: Muse first, Vibes second; Muse is ready before the Vibes step but no job starts until both end", async () => {
    h = makeHarness({ autoLogin: false, vibesCfg: () => ({ me: [{ status: 401, body: { error: "NoToken" } }, { status: 200, body: { user: { id: "u-9", username: "may.vn" } } }] }) });
    h.coord.testSetVerified(VCAPS);
    h.coord.importProxies("10.0.0.1:8080:u:p");
    for (const p of h.repo.listProxies()) await h.coord.testProxy(p.id);
    const A = h.coord.addAccount({ alias: "A", avatar: 0 }).id;
    expect(h.repo.getAccount(A)!.state).toBe("new");
    const [museJob] = h.coord.createJobs(textJob("ảnh mèo", { kind: "image" }));
    h.coord.openLogin(A);
    await flush();
    expect(h.logins).toEqual([{ accountId: A, site: "muse" }]);
    h.loginWaiters.get(`${A}:muse`)!(true);
    await flush();
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(h.logins.at(-1)).toEqual({ accountId: A, site: "vibes" });
    h.coord.runScheduler();
    await flush();
    expect(job(h, museJob).state).toBe("queued"); // lease still held by the login flow
    expect(h.coord.loginState(A)?.steps.map((s) => s.state)).toEqual(["done", "active"]);
    h.loginWaiters.get(`${A}:vibes`)!(true);
    await flush();
    const a = h.repo.getAccount(A)!;
    expect(a.vibes.status).toBe("ready");
    expect(a.vibes.identityMasked).toBe("ma•••vn");
    await settle(h);
    expect(job(h, museJob).state).toBe("completed");
  });

  it("AC-VIB-03 (a): Muse ready + Vibes needs_login → only the Vibes step opens", async () => {
    const [A] = await setup(["A"], { autoLogin: false });
    h.repo.updateVibes(A, { status: "needs_login" });
    h.vibesCfg(A).me = [{ status: 401, body: { error: "SessionExpired" } }, { status: 200, body: { user: { id: "u-1", username: "may.vn" } } }];
    h.coord.openLogin(A);
    await flush();
    expect(h.logins).toEqual([{ accountId: A, site: "vibes" }]);
    h.loginWaiters.get(`${A}:vibes`)!(true);
    await flush();
    expect(h.repo.getAccount(A)!.vibes.status).toBe("ready");
  });

  it("AC-VIB-03 (b): Muse needs_login + Vibes ready → Muse step, Vibes ✓ by the silent check only", async () => {
    const [A] = await setup(["A"], { autoLogin: false });
    h.repo.updateAccount(A, { state: "needs_login" });
    h.fakeCfg(A).script = [{ phase: "probe", error: "SESSION_EXPIRED" }];
    h.coord.openLogin(A);
    await flush();
    expect(h.logins).toEqual([{ accountId: A, site: "muse" }]);
    h.loginWaiters.get(`${A}:muse`)!(true);
    await flush();
    expect(h.logins).toHaveLength(1);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(h.repo.getAccount(A)!.vibes.status).toBe("ready");
  });

  it("AC-VIB-04 (a)(b)(c): closing, skipping or timing out at Vibes keeps Muse ready, Vibes unchanged, no notice", async () => {
    const [A] = await setup(["A"], { autoLogin: false, loginStepTimeoutMs: 60 });
    h.repo.updateAccount(A, { state: "needs_login" });
    h.repo.updateVibes(A, { status: "needs_login" });
    const notices = () => h.notices.length;
    for (const how of ["close", "skip", "timeout"] as const) {
      h.repo.updateAccount(A, { state: "needs_login" });
      h.fakeCfg(A).script = [{ phase: "probe", error: "SESSION_EXPIRED" }];
      h.vibesCfg(A).me = [{ status: 401, body: { error: "SessionExpired" } }];
      const before = notices();
      h.coord.openLogin(A);
      await flush();
      h.loginWaiters.get(`${A}:muse`)!(true);
      await flush();
      expect(h.coord.loginState(A)?.active).toBe("vibes");
      if (how === "close") h.loginWaiters.get(`${A}:vibes`)!(false);
      else if (how === "skip") h.coord.skipLoginStep(A);
      else await new Promise((r) => setTimeout(r, 120));
      await flush();
      expect(h.coord.loginState(A)).toBeNull();
      const a = h.repo.getAccount(A)!;
      expect(a.state).toBe("ready");
      expect(a.vibes.status).toBe("needs_login");
      expect(notices()).toBe(before);
      // The final step result tells the stepper/toast what happened: the user's skip is “deferred”, never
      // “skipped” (that one means “Đã đăng nhập sẵn” — still logged in).
      const last = h.events.filter((e) => e.type === "login").at(-1)!.payload as { done: boolean; steps: { site: string; state: string }[] };
      expect(last.done).toBe(true);
      expect(last.steps).toEqual([
        { site: "muse", state: "done" },
        { site: "vibes", state: how === "close" ? "cancelled" : how === "skip" ? "deferred" : "timeout" },
      ]);
    }
    // the lease is released: Muse work runs at once
    const [id] = h.coord.createJobs(textJob());
    await settle(h);
    expect(job(h, id).state).toBe("completed");
  });
});

describe("AC-VIB-05 session outcomes", () => {
  it("needs_login notifies once; a repeated check in the same state adds nothing; a network error changes nothing", async () => {
    const [A] = await setup(["A"]);
    h.vibesCfg(A).me = [{ status: 401, body: { error: "SessionExpired" } }];
    await h.coord.checkVibes(A);
    await h.coord.checkVibes(A);
    expect(h.repo.getAccount(A)!.vibes.status).toBe("needs_login");
    expect(h.notices.filter((n) => n.title === "A cần đăng nhập lại Vibes")).toHaveLength(1);
    // AC-VIB-10: the toast links to the Vibes login step of this account (resolved per run in toast.ts).
    expect(h.notices.find((n) => n.title === "A cần đăng nhập lại Vibes")!.route).toBe(`/accounts/${A}/login?site=vibes`);
    h.vibesCfg(A).me = [{ status: 403, body: { error: "AccountPending" } }];
    await h.coord.checkVibes(A);
    await h.coord.checkVibes(A);
    expect(h.repo.getAccount(A)!.vibes.status).toBe("restricted");
    expect(h.notices.filter((n) => n.title === "A chưa dùng được Vibes")).toHaveLength(1);
    expect(h.repo.getAccount(A)!.state).toBe("ready"); // Muse untouched (R40)
    h.vibesCfg(A).me = ["network"];
    await h.coord.checkVibes(A);
    expect(h.repo.getAccount(A)!.vibes.status).toBe("restricted");
    expect(h.repo.getAccount(A)!.state).toBe("proxy_error");
  });
});

describe("AC-VIB-06 / 07 / 09 scheduling with one job per account", () => {
  it("AC-VIB-06: Muse pinned A runs on A, Vibes auto runs on B, extend of A's video waits for A", async () => {
    const [A, B] = await setup();
    const src = await generateOn(A);
    h.repo.updateVibes(A, { status: "needs_login" });
    const [muse] = h.coord.createJobs(textJob("ảnh", { accountPref: A }));
    const [vib] = h.coord.createJobs(vjob("biển"));
    const ext = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "e1" });
    await stepClock(2);
    expect(job(h, muse)).toMatchObject({ state: "completed", accountId: A });
    expect(job(h, vib)).toMatchObject({ state: "completed", accountId: B });
    expect(job(h, ext.jobIds[0]).state).toBe("queued");
    expect(h.coord.chainDetail(ext.chain.id).chain).toMatchObject({ status: "waiting", reason: "Đang chờ A đăng nhập lại Vibes" });
  });

  it("AC-VIB-07: Muse limit_reached but Vibes ready → the Vibes job runs on A, the Muse job waits", async () => {
    const [A] = await setup(["A"]);
    h.repo.updateAccount(A, { state: "limit_reached", stateUntil: h.clock.t + 3_600_000 });
    const [muse] = h.coord.createJobs(textJob());
    const [vib] = h.coord.createJobs(vjob());
    await settle(h);
    expect(job(h, vib)).toMatchObject({ state: "completed", accountId: A });
    expect(job(h, muse).state).toBe("queued");
  });

  it("AC-VIB-09: while A runs a Muse job its Vibes job waits; then it runs (never two at once)", async () => {
    const [A] = await setup(["A"], { cfg: () => ({ generateDelayMs: 60 }) });
    const [muse] = h.coord.createJobs(textJob("ảnh", { kind: "video" }));
    h.coord.runScheduler();
    await flush(2);
    const [vib] = h.coord.createJobs(vjob());
    h.coord.runScheduler();
    await flush(2);
    expect(job(h, muse).state).not.toBe("completed");
    expect(job(h, vib).state).toBe("queued");
    await settle(h);
    expect(job(h, muse).state).toBe("completed");
    expect(job(h, vib).state).toBe("completed");
    expect(h.vibes.get(A)!.sent[0].at).toBeGreaterThanOrEqual(job(h, muse).completedAt!);
  });
});

describe("AC-VIB-08 identity change", () => {
  it("a different Vibes user holds new work and locks old sources until the user chooses", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    h.vibesCfg(A).me = [{ status: 200, body: { user: { id: "u-OTHER", username: "khac.vn" } } }];
    const [vib] = h.coord.createJobs(vjob("mới", { accountPref: A }));
    await stepClock(1, 6_000);
    const a = h.repo.getAccount(A)!;
    expect(a.vibes.status).toBe("identity_changed");
    expect(a.vibes.pendingIdentityMasked).toBe("kh•••vn");
    expect(job(h, vib)).toMatchObject({ state: "held", errorMessage: "Phiên Vibes đã đổi tài khoản — chờ anh chọn" });
    expect(() => h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "x" })).toThrow("Phiên Vibes của A đã đổi tài khoản");
    h.coord.acceptVibesIdentity(A);
    await stepClock(1, 6_000);
    expect(job(h, vib).state).toBe("completed");
    expect(() => h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "y" })).toThrow("Phiên Vibes của A đã đổi tài khoản");
  });
});

describe("AC-VIB-11 Vibes switch", () => {
  it("off: nothing is sent to Vibes (even while Muse works), Vibes jobs are held; on: exactly one check", async () => {
    const [A] = await setup(["A"]);
    const v = h.vibes.get(A)!;
    const before = v.calls.session;
    h.coord.setVibesEnabled(A, false);
    expect(h.vibesSwitches.at(-1)).toEqual({ accountId: A, on: false });
    const [vib] = h.coord.createJobs(vjob("biển", { accountPref: A }));
    const [muse] = h.coord.createJobs(textJob());
    await settle(h);
    expect(job(h, muse).state).toBe("completed");
    expect(job(h, vib).state).toBe("queued");
    expect(v.calls.session).toBe(before);
    expect(v.calls.submit).toBe(0);
    h.coord.setVibesEnabled(A, true);
    await flush();
    expect(v.calls.session).toBe(before + 1);
    h.clock.t += 6_000;
    await settle(h);
    expect(job(h, vib).state).toBe("completed");
  });
});

describe("AC-VIB-12 identity data never leaves the main process", () => {
  it("canary username / user id appear nowhere except as a masked name; the store keeps only a fingerprint", async () => {
    await setup(["A"], { vibesCfg: () => ({ me: [{ status: 200, body: { user: { id: "CANARY-UID-4402", username: "CANARY-VIB-3301" } } }] }) });
    const a = h.repo.listAccounts()[0];
    expect(a.vibes.identityMasked).toBe("CA•••01");
    const text = allText();
    expect(text).not.toContain("CANARY-UID-4402");
    expect(text).not.toContain("CANARY-VIB-3301");
    h.repo.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = fs.readFileSync(h.dbFile).toString("latin1");
    expect(bytes).not.toContain("CANARY-UID-4402");
    expect(bytes).not.toContain("CANARY-VIB-3301");
  });
});

describe("AC-EXT-01 / 02 Vibes video jobs", () => {
  it("AC-EXT-01: refused while unverified; images refused on Vibes; queued without a ready Vibes account", async () => {
    h = makeHarness();
    await seedAccounts(h, ["A"]);
    expect(() => h.coord.createJobs(vjob())).toThrow("Vibes chưa được kiểm trên phiên bản này");
    h.coord.testSetVerified(VCAPS);
    expect(() => h.coord.createJobs({ ...vjob(), kind: "image" })).toThrow("Vibes chỉ tạo video");
    const [id] = h.coord.createJobs(vjob());
    await settle(h, 3);
    expect(job(h, id).state).toBe("queued"); // Vibes still logged_out
  });

  it("AC-EXT-02: the batch id is persisted before the first send; output = Vibes asset + remote source, nothing remote in events", async () => {
    const seen: string[] = [];
    const [A] = await setup(["A"], {
      vibesCfg: () => ({
        onSend: (batchId) => {
          const j = h.repo.jobsInStates(["submitting"])[0];
          seen.push(`${j?.state}:${j?.remoteRef === batchId}`);
        },
      }),
    });
    const [id] = h.coord.createJobs(vjob());
    await settle(h);
    expect(seen).toEqual(["submitting:true"]);
    const v = h.vibes.get(A)!;
    expect(v.events).toEqual([`intent:${v.sent[0].batchId}`, `send:${v.sent[0].batchId}`]);
    const [asset] = h.repo.assetsForJob(id);
    expect(asset).toMatchObject({ site: "vibes", kind: "video", sourceStatus: "ok", sourceOwnerId: A, durationMs: 5_000 });
    const text = allText();
    expect(text).not.toContain(v.sent[0].batchId);
    expect(text).not.toContain("hdl-1");
    expect(text).not.toContain("token=t1");
  });
});

describe("AC-EXT-04 .. 08 chains", () => {
  it("AC-EXT-04: Theo mô tả sends the directive for its step; a later Tự động step sends none", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    const c1 = h.coord.startExtend({ assetId: src, mode: "directive", directive: "  máy quay lùi xa dần ", plan: { type: "steps", value: 1 }, clientRequestId: "d1" });
    await stepClock(2);
    expect(h.coord.chainDetail(c1.chain.id).chain.status).toBe("completed");
    const out1 = h.coord.chainDetail(c1.chain.id).steps[0].assetId!;
    const c2 = h.coord.startExtend({ assetId: out1, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "d2" });
    await stepClock(2);
    expect(h.coord.chainDetail(c2.chain.id).chain.status).toBe("completed");
    const sent = h.vibes.get(A)!.sent.filter((s) => s.operation === "extend");
    expect(sent).toHaveLength(2);
    const in1 = (sent[0].request.trigger.inputs as Record<string, unknown>[])[0];
    expect(in1.extendDirective).toBe("máy quay lùi xa dần");
    expect(JSON.stringify(sent[1].request)).not.toContain("extendDirective");
    expect(JSON.stringify(sent[1].request)).not.toContain("máy quay");
    expect(() => h.coord.startExtend({ assetId: src, mode: "directive", directive: "   ", plan: { type: "steps", value: 1 }, clientRequestId: "d3" })).toThrow("Nhập mô tả cho Theo mô tả");
  });

  it("AC-EXT-05 / AC-EXT-14: 3 steps from 5 s → 10/15/20 s, one open step at a time, ≥ 5 s apart, files in Kéo dài/{chain}", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 3 }, clientRequestId: "c5" });
    expect(r.jobIds).toHaveLength(1);
    await settle(h, 4);
    expect(chainJobs(r.chain.id)).toHaveLength(1);
    expect(job(h, r.jobIds[0]).state).toBe("queued"); // R43 gap after the generate
    await stepClock(5);
    const d = h.coord.chainDetail(r.chain.id);
    expect(d.chain).toMatchObject({ status: "completed", reason: "Đã kéo dài 3 lần", stepsDone: 3, lastDurationMs: 20_000 });
    expect(d.steps.map((s) => [s.step, s.state, s.durationMs])).toEqual([
      [1, "completed", 10_000],
      [2, "completed", 15_000],
      [3, "completed", 20_000],
    ]);
    const sent = h.vibes.get(A)!.sent;
    expect(sent).toHaveLength(4);
    for (let i = 1; i < sent.length; i++) expect(sent[i].at - sent[i - 1].at).toBeGreaterThanOrEqual(5_000);
    // the source of step k+1 is the output of step k
    const outIds = [src, ...d.steps.map((s) => s.assetId!)];
    for (let k = 1; k <= 3; k++) {
      const srcRs = h.repo.getRemoteSource(h.repo.assetRemoteSourceId(outIds[k - 1])!)!;
      expect(sent[k].sourceContentId).toBe(srcRs.contentId);
    }
    const last = h.repo.getAsset(d.steps[2].assetId!)!;
    expect(last.parentAssetId).toBe(d.steps[1].assetId);
    const rel = path.relative(path.join(h.dir, "Library"), last.path).split(path.sep);
    expect(rel[1]).toBe("Kéo dài");
    expect(rel[2]).toBe(r.chain.id.replace(/-/g, "").slice(0, 6));
    expect(rel[3]).toMatch(/_lan3\.mp4$/);
    // one notification for the whole chain (AC-EXT-23)
    expect(h.notices.filter((n) => n.kind === "chain_done")).toEqual([expect.objectContaining({ title: "Chuỗi kéo dài xong · 20,0 s" })]);
  });

  it("AC-EXT-06: Đến khoảng 30 giây from 5 s stops after 5 steps", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "target", value: 30 }, clientRequestId: "c6" });
    await stepClock(8);
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "completed", reason: "Đã đạt khoảng 30 giây", stepsDone: 5, lastDurationMs: 30_000 });
    expect(chainJobs(r.chain.id)).toHaveLength(5);
  });

  it("AC-EXT-07: growth under 1 s stops the chain and keeps the step's file", async () => {
    const lens = [10_000, 15_000, 15_400];
    const [A] = await setup(["A"], { vibesCfg: () => ({ durations: (_op, _src, n) => lens[n - 1] ?? 20_000 }) });
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 5 }, clientRequestId: "c7" });
    await stepClock(5);
    const d = h.coord.chainDetail(r.chain.id);
    expect(d.chain).toMatchObject({ status: "stopped", reason: "Vibes không kéo dài thêm", stepsDone: 2 });
    expect(d.steps).toHaveLength(2);
    expect(fs.existsSync(h.repo.getAsset(d.steps[1].assetId!)!.path)).toBe(true);
    expect(h.notices.filter((n) => n.kind === "chain")).toEqual([expect.objectContaining({ title: "Chuỗi kéo dài dừng: Vibes không kéo dài thêm" })]);
  });

  it("AC-EXT-08: the maximum caps a long target (20 steps) and 21 steps is refused", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    expect(() => h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 21 }, clientRequestId: "c8x" })).toThrow("Tối đa 20 lần mỗi chuỗi");
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "target", value: 300 }, clientRequestId: "c8" });
    await stepClock(24);
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "stopped", reason: "Đã đủ 20 lần", stepsDone: 20, lastDurationMs: 105_000 });
  });

  it("R49: an output shorter than its source is a segment → the chain stops, nothing is joined", async () => {
    const [A] = await setup(["A"], { vibesCfg: () => ({ segmentOnly: true, durations: (op, s) => (op === "generate" ? 10_000 : (s ?? 0) + 5_000) }) });
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 3 }, clientRequestId: "seg" });
    await stepClock(3);
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "stopped", reason: "Vibes trả về đoạn nối thêm — chưa kéo dài tiếp được", stepsDone: 1 });
  });
});

describe("AC-EXT-09 / 10 crash and lost answers (R48)", () => {
  async function crashAtStep2(batchKnown: boolean) {
    const batches: NonNullable<FakeVibesConfig["batches"]> = new Map();
    const [A] = await setup(["A"], { vibesCfg: () => ({ batches }) });
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 3 }, clientRequestId: "crash" });
    await stepClock(1);
    const step2 = chainJobs(r.chain.id).find((j) => j.stepIndex === 2)!;
    expect(step2.state).toBe("queued");
    // the app died after writing the intent of step 2 and sending it, before reading the answer
    const batchId = "extend-1793000000000-0badf00d";
    const srcRs = h.repo.getRemoteSource(h.repo.assetRemoteSourceId(step2.sourceAssetId!)!)!;
    if (batchKnown) batches.set(batchId, { remote: { ...srcRs, batchId, contentId: "c-after-crash", config: srcRs.config ?? {} }, durationMs: 15_000 });
    h.repo.updateJob(step2.id, { state: "submitting", accountId: A, remoteRef: batchId, submitIntentAt: h.clock.t }, h.clock.t);
    const dir = h.dir;
    const t = h.clock.t;
    h.close();
    h = makeHarness({ dir, start: t + 1_000, vibesCfg: () => ({ batches }) });
    h.coord.testSetVerified(VCAPS);
    h.coord.recover();
    await stepClock(3);
    return { A, chainId: r.chain.id, step2: step2.id };
  }

  it("(a) known batch: step 2 completes without sending again and step 3 follows", async () => {
    const { A, chainId, step2 } = await crashAtStep2(true);
    expect(job(h, step2).state).toBe("completed");
    const sent = h.vibes.get(A)?.sent ?? [];
    expect(sent.filter((s) => s.jobId === step2)).toHaveLength(0);
    expect(h.coord.chainDetail(chainId).chain).toMatchObject({ status: "completed", stepsDone: 3 });
  });

  it("(b) unknown batch: step 2 needs review, the chain waits for the user, no step 3", async () => {
    const { chainId, step2 } = await crashAtStep2(false);
    expect(job(h, step2).state).toBe("needs_review");
    const d = h.coord.chainDetail(chainId);
    expect(d.chain).toMatchObject({ status: "needs_review", reason: "Lần 2 cần anh xem" });
    expect(d.steps).toHaveLength(2);
  });

  it("AC-EXT-10: a trigger whose answer is lost is reconciled once by batch id, then needs review; sent exactly once", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    h.vibesCfg(A).script = [{ phase: "submit", error: "AMBIGUOUS_SUBMIT", afterSend: true }];
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 2 }, clientRequestId: "lost" });
    await stepClock(3);
    const j = job(h, r.jobIds[0]);
    expect(j.state).toBe("needs_review");
    expect(h.vibes.get(A)!.sent.filter((s) => s.jobId === j.id)).toHaveLength(1);
    expect(h.vibes.get(A)!.calls.observe).toBeGreaterThanOrEqual(2); // the generate + the one reconcile read
    expect(h.coord.chainDetail(r.chain.id).chain.status).toBe("needs_review");
  });
});

describe("AC-EXT-11 / 12 / 13 owner rules", () => {
  it("AC-EXT-11: removing the owner cancels its steps, stops its chains and locks its sources", async () => {
    const [A, B] = await setup();
    const src = await generateOn(A);
    h.repo.updateVibes(A, { status: "needs_login" });
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 2 }, clientRequestId: "own" });
    await settle(h, 3);
    const res = await h.coord.removeAccount(A);
    expect(res.removed).toBe(true);
    expect(job(h, r.jobIds[0])).toMatchObject({ state: "cancelled", errorMessage: "Tài khoản sở hữu video nguồn đã bị xoá" });
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "stopped", reason: "Tài khoản sở hữu video nguồn đã bị xoá" });
    expect(h.repo.getAsset(src)!.sourceStatus).toBe("owner_removed");
    expect(() => h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "own2" })).toThrow("Tài khoản tạo video này đã bị xoá");
    expect(h.vibes.get(B)?.sent.filter((s) => s.operation === "extend") ?? []).toHaveLength(0);
  });

  it("AC-EXT-12: Vibes quota of the owner → chain waits until the reset time, Muse of A keeps working, never moves to B", async () => {
    const [A, B] = await setup();
    const src = await generateOn(A);
    const reset = h.clock.t + 40 * 60_000;
    h.vibesCfg(A).script = [{ phase: "submit", error: "QUOTA_LIMIT", resetAt: reset }];
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "q" });
    await stepClock(1);
    const a = h.repo.getAccount(A)!;
    expect(a.vibes.status).toBe("limit_reached");
    expect(a.state).toBe("ready");
    const fmt = new Date(reset).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    expect(h.coord.chainDetail(r.chain.id).chain.reason).toContain("A hết giới hạn Vibes đến");
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "waiting" });
    expect(fmt).toMatch(/\d\d:\d\d/);
    const [muse] = h.coord.createJobs(textJob("ảnh", { accountPref: A }));
    await settle(h);
    expect(job(h, muse).state).toBe("completed");
    h.clock.t = reset;
    await h.coord.tick();
    await stepClock(1);
    expect(h.coord.chainDetail(r.chain.id).chain.status).toBe("completed");
    expect(job(h, r.jobIds[0]).accountId).toBe(A);
    expect(h.vibes.get(B)?.sent ?? []).toHaveLength(0);
  });

  it("AC-EXT-13: Dừng chuỗi stops without a new step; Tiếp tục continues from the longest output with the steps left", async () => {
    const [A] = await setup(["A"], { vibesCfg: () => ({ generateDelayMs: 80 }) });
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 3 }, clientRequestId: "stop" });
    await stepClock(1); // step 1 done, step 2 waits for the gap
    h.clock.t += 5_000;
    h.coord.runScheduler();
    await flush(4);
    const open = chainJobs(r.chain.id).find((j) => j.stepIndex === 2)!;
    expect(job(h, open.id).state).toBe("generating");
    h.coord.cancelChain(r.chain.id);
    expect(job(h, open.id)).toMatchObject({ state: "cancelled", errorMessage: "Đã ngừng chờ trên máy — Vibes có thể vẫn tạo và tính lượt" });
    expect(h.coord.chainDetail(r.chain.id).chain).toMatchObject({ status: "cancelled", stepsDone: 1 });
    await stepClock(2);
    expect(chainJobs(r.chain.id)).toHaveLength(2);
    h.coord.continueChain(r.chain.id);
    const resumed = chainJobs(r.chain.id).find((j) => j.stepIndex === 3)!;
    expect(resumed.sourceAssetId).toBe(h.coord.chainDetail(r.chain.id).steps[0].assetId); // longest finished output
    await stepClock(5);
    const d = h.coord.chainDetail(r.chain.id);
    expect(d.chain).toMatchObject({ status: "completed", stepsDone: 3, lastDurationMs: 20_000 });
    expect(chainJobs(r.chain.id).filter((j) => j.state === "completed")).toHaveLength(3);
    expect(h.notices.filter((n) => n.kind === "chain" || n.kind === "chain_done")).toHaveLength(1); // Dừng chuỗi itself never notifies
  });

  it("AC-EXT-03: a Muse video is refused with the exact reason (server-side check, R45)", async () => {
    const [A] = await setup(["A"]);
    const [id] = h.coord.createJobs(textJob("video muse", { kind: "video", accountPref: A }));
    await settle(h);
    const asset = h.repo.assetsForJob(id)[0];
    expect(() => h.coord.startExtend({ assetId: asset.id, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "m" })).toThrow("Video này chưa có nguồn hội thoại Muse");
  });
});

describe("AC-EXT-17 remote ids stay in the main process", () => {
  it("canary content id / handle / url token are only in the remote source table", async () => {
    const [A] = await setup(["A"], {
      vibesCfg: () => ({ ids: { content: (n) => `CANARY-SRC-77${n}9`, handle: (n) => `CANARY-HDL-88${n}0`, url: (n) => `https://cdn.example.invalid/v${n}.mp4?token=CANARY-URL-99${n}1` } }),
    });
    const src = await generateOn(A);
    const r = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 2 }, clientRequestId: "can" });
    await stepClock(4);
    expect(h.coord.chainDetail(r.chain.id).chain.status).toBe("completed");
    const text = allText() + JSON.stringify(h.coord.snapshot()) + JSON.stringify(h.coord.chainDetail(r.chain.id)) + JSON.stringify(h.repo.queryAssets({}));
    for (const c of ["CANARY-SRC", "CANARY-HDL", "CANARY-URL"]) expect(text).not.toContain(c);
    const others = ["jobs", "attempts", "assets", "extend_chains", "account_sites"].map((t) => JSON.stringify(h.repo.db.prepare(`SELECT * FROM ${t}`).all())).join("");
    for (const c of ["CANARY-SRC", "CANARY-HDL", "CANARY-URL"]) expect(others).not.toContain(c);
    expect(JSON.stringify(h.repo.db.prepare("SELECT * FROM remote_sources").all())).toContain("CANARY-SRC");
  });
});

describe("AC-EXT-02 idempotency of starting a chain", () => {
  it("the same clientRequestId returns the same chain and creates nothing new", async () => {
    const [A] = await setup(["A"]);
    const src = await generateOn(A);
    const a = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "same" });
    const b = h.coord.startExtend({ assetId: src, mode: "auto", plan: { type: "steps", value: 1 }, clientRequestId: "same" });
    expect(b).toMatchObject({ replayed: true, jobIds: a.jobIds });
    expect(b.chain.id).toBe(a.chain.id);
    expect(h.repo.listChains()).toHaveLength(1);
  });
});

describe("AC-VIB-15 Vibes under-18 block during the login step", () => {
  it("ends the Vibes step at once as restricted with the age note; Muse stays ready; one notice", async () => {
    const { isVibesAgeBlock } = await import("../src/main/adapter/vibes/protocol");
    const { VIBES_AGE_NOTE } = await import("../src/shared/vibes");
    // The live dialog text (27/10/2026) and the landing page it must not be confused with.
    expect(isVibesAgeBlock("Dialog\nTeens under 18 can\u2019t use Vibes\n\nTeens under 18 can no longer use Vibes.")).toBe(true);
    expect(isVibesAgeBlock("Download app\nLog In\nBring ideas to life with vibes")).toBe(false);

    const [A] = await setup(["A"], { autoLogin: false });
    h.vibesCfg(A).me = [{ status: 401, body: { error: "No cookie value provided", errorType: "NoToken" } }];
    h.coord.openLogin(A, "vibes");
    await flush();
    expect(h.logins).toEqual([{ accountId: A, site: "vibes" }]);
    h.loginWaiters.get(`${A}:vibes`)!("restricted");
    await flush();
    const a = h.repo.getAccount(A)!;
    expect(a.vibes.status).toBe("restricted");
    expect(a.vibes.note).toBe(VIBES_AGE_NOTE);
    expect(a.state).toBe("ready");
    expect(h.coord.loginState(A)).toBeNull();
    const last = h.events.filter((e) => e.type === "login").at(-1)!.payload as { steps: { site: string; state: string }[] };
    expect(last.steps).toEqual([{ site: "vibes", state: "failed" }]);
    const notes = h.notices.filter((n) => n.title === "A chưa dùng được Vibes");
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain(VIBES_AGE_NOTE);
  });

  it("a later 401 keeps it restricted; the user can still retry; a working session makes it ready", async () => {
    const [A] = await setup(["A"], { autoLogin: false });
    const { VIBES_AGE_NOTE } = await import("../src/shared/vibes");
    h.repo.updateVibes(A, { status: "restricted", note: VIBES_AGE_NOTE });
    h.vibesCfg(A).me = [{ status: 401, body: { error: "NoToken" } }];
    await h.coord.checkVibes(A);
    expect(h.repo.getAccount(A)!.vibes.status).toBe("restricted");
    // automatic plans never loop on a restricted account (R42) …
    h.coord.openLogin(A);
    await flush();
    expect(h.logins.filter((l) => l.site === "vibes")).toHaveLength(0);
    await settle(h);
    // … but “Thử đăng nhập lại” opens the Vibes step, and closing it keeps the reason
    h.coord.openLogin(A, "vibes");
    await flush();
    expect(h.logins.at(-1)).toEqual({ accountId: A, site: "vibes" });
    h.loginWaiters.get(`${A}:vibes`)!(false);
    await flush();
    expect(h.repo.getAccount(A)!.vibes).toMatchObject({ status: "restricted", note: VIBES_AGE_NOTE });
    // after the account is fixed on Meta's side, a successful login lifts it
    h.vibesCfg(A).me = [{ status: 401, body: { error: "NoToken" } }, { status: 200, body: { user: { id: "u-1", username: "may.vn" } } }];
    h.coord.openLogin(A, "vibes");
    await flush();
    h.loginWaiters.get(`${A}:vibes`)!(true);
    await flush();
    expect(h.repo.getAccount(A)!.vibes.status).toBe("ready");
  });
});
