// Build 3.2 R148–R154 — pages a Muse page opens while the user is using the account's window (sign-in or takeover):
// a sized `window.open` becomes a small popup window (OAuth "Connect" flows), anything else becomes a tab of the
// account's one "extra pages" window, whose thin tab strip shows only from two pages up. This file is the pure part
// (decisions, sizes, tab order, strip commands, shortcuts); src/main/extraPages.ts wires it to Electron.

export const EXTRA_LIMITS = { tabs: 8, popups: 4 } as const;
export const POPUP_DEFAULT = { width: 520, height: 720 } as const;
export const POPUP_CLAMP = { minWidth: 360, maxWidth: 1000, minHeight: 400, maxHeight: 900 } as const;
export const STRIP_HEIGHT = 36;
/** Tab strip → main messages travel as the strip page's title: `m4t:<seq>:<cmd>:<id>`. */
export const STRIP_PREFIX = "m4t:";

export type OpenDisposition = "default" | "foreground-tab" | "background-tab" | "new-window" | "other";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpenFeatures {
  width?: number;
  height?: number;
  popup: boolean;
  noopener: boolean;
}

const TRUE_WORDS = new Set(["", "1", "yes", "true"]);

/** Reads a `window.open` features string (`width=480,height=640,popup`) the way Chromium does, loosely. */
export function parseFeatures(features: string | null | undefined): OpenFeatures {
  const out: OpenFeatures = { popup: false, noopener: false };
  for (const part of String(features ?? "").split(/[,\s]+/)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    const raw = (eq < 0 ? "" : part.slice(eq + 1)).trim().toLowerCase();
    if (key === "width" || key === "innerwidth" || key === "height" || key === "innerheight") {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) out[key.endsWith("width") ? "width" : "height"] = n;
    } else if (key === "popup") out.popup = TRUE_WORDS.has(raw);
    else if (key === "noopener") out.noopener = TRUE_WORDS.has(raw);
  }
  return out;
}

/** Scheme and host only — what a log may keep. Paths and queries can carry OAuth codes and are never returned. */
export function urlParts(url: string): { scheme: string; host: string } {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(/:$/, ""), host: u.hostname };
  } catch {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    return { scheme: m ? m[1].toLowerCase() : "", host: "" };
  }
}

/** R149 — only web pages, plus the empty page OAuth popups start on before they navigate. */
export function isOpenableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return !!u.hostname;
    return u.protocol === "about:" && u.pathname === "blank";
  } catch {
    return false;
  }
}

export interface OpenRequest {
  url: string;
  features: string;
  disposition: OpenDisposition;
  /** The opener is in front of the user: the account's Muse window while shown, or any popup/tab (R148). */
  interactive: boolean;
  openTabs: number;
  openPopups: number;
}

export type OpenDecision =
  | { kind: "deny"; reason: "hidden" | "scheme" | "limit"; scheme: string; host: string }
  | { kind: "popup"; width: number; height: number; scheme: string; host: string }
  | { kind: "tab"; background: boolean; scheme: string; host: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** R148–R153 — what to do with one `window.open` / `target=_blank` of an account page. */
export function decideWindowOpen(req: OpenRequest): OpenDecision {
  const where = urlParts(req.url);
  if (!req.interactive) return { kind: "deny", reason: "hidden", ...where };
  if (!isOpenableUrl(req.url)) return { kind: "deny", reason: "scheme", ...where };
  const f = parseFeatures(req.features);
  const popup = f.width !== undefined || f.height !== undefined || f.popup;
  if (popup) {
    if (req.openPopups >= EXTRA_LIMITS.popups) return { kind: "deny", reason: "limit", ...where };
    return {
      kind: "popup",
      width: clamp(f.width ?? POPUP_DEFAULT.width, POPUP_CLAMP.minWidth, POPUP_CLAMP.maxWidth),
      height: clamp(f.height ?? POPUP_DEFAULT.height, POPUP_CLAMP.minHeight, POPUP_CLAMP.maxHeight),
      ...where,
    };
  }
  if (req.openTabs >= EXTRA_LIMITS.tabs) return { kind: "deny", reason: "limit", ...where };
  return { kind: "tab", background: req.disposition === "background-tab", ...where };
}

/** Keeps a rectangle inside the work area (moved first, shrunk only when it is bigger than the area). */
export function fitInto(r: Rect, work: Rect): Rect {
  const width = Math.min(r.width, work.width);
  const height = Math.min(r.height, work.height);
  const x = clamp(r.x, work.x, work.x + work.width - width);
  const y = clamp(r.y, work.y, work.y + work.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** R150 — a popup sits in the middle of the window that opened it, inside the screen. */
export function popupBounds(size: { width: number; height: number }, parent: Rect | null, work: Rect): Rect {
  const base = parent ?? work;
  return fitInto({ x: base.x + (base.width - size.width) / 2, y: base.y + (base.height - size.height) / 2, width: size.width, height: size.height }, work);
}

/**
 * R150 with the window frame: window.open sizes are the page area, so the popup's outer box is the page plus the frame
 * of the opener's window (same style), and that outer box is what gets centred. Returns the page area to create.
 */
export function popupPlacement(size: { width: number; height: number }, parent: Rect | null, parentContent: Rect | null, work: Rect): Rect {
  const fw = parent && parentContent ? Math.max(0, parent.width - parentContent.width) : 0;
  const fh = parent && parentContent ? Math.max(0, parent.height - parentContent.height) : 0;
  const outer = popupBounds({ width: size.width + fw, height: size.height + fh }, parent, work);
  return { x: outer.x, y: outer.y, width: outer.width - fw, height: outer.height - fh };
}

export const TABS_WINDOW = { width: 1180, height: 820, minWidth: 720, minHeight: 520, offset: 36 } as const;

/** R151 — the extra-pages window: where the user last left it this session, else just below-right of the Muse window. */
export function tabsWindowBounds(parent: Rect | null, work: Rect, last?: Rect | null): Rect {
  if (last) return fitInto(last, work);
  const base = parent ?? { x: work.x + (work.width - TABS_WINDOW.width) / 2, y: work.y + (work.height - TABS_WINDOW.height) / 2, width: TABS_WINDOW.width, height: TABS_WINDOW.height };
  return fitInto({ x: base.x + TABS_WINDOW.offset, y: base.y + TABS_WINDOW.offset, width: TABS_WINDOW.width, height: TABS_WINDOW.height }, work);
}

// ---------------------------------------------------------------- tab order

export interface TabState {
  order: number[];
  active: number | null;
}

export const EMPTY_TABS: TabState = { order: [], active: null };

/** A new tab goes right after the active one; a background tab does not take focus (except as the first tab). */
export function addTab(s: TabState, id: number, background = false): TabState {
  if (s.order.includes(id)) return s;
  const at = s.active === null ? s.order.length : s.order.indexOf(s.active) + 1;
  const order = [...s.order.slice(0, at), id, ...s.order.slice(at)];
  return { order, active: background && s.active !== null ? s.active : id };
}

/** Closing the active tab moves to its right neighbour, else the left one (like a browser). */
export function closeTab(s: TabState, id: number): TabState {
  const i = s.order.indexOf(id);
  if (i < 0) return s;
  const order = s.order.filter((x) => x !== id);
  if (s.active !== id) return { order, active: s.active };
  return { order, active: order.length ? order[Math.min(i, order.length - 1)] : null };
}

export function selectTab(s: TabState, id: number): TabState {
  return s.order.includes(id) ? { order: s.order, active: id } : s;
}

export function cycleTab(s: TabState, dir: 1 | -1): TabState {
  if (s.order.length < 2 || s.active === null) return s;
  const i = s.order.indexOf(s.active);
  return { order: s.order, active: s.order[(i + dir + s.order.length) % s.order.length] };
}

/** R151 — one page looks like the Muse window; the strip appears from two pages up. */
export function stripVisible(tabCount: number): boolean {
  return tabCount >= 2;
}

export function parseStripCommand(title: string): { cmd: "select" | "close"; id: number } | null {
  const m = /^m4t:\d+:(select|close):(\d{1,9})$/.exec(title);
  return m ? { cmd: m[1] as "select" | "close", id: Number(m[2]) } : null;
}

/** The letter shown instead of a favicon (a favicon would have to be fetched; the strip loads nothing — R152). */
export function tabMonogram(host: string): string {
  const h = host.replace(/^www\./i, "");
  const ch = [...h][0];
  return ch ? ch.toUpperCase() : "•";
}

export function windowTitle(pageTitle: string, alias: string, fallback: string): string {
  const t = pageTitle.trim();
  return `${t || fallback} — ${alias}`;
}

export interface KeyInput {
  type: string;
  key: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type TabShortcut = "close" | "next" | "prev" | "back" | "forward" | "reload";

/** R151 keyboard: Ctrl+W, Ctrl+(Shift+)Tab, Alt+←/→, F5 / Ctrl+R. */
export function tabShortcut(i: KeyInput): TabShortcut | null {
  if (i.type !== "keyDown") return null;
  const ctrl = !!(i.control || i.meta);
  const key = i.key.length === 1 ? i.key.toLowerCase() : i.key;
  if (ctrl && !i.alt && key === "w") return "close";
  if (ctrl && !i.alt && key === "Tab") return i.shift ? "prev" : "next";
  if (i.alt && !ctrl && key === "ArrowLeft") return "back";
  if (i.alt && !ctrl && key === "ArrowRight") return "forward";
  if (key === "F5" || (ctrl && !i.alt && key === "r")) return "reload";
  return null;
}
