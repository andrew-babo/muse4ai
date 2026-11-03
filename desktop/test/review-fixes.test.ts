// Regression tests for the state-transition bugs found by the independent code review of beta.9 (26/10/2026).
import { afterEach, describe, expect, it } from "vitest";
import type { SubmitHooks, SubmitSpec } from "../src/main/adapter/types";
import { makeHarness, seedAccounts, settle, job, textJob, type Harness } from "./helpers";

let h: Harness;
afterEach(() => h?.close());

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ line: i + 1, prompt: `dòng ${i}`, kind: "image" as const, mode: "text" as const, reference: null, repeat: 1, error: null }));
const settings = { kind: "image" as const, mode: "text" as const, accountPref: "auto", repeat: 1 };
const until = async (cond: () => boolean, ms = 3000) => {
  for (let t = 0; t < ms && !cond(); t += 10) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};
const running = (hh: Harness) => (hh.coord as unknown as { running: Map<string, unknown> }).running.size;

describe("profile ownership (R2)", () => {
  it("a session check overtaken by takeover never overwrites the takeover state", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(A).sessionDelayMs = 80;
    h.fakeCfg(A).script = [{ phase: "session", error: "SESSION_EXPIRED" }];
    const pending = h.coord.checkSession(A);
    h.coord.takeoverStart(A, "now");
    await pending;
    expect(h.repo.getAccount(A)!.state).toBe("takeover");
    await h.coord.takeoverEnd(A);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
  });

  it("takeover now while preparing: a late adapter never clicks Send and the account stays in takeover", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    await h.coord.checkSession(A); // creates this account's fake adapter
    const fake = h.adapters.get(A)!;
    let sent = 0;
    // An adapter that ignores the abort signal while it prepares.
    fake.submit = async (_spec: SubmitSpec, hooks: SubmitHooks) => {
      await new Promise((r) => setTimeout(r, 80));
      hooks.onBeforeSend();
      sent++;
      return { remoteRef: "late-thread", acceptedAt: Date.now() };
    };
    const [id] = h.coord.createJobs(textJob());
    h.coord.runScheduler();
    await until(() => job(h, id).state === "preparing");
    h.coord.takeoverStart(A, "now");
    await h.coord.idle();
    expect(sent).toBe(0);
    expect(job(h, id).state).toBe("queued");
    expect(h.repo.getAccount(A)!.state).toBe("takeover");
  });

  it("takeover now while generating: a late result is not downloaded and the job stays needs_review", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    await h.coord.checkSession(A); // creates this account's fake adapter
    const fake = h.adapters.get(A)!;
    fake.observe = async (ref, kind) => {
      await new Promise((r) => setTimeout(r, 80)); // ignores the signal
      return { media: [{ src: `${ref}#0`, kind: kind as "image" | "video" }] };
    };
    const [id] = h.coord.createJobs(textJob());
    h.coord.runScheduler();
    await until(() => job(h, id).state === "generating");
    h.coord.takeoverStart(A, "now");
    await h.coord.idle();
    expect(job(h, id).state).toBe("needs_review");
    expect(h.repo.assetsForJob(id)).toHaveLength(0);
    expect(h.repo.getAccount(A)!.state).toBe("takeover");
  });
});

describe("scheduling and recovery", () => {
  it("R3: restart reconciliation never runs more jobs than the global cap", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 200 }) });
    const accs = await seedAccounts(h, ["Mây", "Sương", "Gió"]);
    h.coord.setSetting("globalConcurrency", 1);
    for (const [i, A] of accs.entries()) {
      const [id] = h.coord.createJobs(textJob(`lượt ${i}`));
      h.repo.updateJob(id, { state: "generating", accountId: A, remoteRef: `thread-${i}`, submitIntentAt: h.clock.t, acceptedAt: h.clock.t }, h.clock.t);
    }
    h.coord.runScheduler();
    expect(running(h)).toBe(1);
    await h.coord.idle();
  });

  it("AC-GEN-11: resuming an account after a proxy failure makes it schedulable again once its check passes", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const proxyId = h.repo.getAccount(A)!.proxyId!;
    h.repo.updateAccount(A, { state: "proxy_error" });
    h.repo.updateProxy(proxyId, { health: "failed", lastError: "x" });
    h.coord.resumeAccount(A);
    await settle(h);
    expect(h.repo.getProxy(proxyId)!.health).toBe("healthy");
    const [id] = h.coord.createJobs(textJob());
    await settle(h);
    expect(job(h, id).state).toBe("completed");
    expect(job(h, id).accountId).toBe(A);
  });

  it("R12 / AC-JOB-04: a download_retry job without a Muse link is flagged for review at startup instead of crashing recovery", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob());
    h.repo.updateJob(id, { state: "download_retry", accountId: A, remoteRef: null, submitIntentAt: h.clock.t }, h.clock.t);
    expect(() => h.coord.recover()).not.toThrow();
    expect(job(h, id).state).toBe("needs_review");
  });
});

describe("batches", () => {
  it("AC-BAT-03: pausing holds a job that is still preparing; it is never sent", async () => {
    h = makeHarness({ cfg: () => ({ submitDelayMs: 150 }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const b = h.coord.saveDraft({ name: "Lô 3", settings, rows: rows(3) });
    h.coord.startBatch(b.id, new Map());
    h.coord.runScheduler();
    await until(() => h.repo.jobsForBatch(b.id, ["preparing"]).length === 1);
    h.coord.pauseBatch(b.id);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(3);
    await h.coord.idle();
    expect(h.adapters.get(A)!.sentPrompts).toHaveLength(0);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(3);
    expect(h.repo.getAccount(A)!.state).toBe("ready");
    h.coord.resumeBatch(b.id);
    await settle(h);
    expect(h.repo.jobsForBatch(b.id, ["completed"])).toHaveLength(3);
  });

  it("AC-BAT-06: a batch whose last jobs finished while paused becomes done on resume, with exactly one batch_done notice", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 150 }) });
    await seedAccounts(h, ["Mây", "Sương"]);
    const b = h.coord.saveDraft({ name: "Lô 2", settings, rows: rows(2) });
    h.coord.startBatch(b.id, new Map());
    h.coord.runScheduler();
    await until(() => h.repo.jobsForBatch(b.id, ["generating"]).length === 2);
    h.coord.pauseBatch(b.id);
    await h.coord.idle();
    expect(h.repo.jobsForBatch(b.id, ["completed"])).toHaveLength(2);
    expect(h.repo.getBatch(b.id)!.state).toBe("paused");
    h.coord.resumeBatch(b.id);
    expect(h.repo.getBatch(b.id)!.state).toBe("done");
    expect(h.notices.filter((n) => n.kind === "batch_done")).toHaveLength(1);
  });
});
