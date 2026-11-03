// Acceptance criteria whose earlier tests covered only part of the spec wording (independent AC audit, beta.11).
// Each test asserts the concrete values from docs/build-1.0/spec.md for that AC-ID.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakePng } from "../src/main/adapter/fake";
import { IpcDispatcher } from "../src/main/ipcHandlers";
import { openDatabase } from "../src/main/db";
import { Repo } from "../src/main/repo";
import { LEASE_RELEASE_WAIT_MS } from "../src/shared/constants";
import { mergeResync, upsertByRev } from "../src/shared/resync";
import type { Account, Batch, Proxy, Snapshot } from "../src/shared/types";
import { job, makeHarness, seedAccounts, settle, sqlite, textJob, type Harness } from "./helpers";

let h: Harness;
afterEach(() => h?.close());

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ line: i + 1, prompt: `Dòng ${i + 1}: chiếc ghế gỗ số ${i + 1}`, kind: "image" as const, mode: "text" as const, reference: null, repeat: 1 + (i % 3), error: null }));
const settings = { kind: "image" as const, mode: "text" as const, accountPref: "auto", repeat: 1 };

describe("AC-APP-05 — reconnect shows data at the right rev", () => {
  const acc = (id: string, rev: number, state = "ready") => ({ id, rev, alias: id, state }) as unknown as Account;
  const prx = (id: string, rev: number) => ({ id, rev }) as unknown as Proxy;
  const snap = (rev: number, accounts: Account[], proxies: Proxy[] = [], batches: Batch[] = []) =>
    ({ rev, accounts, proxies, batches, settings: {}, engine: {}, capabilities: {}, counts: { unfinished: 0, review: 0, failedUnseen: 0 }, recovered: null }) as unknown as Snapshot;

  it("an event newer than the snapshot is kept; an older one is replaced", () => {
    const current = snap(9, [acc("A", 12, "busy"), acc("B", 5, "ready")], [prx("P1", 3)]);
    const fresh = snap(11, [acc("A", 10, "ready"), acc("B", 11, "paused")], [prx("P1", 8)]);
    const out = mergeResync(current, fresh);
    expect(out.accounts.find((a) => a.id === "A")).toMatchObject({ rev: 12, state: "busy" });
    expect(out.accounts.find((a) => a.id === "B")).toMatchObject({ rev: 11, state: "paused" });
    expect(out.proxies[0].rev).toBe(8);
    expect(out.rev).toBe(11);
  });

  it("records created after the snapshot was read survive; records deleted meanwhile are not resurrected", () => {
    const current = snap(9, [acc("A", 4), acc("NEW", 13)]);
    const fresh = snap(11, [acc("A", 4), acc("GONE", 7)]);
    const out = mergeResync(current, fresh, new Set(["GONE"]));
    expect(out.accounts.map((a) => a.id).sort()).toEqual(["A", "NEW"]);
    // An account deleted before the snapshot (absent from it, older than it) is dropped.
    expect(mergeResync(snap(9, [acc("OLD", 6)]), snap(11, [])).accounts).toEqual([]);
  });

  it("an older copy of a record never replaces a newer one; equal rev takes the incoming copy (fresher counts)", () => {
    const list = [acc("A", 12, "busy")];
    expect(upsertByRev(list, acc("A", 10, "ready"))[0].state).toBe("busy");
    expect(upsertByRev(list, acc("A", 12, "ready"))[0].state).toBe("ready");
    expect(upsertByRev(list, acc("B", 1))).toHaveLength(2);
  });
});

describe("AC-ACC-08 — remove an account with 2 unsent jobs and 1 generating", () => {
  it("waits for the generating job (default 60 s), then asks to force; unsent jobs return to the queue, profile destroyed, old works kept", async () => {
    expect(LEASE_RELEASE_WAIT_MS).toBe(60_000);
    h = makeHarness({ cfg: () => ({ generateDelayMs: 3000 }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(A).generateDelayMs = 0;
    const [old] = h.coord.createJobs(textJob("cũ"));
    await settle(h);
    expect(job(h, old).state).toBe("completed");
    h.fakeCfg(A).generateDelayMs = 3000;
    const [running] = h.coord.createJobs(textJob("đang tạo", { accountPref: A }));
    h.coord.runScheduler();
    for (let i = 0; i < 100 && job(h, running).state !== "generating"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(job(h, running).state).toBe("generating");
    const unsent = h.coord.createJobs(textJob("chưa gửi", { accountPref: A, repeat: 2 }));
    expect(unsent.map((id) => job(h, id).state)).toEqual(["queued", "queued"]);

    const first = await h.coord.removeAccount(A, false, 50);
    expect(first).toEqual({ removed: false, needsForce: true });
    expect(h.repo.getAccount(A)).not.toBeNull();
    expect(h.destroyed).toEqual([]);

    const forced = await h.coord.removeAccount(A, true);
    expect(forced.removed).toBe(true);
    expect(unsent.map((id) => [job(h, id).state, job(h, id).accountPref])).toEqual([
      ["queued", "auto"],
      ["queued", "auto"],
    ]);
    expect(job(h, running).state).toBe("needs_review");
    expect(h.destroyed).toEqual([A]);
    expect(h.repo.getAccount(A)).toBeNull();
    const assets = h.repo.assetsForJob(old);
    expect(assets).toHaveLength(1);
    expect(fs.existsSync(assets[0].path)).toBe(true);
  }, 20_000);
});

describe("AC-ACC-09 — the same unexplained failure 3 times in 15 minutes", () => {
  it("1st and 2nd: cooling_down 120 s, no notice; 3rd: paused with exactly one notice", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(A).script = [1, 2, 3].map(() => ({ phase: "session" as const, error: "UNKNOWN" as const }));
    const t0 = h.clock.t;
    await h.coord.checkSession(A);
    expect(h.repo.getAccount(A)).toMatchObject({ state: "cooling_down", stateUntil: t0 + 120_000 });
    h.clock.t += 5 * 60_000;
    await h.coord.checkSession(A);
    expect(h.repo.getAccount(A)).toMatchObject({ state: "cooling_down", stateUntil: h.clock.t + 120_000 });
    expect(h.notices.filter((n) => n.kind === "account_paused")).toHaveLength(0);
    h.clock.t += 5 * 60_000; // 10 minutes after the first failure
    await h.coord.checkSession(A);
    expect(h.repo.getAccount(A)!.state).toBe("paused");
    const paused = h.notices.filter((n) => n.kind === "account_paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].title).toBe("Mây đã tạm dừng");
    expect(paused[0].route).toBe(`/accounts/${A}`);
  });

  it("failures more than 15 minutes apart never pause", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(A).script = [1, 2, 3].map(() => ({ phase: "session" as const, error: "UNKNOWN" as const }));
    for (let i = 0; i < 3; i++) {
      await h.coord.checkSession(A);
      expect(h.repo.getAccount(A)!.state).toBe("cooling_down");
      h.clock.t += 8 * 60_000;
    }
    expect(h.notices.filter((n) => n.kind === "account_paused")).toHaveLength(0);
  });
});

describe("AC-JOB-06 — two workers download at the same time", () => {
  it("each library file has exactly the bytes its own worker downloaded (sha256), staged per job", async () => {
    const downloaded = new Map<string, Uint8Array[]>();
    h = makeHarness({
      cfg: (accountId) => ({
        generateDelayMs: 50,
        media: (_kind: string, seed: number) => {
          const b = fakePng(seed + accountId.length * 7919);
          downloaded.set(accountId, [...(downloaded.get(accountId) ?? []), b]);
          return b;
        },
      }),
    });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    const ids = h.coord.createJobs(textJob("song song", { repeat: 2 }));
    await settle(h);
    const byAccount = new Map(ids.map((id) => [job(h, id).accountId!, id]));
    expect([...byAccount.keys()].sort()).toEqual([A, B].sort());
    for (const [acc, id] of byAccount) {
      const bytes = downloaded.get(acc)!;
      expect(bytes).toHaveLength(1);
      const [asset] = h.repo.assetsForJob(id);
      expect(asset.sha256).toBe(sha(bytes[0]));
      expect(sha(fs.readFileSync(asset.path))).toBe(asset.sha256);
      // R13 file name carries the job's short id, so the file sits in its own job's slot
      expect(path.basename(asset.path)).toContain(id.replace(/-/g, "").slice(0, 6));
    }
    // per-job staging folders are cleaned after the atomic rename
    const staging = path.join(h.dir, "Library", ".muse-staging");
    for (const id of ids) expect(fs.existsSync(path.join(staging, id))).toBe(false);
  });
});

describe("AC-BAT-03 — pause a 20-job batch with 5 done, 2 generating, 13 waiting", () => {
  it("13 → held; the 2 generating still finish and download", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 300 }) });
    await seedAccounts(h, ["Mây", "Sương"]);
    const b = h.coord.saveDraft({ name: "Lô 20", settings, rows: rows(20).map((r) => ({ ...r, repeat: 1 })) });
    h.coord.startBatch(b.id, new Map());
    const all = h.repo.jobsForBatch(b.id);
    expect(all).toHaveLength(20);
    // Given: 5 already completed (fixture), then the scheduler takes 2 (one per account).
    for (const j of all.slice(0, 5)) h.repo.updateJob(j.id, { state: "completed" }, h.clock.t);
    h.coord.runScheduler();
    for (let i = 0; i < 200 && h.repo.jobsForBatch(b.id, ["generating"]).length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.repo.jobsForBatch(b.id, ["completed"])).toHaveLength(5);
    const generating = h.repo.jobsForBatch(b.id, ["generating"]).map((j) => j.id);
    expect(generating).toHaveLength(2);
    expect(h.repo.jobsForBatch(b.id, ["queued"])).toHaveLength(13);

    h.coord.pauseBatch(b.id);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(13);
    await h.coord.idle();
    await settle(h, 5);
    expect(generating.map((id) => job(h, id).state)).toEqual(["completed", "completed"]);
    for (const id of generating) expect(h.repo.assetsForJob(id)).toHaveLength(1);
    expect(h.repo.jobsForBatch(b.id, ["completed"])).toHaveLength(7);
    expect(h.repo.jobsForBatch(b.id, ["held"])).toHaveLength(13);
  });
});

describe("AC-BAT-05 — a 40-row draft survives a crash", () => {
  it("files copied while the app is still running (no clean close, WAL not checkpointed) reopen with all 40 rows intact", () => {
    h = makeHarness();
    const draft = rows(40);
    const b = h.coord.saveDraft({ name: "Nháp 40 dòng", settings, rows: draft });
    // Simulated power cut: take the on-disk files as they are right now, without closing the store.
    const crashDir = fs.mkdtempSync(path.join(path.dirname(h.dir), "muse-crash-"));
    fs.mkdirSync(path.join(crashDir, "data"));
    const copied: string[] = [];
    for (const f of ["muse.sqlite", "muse.sqlite-wal"]) {
      const src = path.join(path.dirname(h.dbFile), f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(crashDir, "data", f));
        copied.push(f);
      }
    }
    expect(copied).toContain("muse.sqlite-wal"); // the draft is only in the write-ahead log at this point
    const { db } = openDatabase(sqlite, path.join(crashDir, "data", "muse.sqlite"), path.join(crashDir, "backups"));
    try {
      const got = new Repo(db).getBatch(b.id)!;
      expect(got.state).toBe("draft");
      expect(got.name).toBe("Nháp 40 dòng");
      expect(got.rows).toHaveLength(40);
      expect(got.rows.map((r) => [r.line, r.prompt, r.repeat])).toEqual(draft.map((r) => [r.line, r.prompt, r.repeat]));
    } finally {
      db.close();
    }
  });
});

describe("AC-SEC-02 — strange IPC from the renderer", () => {
  it("is refused, logged as a warning without the payload, and never reaches a handler", async () => {
    const touched: string[] = [];
    const trap = <T extends object>(label: string) =>
      new Proxy({} as T, {
        get: (_t, prop) => {
          touched.push(`${label}.${String(prop)}`);
          return () => undefined;
        },
      });
    const logs: { level: string; msg: string; data?: Record<string, unknown> }[] = [];
    const d = new IpcDispatcher(trap("coord"), trap("svc"), trap("shell"), { testMode: false, log: (level, _scope, msg, data) => logs.push({ level, msg, data }) });

    expect(await d.dispatch("fs.readFile", { path: "C:/Windows/win.ini" })).toMatchObject({ ok: false, code: "unknown_command" });
    expect(await d.dispatch("__test.freeze", { ms: 10 })).toMatchObject({ ok: false, code: "unknown_command" });
    expect(await d.dispatch("job.create", { prompt: 42, secret: "CANARY-IPC-1" })).toMatchObject({ ok: false, code: "invalid_input" });

    expect(touched).toEqual([]);
    expect(logs.map((l) => [l.level, l.msg, l.data?.name])).toEqual([
      ["warn", "rejected unknown command", "fs.readFile"],
      ["warn", "rejected unknown command", "__test.freeze"],
      ["warn", "rejected invalid input", "job.create"],
    ]);
    expect(JSON.stringify(logs)).not.toContain("CANARY-IPC-1");
    expect(JSON.stringify(logs)).not.toContain("win.ini");
  });
});

describe("start-up screen (resume the last screen safely)", () => {
  const base = { batches: [{ id: "b1" }], accounts: [{ id: "a1" }] } as unknown as Pick<Snapshot, "batches" | "accounts">;
  const at = (lastRoute: string, onboardingStep = 4) => ({ ...base, settings: { lastRoute, onboardingStep } as Snapshot["settings"] });
  it("resumes the last screen, including an existing job, batch or account", async () => {
    const { resumeRoute } = await import("../src/shared/resumeRoute");
    expect(resumeRoute(at("/library"), null)).toBe("/library");
    expect(resumeRoute(at("/queue/j1"), true)).toBe("/queue/j1");
    expect(resumeRoute(at("/batch/b1"), null)).toBe("/batch/b1");
    expect(resumeRoute(at("/accounts/a1"), null)).toBe("/accounts/a1");
    expect(resumeRoute(at(""), null)).toBe("/studio");
    expect(resumeRoute(at("/library", 2), null)).toBe("/onboarding");
  });
  it("never reopens a detail that no longer exists, nor an account's live panel", async () => {
    const { resumeRoute, resumeJobId } = await import("../src/shared/resumeRoute");
    expect(resumeRoute(at("/queue/gone"), false)).toBe("/queue");
    expect(resumeRoute(at("/batch/gone"), null)).toBe("/batch");
    expect(resumeRoute(at("/accounts/gone/takeover"), null)).toBe("/accounts");
    expect(resumeRoute(at("/accounts/a1/takeover"), null)).toBe("/accounts/a1");
    expect(resumeJobId("/queue/36b4a191")).toBe("36b4a191");
    expect(resumeJobId("/queue")).toBeNull();
    expect(resumeJobId("/library")).toBeNull();
  });
});

describe("AC-ACC-08 — leftover browser profiles are deleted at the next start", () => {
  it("deletes only profile folders of accounts that no longer exist", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { sweepOrphanProfiles } = await import("../src/main/profiles");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ms-prof-"));
    const parts = path.join(root, "Partitions");
    for (const d of ["acc-keep-1", "acc-gone-2/Network", "acc-a", "proxytest-x", "other"]) fs.mkdirSync(path.join(parts, d), { recursive: true });
    fs.writeFileSync(path.join(parts, "acc-gone-2", "Network", "Cookies"), "x");
    fs.writeFileSync(path.join(parts, "acc-file"), "not a folder");
    const r = sweepOrphanProfiles(root, ["keep-1"]);
    expect(r).toEqual({ removed: 2, failed: 0 });
    expect(fs.readdirSync(parts).sort()).toEqual(["acc-file", "acc-keep-1", "other", "proxytest-x"]);
    expect(sweepOrphanProfiles(path.join(root, "none"), [])).toEqual({ removed: 0, failed: 0 });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("idle account pages are unloaded (login kept)", () => {
  const quiet = { visible: false, previewing: false, loggingIn: false, busy: false, lastUse: 0 };
  it("unloads a hidden page that has had nothing to do for 5 minutes", async () => {
    const { shouldUnloadPage, IDLE_UNLOAD_MS } = await import("../src/main/idlePages");
    expect(IDLE_UNLOAD_MS).toBe(300_000);
    expect(shouldUnloadPage(quiet, 300_000)).toBe(true);
    expect(shouldUnloadPage(quiet, 299_999)).toBe(false);
  });
  it("throttles a hidden page after 30 s of quiet, never one that is shown, previewed, logging in or working", async () => {
    const { shouldThrottlePage, QUIET_THROTTLE_MS } = await import("../src/main/idlePages");
    expect(QUIET_THROTTLE_MS).toBe(30_000);
    expect(shouldThrottlePage(quiet, 30_000)).toBe(true);
    expect(shouldThrottlePage(quiet, 29_999)).toBe(false);
    for (const k of ["visible", "previewing", "loggingIn", "busy"] as const) expect(shouldThrottlePage({ ...quiet, [k]: true }, 3_600_000)).toBe(false);
  });
  it("never unloads a page that is shown, previewed, logging in or working", async () => {
    const { shouldUnloadPage } = await import("../src/main/idlePages");
    const late = 3_600_000;
    expect(shouldUnloadPage({ ...quiet, visible: true }, late)).toBe(false);
    expect(shouldUnloadPage({ ...quiet, previewing: true }, late)).toBe(false);
    expect(shouldUnloadPage({ ...quiet, loggingIn: true }, late)).toBe(false);
    expect(shouldUnloadPage({ ...quiet, busy: true }, late)).toBe(false);
  });
});

describe("start-up: account pages wait for the first frame", () => {
  it("init with deferSessionChecks re-checks no session until revalidateSessions(), which runs once", async () => {
    h = makeHarness();
    const [a, b] = await seedAccounts(h, ["A", "B"]);
    const sessions = () => [a, b].map((id) => h.adapters.get(id)?.calls.session ?? 0);
    const before = sessions();
    await h.coord.init({ deferSessionChecks: true });
    await settle(h, 3);
    expect(sessions()).toEqual(before);
    h.coord.revalidateSessions();
    await settle(h, 3);
    expect(sessions()).toEqual(before.map((n) => n + 1));
    h.coord.revalidateSessions();
    await settle(h, 3);
    expect(sessions()).toEqual(before.map((n) => n + 1));
  });

  it("plain init still re-checks ready accounts at once", async () => {
    h = makeHarness();
    const [a] = await seedAccounts(h, ["A"]);
    const before = h.adapters.get(a)?.calls.session ?? 0;
    await h.coord.init();
    await settle(h, 3);
    expect(h.adapters.get(a)!.calls.session).toBe(before + 1);
  });

  it("the first frame logs the main-process phases and fires onFirstFrame once", async () => {
    const logs: { msg: string; data?: Record<string, unknown> }[] = [];
    let fired = 0;
    const coord = {} as never;
    const d = new IpcDispatcher(coord, {} as never, {} as never, {
      testMode: false,
      log: (_l, _s, msg, data) => logs.push({ msg, data }),
      startupPhases: () => ({ start: 120, store: 340, window: 610 }),
      onFirstFrame: () => void fired++,
    });
    expect(await d.dispatch("app.markReady", { ms: 900, scriptMs: 210, snapMs: 640 })).toMatchObject({ ok: true, data: { first: true } });
    expect(await d.dispatch("app.markReady", { ms: 300 })).toMatchObject({ ok: true, data: { first: false } });
    expect(fired).toBe(1);
    expect(logs[0]).toMatchObject({ msg: "startup", data: { rendererMs: 900, phases: { start: 120, store: 340, window: 610 }, rendererPhases: { script: 210, snapshot: 640, frame: 900 } } });
    expect(logs[1].msg).toBe("renderer reload");
    expect(logs[1].data).not.toHaveProperty("phases");
  });
});

describe("start-up: store prewarm", () => {
  it("reads existing files up to the byte cap and skips missing ones without throwing", async () => {
    const { prewarmFiles } = await import("../src/main/prewarm");
    const dir = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "muse-warm-"));
    const a = path.join(dir, "a.bin");
    fs.writeFileSync(a, Buffer.alloc(300_000, 1));
    expect(await prewarmFiles([a, path.join(dir, "missing")], { maxBytes: 10_000_000, maxMs: 5_000, chunk: 64_000 })).toEqual({ bytes: 300_000, timedOut: false });
    expect(await prewarmFiles([a], { maxBytes: 100_000, maxMs: 5_000, chunk: 64_000 })).toEqual({ bytes: 100_000, timedOut: false });
    expect((await prewarmFiles([a], { maxBytes: 10_000_000, maxMs: -1, chunk: 64_000 })).timedOut).toBe(true);
  });
});
