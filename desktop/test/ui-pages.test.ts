import { afterEach, describe, expect, it, vi } from "vitest";
import { UiWorkPool } from "../src/main/uiWorkPool";
import { FakeAdapter } from "../src/main/adapter/fake";
import { makeHarness, seedAccounts, textJob, type Harness } from "./helpers";

describe("R99 per-job UI page leases", () => {
  afterEach(() => vi.useRealTimers());
  it("two concurrent jobs have distinct pages scoped to the same account; a job always gets its own lease", () => {
    const pool = new UiWorkPool((accountId, key, primary) => ({ accountId, key, primary }), () => undefined);
    const a = pool.acquire("A", "j1");
    const b = pool.acquire("A", "j2");
    expect(a).not.toBe(b);
    expect([a.accountId, b.accountId]).toEqual(["A", "A"]);
    expect([a.primary, b.primary]).toEqual([true, false]);
    expect(pool.acquire("A", "j1")).toBe(a);
    expect(pool.acquire("B", "j1").accountId).toBe("B");
    pool.remove();
  });
  it("secondary pages close after 60 seconds idle, not while working; reuse cancels idle close", () => {
    vi.useFakeTimers();
    const destroyed: string[] = [];
    const pool = new UiWorkPool((_id, key) => key, value => destroyed.push(value));
    pool.acquire("A", "one");
    const extra = pool.acquire("A", "two");
    vi.advanceTimersByTime(120_000);
    expect(destroyed).toEqual([]);
    pool.release("A", "two");
    vi.advanceTimersByTime(59_999);
    expect(destroyed).toEqual([]);
    expect(pool.acquire("A", "three")).toBe(extra);
    vi.advanceTimersByTime(60_000);
    expect(destroyed).toEqual([]);
    pool.release("A", "three");
    vi.advanceTimersByTime(60_000);
    expect(destroyed).toEqual([extra]);
    pool.remove();
  });
});

describe("AC-CC-04 production coordinator memory gate", () => {
  let h: Harness | undefined;
  afterEach(async () => { if (h) { await h.coord.stop(); h.close(); } });
  it("1.4 GiB leaves extra job queued without error; 1.6 GiB starts it on a different per-job adapter", async () => {
    let free = 1.4 * 1024 ** 3;
    h = makeHarness({ gw: () => ({}), uiPagesPerAccount: 5, freeMemBytes: () => free, cfg: () => ({ generateDelayMs: 200 }) });
    const [id] = await seedAccounts(h, ["Thử B"]);
    h.repo.updateAccount(id, { execMode: "ui", uiMaxConcurrent: 2, maxConcurrent: 2 });
    const work = new Map<string, FakeAdapter>();
    const released: string[] = [];
    // Use the same production dependency boundary as AccountManager's distinct page leases.
    const deps = (h.coord as unknown as { d: { workAdapterFor: (acc: string, job: string) => FakeAdapter; releaseUiWork: (acc: string, job: string) => void } }).d;
    deps.workAdapterFor = (_acc, jobId) => {
      const existing = work.get(jobId);
      if (existing) return existing;
      const adapter = new FakeAdapter(id, { generateDelayMs: 200 });
      work.set(jobId, adapter);
      return adapter;
    };
    deps.releaseUiWork = (_acc, jobId) => released.push(jobId);
    const ids = h.coord.createJobs(textJob("Ảnh thử P5", { repeat: 2, accountPref: id }));
    for (let i = 0; i < 10 && h.repo.getJob(ids[0])?.state === "queued"; i++) {
      h.coord.runScheduler();
      await new Promise(r => setTimeout(r, 5));
    }
    expect(h.repo.getJob(ids[0])?.state).not.toBe("queued");
    expect(h.repo.getJob(ids[1])?.state).toBe("queued");
    expect(h.repo.getJob(ids[1])?.errorClass).toBeNull();
    free = 1.6 * 1024 ** 3;
    h.coord.runScheduler();
    expect(ids.every(j => h?.repo.getJob(j)?.state !== "queued")).toBe(true);
    expect(work.size).toBe(2);
    expect(work.get(ids[0])).not.toBe(work.get(ids[1]));
    await h.coord.idle();
    expect(ids.map(j => h?.repo.getJob(j)?.state)).toEqual(["completed", "completed"]);
    expect([...work.values()].map(a => a.calls.submit)).toEqual([1, 1]);
    expect(released.sort()).toEqual([...ids].sort());
  });
});