import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, seedAccounts, settle, job, textJob, type Harness } from "./helpers";

let h: Harness;
afterEach(() => h?.close());

describe("create jobs", () => {
  it("AC-GEN-01 / AC-GEN-02: one Enter = one job; repeated clientRequestId returns the same job", async () => {
    h = makeHarness();
    const input = textJob();
    const a = h.coord.createJobs(input);
    const b = h.coord.createJobs(input);
    const c = h.coord.createJobs(input);
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(h.repo.queryJobs({}).total).toBe(1);
    expect(job(h, a[0]).state).toBe("queued");
  });

  it("AC-GEN-11: no ready account → job waits, then runs when an account becomes ready", async () => {
    h = makeHarness();
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.repo.updateAccount(A, { state: "cooling_down", stateUntil: h.clock.t + 120_000 });
    h.repo.updateAccount(B, { state: "needs_login" });
    const [id] = h.coord.createJobs(textJob());
    await settle(h, 3);
    expect(job(h, id).state).toBe("queued");
    h.clock.t += 121_000;
    await h.coord.tick();
    await settle(h);
    expect(job(h, id).state).toBe("completed");
    expect(job(h, id).accountId).toBe(A);
  });

  it("AC-GEN-06: repeat 3 creates 3 jobs with the same prompt", async () => {
    h = makeHarness();
    const ids = h.coord.createJobs(textJob("lặp", { repeat: 3 }));
    expect(ids).toHaveLength(3);
    expect(new Set(ids.map((i) => job(h, i).prompt))).toEqual(new Set(["lặp"]));
  });
});

describe("happy path + media pipeline", () => {
  it("AC-GEN-05 (fake adapter): completed job has a file under the R13 layout and an asset row", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    await settle(h);
    const j = job(h, id);
    expect(j.state).toBe("completed");
    const assets = h.repo.assetsForJob(id);
    expect(assets).toHaveLength(1);
    expect(fs.existsSync(assets[0].path)).toBe(true);
    expect(path.relative(path.join(h.dir, "Library"), assets[0].path).split(path.sep)[1]).toBe("Lẻ");
    expect(assets[0].accountAlias).toBe("Mây");
  });

  it("AC-JOB-05: download fails twice then succeeds → completed, not resubmitted, 3 download attempts", async () => {
    h = makeHarness({ cfg: () => ({ script: [{ phase: "download", error: "DOWNLOAD_FAILED" }, { phase: "download", error: "DOWNLOAD_FAILED" }] }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    // A fresh Usage snapshot, so the single scheduler pass below goes straight to the job (no first read, spec R71 a).
    h.repo.updateAccount(A, { quota: { plan: "Free plan", usedPercent: 5, readAt: h.clock.t, additional: null } });
    const [id] = h.coord.createJobs(textJob());
    // Download retry delays are real timers (5 s, 15 s); shorten by patching the module constant via fake timers is overkill:
    // assert the intermediate state instead, then let delays elapse.
    h.coord.runScheduler();
    await h.coord.idle();
    expect(job(h, id).state).toBe("completed");
    expect(h.adapters.get(A)!.calls.submit).toBe(1);
    const downloads = h.repo.attemptsForJob(id).filter((a) => a.phase === "download");
    expect(downloads).toHaveLength(3);
  }, 40_000);

  it("AC-JOB-07: HTML saved as .mp4 is never completed → download_retry", async () => {
    h = makeHarness({ cfg: () => ({ script: [{ phase: "download", error: "HTML" }] }) });
    await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob("video", { kind: "video" }));
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 200));
    expect(job(h, id).state).toBe("download_retry");
    await h.coord.idle();
    expect(job(h, id).state).toBe("completed");
  }, 30_000);

  it("AC-JOB-06: two workers download concurrently into their own job", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 50 }) });
    await seedAccounts(h, ["Mây", "Sương"]);
    const ids = h.coord.createJobs(textJob("song song", { repeat: 2 }));
    await settle(h);
    const [a1, a2] = ids.map((i) => h.repo.assetsForJob(i));
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(1);
    expect(a1[0].sha256).not.toBe(a2[0].sha256);
    expect(new Set(ids.map((i) => job(h, i).accountId)).size).toBe(2);
    expect(a1[0].path).toContain(ids[0].replace(/-/g, "").slice(0, 6));
  });
});

describe("errors and recovery", () => {
  it("AC-JOB-01: network error before send → 30 s → 120 s → failed after 3 attempts", async () => {
    h = makeHarness({ cfg: () => ({ script: [1, 2, 3].map(() => ({ phase: "submit" as const, error: "PRE_SUBMIT_TRANSIENT" as const })) }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    await settle(h, 2);
    expect(job(h, id).state).toBe("retry_wait");
    expect(job(h, id).stateUntil).toBe(h.clock.t + 30_000);
    h.clock.t += 30_000;
    await h.coord.tick();
    await settle(h, 2);
    expect(job(h, id).state).toBe("retry_wait");
    expect(job(h, id).stateUntil).toBe(h.clock.t + 120_000);
    h.clock.t += 120_000;
    await h.coord.tick();
    await settle(h, 2);
    expect(job(h, id).state).toBe("failed");
    expect(h.repo.attemptsForJob(id).filter((a) => a.phase === "generate")).toHaveLength(3);
    expect(h.adapters.get(A)!.sentPrompts).toHaveLength(0);
  });

  it("AC-GEN-09: content refused → failed, never resent, never moved to another account", async () => {
    h = makeHarness({ cfg: () => ({ script: [{ phase: "observe", error: "CONTENT_REFUSED" }] }) });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.repo.updateAccount(B, { state: "paused" });
    const [id] = h.coord.createJobs(textJob());
    await settle(h);
    h.repo.updateAccount(B, { state: "ready" });
    await settle(h);
    expect(job(h, id).state).toBe("failed");
    expect(job(h, id).errorClass).toBe("CONTENT_REFUSED");
    expect(job(h, id).accountId).toBe(A);
    expect(h.adapters.get(A)!.calls.submit).toBe(1);
    expect(h.adapters.get(B)?.calls.submit ?? 0).toBe(0);
    expect(() => h.coord.retryJob(id)).toThrow();
  });

  it("AC-JOB-09: quota at A with reset 15:40 → A limit_reached until 15:40, unsent job moves to B, proxy unchanged", async () => {
    const reset = new Date("2026-10-26T15:40:00+07:00").getTime();
    h = makeHarness({ cfg: (id) => ({ script: id === "__A" ? [] : [] }) });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.fakeCfg(A).script = [{ phase: "submit", error: "QUOTA_LIMIT", resetAt: reset }];
    h.repo.updateAccount(B, { state: "paused" });
    const proxyBefore = h.repo.getAccount(A)!.proxyId;
    const [id] = h.coord.createJobs(textJob());
    await settle(h, 3);
    expect(h.repo.getAccount(A)!.state).toBe("limit_reached");
    expect(h.repo.getAccount(A)!.stateUntil).toBe(reset);
    expect(job(h, id).state).toBe("queued");
    h.repo.updateAccount(B, { state: "ready" });
    await settle(h);
    expect(job(h, id).state).toBe("completed");
    expect(job(h, id).accountId).toBe(B);
    expect(h.repo.getAccount(A)!.proxyId).toBe(proxyBefore);
  });

  it("AC-ACC-07: proxy dies at A → A proxy_error, unsent job goes to B", async () => {
    h = makeHarness();
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.fakeCfg(A).script = [{ phase: "submit", error: "PROXY_FAILED" }];
    h.repo.updateAccount(B, { state: "paused" });
    const [id] = h.coord.createJobs(textJob("chọn A", { accountPref: "auto" }));
    await settle(h, 3);
    expect(h.repo.getAccount(A)!.state).toBe("proxy_error");
    expect(h.repo.getProxy(h.repo.getAccount(A)!.proxyId!)!.health).toBe("failed");
    h.repo.updateAccount(B, { state: "ready" });
    await settle(h);
    expect(job(h, id).accountId).toBe(B);
    expect(job(h, id).state).toBe("completed");
  });

  it("AC-JOB-02: intent written, crash before acceptance, not in Muse history → needs_review, 0 resends", async () => {
    h = makeHarness({ cfg: () => ({ history: new Map() }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    h.repo.updateJob(id, { state: "submitting", accountId: A, submitIntentAt: h.clock.t }, h.clock.t);
    h.coord.recover();
    await settle(h);
    expect(job(h, id).state).toBe("needs_review");
    expect(h.adapters.get(A)!.calls.submit).toBe(0);
  });

  it("AC-JOB-03: same crash but Muse history has the matching thread → continues to download, no new job", async () => {
    const prompt = "Một tách cà phê trên bàn gỗ";
    h = makeHarness({ cfg: () => ({ history: new Map([[prompt, "thread-xyz"]]) }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob(prompt));
    h.repo.updateJob(id, { state: "submitting", accountId: A, submitIntentAt: h.clock.t }, h.clock.t);
    h.coord.recover();
    await settle(h);
    expect(job(h, id).state).toBe("completed");
    expect(job(h, id).remoteRef).toBe("thread-xyz");
    expect(h.adapters.get(A)!.calls.submit).toBe(0);
    expect(h.repo.queryJobs({}).total).toBe(1);
  });

  it("AC-JOB-04: 100 confirmed jobs survive a hard stop", async () => {
    h = makeHarness();
    for (let i = 0; i < 100; i++) h.coord.createJobs(textJob(`p${i}`));
    const dir = h.dir;
    // Simulate a hard kill: drop the handle without a graceful shutdown, reopen the same file.
    h.close();
    h = makeHarness({ dir });
    expect(h.repo.queryJobs({ states: ["queued"] }).total).toBe(100);
  });

  it("AC-JOB-08: stop waiting on a generating job → cancelled with the quota warning", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 2000 }) });
    await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    h.coord.runScheduler();
    for (let i = 0; i < 50 && job(h, id).state !== "generating"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(job(h, id).state).toBe("generating");
    h.coord.cancelJob(id);
    await h.coord.idle();
    expect(job(h, id).state).toBe("cancelled");
    expect(job(h, id).errorMessage).toContain("Muse có thể vẫn tạo và tính hạn mức");
  });

  it("after-send ambiguous error goes to needs_review (never resubmitted)", async () => {
    h = makeHarness({ cfg: () => ({ script: [{ phase: "submit", error: "AMBIGUOUS_SUBMIT", afterSend: true }] }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    await settle(h);
    expect(job(h, id).state).toBe("needs_review");
    expect(h.adapters.get(A)!.calls.submit).toBe(1);
  });
});

describe("batches", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ line: i + 1, prompt: `dòng ${i}`, kind: "image" as const, mode: "text" as const, reference: null, repeat: 1, error: null }));
  const settings = { kind: "image" as const, mode: "text" as const, accountPref: "auto", repeat: 1 };

  it("AC-BAT-05: a 40-row draft survives a crash", async () => {
    h = makeHarness();
    const b = h.coord.saveDraft({ name: "Nháp", settings, rows: rows(40) });
    const dir = h.dir;
    h.close();
    h = makeHarness({ dir });
    expect(h.repo.getBatch(b.id)!.rows).toHaveLength(40);
  });

  it("AC-BAT-03: pause holds waiting jobs; jobs already generating finish", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 300 }) });
    await seedAccounts(h, ["Mây", "Sương"]);
    const b = h.coord.saveDraft({ name: "Lô 20", settings, rows: rows(20) });
    h.coord.startBatch(b.id, new Map());
    h.coord.runScheduler();
    for (let i = 0; i < 100 && h.repo.jobsForBatch(b.id, ["generating"]).length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    h.coord.pauseBatch(b.id);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(18);
    await h.coord.idle();
    expect(h.repo.jobsForBatch(b.id, ["completed"])).toHaveLength(2);
    expect(h.repo.getBatch(b.id)!.state).toBe("paused");
    h.coord.resumeBatch(b.id);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(0);
  });

  it("AC-BAT-04: retry failed re-runs network failures but not content refusals", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    const b = h.coord.saveDraft({ name: "Lô lỗi", settings, rows: rows(4) });
    h.coord.startBatch(b.id, new Map());
    const jobs = h.repo.jobsForBatch(b.id);
    jobs.slice(0, 3).forEach((j) => h.repo.updateJob(j.id, { state: "failed", errorClass: "PRE_SUBMIT_TRANSIENT" }, h.clock.t));
    h.repo.updateJob(jobs[3].id, { state: "failed", errorClass: "CONTENT_REFUSED" }, h.clock.t);
    h.coord.retryFailed(b.id);
    expect(h.repo.jobsForBatch(b.id, ["queued"]).map((j) => j.id)).toEqual(jobs.slice(0, 3).map((j) => j.id));
    expect(job(h, jobs[3].id).state).toBe("failed");
  });

  it("AC-APP-04 (logic): a finished batch notifies exactly once", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây", "Sương"]);
    const b = h.coord.saveDraft({ name: "Lô 10", settings, rows: rows(10) });
    h.coord.startBatch(b.id, new Map());
    await settle(h, 40);
    expect(h.repo.getBatch(b.id)!.state).toBe("done");
    const done = h.notices.filter((n) => n.kind === "batch_done");
    expect(done).toHaveLength(1);
    expect(done[0].title).toBe("Lô “Lô 10” xong: 10/10");
    expect(done[0].route).toBe(`/batch/${b.id}`);
  });

  it("only drafts can be deleted", async () => {
    h = makeHarness();
    const b = h.coord.saveDraft({ name: "x", settings, rows: rows(1) });
    h.coord.startBatch(b.id, new Map());
    expect(() => h.coord.deleteDraft(b.id)).toThrow();
  });
});

describe("accounts and proxies", () => {
  it("AC-ACC-04: cookies exist but Muse asks to log in → session check gives needs_login, never ready; checkpoint and unknown errors map separately", async () => {
    h = makeHarness();
    const [A, B, C] = await seedAccounts(h, ["Mây", "Sương", "Gió"]);
    h.fakeCfg(A).script = [{ phase: "session", error: "SESSION_EXPIRED" }];
    h.fakeCfg(B).script = [{ phase: "session", error: "CHECKPOINT" }];
    h.fakeCfg(C).script = [{ phase: "session", error: "UNKNOWN" }];
    await h.coord.checkSession(A);
    await h.coord.checkSession(B);
    await h.coord.checkSession(C);
    expect(h.repo.getAccount(A)!.state).toBe("needs_login");
    expect(h.repo.getAccount(B)!.state).toBe("checkpoint");
    expect(h.repo.getAccount(C)!.state).toBe("cooling_down");
  });

  it("AC-ACC-07: a dead proxy puts only that account in proxy_error, marks that proxy failed, and exit-IP never answers directly", async () => {
    const down = new Set<string>();
    h = makeHarness({ cfg: (id) => ({ get proxyDown() { return down.has(id); } }) as never });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    expect(await h.coord.exitIp(A)).toEqual({ ip: expect.stringContaining("•"), country: "US" });
    down.add(A);
    await h.coord.checkSession(A);
    expect(h.repo.getAccount(A)!.state).toBe("proxy_error");
    expect(h.repo.getProxy(h.repo.getAccount(A)!.proxyId!)!.health).toBe("failed");
    await expect(h.coord.exitIp(A)).rejects.toThrow("proxy của tài khoản này không kết nối được");
    // B and its proxy are untouched
    await h.coord.checkSession(B);
    expect(h.repo.getAccount(B)!.state).toBe("ready");
    expect(h.repo.getProxy(h.repo.getAccount(B)!.proxyId!)!.health).toBe("healthy");
    // proxy back → session check recovers the account and the proxy
    down.delete(A);
    await h.coord.checkSession(A);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(h.repo.getProxy(h.repo.getAccount(A)!.proxyId!)!.health).toBe("healthy");
  });

  it("AC-ACC-02: no healthy free proxy → cannot add account", async () => {
    h = makeHarness();
    expect(() => h.coord.addAccount({ alias: "Mây", avatar: 0 })).toThrow(/proxy/i);
  });

  it("AC-PRXS-02 (replaces AC-PRX-02): a proxy used by A may be given to B as well", async () => {
    h = makeHarness();
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    const pA = h.repo.getAccount(A)!.proxyId!;
    const pB = h.repo.getAccount(B)!.proxyId!;
    const r = await h.coord.setAccountProxy(B, pA);
    expect(r.changed).toBe(true);
    expect(h.repo.accountsOnProxy(pA).map((a) => a.alias).sort()).toEqual(["Mây", "Sương"]);
    expect(h.repo.accountsOnProxy(pB)).toEqual([]);
  });

  it("AC-ACC-08: removing A returns unsent jobs, keeps assets, frees the proxy", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const [done] = h.coord.createJobs(textJob("xong"));
    await settle(h);
    expect(job(h, done).state).toBe("completed");
    h.repo.updateAccount(A, { state: "paused" });
    const pinned = h.coord.createJobs(textJob("chờ", { accountPref: A, repeat: 2 }));
    const proxyId = h.repo.getAccount(A)!.proxyId!;
    const r = await h.coord.removeAccount(A);
    expect(r.removed).toBe(true);
    expect(pinned.map((id) => job(h, id).accountPref)).toEqual(["auto", "auto"]);
    expect(h.repo.accountsOnProxy(proxyId)).toEqual([]);
    expect(h.repo.assetsForJob(done)).toHaveLength(1);
    expect(h.repo.getAccount(A)).toBeNull();
  });

  it("AC-ACC-08: an after-submit job blocks removal until forced", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 3000 }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    h.coord.runScheduler();
    for (let i = 0; i < 50 && job(h, id).state !== "generating"; i++) await new Promise((r) => setTimeout(r, 10));
    const r = await h.coord.removeAccount(A, false, 50);
    expect(r.needsForce).toBe(true);
    const r2 = await h.coord.removeAccount(A, true);
    expect(r2.removed).toBe(true);
    expect(job(h, id).state).toBe("needs_review");
  });

  it("AC-ACC-05: takeover after the current job; no new work until handed back", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 200 }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const [first, second] = h.coord.createJobs(textJob("hai", { repeat: 2 }));
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 20));
    h.coord.takeoverStart(A, "afterCurrent");
    await h.coord.idle();
    await settle(h, 3);
    expect(job(h, first).state).toBe("completed");
    expect(h.repo.getAccount(A)!.state).toBe("takeover");
    expect(job(h, second).state).toBe("queued");
    await h.coord.takeoverEnd(A);
    await settle(h);
    expect(job(h, second).state).toBe("completed");
  });

  it("AC-PRX-01: re-pasting the provider list adds only new proxies; duplicates are skipped, malformed listed with position", () => {
    h = makeHarness();
    h.coord.importProxies("10.0.0.1:9000:u:p");
    const res = h.coord.importProxies("10.0.0.1:9000:u:p 10.0.0.2:9001:u:p 10.0.0.3:notaport:u:p");
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([{ line: 1, item: 3, error: "Cổng proxy phải là số" }]);
    expect(h.repo.listProxies()).toHaveLength(2);
  });

  it("AC-PRX-03: test all updates each proxy and counts healthy/failed", async () => {
    h = makeHarness();
    h.coord.importProxies(["1.1.1.1:80:u:p", "1.1.1.2:80:u:p", "1.1.1.3:80:u:p"].join("\n"));
    const ps = h.repo.listProxies();
    h.proxyTest.set(ps[1].id, { ok: false, error: "timeout" });
    const r = await h.coord.testAllProxies();
    expect(r).toEqual({ healthy: 2, failed: 1 });
    const updates = h.events.filter((e) => e.type === "proxy");
    expect(updates.length).toBeGreaterThanOrEqual(6);
  });

  it("AC-SEC-01: canary proxy password never reaches the database file or logs", async () => {
    h = makeHarness();
    h.coord.importProxies("9.9.9.9:3128:canaryuser:CANARY-PX-7731");
    const p = h.repo.listProxies()[0];
    await h.coord.testProxy(p.id);
    const acc = h.coord.addAccount({ alias: "Canary", avatar: 1 });
    h.repo.updateAccount(acc.id, { state: "ready" });
    h.coord.createJobs(textJob());
    await settle(h);
    h.repo.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const dbBytes = fs.readFileSync(h.dbFile).toString("latin1");
    expect(dbBytes).not.toContain("CANARY-PX-7731");
    expect(h.logs.join("\n")).not.toContain("CANARY-PX-7731");
    expect(JSON.stringify(h.events)).not.toContain("CANARY-PX-7731");
    expect(h.coord.proxyCreds(p.id).password).toBe("CANARY-PX-7731");
  });
});
