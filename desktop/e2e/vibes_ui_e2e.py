"""
Phase 10 E2E (Linux build machine): real Electron app (main process, SQLite, media probe, renderer), fake Muse and
fake Vibes (rules B38 — no network to Meta). Covers the rev 6 screens: S07 two-site rows + ⋯ Vibes items, S07c2
two-step login, sidebar amber dot, Composer “Nơi tạo”, S06e Kéo dài sheet, chain card (S02/S04), S03-chain drawer,
S06b lineage, S06-chain tile, Settings max steps, Vibes UI-changed banner, Esc on stacked overlays, 1024 × 728.

Run from desktop/ after `npm run build`:
  . /tmp/electron-env.sh && python3 e2e/vibes_ui_e2e.py
Needs xvfb-run, Python Playwright, and fixtures in $FIXTURES: vibes-<n>s.mp4 (n = 5…60 step 5) plus one PNG/JPEG, e.g.
  for s in 5 10 … 60; do ffmpeg -f lavfi -i testsrc=size=360x640:rate=24:duration=$s -f lavfi -i sine=duration=$s \
    -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -shortest vibes-${s}s.mp4; done
  ffmpeg -f lavfi -i testsrc=size=1024x1024 -frames:v 1 img-1.png
"""
import asyncio
import re
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-vibes/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
FIXTURES = os.environ.get("FIXTURES", "/tmp/e2e-vibes/fixtures")
PORT = 9334
results = []


def check(name, ok, note=""):
    results.append({"check": name, "ok": bool(ok), "note": note})
    print(("PASS " if ok else "FAIL ") + name + (f" — {note}" if note else ""), flush=True)


async def shot(page, name):
    await asyncio.sleep(0.25)
    await page.screenshot(path=str(OUT / f"{name}.png"))


async def invoke(page, cmd, data=None):
    r = await page.evaluate("([c, d]) => window.muse.invoke(c, d)", [cmd, data or {}])
    if isinstance(r, dict) and "ok" in r:
        if not r["ok"]:
            raise RuntimeError(f"{cmd}: {r.get('error')}")
        return r.get("data")
    return r


async def snap(page):
    return await invoke(page, "app.snapshot")


async def account(page, alias):
    s = await snap(page)
    return next(a for a in s["accounts"] if a["alias"] == alias)


async def wait_until(fn, timeout=60, every=0.4):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = await fn()
        if last:
            return last
        await asyncio.sleep(every)
    return last


async def no_hscroll(page):
    return await page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")


async def go(page, route):
    await invoke(page, "__test.navigate", {"route": route})
    await asyncio.sleep(0.4)


def launch(env, log_name):
    if env.get("NIX_LD_LIBRARY_PATH") and env["NIX_LD_LIBRARY_PATH"] not in env.get("LD_LIBRARY_PATH", ""):  # nix machines keep Chromium's libraries here
        env = dict(env, LD_LIBRARY_PATH=env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", ""))
    app = subprocess.Popen(
        ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", str(ROOT / "node_modules/electron/dist/electron"), "--no-sandbox", f"--remote-debugging-port={PORT}", "."],
        cwd=str(ROOT), env=env, stdout=open(WORK / log_name, "w"), stderr=subprocess.STDOUT, start_new_session=True,
    )
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    return app


async def connect(p):
    browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
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


def stop(app, sig=15):
    try:
        os.killpg(app.pid, sig)
    except Exception:
        pass
    try:
        app.wait(timeout=20)
    except Exception:
        pass
    # The CDP port must be free before the next launch.
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=0.5)
            time.sleep(0.5)
        except Exception:
            return


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(
        os.environ,
        MUSE4AI_TEST="1",
        MUSE4AI_DATA=str(WORK / "data"),
        MUSE4AI_FIXTURES=FIXTURES,
        MUSE4AI_FAKE_GEN_MS="1500",
        MUSE4AI_FAKE_LOGIN_MS="3500",
        ELECTRON_DISABLE_SECURITY_WARNINGS="1",
    )
    app = launch(env, "app.log")
    phase = "ui"
    try:
        async with async_playwright() as p:
            browser, page = await connect(p)
            try:
                state = await scenario(page)
                await browser.close()
                stop(app)
                # ---------------- Crash during a chain step → restart → reconcile, never resend (AC-EXT-09/10)
                phase = "crash"
                env2 = dict(env, MUSE4AI_FAKE_GEN_MS="6000", MUSE4AI_TEST_VERIFIED="vibes.video.text,vibes.video.reference,vibes.video.extend")
                app = launch(env2, "app-crash-1.log")
                browser, page = await connect(p)
                await crash_scenario(p, page, state, env2, app)
            except Exception:
                try:
                    pages = [pg for ctx in browser.contexts for pg in ctx.pages]
                    pg = pages[0] if pages else page
                    await pg.screenshot(path=str(OUT / f"zz_fail_{phase}.png"))
                    print("TOASTS:", await pg.locator('[role="status"], [role="alert"]').all_inner_texts(), flush=True)
                except Exception:
                    pass
                raise
    finally:
        stop(app)
        if CURRENT_APP:
            stop(CURRENT_APP)
        (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
        passed = sum(1 for r in results if r["ok"])
        print(f"\n{passed}/{len(results)} PASS", flush=True)


def batch_files():
    roaming = WORK / "data"
    found = [f for f in roaming.rglob("test-vibes-*.json") if not f.name.endswith(".me.json")]
    total = {}
    for f in found:
        total.update(json.loads(f.read_text() or "{}"))
    return total


async def crash_scenario(p, page, state, env, app):
    global CURRENT_APP
    root_asset = state["rootAssetId"]
    before = batch_files()
    r = await invoke(page, "extend.start", {"assetId": root_asset, "mode": "auto", "directive": None, "plan": {"type": "steps", "value": 2}, "clientRequestId": "e2e-crash-chain-0001"})
    chain_id = r["chain"]["id"] if isinstance(r, dict) and "chain" in r else r["id"]

    async def step1_sent():
        d = await invoke(page, "chain.get", {"id": chain_id})
        st = d["steps"][0]["state"] if d["steps"] else None
        return d if st in ("submitted", "generating") and len(batch_files()) == len(before) + 1 else None
    d = await wait_until(step1_sent, 30, 0.2)
    check("Crash: chain step 1 accepted by Vibes before the crash", bool(d), d["steps"][0]["state"] if d else "")
    sent_before_crash = len(batch_files())
    # Hard kill (no graceful quit): the whole process group dies like a power cut.
    stop(app, 9)
    app2 = launch(env, "app-crash-2.log")
    CURRENT_APP = app2
    browser2, page2 = await connect(p)

    async def chain_end():
        dd = await invoke(page2, "chain.get", {"id": chain_id})
        return dd if dd["chain"]["status"] in ("completed", "stopped", "needs_review") else None
    d2 = await wait_until(chain_end, 90)
    steps = d2["steps"] if d2 else []
    check("Crash: after restart the chain finishes (Đã kéo dài 2 lần)", bool(d2) and d2["chain"]["status"] == "completed" and d2["chain"]["stepsDone"] == 2,
          json.dumps({k: d2["chain"].get(k) for k in ("status", "stepsDone", "reason", "lastDurationMs")} if d2 else {}, ensure_ascii=False))
    after = batch_files()
    check("Crash: step 1 reconciled, not resent — Vibes saw exactly 2 extend requests", len(after) - len(before) == 2, f"{len(before)} → {sent_before_crash} → {len(after)}")
    check("Crash: lengths grow 10 → 15 s", [s.get("durationMs") for s in steps] == [10000, 15000], str([s.get("durationMs") for s in steps]))
    hist = await invoke(page2, "job.get", {"jobId": steps[0]["jobId"]}) if steps and steps[0].get("jobId") else None
    attempts = (hist or {}).get("attempts", [])
    check("Crash: step 1 history shows a reconcile attempt", any(a.get("phase") == "reconcile" for a in attempts), str([a.get("phase") for a in attempts]))
    await go(page2, f"/queue/chain/{chain_id}")
    await page2.get_by_role("dialog", name="Chuỗi kéo dài", exact=False).get_by_text("Lần 2", exact=True).wait_for(timeout=5000)
    await shot(page2, "e10_crash_chain_reconciled")
    await keyboard_scenario(page2, chain_id)
    await browser2.close()


FOCUS_JS = """() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e);
  const art = e.closest('article'); return { text: (e.innerText || '').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || e.tagName.toLowerCase(),
  checked: e.getAttribute('aria-checked'), article: art ? art.getAttribute('aria-label') : null, inStrip: !!e.closest('[aria-label="Chuỗi kéo dài đang chạy"]'),
  ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1.5, fv: e.matches(':focus-visible'), ol: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.boxShadow.slice(0, 40) }; }"""


async def on_top(page, locator, container):
    """True when the centre of `locator` is not covered by anything outside `container` (e.g. a toast)."""
    b = await locator.bounding_box()
    return await page.evaluate("""([b, sel]) => { if (!b) return false; const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!el && !!el.closest(sel); }""", [b, container])


async def focused(page):
    return await page.evaluate(FOCUS_JS)


async def tab_to(page, pred, max_tabs=80):
    """Press Tab until pred(focus) holds; returns the focus info or None (keyboard only)."""
    for _ in range(max_tabs):
        await page.keyboard.press("Tab")
        f = await focused(page)
        if f and pred(f):
            return f
    return None


def me_file(account_id):
    for f in (WORK / "data").rglob(f"test-vibes-{account_id}.me.json"):
        return json.loads(f.read_text())
    return {"status": 200, "body": {"user": {"id": f"test-{account_id[:6]}", "username": "vibes.thu"}}}


async def keyboard_scenario(page, crash_chain_id):
    """AC-VIB-14, AC-VIB-10, AC-EXT-22 — 1024 × 728, keyboard only (setup through test commands)."""
    await page.set_viewport_size({"width": 1024, "height": 728})
    # The window of a headless Electron under Xvfb is not OS-focused; emulate focus so :focus-visible applies.
    cdp = await page.context.new_cdp_session(page)
    await cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
    await invoke(page, "settings.set", {"key": "extendMaxSteps", "value": 20})
    owner_id = (await invoke(page, "chain.get", {"id": crash_chain_id}))["chain"]["accountId"]
    s = await snap(page)
    other = next(a for a in s["accounts"] if a["id"] != owner_id)
    oid, alias = other["id"], other["alias"]
    steady = me_file(oid)
    expired = {"status": 401, "body": {"error": "SessionExpired"}}

    # ---------------- AC-VIB-14: S07 + S07c2 with the keyboard
    await invoke(page, "__test.vibes", {"accountId": oid, "me": [expired]})
    await invoke(page, "account.checkVibes", {"id": oid})
    await go(page, "/accounts")
    await asyncio.sleep(0.6)
    check("VIB-14 accessible row names: “Muse: Sẵn sàng” / “Vibes: Cần đăng nhập lại”",
          await page.get_by_role("group", name="Muse: Sẵn sàng").count() >= 1 and await page.get_by_role("group", name="Vibes: Cần đăng nhập lại").count() == 1)
    check("VIB-14 S07 no horizontal scroll at 1024 × 728", await no_hscroll(page))
    await page.evaluate("() => document.activeElement && document.activeElement.blur()")
    f = await tab_to(page, lambda f: f["text"] == "Đăng nhập Vibes")
    check("VIB-14 Tab reaches “Đăng nhập Vibes” with a visible focus ring", bool(f) and f["ring"], str(f))
    await shot(page, "e10_kbd_accounts_needs_login")
    await page.keyboard.press("Enter")
    dlg = page.get_by_role("dialog", name=f"Đăng nhập tài khoản {alias}")
    await dlg.wait_for(timeout=10000)
    await dlg.get_by_text("Vibes · Đang chờ anh đăng nhập").wait_for(timeout=10000)
    steps_n = await dlg.get_by_role("list", name="Các bước đăng nhập").get_by_role("listitem").count()
    check("VIB-14 Enter on “Đăng nhập Vibes” opens S07c2 with only the Vibes step", steps_n == 1, str(steps_n))
    tb = await page.locator('[role="status"]').first.bounding_box() if await page.locator('[role="status"]').count() else None
    skip_box = await dlg.get_by_role("button", name="Bỏ qua Vibes, dùng Muse trước").bounding_box()
    under = await page.evaluate("""(b) => { if (!b) return true; const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!el && !!el.closest('[role=dialog]'); }""", skip_box)
    check("Toasts never cover the dialog's buttons (skip button is on top)", under, str(tb))
    await shot(page, "e10_kbd_login_vibes_step")
    f = await tab_to(page, lambda f: f["text"] == "Bỏ qua Vibes, dùng Muse trước", 20)
    check("VIB-14 Tab reaches “Bỏ qua Vibes” inside the dialog", bool(f) and f["ring"], str(f))
    await page.keyboard.press("Enter")
    await dlg.wait_for(state="detached", timeout=8000)
    a = next(x for x in (await snap(page))["accounts"] if x["id"] == oid)
    check("VIB-14 skip keeps Muse ready and Vibes as it was", a["state"] == "ready" and a["vibes"]["status"] == "needs_login", f'{a["state"]} / {a["vibes"]["status"]}')
    await invoke(page, "__test.vibes", {"accountId": oid, "me": [steady]})
    f = await tab_to(page, lambda f: f["label"].startswith("Thao tác cho") and (f["article"] or "").startswith(alias))
    check("VIB-14 Tab reaches the card's ⋯ menu", bool(f), str(f))
    await page.keyboard.press("Enter")
    item = None
    for _ in range(12):
        await page.keyboard.press("ArrowDown")
        item = await focused(page)
        if item and item["text"] == "Kiểm phiên Vibes":
            break
    check("VIB-14 arrow keys reach “Kiểm phiên Vibes” in the menu", bool(item) and item["text"] == "Kiểm phiên Vibes", str(item))
    await page.keyboard.press("Enter")
    ok = False
    try:
        await page.get_by_role("group", name="Vibes: Sẵn sàng").nth(1).wait_for(timeout=8000)
        ok = True
    except Exception:
        ok = await page.get_by_role("group", name="Vibes: Sẵn sàng").count() == 2
    check("VIB-14 Kiểm phiên Vibes from the keyboard → “Vibes: Sẵn sàng”", ok)

    # ---------------- AC-VIB-10: “cần đăng nhập lại Vibes” toast clicks
    await invoke(page, "__test.vibes", {"accountId": oid, "me": [expired]})
    await invoke(page, "account.checkVibes", {"id": oid})
    await invoke(page, "__test.activateToast", {"route": f"/accounts/{oid}/login?site=vibes", "fromThisRun": True})
    try:
        await dlg.get_by_text("Vibes · Đang chờ anh đăng nhập").wait_for(timeout=10000)
        opened = True
    except Exception:
        opened = False
    check("VIB-10 toast of this run → S07c2 at the Vibes step of that account", opened)
    if opened:
        await page.keyboard.press("Escape")
        await dlg.wait_for(state="detached", timeout=8000)
    await asyncio.sleep(0.8)
    await invoke(page, "__test.activateToast", {"route": f"/accounts/{oid}/login?site=vibes", "fromThisRun": False})
    await asyncio.sleep(2.5)
    route = (await snap(page)).get("settings", {}).get("lastRoute", "")
    a = next(x for x in (await snap(page))["accounts"] if x["id"] == oid)
    card = page.get_by_role("article", name=f"{alias} — ", exact=False)
    ringed = await card.evaluate("(el) => el.className.includes('ring-2')")
    check("VIB-10 older toast (after a restart) → only the account card, no login window",
          await dlg.count() == 0 and a["state"] != "logging_in" and ringed, f"dialog={await dlg.count()} state={a['state']} ringed={ringed}")
    await shot(page, "e10_toast_old_card_focus")
    await go(page, f"/accounts/{oid}/login?site=vibes")
    try:
        await dlg.get_by_text("Vibes · Đang chờ anh đăng nhập").wait_for(timeout=10000)
        inapp = True
    except Exception:
        inapp = False
    check("VIB-10 in-app “Mở” on the notice → S07c2 at the Vibes step", inapp)
    if inapp:
        await page.keyboard.press("Escape")
        await dlg.wait_for(state="detached", timeout=8000)
    await invoke(page, "__test.vibes", {"accountId": oid, "me": [steady]})
    for _ in range(30):
        try:
            await invoke(page, "account.checkVibes", {"id": oid})
            break
        except RuntimeError:
            await asyncio.sleep(0.5)  # the cancelled login still holds the account for a moment

    # ---------------- AC-EXT-22: Kéo dài sheet → chain → Dừng chuỗi with the keyboard
    await page.keyboard.press("Control+4")
    await asyncio.sleep(0.8)
    await page.evaluate("() => document.activeElement && document.activeElement.blur()")
    f = await tab_to(page, lambda f: f["label"].startswith("Video:"))
    check("EXT-22 Tab reaches a Vibes video tile in the Library", bool(f), str(f))
    await page.keyboard.press("Enter")
    await page.get_by_role("dialog", name="Xem lớn").wait_for(timeout=5000)
    await asyncio.sleep(0.5)
    f = await tab_to(page, lambda f: f["text"] == "Kéo dài video", 30)
    check("EXT-22 Tab reaches “Kéo dài video” in Xem lớn", bool(f) and f["ring"], str(f))
    OPEN_JS = """() => new Promise((resolve) => {
      let t0 = null; const onKey = (e) => { if (e.key === 'Enter' && t0 === null) t0 = performance.now(); };
      window.addEventListener('keydown', onKey, true);
      const tick = () => { const el = document.querySelector('[role="dialog"][aria-label="Kéo dài video"] [data-autofocus]');
        if (t0 !== null && el && document.activeElement === el) { window.removeEventListener('keydown', onKey, true); resolve(performance.now() - t0); } else requestAnimationFrame(tick); };
      requestAnimationFrame(tick); setTimeout(() => resolve(-1), 5000); })"""
    times = []
    for i in range(5):
        if i:
            f = await focused(page)
            if not f or f["text"] != "Kéo dài video":
                await tab_to(page, lambda f: f["text"] == "Kéo dài video", 30)
        task = asyncio.create_task(page.evaluate(OPEN_JS))
        await asyncio.sleep(0.1)
        await page.keyboard.press("Enter")
        times.append(round(await task, 1))
        if i < 4:
            await page.keyboard.press("Escape")
            await page.get_by_role("dialog", name="Kéo dài video").wait_for(state="detached", timeout=4000)
    med = sorted(times)[2]
    check("EXT-22 sheet opens ≤ 150 ms (median of 5, keyboard → form focused)", all(t >= 0 for t in times) and med <= 150, f"{times} ms · median {med}")
    sheet = page.get_by_role("dialog", name="Kéo dài video")
    await page.keyboard.press("ArrowRight")
    f = await focused(page)
    check("EXT-22 → selects “Theo mô tả” with the arrow key", bool(f) and f["text"] == "Theo mô tả" and f["checked"] == "true", str(f))
    await page.keyboard.press("Tab")
    f = await focused(page)
    check("EXT-22 Tab moves to the description", bool(f) and f["label"] == "Mô tả cho các lần kéo dài", str(f))
    await page.keyboard.type("máy quay lùi xa dần")
    f = await tab_to(page, lambda f: f["role"] == "radio" and f["text"] == "Số lần", 5)
    await page.keyboard.press("ArrowRight")
    f = await focused(page)
    check("EXT-22 → selects “Đến khoảng”", bool(f) and f["text"] == "Đến khoảng" and f["checked"] == "true", str(f))
    f = await tab_to(page, lambda f: f["label"] == "số giây", 4)
    await page.keyboard.press("Control+A")
    await page.keyboard.type("30")
    f = await tab_to(page, lambda f: f["text"] == "Bắt đầu kéo dài", 10)
    check("EXT-22 Tab reaches “Bắt đầu kéo dài”", bool(f) and f["ring"], str(f))
    check("EXT-22 no horizontal scroll with the sheet open", await no_hscroll(page))
    sheet_sel = '[role="dialog"][aria-label="Kéo dài video"]'
    check("Toasts never cover the sheet's start button", await on_top(page, page.locator(sheet_sel).get_by_role("button", name="Bắt đầu kéo dài"), sheet_sel))

    await shot(page, "e10_kbd_extend_sheet_directive")
    before_ids = {c["id"] for c in await invoke(page, "chain.list")}
    await page.keyboard.press("Enter")
    await sheet.wait_for(state="detached", timeout=5000)
    new = None
    for _ in range(20):
        new = next((c for c in await invoke(page, "chain.list") if c["id"] not in before_ids), None)
        if new:
            break
        await asyncio.sleep(0.25)
    check("EXT-22 chain started: Theo mô tả, Đến khoảng 30 giây", bool(new) and new["mode"] == "directive" and new["plan"] == {"type": "target", "value": 30},
          json.dumps({k: new.get(k) for k in ("mode", "plan", "status")} if new else {}, ensure_ascii=False))
    await page.get_by_text("Đã bắt đầu chuỗi kéo dài").first.wait_for(timeout=5000)
    strip = page.get_by_role("dialog", name="Xem lớn").get_by_role("navigation", name="Các bản trong chuỗi").get_by_role("button").first
    b = await strip.bounding_box()
    hit = await page.evaluate("""(b) => { const el = b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el ? !el.closest('[data-toasts]') : false; }""", b)
    check("Toasts never cover the lineage strip of Xem lớn (start notice showing)", hit)
    await page.keyboard.press("Escape")  # close Xem lớn
    await asyncio.sleep(0.4)
    await page.keyboard.press("Control+2")
    await page.get_by_role("region", name="Chuỗi kéo dài đang chạy").wait_for(timeout=5000)
    await page.evaluate("() => document.activeElement && document.activeElement.blur()")
    f = await tab_to(page, lambda f: f["label"] == "Mở chi tiết chuỗi" and f["inStrip"], 60)
    check("EXT-22 Tab reaches the running chain in the Queue strip", bool(f) and f["ring"], str(f))
    await page.keyboard.press("Enter")
    drawer = page.get_by_role("dialog", name="Chuỗi kéo dài", exact=False)
    await drawer.wait_for(timeout=5000)
    check("EXT-22 no horizontal scroll with the chain drawer open", await no_hscroll(page))
    check("Toasts never cover the chain drawer's buttons", await on_top(page, drawer.get_by_role("button", name="Dừng chuỗi"), '[role="dialog"]'))
    f = await tab_to(page, lambda f: f["text"] == "Dừng chuỗi", 25)
    check("EXT-22 Tab reaches “Dừng chuỗi” in the drawer", bool(f) and f["ring"], str(f))
    await page.keyboard.press("Enter")
    st = None
    for _ in range(20):
        st = (await invoke(page, "chain.get", {"id": new["id"]}))["chain"]["status"] if new else None
        if st in ("stopped", "cancelled"):
            break
        await asyncio.sleep(0.25)
    check("EXT-22 Dừng chuỗi from the keyboard stops the chain", st in ("stopped", "cancelled"), str(st))
    await asyncio.sleep(0.5)
    await shot(page, "e10_kbd_chain_drawer_stopped")


CURRENT_APP = None


async def scenario(page):
    if True:
        if True:
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1280, "height": 800})
            await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
            await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
            await invoke(page, "proxy.import", {"text": "198.51.100.11:8080:u1:p1\n198.51.100.12:8080:u2:p2\n"})
            await invoke(page, "proxy.testAll")
            await asyncio.sleep(1.5)
            s = await snap(page)
            proxies = [x["id"] for x in s["proxies"]]
            may = await invoke(page, "account.add", {"alias": "Mây", "avatar": 0, "proxyId": proxies[0]})
            gio = await invoke(page, "account.add", {"alias": "Gió", "avatar": 1, "proxyId": proxies[1]})

            # ---------------- S07c2 two-step login (Muse → Vibes), user does both steps
            # Fake Vibes session answers in order: the silent pre-check sees “not logged in”, then the user logs in.
            me_out = {"status": 401, "body": {"error": "unauthorized"}}
            await invoke(page, "__test.vibes", {"accountId": may["id"], "me": [me_out, {"status": 200, "body": {"user": {"id": "v-may", "username": "may.vn"}}}]})
            await invoke(page, "__test.vibes", {"accountId": gio["id"], "me": [me_out, me_out, {"status": 200, "body": {"user": {"id": "v-gio", "username": "gio.vn"}}}]})
            await go(page, "/accounts")
            card = page.get_by_role("article", name="Mây", exact=False)
            await card.get_by_role("button", name="Đăng nhập", exact=True).click()
            dlg = page.get_by_role("dialog", name="Đăng nhập tài khoản Mây")
            await dlg.wait_for(timeout=5000)
            cur = dlg.locator('[aria-current="step"]')
            check("S07c2 opens on step 1 Muse", "Muse" in (await cur.inner_text()), await cur.inner_text())
            check("S07c2 sub line names the shared profile/proxy", await dlg.get_by_text("Hai trang giữ phiên riêng", exact=False).count() > 0)
            check("S07c2 promises no password/OTP filled by the app", await dlg.get_by_text("App không điền mật khẩu hay mã xác minh").count() > 0)
            check("S07c2 no skip button on the Muse step", await dlg.get_by_role("button", name="Bỏ qua Vibes, dùng Muse trước").count() == 0)
            await shot(page, "e10_login_step1_muse")
            await dlg.get_by_text("Vibes · Đang chờ anh đăng nhập").wait_for(timeout=10000)
            check("S07c2 moves to step 2 Vibes after Muse", True)
            check("S07c2 Muse step shows done", await dlg.get_by_text("Muse · Đã đăng nhập").count() > 0)
            check("S07c2 skip button only on step 2", await dlg.get_by_role("button", name="Bỏ qua Vibes, dùng Muse trước").count() == 1)
            await shot(page, "e10_login_step2_vibes")
            toast = page.get_by_text("Mây: Muse và Vibes đã sẵn sàng")
            await toast.wait_for(timeout=12000)
            check("S07c2 both done → one toast and back to S07", await page.get_by_role("dialog", name="Đăng nhập tài khoản Mây").count() == 0)
            a = await account(page, "Mây")
            check("Mây: Muse ready + Vibes ready", a["state"] == "ready" and a["vibes"]["status"] == "ready", f"{a['state']} / {a['vibes']['status']}")

            # ---------------- skip Vibes on the second account, then log in to Vibes alone
            card2 = page.get_by_role("article", name="Gió", exact=False)
            await card2.get_by_role("button", name="Đăng nhập", exact=True).click()
            dlg2 = page.get_by_role("dialog", name="Đăng nhập tài khoản Gió")
            await dlg2.get_by_role("button", name="Bỏ qua Vibes, dùng Muse trước").wait_for(timeout=10000)
            await dlg2.get_by_role("button", name="Bỏ qua Vibes, dùng Muse trước").click()
            await page.get_by_text("Gió đã sẵn sàng").first.wait_for(timeout=8000)
            g = await account(page, "Gió")
            check("Skip Vibes keeps Muse ready, Vibes not logged in", g["state"] == "ready" and g["vibes"]["status"] in ("logged_out", "needs_login"), f"{g['state']} / {g['vibes']['status']}")
            check("S07 shows “Đăng nhập Vibes” on Gió's Vibes row", await card2.get_by_role("button", name="Đăng nhập Vibes").count() == 1)
            # A background check may have read the session meanwhile: script “not logged in → logged in” again.
            await invoke(page, "__test.vibes", {"accountId": gio["id"], "me": [me_out, {"status": 200, "body": {"user": {"id": "v-gio", "username": "gio.vn"}}}]})
            await card2.get_by_role("button", name="Đăng nhập Vibes").click()
            dlg3 = page.get_by_role("dialog", name="Đăng nhập tài khoản Gió")
            await dlg3.wait_for(timeout=5000)
            steps_count = await dlg3.locator('ol[aria-label="Các bước đăng nhập"] > li').count()
            check("Vibes-only login has one step", steps_count == 1, str(steps_count))
            await page.get_by_text("Gió: Muse và Vibes đã sẵn sàng").wait_for(timeout=12000)
            g = await account(page, "Gió")
            check("Gió Vibes ready after its own login", g["vibes"]["status"] == "ready", g["vibes"]["status"])

            # ---------------- S07 rows + ⋯ switch (R39)
            await page.set_viewport_size({"width": 1024, "height": 728})
            await asyncio.sleep(0.4)
            check("S07 rows Muse + Vibes on each card", await card.get_by_text("Vibes", exact=True).count() >= 1 and await card.get_by_text("Muse", exact=True).count() >= 1)
            check("S07 no horizontal scroll at 1024 × 728", await no_hscroll(page))
            await shot(page, "e10_accounts_sites_1024")
            await card.get_by_role("button", name="Thao tác cho", exact=False).click()
            await page.get_by_role("menuitemradio", name="Dùng Vibes cho tài khoản này").click()
            await card.get_by_role("button", name="Bật Vibes").wait_for(timeout=5000)
            a = await account(page, "Mây")
            check("⋯ switch turns Vibes off (row “Đang tắt” + Bật Vibes)", not a["vibes"]["enabled"] and await card.get_by_text("Đang tắt").count() > 0)
            await shot(page, "e10_vibes_off")
            await card.get_by_role("button", name="Bật Vibes").click()
            await asyncio.sleep(1.0)
            a = await account(page, "Mây")
            check("Bật Vibes turns it back on", a["vibes"]["enabled"], a["vibes"]["status"])

            # ---------------- identity changed: amber block + sidebar dot
            await invoke(page, "__test.vibes", {"accountId": may["id"], "me": [{"status": 200, "body": {"user": {"id": "other-777", "username": "nguoikhac.vn"}}}]})
            await card.get_by_role("button", name="Thao tác cho", exact=False).click()
            await page.get_by_role("menuitem", name="Kiểm phiên Vibes").click()
            await card.get_by_text("Vibes đang đăng nhập", exact=False).wait_for(timeout=8000)
            check("identity_changed shows the amber choice", await card.get_by_role("button", name="Dùng tài khoản mới").count() == 1)
            side = page.get_by_role("navigation", name="Điều hướng chính")
            dot_label = await side.locator('button[aria-label^="Mây"]').get_attribute("aria-label")
            check("Sidebar avatar gets the amber Vibes note", "Vibes đã đổi tài khoản" in (dot_label or ""), dot_label or "")
            await shot(page, "e10_identity_changed_sidebar_dot")
            await card.get_by_role("button", name="Dùng tài khoản mới").click()
            await asyncio.sleep(0.8)
            a = await account(page, "Mây")
            check("Accept new identity → Vibes ready", a["vibes"]["status"] == "ready", a["vibes"]["status"])

            # ---------------- Composer “Nơi tạo” (locked until verified, rules B37)
            await page.set_viewport_size({"width": 1280, "height": 800})
            await go(page, "/studio")
            await page.get_by_role("radio", name="Video").first.click()
            vchip = page.get_by_role("radiogroup", name="Nơi tạo").get_by_role("radio", name="Vibes")
            check("Nơi tạo appears for Video", await vchip.count() == 1)
            check("Vibes chip locked while unverified", (await vchip.get_attribute("aria-disabled")) == "true" and "chưa được kiểm" in (await vchip.get_attribute("title") or ""))
            await page.get_by_role("radio", name="Ảnh").first.click()
            check("No Nơi tạo for Ảnh", await page.get_by_role("radiogroup", name="Nơi tạo").count() == 0)
            await page.get_by_role("radio", name="Video").first.click()
            await invoke(page, "__test.setVerified", {"caps": {"vibes.video.text": True, "vibes.video.reference": True, "vibes.video.extend": True}})
            await asyncio.sleep(0.5)
            await vchip.click()
            check("Choosing Vibes shows the helper line", await page.get_by_text("Tạo trên Vibes · kéo dài được sau khi xong").count() > 0)
            await shot(page, "e10_composer_site_vibes")
            prompt = "Sóng biển lúc bình minh, máy quay đứng yên"
            await page.locator("textarea").first.fill(prompt)
            await page.keyboard.press("Enter")

            # Wait for the Vibes job to complete through the job list.
            async def first_vibes_job():
                pg = await invoke(page, "job.query", {"order": "desc", "limit": 20})
                items = pg["items"] if isinstance(pg, dict) else pg
                for j in items:
                    if j.get("site") == "vibes" and j.get("operation") == "generate" and j["state"] == "completed":
                        return j
                return None
            try:
                vj = await wait_until(first_vibes_job, 40)
            except Exception as e:
                vj = None
                check("job.query available", False, str(e))
            check("Vibes generate job completes (fake Vibes)", bool(vj))
            card_v = page.get_by_role("article", name=f"Lượt: {prompt[:60]}")
            check("Job card shows the Vibes pill", await card_v.get_by_text("Vibes", exact=True).count() >= 1)
            await shot(page, "e10_vibes_job_card")

            # ---------------- S06e Kéo dài sheet from the card menu
            await card_v.get_by_role("button", name="Thao tác cho", exact=False).click()
            await page.get_by_role("menuitem", name="Kéo dài video").click()
            sheet = page.get_by_role("dialog", name="Kéo dài video")
            await sheet.wait_for(timeout=3000)
            await sheet.get_by_text("Chạy trên").wait_for(timeout=5000)
            focused = await page.evaluate("() => [document.activeElement?.getAttribute('role'), document.activeElement?.textContent]")
            check("S06e focus starts on the first segmented (Tự động)", focused == ["radio", "Tự động"], str(focused))
            check("S06e description disabled in Tự động", await sheet.get_by_label("Mô tả cho các lần kéo dài").is_disabled())
            check("S06e max line", await sheet.get_by_text("Tối đa 20 lần mỗi chuỗi · Dừng khi Vibes không kéo dài thêm").count() == 1)
            check("S06e runs on the source's account", await sheet.get_by_text("mỗi lần dùng 1 lượt Vibes", exact=False).count() >= 1)
            check("S06e amber length note", await sheet.get_by_text("Độ dài cuối cùng do Vibes quyết định — app đo từng bản và dừng đúng luật").count() == 1)
            await sheet.get_by_role("radio", name="Theo mô tả").click()
            check("Theo mô tả enables the description", not await sheet.get_by_label("Mô tả cho các lần kéo dài").is_disabled())
            await sheet.get_by_role("button", name="Bắt đầu kéo dài").click()
            check("Empty description is refused in the sheet", await sheet.get_by_text("Nhập mô tả cho Theo mô tả").count() == 1)
            await sheet.get_by_role("radio", name="Tự động").click()
            steps_val = await sheet.get_by_label("số lần", exact=True).input_value()
            check("Số lần defaults to 3", steps_val == "3", steps_val)
            await shot(page, "e10_extend_sheet")
            await sheet.get_by_role("button", name="Bắt đầu kéo dài").click()
            await page.get_by_text("Đã bắt đầu chuỗi kéo dài").wait_for(timeout=5000)
            check("Start → toast, sheet closed", await page.get_by_role("dialog", name="Kéo dài video").count() == 0)

            # chain card on the timeline + queue strip while running
            chain_card = page.get_by_role("article", name="Chuỗi kéo dài", exact=False).first
            await chain_card.wait_for(timeout=5000)
            check("Studio shows one chain card", await page.get_by_role("article", name="Chuỗi kéo dài", exact=False).count() == 1)
            await shot(page, "e10_chain_card_studio")
            await go(page, "/queue")
            strip = page.get_by_role("region", name="Chuỗi kéo dài đang chạy")
            seen_strip = await strip.count() > 0
            if seen_strip:
                await shot(page, "e10_queue_chain_strip")
            check("Queue shows the running chain strip", seen_strip)

            async def chain_done():
                lst = await invoke(page, "chain.list")
                return next((c for c in lst if c["status"] in ("completed", "stopped", "needs_review")), None)
            ch = await wait_until(chain_done, 90)
            check("Chain completes 3 steps (Đã kéo dài 3 lần)", bool(ch) and ch["status"] == "completed" and ch["stepsDone"] == 3, json.dumps({k: ch.get(k) for k in ("status", "stepsDone", "reason", "lastDurationMs")} if ch else {}, ensure_ascii=False))

            # S03-chain drawer through its route (also the notification route)
            await go(page, f"/queue/chain/{ch['id']}")
            drawer = page.get_by_role("dialog", name="Chuỗi kéo dài", exact=False)
            await drawer.get_by_text("Lần 3", exact=True).wait_for(timeout=5000)
            rows = await drawer.locator("ol > li").count()
            durs = await drawer.locator("ol > li .font-mono").all_inner_texts()
            check("S03-chain lists 3 steps with measured lengths", rows == 3, " | ".join(durs))
            check("S03-chain lengths grow 10 → 15 → 20 s", any("10,0" in d for d in durs) and any("20,0" in d for d in durs), " | ".join(durs))
            await shot(page, "e10_chain_drawer")
            await drawer.get_by_role("button", name="Mở bản mới nhất").click()
            lb = page.get_by_role("dialog", name="Xem lớn")
            await lb.wait_for(timeout=4000)
            lineage = page.get_by_role("navigation", name="Các bản trong chuỗi")
            await lineage.wait_for(timeout=5000)
            n_items = await lineage.get_by_role("button").count()
            cur_label = await lineage.locator('[aria-current="true"]').inner_text()
            check("S06b lineage: Gốc + 3 lần, newest ringed", n_items == 4 and "Lần 3" in cur_label, f"{n_items} · {cur_label}")
            await shot(page, "e10_lightbox_lineage")

            # Esc closes only the top overlay
            await lb.get_by_role("button", name="Kéo dài video").click()
            await page.get_by_role("dialog", name="Kéo dài video").wait_for(timeout=3000)
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.3)
            check("Esc closes the sheet but not the lightbox", await page.get_by_role("dialog", name="Kéo dài video").count() == 0 and await page.get_by_role("dialog", name="Xem lớn").count() == 1)
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.3)
            check("Second Esc closes the lightbox", await page.get_by_role("dialog", name="Xem lớn").count() == 0)

            # S06-chain tile
            await go(page, "/library")
            await page.get_by_text("Chuỗi · 3 bản").first.wait_for(timeout=5000)
            check("Library collapses the chain into one tile “Chuỗi · 3 bản”", await page.get_by_text("Chuỗi · 3 bản").count() == 1)
            await shot(page, "e10_library_chain_tile")

            # Muse video: Kéo dài locked with the R45 reason
            mp = "Phố đêm sau mưa, máy quay lướt chậm"
            await invoke(page, "job.create", {"kind": "video", "mode": "text", "prompt": mp, "referenceIds": [], "accountPref": "auto", "repeat": 1, "clientRequestId": "e2e-muse-video-1", "site": "muse"})

            async def muse_done():
                pg = await invoke(page, "job.query", {"order": "desc", "limit": 30})
                items = pg["items"] if isinstance(pg, dict) else pg
                return next((j for j in items if j["prompt"] == mp and j["state"] == "completed"), None)
            await wait_until(muse_done, 40)
            await go(page, "/studio")
            await go(page, "/library")
            tile = page.get_by_role("button", name=f"Video: {mp[:80]}")
            await tile.wait_for(timeout=8000)
            await tile.click()
            lb = page.get_by_role("dialog", name="Xem lớn")
            await lb.get_by_role("button", name="Kéo dài video").wait_for(timeout=5000)
            check("Muse video: Kéo dài disabled", await lb.get_by_role("button", name="Kéo dài video").is_disabled())
            # Spec rev 7 §12.1: a Muse video is judged by Muse's own rules (no Vibes hint). The fake Muse in this run
            # returns no conversation source, so the exact Muse reason is shown.
            check("Muse video: exact reason shown", await lb.get_by_text("Video này chưa có nguồn hội thoại Muse").count() == 1)
            await shot(page, "e10_muse_video_locked")
            await page.keyboard.press("Escape")

            # Settings › Hàng chờ — max per chain
            await go(page, "/settings/queue")
            inp = page.get_by_label("số lần tối đa mỗi chuỗi", exact=True)
            await inp.fill("2")
            await inp.blur()
            await asyncio.sleep(1.0)
            s = await snap(page)
            check("Settings saves Tối đa mỗi chuỗi kéo dài = 2", s["settings"]["extendMaxSteps"] == 2, str(s["settings"]["extendMaxSteps"]))
            await shot(page, "e10_settings_max_steps")
            await go(page, "/settings/about")
            check("About lists the VibesAI-api MIT notice", await page.get_by_text("VibesAI-api", exact=False).count() >= 1)

            # The sheet follows the new maximum; 1024 × 728 floats it without horizontal scroll
            await page.set_viewport_size({"width": 1024, "height": 728})
            await go(page, "/studio")
            await page.get_by_role("article", name="Chuỗi kéo dài", exact=False).first.wait_for(timeout=5000)
            await card_v.get_by_role("button", name="Thao tác cho", exact=False).click()
            await page.get_by_role("menuitem", name="Kéo dài video").click()
            sheet = page.get_by_role("dialog", name="Kéo dài video")
            await sheet.get_by_text("Tối đa 2 lần mỗi chuỗi", exact=False).wait_for(timeout=5000)
            check("S06e follows the new maximum (Tối đa 2 lần)", True)
            box = await sheet.bounding_box()
            check("S06e floats at 360 px under 1100 px wide", box is not None and abs(box["width"] - 360) <= 2, str(box))
            check("No horizontal scroll with the sheet open at 1024 × 728", await no_hscroll(page))
            await shot(page, "e10_extend_sheet_1024")
            await page.keyboard.press("Escape")

            # Vibes UI changed → only the Vibes banner, Muse keeps running
            await invoke(page, "__test.vibes", {"accountId": may["id"], "steps": [{"phase": "submit", "error": "UI_CHANGED"}]})
            await invoke(page, "__test.vibes", {"accountId": gio["id"], "steps": [{"phase": "submit", "error": "UI_CHANGED"}]})
            await invoke(page, "job.create", {"kind": "video", "mode": "text", "prompt": "Thử đổi giao diện Vibes", "referenceIds": [], "accountPref": "auto", "repeat": 1, "clientRequestId": "e2e-vibes-uichanged-1", "site": "vibes"})
            banner = page.get_by_text("Vibes vừa đổi giao diện, chờ cập nhật — việc Muse vẫn chạy")
            try:
                await banner.wait_for(timeout=15000)
                seen = True
            except Exception:
                seen = False
            check("Vibes UI_CHANGED shows the Vibes banner", seen)
            check("Muse banner not shown", await page.get_by_text("Muse vừa đổi giao diện").count() == 0)
            if seen:
                await shot(page, "e10_vibes_ui_changed_banner")
                await page.get_by_role("status").filter(has_text="Vibes vừa đổi giao diện").get_by_role("button", name="Thử lại").click()
                await asyncio.sleep(0.8)
                check("Thử lại clears only the Vibes banner", await banner.count() == 0)

            check("No renderer exceptions", not errors, " | ".join(errors[:3]))
            return {"rootAssetId": ch["rootAssetId"]}


asyncio.run(main())
