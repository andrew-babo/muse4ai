import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLoadError, parseQuota } from "../src/main/adapter/muse/driver";
import { buildMessage, THREAD_PATH_RE } from "../src/main/adapter/muse/selectors";
import { IpcDispatcher } from "../src/main/ipcHandlers";
import { canWriteDir, isInside } from "../src/main/paths";
import { crc32, makeZip } from "../src/main/zip";

describe("zip (diagnostics bundle)", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("produces an archive a standard unzip tool can verify and extract", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-"));
    const file = path.join(dir, "a.zip");
    fs.writeFileSync(file, makeZip([
      { name: "logs/app.jsonl", data: Buffer.from('{"msg":"xin chào"}\n') },
      { name: "settings.json", data: Buffer.from("{}") },
    ]));
    const out = execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('logs/app.jsonl').decode())", file]).toString();
    expect(out.split(/\r?\n/)[0]).toBe("None"); // Windows python prints CRLF
    expect(out).toContain("xin chào");
  });
});

describe("library folder must really be writable — AC-ONB-02", () => {
  it("accepts a normal folder (creating it) and leaves no probe file behind", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lib-")), "Muse4AI");
    expect(canWriteDir(dir)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it("rejects a folder that cannot be created (a file is in the way)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
    fs.writeFileSync(path.join(base, "taken"), "x");
    expect(canWriteDir(path.join(base, "taken", "sub"))).toBe(false);
  });
});

describe("media path guard (AC-SEC)", () => {
  const lib = path.resolve("/data/Muse4AI");
  it("allows files inside the library", () => {
    expect(isInside(path.join(lib, "2026-10", "a.png"), [lib])).toBe(true);
  });
  it("rejects traversal, siblings with the same prefix and the root itself", () => {
    expect(isInside(path.join(lib, "..", "secret.txt"), [lib])).toBe(false);
    expect(isInside(lib + " Evil/a.png", [lib])).toBe(false);
    expect(isInside(lib, [lib])).toBe(false);
  });
});

describe("Muse adapter helpers", () => {
  it("reads plan, reset day and percent from the Usage panel (evidence 26/10)", () => {
    const q = parseQuota("Usage\nFree plan · Weekly limit resets on Nov 2 · 5% used", 1000);
    // rev 8: no “Additional tokens” part in this panel → additional null; a 1970 clock has no Nov 2 within a week → resetAt null.
    expect(q).toEqual({ plan: "Free plan", resetsOn: "Nov 2", resetAt: null, usedPercent: 5, readAt: 1000, additional: null });
  });
  it("leaves unknown quota fields empty instead of guessing", () => {
    expect(parseQuota("Something else", 5)).toEqual({ plan: undefined, resetsOn: undefined, usedPercent: undefined, readAt: 5 });
  });
  it("maps Chromium proxy failures to PROXY_FAILED and network failures to transient", () => {
    expect(classifyLoadError(new Error("net::ERR_TUNNEL_CONNECTION_FAILED")).cls).toBe("PROXY_FAILED");
    expect(classifyLoadError(new Error("net::ERR_PROXY_CONNECTION_FAILED")).cls).toBe("PROXY_FAILED");
    expect(classifyLoadError(new Error("net::ERR_INVALID_AUTH_CREDENTIALS")).cls).toBe("PROXY_FAILED");
    expect(classifyLoadError(new Error("net::ERR_NAME_NOT_RESOLVED")).cls).toBe("PRE_SUBMIT_TRANSIENT");
  });
  it("recognises thread URLs only", () => {
    expect(THREAD_PATH_RE.test("/thread/5f0c2a7e-1b2c-4d5e-8f90-1234567890ab")).toBe(true);
    expect(THREAD_PATH_RE.test("/thread/new")).toBe(false);
  });
  it("builds a distinct instruction for each of the four verified flows", () => {
    const msgs = [buildMessage("image", "text", "x"), buildMessage("image", "reference", "x"), buildMessage("video", "text", "x"), buildMessage("video", "reference", "x")];
    expect(new Set(msgs).size).toBe(4);
    for (const m of msgs) expect(m.endsWith("x")).toBe(true);
  });
});

describe("IPC dispatcher (AC-SEC-02)", () => {
  const noop = () => undefined;
  const make = (testMode: boolean) => new IpcDispatcher({} as never, {} as never, {} as never, { testMode, log: noop });

  it("rejects unknown commands", async () => {
    expect(await make(false).dispatch("fs.readFile", { path: "C:/Windows/win.ini" })).toMatchObject({ ok: false, code: "unknown_command" });
    expect(await make(false).dispatch("__proto__", {})).toMatchObject({ ok: false, code: "unknown_command" });
  });
  it("hides test-only commands outside test mode", async () => {
    expect(await make(false).dispatch("__test.freeze", { ms: 10 })).toMatchObject({ ok: false, code: "unknown_command" });
  });
  it("rejects input that does not match the command schema", async () => {
    expect(await make(false).dispatch("job.create", { prompt: 42 })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await make(false).dispatch("job.cancel", { jobId: "" })).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("Windows toast id (AC-APP-04 on Windows Server 2016)", () => {
  it("is at most 16 alphanumeric characters, even for large counters and far-future clocks", async () => {
    const { toastId, TOAST_ID_MAX } = await import("../src/main/toastId");
    expect(TOAST_ID_MAX).toBe(16);
    for (const [seq, now] of [[1, Date.now()], [99999, Date.now()], [1295, 4102444800000]] as const) {
      const id = toastId(seq, now);
      expect(id.length).toBeLessThanOrEqual(16);
      expect(id).toMatch(/^[a-z0-9]+$/);
    }
  });
  it("differs between consecutive notifications", async () => {
    const { toastId } = await import("../src/main/toastId");
    const now = Date.now();
    expect(toastId(1, now)).not.toBe(toastId(2, now));
  });
});

describe("Windows toast activation from the Action Center (AC-APP-06)", () => {
  it("round-trips every notification route through the toast launch argument", async () => {
    const { buildToastXml, routeFromActivation } = await import("../src/main/toast");
    for (const route of ["/queue/4d75db15-9d09-4fb3-b92c-51be61f24f4c", "/batch/e02fa52b-794a-4933-a1fa-8737e0aa4b16", "/accounts/a1/takeover", "/settings/general", "/queue"]) {
      const xml = buildToastXml({ title: "t", body: "b", route });
      const launch = /launch="([^"]*)"/.exec(xml)![1].replace(/&amp;/g, "&");
      expect(routeFromActivation(launch)).toBe(route);
    }
  });
  it("rejects activations that are not ours or point outside the app's screens", async () => {
    const { routeFromActivation } = await import("../src/main/toast");
    expect(routeFromActivation("")).toBeNull();
    expect(routeFromActivation(undefined)).toBeNull();
    expect(routeFromActivation("muse-route=%2Fevil")).toBeNull();
    expect(routeFromActivation("muse-route=https%3A%2F%2Fexample.com")).toBeNull();
    expect(routeFromActivation("muse-route=%2Fqueue%2F..%2F..")).toBeNull();
    expect(routeFromActivation("muse-route=%E0%A4%A")).toBeNull();
  });
  it("reads the route from a relaunch command line and ignores unrelated arguments", async () => {
    const { routeFromArgv, launchArgument } = await import("../src/main/toast");
    const exe = "C:\\Users\\a\\AppData\\Local\\Programs\\Muse4AI\\app-1.0.0\\Muse4AI.exe";
    expect(routeFromArgv([exe, launchArgument("/batch/b1")])).toBe("/batch/b1");
    expect(routeFromArgv([exe, "--allow-file-access-from-files", launchArgument("/accounts/a1/takeover")])).toBe("/accounts/a1/takeover");
    expect(routeFromArgv([exe, "--show-inactive"])).toBeNull();
    expect(routeFromArgv([exe, "muse-route=%2Fnot-a-screen"])).toBeNull();
  });
  it("rev 6: a Vibes checkpoint toast opens that account's Vibes window; a chain toast opens the chain", async () => {
    const { isSafeRoute, launchArgument, routeFromActivation } = await import("../src/main/toast");
    expect(routeFromActivation(launchArgument("/accounts/a1/takeover?site=vibes"))).toBe("/accounts/a1/takeover?site=vibes");
    expect(routeFromActivation(launchArgument("/queue/chain/c1"))).toBe("/queue/chain/c1");
    // Only `site=muse|vibes` may ride along; anything else falls back to the queue.
    expect(isSafeRoute("/accounts/a1/takeover?site=evil")).toBe(false);
    expect(isSafeRoute("/accounts/a1/takeover?site=vibes&x=1")).toBe(false);
    expect(isSafeRoute("/queue?f=review")).toBe(false);
    expect(launchArgument("/accounts/a1/takeover?next=https://x")).toBe("muse-route=%2Fqueue");
  });
  it("AC-VIB-10: a re-login toast of this run opens the Vibes login step; an older toast only shows the card", async () => {
    const { buildToastXml, isSafeRoute, resolveNoticeRoute, routeFromActivation, runFromActivation } = await import("../src/main/toast");
    const route = "/accounts/a1/login?site=vibes";
    expect(isSafeRoute(route)).toBe(true);
    const xml = buildToastXml({ title: "Mây cần đăng nhập lại Vibes", body: "b", route, run: "run123abc" });
    const launch = /launch="([^"]*)"/.exec(xml)![1].replace(/&amp;/g, "&");
    expect(routeFromActivation(launch)).toBe(route);
    expect(runFromActivation(launch)).toBe("run123abc");
    expect(resolveNoticeRoute(route, true)).toEqual({ route: "/accounts/a1/takeover?login=1", login: { accountId: "a1", site: "vibes" } });
    expect(resolveNoticeRoute(route, false)).toEqual({ route: "/accounts?focus=a1", login: null });
    // A toast without a run id (older build) is never "this run"; a malformed run id is ignored.
    expect(runFromActivation("muse-route=%2Fqueue")).toBeNull();
    expect(runFromActivation("muse-route=%2Fqueue&run=bad-id!")).toBeNull();
    // Every other route is unchanged, whatever run showed it.
    expect(resolveNoticeRoute("/queue/chain/c1", false)).toEqual({ route: "/queue/chain/c1", login: null });
    expect(resolveNoticeRoute("/accounts/a1/takeover?site=vibes", true)).toEqual({ route: "/accounts/a1/takeover?site=vibes", login: null });
  });
  it("escapes prompt text so a title cannot break the toast XML", async () => {
    const { buildToastXml } = await import("../src/main/toast");
    const xml = buildToastXml({ title: 'Lô "A" <b>&', body: "x</text><text>y", route: "/queue" });
    expect(xml).toContain("Lô &quot;A&quot; &lt;b&gt;&amp;");
    expect(xml).not.toContain("x</text><text>y");
    expect(xml.match(/<text>/g)).toHaveLength(2);
  });
});

describe("Windows display preferences (AC-A11Y-03 / AC-PERF-02)", () => {
  it("reads 'Show animations in Windows' from byte 4 bit 0x02 of UserPreferencesMask", async () => {
    const { parseReducedMotion } = await import("../src/main/winDisplay");
    const reg = (hex: string) => `\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    UserPreferencesMask    REG_BINARY    ${hex}\r\n`;
    expect(parseReducedMotion(reg("9012038010000000"))).toBe(true); // animations off (measured on the VPS)
    expect(parseReducedMotion(reg("9012038012000000"))).toBe(false); // animations on
    expect(parseReducedMotion("")).toBe(false);
  });
  it("treats EnableTransparency 0 as off and anything else or missing as on", async () => {
    const { parseTransparency } = await import("../src/main/winDisplay");
    expect(parseTransparency("    EnableTransparency    REG_DWORD    0x0")).toBe(false);
    expect(parseTransparency("    EnableTransparency    REG_DWORD    0x1")).toBe(true);
    expect(parseTransparency("ERROR: not found")).toBe(true);
  });
});

