import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectInstall, Updater, UpdateError, type UpdaterDeps } from "../src/main/updater";
import { consoleLaunchArgs, type UpdateStatus } from "../src/shared/updates";

// Build 3.3 — the main-process updater with fake network, spawn and quit (Spec AC-UPD-02…08, AC-RBK-01…03).

const SITE = "https://muse4ai.andrewbabo.com";
const MANIFEST = `${SITE}/releases/latest.json`;
const EXE = new Uint8Array(1_200_000).map((_, i) => (i * 31) % 251);
const SHA = createHash("sha256").update(EXE).digest("hex").toUpperCase();

const manifest = (over: Record<string, unknown> = {}) => ({
  product: "Muse4AI",
  version: "2.0.0-beta.35",
  date: "2026-11-08",
  url: `${SITE}/__l5e/assets-v1/x/muse4ai-setup-win-x64.exe`,
  sha256: SHA,
  bytes: EXE.length,
  notes: [{ en: "New things.", vi: "Có cái mới." }],
  page: `${SITE}/download`,
  ...over,
});

function respond(body: BodyInit | null, init: ResponseInit = {}, url = ""): Response {
  const r = new Response(body, init);
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
}

let dir: string;
let calls: { spawn: unknown[][]; quit: number; announce: string[]; emits: UpdateStatus[] };
let net: { manifest: () => Response; exe: () => Response };

function deps(over: Partial<UpdaterDeps> = {}): UpdaterDeps {
  return {
    version: "2.0.0-beta.34",
    schema: 7,
    manifestUrl: MANIFEST,
    fetch: async (url) => (url === MANIFEST ? net.manifest() : net.exe()),
    updatesDir: path.join(dir, "local", "updates"),
    roamingDir: path.join(dir, "roaming"),
    layout: null,
    autoCheck: () => true,
    locale: () => "vi",
    diskFree: async () => 10e9,
    inFlight: () => 0,
    spawnDetached: (f, a, o) => calls.spawn.push(o ? [f, a, o] : [f, a]),
    quit: () => calls.quit++,
    emit: (s) => calls.emits.push(s),
    announce: (v) => calls.announce.push(v),
    log: () => undefined,
    powershell: "powershell.exe",
    comspec: "cmd.exe",
    ...over,
  };
}

function installedLayout() {
  const root = path.join(dir, "Programs", "Muse4AI");
  for (const v of ["2.0.0-beta.33", "2.0.0-beta.34"]) {
    fs.mkdirSync(path.join(root, `app-${v}`), { recursive: true });
    fs.writeFileSync(path.join(root, `app-${v}`, "Muse4AI.exe"), "x");
  }
  fs.utimesSync(path.join(root, "app-2.0.0-beta.33"), new Date(1000), new Date(1000));
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.writeFileSync(path.join(root, "tools", "install.ps1"), "#");
  fs.writeFileSync(path.join(root, "tools", "uninstall.ps1"), "#");
  return { root, installScript: path.join(root, "tools", "install.ps1") };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m4-upd-"));
  fs.mkdirSync(path.join(dir, "roaming"), { recursive: true });
  calls = { spawn: [], quit: 0, announce: [], emits: [] };
  net = { manifest: () => respond(JSON.stringify(manifest())), exe: () => respond(EXE) };
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("check (AC-UPD-02…04)", () => {
  it("finds a newer version and announces it only once, across restarts too", async () => {
    const u = new Updater(deps());
    u.init(7);
    const s = await u.check();
    expect(s.available).toBe(true);
    expect(s.latest?.version).toBe("2.0.0-beta.35");
    expect(s.error).toBeNull();
    await u.check();
    expect(calls.announce).toEqual(["2.0.0-beta.35"]);
    const again = new Updater(deps());
    again.init(7);
    await again.check();
    expect(calls.announce).toEqual(["2.0.0-beta.35"]);
  });
  it("says the app is up to date when the website has the same version", async () => {
    net.manifest = () => respond(JSON.stringify(manifest({ version: "2.0.0-beta.34" })));
    const u = new Updater(deps());
    u.init(7);
    const s = await u.check();
    expect(s.available).toBe(false);
    expect(calls.announce).toEqual([]);
  });
  it("keeps the previous result and says why when a check fails", async () => {
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    net.manifest = () => respond("oops", { status: 503 });
    const s = await u.check();
    expect(s.error).toBe("Website trả mã 503");
    expect(s.latest?.version).toBe("2.0.0-beta.35");
  });
  it.each([
    ["a manifest pointing elsewhere", () => respond(JSON.stringify(manifest({ url: "https://evil.example/x.exe" })))],
    ["a body that is not JSON", () => respond("<html>")],
    ["a body over 64 KiB", () => respond("x".repeat(70_000))],
    ["a redirect to another origin", () => respond(JSON.stringify(manifest()), {}, "https://other.example/releases/latest.json")],
  ])("refuses %s", async (_n, make) => {
    net.manifest = make;
    const u = new Updater(deps());
    u.init(7);
    const s = await u.check();
    expect(s.error).toBe("Thông tin bản mới không hợp lệ");
    expect(s.available).toBe(false);
  });
  it("reports a network failure in plain words", async () => {
    const u = new Updater(deps({ fetch: async () => Promise.reject(new TypeError("fetch failed")) }));
    u.init(7);
    expect((await u.check()).error).toBe("Không kết nối được tới website");
  });
});

describe("download (AC-UPD-05)", () => {
  it("streams to the updates folder, verifies size + SHA-256 and reuses a verified file", async () => {
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    const s = await u.download();
    expect(s.download.state).toBe("ready");
    const file = path.join(dir, "local", "updates", "Muse4AI-2.0.0-beta.35-Setup-win-x64.exe");
    expect(fs.statSync(file).size).toBe(EXE.length);
    expect(fs.existsSync(`${file}.part`)).toBe(false);
    const fetched = vi.fn(async () => respond(EXE));
    const again = new Updater(deps({ fetch: async (url) => (url === MANIFEST ? net.manifest() : fetched()) }));
    again.init(7);
    await again.check();
    expect(again.status().download.state).toBe("ready");
    await again.download();
    expect(fetched).not.toHaveBeenCalled();
  });
  it("deletes a file that does not match and says so", async () => {
    net.exe = () => respond(EXE.slice().fill(7));
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    const s = await u.download();
    expect(s.download).toMatchObject({ state: "error", error: "Tệp tải về không khớp mã kiểm tra — đã xoá, hãy tải lại" });
    expect(fs.readdirSync(path.join(dir, "local", "updates")).filter((f) => f.endsWith(".exe") || f.endsWith(".part"))).toEqual([]);
  });
  it("stops a body bigger than announced", async () => {
    net.exe = () => respond(new Uint8Array(EXE.length + 10));
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    expect((await u.download()).download.error).toBe("Tệp tải về lớn hơn dự kiến — đã huỷ");
  });
  it("needs 1.2 × the installer size free before starting", async () => {
    const u = new Updater(deps({ diskFree: async () => EXE.length }));
    u.init(7);
    await u.check();
    expect((await u.download()).download.error).toBe("Ổ đĩa không đủ chỗ: cần khoảng 2 MB trống");
  });
  it("refuses to download when there is nothing newer or no installer", async () => {
    net.manifest = () => respond(JSON.stringify(manifest({ url: null, sha256: null, bytes: null })));
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    await expect(u.download()).rejects.toBeInstanceOf(UpdateError);
  });
});

describe("install (AC-UPD-06, AC-UPD-08)", () => {
  it("is not offered when the app does not run from an installed folder", async () => {
    const u = new Updater(deps());
    u.init(7);
    await u.check();
    await u.download();
    expect(u.status().installable).toBe(false);
    await expect(u.install(true)).rejects.toThrow(UpdateError);
  });
  it("asks first while jobs run, then starts setup silently in the app's folder and quits", async () => {
    const layout = installedLayout();
    let running = 2;
    const u = new Updater(deps({ layout, inFlight: () => running }));
    u.init(7);
    await u.check();
    await u.download();
    expect(await u.install(false)).toEqual({ needsConfirm: true, running: 2 });
    expect(calls.spawn).toEqual([]);
    vi.useFakeTimers();
    running = 0;
    expect(await u.install(false)).toEqual({ needsConfirm: false, running: 0 });
    const [file, args] = calls.spawn[0]! as [string, string[]];
    expect(path.basename(file)).toBe("Muse4AI-2.0.0-beta.35-Setup-win-x64.exe");
    expect(args).toEqual(["/SILENT", "/NORESTART", "/SP-", "/LANG=vi", `/INSTALLROOT=${layout.root}`, "/RELAUNCH=1"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "local", "updates", "pending.json"), "utf8"))).toMatchObject({ from: "2.0.0-beta.34", to: "2.0.0-beta.35" });
    vi.advanceTimersByTime(700);
    expect(calls.quit).toBe(1);
  });
  it("refuses an installer that changed after it was verified", async () => {
    const layout = installedLayout();
    const u = new Updater(deps({ layout }));
    u.init(7);
    await u.check();
    await u.download();
    fs.writeFileSync(path.join(dir, "local", "updates", "Muse4AI-2.0.0-beta.35-Setup-win-x64.exe"), EXE.slice().fill(1));
    await expect(u.install(true)).rejects.toThrow("Tệp bộ cài đã bị thay đổi — đã xoá, hãy tải lại");
    expect(calls.spawn).toEqual([]);
  });
});

describe("after an update and rollback (AC-UPD-07, AC-RBK-01…03)", () => {
  it("shows the 'just updated' note once, cleans old installers and records versions.json", () => {
    const up = path.join(dir, "local", "updates");
    fs.mkdirSync(up, { recursive: true });
    fs.writeFileSync(path.join(up, "pending.json"), JSON.stringify({ from: "2.0.0-beta.33", to: "2.0.0-beta.34", notes: [{ en: "a", vi: "b" }] }));
    fs.writeFileSync(path.join(up, "Muse4AI-2.0.0-beta.34-Setup-win-x64.exe"), "old");
    const u = new Updater(deps());
    u.init(7);
    expect(u.status().justUpdated).toEqual({ from: "2.0.0-beta.33", notes: [{ en: "a", vi: "b" }] });
    expect(fs.existsSync(path.join(up, "pending.json"))).toBe(false);
    expect(fs.existsSync(path.join(up, "Muse4AI-2.0.0-beta.34-Setup-win-x64.exe"))).toBe(false);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, "roaming", "versions.json"), "utf8"));
    expect(rec).toMatchObject({ storeSchema: 7, versions: { "2.0.0-beta.34": 7, "2.0.0-beta.33": 7 } });
    u.dismissJustUpdated();
    expect(u.status().justUpdated).toBeNull();
  });
  it("offers the kept previous version and hands over to the installer's kept script", () => {
    const layout = installedLayout();
    vi.useFakeTimers();
    const u = new Updater(deps({ layout, locale: () => "en" }));
    u.init(7);
    expect(u.status().rollback).toEqual({ ok: true, version: "2.0.0-beta.33" });
    expect(u.rollback(false)).toEqual({ needsConfirm: false, running: 0, version: "2.0.0-beta.33" });
    // Through cmd's `start` so PowerShell gets its own console and outlives the app (a detached one exits at once).
    const ps = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", layout.installScript, "-Rollback", "-Target", "2.0.0-beta.33", "-CloseRunning", "-Gui", "-InstallRoot", layout.root, "-Lang", "en"];
    expect(calls.spawn[0]).toEqual(["cmd.exe", consoleLaunchArgs(ps[0], ps.slice(1)), { verbatim: true }]);
    vi.advanceTimersByTime(700);
    expect(calls.quit).toBe(1);
  });
  it("does not offer a previous version that cannot open the store as it is now", () => {
    const layout = installedLayout();
    const u = new Updater(deps({ layout, schema: 8 }));
    u.init(8);
    expect(u.status().rollback).toEqual({ ok: false, version: "2.0.0-beta.33", reason: "newer_data" });
    expect(() => u.rollback(true)).toThrow(UpdateError);
  });
});

describe("installed-folder detection (AC-UPD-08)", () => {
  it("needs app-<version> inside a folder that has the installer's kept scripts", () => {
    const has = (p: string) => p.endsWith(path.join("tools", "install.ps1")) || p.endsWith(path.join("tools", "uninstall.ps1"));
    expect(detectInstall(path.join("/u", "Programs", "Muse4AI", "app-2.0.0-beta.34", "Muse4AI.exe"), "2.0.0-beta.34", has)).toEqual({ root: path.join("/u", "Programs", "Muse4AI"), installScript: path.join("/u", "Programs", "Muse4AI", "tools", "install.ps1") });
    expect(detectInstall(path.join("/u", "Downloads", "Muse4AI-zip", "Muse4AI.exe"), "2.0.0-beta.34", has)).toBeNull();
    expect(detectInstall(path.join("/u", "Programs", "Muse4AI", "app-2.0.0-beta.34", "Muse4AI.exe"), "2.0.0-beta.34", () => false)).toBeNull();
  });
});
