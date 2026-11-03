import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, shell, systemPreferences, Tray } from "electron";
import { BRAND } from "../shared/brand";
import { EVENT_BATCH_MS, HEARTBEAT_MS } from "../shared/constants";
import { UI_MAX_RANGE } from "../shared/execution";
import type { EventBatchItem } from "../shared/ipc";
import { formatDateTime, formatNumber } from "../shared/format";
import { getLocale, isLocale, resolveStartLocale, setLocale, t } from "../shared/i18n";
import { registerSecret } from "../shared/redact";
import type { CapabilityKey, JobKind } from "../shared/types";
import type { AuthMeResponse } from "../shared/vibes";
import { AccountManager } from "./accounts";
import { ApiController } from "./api/controller";
import { sweepOrphanProfiles } from "./profiles";
import { FakeAdapter, type FakeConfig, type FakeStep } from "./adapter/fake";
import { defaultFakeReply, FakeHttpChannel, type FakeGwConfig, type FakeGwStep, type FakeReply } from "./adapter/fakeGateway";
import { ElectronHttpChannel, type HttpChannel } from "./adapter/muse/httpChannel";
import type { MuseAdapter, VibesAdapter } from "./adapter/types";
import { FakeVibesAdapter, type FakeVibesConfig, type FakeVibesStep } from "./adapter/vibes/fake";
import { Coordinator, type Notice } from "./coordinator";
import { CorruptStoreError, dailyBackup, latestGoodBackup, MigrationError, openDatabase, restoreFromBackup, type SqliteModule } from "./db";
import { IpcDispatcher, type ShellOps } from "./ipcHandlers";
import { Logger } from "./logger";
import { MediaStore } from "./media";
import { isInside, makePaths, type AppPaths } from "./paths";
import { ProbeWindow } from "./probe";
import { prewarmFiles } from "./prewarm";
import { handleProtocols, registerSchemes } from "./protocols";
import { defaultSettings, Repo } from "./repo";
import { Services } from "./services";
import { Vault } from "./vault";
import { toastId } from "./toastId";
import { buildToastXml, launchArgument, resolveNoticeRoute, routeFromActivation, routeFromArgv, runFromActivation, TOAST_ACTIVATOR_CLSID } from "./toast";
import { parseReducedMotion, parseTransparency } from "./winDisplay";
import { loadFixtures } from "./fixtures";

// Electron main process: the single writer of local data (AGENTS.md). Wires store, coordinator, Muse sessions and the UI.

const AUMID = "vn.musestudio.app";
const TEST = process.env.MUSE4AI_TEST === "1";
/** Id of this run of the app, carried by its toasts (a toast from an older run never opens a login window). */
const RUN_ID = randomUUID().replace(/-/g, "").slice(0, 12);
/** Upper bound before the post-first-frame work runs anyway (a window started hidden never draws a frame). */
const AFTER_FIRST_FRAME_MS = 5000;
const DEV_URL = process.env.MUSE4AI_DEV_URL || "";
const RENDERER_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : "app://bundle";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sqlite: SqliteModule = require("node:sqlite");

// ------------------------------------------------------------------ CLI helpers used by the installer
// "create" writes or overwrites ("replace" fails when the link is missing, e.g. a fresh install).
// The icon is embedded in Muse4AI.exe by the packager, so the exe itself is the icon source.
// The toast activator CLSID on the Start Menu link lets Windows route Action Center clicks back to the app.
// Target, working directory, AUMID and CLSID match what Electron's own toast setup expects, so it keeps this link
// instead of rewriting it at the first notification.
function writeShortcut(p: string): boolean {
  return shell.writeShortcutLink(p, "create", { target: process.execPath, cwd: path.dirname(process.execPath), appUserModelId: AUMID, toastActivatorClsid: TOAST_ACTIVATOR_CLSID, icon: process.execPath, iconIndex: 0, description: "Muse4AI — tạo ảnh và video qua Muse" });
}
function shortcutPaths(): string[] {
  return [path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Muse4AI.lnk"), path.join(app.getPath("desktop"), "Muse4AI.lnk")];
}
if (process.argv.includes("--register-shortcuts") || process.argv.includes("--unregister-shortcuts")) {
  app.setPath("userData", path.join(app.getPath("appData"), BRAND.dataDir));
  app.whenReady().then(() => {
    const register = process.argv.includes("--register-shortcuts");
    const results: { path: string; ok: boolean; error?: string }[] = [];
    for (const p of shortcutPaths()) {
      try {
        if (register) {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          results.push({ path: p, ok: writeShortcut(p) });
        } else {
          fs.rmSync(p, { force: true });
          results.push({ path: p, ok: true });
        }
      } catch (e) {
        results.push({ path: p, ok: false, error: String(e) });
      }
    }
    // The installer reads this to report and to fall back to its own shortcut writer.
    try {
      fs.writeFileSync(path.join(os.tmpdir(), "muse4ai-shortcuts.json"), JSON.stringify({ register, results }));
    } catch {
      /* best effort */
    }
    app.exit(results.every((r) => r.ok) ? 0 : 3);
  });
} else {
  main();
}

function main(): void {
  registerSchemes();
  if (TEST && process.env.MUSE4AI_DATA) {
    const root = process.env.MUSE4AI_DATA;
    app.setPath("appData", path.join(root, "appdata"));
    app.setPath("userData", path.join(root, "roaming"));
    app.setPath("sessionData", path.join(root, "local", "profiles"));
  } else {
    app.setPath("userData", path.join(app.getPath("appData"), BRAND.dataDir));
    const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, BRAND.dataDir) : path.join(app.getPath("userData"), "local");
    app.setPath("sessionData", path.join(local, "profiles"));
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // `Muse4AI.exe --quit` asks a running copy to quit (handled in second-instance); with none running, do nothing.
  if (process.argv.includes("--quit")) {
    app.exit(0);
    return;
  }
  app.setAppUserModelId(AUMID);
  if (process.platform === "win32") app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
  Menu.setApplicationMenu(null);
  app.on("window-all-closed", () => {
    /* keep running in tray; quit is explicit */
  });
  app.whenReady().then(boot).catch((e) => {
    startupErrorBox(t("Muse4AI không khởi động được"), t(String(e?.message ?? e)));
    app.exit(1);
  });
}

/** Start-up failure dialog wholly in the UI language (R120): `dialog.showErrorBox` carries a fixed English “Error” caption on Windows. */
function startupErrorBox(title: string, body: string): void {
  dialog.showMessageBoxSync({ type: "error", title: BRAND.name, message: title, detail: body, buttons: [t("Đóng")], defaultId: 0, noLink: true });
}

async function boot(): Promise<void> {
  const roaming = app.getPath("userData");
  const local = TEST && process.env.MUSE4AI_DATA ? path.join(process.env.MUSE4AI_DATA, "local") : path.dirname(app.getPath("sessionData"));
  const pictures = TEST && process.env.MUSE4AI_DATA ? path.join(process.env.MUSE4AI_DATA, "pictures") : app.getPath("pictures");
  const paths: AppPaths = makePaths(roaming, local, pictures);
  // R120: the UI language is a setting in the store, mirrored in a tiny file so dialogs shown before the store opens
  // (corrupt store, failed migration) already use it.
  const localeFile = path.join(roaming, "ui-locale");
  let bootFileLocale: string | null = null;
  try {
    const saved = fs.readFileSync(localeFile, "utf8").trim();
    if (isLocale(saved)) {
      bootFileLocale = saved;
      setLocale(saved);
    }
  } catch {
    /* first run: DEFAULT_LOCALE (English) */
  }
  const logger = new Logger(paths.logs);
  const launchRoute = routeFromArgv(process.argv);
  const comLaunch = process.argv.includes("-Embedding");
  // Electron registers the toast COM activator only when its notification presenter is first created, which
  // normally waits for the first notification. Create it now so a click that cold-started the app (Windows
  // passes -Embedding) is delivered and replayed to handleActivation below (AC-APP-06).
  const activator = process.platform === "win32" ? typeof Notification.handleActivation === "function" && Notification.isSupported() : undefined;
  logger.log("info", "app", "start", { version: app.getVersion(), electron: process.versions.electron, os: process.getSystemVersion(), test: TEST, activator, ...(comLaunch ? { comLaunch } : {}), ...(launchRoute ? { launchRoute } : {}) });
  // Start-up phases (ms since process start), logged with the first frame so a slow start shows where time went.
  const marks: Record<string, number> = {};
  const mark = (k: string) => void (marks[k] = Math.round(process.uptime() * 1000));
  mark("start");
  // Keep installed shortcuts pointing at this version with our AppUserModelID (toasts need the Start Menu one).
  // Rewrite only a stale link: Electron adds its toast activator to the Start Menu link at the first
  // notification, and rewriting on every start would drop it. The installer writes them too, so this is a
  // repair that runs after the first frame.
  const refreshShortcuts = () => {
    if (!app.isPackaged || process.platform !== "win32" || TEST) return;
    const [startMenu, desktop] = shortcutPaths();
    const stale = (p: string) => {
      try {
        const l = shell.readShortcutLink(p);
        return path.resolve(l.target).toLowerCase() !== path.resolve(process.execPath).toLowerCase() || l.appUserModelId !== AUMID;
      } catch {
        return true;
      }
    };
    try {
      fs.mkdirSync(path.dirname(startMenu), { recursive: true });
      if (stale(startMenu)) writeShortcut(startMenu);
      if (fs.existsSync(desktop) && stale(desktop)) writeShortcut(desktop);
    } catch (e) {
      logger.log("warn", "app", "shortcut refresh failed", { error: String(e) });
    }
  };

  // ---------- window first: its renderer loads in parallel with the store/vault/core set-up below.
  // Commands wait for `core` (dispatcher ready once the queue is restored and the API started); the window is shown
  // only then, so nothing is visible or clickable before the data is.
  let resolveCore!: (d: IpcDispatcher) => void;
  const core = new Promise<IpcDispatcher>((r) => (resolveCore = r));
  let coreReady = false;
  let mainWindow: BrowserWindow | null = null;
  const icon = resourcePath("icon.png");
  handleProtocols(path.join(__dirname, "..", "renderer"), {
    asset: async (id) => (await core, services.assetFile(id)),
    thumb: async (id) => (await core, services.thumbFor(id)),
    ref: (id) => (coreReady ? (repo.getRef(id)?.path ?? null) : null),
    allowLocal: (file) => {
      if (!coreReady) return false;
      const roots = [coord.settings().libraryDir, paths.refs, paths.thumbs, media.stagingRoot()];
      if (isInside(file, roots)) return true;
      return !!repo.db.prepare("SELECT 1 FROM assets WHERE path=?").get(file);
    },
  });
  ipcMain.handle("muse:cmd", async (event, command: unknown, input: unknown) => {
    // Only our own window and origin may call (AC-SEC-02).
    const frameUrl = event.senderFrame?.url ?? "";
    if (!mainWindow || event.sender !== mainWindow.webContents || !frameUrl.startsWith(RENDERER_ORIGIN)) return { ok: false, error: "Không được phép", code: "forbidden" };
    if (typeof command !== "string") return { ok: false, error: "Lệnh không hợp lệ", code: "unknown_command" };
    return (await core).dispatch(command, input);
  });
  mainWindow = createWindow();
  mark("window");

  // ---------- local store
  let repo: Repo;
  const openStore = () => {
    try {
      return openDatabase(sqlite, paths.db, paths.backups);
    } catch (e) {
      if (!(e instanceof CorruptStoreError)) throw e;
      // Screens S00 error state: corrupt store → offer the newest good automatic backup; library files are untouched.
      logger.log("error", "db", "store corrupt", { error: e.message });
      const b = latestGoodBackup(sqlite, paths.backups);
      if (!b) throw new MigrationError(`${t(e.message)}\n\n${t("Không tìm thấy bản sao lưu nào dùng được.")}`, null);
      const when = formatDateTime(b.mtimeMs);
      const pick = dialog.showMessageBoxSync({
        type: "warning",
        title: t("Muse4AI — khôi phục dữ liệu"),
        message: t("Dữ liệu cục bộ bị hỏng nên app chưa mở được."),
        detail: t("Em có thể khôi phục từ bản sao lưu tự động lúc {when}. Hàng chờ, tài khoản và cài đặt thay đổi sau thời điểm đó sẽ không còn; ảnh/video trong thư viện không bị ảnh hưởng. Tệp hỏng được giữ lại bên cạnh để chẩn đoán.", { when }),
        buttons: [t("Khôi phục bản sao lưu"), t("Thoát")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (pick !== 0) throw new MigrationError(`${t(e.message)}\n\n${t("Anh đã chọn chưa khôi phục.")}`, null);
      const kept = restoreFromBackup(paths.db, b.path);
      logger.log("warn", "db", "restored from backup", { backup: path.basename(b.path), kept: path.basename(kept) });
      return openDatabase(sqlite, paths.db, paths.backups);
    }
  };
  // Cold start: pull the store into the OS cache asynchronously first, so this thread keeps answering the renderer's
  // bundle requests while the disk works; the synchronous open below then reads from cache (capped in size and time).
  const warmed = await prewarmFiles([paths.db, `${paths.db}-wal`], { maxBytes: 64 * 1024 * 1024, maxMs: 1500 });
  mark("prewarm");
  if (warmed.timedOut) logger.log("info", "db", "prewarm stopped at time cap", { bytes: warmed.bytes });
  try {
    const opened = openStore();
    repo = new Repo(opened.db);
    if (opened.migratedFrom !== null) logger.log("info", "db", "migrated", { from: opened.migratedFrom, backup: opened.backupPath });
  } catch (e) {
    const msg = e instanceof MigrationError ? `${t(e.message)}${e.restoredFrom ? `\n\n${t("Dữ liệu cũ đã được khôi phục nguyên vẹn.")}` : ""}` : t(String((e as Error).message ?? e));
    logger.log("error", "db", "open failed", { error: msg });
    startupErrorBox(t("Không mở được dữ liệu Muse4AI"), `${msg}\n\n${t("Thư mục dữ liệu: {dir}", { dir: paths.roaming })}`);
    app.exit(1);
    return;
  }
  mark("store");
  const vault = new Vault(paths.vault, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  });
  for (const v of vault.values()) {
    try {
      const j = JSON.parse(v) as { u?: string; p?: string };
      registerSecret(j.u);
      registerSecret(j.p);
    } catch {
      registerSecret(v);
    }
  }
  mark("vault");

  // ---------- event stream to the renderer (coalesced, ≤ 1 batch / 100 ms)
  const pending = new Map<string, { type: string; payload: unknown }>();
  let flushTimer: NodeJS.Timeout | null = null;
  let noticeSeq = 0;
  const flush = () => {
    flushTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || !pending.size) return;
    const rev = repo.currentRev();
    const batch: EventBatchItem[] = [...pending.values()].map((e) => ({ ...e, rev }));
    pending.clear();
    mainWindow.webContents.send("muse:events", batch);
  };
  // Job changes also feed the agent API's long-poll waits (same events the UI gets).
  const jobBus = new EventEmitter();
  jobBus.setMaxListeners(0);
  const emit = (type: string, payload: unknown) => {
    if (type === "job" && payload) jobBus.emit("job", payload);
    if (type === "settings" && payload) applyLocale((payload as { language?: unknown }).language);
    const p = payload as { id?: string; accountId?: string } | null;
    const key = type === "notice" ? `notice:${++noticeSeq}` : `${type}:${p?.id ?? p?.accountId ?? ""}`;
    pending.delete(key);
    pending.set(key, { type, payload });
    if (type === "counts") updateTray();
    if (!flushTimer) flushTimer = setTimeout(flush, EVENT_BATCH_MS);
  };

  // ---------- media
  const probe = new ProbeWindow("app://bundle/probe.html");
  let coordRef: Coordinator | null = null;
  const media = new MediaStore({ libraryDir: () => coordRef?.settings().libraryDir ?? paths.defaultLibrary, thumbsDir: paths.thumbs, refsDir: paths.refs, probe: probe.probe });

  // ---------- accounts / adapters
  const accounts = new AccountManager({
    proxyFor: (id) => {
      const a = repo.getAccount(id);
      return a?.proxyId ? repo.getProxy(a.proxyId) : null;
    },
    creds: (pid) => coordRef!.proxyCreds(pid),
    getProxy: (pid) => repo.getProxy(pid),
    alias: (id) => repo.getAccount(id)?.alias ?? "",
    onPreviewFrame: (accountId, dataUrl) => emit("preview", { accountId, dataUrl }),
    busy: (id) => repo.getAccount(id)?.state === "busy",
    beforeSend: (id, signal) => coordRef?.exec.paced(id, signal) ?? Promise.resolve(),
    vibesEnabled: () => false,
    activeSite: (id) => coordRef?.activeSite(id) ?? null,
    log: (level, msg, data) => logger.log(level, "account", msg, data),
    icon,
  });
  const fakeCfgs = new Map<string, FakeConfig>();
  const fakeAdapters = new Map<string, FakeAdapter>();
  const fixtures = TEST ? loadFixtures(process.env.MUSE4AI_FIXTURES) : null;
  const adapterFor = (id: string): MuseAdapter => {
    if (!TEST) return accounts.adapter(id);
    if (!fakeAdapters.has(id)) {
      const cfg: FakeConfig = {
        submitDelayMs: 900,
        generateDelayMs: Number(process.env.MUSE4AI_FAKE_GEN_MS ?? 3000),
        script: [],
        history: new Map(),
        media: fixtures?.pick,
        mediaForPrompt: (prompt, kind) => {
          const hit = fixtures?.forPrompt(prompt);
          return hit && hit.kind === kind ? hit.bytes : null;
        },
        // Docs lab only (MUSE4AI_FAKE_EXTEND=1): the fake behaves like real Muse — every video carries a
        // conversation source, so the Kéo dài screens can be photographed without touching a live account.
        museExtend: process.env.MUSE4AI_FAKE_EXTEND ? { baseMs: 10_000, growMs: 10_000 } : undefined,
      };
      fakeCfgs.set(id, cfg);
      fakeAdapters.set(id, new FakeAdapter(id, cfg));
    }
    return fakeAdapters.get(id)!;
  };
  // rev 6 — Vibes page of the account; test mode uses the scripted fake (rules B38). The fake's "server side"
  // (batches it accepted) is kept in a file so a crash-and-restart E2E can reconcile like the real Vibes would.
  class FileBackedMap<V> extends Map<string, V> {
    constructor(private readonly file: string) {
      super();
      try {
        for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, V>)) super.set(k, v);
      } catch {
        /* first start */
      }
    }
    override set(k: string, v: V): this {
      super.set(k, v);
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this)));
      return this;
    }
  }
  const fakeVibesCfgs = new Map<string, FakeVibesConfig>();
  const fakeVibes = new Map<string, FakeVibesAdapter>();
  const vibesFor = (id: string): VibesAdapter => {
    if (!TEST) return accounts.vibesAdapter(id);
    if (!fakeVibes.has(id)) {
      // The signed-in Vibes user survives restarts like a real profile does (last steady answer set by `__test.vibes`).
      let savedMe: AuthMeResponse | null = null;
      try {
        savedMe = JSON.parse(fs.readFileSync(path.join(paths.roaming, `test-vibes-${id}.me.json`), "utf8")) as AuthMeResponse;
      } catch {
        /* default user */
      }
      const cfg: FakeVibesConfig = {
        me: [savedMe ?? { status: 200, body: { user: { id: `test-${id.slice(0, 6)}`, username: "vibes.thu" } } }],
        submitDelayMs: 600,
        generateDelayMs: Number(process.env.MUSE4AI_FAKE_GEN_MS ?? 3000),
        script: [],
        media: fixtures?.byDuration,
        batches: new FileBackedMap(path.join(paths.roaming, `test-vibes-${id}.json`)),
      };
      fakeVibesCfgs.set(id, cfg);
      fakeVibes.set(id, new FakeVibesAdapter(id, cfg));
    }
    return fakeVibes.get(id)!;
  };

  // Build 2.0 R94 — one direct channel per account. Real: the client runs in the account's hidden light page (proxy,
  // cookies and tokens stay in Chromium). Test mode: the in-memory fake Muse gateway (scripted by `__test.gw`).
  const channels = new Map<string, HttpChannel>();
  const fakeGwCfgs = new Map<string, FakeGwConfig>();
  // Test mode: the fake gateway returns the same decodable fixture media as the fake UI adapter (the probe decodes it).
  const fixtureReply = (prompt: string, _items: unknown, turn: number): FakeReply => {
    const r = defaultFakeReply(prompt, _items, turn);
    const f = r.files?.[0];
    if (!fixtures || !f) return r;
    // An extend step gets a real fixture MP4 of the cumulative length (lab/E2E: the library shows real durations).
    if (prompt.startsWith("Extend the exact video")) return { ...r, files: [{ name: f.name, mime: "video/mp4", bytes: fixtures.byDuration((turn + 1) * 10_000, turn) }] };
    const kind = f.mime.startsWith("video/") ? "video" : "image";
    // A documentation lab pins each real Muse output to its own prompt (fixtures prompts.json).
    const exact = fixtures.forPrompt(prompt);
    const bytes = exact && exact.kind === kind ? exact.bytes : fixtures.pick(kind, prompt.length * 31 + turn);
    if (!bytes.length) return r;
    const mime = kind === "video" ? "video/mp4" : bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : "image/webp";
    return { ...r, files: [{ name: kind === "video" ? "video.mp4" : mime === "image/png" ? "image.png" : mime === "image/jpeg" ? "image.jpg" : "image.webp", mime, bytes }] };
  };
  const newFakeGwCfg = (): FakeGwConfig => ({ completeMs: Number(process.env.MUSE4AI_FAKE_GEN_MS ?? 3000), ackDelayMs: 300, reply: fixtureReply });
  let gwScript: string | null = null;
  const channelFor = (id: string): HttpChannel => {
    let ch = channels.get(id);
    if (ch) return ch;
    if (TEST) {
      const cfg: FakeGwConfig = fakeGwCfgs.get(id) ?? newFakeGwCfg();
      fakeGwCfgs.set(id, cfg);
      ch = new FakeHttpChannel(id, cfg);
    } else {
      ch = new ElectronHttpChannel({
        openPage: () => accounts.channelPage(id),
        script: () => (gwScript ??= fs.readFileSync(path.join(__dirname, "gateway-page.js"), "utf8")),
      });
    }
    channels.set(id, ch);
    return ch;
  };

  const settingsDefaults = defaultSettings(paths.defaultLibrary);
  const coord = new Coordinator({
    repo,
    media,
    adapterFor,
    workAdapterFor: (id, jobId) => TEST ? adapterFor(id) : accounts.workAdapter(id, jobId),
    releaseUiWork: (id, jobId) => { if (!TEST) accounts.releaseWork(id, jobId); },
    // Vibes provider removed; legacy persisted records remain readable.
    ui: TEST
      ? {
          // Test mode: the “user” finishes each login step after a fixed time (E2E slows it down to see the stepper).
          openLogin: () => new Promise((r) => setTimeout(() => r(true), Number(process.env.MUSE4AI_FAKE_LOGIN_MS ?? 800))),
          cancelLogin: () => undefined,
          setVibesEnabled: () => undefined,
          showTakeover: () => undefined,
          hideTakeover: () => undefined,
          applyProxy: () => undefined,
          destroy: async () => undefined,
        }
      : accounts,
    vault,
    testProxy: async (pid) => {
      if (TEST) {
        // Deterministic fake: each proxy answers after its own delay; documentation range 192.0.2.x always fails.
        const fp = repo.getProxy(pid);
        const last = Number(fp?.host.split(".").pop() ?? 0) || 0;
        await new Promise((r) => setTimeout(r, 120 + ((last * 97) % 600)));
        if (fp?.host.startsWith("192.0.2.")) return { ok: false, error: "Không kết nối được tới proxy" };
        return { ok: true, ip: "203.0.113.24", country: "US", latencyMs: 180 + Math.round(Math.random() * 90) };
      }
      const p = repo.getProxy(pid);
      if (!p) return { ok: false, error: "Không còn proxy này" };
      return accounts.testProxy(p);
    },
    emit,
    notify: (n) => notify(n),
    log: (l, s, m, d) => logger.log(l, s, m, d),
    diskFree,
    defaults: settingsDefaults,
    version: app.getVersion(),
    channelFor,
    dropChannel: (id) => {
      channels.get(id)?.close({ unloadPage: true });
      channels.delete(id);
    },
    // R98/R99 — distinct per-job pages; configured account/app caps and physical RAM gate still apply.
    uiPagesPerAccount: UI_MAX_RANGE.max,
    freeMemBytes: () => os.freemem(),
  });
  coordRef = coord;
  // Test mode only: capabilities "verified" from the first tick, so a restart E2E does not race `__test.setVerified` (B37).
  if (TEST && process.env.MUSE4AI_TEST_VERIFIED) {
    coord.testSetVerified(Object.fromEntries(process.env.MUSE4AI_TEST_VERIFIED.split(",").map((k) => [k.trim(), true])) as Partial<Record<CapabilityKey, boolean>>);
  }
  media.cleanupOrphans(new Set(repo.jobsInStates(["downloading", "download_retry"]).map((j) => j.id)));

  const services = new Services({
    repo,
    coord,
    media,
    os: { trashItem: (p) => shell.trashItem(p), showItemInFolder: (p) => shell.showItemInFolder(p), openPath: (p) => shell.openPath(p), copyFileToClipboard: copyFile },
    emit,
    logFiles: () => logger.files(),
    appInfo: () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, os: `${process.platform} ${process.getSystemVersion()}`, arch: process.arch, secureVault: vault.secure }),
    apiInfo: () => api.diagnostics(),
  });

  // ---------- agent API (spec §4.8): off by default, same coordinator/services as the UI
  const api = new ApiController({
    repo,
    coord,
    services,
    vault,
    emit,
    notify: (n) => notify(n),
    log: (l, s, m, d) => logger.log(l, s, m, d),
    subscribeJobs: (fn) => {
      jobBus.on("job", fn);
      return () => jobBus.off("job", fn);
    },
    version: app.getVersion(),
    binDir: path.join(paths.local, "bin"),
    tunnel: { fetch: (input, init) => net.fetch(input as string, init as RequestInit) },
  });

  // ---------- window, tray, notifications
  let quitting = false;
  let tray: Tray | null = null;
  /** R120: switch the UI language everywhere main shows text (tray, later notices/dialogs) and remember it for the next start. */
  function applyLocale(l: unknown): void {
    if (!isLocale(l)) return;
    const changed = l !== getLocale();
    setLocale(l);
    try {
      if (changed || !fs.existsSync(localeFile)) fs.writeFileSync(localeFile, l);
    } catch (e) {
      logger.log("warn", "app", "locale file not written", { error: String(e) });
    }
    if (changed && tray) {
      tray.setContextMenu(trayMenu());
      updateTray();
    }
  }
  const startHidden = process.argv.includes("--hidden");
  // Show without taking focus (e.g. on a shared machine where other tools are working).
  const startInactive = process.argv.includes("--show-inactive");

  function createWindow(): BrowserWindow {
    const state = readWindowState(paths.roaming);
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(state?.width ?? 1280, wa.width);
    const height = Math.min(state?.height ?? 820, wa.height);
    const w = new BrowserWindow({
      width: Math.max(1000, width),
      height: Math.max(680, height),
      minWidth: 1000,
      minHeight: 680,
      show: false,
      title: BRAND.name,
      icon,
      backgroundColor: "#F6F3EC",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#F6F3EC", symbolColor: "#1C1A17", height: 44 },
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        webSecurity: true,
      },
    });
    // maximize() also shows a hidden window, so apply it only when the window is shown.
    let pendingMax = !!state?.maximized || wa.width < 1100 || wa.height < 720;
    w.on("show", () => {
      if (pendingMax) {
        pendingMax = false;
        w.maximize();
      }
    });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith(RENDERER_ORIGIN)) e.preventDefault();
    });
    w.webContents.on("render-process-gone", (_e, d) => logger.log("error", "renderer", "gone", { reason: d.reason }));
    // Shown once it has painted *and* the data is ready (the window is created before the store is open).
    w.once("ready-to-show", () => {
      void core.then(() => {
        if (w.isDestroyed()) return;
        if (startInactive) w.showInactive();
        else if (!startHidden) w.show();
        void updateDisplay();
      });
    });
    w.on("close", (e) => {
      if (!coreReady) return void e.preventDefault(); // still starting: nothing to close yet
      writeWindowState(paths.roaming, w);
      if (quitting) return;
      e.preventDefault();
      if (coord.inFlightCount() > 0 || repo.countUnfinished() > 0) {
        w.hide();
        if (!coord.settings().closeToTrayExplained) {
          showOsNotification(t("Muse4AI vẫn đang chạy"), t("Các lượt tạo tiếp tục dưới khay hệ thống. Nhấn biểu tượng ở khay để mở lại."), "/queue");
          coord.setSetting("closeToTrayExplained", true);
        }
      } else doQuit();
    });
    // The saved language rides in the hash so the loading screen is already in it, before the first snapshot (R120).
    void w.loadURL(`${DEV_URL || "app://bundle/index.html"}#lang=${getLocale()}`);
    return w;
  }

  /** Windows toast click (banner or Action Center, also after a restart): the route rides in the launch argument. */
  function onToastActivation(args: unknown, via: string): void {
    const route = routeFromActivation(args);
    logger.log("info", "notice", "clicked", { route: route ?? "(none)", via });
    if (route) openNoticeRoute(route, runFromActivation(args) === RUN_ID);
    else showWindow();
  }

  /** A clicked notification: a login link of this run starts that site's login flow first (AC-VIB-10). */
  function openNoticeRoute(route: string, sameRun: boolean): void {
    const r = resolveNoticeRoute(route, sameRun);
    if (r.login) {
      try {
        coord.openLogin(r.login.accountId, r.login.site);
      } catch (e) {
        logger.log("warn", "notice", "login from notice refused", { error: String((e as Error)?.message ?? e) });
        showWindow(`/accounts?focus=${r.login.accountId}`);
        return;
      }
    }
    showWindow(r.route);
  }

  function showWindow(route?: string): void {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (route) {
      // A renderer that is still loading opens lastRoute from its first snapshot; a loaded one follows the event.
      if (mainWindow.webContents.isLoading()) coord.setSetting("lastRoute", route);
      emit("navigate", { route });
    }
  }

  // AC-APP-06: clicking a notification opens the exact screen. On Windows every click — banner or Action Center,
  // even after a restart — arrives through Notification.handleActivation with the route in the toast's launch
  // argument; instance click events only fire while the banner is up, so they are used on other platforms only.
  const WIN_ACTIVATION = process.platform === "win32" && typeof Notification.handleActivation === "function";
  const liveNotices = new Set<Notification>();
  let toastSeq = 0;
  function showOsNotification(title: string, body: string, route: string): void {
    if (!Notification.isSupported()) return;
    const id = toastId(++toastSeq);
    const n = WIN_ACTIVATION
      ? new Notification({ id, title, body, toastXml: buildToastXml({ title, body, route, iconUrl: pathToFileURL(icon).href, run: RUN_ID }) })
      : new Notification({ id, title, body, icon, silent: false });
    liveNotices.add(n);
    const release = () => liveNotices.delete(n);
    n.on("click", () => {
      release();
      if (WIN_ACTIVATION) return; // handled once by handleActivation
      logger.log("info", "notice", "clicked", { route });
      openNoticeRoute(route, true);
    });
    n.on("close", release);
    n.on("failed", (_e, error) => {
      release();
      logger.log("warn", "notice", "os notification failed", { error });
    });
    n.show();
    // Bound the set even if Windows never reports close (toasts expire into the Action Center).
    if (liveNotices.size > 50) liveNotices.delete(liveNotices.values().next().value!);
  }

  function notify(raw: Notice): void {
    // Notices are written in Vietnamese by the coordinator and shown in the UI language (R120).
    const n: Notice = { ...raw, title: t(raw.title), body: t(raw.body) };
    emit("notice", n);
    logger.log("info", "notice", n.kind, { title: n.title });
    if (!coord.settings().notifications) return;
    const focused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
    if (!focused || n.kind === "batch_done") showOsNotification(n.title, n.body, n.route);
  }

  function updateTray(): void {
    if (!tray) return;
    const c = repo.countUnfinished();
    tray.setToolTip(c ? t("Muse4AI — {n} lượt đang chờ/chạy", { n: formatNumber(c) }) : BRAND.name);
  }

  function trayMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: t("Mở Muse4AI"), click: () => showWindow() },
      { label: t("Tạm dừng mọi lô"), click: () => coord.pauseAll() },
      { type: "separator" },
      { label: t("Thoát"), click: () => requestQuit() },
    ]);
  }

  function createTray(): void {
    const img = nativeImage.createFromPath(resourcePath("tray.png"));
    tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(icon) : img);
    tray.setContextMenu(trayMenu());
    tray.on("click", () => showWindow());
    updateTray();
  }

  function requestQuit(): void {
    const running = coord.inFlightCount();
    if (running > 0) {
      showWindow();
      emit("confirmQuit", { running });
    } else doQuit();
  }

  function doQuit(): void {
    if (quitting) return;
    quitting = true;
    logger.log("info", "app", "quit", { inFlight: coord.inFlightCount() });
    api.killNow();
    void api.shutdown();
    void coord.stop();
    accounts.closeAll();
    probe.destroy();
    tray?.destroy();
    flush();
    try {
      repo.db.exec("PRAGMA wal_checkpoint(PASSIVE)");
      repo.db.close();
    } catch {
      /* already closed */
    }
    app.exit(0);
  }

  async function updateDisplay(): Promise<void> {
    const gpu = app.getGPUFeatureStatus() as unknown as Record<string, string>;
    const gpuCompositing = String(gpu.gpu_compositing ?? "").startsWith("enabled");
    const [osTransparency, osReducedMotion] = await Promise.all([readTransparency(), readReducedMotion()]);
    const cur = coord.engineExtra;
    if (cur.gpuCompositing !== gpuCompositing || cur.osTransparency !== osTransparency || cur.osReducedMotion !== osReducedMotion) {
      coord.engineExtra = { gpuCompositing, osTransparency, osReducedMotion };
      coord.emitEngine();
      logger.log("info", "display", "capabilities", { gpuCompositing, osTransparency, osReducedMotion, gpu: gpu.gpu_compositing });
    }
  }

  const shellOps: ShellOps = {
    minimize: () => mainWindow?.minimize(),
    toggleMaximize: () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()),
    closeWindow: () => mainWindow?.close(),
    quit: (force) => {
      const running = coord.inFlightCount();
      if (running > 0 && !force) return { needsConfirm: true, running };
      setTimeout(doQuit, 50);
      return { needsConfirm: false, running };
    },
    quitInfo: () => ({ running: coord.inFlightCount() }),
    openFileDialog: async (kind) => {
      const filters =
        kind === "batch"
          ? [{ name: "Danh sách prompt", extensions: ["txt", "csv"] }]
          : kind === "image"
            ? [{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "webp"] }]
            : kind === "chat"
              ? [{ name: "Tệp đính kèm", extensions: ["csv", "txt", "md", "json", "pdf", "png", "jpg", "jpeg", "webp", "mp4"] }]
              : [{ name: "Danh sách proxy", extensions: ["txt", "csv"] }];
      const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile"], filters });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    saveFileDialog: async (defaultName, ext) => {
      const safe = defaultName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim() || `muse.${ext}`;
      // Test mode: E2E scripts cannot drive the native dialog, so they name the folder up front.
      if (TEST && process.env.MUSE4AI_TEST_SAVE_DIR) return path.join(process.env.MUSE4AI_TEST_SAVE_DIR, safe);
      const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: path.join(app.getPath("documents"), safe), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      return r.canceled ? null : r.filePath ?? null;
    },
    // Build 3.0 "Install for Claude Code": test mode may name a scratch home so E2E never touches the real profile.
    homeDir: () => (TEST && process.env.MUSE4AI_TEST_HOME ? process.env.MUSE4AI_TEST_HOME : app.getPath("home")),
    pickDirectory: async () => {
      // Test mode: E2E scripts cannot drive the native dialog, so they name the folder up front.
      if (TEST && process.env.MUSE4AI_TEST_PICK_DIR) return process.env.MUSE4AI_TEST_PICK_DIR;
      const r = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"], defaultPath: coord.settings().libraryDir });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    openPath: (p) => shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    copyFile,
    setLoginItem: (on) => {
      if (!TEST) app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"], name: "MuseStudio" });
    },
    dataDir: () => paths.roaming,
    previewStart: (id) => (TEST ? emit("preview", { accountId: id, dataUrl: "" }) : accounts.startPreview(id)),
    previewStop: (id) => (TEST ? undefined : accounts.stopPreview(id)),
    showAccountWindow: (id, site) => (TEST ? undefined : accounts.showTakeover(id, site ?? "muse")),
    flushEvents: () => {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    },
    metrics: () => app.getAppMetrics().map((m) => ({ type: m.type, name: m.name ?? null, serviceName: m.serviceName ?? null, pid: m.pid, workingSetKb: m.memory.workingSetSize, privateKb: m.memory.privateBytes ?? null, cpu: m.cpu.percentCPUUsage })),
    trayQuit: () => requestQuit(),
    // Test mode never leaves the machine: the link is only logged (E2E reads it back).
    openUrl: (url) => (!/^https?:\/\//.test(url) ? Promise.resolve() : TEST ? (logger.log("info", "app", "openUrl.test", { host: new URL(url).host }), Promise.resolve()) : shell.openExternal(url)),
    showRoute: (route) => showWindow(route),
    activateToast: (route, fromThisRun) => onToastActivation(launchArgument(route, fromThisRun ? RUN_ID : "olderrun0"), "test"),
    testScript: (accountId, steps) => {
      adapterFor(accountId);
      fakeCfgs.get(accountId)?.script?.push(...(steps as unknown as FakeStep[]));
    },
    testGw: (accountId, steps, opts) => {
      const cfg = fakeGwCfgs.get(accountId) ?? newFakeGwCfg();
      fakeGwCfgs.set(accountId, cfg);
      if (steps) cfg.script = [...(cfg.script ?? []), ...(steps as unknown as FakeGwStep[])];
      if (typeof opts?.completeMs === "number") cfg.completeMs = opts.completeMs;
      if (typeof opts?.replyText === "string" || opts?.replyFiles) {
        const text = opts.replyText;
        const files = opts.replyFiles?.map((f) => ({ name: f.name, mime: f.mime, bytes: new TextEncoder().encode(f.text) }));
        cfg.reply = (prompt, items, turn) => {
          const base = fixtureReply(prompt, items, turn);
          return { text: text ?? base.text, files: files ?? base.files };
        };
      }
    },
    testQuota: (accountId, text, delayMs) => {
      adapterFor(accountId);
      const cfg = fakeCfgs.get(accountId);
      if (!cfg) return;
      cfg.quota =
        text === "fail"
          ? () => {
              throw new Error("test: Usage panel did not open");
            }
          : text ?? undefined;
      cfg.quotaDelayMs = delayMs ?? 0;
    },
    testVibes: (accountId, steps, me) => {
      vibesFor(accountId);
      const cfg = fakeVibesCfgs.get(accountId);
      if (!cfg) return;
      if (steps) cfg.script = [...(cfg.script ?? []), ...(steps as unknown as FakeVibesStep[])];
      if (me) {
        cfg.me = me as FakeVibesConfig["me"];
        const steady = cfg.me?.[cfg.me.length - 1];
        if (steady && steady !== "network") fs.writeFileSync(path.join(paths.roaming, `test-vibes-${accountId}.me.json`), JSON.stringify(steady));
      }
    },
  };
  // Work that is not needed for the first frame runs right after it (or after AFTER_FIRST_FRAME_MS when the window
  // starts hidden and never draws): daily backup, profile sweep, shortcut repair, and the account session re-checks,
  // whose hidden Chromium pages would otherwise compete with the first paint.
  let afterFrameDone = false;
  const afterFirstFrame = (via: string) => {
    if (afterFrameDone) return;
    afterFrameDone = true;
    const t0 = Date.now();
    try {
      dailyBackup(repo.db, paths.backups);
    } catch (e) {
      logger.log("warn", "db", "daily backup failed", { error: String(e) });
    }
    // AC-ACC-08: profile folders of removed accounts, which Windows kept locked until the previous exit.
    try {
      const swept = sweepOrphanProfiles(app.getPath("sessionData"), repo.listAccounts().map((a) => a.id));
      if (swept.removed || swept.failed) logger.log("info", "accounts", "removed leftover profiles", { ...swept });
    } catch (e) {
      logger.log("warn", "accounts", "profile sweep failed", { error: String(e) });
    }
    refreshShortcuts();
    coord.revalidateSessions();
    logger.log("info", "app", "after first frame", { via, ms: Date.now() - t0 });
  };
  const dispatcher = new IpcDispatcher(coord, services, shellOps, {
    testMode: TEST,
    log: (l, s, m, d) => logger.log(l, s, m, d),
    api,
    startupPhases: () => marks,
    onFirstFrame: () => setImmediate(() => afterFirstFrame("first frame")),
  });

  // Windows without a working COM activator relaunches the exe with the toast's launch argument; the
  // single-instance lock hands that argv to this process (AC-APP-06).
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--quit")) {
      // Same path as tray → Quit: asks first when jobs are still running, never drops them silently.
      logger.log("info", "app", "quit requested", { via: "--quit" });
      requestQuit();
      return;
    }
    const route = routeFromArgv(argv);
    if (route) logger.log("info", "notice", "clicked", { route, via: "relaunch" });
    showWindow(route ?? undefined);
  });
  app.on("before-quit", (e) => {
    if (!quitting) {
      e.preventDefault();
      requestQuit();
    }
  });
  app.on("quit", (_e, exitCode) => logger.log("info", "app", "exit", { exitCode, viaQuit: quitting }));
  app.on("gpu-info-update", () => void updateDisplay());

  mark("core");
  createTray();
  // R124: a language picked in the EXE installer (written to ui-locale) is the first choice when none is saved yet.
  const startLocale = resolveStartLocale(coord.hasStoredSetting("language") ? coord.settings().language : null, bootFileLocale);
  if (startLocale.persist) coord.setSetting("language", startLocale.locale);
  applyLocale(startLocale.locale);
  await coord.init({ deferSessionChecks: true });
  mark("queue");
  setTimeout(() => afterFirstFrame("timer"), AFTER_FIRST_FRAME_MS);
  try {
    await api.init();
  } catch (e) {
    logger.log("error", "api", "init failed", { error: String(e) });
  }
  mark("api");
  // Data and API are ready: answer the renderer's waiting commands and let the window show.
  coreReady = true;
  resolveCore(dispatcher);
  // Cold start from a notification click: the route came in on the command line (always a toast of an older run).
  if (launchRoute) {
    logger.log("info", "notice", "clicked", { route: launchRoute, via: "launch" });
    openNoticeRoute(launchRoute, false);
  }
  // Registered after the window exists: a cold start through the COM activator replays its activation here.
  if (WIN_ACTIVATION) {
    Notification.handleActivation((details) => onToastActivation(details.arguments, `activator:${details.type}`));
  }
  setInterval(() => emit("heartbeat", { t: Date.now() }), HEARTBEAT_MS);
  setInterval(() => void updateDisplay(), 15_000);
  setInterval(() => logger.prune(), 6 * 3600_000);
}

// ------------------------------------------------------------------ helpers
function resourcePath(name: string): string {
  const candidates = [path.join(process.resourcesPath ?? "", name), path.join(__dirname, "..", "..", "resources", name), path.join(__dirname, "..", "resources", name)];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[1];
}

async function diskFree(dir: string): Promise<number | null> {
  let d = dir;
  for (let i = 0; i < 6 && !fs.existsSync(d); i++) d = path.dirname(d);
  try {
    const s = await fs.promises.statfs(d);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

function regQuery(key: string, value: string): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", value], { windowsHide: true }, (err, out) => resolve(err ? null : out));
  });
}

async function readTransparency(): Promise<boolean> {
  const out = await regQuery("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "EnableTransparency");
  return out == null ? true : parseTransparency(out);
}

async function readReducedMotion(): Promise<boolean> {
  let electronSays = false;
  try {
    electronSays = systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {
    /* not available on this platform */
  }
  const out = await regQuery("HKCU\\Control Panel\\Desktop", "UserPreferencesMask");
  return electronSays || (out != null && parseReducedMotion(out));
}

function copyFile(p: string, mime: string): void {
  // Electron 45 async clipboard: raw FileNameW lets Explorer paste the file; PNG/JPEG also go as an image.
  const items: Record<string, Blob> = {};
  if (process.platform === "win32") items['electron application/osclipboard;format="FileNameW"'] = new Blob([Buffer.from(p + "\0", "ucs2")]);
  if (mime === "image/png" || mime === "image/jpeg") {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) items["image/png"] = new Blob([new Uint8Array(img.toPNG())], { type: "image/png" });
  }
  const done = Object.keys(items).length ? clipboard.write([new ClipboardItem(items)]) : clipboard.writeText(p);
  done.catch(() => clipboard.writeText(p).catch(() => undefined));
}

interface WindowState {
  width: number;
  height: number;
  maximized: boolean;
}
function readWindowState(dir: string): WindowState | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "window-state.json"), "utf8"));
  } catch {
    return null;
  }
}
function writeWindowState(dir: string, w: BrowserWindow): void {
  try {
    const b = w.getNormalBounds();
    fs.writeFileSync(path.join(dir, "window-state.json"), JSON.stringify({ width: b.width, height: b.height, maximized: w.isMaximized() }));
  } catch {
    /* ignore */
  }
}
