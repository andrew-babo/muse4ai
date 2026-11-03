import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionManager } from "../src/main/execution";
import { FakeHttpChannel } from "../src/main/adapter/fakeGateway";
import { HTTP_ACK_TIMEOUT_MS, HTTP_IDLE_CLOSE_MS, HTTP_PAGE_UNLOAD_MS, HTTP_RECONCILE_READS, HTTP_RECONCILE_SPAN_MS, HTTP_RECONNECT_DELAYS_MS, HTTP_TIMEOUT_MS, SELF_CHECK_EVERY_MS, SELF_CHECK_FIRST_MS } from "../src/shared/execution";
import type { Account } from "../src/shared/types";

// AC-PATH-11 / R97 — the automatic self-check of the direct channel.
const HOUR = 60 * 60_000;

function manager(lastSuccess: number | null) {
  let now = 1_800_000_000_000;
  const cfg = {};
  const ch = new FakeHttpChannel("acc-1", cfg);
  const logs: string[] = [];
  const m = new ExecutionManager({
    channelFor: () => ch,
    now: () => now,
    log: (_l, _s, msg, data) => logs.push(`${msg} ${JSON.stringify(data ?? {})}`),
    changed: () => undefined,
    switchedToUi: () => undefined,
    incompatible: () => undefined,
    httpEnabled: () => true,
    lastHttpSuccessAt: () => (lastSuccess === null ? null : now - lastSuccess),
  });
  const acc = { id: "acc-1", alias: "Mây", execMode: "auto", state: "ready" } as Account;
  return { m, ch, cfg: cfg as { sent?: unknown[] }, logs, acc, at: (ms: number) => (now = 1_800_000_000_000 + ms), get now() { return now; } };
}

describe("AC-PATH-11 — self-check 60 s after the first frame, only after 6 h without an HTTP success", () => {
  it("the spec values: first check 60 s after the first frame, then every 6 h; HTTP limits 20/12/25 minutes", () => {
    expect(SELF_CHECK_FIRST_MS).toBe(60_000);
    expect(SELF_CHECK_EVERY_MS).toBe(6 * HOUR);
    expect(HTTP_TIMEOUT_MS).toEqual({ chat: 20 * 60_000, image: 12 * 60_000, video: 25 * 60_000 });
  });
  it("R89/R93/R94 spec values used by AC-GW-01/02/05: reconnect 1/3/10 s, ack 15 s, 3 reconcile reads over ≥ 120 s, idle close 60 s, page unload 5 min", () => {
    expect([...HTTP_RECONNECT_DELAYS_MS]).toEqual([1_000, 3_000, 10_000]);
    expect(HTTP_ACK_TIMEOUT_MS).toBe(15_000);
    expect(HTTP_RECONCILE_READS).toBe(3);
    expect(HTTP_RECONCILE_SPAN_MS).toBe(120_000);
    expect(HTTP_IDLE_CLOSE_MS).toBe(60_000);
    expect(HTTP_PAGE_UNLOAD_MS).toBe(5 * 60_000);
  });

  it("ca 1: no success for 6 h → due exactly 60 s after the first frame; the probe records time + result and sends no prompt", async () => {
    const t = manager(6 * HOUR);
    const firstFrame = 1_800_000_000_000;
    t.at(59_999);
    expect(t.m.selfCheckDue(firstFrame, SELF_CHECK_FIRST_MS)).toBe(false);
    t.at(60_000);
    expect(t.m.selfCheckDue(firstFrame, SELF_CHECK_FIRST_MS)).toBe(true);
    await t.m.selfCheck([t.acc]);
    const b = t.m.bridge();
    expect(b.lastCheckAt).toBe(t.now);
    expect(b.lastCheckOk).toBe(true);
    expect(b.results).toEqual([expect.objectContaining({ accountId: "acc-1", ok: true, at: t.now })]);
    expect(t.cfg.sent ?? []).toHaveLength(0);
    expect(t.logs.some((l) => l.startsWith("path.probe"))).toBe(true);
    // The next one is 6 h later, not on the next scheduler tick.
    t.at(60_000 + 1_000);
    expect(t.m.selfCheckDue(firstFrame, SELF_CHECK_FIRST_MS)).toBe(false);
  });

  it("ca 2: a success 1 hour ago (stored before this start) → no self-check after opening the app", () => {
    const t = manager(1 * HOUR);
    t.at(60_000);
    expect(t.m.selfCheckDue(1_800_000_000_000, SELF_CHECK_FIRST_MS)).toBe(false);
  });

  it("no HTTP success ever stored → the first self-check runs", () => {
    const t = manager(null);
    t.at(60_000);
    expect(t.m.selfCheckDue(1_800_000_000_000, SELF_CHECK_FIRST_MS)).toBe(true);
  });
});

describe("R97 — “Kiểm ngay” with no free account", () => {
  it("every HTTP account busy → no probe, no “có lỗi”: the previous result stays", async () => {
    const t = manager(null);
    await t.m.checkNow([t.acc], 0);
    const before = t.m.bridge();
    expect(before.lastCheckOk).toBe(true);
    t.at(5 * 60_000);
    const after = await t.m.checkNow([{ ...t.acc, state: "busy" } as Account], 0);
    expect(after.lastCheckAt).toBe(before.lastCheckAt);
    expect(after.lastCheckOk).toBe(true);
    expect(after.results).toEqual(before.results);
  });
});

describe("AC-CC-07 — 20 jobs on one account are paced 0.4–1.2 s apart", () => {
  afterEach(() => vi.useRealTimers());
  it("20 concurrent sends leave the gate one by one; every gap between consecutive sends is within 400–1200 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ch = new FakeHttpChannel("acc-1", {});
    const m = new ExecutionManager({ channelFor: () => ch, now: () => Date.now(), log: () => undefined, changed: () => undefined, switchedToUi: () => undefined, incompatible: () => undefined, httpEnabled: () => true });
    const at: number[] = [];
    const ctl = new AbortController();
    const all = Promise.all(Array.from({ length: 20 }, () => m.paced("acc-1", ctl.signal).then(() => at.push(Date.now()))));
    for (let i = 0; i < 200 && at.length < 20; i++) await vi.advanceTimersByTimeAsync(100);
    await all;
    expect(at).toHaveLength(20);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(400);
      // + at most the 100 ms timer step of this test (the spec allows ≤ 0.2 s processing).
      expect(g).toBeLessThanOrEqual(1200 + 100);
    }
    // Another account is not held back by this one's gate.
    const t0 = Date.now();
    await m.paced("acc-2", ctl.signal);
    expect(Date.now() - t0).toBe(0);
  });
});
