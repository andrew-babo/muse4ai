import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, net, session, type Session, type WebContents } from "electron";
import { CHROME_UA, MUSE } from "./adapter/muse/selectors";
import { MuseDriver } from "./adapter/muse/driver";
import { VibesDriver } from "./adapter/vibes/driver";
import { isLoginPopupAllowed, isVibesAgeBlock, VIBES } from "./adapter/vibes/protocol";
import type { MuseAdapter, ProxyTestResult, VibesAdapter } from "./adapter/types";
import type { AccountUi, LoginResult, ProxyCreds } from "./coordinator";
import { WebPage } from "./webpage";
import { shouldThrottlePage, shouldUnloadPage } from "./idlePages";
import type { Proxy, Site } from "../shared/types";
import { classifyAuthMe } from "../shared/vibes";
import type { ChannelPage } from "./adapter/muse/httpChannel";
import { GW_PAGE_URL } from "./adapter/muse/httpProtocol";
import { UiWorkPool } from "./uiWorkPool";

// One persistent session partition per account, with that account's proxy and no DIRECT fallback (R1, R2).
// rev 6 (rules B32): the same partition holds two pages — Muse and Vibes — each in its own hidden window. Both use the
// one session (cookies, proxy, credentials); the app never reads or copies a cookie between them.

export interface AccountHost {
  proxyFor(accountId: string): Proxy | null;
  creds(proxyId: string): ProxyCreds;
  getProxy(proxyId: string): Proxy | null;
  alias(accountId: string): string;
  onPreviewFrame(accountId: string, dataUrl: string): void;
  /** The account is working on a job (its page must stay loaded). */
  busy?(accountId: string): boolean;
  beforeSend?(accountId: string, signal: AbortSignal): Promise<void>;
  /** R39 — “Dùng Vibes cho tài khoản này”; while off nothing of this profile may reach Vibes. */
  vibesEnabled?(accountId: string): boolean;
  /** Which page of the account is in use right now (preview shows that one). */
  activeSite?(accountId: string): Site | null;
  log?(level: "info" | "warn" | "error", msg: string, data: Record<string, unknown>): void;
  icon?: string;
}

/** A page that stops answering for this long is recycled (G5: dead worker detected and restarted within 10 s). */
const PAGE_HANG_MS = 8_000;
/** Requests to these hosts are refused for a profile whose Vibes switch is off (R39). */
const VIBES_BLOCK_URLS = ["*://vibes.ai/*", "*://*.vibes.ai/*"];

function proxyRules(p: Proxy): string {
  if (p.scheme === "socks5") return `socks5://${p.host}:${p.port}`;
  if (p.scheme === "https") return `https://${p.host}:${p.port}`;
  return `${p.host}:${p.port}`;
}

const slotKey = (accountId: string, site: Site) => (site === "muse" ? accountId : `${accountId}#vibes`);
const slotOf = (key: string): { accountId: string; site: Site } => (key.endsWith("#vibes") ? { accountId: key.slice(0, -6), site: "vibes" } : { accountId: key, site: "muse" });
const SITE_NAME: Record<Site, string> = { muse: "Muse", vibes: "Vibes" };

export class AccountManager implements AccountUi {
  private windows = new Map<string, BrowserWindow>();
  private pages = new Map<string, WebPage>();
  private adapters = new Map<string, MuseAdapter>();
  private vibesAdapters = new Map<string, VibesAdapter>();
  private sessionOwner = new Map<Session, { kind: "account" | "test"; id: string }>();
  private previews = new Map<string, NodeJS.Timeout>();
  private loginWaiters = new Map<string, (ok: LoginResult) => void>();
  /** “Đã xong, kiểm tra phiên”: run the login check of a waiting window right now. */
  private loginPokes = new Map<string, () => void>();
  private proxyReady = new Map<string, Promise<void>>();
  private lastUse = new Map<string, number>();
  /** Pages currently throttled because they are hidden and quiet (idlePages.shouldThrottlePage). */
  private throttled = new Set<string>();
  private idleTimer: NodeJS.Timeout;
  /** Build 2.0 R94 — one hidden light page per account for the direct channel (no Muse UI, same session/proxy). */
  private channelWindows = new Map<string, BrowserWindow>();
  private workWindows = new Map<string, { accountId: string; win: BrowserWindow }>();
  private workPool = new UiWorkPool<MuseAdapter>(
    (id, key, primary) => {
      if (primary) return this.adapter(id);
      let win: BrowserWindow | undefined;
      const page = () => {
        if (!win || win.isDestroyed()) {
          win = new BrowserWindow({
            show: false, width: 1280, height: 860, title: `Muse4AI — ${this.host.alias(id)} · việc`,
            autoHideMenuBar: true, icon: this.host.icon,
            webPreferences: { session: this.sessionFor(id), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
          });
          win.setMenu(null);
          win.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          win.webContents.setAudioMuted(true);
          this.workWindows.set(key, { accountId: id, win });
          const wc = win.webContents;
          let hang: NodeJS.Timeout | undefined;
          wc.on("unresponsive", () => {
            if (hang) return;
            hang = setTimeout(() => { if (!wc.isDestroyed()) wc.forcefullyCrashRenderer(); }, PAGE_HANG_MS);
          });
          wc.on("responsive", () => { if (hang) clearTimeout(hang); hang = undefined; });
          wc.on("render-process-gone", () => {
            if (hang) clearTimeout(hang);
            const dead = win;
            if (dead && !dead.isDestroyed()) dead.destroy();
            this.workWindows.delete(key);
          });
        }
        return new WebPage(win.webContents, () => this.proxyInForce(id));
      };
      const adapter = new MuseDriver({ page, exitIp: () => this.exitIp(id), beforeSend: signal => this.host.beforeSend?.(id, signal) ?? Promise.resolve(), log: (msg, data) => this.host.log?.("info", msg, { id, ...data }) });
      // The pool's destroy callback locates this page without passing any account token.
      this.workKeys.set(adapter, key);
      return adapter;
    },
    (adapter, primary) => {
      if (primary) return;
      const key = this.workKeys.get(adapter);
      if (!key) return;
      const slot = this.workWindows.get(key);
      this.workWindows.delete(key);
      if (slot && !slot.win.isDestroyed()) slot.win.destroy();
      this.workKeys.delete(adapter);
    },
  );
  private workKeys = new Map<MuseAdapter, string>();
  quitting = false;

  constructor(private host: AccountHost) {
    this.idleTimer = setInterval(() => this.unloadIdlePages(), 30_000);
    this.idleTimer.unref?.();
    app.on("login", (event, wc, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      const owner = wc ? this.sessionOwner.get(wc.session) : undefined;
      if (!owner) return;
      const proxy = owner.kind === "account" ? this.host.proxyFor(owner.id) : this.host.getProxy(owner.id);
      if (!proxy) return;
      const c = this.host.creds(proxy.id);
      if (c.username && c.password) {
        event.preventDefault();
        callback(c.username, c.password);
      }
    });
  }

  sessionFor(accountId: string): Session {
    const s = session.fromPartition(`persist:acc-${accountId}`);
    if (!this.sessionOwner.has(s)) {
      this.sessionOwner.set(s, { kind: "account", id: accountId });
      s.setUserAgent(CHROME_UA(process.versions.chrome), "en-US,en;q=0.9");
      s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
      s.setPermissionCheckHandler(() => false);
      s.on("will-download", (e) => e.preventDefault());
      // R39: the switch is read live, so turning Vibes off stops even a request already queued by a page.
      s.webRequest.onBeforeRequest({ urls: VIBES_BLOCK_URLS }, (_d, cb) => cb({ cancel: !(this.host.vibesEnabled?.(accountId) ?? false) }));
      this.trackProxy(accountId, s);
    }
    return s;
  }

  /** Every page load and network check of an account waits for its proxy to be in force (no window where traffic leaves directly). */
  private trackProxy(accountId: string, s: Session): Promise<void> {
    const p = this.applyProxyToSession(accountId, s).catch((e) => {
      this.host.log?.("error", "proxy apply failed", { error: String(e) });
      throw e;
    });
    this.proxyReady.set(accountId, p);
    return p;
  }

  private proxyInForce(accountId: string): Promise<void> {
    this.sessionFor(accountId);
    return this.proxyReady.get(accountId) ?? Promise.resolve();
  }

  private async applyProxyToSession(accountId: string, s: Session): Promise<void> {
    const p = this.host.proxyFor(accountId);
    // No proxy → route everything to an unroutable proxy so nothing ever leaves directly (R1).
    const rules = p ? proxyRules(p) : "127.0.0.1:9";
    await s.setProxy({ mode: "fixed_servers", proxyRules: rules, proxyBypassRules: "<-loopback>" });
    await s.closeAllConnections().catch(() => undefined);
  }

  applyProxy(accountId: string): void {
    void this.trackProxy(accountId, this.sessionFor(accountId)).catch(() => undefined);
  }

  private window(accountId: string, site: Site = "muse"): BrowserWindow {
    const key = slotKey(accountId, site);
    let w = this.windows.get(key);
    if (w && !w.isDestroyed()) return w;
    if (site === "vibes" && !(this.host.vibesEnabled?.(accountId) ?? false)) throw new Error("Vibes đang tắt cho tài khoản này");
    w = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: `Muse4AI — ${this.host.alias(accountId)}${site === "vibes" ? " · Vibes" : ""}`,
      autoHideMenuBar: true,
      icon: this.host.icon,
      backgroundColor: "#F7F4EE",
      webPreferences: {
        session: this.sessionFor(accountId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    w.setMenu(null);
    w.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    if (site === "vibes") {
      // A Meta login popup (same session, same proxy) is allowed only on Meta's own login origins (rules B32).
      const parent = w;
      w.webContents.setWindowOpenHandler(({ url }) =>
        isLoginPopupAllowed(url)
          ? { action: "allow", overrideBrowserWindowOptions: { parent, autoHideMenuBar: true, backgroundColor: "#F7F4EE", width: 520, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } }
          : { action: "deny" },
      );
      w.webContents.on("did-create-window", (child) => {
        child.setMenu(null);
        child.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
        child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      });
    } else {
      w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    }
    // Supervision: a crashed page is dropped at once and rebuilt on next use (the session keeps the login);
    // a page hung longer than PAGE_HANG_MS is crashed on purpose so the next step starts clean.
    const wc = w.webContents;
    let hang: NodeJS.Timeout | undefined;
    wc.on("render-process-gone", (_e, d) => {
      if (hang) clearTimeout(hang);
      this.host.log?.("warn", "account page gone", { site, reason: d.reason, exitCode: d.exitCode });
      this.dropWindow(key, w!);
    });
    wc.on("unresponsive", () => {
      if (hang) return;
      hang = setTimeout(() => {
        hang = undefined;
        if (!wc.isDestroyed()) {
          this.host.log?.("warn", "account page unresponsive, recycling", { site });
          wc.forcefullyCrashRenderer();
        }
      }, PAGE_HANG_MS);
    });
    wc.on("responsive", () => {
      if (hang) clearTimeout(hang);
      hang = undefined;
    });
    w.on("close", (e) => {
      if (this.quitting) return;
      e.preventDefault();
      w!.hide();
      this.resolveWaiter(key, false);
    });
    this.windows.set(key, w);
    this.pages.set(key, new WebPage(w.webContents, () => this.proxyInForce(accountId)));
    return w;
  }

  private resolveWaiter(key: string, ok: boolean): void {
    const waiter = this.loginWaiters.get(key);
    if (waiter) {
      this.loginWaiters.delete(key);
      waiter(ok);
    }
  }

  /** Forget a dead window so page()/webContents() build a fresh one; in-flight steps fail with "page closed". */
  private dropWindow(key: string, w: BrowserWindow): void {
    if (this.windows.get(key) === w) {
      this.windows.delete(key);
      this.pages.delete(key);
      this.throttled.delete(key);
    }
    const { accountId, site } = slotOf(key);
    if ((this.host.activeSite?.(accountId) ?? "muse") === site) this.stopPreview(accountId);
    this.resolveWaiter(key, false);
    setImmediate(() => {
      if (!w.isDestroyed()) {
        w.removeAllListeners("close");
        w.destroy();
      }
    });
  }

  page(accountId: string, site: Site = "muse"): WebPage {
    const key = slotKey(accountId, site);
    this.lastUse.set(key, Date.now());
    this.wake(key, this.window(accountId, site));
    return this.pages.get(key)!;
  }

  webContents(accountId: string, site: Site = "muse"): WebContents {
    const key = slotKey(accountId, site);
    this.lastUse.set(key, Date.now());
    const w = this.window(accountId, site);
    this.wake(key, w);
    return w.webContents;
  }

  /** Any use of a page lifts the quiet-page throttle before the step runs. */
  private wake(key: string, w: BrowserWindow): void {
    if (!this.throttled.delete(key) || w.isDestroyed()) return;
    w.webContents.setBackgroundThrottling(false);
  }

  /** Throttles, then unloads, hidden account pages that have had nothing to do (idlePages.ts); the login is kept. */
  private unloadIdlePages(): void {
    if (this.quitting) return;
    const now = Date.now();
    for (const [key, w] of [...this.windows]) {
      if (w.isDestroyed()) continue;
      const { accountId, site } = slotOf(key);
      const inUse = (this.host.activeSite?.(accountId) ?? "muse") === site;
      const activity = {
        visible: w.isVisible() || w.getChildWindows().some((c) => !c.isDestroyed() && c.isVisible()),
        previewing: this.previews.has(accountId) && inUse,
        loggingIn: this.loginWaiters.has(key),
        busy: (this.host.busy?.(accountId) ?? false) && inUse,
        lastUse: this.lastUse.get(key) ?? 0,
      };
      if (shouldUnloadPage(activity, now)) {
        this.host.log?.("info", "account page unloaded (idle)", { id: accountId, site });
        this.throttled.delete(key);
        this.dropWindow(key, w);
        continue;
      }
      const quiet = shouldThrottlePage(activity, now);
      if (quiet && !this.throttled.has(key)) {
        this.throttled.add(key);
        w.webContents.setBackgroundThrottling(true);
      } else if (!quiet && this.throttled.has(key)) {
        // Shown, previewed, logging in or working again without a page() call (e.g. takeover): full speed.
        this.throttled.delete(key);
        w.webContents.setBackgroundThrottling(false);
      }
    }
  }

  adapter(accountId: string): MuseAdapter {
    let a = this.adapters.get(accountId);
    if (!a) {
      a = new MuseDriver({ page: () => this.page(accountId), exitIp: () => this.exitIp(accountId), beforeSend: signal => this.host.beforeSend?.(accountId, signal) ?? Promise.resolve(), log: (msg, data) => this.host.log?.("info", msg, { id: accountId, ...data }) });
      this.adapters.set(accountId, a);
    }
    return a;
  }

  workAdapter(accountId: string, jobId: string): MuseAdapter {
    return this.workPool.acquire(accountId, jobId);
  }

  releaseWork(accountId: string, jobId: string): void {
    this.workPool.release(accountId, jobId);
  }

  /** rev 6 — the account's Vibes page in the same profile (built on first use, never while Vibes is off). */
  vibesAdapter(accountId: string): VibesAdapter {
    let a = this.vibesAdapters.get(accountId);
    if (!a) {
      a = new VibesDriver({ page: () => this.page(accountId, "vibes"), log: (msg, data) => this.host.log?.("info", msg, data ?? {}) });
      this.vibesAdapters.set(accountId, a);
    }
    return a;
  }

  /** R39 — switching Vibes off closes the account's Vibes page; the network block in sessionFor() does the rest. */
  setVibesEnabled(accountId: string, on: boolean): void {
    if (on) return;
    const key = slotKey(accountId, "vibes");
    const w = this.windows.get(key);
    if (w && !w.isDestroyed()) this.dropWindow(key, w);
    this.vibesAdapters.delete(accountId);
  }

  /**
   * F2/F14 — shows one site's login page; resolves true once that site reports a logged-in session (R41), "restricted"
   * when Vibes shows its under-18 block (AC-VIB-15), false when closed or cancelled.
   */
  async openLogin(accountId: string, site: Site = "muse"): Promise<LoginResult> {
    const key = slotKey(accountId, site);
    this.resolveWaiter(key, false);
    const w = this.window(accountId, site);
    w.setTitle(`Đăng nhập ${SITE_NAME[site]} — ${this.host.alias(accountId)}`);
    const page = this.page(accountId, site);
    try {
      await page.load(site === "vibes" ? VIBES.home : MUSE.home, 45_000);
    } catch (e) {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
    }
    w.show();
    w.focus();
    return new Promise<LoginResult>((resolve) => {
      let done = false;
      let busy = false;
      const finish = (ok: LoginResult) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        if (this.loginWaiters.get(key) === finish) this.loginWaiters.delete(key);
        if (this.loginPokes.get(key) === poke) this.loginPokes.delete(key);
        if (ok !== false && !w.isDestroyed()) {
          for (const c of w.getChildWindows()) if (!c.isDestroyed()) c.close();
          w.hide();
        }
        resolve(ok);
      };
      this.loginWaiters.set(key, finish);
      const poke = () => void check();
      this.loginPokes.set(key, poke);
      const timer = setInterval(() => void check(), 2500);
      const check = async () => {
        if (done) return;
        if (w.isDestroyed()) return finish(false);
        if (busy) return;
        busy = true;
        try {
          if (site === "vibes") {
            // Read from the session (any page of the login may be on a Meta origin): same partition, proxy and cookies.
            const r = await this.sessionGet(accountId, `${VIBES.origin}${VIBES.authMe}`);
            if (classifyAuthMe(r, false).kind === "ready") finish(true);
            else if (await this.vibesAgeBlocked(accountId)) finish("restricted");
          } else {
            const st = await page.eval<number>(`fetch(${JSON.stringify(MUSE.sessionApi)}, { credentials: "include", redirect: "manual" }).then(async (r) => { if (r.status !== 200) return r.status; const j = await r.json().catch(() => ({})); return j.status === "assigned" ? 200 : 401; }).catch(() => 0)`);
            if (st === 200) finish(true);
          }
        } catch {
          /* page navigating / network */
        } finally {
          busy = false;
        }
      };
    });
  }

  /** AC-VIB-15 — the account's Vibes page shows Vibes' under-18 block (only read while it is on vibes.ai). */
  private async vibesAgeBlocked(accountId: string): Promise<boolean> {
    const w = this.windows.get(slotKey(accountId, "vibes"));
    if (!w || w.isDestroyed()) return false;
    try {
      if (new URL(w.webContents.getURL()).origin !== VIBES.origin) return false;
    } catch {
      return false;
    }
    const text = await this.page(accountId, "vibes")
      .eval<string>(`document.body ? document.body.innerText.slice(0, 4000) : ""`, 5000)
      .catch(() => "");
    return isVibesAgeBlock(typeof text === "string" ? text : "");
  }

  pokeLogin(accountId: string, site: Site): void {
    this.loginPokes.get(slotKey(accountId, site))?.();
  }

  /** Ends a waiting login window of one site (or both): its openLogin resolves false. */
  cancelLogin(accountId: string, site?: Site): void {
    for (const s of site ? [site] : (["muse", "vibes"] as Site[])) {
      const key = slotKey(accountId, s);
      this.resolveWaiter(key, false);
      const w = this.windows.get(key);
      if (w && !w.isDestroyed()) {
        for (const c of w.getChildWindows()) if (!c.isDestroyed()) c.close();
        w.hide();
      }
    }
  }

  showTakeover(accountId: string, site: Site = "muse"): void {
    const w = this.window(accountId, site);
    w.setTitle(`Anh đang điều khiển ${SITE_NAME[site]} — ${this.host.alias(accountId)}`);
    if (!w.webContents.getURL()) void this.page(accountId, site).load(site === "vibes" ? VIBES.home : MUSE.home, 45_000).catch(() => undefined);
    w.show();
    w.focus();
  }

  hideTakeover(accountId: string): void {
    for (const s of ["muse", "vibes"] as Site[]) {
      const w = this.windows.get(slotKey(accountId, s));
      if (w && !w.isDestroyed()) w.hide();
    }
  }

  startPreview(accountId: string): void {
    this.stopPreview(accountId);
    const tick = async () => {
      const site = this.host.activeSite?.(accountId) ?? "muse";
      const w = this.windows.get(slotKey(accountId, site));
      if (!w || w.isDestroyed() || !w.webContents.getURL()) return this.host.onPreviewFrame(accountId, "");
      try {
        const img = await w.webContents.capturePage();
        const resized = img.getSize().width > 960 ? img.resize({ width: 960 }) : img;
        this.host.onPreviewFrame(accountId, "data:image/jpeg;base64," + resized.toJPEG(70).toString("base64"));
      } catch {
        /* ignore */
      }
    };
    void tick();
    this.previews.set(accountId, setInterval(() => void tick(), 1000)); // ≤ 2 frames/s
  }

  stopPreview(accountId: string): void {
    const t = this.previews.get(accountId);
    if (t) clearInterval(t);
    this.previews.delete(accountId);
  }

  /**
   * Build 2.0 R94/R96 — the account's hidden light page for the direct channel: same persistent partition (cookies,
   * proxy, proxy login), loaded only after the proxy is in force, on a same-origin static URL so no Muse page script
   * runs. It never shows, opens no popups and is rebuilt on next use after a crash.
   */
  async channelPage(accountId: string): Promise<ChannelPage> {
    let w = this.channelWindows.get(accountId);
    if (!w || w.isDestroyed()) {
      await this.proxyInForce(accountId);
      const win = new BrowserWindow({
        show: false,
        width: 480,
        height: 320,
        title: `Muse4AI — ${this.host.alias(accountId)} · kênh trực tiếp`,
        backgroundColor: "#F7F4EE",
        webPreferences: { session: this.sessionFor(accountId), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, images: false },
      });
      win.setMenu(null);
      win.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.on("render-process-gone", (_e, d) => {
        this.host.log?.("warn", "channel page gone", { reason: d.reason, exitCode: d.exitCode });
        if (this.channelWindows.get(accountId) === win) this.channelWindows.delete(accountId);
        setImmediate(() => !win.isDestroyed() && win.destroy());
      });
      win.on("close", (e) => {
        if (this.quitting) return;
        e.preventDefault();
      });
      this.channelWindows.set(accountId, win);
      try {
        await win.webContents.loadURL(GW_PAGE_URL);
      } catch (e) {
        // A non-2xx static page still gives the origin; only a navigation that never committed is fatal.
        if (!win.webContents.getURL().startsWith("https://")) {
          this.channelWindows.delete(accountId);
          if (!win.isDestroyed()) win.destroy();
          throw new Error(`Không mở được trang kênh trực tiếp: ${String((e as Error).message ?? e).slice(0, 120)}`);
        }
      }
      w = win;
    }
    const win = w;
    const wc = win.webContents;
    const s = this.sessionFor(accountId);
    return {
      eval: <T,>(code: string, timeoutMs = 20_000): Promise<T> => {
        if (wc.isDestroyed()) return Promise.reject(new Error("page closed"));
        let t: NodeJS.Timeout | undefined;
        return Promise.race([
          wc.executeJavaScript(code, true) as Promise<T>,
          new Promise<T>((_, rej) => {
            t = setTimeout(() => rej(new Error("ERR_TIMED_OUT: channel script timeout")), timeoutMs);
          }),
        ]).finally(() => t && clearTimeout(t));
      },
      resolveProxy: (url: string) => s.resolveProxy(url),
      memoryBytes: () => {
        if (wc.isDestroyed()) return null;
        const pid = wc.getOSProcessId();
        const m = app.getAppMetrics().find((x) => x.pid === pid);
        return m ? m.memory.workingSetSize * 1024 : null;
      },
      destroy: () => {
        if (this.channelWindows.get(accountId) === win) this.channelWindows.delete(accountId);
        if (!win.isDestroyed()) {
          win.removeAllListeners("close");
          win.destroy();
        }
      },
    };
  }

  private destroyChannel(accountId: string): void {
    const w = this.channelWindows.get(accountId);
    this.channelWindows.delete(accountId);
    if (w && !w.isDestroyed()) {
      w.removeAllListeners("close");
      w.destroy();
    }
  }

  async destroy(accountId: string): Promise<void> {
    this.stopPreview(accountId);
    this.workPool.remove(accountId);
    this.destroyChannel(accountId);
    for (const s of ["muse", "vibes"] as Site[]) {
      const key = slotKey(accountId, s);
      this.resolveWaiter(key, false);
      const w = this.windows.get(key);
      if (w && !w.isDestroyed()) {
        w.removeAllListeners("close");
        w.destroy();
      }
      this.windows.delete(key);
      this.pages.delete(key);
      this.lastUse.delete(key);
    }
    this.adapters.delete(accountId);
    this.vibesAdapters.delete(accountId);
    this.proxyReady.delete(accountId);
    const s = session.fromPartition(`persist:acc-${accountId}`);
    await s.clearStorageData().catch(() => undefined);
    await s.clearCache().catch(() => undefined);
    this.sessionOwner.delete(s);
    // The session is logged out now. The folder goes here where the OS allows it; on Windows Chromium keeps it open
    // until exit, and the start-up sweep (profiles.ts) deletes it on the next launch.
    const dir = path.join(app.getPath("sessionData"), "Partitions", `acc-${accountId}`);
    setTimeout(() => fs.rm(dir, { recursive: true, force: true }, () => undefined), 1500);
  }

  /** GET through the account's own session (its proxy and cookies) — used only to notice a finished login. */
  private async sessionGet(accountId: string, url: string, timeoutMs = 15_000): Promise<{ status: number; body: unknown }> {
    const s = this.sessionFor(accountId);
    await this.proxyInForce(accountId);
    const proxy = this.host.proxyFor(accountId);
    if (!proxy) return { status: 0, body: null };
    const creds = this.host.creds(proxy.id);
    return new Promise((resolve) => {
      const req = net.request({ url, session: s, useSessionCookies: true, redirect: "manual" });
      const t = setTimeout(() => {
        req.abort();
        resolve({ status: 0, body: null });
      }, timeoutMs);
      req.on("login", (authInfo, cb) => {
        if (authInfo.isProxy && creds.username && creds.password) cb(creds.username, creds.password);
        else cb();
      });
      req.on("redirect", () => {
        clearTimeout(t);
        req.abort();
        resolve({ status: 401, body: null });
      });
      req.on("response", (res) => {
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => {
          clearTimeout(t);
          let parsed: unknown = null;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on("error", () => {
        clearTimeout(t);
        resolve({ status: 0, body: null });
      });
      req.end();
    });
  }

  /** The exit IP as Muse sees it: same session, same proxy, same credentials as the account's own pages. */
  private async exitIp(accountId: string): Promise<{ ip: string; country: string | null }> {
    const s = this.sessionFor(accountId);
    await this.proxyInForce(accountId);
    const proxy = this.host.proxyFor(accountId);
    if (!proxy) throw new Error("Tài khoản chưa có proxy");
    const creds = this.host.creds(proxy.id);
    return new Promise((resolve, reject) => {
      const req = net.request({ url: MUSE.ipCheck, session: s, useSessionCookies: false });
      const t = setTimeout(() => {
        req.abort();
        reject(new Error("timeout"));
      }, 15_000);
      req.on("login", (authInfo, cb) => {
        if (authInfo.isProxy && creds.username && creds.password) cb(creds.username, creds.password);
        else cb();
      });
      req.on("response", (res) => {
        if (res.statusCode !== 200) {
          clearTimeout(t);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => {
          clearTimeout(t);
          try {
            const j = JSON.parse(body);
            resolve({ ip: j.ip, country: j.country ?? null });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
      req.end();
    });
  }

  /** Proxy health: exit IP, country, latency through an ephemeral session bound to that proxy only. */
  async testProxy(p: Proxy): Promise<ProxyTestResult> {
    const s = session.fromPartition(`proxytest-${p.id}-${Date.now()}`);
    this.sessionOwner.set(s, { kind: "test", id: p.id });
    await s.setProxy({ mode: "fixed_servers", proxyRules: proxyRules(p), proxyBypassRules: "<-loopback>" });
    const creds = this.host.creds(p.id);
    const t0 = Date.now();
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = net.request({ url: MUSE.ipCheck, session: s, useSessionCookies: false });
        const timer = setTimeout(() => {
          req.abort();
          reject(new Error("Quá 15 giây không phản hồi"));
        }, 15_000);
        req.on("login", (authInfo, cb) => {
          if (authInfo.isProxy && creds.username && creds.password) cb(creds.username, creds.password);
          else cb();
        });
        req.on("response", (res) => {
          if (res.statusCode === 407) {
            clearTimeout(timer);
            reject(new Error("Proxy từ chối tên/mật khẩu"));
            return;
          }
          let b = "";
          res.on("data", (c) => (b += c.toString()));
          res.on("end", () => {
            clearTimeout(timer);
            resolve(b);
          });
        });
        req.on("error", (e) => {
          clearTimeout(timer);
          reject(new Error(/PROXY|TUNNEL/.test(e.message) ? "Không kết nối được proxy" : e.message));
        });
        req.end();
      });
      const j = JSON.parse(body) as { ip?: string; country?: string };
      if (!j.ip) return { ok: false, error: "Không đọc được IP ra" };
      return { ok: true, ip: j.ip, country: j.country ?? null, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      this.sessionOwner.delete(s);
      void s.clearStorageData().catch(() => undefined);
    }
  }

  closeAll(): void {
    this.quitting = true;
    this.workPool.remove();
    clearInterval(this.idleTimer);
    for (const id of this.previews.keys()) this.stopPreview(id);
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.destroy();
    for (const w of this.channelWindows.values()) if (!w.isDestroyed()) w.destroy();
  }
}
