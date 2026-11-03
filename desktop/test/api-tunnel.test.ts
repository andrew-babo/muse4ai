import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { TUNNEL_BINARIES } from "../src/shared/api/constants";
import { TUNNEL_MSG, TunnelManager, type TunnelDeps } from "../src/main/api/tunnel";
import type { TunnelStatus } from "../src/shared/types";

// R30 / AC-API-18 / AC-API-25 logic with a fake cloudflared (spawn, fetch and process table are injected).

const BIN = Buffer.from("fake cloudflared binary v1");
const BIN_SHA = createHash("sha256").update(BIN).digest("hex");

class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = 0;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(): boolean {
    this.killed++;
    if (this.exitCode === null) {
      this.exitCode = 1;
      setImmediate(() => this.emit("exit", 1, null));
    }
    return true;
  }
  crash(): void {
    this.exitCode = 2;
    this.emit("exit", 2, null);
  }
}

interface Rig {
  t: TunnelManager;
  dir: string;
  statuses: TunnelStatus[];
  spawns: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; child: FakeChild }[];
  fetches: string[];
  killedPids: number[];
  probeInstance: { value: string };
  hostname: { value: string | null };
}

let rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs) await r.t.stop();
  rigs = [];
});

function makeRig(o: { downloadBytes?: Buffer; processTable?: Map<number, string>; preinstall?: Buffer | null } = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-tunnel-"));
  const statuses: TunnelStatus[] = [];
  const spawns: Rig["spawns"] = [];
  const fetches: string[] = [];
  const killedPids: number[] = [];
  const probeInstance = { value: "inst-1" };
  const hostname = { value: "quiet-river-abc.trycloudflare.com" as string | null };
  const binary = { url: "https://example.invalid/cloudflared.exe", sha256: BIN_SHA, bytes: BIN.length, file: "cloudflared-test.exe" };
  if (o.preinstall) fs.writeFileSync(path.join(dir, binary.file), o.preinstall);
  let pid = 4000;
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    fetches.push(url);
    if (url === binary.url) {
      const bytes = o.downloadBytes ?? BIN;
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-length": String(bytes.length) } });
    }
    if (url.endsWith("/quicktunnel")) return Response.json({ hostname: hostname.value ?? "" });
    if (url.endsWith("/v1/health")) return Response.json({ ok: true, service: "muse4ai", instance: probeInstance.value });
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const deps: TunnelDeps = {
    binDir: dir,
    binary,
    instanceId: "inst-1",
    fetch: fakeFetch,
    log: () => undefined,
    onChange: (s) => statuses.push(s),
    spawn: ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      const child = new FakeChild(++pid);
      spawns.push({ cmd, args, env: opts.env, child });
      return child;
    }) as unknown as TunnelDeps["spawn"],
    processPath: async (p) => o.processTable?.get(p) ?? null,
    kill: (p) => void killedPids.push(p),
    delaysS: [0.05, 0.05, 0.05, 0.05, 0.05],
    onlineTimeoutMs: 400,
    probeIntervalMs: 20,
  };
  const r: Rig = { t: new TunnelManager(deps), dir, statuses, spawns, fetches, killedPids, probeInstance, hostname };
  rigs.push(r);
  return r;
}

async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("pinned binary (R30)", () => {
  it("the product pins cloudflared 2026.10.4 for Windows by SHA-256", () => {
    expect(TUNNEL_BINARIES["win32-x64"]).toMatchObject({ sha256: "411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8", bytes: 55_344_848 });
    expect(TUNNEL_BINARIES["win32-x64"].url).toContain("/2026.10.4/cloudflared-windows-amd64.exe");
  });

  it("AC-API-18a: an installed binary changed by one byte → error, file deleted, nothing started", async () => {
    const tampered = Buffer.from(BIN);
    tampered[0] ^= 1;
    const r = makeRig({ preinstall: tampered });
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "error");
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.hashMismatch);
    expect(r.t.getStatus().error).toMatch(/^Tệp đường hầm không khớp mã kiểm tra/);
    expect(fs.existsSync(r.t.exePath!)).toBe(false);
    expect(r.spawns).toHaveLength(0);
  });

  it("a download with the wrong hash is discarded; nothing is written or run", async () => {
    const r = makeRig({ downloadBytes: Buffer.from("evil") });
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "error");
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.hashMismatch);
    expect(fs.readdirSync(r.dir).filter((f) => f.startsWith("cloudflared-test"))).toEqual([]);
    expect(r.spawns).toHaveLength(0);
  });
});

describe("quick tunnel run", () => {
  it("AC-API-18b logic: downloads, verifies, starts hidden with loopback metrics, online only after the public URL answers with our instance", async () => {
    const r = makeRig();
    r.probeInstance.value = "someone-else";
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "verifying");
    expect(r.statuses.some((s) => s.state === "downloading")).toBe(true);
    expect(fs.readFileSync(r.t.exePath!)).toEqual(BIN);
    const sp = r.spawns[0];
    expect(sp.cmd).toBe(r.t.exePath);
    expect(sp.args.slice(0, 4)).toEqual(["tunnel", "--config", path.join(r.dir, "cloudflared-muse.yml"), "--no-autoupdate"]);
    expect(sp.args[sp.args.indexOf("--metrics") + 1]).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(sp.args.slice(-2)).toEqual(["--url", "http://127.0.0.1:47821"]);
    expect(sp.env.TUNNEL_TOKEN).toBeUndefined();
    await new Promise((res) => setTimeout(res, 100));
    expect(r.t.getStatus().state).toBe("verifying"); // wrong instance → not online
    r.probeInstance.value = "inst-1";
    await until(() => r.t.getStatus().state === "online");
    expect(r.t.getStatus().url).toBe("https://quiet-river-abc.trycloudflare.com");
    expect(r.t.publicHosts()).toEqual(["quiet-river-abc.trycloudflare.com"]);
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, "tunnel.pid"), "utf8"))).toMatchObject({ pid: sp.child.pid, exe: r.t.exePath });
  });

  it("AC-API-18c/d logic: stop ends the child and removes the pid file", async () => {
    const r = makeRig();
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "online");
    const child = r.spawns[0].child;
    const t0 = Date.now();
    await r.t.stop();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(child.killed).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(r.dir, "tunnel.pid"))).toBe(false);
    expect(r.t.getStatus().state).toBe("off");
  });

  it("a crashed child restarts with back-off; after 5 failures in a row it stops and waits for the user", async () => {
    const r = makeRig();
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "online");
    for (let i = 0; i < 6; i++) {
      const n = r.spawns.length;
      r.spawns[n - 1].child.crash();
      if (i < 5) {
        await until(() => r.spawns.length === n + 1 && r.t.getStatus().state === "online");
      }
    }
    // The stable timer never elapsed, so the attempts add up: 5 restarts then the 6th crash gives up.
    await until(() => r.t.getStatus().state === "error");
    expect(r.t.getStatus().error).toMatch(/^Đường hầm dừng 5 lần liên tiếp/);
    const before = r.spawns.length;
    r.t.retry();
    await until(() => r.spawns.length === before + 1 && r.t.getStatus().state === "online");
  });

  it("no hostname from Cloudflare within the time limit → retrying with a clear reason", async () => {
    const r = makeRig();
    r.hostname.value = null;
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "retrying", 2000);
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.noEdge);
    expect(r.spawns[0].child.killed).toBeGreaterThan(0);
  });

  it("stderr: Cloudflare refusing the quick tunnel is reported in words", async () => {
    const r = makeRig();
    r.hostname.value = null;
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.spawns.length === 1);
    r.spawns[0].child.stderr.write("2026-10-27T01:00:00Z ERR failed to request quick Tunnel: 429 Too Many Requests\n");
    await until(() => r.t.getStatus().state === "retrying", 2000);
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.quickRefused);
  });
});

describe("named tunnel (R29, R30)", () => {
  it("AC-API-25 logic: the token goes only to the child's environment — never into argv", async () => {
    const r = makeRig();
    const token = "CANARY-TUN-8842-eyJhIjoiYWJjIn0abcdefghijkl";
    r.t.start({ mode: "named", originPort: 47821, hostname: "muse.example.com", token });
    await until(() => r.t.getStatus().state === "online");
    const sp = r.spawns[0];
    expect(sp.args.join(" ").includes("CANARY-TUN-8842")).toBe(false);
    expect(sp.args[sp.args.length - 1]).toBe("run");
    expect(sp.env.TUNNEL_TOKEN).toBe(token);
    expect(Object.keys(sp.env).every((k) => ["TUNNEL_TOKEN", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "PATH", "Path", "HOME", "LANG"].includes(k))).toBe(true);
    expect(r.t.getStatus().url).toBe("https://muse.example.com");
    expect(fs.readFileSync(path.join(r.dir, "tunnel.pid"), "utf8").includes("CANARY")).toBe(false);
  });

  it("missing token or hostname → error without starting anything", async () => {
    const r = makeRig();
    r.t.start({ mode: "named", originPort: 47821, hostname: "muse.example.com" });
    await until(() => r.t.getStatus().state === "error");
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.missingNamed);
    expect(r.spawns).toHaveLength(0);
  });
});

describe("leftover process after a crash (AC-API-18e logic)", () => {
  it("kills the recorded PID only if it is still our executable", async () => {
    const ours = makeRig();
    fs.writeFileSync(path.join(ours.dir, "tunnel.pid"), JSON.stringify({ pid: 777, exe: ours.t.exePath }));
    const table = new Map<number, string>([[777, ours.t.exePath!]]);
    const r1 = makeRig({ processTable: table });
    // Same dir semantics: build a rig whose binDir has the pid file.
    fs.writeFileSync(path.join(r1.dir, "tunnel.pid"), JSON.stringify({ pid: 777, exe: r1.t.exePath }));
    table.set(777, r1.t.exePath!);
    expect(await r1.t.cleanupOrphan()).toBe("killed");
    expect(r1.killedPids).toEqual([777]);
    expect(fs.existsSync(path.join(r1.dir, "tunnel.pid"))).toBe(false);

    const r2 = makeRig({ processTable: new Map([[778, "C:\\Program Files\\cloudflared\\cloudflared.exe"]]) });
    fs.writeFileSync(path.join(r2.dir, "tunnel.pid"), JSON.stringify({ pid: 778, exe: r2.t.exePath }));
    expect(await r2.t.cleanupOrphan()).toBe("kept");
    expect(r2.killedPids).toEqual([]);

    const r3 = makeRig();
    fs.writeFileSync(path.join(r3.dir, "tunnel.pid"), JSON.stringify({ pid: 779, exe: r3.t.exePath }));
    expect(await r3.t.cleanupOrphan()).toBe("none"); // process gone
    expect(r3.killedPids).toEqual([]);
  });
});

describe("R30 rev 5 — health while online and fast toggles", () => {
  it("AC-DOM-13a: 2 failed checks keep online; the 3rd → “Mất kết nối, đang nối lại”, cloudflared restarted, online again", async () => {
    const r = makeRig();
    // Rig-level overrides for the health loop.
    (r.t as unknown as { d: TunnelDeps }).d.healthIntervalMs = 30;
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "online");
    const first = r.spawns[0].child;
    r.probeInstance.value = "gone";
    await until(() => r.t.getStatus().state === "retrying", 2000);
    expect(r.t.getStatus().error).toBe(TUNNEL_MSG.lost);
    expect(r.t.getStatus().error).toBe("Mất kết nối, đang nối lại");
    expect(first.killed).toBeGreaterThan(0);
    r.probeInstance.value = "inst-1";
    await until(() => r.spawns.length === 2 && r.t.getStatus().state === "online", 3000);
    expect(r.t.getStatus().attempt).toBe(1);
  });

  it("one failed check then a good one → stays online, same process", async () => {
    const r = makeRig();
    (r.t as unknown as { d: TunnelDeps }).d.healthIntervalMs = 40;
    r.t.start({ mode: "quick", originPort: 47821 });
    await until(() => r.t.getStatus().state === "online");
    r.probeInstance.value = "gone";
    await new Promise((res) => setTimeout(res, 60));
    r.probeInstance.value = "inst-1";
    await new Promise((res) => setTimeout(res, 200));
    expect(r.t.getStatus().state).toBe("online");
    expect(r.spawns).toHaveLength(1);
  });

  it("start → stop at once leaves no process; start A, start B leaves only B", async () => {
    const r = makeRig();
    r.t.start({ mode: "quick", originPort: 47821 });
    await r.t.stop();
    await new Promise((res) => setTimeout(res, 100));
    expect(r.spawns).toHaveLength(0);
    r.t.start({ mode: "quick", originPort: 47821 });
    r.t.start({ mode: "named", originPort: 47821, hostname: "muse.example.com", token: "tok-abcdefghijklmnopqrstuvwxyz" });
    await until(() => r.t.getStatus().state === "online");
    await new Promise((res) => setTimeout(res, 100));
    const alive = r.spawns.filter((s) => s.child.exitCode === null);
    expect(alive).toHaveLength(1);
    expect(alive[0].args[alive[0].args.length - 1]).toBe("run");
  });
});
