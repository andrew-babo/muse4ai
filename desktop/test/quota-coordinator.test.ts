import { afterEach, describe, expect, it } from "vitest";
import { schedule } from "../src/shared/scheduler";
import { VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import type { Quota } from "../src/shared/types";
import { job, makeHarness, seedAccounts, settle, textJob, type Harness } from "./helpers";

// Spec rev 8 §13 — coordinator + SQLite + fake adapter (AC-QTA-02, 03, 04, 06, 07, 08, 09, 10, 13, 14).

let h: Harness;
afterEach(() => h?.close());

const MIN = 60_000;
const ADD_5B = "\nAdditional tokens\nNever expires\n0% used (5B tokens left)";
const usage = (weekly: number, extra = ADD_5B, reset = "Nov 2") => `Free plan\nWeekly limit resets on ${reset}\n${weekly}% used${extra}\nUpgrade`;
const nov2 = () => new Date(2026, 10, 2, 0, 0, 0, 0).getTime();
const snap = (used: number, readAt: number, extra: Partial<Quota> = {}): Quota => ({
  plan: "Free plan",
  usedPercent: used,
  resetsOn: "Nov 2",
  resetAt: nov2(),
  additional: { usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5e9, expiryLabel: "Never expires" },
  readAt,
  ...extra,
});
const reads = (id: string) => h.fakeCfg(id).quotaReads ?? 0;
const quotaNotices = () => h.notices.filter((n) => n.kind === "quota");

async function setup(aliases: string[]): Promise<string[]> {
  h = makeHarness();
  const ids = await seedAccounts(h, aliases);
  for (const id of ids) h.fakeCfg(id).now = () => h.clock.t;
  return ids;
}

/** One job at a time, the clock moving `stepMs` (default 1 s) before each (sent-after-read is strict). */
async function runJobs(n: number, accountPref = "auto", stepMs = 1000): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    h.clock.t += stepMs;
    const [id] = h.coord.createJobs(textJob(`lượt ${out.length}-${h.clock.t}`, { accountPref }));
    await settle(h, 6);
    out.push(id);
  }
  return out;
}

describe("AC-QTA-03: automatic reads between jobs (R71)", () => {
  it("40 %: no read after 4 sent jobs, one read after the 5th; never while a job runs", async () => {
    const [A] = await setup(["Mây"]);
    h.fakeCfg(A).quota = usage(40);
    // Read 11 minutes ago: past the R103 ten-minute gap, short of the 30-minute age reason.
    h.repo.updateAccount(A, { quota: snap(40, h.clock.t - 11 * MIN) });
    const ids = await runJobs(4);
    expect(ids.map((id) => job(h, id).state)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(reads(A)).toBe(0);
    await runJobs(1);
    expect(reads(A)).toBe(1);
    expect(h.repo.getAccount(A)!.quota).toMatchObject({ usedPercent: 40, readAt: h.clock.t, failures: 0 });
  });

  it("85 %: a read after every job (jobs 10 minutes apart, R103)", async () => {
    const [A] = await setup(["Mây"]);
    h.fakeCfg(A).quota = usage(85);
    h.repo.updateAccount(A, { quota: snap(85, h.clock.t - 1000) });
    await runJobs(3, "auto", 10 * MIN);
    expect(reads(A)).toBe(3);
  });

  it("R103: 85 % and jobs 1 s apart → one read per 10 minutes, not one per job", async () => {
    const [A] = await setup(["Mây"]);
    h.fakeCfg(A).quota = usage(85);
    h.repo.updateAccount(A, { quota: snap(85, h.clock.t - 11 * MIN) });
    await runJobs(4);
    expect(reads(A)).toBe(1);
    h.clock.t += 10 * MIN;
    await runJobs(1);
    expect(reads(A)).toBe(2);
  });

  it("no snapshot + a queued job → read first, the job waits during the read, then runs; idle with nothing new → 0 reads", async () => {
    const [A, B] = await setup(["Mây", "Sương"]);
    h.repo.updateAccount(B, { state: "paused" });
    h.fakeCfg(A).quota = usage(30);
    h.fakeCfg(A).quotaDelayMs = 60;
    const [id] = h.coord.createJobs(textJob());
    h.coord.runScheduler();
    expect(reads(A)).toBe(1);
    expect(h.coord.snapshot().accounts.find((a) => a.id === A)!.quotaReading).toBe(true);
    h.coord.runScheduler(); // a second pass during the read hands A nothing
    expect(job(h, id).state).toBe("queued");
    await settle(h, 6);
    expect(job(h, id).state).toBe("completed");
    expect(job(h, id).accountId).toBe(A);
    expect(reads(A)).toBe(1);
    // B (paused, no work) and A afterwards (fresh snapshot, nothing sent since): nothing more for 3 hours of passes.
    for (let i = 0; i < 6; i++) {
      h.clock.t += 30 * MIN;
      await h.coord.tick();
    }
    await settle(h, 3);
    expect(reads(A)).toBe(1);
    expect(reads(B)).toBe(0);
  });

  it("start-up session check reads Usage when the snapshot is older than 30 minutes, not when it is fresh", async () => {
    const [A, B] = await setup(["Mây", "Sương"]);
    h.fakeCfg(A).quota = usage(20);
    h.fakeCfg(B).quota = usage(20);
    h.repo.updateAccount(A, { quota: snap(20, h.clock.t - 31 * MIN) });
    h.repo.updateAccount(B, { quota: snap(20, h.clock.t - 5 * MIN) });
    h.coord.revalidateSessions();
    await settle(h, 6);
    expect(reads(A)).toBe(1);
    expect(reads(B)).toBe(0);
  });
});

describe("AC-QTA-02/04: failed reads keep the numbers, back off, never block work", () => {
  it("read fails → previous 51 % kept with the error; jobs still run; no automatic read for 10 then 30 minutes", async () => {
    const [A] = await setup(["Mây"]);
    const t0 = h.clock.t;
    h.repo.updateAccount(A, { quota: snap(51, t0 - 40 * MIN) });
    h.fakeCfg(A).quota = () => {
      throw new Error("Cài đặt không mở");
    };
    await runJobs(1); // 1 sent + snapshot older than 30 min → read → fails
    let q = h.repo.getAccount(A)!.quota!;
    expect(reads(A)).toBe(1);
    expect(q).toMatchObject({ usedPercent: 51, readAt: t0 - 40 * MIN, failures: 1 });
    expect(q.error).toBeTruthy();
    const ids = await runJobs(2);
    expect(ids.map((id) => job(h, id).state)).toEqual(["completed", "completed"]);
    expect(reads(A)).toBe(1); // inside the 10-minute back-off
    h.clock.t = (q.checkedAt ?? 0) + 10 * MIN;
    await settle(h, 4);
    expect(reads(A)).toBe(2);
    q = h.repo.getAccount(A)!.quota!;
    expect(q.failures).toBe(2);
    h.clock.t = (q.checkedAt ?? 0) + 29 * MIN;
    await settle(h, 4);
    expect(reads(A)).toBe(2);
    h.clock.t += 1 * MIN;
    await settle(h, 4);
    expect(reads(A)).toBe(3);
  });

  it("the button still reads during the back-off and reports the failure", async () => {
    const [A] = await setup(["Mây"]);
    h.repo.updateAccount(A, { quota: snap(51, h.clock.t - 1000, { failures: 1, checkedAt: h.clock.t, error: "x" }) });
    h.fakeCfg(A).quota = usage(52);
    const a = await h.coord.readQuota(A);
    expect(a.quota).toMatchObject({ usedPercent: 52, failures: 0, error: null });
    h.fakeCfg(A).quota = "Free plan\n140% used";
    await expect(h.coord.readQuota(A)).rejects.toThrow();
    expect(h.repo.getAccount(A)!.quota).toMatchObject({ usedPercent: 52, failures: 1 });
  });
});

describe("AC-QTA-06: nothing left → blocked before any send (R73)", () => {
  for (const [name, text] of [
    ["no additional part", usage(100, "")],
    ["additional 0 left", usage(100, "\nAdditional tokens\n100% used (0 tokens left)")],
  ] as const) {
    it(`${name}: A limit_reached until 02/11 00:00, Auto jobs on B, the job picked for A waits, 0 sends to A, 1 notice`, async () => {
      const [A, B] = await setup(["Mây", "Sương"]);
      h.fakeCfg(A).quota = text;
      h.repo.updateAccount(B, { quota: snap(30, h.clock.t - 1000), lastActiveAt: h.clock.t }); // B idle for less time than A
      const pinned = h.coord.createJobs(textJob("chọn Mây", { accountPref: A }))[0];
      const auto = h.coord.createJobs(textJob("tự động 1"))[0];
      await settle(h, 10);
      const a = h.repo.getAccount(A)!;
      expect(a.state).toBe("limit_reached");
      expect(a.stateUntil).toBe(nov2());
      expect(a.stateNote).toBe("Hết hạn mức tuần (Muse báo 100 %) · đặt lại 02/11");
      expect(a.quota?.limitFrom).toBe("usage");
      expect(job(h, auto).state).toBe("completed");
      expect(job(h, auto).accountId).toBe(B);
      expect(job(h, pinned).state).toBe("queued");
      expect(h.adapters.get(A)!.calls.submit).toBe(0);
      expect(quotaNotices()).toHaveLength(1);
      expect(quotaNotices()[0]).toMatchObject({ title: "Mây hết hạn mức", body: "Lượt mới chuyển sang tài khoản khác" });
    });
  }

  it("a step bound to the blocked owner is never assigned elsewhere (R60 + R73)", () => {
    const out = schedule({
      queued: [{ id: "s1", kind: "video", mode: "text", accountPref: "auto", priority: 1, seq: 1, operation: "extend", boundAccountId: "A" }],
      accounts: [
        { id: "A", state: "limit_reached", proxyHealthy: true, running: 0, lastActiveAt: 1, capabilities: {} },
        { id: "B", state: "ready", proxyHealthy: true, running: 0, lastActiveAt: 1, capabilities: {} },
      ],
      perAccount: 1,
      globalCap: 4,
      totalRunning: 0,
      verified: { ...VERIFIED_CAPABILITIES, "muse.video.extend": true },
    });
    expect(out).toEqual([]);
  });
});

describe("AC-QTA-07: weekly full with additional tokens left", () => {
  it("stays ready, goes last in Tự động, read after every job; unreadable additional part never blocks", async () => {
    const [A, B] = await setup(["Mây", "Sương"]);
    h.repo.updateAccount(A, { quota: snap(100, h.clock.t - 11 * MIN), lastActiveAt: 1 }); // idle longest, but group 2; read past the R103 gap
    h.repo.updateAccount(B, { quota: snap(30, h.clock.t - 1000), lastActiveAt: h.clock.t });
    h.fakeCfg(A).quota = usage(100);
    h.fakeCfg(B).quota = usage(30);
    const [one] = await runJobs(1);
    expect(job(h, one).accountId).toBe(B);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    h.repo.updateAccount(B, { state: "paused" });
    await runJobs(1);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(reads(A)).toBe(1); // after its one job
    h.fakeCfg(A).quota = usage(100, "\nAdditional tokens\nNever expires");
    await h.coord.readQuota(A);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
  });
});

describe("AC-QTA-08: end of a limit (R74)", () => {
  it("at the time: read again; still 100 % → +60 min with one read in that hour; 3 % → ready and the waiting job runs", async () => {
    const [A] = await setup(["Mây"]);
    const T = h.clock.t + 2 * 60 * MIN;
    h.repo.updateAccount(A, { state: "limit_reached", stateUntil: T, quota: snap(100, h.clock.t - 1000, { additional: null, limitFrom: "usage" }) });
    h.fakeCfg(A).quota = usage(100, "", "Oct 26"); // Muse still shows today's (already passed) reset date
    const [pinned] = h.coord.createJobs(textJob("chờ Mây", { accountPref: A }));
    await settle(h, 4);
    expect(reads(A)).toBe(0);
    h.clock.t = T;
    await h.coord.tick();
    await settle(h, 6);
    expect(reads(A)).toBe(1);
    expect(h.repo.getAccount(A)!.state).toBe("limit_reached");
    expect(h.repo.getAccount(A)!.stateUntil).toBe(T + 60 * MIN);
    expect(h.adapters.get(A)!.calls.submit).toBe(0);
    for (let i = 0; i < 5; i++) {
      h.clock.t += 10 * MIN;
      await h.coord.tick();
      await settle(h, 2);
    }
    expect(reads(A)).toBe(1);
    h.fakeCfg(A).quota = usage(3);
    h.clock.t = T + 60 * MIN;
    await h.coord.tick();
    await settle(h, 8);
    expect(reads(A)).toBe(2);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(job(h, pinned).state).toBe("completed");
  });
});

describe("AC-QTA-09: the button lifts only a limit the snapshot set", () => {
  it("usage limit + read 70 % → ready at once; Muse-reported limit until 15:40 + read 70 % → kept", async () => {
    const [A, B] = await setup(["Mây", "Sương"]);
    h.repo.updateAccount(A, { state: "limit_reached", stateUntil: h.clock.t + 5 * 60 * MIN, quota: snap(100, h.clock.t - 1000, { additional: null, limitFrom: "usage" }) });
    h.fakeCfg(A).quota = usage(70);
    expect((await h.coord.readQuota(A)).state).toBe("ready");
    expect(h.repo.getAccount(A)!.quota?.limitFrom).toBeNull();
    const until = h.clock.t + 40 * MIN;
    h.repo.updateAccount(B, { state: "limit_reached", stateUntil: until, quota: snap(60, h.clock.t - 1000, { limitFrom: "muse" }) });
    h.fakeCfg(B).quota = usage(70);
    const b = await h.coord.readQuota(B);
    expect(b.state).toBe("limit_reached");
    expect(b.stateUntil).toBe(until);
  });
});

describe("AC-QTA-10: Muse reports a limit (R5 + R73)", () => {
  it("job failed QUOTA_LIMIT; one read right after; nothing left → until Muse's reset 02/11 00:00", async () => {
    const [A] = await setup(["Mây"]);
    h.repo.updateAccount(A, { quota: snap(90, h.clock.t - 1000) });
    h.fakeCfg(A).script = [{ phase: "observe", error: "QUOTA_LIMIT" }];
    h.fakeCfg(A).quota = usage(100, "");
    const [id] = await runJobs(1);
    expect(job(h, id).state).toBe("failed");
    expect(job(h, id).errorClass).toBe("QUOTA_LIMIT");
    expect(reads(A)).toBe(1);
    const a = h.repo.getAccount(A)!;
    expect(a.state).toBe("limit_reached");
    expect(a.stateUntil).toBe(nov2());
    expect(a.quota?.limitFrom).toBe("muse");
  });
  it("snapshot still 60 % → keeps R5's 60 minutes", async () => {
    const [A] = await setup(["Mây"]);
    h.repo.updateAccount(A, { quota: snap(50, h.clock.t - 1000) });
    h.fakeCfg(A).script = [{ phase: "observe", error: "QUOTA_LIMIT" }];
    h.fakeCfg(A).quota = usage(60);
    await runJobs(1);
    const a = h.repo.getAccount(A)!;
    expect(reads(A)).toBe(1);
    expect(a.state).toBe("limit_reached");
    expect(a.stateUntil).toBe(h.clock.t + 60 * MIN);
  });
});

describe("AC-QTA-13: older snapshots and restart", () => {
  it("a beta.35 snapshot (no additional part recorded) at 100 % never blocks early; the sent count survives a restart", async () => {
    const [A] = await setup(["Mây"]);
    const old = { plan: "Free plan", usedPercent: 100, resetsOn: "Nov 2", readAt: h.clock.t - 1000 } as Quota;
    h.repo.updateAccount(A, { quota: old });
    h.fakeCfg(A).quota = () => {
      throw new Error("không đọc");
    };
    const ids = await runJobs(3);
    expect(ids.every((id) => job(h, id).state === "completed")).toBe(true);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    expect(h.repo.getAccount(A)!.quota).toMatchObject({ usedPercent: 100, resetsOn: "Nov 2", readAt: old.readAt });
    const dir = h.dir;
    h.close();
    h = makeHarness({ dir });
    expect(h.repo.museSentSince(A, old.readAt)).toBe(3);
    expect(h.repo.getAccount(A)!.quota).toMatchObject({ usedPercent: 100, readAt: old.readAt });
  });
});

describe("AC-QTA-14: notices once per transition", () => {
  it("A (usage) then B (Muse) → 2 account notices + 1 “all out”; 20 ticks add none; after A works again, all out again → 1 more", async () => {
    const [A, B] = await setup(["Mây", "Sương"]);
    h.repo.updateAccount(B, { quota: snap(10, h.clock.t - 1000) });
    h.fakeCfg(A).quota = usage(100, "");
    await h.coord.readQuota(A);
    expect(quotaNotices().map((n) => n.title)).toEqual(["Mây hết hạn mức"]);
    h.fakeCfg(B).script = [{ phase: "observe", error: "QUOTA_LIMIT" }];
    h.fakeCfg(B).quota = usage(10);
    await runJobs(1);
    expect(h.repo.getAccount(B)!.state).toBe("limit_reached");
    expect(quotaNotices().map((n) => n.title)).toEqual(["Mây hết hạn mức", "Sương hết hạn mức", "Tất cả tài khoản Muse đã hết hạn mức"]);
    expect(quotaNotices()[1].body).toMatch(/^Lượt chờ tới /);
    for (let i = 0; i < 20; i++) await h.coord.tick();
    await settle(h, 2);
    expect(quotaNotices()).toHaveLength(3);
    h.fakeCfg(A).quota = usage(5);
    await h.coord.readQuota(A); // usage limit lifted
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    h.fakeCfg(A).quota = usage(100, "");
    await h.coord.readQuota(A);
    expect(quotaNotices().map((n) => n.title).slice(3)).toEqual(["Mây hết hạn mức", "Tất cả tài khoản Muse đã hết hạn mức"]);
  });
});
