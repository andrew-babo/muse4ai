import { describe, expect, it } from "vitest";
import {
  addTab,
  closeTab,
  cycleTab,
  decideWindowOpen,
  EMPTY_TABS,
  EXTRA_LIMITS,
  isOpenableUrl,
  parseFeatures,
  parseStripCommand,
  popupBounds,
  popupPlacement,
  selectTab,
  STRIP_CSP,
  stripVisible,
  tabMonogram,
  tabShortcut,
  tabsWindowBounds,
  urlParts,
  windowTitle,
  type OpenRequest,
} from "../src/shared/extraPages";

// Build 3.2 — pure rules behind the Muse window's popups and tabs (Spec AC-XWIN-*). The Electron wiring itself is
// checked in the isolated Windows lab; these tests pin the values the user agreed to.

const req = (over: Partial<OpenRequest>): OpenRequest => ({
  url: "https://accounts.example.com/oauth/authorize?code=SECRET",
  features: "",
  disposition: "foreground-tab",
  interactive: true,
  openTabs: 0,
  openPopups: 0,
  ...over,
});

const WORK = { x: 0, y: 0, width: 1920, height: 1040 };

describe("which window.open calls open — AC-XWIN-01/02/04/05", () => {
  it("AC-XWIN-01: a sized window.open becomes a popup of the requested size", () => {
    const d = decideWindowOpen(req({ features: "width=480,height=640", disposition: "new-window" }));
    expect(d).toMatchObject({ kind: "popup", width: 480, height: 640 });
  });

  it("AC-XWIN-01: popup size is clamped to 360–1000 × 400–900 and defaults to 520 × 720", () => {
    expect(decideWindowOpen(req({ features: "width=120,height=2000" }))).toMatchObject({ kind: "popup", width: 360, height: 900 });
    expect(decideWindowOpen(req({ features: "width=3000,height=10" }))).toMatchObject({ kind: "popup", width: 1000, height: 400 });
    expect(decideWindowOpen(req({ features: "popup" }))).toMatchObject({ kind: "popup", width: 520, height: 720 });
  });

  it("AC-XWIN-02: a link with target=_blank (no size) becomes a tab; a background click stays in the background", () => {
    expect(decideWindowOpen(req({ disposition: "foreground-tab" }))).toMatchObject({ kind: "tab", background: false });
    expect(decideWindowOpen(req({ disposition: "background-tab" }))).toMatchObject({ kind: "tab", background: true });
    expect(decideWindowOpen(req({ disposition: "new-window" }))).toMatchObject({ kind: "tab", background: false });
  });

  it("AC-XWIN-02: pages of any web site open (MCP Connect goes to Notion, Google…), not only Meta's", () => {
    for (const url of ["https://www.notion.so/install-integration", "https://accounts.google.com/o/oauth2/v2/auth", "http://localhost:3000/callback", "about:blank"]) {
      expect(decideWindowOpen(req({ url })).kind).toBe("tab");
    }
  });

  it("AC-XWIN-04: non-web schemes are refused", () => {
    for (const url of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "chrome://settings", "ms-settings:privacy", "mailto:a@b.c", "data:text/html,hi", "about:settings", "devtools://devtools/x"]) {
      expect(isOpenableUrl(url)).toBe(false);
      expect(decideWindowOpen(req({ url }))).toMatchObject({ kind: "deny", reason: "scheme" });
    }
  });

  it("AC-XWIN-05: nothing opens while the Muse window is hidden (an automation page)", () => {
    expect(decideWindowOpen(req({ interactive: false }))).toMatchObject({ kind: "deny", reason: "hidden" });
    expect(decideWindowOpen(req({ interactive: false, features: "width=500,height=600" }))).toMatchObject({ kind: "deny", reason: "hidden" });
  });

  it("AC-XWIN-06: at most 8 tabs and 4 popups per account", () => {
    expect(EXTRA_LIMITS).toEqual({ tabs: 8, popups: 4 });
    expect(decideWindowOpen(req({ openTabs: 7 })).kind).toBe("tab");
    expect(decideWindowOpen(req({ openTabs: 8 }))).toMatchObject({ kind: "deny", reason: "limit" });
    expect(decideWindowOpen(req({ features: "width=500,height=600", openPopups: 3 })).kind).toBe("popup");
    expect(decideWindowOpen(req({ features: "width=500,height=600", openPopups: 4 }))).toMatchObject({ kind: "deny", reason: "limit" });
    // Popups do not count against tabs, and the other way round.
    expect(decideWindowOpen(req({ features: "width=500,height=600", openTabs: 8 })).kind).toBe("popup");
  });

  it("R149: what may be logged is the scheme and host only — never the path or query", () => {
    const d = decideWindowOpen(req({ interactive: false }));
    expect(d).toEqual({ kind: "deny", reason: "hidden", scheme: "https", host: "accounts.example.com" });
    expect(JSON.stringify(d)).not.toContain("SECRET");
    expect(urlParts("ms-settings:privacy?x=1")).toEqual({ scheme: "ms-settings", host: "" });
  });

  it("reads window.open features loosely, like Chromium", () => {
    expect(parseFeatures("width=480, height=640 ,popup")).toEqual({ width: 480, height: 640, popup: true, noopener: false });
    expect(parseFeatures("innerWidth=600,innerHeight=500,noopener")).toEqual({ width: 600, height: 500, popup: false, noopener: true });
    expect(parseFeatures("width=abc,popup=0")).toEqual({ popup: false, noopener: false });
    expect(parseFeatures(undefined)).toEqual({ popup: false, noopener: false });
  });
});

describe("where the windows go — AC-XWIN-01/02", () => {
  it("a popup is centred on the Muse window", () => {
    expect(popupBounds({ width: 520, height: 720 }, { x: 100, y: 50, width: 1280, height: 860 }, WORK)).toEqual({ x: 480, y: 120, width: 520, height: 720 });
  });

  it("a popup stays on screen when the Muse window is near an edge, and shrinks only on a small screen", () => {
    expect(popupBounds({ width: 520, height: 720 }, { x: 1700, y: 600, width: 600, height: 500 }, WORK)).toEqual({ x: 1400, y: 320, width: 520, height: 720 });
    expect(popupBounds({ width: 1000, height: 900 }, null, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("the popup's outer box (page + the opener's frame) is what gets centred; the page keeps the requested size", () => {
    // Windows: a 1280×860 window at (0, 62) with a 16×39 frame; the page asks for 480×640.
    const parent = { x: 0, y: 62, width: 1280, height: 860 };
    const content = { x: 8, y: 93, width: 1264, height: 821 };
    const p = popupPlacement({ width: 480, height: 640 }, parent, content, WORK);
    expect(p).toEqual({ x: 392, y: 153, width: 480, height: 640 });
    // outer = 496 × 679 → its centre equals the Muse window's centre
    expect(p.x + (480 + 16) / 2).toBe(parent.x + parent.width / 2);
    expect(Math.abs(p.y + (640 + 39) / 2 - (parent.y + parent.height / 2))).toBeLessThanOrEqual(1);
    // No parent: centred on the screen, frame unknown → page size as asked.
    expect(popupPlacement({ width: 480, height: 640 }, null, null, WORK)).toEqual({ x: 720, y: 200, width: 480, height: 640 });
  });

  it("the extra-pages window opens just below-right of the Muse window, or where the user left it", () => {
    expect(tabsWindowBounds({ x: 100, y: 50, width: 1280, height: 860 }, WORK)).toEqual({ x: 136, y: 86, width: 1180, height: 820 });
    expect(tabsWindowBounds(null, WORK, { x: 300, y: 200, width: 900, height: 700 })).toEqual({ x: 300, y: 200, width: 900, height: 700 });
    expect(tabsWindowBounds(null, WORK, { x: 1800, y: 900, width: 900, height: 700 })).toEqual({ x: 1020, y: 340, width: 900, height: 700 });
  });
});

describe("tabs — AC-XWIN-03", () => {
  it("the tab strip shows only from two pages up", () => {
    expect(stripVisible(0)).toBe(false);
    expect(stripVisible(1)).toBe(false);
    expect(stripVisible(2)).toBe(true);
  });

  it("a new tab goes right after the active one and becomes active; a background tab does not", () => {
    let s = addTab(EMPTY_TABS, 1);
    s = addTab(s, 2);
    s = selectTab(s, 1);
    s = addTab(s, 3);
    expect(s).toEqual({ order: [1, 3, 2], active: 3 });
    s = addTab(s, 4, true);
    expect(s).toEqual({ order: [1, 3, 4, 2], active: 3 });
    expect(addTab(EMPTY_TABS, 9, true)).toEqual({ order: [9], active: 9 });
  });

  it("closing the active tab moves to its right neighbour, else the left one", () => {
    const s = { order: [1, 2, 3], active: 2 };
    expect(closeTab(s, 2)).toEqual({ order: [1, 3], active: 3 });
    expect(closeTab({ order: [1, 2, 3], active: 3 }, 3)).toEqual({ order: [1, 2], active: 2 });
    expect(closeTab(s, 1)).toEqual({ order: [2, 3], active: 2 });
    expect(closeTab({ order: [5], active: 5 }, 5)).toEqual({ order: [], active: null });
  });

  it("Ctrl+Tab / Ctrl+Shift+Tab cycle around", () => {
    const s = { order: [1, 2, 3], active: 3 };
    expect(cycleTab(s, 1).active).toBe(1);
    expect(cycleTab(s, -1).active).toBe(2);
    expect(cycleTab({ order: [1], active: 1 }, 1).active).toBe(1);
  });

  it("keyboard: Ctrl+W, Ctrl+(Shift+)Tab, Alt+←/→, F5 / Ctrl+R — keyDown only", () => {
    expect(tabShortcut({ type: "keyDown", key: "w", control: true })).toBe("close");
    expect(tabShortcut({ type: "keyDown", key: "W", control: true, shift: true })).toBe("close");
    expect(tabShortcut({ type: "keyDown", key: "Tab", control: true })).toBe("next");
    expect(tabShortcut({ type: "keyDown", key: "Tab", control: true, shift: true })).toBe("prev");
    expect(tabShortcut({ type: "keyDown", key: "ArrowLeft", alt: true })).toBe("back");
    expect(tabShortcut({ type: "keyDown", key: "ArrowRight", alt: true })).toBe("forward");
    expect(tabShortcut({ type: "keyDown", key: "F5" })).toBe("reload");
    expect(tabShortcut({ type: "keyDown", key: "r", control: true })).toBe("reload");
    expect(tabShortcut({ type: "keyUp", key: "w", control: true })).toBeNull();
    expect(tabShortcut({ type: "keyDown", key: "w" })).toBeNull();
    expect(tabShortcut({ type: "keyDown", key: "ArrowLeft" })).toBeNull();
    expect(tabShortcut({ type: "keyDown", key: "w", control: true, alt: true })).toBeNull();
  });

  it("strip messages are strict: only select/close with a numeric id", () => {
    expect(parseStripCommand("m4t:7:select:12")).toEqual({ cmd: "select", id: 12 });
    expect(parseStripCommand("m4t:8:close:3")).toEqual({ cmd: "close", id: 3 });
    for (const bad of ["m4t:1:navigate:3", "m4t:select:3", "x m4t:1:close:3", "m4t:1:close:3;rm", "m4t:1:close:-3", "m4t"]) expect(parseStripCommand(bad)).toBeNull();
  });

  it("tab letters and window titles", () => {
    expect(tabMonogram("www.notion.so")).toBe("N");
    expect(tabMonogram("business.facebook.com")).toBe("B");
    expect(tabMonogram("")).toBe("•");
    expect(windowTitle("Meta Business Suite", "Mây", "Đang tải…")).toBe("Meta Business Suite — Mây");
    expect(windowTitle("  ", "Mây", "Đang tải…")).toBe("Đang tải… — Mây");
  });
});

// Build 3.3 AC-FAV-01 — the tab's real icon, fetched through the account's session; only real images ≤ 64 KiB.
import { faviconDataUrl, FAVICON_MAX_BYTES, pickFavicon, sniffFavicon } from "../src/shared/extraPages";

describe("favicons (AC-FAV-01)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
  const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>');
  it("picks the first web URL, or an inline image, and ignores other schemes", () => {
    expect(pickFavicon(["file:///C:/x.ico", "https://accounts.example.com/favicon.ico", "http://x/y.png"])).toEqual({ kind: "fetch", url: "https://accounts.example.com/favicon.ico" });
    expect(pickFavicon(["chrome://favicon/x", "blob:https://x/1"])).toBeNull();
    expect(pickFavicon(["https://user:pw@example.com/f.ico"])).toBeNull();
    const inline = pickFavicon([`data:image/png;base64,${btoa(String.fromCharCode(...png))}`]);
    expect(inline?.kind).toBe("inline");
  });
  it("recognises real images by their bytes, not by the server's label", () => {
    expect(sniffFavicon(png)).toBe("image/png");
    expect(sniffFavicon(ico)).toBe("image/x-icon");
    expect(sniffFavicon(svg)).toBe("image/svg+xml");
    expect(sniffFavicon(new TextEncoder().encode("<!doctype html><html>404</html>"))).toBeNull();
  });
  it("re-encodes an accepted icon as a data: URL and refuses oversized or unknown bytes", () => {
    expect(faviconDataUrl(png)).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
    expect(faviconDataUrl(new Uint8Array(FAVICON_MAX_BYTES + 1).fill(0x89))).toBeNull();
    expect(faviconDataUrl(new TextEncoder().encode("hello"))).toBeNull();
    expect(FAVICON_MAX_BYTES).toBe(64 * 1024);
  });
});

describe("tab strip CSP (AC-FAV-01)", () => {
  it("lets the strip show data: images and nothing that reaches the network", () => {
    const d: Record<string, string[]> = Object.fromEntries(STRIP_CSP.split(";").map((p: string) => p.trim().split(/\s+/)).map(([k, ...v]: string[]) => [k, v]));
    expect(d["default-src"]).toEqual(["'none'"]);
    expect(d["img-src"]).toEqual(["data:"]);
    expect(STRIP_CSP).not.toMatch(/https?:|\*|connect-src|'self'/);
  });
});
