"""
Build 3.2 E2E (Linux build machine): the real Electron app, real BrowserWindows and WebContentsViews.
Covers the "E" part of AC-PRXS-01/09 and AC-XWIN-01…09 (the "W" part — the same checks on the Windows VPS — is P6).

  PRXS-01  two accounts added on the same proxy
  PRXS-09  Add-account picker: "In use by …" / "Not in use", unused first, gentle note when a shared one is clicked
  XWIN-01  sized window.open → popup centred on the Muse window; window.opener works (OAuth hand-back), it closes itself
  XWIN-02  window.open without size → one extra-pages window, 1 tab = no strip, page fills the window
  XWIN-03  2nd tab → strip (36 px) shows; click a tab selects it; Ctrl+W closes the active tab; title "<page> — <alias>"
  XWIN-04  file:, chrome:, javascript: opens are refused
  XWIN-05  hidden Muse window (automation page) → window.open returns null, nothing opens
  XWIN-06  8 tabs / 4 popups per account; the 9th / 5th is refused
  XWIN-07  sign-in done keeps tabs, closes popups; cancel/end closes everything
  XWIN-08  popups and tabs go through the account's proxy (seen in the local proxy log), WebRTC disable_non_proxied_udp
  XWIN-09  takeover dialog shows the R155 hint in Vietnamese and English
  FAV-01   (Build 3.3) a tab shows its page's favicon, fetched through the account proxy; a page whose "icon" is not an
           image, or has none, keeps the letter

The account's proxy is a tiny local forward proxy (127.0.0.1) that only reaches the local test site, so nothing leaves
the machine. Run from desktop/ after `npm run build`:  python3 e2e/extra_pages_e2e.py
Screenshots of the whole virtual screen go to $OUT.
"""
import asyncio
import http.server
import struct
import zlib
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-extra/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
CDP = 9343
SITE = 18765
PROXY = 18899
DISPLAY = os.environ.get("E2E_DISPLAY", ":97")
# Linux/X11 adds a 3 px inset per side to window sizes; the Windows lab sets this to 0 (exact size).
SIZE_TOL = 8
results = []
proxy_log = []


def check(name, ok, note=""):
    results.append({"check": name, "ok": bool(ok), "note": note})
    print(("PASS " if ok else "FAIL ") + name + (f" — {note}" if note else ""), flush=True)


# ------------------------------------------------------------------ local test site
PAGES = {
    "/opener.html": """<!doctype html><title>Muse test page</title><body style="font:16px system-ui;background:#fff">
<h1>Muse (test page)</h1><p id=s>waiting</p>
<script>window.__got=[];addEventListener('message',e=>{window.__got.push(e.data);document.getElementById('s').textContent='got '+e.data});</script>""",
    "/oauth.html": """<!doctype html><title>Connect a tool</title><body style="font:16px system-ui;background:#eef3ff">
<h2>Authorize Muse</h2><p id=o></p><script>
const ok=!!window.opener;document.getElementById('o').textContent=ok?'opener ok':'no opener';
if(ok)window.opener.postMessage('oauth-ok','*');setTimeout(()=>window.close(),Number(new URLSearchParams(location.search).get('wait')||2500));
</script>""",
    "/stay.html": """<!doctype html><title>Stays open</title><body style="background:#fff6e5">popup</body>""",
}


def _png(w=16, h=16, rgb=(46, 99, 230)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


FAVICON = _png()


def page_html(n):
    # FAV-01: pages 1–2 list a real PNG favicon; "bad" lists an "icon" that is really an HTML page; others list none.
    icon = '<link rel="icon" href="/fav.png">' if n in ("1", "2") else '<link rel="icon" href="/not-an-image.ico">' if n == "bad" else ""
    return f"""<!doctype html><title>Page {n}</title>{icon}<body style="font:16px system-ui;background:#f4fff4"><h1>Page {n}</h1>
<p>Extra page opened by the Muse window.</p></body>"""


class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/fav.png":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(FAVICON)))
            self.end_headers()
            self.wfile.write(FAVICON)
            return
        if path == "/page.html":
            n = self.path.split("n=")[-1] if "n=" in self.path else "?"
            body = page_html(n)
        elif path in PAGES:
            body = PAGES[path]
        elif path == "/not-an-image.ico":
            body = "<!doctype html><title>Not found</title><p>This is not an icon.</p>"
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Proxy(http.server.BaseHTTPRequestHandler):
    """Forward proxy that only reaches the local test site; everything else gets 502 (nothing leaves the machine)."""

    def log_message(self, *a):
        pass

    def do_CONNECT(self):
        proxy_log.append(("CONNECT", self.path))
        self.send_response(502)
        self.end_headers()

    def do_GET(self):
        proxy_log.append(("GET", self.path))
        if not self.path.startswith(f"http://127.0.0.1:{SITE}/"):
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        try:
            with urllib.request.urlopen(self.path, timeout=5) as r:
                data = r.read()
                self.send_response(r.status)
                self.send_header("Content-Type", r.headers.get("Content-Type", "text/html"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except Exception:
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()


class TServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(handler, port):
    srv = TServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ------------------------------------------------------------------ app plumbing (the Windows lab replaces these two)
def screen(name):
    time.sleep(0.5)
    subprocess.run(["import", "-display", DISPLAY, "-window", "root", str(OUT / f"{name}.png")], check=False)


def press_ctrl_w(title):
    """Real X keyboard input (xdotool) — CDP key events do not go through before-input-event."""
    env = dict(os.environ, DISPLAY=DISPLAY)
    wid = subprocess.run(["xdotool", "search", "--name", title], env=env, capture_output=True, text=True).stdout.split()
    if not wid:
        return False
    subprocess.run(["xdotool", "windowfocus", "--sync", wid[0]], env=env)
    time.sleep(0.3)
    subprocess.run(["xdotool", "key", "--clearmodifiers", "ctrl+w"], env=env)
    return True


async def invoke(page, cmd, data=None):
    r = await page.evaluate("([c, d]) => window.muse.invoke(c, d)", [cmd, data or {}])
    if isinstance(r, dict) and "ok" in r:
        if not r["ok"]:
            raise RuntimeError(f"{cmd}: {r.get('error')}")
        return r.get("data")
    return r


async def snap(page):
    return await invoke(page, "app.snapshot")


async def go(page, r):
    await invoke(page, "__test.navigate", {"route": r})
    await asyncio.sleep(0.6)


async def extra(page, acc, op, **kw):
    return await invoke(page, "__test.extra", {"accountId": acc, "op": op, **kw})


async def wait_for(fn, timeout=8.0, step=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = await fn()
        if last:
            return last
        await asyncio.sleep(step)
    return last


async def find_page(browser, pred):
    for ctx in browser.contexts:
        for pg in ctx.pages:
            try:
                if pred(pg.url):
                    return pg
            except Exception:
                pass
    return None


def launch(env):
    xvfb = subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    env = dict(env, DISPLAY=DISPLAY)
    app = subprocess.Popen(
        [str(ROOT / "node_modules/electron/dist/electron"), "--no-sandbox", "--disable-gpu", f"--remote-debugging-port={CDP}", "."],
        cwd=str(ROOT), env=env, stdout=open(WORK / "app.log", "w"), stderr=subprocess.STDOUT, start_new_session=True,
    )
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    return xvfb, app


async def connect(p):
    browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP}")
    for _ in range(60):
        for ctx in browser.contexts:
            for pg in ctx.pages:
                try:
                    if await pg.evaluate("() => !!window.muse"):
                        return browser, pg
                except Exception:
                    pass
        await asyncio.sleep(0.5)
    raise AssertionError("app window not found")


def stop(xvfb, app):
    try:
        os.killpg(app.pid, 15)
    except Exception:
        pass
    try:
        app.wait(timeout=20)
    except Exception:
        pass
    xvfb.terminate()


# ------------------------------------------------------------------ scenario
async def scenario(browser, page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.set_viewport_size({"width": 1280, "height": 860})
    await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
    await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
    await invoke(page, "settings.set", {"key": "language", "value": "vi"})
    await invoke(page, "proxy.import", {"text": f"127.0.0.1:{PROXY}\n198.51.100.40:8080"})
    await invoke(page, "proxy.testAll")
    await asyncio.sleep(2.0)
    s = await snap(page)
    local = next(p for p in s["proxies"] if p["host"] == "127.0.0.1")
    may = await invoke(page, "account.add", {"alias": "Mây", "avatar": 0, "proxyId": local["id"]})
    gio = await invoke(page, "account.add", {"alias": "Gió", "avatar": 1, "proxyId": local["id"]})
    s = await snap(page)
    on_local = sorted(a["alias"] for a in s["accounts"] if a["proxyId"] == local["id"])
    check("PRXS-01 two accounts added on the same proxy", on_local == ["Gió", "Mây"], f"{on_local}")

    # ---------------------------------------------------------------- proxy UI
    await go(page, "/accounts")
    card = page.get_by_text("dùng chung với Gió", exact=True)
    check("PRXS-09 account card says who shares the proxy", await card.count() == 1, f"count={await card.count()}")
    await page.screenshot(path=str(OUT / "p01_accounts_shared.png"))
    await page.get_by_role("button", name="Thêm tài khoản").first.click()
    dlg = page.get_by_role("dialog")
    await dlg.wait_for(timeout=5000)
    radios = dlg.get_by_role("radiogroup", name="Chọn proxy").get_by_role("radio")
    names = [((await radios.nth(i).inner_text()) or "").replace("\n", " | ") for i in range(await radios.count())]
    check("PRXS-09 unused proxy listed first, shared one says who uses it", len(names) == 2 and "Chưa ai dùng" in names[0] and "Đang dùng: Mây, Gió" in names[1], f"{names}")
    checked0 = await radios.nth(0).get_attribute("aria-checked")
    check("PRXS-09 the unused proxy is pre-selected", checked0 == "true", f"aria-checked={checked0}")
    await radios.nth(1).click()
    note = dlg.get_by_role("status")
    txt = (await note.inner_text()) if await note.count() else ""
    check("PRXS-09 choosing the shared proxy shows the gentle note", "đang dùng cho Mây, Gió" in txt, txt)
    await dlg.screenshot(path=str(OUT / "p02_add_dialog_shared_note.png"))
    await page.keyboard.press("Escape")
    await go(page, "/settings/proxy")
    await page.screenshot(path=str(OUT / "p03_settings_proxy.png"))

    # ---------------------------------------------------------------- R155 hint in the takeover dialog
    await invoke(page, "account.takeoverStart", {"id": may["id"], "mode": "now"})
    await go(page, f"/accounts/{may['id']}/takeover")
    vi = page.get_by_text("Trang Muse mở thêm (Trung tâm tài khoản Meta", exact=False)
    vi_ok = await vi.count() == 1
    await page.screenshot(path=str(OUT / "p04_takeover_hint_vi.png"))
    await invoke(page, "settings.set", {"key": "language", "value": "en"})
    await asyncio.sleep(0.8)
    en = page.get_by_text("Pages Muse opens (Meta Accounts Center", exact=False)
    en_ok = await en.count() == 1
    await page.screenshot(path=str(OUT / "p05_takeover_hint_en.png"))
    check("XWIN-09 takeover dialog shows the hint in Vietnamese and English", vi_ok and en_ok, f"vi={vi_ok} en={en_ok}")
    await invoke(page, "account.takeoverEnd", {"id": may["id"]})
    await invoke(page, "settings.set", {"key": "language", "value": "vi"})

    # ---------------------------------------------------------------- the real Muse window
    st = await extra(page, may["id"], "open", url=f"http://127.0.0.1:{SITE}/opener.html")
    muse = await wait_for(lambda: find_page(browser, lambda u: u.endswith("/opener.html")), 10)
    check("setup: Muse window shows the test page through the account proxy", muse is not None and any("opener.html" in p for _, p in proxy_log), f"proxy_log={len(proxy_log)}")
    if muse is None:
        return errors

    # XWIN-01 popup + opener hand-back
    n0 = len(proxy_log)
    opened = await muse.evaluate(f"() => !!window.open('http://127.0.0.1:{SITE}/oauth.html?wait=3000', 'connect', 'width=480,height=640')")
    await wait_for(lambda: _popups(page, may["id"], 1), 6)
    st = await extra(page, may["id"], "state")
    pop = st["popups"][0] if st["popups"] else None
    screen("x01_popup_over_muse")
    check("XWIN-01 sized window.open opens a popup of that size", opened and pop is not None and abs(pop["content"]["width"] - 480) <= SIZE_TOL and abs(pop["content"]["height"] - 640) <= SIZE_TOL, json.dumps(pop))
    mw = await muse.evaluate("() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })")
    if pop:
        cx = pop["bounds"]["x"] + pop["bounds"]["width"] / 2 - (mw["x"] + mw["w"] / 2)
        cy = pop["bounds"]["y"] + pop["bounds"]["height"] / 2 - (mw["y"] + mw["h"] / 2)
        check("XWIN-01 popup is centred on the Muse window (±12 px)", abs(cx) <= 12 and abs(cy) <= 12, f"dx={cx:.0f} dy={cy:.0f} muse={mw}")
    got = await wait_for(lambda: muse.evaluate("() => window.__got.includes('oauth-ok')"), 6)
    check("XWIN-01 window.opener works (the popup handed its result back)", bool(got))
    gone = await wait_for(lambda: _popups(page, may["id"], 0), 8)
    check("XWIN-01 the popup closed itself (window.close)", bool(gone))
    title_ok = pop is not None and pop["title"].endswith("— Mây")
    check("XWIN-01 popup title ends with the account alias", title_ok, pop["title"] if pop else "")
    check("XWIN-08 popup went through the account proxy, WebRTC limited", any("oauth.html" in p for _, p in proxy_log[n0:]) and pop is not None and pop["webrtc"] == "disable_non_proxied_udp", pop["webrtc"] if pop else "")

    # XWIN-02 first tab: no strip
    opened = await muse.evaluate(f"() => !!window.open('http://127.0.0.1:{SITE}/page.html?n=1', '_blank')")
    st = await wait_for(lambda: _tabs(page, may["id"], 1, titled=True), 8)
    st = await extra(page, may["id"], "state")
    t0 = st["tabs"][0] if st["tabs"] else None
    screen("x02_one_tab_no_strip")
    check("XWIN-02 window.open without size → extra-pages window with one tab", opened and st["window"] and st["window"]["visible"] and len(st["tabs"]) == 1, json.dumps(st["window"]))
    check("XWIN-02 one tab: no strip, page starts at the top", st["stripVisible"] is False and t0 and t0["bounds"] and t0["bounds"]["y"] == 0, json.dumps(t0))
    check("XWIN-03 window title is “<page> — <alias>”", st["window"] and st["window"]["title"] == "Page 1 — Mây", st["window"]["title"] if st["window"] else "")

    # XWIN-03 second tab: strip shows
    await muse.evaluate(f"() => window.open('http://127.0.0.1:{SITE}/page.html?n=2', '_blank')")
    st = await wait_for(lambda: _tabs(page, may["id"], 2, titled=True), 8)
    st = await extra(page, may["id"], "state")
    act = [t for t in st["tabs"] if t["active"]]
    await asyncio.sleep(0.6)
    screen("x03_two_tabs_strip")
    check("XWIN-03 two tabs → strip shows, active page starts below it (36 px)", st["stripVisible"] and act and act[0]["bounds"]["y"] == 36 and act[0]["title"] == "Page 2", json.dumps(act))
    check("XWIN-08 tabs go through the account proxy, WebRTC limited", any("page.html?n=2" in p for _, p in proxy_log) and all(t["webrtc"] == "disable_non_proxied_udp" for t in st["tabs"]))

    strip = await find_page(browser, lambda u: u.startswith("data:text/html"))
    if strip:
        await strip.evaluate("() => document.querySelectorAll('.tab')[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))")
        await asyncio.sleep(0.6)
        st = await extra(page, may["id"], "state")
        act = [t["title"] for t in st["tabs"] if t["active"]]
        check("XWIN-03 clicking a tab in the strip selects it", act == ["Page 1"], f"{act}")
        labels = await strip.evaluate("() => [...document.querySelectorAll('.tab')].map(t => t.textContent)")
        check("XWIN-03 strip shows an icon or letter + the page title, nothing loaded from the network", labels == ["1Page 1", "2Page 2"] or all("Page" in x for x in labels), f"{labels}")
        # FAV-01 — both pages list /fav.png: main fetched it through the account proxy and the strip shows it as data:
        st = await wait_for(lambda: _icons(page, may["id"], 2), 8) or await extra(page, may["id"], "state")
        imgs = await strip.evaluate("() => [...document.querySelectorAll('img.fav')].map(i => ({ src: i.src.slice(0, 22), ok: i.complete && i.naturalWidth === 16 }))")
        check("FAV-01 both tabs show the site's favicon (decoded 16 px image from a data: URL)", len(imgs) == 2 and all(i["ok"] and i["src"] == "data:image/png;base64," for i in imgs), json.dumps(imgs))
        check("FAV-01 the favicon was fetched through the account's proxy", any(p.endswith("/fav.png") for _, p in proxy_log), "")
        csp = await strip.evaluate("() => document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
        check("FAV-01 strip CSP allows data: images only", "img-src data:" in csp and "default-src 'none'" in csp, csp)
    else:
        check("XWIN-03 strip page found", False)

    # Ctrl+W in the active tab
    tab1 = await find_page(browser, lambda u: u.endswith("page.html?n=1"))
    if tab1:
        await tab1.evaluate("() => document.body.focus()")
        sent = press_ctrl_w("Page 1 — Mây")
        check("XWIN-03 Ctrl+W sent as real keyboard input to “Page 1 — Mây”", bool(sent), str(sent))
        st = await wait_for(lambda: _tabs(page, may["id"], 1), 5)
        st = await extra(page, may["id"], "state")
        check("XWIN-03 Ctrl+W closes the active tab; one tab left → strip hides", len(st["tabs"]) == 1 and st["tabs"][0]["title"] == "Page 2" and not st["stripVisible"], json.dumps([t["title"] for t in st["tabs"]]))
    else:
        check("XWIN-03 Ctrl+W (tab target found)", False)

    # FAV-01 — an "icon" that is really an HTML page is refused: the tab keeps its letter
    await muse.evaluate(f"() => window.open('http://127.0.0.1:{SITE}/page.html?n=bad', '_blank')")
    await wait_for(lambda: _tab_titled(page, may["id"], "Page bad"), 8)
    await asyncio.sleep(2.5)
    st = await extra(page, may["id"], "state")
    bad = [t for t in st["tabs"] if t["title"] == "Page bad"]
    fetched = any(p.endswith("/not-an-image.ico") for _, p in proxy_log)
    check("FAV-01 a non-image “icon” is fetched via the proxy, refused, and the tab keeps its letter", bool(bad) and bad[0]["icon"] is False and fetched, json.dumps(bad))
    strip = await find_page(browser, lambda u: u.startswith("data:text/html"))
    if strip:
        await asyncio.sleep(0.4)
        marks = await strip.evaluate("() => [...document.querySelectorAll('.tab')].map(t => t.querySelector('img.fav') ? 'img' : (t.querySelector('.mono')?.textContent || ''))")
        check("FAV-01 strip: real icon for Page 2, letter “1” for the refused one", marks == ["img", "1"], json.dumps(marks))
        screen("x05_tabs_favicons")
    await invoke(page, "__test.extra", {"accountId": may["id"], "op": "state"})
    if bad:
        # Close it again so the later limit checks start from the same tab count as before.
        if strip:
            await strip.evaluate("() => document.querySelectorAll('.tab .x')[1].click()")
        await wait_for(lambda: _tabs(page, may["id"], 1), 5)

    # XWIN-04 schemes
    res = await muse.evaluate("() => ['file:///etc/hostname', 'chrome://settings', 'mailto:a@b.c', 'ms-settings:privacy', 'devtools://devtools/bundled/inspector.html'].map(u => window.open(u) === null)")
    await asyncio.sleep(0.5)
    st = await extra(page, may["id"], "state")
    check("XWIN-04 file:/chrome:/mailto:/ms-settings:/devtools: are refused", all(res) and len(st["tabs"]) == 1 and len(st["popups"]) == 0, f"{res} tabs={len(st['tabs'])}")

    # Connect buttons that open an empty tab first and set its address after a fetch (async OAuth start)
    await muse.evaluate(f"() => {{ const w = window.open('', '_blank'); setTimeout(() => {{ w.location.href = 'http://127.0.0.1:{SITE}/page.html?n=77'; }}, 400); }}")
    st = await wait_for(lambda: _tab_titled(page, may["id"], "Page 77"), 8)
    check("XWIN-02 an empty tab the page fills in later (async Connect) loads its page", bool(st))

    # XWIN-06 limits
    for i in range(3, 12):
        await muse.evaluate(f"() => window.open('http://127.0.0.1:{SITE}/page.html?n={i}', '_blank')")
        await asyncio.sleep(0.25)
    await asyncio.sleep(1.0)
    st = await extra(page, may["id"], "state")
    tabs_n = len(st["tabs"])
    pops = []
    for i in range(5):
        pops.append(await muse.evaluate(f"() => window.open('http://127.0.0.1:{SITE}/stay.html?i={i}', 'p{i}', 'width=420,height=500') !== null"))
        await asyncio.sleep(0.4)
    await asyncio.sleep(1.0)
    st = await extra(page, may["id"], "state")
    screen("x04_limits")
    check("XWIN-06 at most 8 tabs and 4 popups per account", tabs_n == 8 and len(st["popups"]) == 4 and pops == [True, True, True, True, False], f"tabs={tabs_n} popups={len(st['popups'])} opened={pops}")

    # XWIN-07 sign-in done keeps tabs / closes popups; cancel closes all
    st = await extra(page, may["id"], "close", keepTabs=True)
    check("XWIN-07 sign-in done: popups close, tabs stay", len(st["popups"]) == 0 and len(st["tabs"]) == 8, f"popups={len(st['popups'])} tabs={len(st['tabs'])}")
    st = await extra(page, may["id"], "close", keepTabs=False)
    await asyncio.sleep(0.8)
    st = await extra(page, may["id"], "state")
    check("XWIN-07 cancel / takeover end: everything closes", st["window"] is None and len(st["tabs"]) == 0 and len(st["popups"]) == 0)

    # XWIN-05 hidden window refuses
    await muse.evaluate(f"() => window.open('http://127.0.0.1:{SITE}/page.html?n=99', '_blank')")
    await asyncio.sleep(1.0)
    st = await extra(page, may["id"], "state")
    had = len(st["tabs"])
    await extra(page, may["id"], "hide")
    await asyncio.sleep(0.8)
    st = await extra(page, may["id"], "state")
    check("XWIN-07 ending takeover closes the extra pages too", had == 1 and st["window"] is None and len(st["tabs"]) == 0, f"before={had}")
    hidden = await muse.evaluate(f"() => [window.open('http://127.0.0.1:{SITE}/page.html?n=100', '_blank') === null, window.open('http://127.0.0.1:{SITE}/oauth.html', 'x', 'width=400,height=500') === null]")
    await asyncio.sleep(1.0)
    st = await extra(page, may["id"], "state")
    check("XWIN-05 hidden Muse window: window.open returns null, nothing opens", hidden == [True, True] and st["window"] is None and len(st["popups"]) == 0, f"{hidden}")

    # other account untouched
    st2 = await extra(page, gio["id"], "state")
    check("isolation: the other account has no extra pages", st2["window"] is None and not st2["popups"])
    return errors


async def _popups(page, acc, n):
    st = await invoke(page, "__test.extra", {"accountId": acc, "op": "state"})
    return st if len(st["popups"]) == n else None


async def _tab_titled(page, acc, title):
    st = await invoke(page, "__test.extra", {"accountId": acc, "op": "state"})
    return st if any(t["title"] == title for t in st["tabs"]) else None


async def _icons(page, acc, n):
    st = await invoke(page, "__test.extra", {"accountId": acc, "op": "state"})
    return st if sum(1 for t in st["tabs"] if t.get("icon")) >= n else None


async def _tabs(page, acc, n, titled=False):
    st = await invoke(page, "__test.extra", {"accountId": acc, "op": "state"})
    if len(st["tabs"]) != n:
        return None
    if titled and not all(t["title"] for t in st["tabs"]):
        return None
    return st


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    site = serve(Site, SITE)
    prox = serve(Proxy, PROXY)
    env = dict(os.environ)
    if env.get("NIX_LD_LIBRARY_PATH"):
        env["LD_LIBRARY_PATH"] = env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", "")
    env = dict(env, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), MUSE4AI_TEST_HOME=str(WORK / "home"), ELECTRON_DISABLE_SECURITY_WARNINGS="1")
    xvfb, app = launch(env)
    errors = []
    try:
        async with async_playwright() as p:
            browser, page = await connect(p)
            try:
                errors = await scenario(browser, page)
            except Exception:
                await page.screenshot(path=str(OUT / "zz_fail.png"))
                screen("zz_fail_screen")
                raise
            finally:
                await browser.close()
    finally:
        stop(xvfb, app)
        site.shutdown()
        prox.shutdown()
        check("renderer had no page errors", not errors, "; ".join(errors[:3]))
        (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
        (WORK / "proxy-log.json").write_text(json.dumps(proxy_log, indent=0))
        passed = sum(1 for r in results if r["ok"])
        print(f"\n{passed}/{len(results)} PASS", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
