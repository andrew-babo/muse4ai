import { BrowserWindow, screen, WebContentsView, type BrowserWindowConstructorOptions, type HandlerDetails, type Input, type Rectangle, type Session, type WebContents, type WindowOpenHandlerResponse } from "electron";
import {
  addTab,
  closeTab,
  cycleTab,
  decideWindowOpen,
  EMPTY_TABS,
  FAVICON_MAX_BYTES,
  faviconDataUrl,
  parseStripCommand,
  pickFavicon,
  popupPlacement,
  selectTab,
  STRIP_CSP,
  STRIP_HEIGHT,
  STRIP_PREFIX,
  stripVisible,
  tabMonogram,
  tabShortcut,
  TABS_WINDOW,
  tabsWindowBounds,
  urlParts,
  windowTitle,
  type Rect,
  type TabState,
} from "../shared/extraPages";
import { t } from "../shared/i18n";

// Build 3.2 R148–R154 — pages a Muse page opens while the user is using the account's window. A sized window.open is a
// real child window (keeps window.opener, so OAuth "Connect" popups hand their result back and close themselves);
// anything else becomes a tab of the account's one extra-pages window: a WebContentsView per tab under a tiny local
// tab strip that only shows from two tabs up. Every page stays in the account's own session (cookies + proxy); the
// strip is a data: page that loads nothing (CSP default-src 'none') and talks to main through console messages.
// Build 3.3 AC-FAV-01: a tab shows its site's favicon — main fetches it through the account's session (same proxy),
// checks it is a real image ≤ 64 KiB and hands the strip a data: URL (the strip's CSP allows data: images only).

export interface ExtraPagesHost {
  session(accountId: string): Session;
  alias(accountId: string): string;
  /** The account's Muse window — new windows are placed next to it. */
  anchor(accountId: string): BrowserWindow | null;
  icon?: string;
  log?(level: "info" | "warn" | "error", msg: string, data: Record<string, unknown>): void;
}

const IVORY = "#F7F4EE";
const SAFE_PREFS = { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } as const;
const WEBRTC = "disable_non_proxied_udp" as const;

interface Tab {
  id: number;
  view: WebContentsView;
  title: string;
  host: string;
  loading: boolean;
  /** data: URL of the favicon, null → monogram. */
  icon: string | null;
  /** The favicon source being shown or fetched, so a late answer for an older page is dropped. */
  iconKey: string;
}

interface Extras {
  popups: Set<BrowserWindow>;
  win: BrowserWindow | null;
  tabs: Map<number, Tab>;
  state: TabState;
  stripReady: boolean;
  lastBounds: Rect | null;
  /** Favicon fetch results by URL (null = not a usable image), bounded. */
  icons: Map<string, string | null>;
}

const ICON_CACHE_MAX = 64;
const ICON_TIMEOUT_MS = 8000;

export interface ExtraPagesSnapshot {
  popups: { title: string; bounds: Rect; content: Rect; webrtc: string }[];
  window: { visible: boolean; title: string; bounds: Rect } | null;
  tabs: { id: number; title: string; host: string; active: boolean; bounds: Rect | null; webrtc: string; icon: boolean }[];
  stripVisible: boolean;
}

const STRIP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${STRIP_CSP}">
<title>m4t</title><style>
:root{color-scheme:light}*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#F7F4EE;color:#5F5A52;user-select:none;
font:12.5px/1.2 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
nav{display:flex;align-items:flex-end;gap:3px;height:${STRIP_HEIGHT}px;padding:0 8px;border-bottom:1px solid rgba(26,24,20,.1)}
.tab{position:relative;display:flex;align-items:center;gap:7px;flex:0 1 224px;min-width:96px;height:30px;padding:0 4px 0 9px;
border-radius:9px 9px 0 0;cursor:default;outline:none;transition:background-color .12s}
.tab:hover{background:rgba(26,24,20,.05)}
.tab.on{background:#fff;color:#1A1814;box-shadow:0 0 0 1px rgba(26,24,20,.07)}
.tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#fff}
.tab:focus-visible{box-shadow:inset 0 0 0 2px #2E63E6}
.mono{flex:none;display:grid;place-items:center;width:16px;height:16px;border-radius:5px;background:rgba(46,99,230,.12);
color:#1A50D7;font-size:10px;font-weight:700}
.fav{flex:none;width:16px;height:16px;border-radius:3px;object-fit:contain}
.busy{animation:pulse 1s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
.name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.x{flex:none;display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;
color:inherit;opacity:.55}.x:hover{background:rgba(26,24,20,.08);opacity:1}.x svg{width:10px;height:10px}
@media (prefers-reduced-motion:reduce){.busy{animation:none}.tab{transition:none}}
</style></head><body><nav id="s" role="tablist"></nav><script>
(()=>{let q=0;const send=(c,i)=>console.log("${STRIP_PREFIX}"+(++q)+":"+c+":"+i);
const ns="http://www.w3.org/2000/svg";const cross=()=>{const s=document.createElementNS(ns,"svg");s.setAttribute("viewBox","0 0 10 10");
s.setAttribute("aria-hidden","true");const p=document.createElementNS(ns,"path");p.setAttribute("d","M1.5 1.5l7 7M8.5 1.5l-7 7");
p.setAttribute("stroke","currentColor");p.setAttribute("stroke-width","1.4");p.setAttribute("stroke-linecap","round");s.append(p);return s};
window.__m4t=(st)=>{const nav=document.getElementById("s");nav.textContent="";for(const tb of st.tabs){
const el=document.createElement("div");el.className="tab"+(tb.active?" on":"");el.setAttribute("role","tab");
el.setAttribute("aria-selected",String(tb.active));el.tabIndex=tb.active?0:-1;el.title=tb.title;
const m=document.createElement("span");m.className="mono"+(tb.loading?" busy":"");m.textContent=tb.mono;
let ic=m;if(tb.icon&&tb.icon.startsWith("data:image/")){const g=document.createElement("img");g.className="fav"+(tb.loading?" busy":"");
g.alt="";g.src=tb.icon;g.addEventListener("error",()=>g.replaceWith(m));ic=g}
const n=document.createElement("span");n.className="name";n.textContent=tb.title;
const x=document.createElement("button");x.type="button";x.className="x";x.tabIndex=-1;x.setAttribute("aria-label",st.closeLabel+": "+tb.title);
x.title=st.closeLabel;x.append(cross());x.addEventListener("click",(e)=>{e.stopPropagation();send("close",tb.id)});
el.addEventListener("mousedown",(e)=>{if(e.button===0&&!e.target.closest(".x"))send("select",tb.id)});
el.addEventListener("auxclick",(e)=>{if(e.button===1){e.preventDefault();send("close",tb.id)}});
el.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();send("select",tb.id)}});
el.append(ic,n,x);nav.append(el)}};})();
</script></body></html>`;
const STRIP_URL = `data:text/html;charset=utf-8,${encodeURIComponent(STRIP_HTML)}`;

const rectOf = (r: Rectangle): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
const alive = (w: BrowserWindow | null | undefined): w is BrowserWindow => !!w && !w.isDestroyed();

function workAreaNear(r: Rect | null): Rect {
  try {
    return rectOf((r ? screen.getDisplayMatching(r) : screen.getPrimaryDisplay()).workArea);
  } catch {
    return { x: 0, y: 0, width: 1920, height: 1080 };
  }
}

/** Console messages: Electron ≥ 35 passes one event object; older versions passed (event, level, message, …). */
function consoleText(args: unknown[]): string {
  const first = args[0] as { message?: unknown } | undefined;
  if (first && typeof first.message === "string") return first.message;
  return typeof args[2] === "string" ? args[2] : "";
}

export class ExtraPages {
  private byAccount = new Map<string, Extras>();
  private nextTabId = 1;

  constructor(private host: ExtraPagesHost) {}

  private extras(accountId: string): Extras {
    let x = this.byAccount.get(accountId);
    if (!x) this.byAccount.set(accountId, (x = { popups: new Set(), win: null, tabs: new Map(), state: EMPTY_TABS, stripReady: false, lastBounds: null, icons: new Map() }));
    return x;
  }

  private livePopups(x: Extras): number {
    for (const p of x.popups) if (p.isDestroyed()) x.popups.delete(p);
    return x.popups.size;
  }

  /**
   * Wires a page's window.open. `interactive` says whether the page is in front of the user (R148): the account's Muse
   * window only while shown; popups and tabs always. `owner` is the window a popup of this page belongs to.
   */
  attach(accountId: string, wc: WebContents, interactive: () => boolean, owner: () => BrowserWindow | null): void {
    wc.setWindowOpenHandler((d) => this.onOpen(accountId, d, interactive, owner));
    // Every window Electron creates for an attached page is one of our popups (tabs use createWindow, no event).
    wc.on("did-create-window", (child) => this.adoptPopup(accountId, child));
  }

  private onOpen(accountId: string, d: HandlerDetails, interactive: () => boolean, owner: () => BrowserWindow | null): WindowOpenHandlerResponse {
    const x = this.extras(accountId);
    let shown = false;
    try {
      shown = interactive();
    } catch {
      shown = false;
    }
    const decision = decideWindowOpen({ url: d.url, features: d.features, disposition: d.disposition, interactive: shown, openTabs: x.tabs.size, openPopups: this.livePopups(x) });
    if (decision.kind === "deny") {
      // R149: scheme + host only — the path and query of an OAuth URL can carry codes.
      this.host.log?.("info", "extra page refused", { id: accountId, reason: decision.reason, scheme: decision.scheme, host: decision.host });
      if (decision.reason === "limit") this.focusWindow(accountId);
      return { action: "deny" };
    }
    this.host.log?.("info", "extra page opened", { id: accountId, kind: decision.kind, scheme: decision.scheme, host: decision.host });
    if (decision.kind === "popup") {
      const parent = owner();
      const shown = alive(parent) && parent.isVisible();
      const parentBounds = shown ? rectOf(parent.getBounds()) : null;
      const b = popupPlacement({ width: decision.width, height: decision.height }, parentBounds, shown ? rectOf(parent.getContentBounds()) : null, workAreaNear(parentBounds));
      const opts: BrowserWindowConstructorOptions = {
        ...b,
        // window.open sizes are the page area (like a browser), not the outer window.
        useContentSize: true,
        show: true,
        minWidth: 320,
        minHeight: 320,
        autoHideMenuBar: true,
        backgroundColor: IVORY,
        icon: this.host.icon,
        title: windowTitle("", this.host.alias(accountId), t("Đang tải…")),
        webPreferences: { ...SAFE_PREFS },
      };
      if (alive(parent) && parent.isVisible()) opts.parent = parent;
      return { action: "allow", overrideBrowserWindowOptions: opts };
    }
    const background = decision.background;
    return {
      action: "allow",
      // A tab must survive its opener: the Muse page can be unloaded or reloaded while the user works in the tab.
      outlivesOpener: true,
      createWindow: (options) => this.createTab(accountId, options, background),
    };
  }

  private adoptPopup(accountId: string, child: BrowserWindow): void {
    const x = this.extras(accountId);
    x.popups.add(child);
    child.setMenu(null);
    const wc = child.webContents;
    wc.setWebRTCIPHandlingPolicy(WEBRTC);
    this.attach(accountId, wc, () => true, () => child);
    const alias = this.host.alias(accountId);
    wc.on("page-title-updated", (e, title) => {
      e.preventDefault();
      if (!child.isDestroyed()) child.setTitle(windowTitle(title, alias, t("Đang tải…")));
    });
    wc.on("before-input-event", (e, input) => {
      if (tabShortcut(input) === "reload") {
        e.preventDefault();
        wc.reload();
      }
    });
    wc.on("render-process-gone", () => {
      if (!child.isDestroyed()) child.close();
    });
    child.on("closed", () => x.popups.delete(child));
  }

  private createTab(accountId: string, options: BrowserWindowConstructorOptions, background: boolean): WebContents {
    // Electron hands the page it already created (same session as the opener) in options.webContents.
    const guest = (options as BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents;
    if (!guest) {
      this.host.log?.("error", "extra page: no page to adopt", { id: accountId });
      throw new Error("extra page: no page to adopt");
    }
    const view = new WebContentsView({ webContents: guest });
    view.setBackgroundColor("#FFFFFF");
    this.addTab(accountId, view, background);
    return guest;
  }

  private addTab(accountId: string, view: WebContentsView, background: boolean): void {
    const x = this.extras(accountId);
    const win = this.ensureWindow(accountId);
    const wc = view.webContents;
    const id = this.nextTabId++;
    const tab: Tab = { id, view, title: "", host: urlParts(wc.getURL() || "").host, loading: true, icon: null, iconKey: "" };
    x.tabs.set(id, tab);
    wc.setWebRTCIPHandlingPolicy(WEBRTC);
    this.attach(accountId, wc, () => true, () => x.win);
    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.refresh(accountId);
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.refresh(accountId);
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      this.refresh(accountId);
    });
    const navigated = (_e: unknown, url: string) => {
      const host = urlParts(url).host;
      // Another site: drop the old site's icon until the new page lists its own.
      if (host !== tab.host) {
        tab.icon = null;
        tab.iconKey = "";
      }
      tab.host = host;
      this.refresh(accountId);
    };
    wc.on("page-favicon-updated", (_e, favicons) => void this.setFavicon(accountId, tab, favicons));
    wc.on("did-navigate", navigated);
    wc.on("did-navigate-in-page", navigated);
    wc.on("before-input-event", (e, input) => this.onKey(accountId, e, input));
    wc.on("render-process-gone", () => this.closeTabById(accountId, id));
    wc.once("destroyed", () => this.closeTabById(accountId, id, true));
    win.contentView.addChildView(view);
    x.state = addTab(x.state, id, background);
    this.layout(accountId);
    this.refresh(accountId);
    if (!win.isVisible()) win.show();
    if (!background) {
      win.focus();
      wc.focus();
    }
  }

  /** AC-FAV-01 — the page's favicon list → a checked data: URL on the tab (monogram when none is usable). */
  private async setFavicon(accountId: string, tab: Tab, favicons: string[]): Promise<void> {
    const src = pickFavicon(favicons);
    if (!src) return;
    if (src.kind === "inline") {
      const icon = faviconDataUrl(src.bytes);
      tab.iconKey = "inline";
      if (icon !== tab.icon) {
        tab.icon = icon;
        this.refresh(accountId);
      }
      return;
    }
    if (tab.iconKey === src.url) return;
    tab.iconKey = src.url;
    const x = this.extras(accountId);
    let icon = x.icons.get(src.url);
    if (icon === undefined) {
      icon = await this.fetchFavicon(accountId, src.url);
      x.icons.set(src.url, icon);
      while (x.icons.size > ICON_CACHE_MAX) x.icons.delete(x.icons.keys().next().value as string);
    }
    // The tab moved on (another page, or closed) while the icon was on its way.
    if (tab.iconKey !== src.url || !x.tabs.has(tab.id)) return;
    tab.icon = icon;
    this.refresh(accountId);
  }

  private async fetchFavicon(accountId: string, url: string): Promise<string | null> {
    try {
      // The account's own session: the same proxy as its pages, never a direct connection.
      const res = await this.host.session(accountId).fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), credentials: "omit", redirect: "follow" });
      if (!res.ok || !res.body) return null;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > FAVICON_MAX_BYTES) {
        await res.body.cancel().catch(() => undefined);
        return null;
      }
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > FAVICON_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        bytes.set(p, at);
        at += p.byteLength;
      }
      return faviconDataUrl(bytes);
    } catch {
      // Offline, proxy refused, timeout: the monogram stays. Never logged — favicon URLs can carry a path.
      return null;
    }
  }

  private ensureWindow(accountId: string): BrowserWindow {
    const x = this.extras(accountId);
    if (alive(x.win)) return x.win;
    const anchor = this.host.anchor(accountId);
    const anchorBounds = alive(anchor) && anchor.isVisible() ? rectOf(anchor.getBounds()) : null;
    const b = tabsWindowBounds(anchorBounds, workAreaNear(anchorBounds ?? x.lastBounds), x.lastBounds);
    const win = new BrowserWindow({
      ...b,
      show: false,
      minWidth: TABS_WINDOW.minWidth,
      minHeight: TABS_WINDOW.minHeight,
      autoHideMenuBar: true,
      icon: this.host.icon,
      backgroundColor: IVORY,
      title: windowTitle("", this.host.alias(accountId), t("Đang tải…")),
      // The strip runs in the account's session too, so even a mistake could never reach the network directly.
      webPreferences: { ...SAFE_PREFS, session: this.host.session(accountId), backgroundThrottling: false },
    });
    win.setMenu(null);
    const strip = win.webContents;
    strip.setWebRTCIPHandlingPolicy(WEBRTC);
    strip.setWindowOpenHandler(() => ({ action: "deny" }));
    strip.on("will-navigate", (e) => e.preventDefault());
    strip.on("page-title-updated", (e) => e.preventDefault());
    strip.on("console-message", (...args: unknown[]) => this.onStripMessage(accountId, consoleText(args)));
    strip.on("did-finish-load", () => {
      x.stripReady = true;
      this.refresh(accountId);
    });
    strip.on("before-input-event", (e, input) => this.onKey(accountId, e, input));
    win.on("resize", () => this.layout(accountId));
    win.on("close", () => {
      if (!win.isDestroyed()) x.lastBounds = rectOf(win.getNormalBounds());
    });
    win.on("closed", () => {
      const tabs = [...x.tabs.values()];
      x.tabs.clear();
      x.state = EMPTY_TABS;
      if (x.win === win) {
        x.win = null;
        x.stripReady = false;
      }
      for (const tab of tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    });
    x.win = win;
    x.stripReady = false;
    void win.loadURL(STRIP_URL).catch(() => undefined);
    return win;
  }

  private onStripMessage(accountId: string, text: string): void {
    const c = parseStripCommand(text);
    if (!c) return;
    const x = this.byAccount.get(accountId);
    if (!x?.tabs.has(c.id)) return;
    if (c.cmd === "close") return this.closeTabById(accountId, c.id);
    x.state = selectTab(x.state, c.id);
    this.layout(accountId);
    this.refresh(accountId);
    x.tabs.get(c.id)?.view.webContents.focus();
  }

  private onKey(accountId: string, e: { preventDefault(): void }, input: Input): void {
    const k = tabShortcut(input);
    const x = this.byAccount.get(accountId);
    if (!k || !x) return;
    const active = x.state.active === null ? undefined : x.tabs.get(x.state.active);
    if (!active) return;
    const wc = active.view.webContents;
    e.preventDefault();
    if (k === "close") return this.closeTabById(accountId, active.id);
    if (k === "next" || k === "prev") {
      x.state = cycleTab(x.state, k === "next" ? 1 : -1);
      this.layout(accountId);
      this.refresh(accountId);
      if (x.state.active !== null) x.tabs.get(x.state.active)?.view.webContents.focus();
      return;
    }
    if (wc.isDestroyed()) return;
    if (k === "reload") return wc.reload();
    const h = wc.navigationHistory;
    if (k === "back" && h.canGoBack()) h.goBack();
    if (k === "forward" && h.canGoForward()) h.goForward();
  }

  private closeTabById(accountId: string, id: number, destroyed = false): void {
    const x = this.byAccount.get(accountId);
    const tab = x?.tabs.get(id);
    if (!x || !tab) return;
    x.tabs.delete(id);
    x.state = closeTab(x.state, id);
    if (alive(x.win)) x.win.contentView.removeChildView(tab.view);
    if (!destroyed && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    if (x.tabs.size === 0) {
      if (alive(x.win)) x.win.close();
      return;
    }
    this.layout(accountId);
    this.refresh(accountId);
  }

  private layout(accountId: string): void {
    const x = this.byAccount.get(accountId);
    if (!x || !alive(x.win)) return;
    const [w, h] = x.win.getContentSize();
    const top = stripVisible(x.tabs.size) ? STRIP_HEIGHT : 0;
    for (const tab of x.tabs.values()) {
      const on = tab.id === x.state.active;
      tab.view.setVisible(on);
      if (on) tab.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
    }
  }

  private refresh(accountId: string): void {
    const x = this.byAccount.get(accountId);
    if (!x || !alive(x.win)) return;
    const loading = t("Đang tải…");
    const active = x.state.active === null ? undefined : x.tabs.get(x.state.active);
    x.win.setTitle(windowTitle(active?.title ?? "", this.host.alias(accountId), loading));
    if (!x.stripReady) return;
    const payload = {
      closeLabel: t("Đóng trang"),
      tabs: x.state.order.flatMap((id) => {
        const tab = x.tabs.get(id);
        return tab ? [{ id, title: tab.title || tab.host || loading, mono: tabMonogram(tab.host), icon: tab.icon, loading: tab.loading, active: id === x.state.active }] : [];
      }),
    };
    void x.win.webContents.executeJavaScript(`window.__m4t && window.__m4t(${JSON.stringify(payload)})`).catch(() => undefined);
  }

  private focusWindow(accountId: string): void {
    const x = this.byAccount.get(accountId);
    if (!x || !alive(x.win)) return;
    if (x.win.isMinimized()) x.win.restore();
    x.win.show();
    x.win.focus();
  }

  /** R154 — close the account's popups, and the extra-pages window too unless `keepTabs` (sign-in just finished). */
  closeAll(accountId: string, keepTabs = false): void {
    const x = this.byAccount.get(accountId);
    if (!x) return;
    for (const p of [...x.popups]) if (!p.isDestroyed()) p.close();
    x.popups.clear();
    if (!keepTabs && alive(x.win)) x.win.close();
  }

  /** Something the user opened is still on screen (keeps the account's Muse page from idle unloading — R154). */
  hasOpen(accountId: string): boolean {
    const x = this.byAccount.get(accountId);
    if (!x) return false;
    return this.livePopups(x) > 0 || (alive(x.win) && x.win.isVisible());
  }

  /** Account removed: close everything and forget it. */
  forget(accountId: string): void {
    this.closeAll(accountId, false);
    this.byAccount.get(accountId)?.icons.clear();
    this.byAccount.delete(accountId);
  }

  /** Read-only view for the Windows lab check (no tokens, no URLs beyond the host). */
  snapshot(accountId: string): ExtraPagesSnapshot {
    const x = this.byAccount.get(accountId);
    if (!x) return { popups: [], window: null, tabs: [], stripVisible: false };
    this.livePopups(x);
    return {
      popups: [...x.popups].map((p) => ({ title: p.getTitle(), bounds: rectOf(p.getBounds()), content: rectOf(p.getContentBounds()), webrtc: p.webContents.getWebRTCIPHandlingPolicy() })),
      window: alive(x.win) ? { visible: x.win.isVisible(), title: x.win.getTitle(), bounds: rectOf(x.win.getBounds()) } : null,
      tabs: x.state.order.flatMap((id) => {
        const tab = x.tabs.get(id);
        return tab ? [{ id, title: tab.title, host: tab.host, active: id === x.state.active, bounds: tab.view.getVisible() ? rectOf(tab.view.getBounds()) : null, webrtc: tab.view.webContents.getWebRTCIPHandlingPolicy(), icon: !!tab.icon }] : [];
      }),
      stripVisible: stripVisible(x.tabs.size),
    };
  }
}
