import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarGzEntry, extractZipEntry } from "../src/main/api/archive";
import { CaddyManager, type CaddyDeps, type CaddyStatus } from "../src/main/api/caddy";
import { DOMAIN_MSG } from "../src/shared/api/domain";

// R35 / AC-DOM-04, -05, -11c, -12 with a fake Caddy (spawn, fetch, port check and process table injected).

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (deflate) — enough to test our extractor like the real release ZIP. */
function makeZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function makeTarGz(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000755\0", 100);
    h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("        ", 148);
    let sum = 0;
    for (const x of h) sum += x;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

const EXE = Buffer.from("fake caddy executable 2.11.7 ".repeat(50));
const ZIP = makeZip({ LICENSE: Buffer.from("Apache-2.0"), "README.md": Buffer.from("readme"), "caddy.exe": EXE });

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = 0;
  constructor(public pid: number) {
    super();
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
  started(): void {
    this.stderr.write('{"level":"info","ts":1,"msg":"serving initial configuration"}\n');
  }
}

interface Rig {
  c: CaddyManager;
  dir: string;
  caddyDir: string;
  statuses: CaddyStatus[];
  spawns: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; child: FakeChild }[];
  fetches: string[];
  killed: number[];
  busy: Set<number>;
  events: string[];
  logs: string[];
}

let rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs) await r.c.stop();
  rigs = [];
});

function rig(o: { zip?: Buffer; archiveSha?: string; preinstall?: Buffer; processTable?: Map<number, string>; autoStart?: boolean } = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-caddy-"));
  const caddyDir = path.join(dir, "caddy");
  const statuses: CaddyStatus[] = [];
  const spawns: Rig["spawns"] = [];
  const fetches: string[] = [];
  const killed: number[] = [];
  const busy = new Set<number>();
  const events: string[] = [];
  const logs: string[] = [];
  const zip = o.zip ?? ZIP;
  const binary = { url: "https://example.invalid/caddy_2.11.7_windows_amd64.zip", archiveSha256: o.archiveSha ?? sha(zip), archiveBytes: zip.length, entry: "caddy.exe", sha256: sha(EXE), file: "caddy-test.exe" };
  const binDir = path.join(dir, "bin");
  if (o.preinstall) {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, binary.file), o.preinstall);
  }
  let pid = 6000;
  const deps: CaddyDeps = {
    binDir,
    caddyDir,
    binary,
    fetch: (async (input: string | URL) => {
      fetches.push(String(input));
      return new Response(new Uint8Array(zip), { status: 200, headers: { "content-length": String(zip.length) } });
    }) as typeof fetch,
    log: (_level, msg, data) => void logs.push(`${msg} ${JSON.stringify(data ?? {})}`),
    onChange: (s) => statuses.push(s),
    onEvent: (k) => events.push(k),
    spawn: ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }) => {
      const child = new FakeChild(++pid);
      spawns.push({ cmd, args, env: opts.env, cwd: opts.cwd, child });
      if (o.autoStart !== false) setTimeout(() => child.started(), 5);
      return child;
    }) as unknown as CaddyDeps["spawn"],
    processPath: async (p) => o.processTable?.get(p) ?? null,
    kill: (p) => void killed.push(p),
    portFree: async (p) => !busy.has(p),
    delaysS: [0.03, 0.03, 0.03, 0.03, 0.03],
  };
  const r: Rig = { c: new CaddyManager(deps), dir, caddyDir, statuses, spawns, fetches, killed, busy, events, logs };
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

const RUN = { host: "muse.example.com", apiPort: 47822 };

describe("archive extraction (no PowerShell, no extra dependency)", () => {
  it("reads caddy.exe out of a deflated ZIP and caddy out of a tar.gz", async () => {
    expect(await extractZipEntry(ZIP, "caddy.exe")).toEqual(EXE);
    expect(await extractTarGzEntry(makeTarGz({ LICENSE: Buffer.from("x"), caddy: EXE }), "caddy")).toEqual(EXE);
    await expect(extractZipEntry(ZIP, "nope.exe")).rejects.toThrow(/not found/);
  });
});

describe("pinned download (AC-DOM-04)", () => {
  it("(a) a download changed by one byte → “Tệp Caddy không khớp mã kiểm tra”, no file left, nothing run", async () => {
    const bad = Buffer.from(ZIP);
    bad[40] ^= 1;
    const r = rig({ zip: bad, archiveSha: sha(ZIP) });
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "error");
    expect(r.c.getStatus().error).toBe(DOMAIN_MSG.hashMismatch);
    expect(r.c.getStatus().error).toMatch(/^Tệp Caddy không khớp mã kiểm tra/);
    expect(fs.readdirSync(path.join(r.dir, "bin"))).toEqual([]);
    expect(r.spawns).toHaveLength(0);
  });

  it("(a') archive matches but the executable inside does not → same refusal", async () => {
    const other = makeZip({ "caddy.exe": Buffer.from("tampered caddy") });
    const r = rig({ zip: other, archiveSha: sha(other) });
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "error");
    expect(r.c.getStatus().error).toBe(DOMAIN_MSG.hashMismatch);
    expect(fs.readdirSync(path.join(r.dir, "bin"))).toEqual([]);
    expect(r.spawns).toHaveLength(0);
  });

  it("(b) an installed caddy.exe changed by one byte → deleted, not run; Thử lại downloads it again and runs", async () => {
    const t = Buffer.from(EXE);
    t[3] ^= 1;
    const r = rig({ preinstall: t });
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "error");
    expect(r.c.getStatus().error).toBe(DOMAIN_MSG.hashMismatch);
    expect(fs.existsSync(r.c.exePath!)).toBe(false);
    expect(r.spawns).toHaveLength(0);
    r.c.retry();
    await until(() => r.c.getStatus().phase === "running");
    expect(r.fetches).toHaveLength(1);
    expect(fs.readFileSync(r.c.exePath!)).toEqual(EXE);
  });

  it("(c) correct file → run --config … --adapter caddyfile; config, argv and env carry no API key or tunnel token", async () => {
    const r = rig();
    process.env.MUSE_FAKE_SECRET = "CANARY-KEY-should-not-leak";
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    delete process.env.MUSE_FAKE_SECRET;
    const sp = r.spawns[0];
    expect(sp.cmd).toBe(r.c.exePath);
    expect(sp.args).toEqual(["run", "--config", path.join(r.caddyDir, "Caddyfile"), "--adapter", "caddyfile"]);
    const cfg = fs.readFileSync(path.join(r.caddyDir, "Caddyfile"), "utf8");
    expect(cfg).toContain("admin off");
    expect(cfg).toContain("muse.example.com {");
    expect(cfg).toContain("reverse_proxy 127.0.0.1:47822");
    expect(cfg).toContain(`header_up X-Muse-Ingress ${r.c.marker()}`);
    expect(r.c.marker()).toMatch(/^[a-f0-9]{32}$/);
    const allowed = ["SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "PATH", "Path", "HOME", "LANG", "XDG_DATA_HOME", "XDG_CONFIG_HOME"];
    expect(Object.keys(sp.env).every((k) => allowed.includes(k))).toBe(true);
    expect(JSON.stringify(sp.env) + sp.args.join(" ") + cfg).not.toContain("CANARY");
    expect(sp.env.XDG_DATA_HOME!.startsWith(r.caddyDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(r.caddyDir, "caddy.pid"), "utf8"))).toMatchObject({ pid: sp.child.pid, exe: r.c.exePath });
    expect(r.events).toContain("started");
  });

  it("every start gets a new ingress marker", async () => {
    const r = rig();
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    const m1 = r.c.marker();
    r.c.start({ ...RUN, apiPort: 47823 });
    await until(() => r.spawns.length === 2 && r.c.getStatus().phase === "running");
    expect(r.c.marker()).not.toBe(m1);
    expect(r.spawns[0].child.killed).toBeGreaterThan(0);
  });
});

describe("ports (AC-DOM-05)", () => {
  it("(a) 443 busy → error, no Caddy, the other program untouched", async () => {
    const r = rig();
    r.busy.add(443);
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "error");
    expect(r.c.getStatus().error).toBe("Cổng 443 đang bị chương trình khác dùng — tắt chương trình đó hoặc chọn Proxy HTTPS có sẵn");
    expect(r.c.getStatus().port).toEqual({ state: "fail", detail: DOMAIN_MSG.port443 });
    expect(r.spawns).toHaveLength(0);
    expect(r.killed).toEqual([]);
  });

  it("(b) 80 busy, 443 free → runs with 443 only and the note “Cổng 80 đang bận: chỉ dùng 443”", async () => {
    const r = rig();
    r.busy.add(80);
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    expect(r.c.getStatus().port).toEqual({ state: "warn", detail: "Cổng 80 đang bận: chỉ dùng 443" });
    const cfg = fs.readFileSync(path.join(r.caddyDir, "Caddyfile"), "utf8");
    expect(cfg).toContain("auto_https disable_redirects");
    expect(cfg).toContain("disable_http_challenge");
  });
});

describe("lifecycle", () => {
  it("AC-DOM-12: exits restart after the back-off; the 6th exit → “Caddy dừng 5 lần liên tiếp — bấm Thử lại”; Thử lại starts over", async () => {
    const r = rig();
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    for (let i = 0; i < 6; i++) {
      const n = r.spawns.length;
      r.spawns[n - 1].child.crash();
      if (i < 5) await until(() => r.spawns.length === n + 1 && r.c.getStatus().phase === "running");
    }
    await until(() => r.c.getStatus().phase === "error");
    expect(r.c.getStatus().error).toBe("Caddy dừng 5 lần liên tiếp — bấm Thử lại");
    expect(r.c.marker()).toBeNull();
    const before = r.spawns.length;
    r.c.retry();
    await until(() => r.spawns.length === before + 1 && r.c.getStatus().phase === "running");
    expect(r.c.getStatus().attempt).toBe(0);
  });

  it("stop ends the child within 3 s, removes the pid file and clears the marker", async () => {
    const r = rig();
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    const t0 = Date.now();
    await r.c.stop();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.spawns[0].child.killed).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(r.caddyDir, "caddy.pid"))).toBe(false);
    expect(r.c.getStatus().phase).toBe("off");
    expect(r.c.marker()).toBeNull();
  });

  it("start then stop at once → nothing is left running (fast toggles)", async () => {
    const r = rig();
    r.c.start(RUN);
    await r.c.stop();
    r.c.start(RUN);
    r.c.start({ ...RUN, host: "api.example.com" });
    await until(() => r.c.getStatus().phase === "running");
    await new Promise((res) => setTimeout(res, 100));
    const alive = r.spawns.filter((s) => s.child.exitCode === null);
    expect(alive).toHaveLength(1);
    expect(fs.readFileSync(path.join(r.caddyDir, "Caddyfile"), "utf8")).toContain("api.example.com {");
  });

  it("Let's Encrypt events reach the status", async () => {
    const r = rig();
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    r.spawns[0].child.stderr.write('{"level":"info","logger":"tls.obtain","msg":"obtaining certificate"}\n');
    await until(() => r.c.getStatus().certObtaining);
    r.spawns[0].child.stderr.write('{"level":"error","logger":"tls.obtain","msg":"could not get certificate from issuer","error":"DNS problem: NXDOMAIN looking up A"}\n');
    await until(() => r.c.getStatus().certError !== null);
    expect(r.c.getStatus().certError).toBe("Let's Encrypt chưa thấy bản ghi DNS của tên miền");
    r.spawns[0].child.stderr.write('{"level":"info","logger":"tls.obtain","msg":"certificate obtained successfully"}\n');
    await until(() => r.c.getStatus().certObtainedAt !== null);
    expect(r.c.getStatus().certError).toBeNull();
    expect(r.events).toEqual(expect.arrayContaining(["started", "cert_error", "obtained"]));
  });

  it("the per-connection keepalive warning of Windows Server 2016 is not logged and does not use up the log budget", async () => {
    const r = rig();
    r.c.start(RUN);
    await until(() => r.c.getStatus().phase === "running");
    for (let i = 0; i < 40; i++) r.spawns[0].child.stderr.write('{"level":"warn","logger":"http","msg":"unable to set keepalive for new connection:","error":"set tcp: setsockopt: invalid argument"}\n');
    r.spawns[0].child.stderr.write('{"level":"warn","logger":"http","msg":"HTTP/2 skipped because it requires TLS"}\n');
    await until(() => r.logs.some((l) => l.includes("HTTP/2 skipped")));
    expect(r.logs.filter((l) => l.includes("keepalive"))).toHaveLength(0);
  });
});

describe("leftover Caddy after a crash (AC-DOM-11c logic)", () => {
  it("stops the recorded PID only when it is still our executable; another caddy keeps running", async () => {
    const table = new Map<number, string>();
    const r1 = rig({ processTable: table });
    fs.mkdirSync(r1.caddyDir, { recursive: true });
    fs.writeFileSync(path.join(r1.caddyDir, "caddy.pid"), JSON.stringify({ pid: 901, exe: r1.c.exePath }));
    table.set(901, r1.c.exePath!);
    expect(await r1.c.cleanupOrphan()).toBe("killed");
    expect(r1.killed).toEqual([901]);

    const r2 = rig({ processTable: new Map([[902, "C:\\Tools\\caddy.exe"]]) });
    fs.mkdirSync(r2.caddyDir, { recursive: true });
    fs.writeFileSync(path.join(r2.caddyDir, "caddy.pid"), JSON.stringify({ pid: 902, exe: r2.c.exePath }));
    expect(await r2.c.cleanupOrphan()).toBe("kept");
    expect(r2.killed).toEqual([]);
  });
});
