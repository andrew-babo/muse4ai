import { afterEach, describe, expect, it } from "vitest";
import { job, makeHarness, seedAccounts, settle, textJob, type Harness } from "./helpers";

// beta.29 live run (27/10/2026): the Muse identity read ran while the job was still "queued", the next scheduler
// pass leased the same job to the second account, and both pages sent the prompt.
describe("AC-MEX-26 (R66): a job runs on one account only", () => {
  let h: Harness;
  afterEach(() => h?.close());

  it("a queued video is sent once, by one account, even when the identity read is slow and the scheduler runs again", async () => {
    h = makeHarness({ cfg: () => ({ identityDelayMs: 60, museExtend: {} }) });
    const [a, b] = await seedAccounts(h, ["Thử A", "Thử B"]);
    h.coord.setSetting("globalConcurrency", 2); // the VPS runs both accounts at once
    const [id] = h.coord.createJobs(textJob("Thuyền giấy trôi trên suối", { kind: "video" }));
    // Several scheduler passes while the first run is still reading the identity.
    for (let i = 0; i < 5; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 5));
    }
    await settle(h);
    // Only one account ever opened the job; no run tripped over another's state change.
    const submits = (h.adapters.get(a)?.calls.submit ?? 0) + (h.adapters.get(b)?.calls.submit ?? 0);
    expect(submits).toBe(1);
    expect(h.logs.filter((l) => l.includes("run ended with error"))).toEqual([]);
    expect(job(h, id).state).toBe("completed");
  });

  it("two queued videos with two accounts: each is sent exactly once", async () => {
    h = makeHarness({ cfg: () => ({ identityDelayMs: 60, museExtend: {} }) });
    const [a, b] = await seedAccounts(h, ["Thử A", "Thử B"]);
    h.coord.setSetting("globalConcurrency", 2);
    const ids = h.coord.createJobs(textJob("Hai cảnh", { kind: "video", repeat: 2 }));
    for (let i = 0; i < 5; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 5));
    }
    await settle(h);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
    expect(h.adapters.get(b)!.calls.submit).toBe(1);
    expect(h.logs.filter((l) => l.includes("run ended with error"))).toEqual([]);
    expect(ids.map((x) => job(h, x).state)).toEqual(["completed", "completed"]);
  });
});
