import { describe, expect, it } from "vitest";
import { schedule, type SchedAccount } from "../src/shared/scheduler";
import { VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import { bodyRequestId } from "../src/shared/api/schemas";
import { withBudget } from "../src/main/httpRunner";
import { ChannelError } from "../src/main/adapter/muse/httpChannel";

const acc = (id: string, over: Partial<SchedAccount> = {}): SchedAccount => ({
  id, state: "ready", proxyHealthy: true, running: 0, lastActiveAt: null, capabilities: {},
  execMode: "auto", maxConcurrent: 10, uiMaxConcurrent: 2, httpUsable: true, runningUi: 0, ...over,
});
const run = (accounts: SchedAccount[]) =>
  schedule({
    queued: [{ id: "j", kind: "image", mode: "text", accountPref: "auto", priority: 0, seq: 0 }],
    accounts, perAccount: 1, globalCap: 40, totalRunning: 0, verified: VERIFIED_CAPABILITIES, uiPagesCap: 8, uiPagesUsed: 0,
  });

describe("Build 3.4 — a flaky account is tried last", () => {
  it("auto picks the healthy account even when the degraded one is idler", () => {
    const a = run([acc("a-flaky", { httpDegraded: true }), acc("b-ok", { running: 3, lastActiveAt: 5 })]);
    expect(a[0].accountId).toBe("b-ok");
  });
  it("a degraded account still gets work when it is the only one", () => {
    expect(run([acc("a-flaky", { httpDegraded: true })])[0].accountId).toBe("a-flaky");
  });
});

describe("Build 3.4 — pre-send connect budget", () => {
  it("gives up with connect_failed after the budget", async () => {
    const e = await withBudget(new Promise(() => {}), 20).catch((x) => x);
    expect(e).toBeInstanceOf(ChannelError);
    expect((e as ChannelError).reason).toBe("connect_failed");
  });
  it("passes a fast connect through", async () => {
    await expect(withBudget(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe("Build 3.4 — REST accepts request_id", () => {
  it("moves request_id out of the body into the idempotency key", () => {
    expect(bodyRequestId({ kind: "image", prompt: "x", request_id: "r-1" }, null)).toEqual({ body: { kind: "image", prompt: "x" }, idem: "r-1" });
  });
  it("refuses a request_id that differs from the header", () => {
    expect(() => bodyRequestId({ request_id: "a" }, "b")).toThrow();
  });
  it("leaves a body without request_id alone", () => {
    expect(bodyRequestId({ kind: "image" }, "h")).toEqual({ body: { kind: "image" }, idem: "h" });
  });
});
