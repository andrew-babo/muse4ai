import { describe, expect, it } from "vitest";
import { schedule, type SchedAccount, type SchedInput, type SchedJob } from "../src/shared/scheduler";
import { VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import { UI_PAGE_MIN_FREE_BYTES } from "../src/shared/execution";

const acc = (id: string, over: Partial<SchedAccount> = {}): SchedAccount => ({
  id,
  state: "ready",
  proxyHealthy: true,
  running: 0,
  lastActiveAt: null,
  capabilities: {},
  execMode: "auto",
  maxConcurrent: 10,
  uiMaxConcurrent: 2,
  httpUsable: true,
  runningUi: 0,
  ...over,
});
const jobs = (n: number, over: Partial<SchedJob> = {}): SchedJob[] =>
  Array.from({ length: n }, (_, i) => ({ id: `j${i}`, kind: "image", mode: "text", accountPref: "auto", priority: 0, seq: i, ...over }));
const input = (over: Partial<SchedInput>): SchedInput => ({
  queued: [],
  accounts: [],
  perAccount: 1,
  globalCap: 40,
  totalRunning: 0,
  verified: VERIFIED_CAPABILITIES,
  uiPagesCap: 8,
  uiPagesUsed: 0,
  now: 1_000,
  ...over,
});

describe("Build 2.0 R98/R100 — slots per account (AC-CC-01)", () => {
  it("max 10 and 15 jobs for that account: 10 start, 5 wait, each job assigned once", () => {
    const out = schedule(input({ queued: jobs(15, { accountPref: "A" }), accounts: [acc("A")] }));
    expect(out).toHaveLength(10);
    expect(new Set(out.map((a) => a.jobId)).size).toBe(10);
    expect(out.every((a) => a.accountId === "A" && a.path === "http")).toBe(true);
  });
  it("lowering max to 6 while 10 run cancels nothing and starts nothing until fewer than 6 run", () => {
    expect(schedule(input({ queued: jobs(5, { accountPref: "A" }), accounts: [acc("A", { maxConcurrent: 6, running: 10 })] }))).toHaveLength(0);
    expect(schedule(input({ queued: jobs(5, { accountPref: "A" }), accounts: [acc("A", { maxConcurrent: 6, running: 5 })] }))).toHaveLength(1);
  });
  it("auto order is the lowest load ratio (running/max), not the fewest running", () => {
    // A: 4/10 = 0.4, B: 1/2 = 0.5 → A first even though it runs more.
    const out = schedule(input({ queued: jobs(1), accounts: [acc("A", { running: 4 }), acc("B", { running: 1, maxConcurrent: 2 })] }));
    expect(out[0].accountId).toBe("A");
  });
  it("load ratio spreads 20 jobs over two accounts of max 10", () => {
    const out = schedule(input({ queued: jobs(20), accounts: [acc("A"), acc("B")] }));
    const per = (id: string) => out.filter((a) => a.accountId === id).length;
    expect([per("A"), per("B")]).toEqual([10, 10]);
  });
  it("AC-CC-05: A 3/10, B 1/10, C 1/5 (same quota group) → auto goes to B (0.1 < 0.2); a ratio tie goes to the lower quota group; a job pinned to A waits for A", () => {
    const three = [acc("A", { running: 3 }), acc("B", { running: 1 }), acc("C", { running: 1, maxConcurrent: 5 })];
    expect(schedule(input({ queued: jobs(1), accounts: three }))[0].accountId).toBe("B");
    // Tie on ratio (2/10 = 1/5) but different quota groups → the lower group wins, whatever the id order.
    const tie = [acc("A", { running: 2, quotaRank: 2 }), acc("Z", { running: 1, maxConcurrent: 5, quotaRank: 1 })];
    expect(schedule(input({ queued: jobs(1), accounts: tie }))[0].accountId).toBe("Z");
    // A pinned job goes only to A; with A full it waits (no other account takes it).
    expect(schedule(input({ queued: jobs(1, { accountPref: "A" }), accounts: three }))[0].accountId).toBe("A");
    expect(schedule(input({ queued: jobs(1, { accountPref: "A" }), accounts: [acc("A", { running: 10 }), acc("B")] }))).toHaveLength(0);
  });
  it("app total caps the pass (R99)", () => {
    expect(schedule(input({ queued: jobs(30), accounts: [acc("A"), acc("B"), acc("C")], globalCap: 12 }))).toHaveLength(12);
    expect(schedule(input({ queued: jobs(30), accounts: [acc("A")], globalCap: 40, totalRunning: 38 }))).toHaveLength(2);
  });
});

describe("Build 2.0 R98/R99 — UI slots, pages and memory", () => {
  it("HTTP down on auto: UI runs at most the UI cap (2) even with max 10", () => {
    const out = schedule(input({ queued: jobs(8), accounts: [acc("A", { httpUsable: false })] }));
    expect(out.map((a) => a.path)).toEqual(["ui", "ui"]);
  });
  it("UI pages app-wide cap the UI runs of all accounts", () => {
    const accounts = ["A", "B", "C", "D"].map((id) => acc(id, { execMode: "ui", uiMaxConcurrent: 5, maxConcurrent: 5 }));
    const out = schedule(input({ queued: jobs(20), accounts, uiPagesCap: 3 }));
    expect(out).toHaveLength(3);
    expect(out.every((a) => a.path === "ui")).toBe(true);
  });
  it("an extra UI page (beyond the main page) needs free memory; without it the job waits", () => {
    const a = acc("A", { execMode: "ui", uiMaxConcurrent: 3, maxConcurrent: 3 });
    expect(schedule(input({ queued: jobs(3), accounts: [a], memoryForExtraPage: false }))).toHaveLength(1);
    expect(schedule(input({ queued: jobs(3), accounts: [a], memoryForExtraPage: true }))).toHaveLength(3);
  });
  it("HTTP runs never use UI pages", () => {
    const out = schedule(input({ queued: jobs(10), accounts: [acc("A")], uiPagesCap: 1, uiPagesUsed: 1 }));
    expect(out).toHaveLength(10);
  });
  it("a Usage read on the main page blocks new UI sends only", () => {
    const a = acc("A", { mainPageBusy: true, httpUsable: false });
    expect(schedule(input({ queued: jobs(2), accounts: [a] }))).toHaveLength(0);
    expect(schedule(input({ queued: jobs(2), accounts: [{ ...a, httpUsable: true }] }))).toHaveLength(2);
  });
  it("an exclusive operation (login, takeover, proxy change) blocks every new send on the account", () => {
    expect(schedule(input({ queued: jobs(2), accounts: [acc("A", { locked: true })] }))).toHaveLength(0);
  });
});

describe("AC-CC-02/03/04 (U) — UI caps, app total, memory gate", () => {
  it("AC-CC-02: auto with HTTP down, UI max 2, 5 jobs → 2 UI runs at once; UI max 5 with max 3 → the effective UI cap is 3", () => {
    expect(schedule(input({ queued: jobs(5), accounts: [acc("A", { httpUsable: false, uiMaxConcurrent: 2 })] }))).toHaveLength(2);
    const out = schedule(input({ queued: jobs(8), accounts: [acc("A", { httpUsable: false, uiMaxConcurrent: 5, maxConcurrent: 3 })] }));
    expect(out).toHaveLength(3);
    expect(out.every((a) => a.path === "ui")).toBe(true);
  });
  it("AC-CC-03: 3 accounts × max 20 under an app total of 40 → 40 assignments, ≤ 20 per account; 12 UI accounts with 8 UI pages → 8", () => {
    const accounts = ["A", "B", "C"].map((id) => acc(id, { maxConcurrent: 20 }));
    const out = schedule(input({ queued: jobs(100), accounts, globalCap: 40 }));
    expect(out).toHaveLength(40);
    for (const id of ["A", "B", "C"]) expect(out.filter((a) => a.accountId === id).length).toBeLessThanOrEqual(20);
    expect(schedule(input({ queued: jobs(100), accounts, globalCap: 40, totalRunning: 35 }))).toHaveLength(5);
    const ui = Array.from({ length: 12 }, (_, i) => acc(`U${i}`, { execMode: "ui", maxConcurrent: 2, uiMaxConcurrent: 2 }));
    expect(schedule(input({ queued: jobs(30), accounts: ui, uiPagesCap: 8 }))).toHaveLength(8);
    expect(schedule(input({ queued: jobs(30), accounts: ui, uiPagesCap: 8, uiPagesUsed: 5 }))).toHaveLength(3);
  });
  it("AC-CC-04: an extra UI page needs ≥ 1.5 GB free; below it the job stays queued (no error), the main page still runs", () => {
    expect(UI_PAGE_MIN_FREE_BYTES).toBe(1.5 * 1024 ** 3);
    const a = acc("A", { execMode: "ui", uiMaxConcurrent: 2, maxConcurrent: 2 });
    expect(schedule(input({ queued: jobs(2), accounts: [a], memoryForExtraPage: false }))).toHaveLength(1);
    expect(schedule(input({ queued: jobs(2), accounts: [{ ...a, runningUi: 1, running: 1 }], memoryForExtraPage: false }))).toHaveLength(0);
    expect(schedule(input({ queued: jobs(2), accounts: [{ ...a, runningUi: 1, running: 1 }], memoryForExtraPage: true }))).toHaveLength(1);
  });
});

describe("Build 2.0 R87/R88 — jobs a path cannot carry", () => {
  it("http-only account: a reference-image job above the HTTP image cap waits (no UI fallback); an auto account takes it on UI", () => {
    const q = jobs(1, { mode: "reference", attachments: [{ kind: "image", bytes: 3 * 1024 * 1024 }] });
    expect(schedule(input({ queued: q, accounts: [acc("H", { execMode: "http" })] }))).toEqual([]);
    expect(schedule(input({ queued: q, accounts: [acc("H", { execMode: "http" }), acc("U")] }))).toEqual([{ jobId: "j0", accountId: "U", path: "ui" }]);
  });
  it("a small reference image runs over HTTP on an http-only account (P0-2 proven 01/11)", () => {
    const q = jobs(1, { mode: "reference", attachments: [{ kind: "image", bytes: 10_000 }] });
    expect(schedule(input({ queued: q, accounts: [acc("H", { execMode: "http" })] }))).toEqual([{ jobId: "j0", accountId: "H", path: "http" }]);
  });
  it("a chat job runs only over HTTP; on a UI-only account it waits", () => {
    const q = jobs(1, { kind: "chat" });
    expect(schedule(input({ queued: q, accounts: [acc("U", { execMode: "ui" })] }))).toEqual([]);
    expect(schedule(input({ queued: q, accounts: [acc("U", { execMode: "ui" }), acc("A")] }))).toEqual([{ jobId: "j0", accountId: "A", path: "http" }]);
  });
  it("a job that cannot run now does not block later jobs", () => {
    const q = [...jobs(1, { kind: "chat" }), ...jobs(1, { id: "x", seq: 9 }).map((j) => ({ ...j, id: "x" }))];
    expect(schedule(input({ queued: q, accounts: [acc("U", { execMode: "ui" })] }))).toEqual([{ jobId: "x", accountId: "U", path: "ui" }]);
  });
  it("a continuation is bound to its owner account (R85)", () => {
    const q = jobs(1, { kind: "chat", continues: true, boundAccountId: "B" });
    expect(schedule(input({ queued: q, accounts: [acc("A"), acc("B", { running: 9 })] }))).toEqual([{ jobId: "j0", accountId: "B", path: "http" }]);
  });
});

describe("Build 1.0 callers keep their behaviour", () => {
  it("accounts without execution settings run one UI job each under perAccount", () => {
    const legacy = (id: string): SchedAccount => ({ id, state: "ready", proxyHealthy: true, running: 0, lastActiveAt: null, capabilities: {} });
    const out = schedule({ queued: jobs(4), accounts: [legacy("A"), legacy("B")], perAccount: 1, globalCap: 4, totalRunning: 0, verified: VERIFIED_CAPABILITIES });
    expect(out.map((a) => [a.accountId, a.path])).toEqual([["A", "ui"], ["B", "ui"]]);
  });
});
