import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { FakeAdapter, type FakeConfig } from "../src/main/adapter/fake";
import { FakeVibesAdapter, type FakeVibesConfig } from "../src/main/adapter/vibes/fake";
import { Coordinator, type LoginResult, type Notice } from "../src/main/coordinator";
import { openDatabase, type SqliteModule } from "../src/main/db";
import { MediaStore, readImageSize } from "../src/main/media";
import { defaultSettings, Repo } from "../src/main/repo";
import type { ProxyTestResult } from "../src/main/adapter/types";
import { FakeHttpChannel, type FakeGwConfig } from "../src/main/adapter/fakeGateway";
import type { HttpTimings } from "../src/main/execution";

const require = createRequire(import.meta.url);
export const sqlite: SqliteModule = require("node:sqlite");

export interface Harness {
  dir: string;
  dbFile: string;
  coord: Coordinator;
  repo: Repo;
  adapters: Map<string, FakeAdapter>;
  fakeCfg: (accountId: string) => FakeConfig;
  vibes: Map<string, FakeVibesAdapter>;
  vibesCfg: (accountId: string) => FakeVibesConfig;
  /** Login windows the coordinator opened, in order (site + account). */
  logins: { accountId: string; site: string }[];
  /** Pending login windows: resolve(true) = logged in, resolve(false) = closed. */
  loginWaiters: Map<string, (ok: LoginResult) => void>;
  vibesSwitches: { accountId: string; on: boolean }[];
  events: { type: string; payload: unknown }[];
  notices: Notice[];
  logs: string[];
  clock: { t: number };
  vault: Map<string, string>;
  proxyTest: Map<string, ProxyTestResult>;
  /** Accounts whose browser profile the coordinator asked the UI layer to destroy. */
  destroyed: string[];
  media: MediaStore;
  /** Extra listeners for coordinator events (the agent API's long-poll subscribes here). */
  listeners: Set<(type: string, payload: unknown) => void>;
  /** Build 2.0 — fake direct channels per account (only when the harness was made with `gw`). */
  channels: Map<string, FakeHttpChannel>;
  gwCfg: (accountId: string) => FakeGwConfig;
  close: () => void;
}

/** Short Build 2.0 HTTP timings for tests (same rules, smaller numbers). */
export const FAST_HTTP: Partial<HttpTimings> = {
  ackTimeoutMs: 150,
  reconnectDelaysMs: [5, 10, 20],
  fetchRetryDelaysMs: [5, 10, 20],
  reconcileReads: 3,
  reconcileSpanMs: 60,
  reconcileGiveUpMs: 400,
  stableGapMs: 20,
  mediaGraceMs: 150,
  idleCloseMs: 200,
  pollMs: 10,
  historyFallbackMs: 40,
  timeoutMs: { chat: 3_000, image: 3_000, video: 3_000 },
  submitGap: () => 1,
};

export function fakeProbe(file: string, mime: string) {
  const buf = fs.readFileSync(file);
  if (mime.startsWith("video/")) {
    // fakeVibesMp4 carries its length (marker DURA + uint32 ms); other fake videos are 10 s.
    const ms = buf.length >= 48 && buf.toString("ascii", 40, 44) === "DURA" ? buf.readUInt32BE(44) : 10_000;
    return Promise.resolve({ width: 720, height: 1280, durationMs: ms, thumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  }
  const s = readImageSize(buf);
  if (!s) return Promise.reject(new Error("cannot decode"));
  return Promise.resolve({ width: s.width, height: s.height, durationMs: null, thumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
}

export function makeHarness(
  opts: {
    dir?: string;
    cfg?: (accountId: string) => FakeConfig;
    start?: number;
    vibesCfg?: (accountId: string) => FakeVibesConfig;
    /** Login windows resolve by themselves (default true = logged in at once); false = the test resolves them. */
    autoLogin?: boolean;
    loginStepTimeoutMs?: number;
    /** Build 2.0 — give accounts a fake direct channel (HTTP path on). */
    gw?: (accountId: string) => FakeGwConfig;
    httpTimings?: Partial<HttpTimings>;
    uiPagesPerAccount?: number;
    freeMemBytes?: () => number;
    /** Current Muse-only product; old adapter tests explicitly retain their legacy fixture. */
    museOnly?: boolean;
  } = {},
): Harness {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "muse-test-"));
  const dbFile = path.join(dir, "data", "muse.sqlite");
  const { db } = openDatabase(sqlite, dbFile, path.join(dir, "backups"));
  const repo = new Repo(db);
  const clock = { t: opts.start ?? new Date("2026-10-26T08:00:00+07:00").getTime() };
  const adapters = new Map<string, FakeAdapter>();
  const cfgs = new Map<string, FakeConfig>();
  const fakeCfg = (id: string) => {
    if (!cfgs.has(id)) cfgs.set(id, opts.cfg ? opts.cfg(id) : {});
    return cfgs.get(id)!;
  };
  const events: Harness["events"] = [];
  const notices: Notice[] = [];
  const logs: string[] = [];
  const vault = new Map<string, string>();
  const proxyTest = new Map<string, ProxyTestResult>();
  const destroyed: string[] = [];
  const listeners = new Set<(type: string, payload: unknown) => void>();
  const vibes = new Map<string, FakeVibesAdapter>();
  const vcfgs = new Map<string, FakeVibesConfig>();
  const vibesCfg = (id: string) => {
    if (!vcfgs.has(id)) vcfgs.set(id, opts.vibesCfg ? opts.vibesCfg(id) : {});
    return vcfgs.get(id)!;
  };
  const channels = new Map<string, FakeHttpChannel>();
  const gcfgs = new Map<string, FakeGwConfig>();
  const gwCfg = (id: string) => {
    if (!gcfgs.has(id)) gcfgs.set(id, opts.gw ? opts.gw(id) : {});
    return gcfgs.get(id)!;
  };
  const logins: Harness["logins"] = [];
  const loginWaiters = new Map<string, (ok: LoginResult) => void>();
  const vibesSwitches: Harness["vibesSwitches"] = [];
  const libraryDir = path.join(dir, "Library");
  const media = new MediaStore({ libraryDir: () => libraryDir, thumbsDir: path.join(dir, "thumbs"), refsDir: path.join(dir, "refs"), probe: fakeProbe });
  const coord = new Coordinator({
    repo,
    media,
    adapterFor: (id) => {
      if (!adapters.has(id)) adapters.set(id, new FakeAdapter(id, fakeCfg(id)));
      return adapters.get(id)!;
    },
    vibesFor: opts.museOnly ? undefined : (id) => {
      if (!vibes.has(id)) vibes.set(id, new FakeVibesAdapter(id, vibesCfg(id), () => clock.t));
      return vibes.get(id)!;
    },
    loginStepTimeoutMs: opts.loginStepTimeoutMs,
    ui: {
      openLogin: (id, site = "muse") => {
        logins.push({ accountId: id, site });
        if (opts.autoLogin !== false) return Promise.resolve(true);
        return new Promise<LoginResult>((resolve) => loginWaiters.set(`${id}:${site}`, resolve));
      },
      cancelLogin: (id, site) => {
        for (const [k, r] of loginWaiters) if (k.startsWith(`${id}:`) && (!site || k === `${id}:${site}`)) {
          loginWaiters.delete(k);
          r(false);
        }
      },
      setVibesEnabled: (id, on) => void vibesSwitches.push({ accountId: id, on }),
      showTakeover: () => undefined,
      hideTakeover: () => undefined,
      applyProxy: () => undefined,
      destroy: async (id) => void destroyed.push(id),
    },
    vault: { set: (k, v) => void vault.set(k, v), get: (k) => vault.get(k) ?? null, delete: (k) => void vault.delete(k) },
    testProxy: async (id) => proxyTest.get(id) ?? { ok: true, ip: "143.14.20.9", country: "US", latencyMs: 120 },
    emit: (type, payload) => {
      events.push({ type, payload });
      for (const l of listeners) l(type, payload);
    },
    notify: (n) => notices.push(n),
    log: (level, scope, msg, data) => logs.push(`${level} ${scope} ${msg} ${JSON.stringify(data ?? {})}`),
    diskFree: async () => 50 * 1024 ** 3,
    defaults: defaultSettings(libraryDir),
    now: () => clock.t,
    version: "test",
    timers: false,
    ...(opts.gw
      ? {
          channelFor: (id: string) => {
            if (!channels.has(id)) channels.set(id, new FakeHttpChannel(id, gwCfg(id)));
            return channels.get(id)!;
          },
          dropChannel: (id: string) => void channels.delete(id),
          httpTimings: { ...FAST_HTTP, ...opts.httpTimings },
        }
      : {}),
    uiPagesPerAccount: opts.uiPagesPerAccount,
    freeMemBytes: opts.freeMemBytes,
  });
  return {
    dir,
    dbFile,
    coord,
    repo,
    adapters,
    fakeCfg,
    vibes,
    vibesCfg,
    logins,
    loginWaiters,
    vibesSwitches,
    events,
    notices,
    logs,
    clock,
    vault,
    proxyTest,
    destroyed,
    media,
    listeners,
    channels,
    gwCfg,
    close: () => {
      void coord.stop();
      try {
        repo.db.close();
      } catch {
        /* closed */
      }
    },
  };
}

/** Adds healthy proxies + ready accounts directly. */
export async function seedAccounts(h: Harness, aliases: string[]): Promise<string[]> {
  const lines = aliases.map((_, i) => `10.0.0.${i + 1}:8080:user${i}:pass${i}`).join("\n");
  h.coord.importProxies(lines);
  for (const p of h.repo.listProxies()) await h.coord.testProxy(p.id);
  const ids: string[] = [];
  for (const a of aliases) {
    const acc = h.coord.addAccount({ alias: a, avatar: 0 });
    h.repo.updateAccount(acc.id, { state: "ready" });
    ids.push(acc.id);
  }
  return ids;
}

export async function settle(h: Harness, rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    h.coord.runScheduler();
    await h.coord.idle();
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function job(h: Harness, id: string) {
  return h.repo.getJob(id)!;
}

export const textJob = (prompt = "Một tách cà phê trên bàn gỗ", extra: Record<string, unknown> = {}) => ({
  kind: "image" as const,
  mode: "text" as const,
  prompt,
  referenceIds: [] as string[],
  accountPref: "auto",
  repeat: 1,
  clientRequestId: `req-${Math.random()}`,
  ...extra,
});
