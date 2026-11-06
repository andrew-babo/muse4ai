import { describe, expect, it } from "vitest";
import {
  compareVersions,
  consoleLaunchArgs,
  installerArgs,
  installerFileName,
  isNewer,
  KNOWN_SCHEMAS,
  latestIsKept,
  mergeVersionsRecord,
  parseManifest,
  previousVersion,
  readVersionsRecord,
  rollbackCheck,
  staleInstallers,
  UPDATE_LIMITS,
} from "../src/shared/updates";

// Build 3.3 — update and rollback rules (Spec AC-UPD-02…08, AC-RBK-01…03).

const SITE = "https://muse4ai.andrewbabo.com";
const FROM = `${SITE}/releases/latest.json`;
const good = {
  version: "2.0.0-beta.34",
  date: "2026-11-07",
  url: `${SITE}/__l5e/assets-v1/uuid/muse4ai-setup-win-x64.exe`,
  sha256: "c650505dd6bffc6edce6e8ed3fb5843c62412cedd43e3bcffafef2e6e69c2c48",
  bytes: 171_737_324,
  notes: [{ en: "Updates itself.", vi: "Tự cập nhật." }],
  page: `${SITE}/download`,
};

describe("version order (AC-UPD-03)", () => {
  it("compares pre-release numbers as numbers", () => {
    expect(compareVersions("2.0.0-beta.34", "2.0.0-beta.4")).toBe(1);
    expect(compareVersions("2.0.0-beta.33", "2.0.0-beta.34")).toBe(-1);
    expect(compareVersions("2.0.0-beta.34", "2.0.0-beta.34")).toBe(0);
  });
  it("puts a release after its pre-releases and core numbers first", () => {
    expect(compareVersions("2.0.0", "2.0.0-beta.99")).toBe(1);
    expect(compareVersions("2.0.1-beta.1", "2.0.0")).toBe(1);
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
    expect(compareVersions("2.0.0-beta.1", "2.0.0-rc.1")).toBe(-1);
    expect(compareVersions("2.0.0-beta", "2.0.0-beta.1")).toBe(-1);
    expect(compareVersions("2.0.0-1", "2.0.0-alpha")).toBe(-1);
  });
  it("never calls a bad value newer", () => {
    expect(compareVersions("v2.0.0", "2.0.0")).toBeNull();
    expect(compareVersions("2.0", "1.0.0")).toBeNull();
    expect(isNewer("garbage", "2.0.0-beta.33")).toBe(false);
    expect(isNewer("2.0.0-beta.34", "2.0.0-beta.33")).toBe(true);
    expect(isNewer("2.0.0-beta.33", "2.0.0-beta.33")).toBe(false);
  });
});

describe("manifest check (AC-UPD-01, AC-UPD-03)", () => {
  it("accepts the website's manifest and normalises the hash", () => {
    const r = parseManifest(good, FROM);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.sha256).toBe(good.sha256.toUpperCase());
  });
  it("accepts a release that is not offered for download (url null)", () => {
    const r = parseManifest({ ...good, url: null, sha256: null, bytes: null }, FROM);
    expect(r.ok && r.manifest.url).toBe(null);
  });
  it.each([
    ["installer on another site", { url: "https://evil.example/muse4ai.exe" }, "url"],
    ["plain http installer", { url: `http://muse4ai.andrewbabo.com/x.exe` }, "url"],
    ["short hash", { sha256: "ABC" }, "sha256"],
    ["tiny file", { bytes: 1000 }, "bytes"],
    ["huge file", { bytes: 2_000_000_000 }, "bytes"],
    ["bad version", { version: "latest" }, "version"],
    ["page elsewhere", { page: "https://evil.example/download" }, "page"],
    ["note not text", { notes: [{ en: 1, vi: "x" }] }, "notes"],
  ])("refuses %s", (_name, patch, reason) => {
    const r = parseManifest({ ...good, ...patch }, FROM);
    expect(r).toEqual({ ok: false, reason });
  });
  it("refuses a manifest that did not come over https", () => {
    expect(parseManifest(good, "http://muse4ai.andrewbabo.com/releases/latest.json")).toEqual({ ok: false, reason: "not_https" });
  });
  it("judges the origin by where the manifest finally came from (after a redirect)", () => {
    expect(parseManifest(good, "https://muse4ai.lovable.app/releases/latest.json").ok).toBe(false);
  });
  it("accepts plain http from 127.0.0.1 only when the test-mode flag is given", () => {
    const local = "http://127.0.0.1:8123";
    const m = { ...good, url: `${local}/setup.exe`, page: `${local}/download` };
    expect(parseManifest(m, `${local}/releases/latest.json`).ok).toBe(false);
    expect(parseManifest(m, `${local}/releases/latest.json`, { loopbackHttp: true }).ok).toBe(true);
    expect(parseManifest({ ...m, url: "http://10.0.0.5/setup.exe" }, `${local}/releases/latest.json`, { loopbackHttp: true }).ok).toBe(false);
  });
  it("keeps the agreed limits", () => {
    expect(UPDATE_LIMITS.intervalMs).toBe(12 * 3600_000);
    expect(UPDATE_LIMITS.timeoutMs).toBe(15_000);
    expect(UPDATE_LIMITS.manifestMaxBytes).toBe(64 * 1024);
    expect(UPDATE_LIMITS.diskFactor).toBe(1.2);
  });
});

describe("installer files and arguments (AC-UPD-05…07)", () => {
  it("names a download only from a validated version", () => {
    expect(installerFileName("2.0.0-beta.34")).toBe("Muse4AI-2.0.0-beta.34-Setup-win-x64.exe");
    expect(() => installerFileName("../../x")).toThrow();
  });
  it("cleans installers that are not newer than the running app, and interrupted downloads", () => {
    const files = ["Muse4AI-2.0.0-beta.33-Setup-win-x64.exe", "Muse4AI-2.0.0-beta.34-Setup-win-x64.exe", "Muse4AI-2.0.0-beta.35-Setup-win-x64.exe", "Muse4AI-2.0.0-beta.35-Setup-win-x64.exe.part", "pending.json"];
    expect(staleInstallers(files, "2.0.0-beta.34")).toEqual(["Muse4AI-2.0.0-beta.33-Setup-win-x64.exe", "Muse4AI-2.0.0-beta.34-Setup-win-x64.exe", "Muse4AI-2.0.0-beta.35-Setup-win-x64.exe.part"]);
  });
  it("runs setup silently in the app language, in the app's own folder, and reopens it", () => {
    expect(installerArgs("vi", "C:\\Users\\An Nguyen\\AppData\\Local\\Programs\\Muse4AI\\")).toEqual([
      "/SILENT",
      "/NORESTART",
      "/SP-",
      "/LANG=vi",
      "/INSTALLROOT=C:\\Users\\An Nguyen\\AppData\\Local\\Programs\\Muse4AI",
      "/RELAUNCH=1",
    ]);
    expect(() => installerArgs("en", 'C:\\x" /DIR="y')).toThrow();
  });
  it("starts PowerShell through cmd's start with its own console, quoting folders with spaces (AC-RBK-03)", () => {
    const line = consoleLaunchArgs("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-File", "C:\\Users\\An Nguyen\\AppData\\Local\\Programs\\Muse4AI\\tools\\install.ps1", "-Target", "2.0.0-beta.34", "-InstallRoot", "C:\\Users\\A&B (x)\\Muse4AI"]);
    expect(line).toEqual([
      "/d",
      "/v:off",
      "/s",
      "/c",
      '"start "" /min C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -File "C:\\Users\\An Nguyen\\AppData\\Local\\Programs\\Muse4AI\\tools\\install.ps1" -Target 2.0.0-beta.34 -InstallRoot "C:\\Users\\A&B (x)\\Muse4AI""',
    ]);
  });
  it("refuses parts cmd cannot pass safely (quotes, %, line breaks, empty)", () => {
    for (const bad of ['C:\\x" & calc', "C:\\100%\\Muse4AI", "a\nb", ""]) expect(consoleLaunchArgs("powershell.exe", ["-InstallRoot", bad])).toBeNull();
  });
});

describe("rollback (AC-RBK-01, AC-RBK-02)", () => {
  it("knows the store schema of the releases before beta.34", () => {
    expect(KNOWN_SCHEMAS["2.0.0-beta.33"]).toBe(7);
    expect(KNOWN_SCHEMAS["2.0.0-beta.32"]).toBe(7);
    expect(KNOWN_SCHEMAS["2.0.0-beta.31"]).toBe(6);
  });
  it("records this version, keeps known and earlier entries, drops junk", () => {
    const r = mergeVersionsRecord({ storeSchema: 7, versions: { "2.0.0-beta.20": 5, "bad": 3, "2.0.0-beta.21": "x" } }, { version: "2.0.0-beta.34", schema: 7, storeSchema: 7 });
    expect(r.storeSchema).toBe(7);
    expect(r.versions["2.0.0-beta.34"]).toBe(7);
    expect(r.versions["2.0.0-beta.33"]).toBe(7);
    expect(r.versions["2.0.0-beta.20"]).toBe(5);
    expect(r.versions).not.toHaveProperty("bad");
    expect(r.versions).not.toHaveProperty("2.0.0-beta.21");
    expect(readVersionsRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it("offers the previous version only when it can open the store as it is now", () => {
    const rec = mergeVersionsRecord(null, { version: "2.0.0-beta.34", schema: 8, storeSchema: 8 });
    expect(rollbackCheck("2.0.0-beta.33", rec)).toEqual({ ok: false, version: "2.0.0-beta.33", reason: "newer_data" });
    const same = mergeVersionsRecord(null, { version: "2.0.0-beta.34", schema: 7, storeSchema: 7 });
    expect(rollbackCheck("2.0.0-beta.33", same)).toEqual({ ok: true, version: "2.0.0-beta.33" });
    expect(rollbackCheck("2.0.0-beta.29", same)).toEqual({ ok: false, version: "2.0.0-beta.29", reason: "unknown" });
    expect(rollbackCheck("2.0.0-beta.33", null)).toEqual({ ok: false, version: "2.0.0-beta.33", reason: "unknown" });
    expect(rollbackCheck(null, same)).toEqual({ ok: false, version: null, reason: "none" });
  });
  it("finds the kept previous version like install.ps1 -Rollback (newest folder, not the running one, no leftovers)", () => {
    const folders = [
      { name: "app-2.0.0-beta.34", mtimeMs: 300, hasExe: true },
      { name: "app-2.0.0-beta.33", mtimeMs: 200, hasExe: true },
      { name: "app-2.0.0-beta.35.bak-1a2b3c", mtimeMs: 400, hasExe: true },
      { name: "app-2.0.0-beta.32", mtimeMs: 250, hasExe: false },
      { name: "tools", mtimeMs: 500, hasExe: false },
    ];
    expect(previousVersion(folders, "2.0.0-beta.34")).toBe("2.0.0-beta.33");
    expect(previousVersion(folders.slice(0, 1), "2.0.0-beta.34")).toBeNull();
  });
});

describe("the newest version already kept on disk (AC-RBK-03)", () => {
  const m = (version: string) => ({ version, date: "2026-11-07", page: "https://x", url: "https://x/a.exe", bytes: 1, sha256: "a".repeat(64), notes: [] });
  it("after going back from beta.35, an update to beta.35 is a switch, not a second download", () => {
    expect(latestIsKept({ current: "2.0.0-beta.34", available: true, latest: m("2.0.0-beta.35"), rollback: { ok: true, version: "2.0.0-beta.35" } })).toBe(true);
  });
  it("a newer version than the kept one is downloaded as usual", () => {
    expect(latestIsKept({ current: "2.0.0-beta.34", available: true, latest: m("2.0.0-beta.36"), rollback: { ok: true, version: "2.0.0-beta.35" } })).toBe(false);
  });
  it("a kept older version never replaces an update", () => {
    expect(latestIsKept({ current: "2.0.0-beta.35", available: true, latest: m("2.0.0-beta.35"), rollback: { ok: true, version: "2.0.0-beta.35" } })).toBe(false);
    expect(latestIsKept({ current: "2.0.0-beta.35", available: true, latest: m("2.0.0-beta.36"), rollback: { ok: true, version: "2.0.0-beta.34" } })).toBe(false);
  });
  it("a kept version that cannot read the data is not offered as a switch", () => {
    expect(latestIsKept({ current: "2.0.0-beta.34", available: true, latest: m("2.0.0-beta.35"), rollback: { ok: false, version: "2.0.0-beta.35", reason: "unknown" } })).toBe(false);
  });
});

