"""
Phase 12 E2E (Linux build machine): real Electron app (main process, SQLite, renderer) with the fake Muse adapter, whose
Usage panel text is set per account through `__test.quota` (rules B38 — no network to Meta). Covers screens rev 8 §13:
S07-quota-ok / low / additional / blocked / empty / error / reading, the S02 account picker lines, at 1440 × 900 and
1024 × 728 (AC-QTA-11, AC-QTA-02 UI part, AC-QTA-05 picker part).

Run from desktop/ after `npm run build`:
  python3 e2e/quota_ui_e2e.py
Needs xvfb-run and Python Playwright. Screenshots go to $OUT (default /tmp/e2e-quota/run/img).
"""
import asyncio
import datetime as dt
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-quota/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
PORT = 9336
results = []


def check(name, ok, note=""):
    results.append({"check": name, "ok": bool(ok), "note": note})
    print(("PASS " if ok else "FAIL ") + name + (f" — {note}" if note else ""), flush=True)


async def shot(page, name):
    await asyncio.sleep(0.3)
    await page.screenshot(path=str(OUT / f"{name}.png"))


async def invoke(page, cmd, data=None):
    r = await page.evaluate("([c, d]) => window.muse.invoke(c, d)", [cmd, data or {}])
    if isinstance(r, dict) and "ok" in r:
        if not r["ok"]:
            raise RuntimeError(f"{cmd}: {r.get('error')}")
        return r.get("data")
    return r


async def account(page, alias):
    s = await invoke(page, "app.snapshot")
    return next(a for a in s["accounts"] if a["alias"] == alias)


async def wait_until(fn, timeout=30, every=0.3):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = await fn()
        if last:
            return last
        await asyncio.sleep(every)
    return last


async def go(page, route):
    await invoke(page, "__test.navigate", {"route": route})
    await asyncio.sleep(0.5)


def launch(env):
    if env.get("NIX_LD_LIBRARY_PATH") and env["NIX_LD_LIBRARY_PATH"] not in env.get("LD_LIBRARY_PATH", ""):  # nix machines keep Chromium's libraries here
        env = dict(env, LD_LIBRARY_PATH=env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", ""))
    app = subprocess.Popen(
        ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", str(ROOT / "node_modules/electron/dist/electron"), "--no-sandbox", f"--remote-debugging-port={PORT}", "."],
        cwd=str(ROOT), env=env, stdout=open(WORK / "app.log", "w"), stderr=subprocess.STDOUT, start_new_session=True,
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


def stop(app):
    try:
        os.killpg(app.pid, 15)
    except Exception:
        pass
    try:
        app.wait(timeout=20)
    except Exception:
        pass


# A reset day three days ahead, written the way Muse writes it (“Nov 2”), so the app can derive 00:00 of that day.
RESET = dt.date.today() + dt.timedelta(days=3)
RESET_LABEL = RESET.strftime("%b ") + str(RESET.day)
RESET_DM = RESET.strftime("%d/%m")
ADD_5B = "\nAdditional tokens\nNever expires\n0% used (5B tokens left)"


def usage(weekly, extra=ADD_5B):
    return f"Free plan\nWeekly limit resets on {RESET_LABEL}\n{weekly}% used{extra}\nUpgrade"


PLAN = [
    ("Mây", usage(51)),
    ("Gió", usage(85)),
    ("Sương", usage(100)),
    ("Trăng", usage(100, "")),
    ("Hoa", None),  # never read
]


async def card(page, alias):
    return page.get_by_role("article", name=f"{alias} —", exact=False)


async def overflow_report(page):
    """Elements inside quota blocks whose text is cut without a tooltip, or that stick out of their card."""
    return await page.evaluate(
        """() => {
          const bad = [];
          for (const sec of document.querySelectorAll('section[aria-label^="Hạn mức Muse"]')) {
            const card = sec.closest('article').getBoundingClientRect();
            const r = sec.getBoundingClientRect();
            if (r.left < card.left - 1 || r.right > card.right + 1) bad.push('section outside card: ' + sec.getAttribute('aria-label'));
            for (const el of sec.querySelectorAll('span, p, h3')) {
              if (el.scrollWidth > el.clientWidth + 1 && !el.title) bad.push('cut without tooltip: ' + el.textContent);
            }
          }
          return bad;
        }"""
    )


async def check_layout(page, label):
    no_h = await page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    check(f"{label}: no horizontal scroll", no_h)
    bad = await overflow_report(page)
    check(f"{label}: quota text fits (or has a tooltip)", not bad, "; ".join(bad[:4]))


async def scenario(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.set_viewport_size({"width": 1440, "height": 900})
    await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
    await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
    await invoke(page, "proxy.import", {"text": "\n".join(f"198.51.100.{20 + i}:8080:u{i}:p{i}" for i in range(len(PLAN)))})
    await invoke(page, "proxy.testAll")
    await asyncio.sleep(1.5)
    proxies = [x["id"] for x in (await invoke(page, "app.snapshot"))["proxies"]]
    ids = {}
    for i, (alias, text) in enumerate(PLAN):
        a = await invoke(page, "account.add", {"alias": alias, "avatar": i, "proxyId": proxies[i]})
        ids[alias] = a["id"]
        await invoke(page, "account.checkSession", {"id": a["id"]})
        if text is not None:
            await invoke(page, "__test.quota", {"accountId": a["id"], "text": text})
    await go(page, "/accounts")

    # Read each account through its own refresh button (the button is the user's way in, AC-QTA-02/09).
    for alias, text in PLAN:
        c = await card(page, alias)
        btn = c.get_by_role("button", name=f"Đọc lại hạn mức của {alias}", exact=True)
        check(f"{alias}: refresh button named per account", await btn.count() == 1)
        if text is None:
            continue
        await btn.click()

        async def read_done(alias=alias):
            a = await account(page, alias)
            return a if a.get("quota") and a["quota"].get("readAt", 0) > 0 and not a.get("quotaReading") else None

        a = await wait_until(read_done, 15)
        check(f"{alias}: read stored", bool(a), json.dumps((a or {}).get("quota"), ensure_ascii=False)[:160])
    await asyncio.sleep(0.8)

    may = await card(page, "Mây")
    meter = may.get_by_role("meter", name="Hạn mức tuần đã dùng 51 %")
    check("Mây: meter labelled for screen readers", await meter.count() == 1)
    check("Mây: meter value 51", (await meter.get_attribute("aria-valuenow")) == "51" if await meter.count() else False)
    check("Mây: weekly line", await may.get_by_text(f"đã dùng 51 % · đặt lại {RESET_DM}", exact=True).count() == 1)
    check("Mây: additional line keeps “5B token”", await may.get_by_text("5B token còn lại · không hết hạn · đã dùng 0 %", exact=True).count() == 1)
    check("Mây: read time shown", await may.get_by_text("Đọc lúc ", exact=False).count() >= 1)
    gio = await card(page, "Gió")
    check("Gió 85 %: chip “Sắp hết hạn mức tuần”", await gio.get_by_text("Sắp hết hạn mức tuần", exact=True).count() == 1)
    suong = await card(page, "Sương")
    check("Sương 100 % + 5B: stays ready with chip “Đang dùng token bổ sung”", await suong.get_by_text("Đang dùng token bổ sung", exact=True).count() == 1 and (await account(page, "Sương"))["state"] == "ready")
    trang = await card(page, "Trăng")
    st = await account(page, "Trăng")
    check("Trăng 100 %, no additional: limit_reached until the reset day", st["state"] == "limit_reached", f"{st['state']} until {st.get('stateUntil')}")
    # Header pill + the Muse site row both carry the state.
    check("Trăng: pill “Hết hạn mức đến 00:00 · dd/mm”", await trang.get_by_text(f"Hết hạn mức đến 00:00 · {RESET_DM}", exact=True).count() >= 1)
    check("Trăng: note uses the derived day", await trang.get_by_text(f"Hết hạn mức tuần (Muse báo 100 %) · đặt lại {RESET_DM}", exact=True).count() == 1)
    check("Trăng: additional “Không có”", await trang.get_by_text("Không có", exact=True).count() == 1)
    check("Trăng: footer says new work goes elsewhere", await trang.get_by_text("lượt mới chuyển sang tài khoản khác", exact=True).count() == 1)
    hoa = await card(page, "Hoa")
    check("Hoa never read: “Chưa đọc hạn mức” + “Đọc ngay”, no meter", await hoa.get_by_text("Chưa đọc hạn mức", exact=True).count() == 1 and await hoa.get_by_role("button", name="Đọc ngay").count() == 1 and await hoa.locator('section[aria-label^="Hạn mức Muse"]').get_by_role("meter").count() == 0)  # Build 2.0: the “Cách chạy” load meter is not a quota meter
    await check_layout(page, "1440 × 900")
    await may.scroll_into_view_if_needed()
    await shot(page, "q01_accounts_1440")
    await trang.scroll_into_view_if_needed()
    await shot(page, "q02_accounts_1440_blocked_empty")
    await may.locator('section[aria-label^="Hạn mức Muse"]').screenshot(path=str(OUT / "q03_block_ok.png"))
    await trang.locator('section[aria-label^="Hạn mức Muse"]').screenshot(path=str(OUT / "q04_block_blocked.png"))

    # Reading: spinner + locked button, old numbers stay (no flash to empty).
    await invoke(page, "__test.quota", {"accountId": ids["Gió"], "text": usage(86), "delayMs": 4000})
    await gio.scroll_into_view_if_needed()
    btn = gio.get_by_role("button", name="Đọc lại hạn mức của Gió", exact=True)
    await btn.click()
    await asyncio.sleep(0.6)
    check("Reading: button locked", await btn.is_disabled())
    check("Reading: block marked busy", (await gio.locator('section[aria-label^="Hạn mức Muse"]').get_attribute("aria-busy")) == "true")
    check("Reading: old numbers kept", await gio.get_by_text("đã dùng 85 %", exact=False).count() == 1)
    await gio.locator('section[aria-label^="Hạn mức Muse"]').screenshot(path=str(OUT / "q05_block_reading.png"))
    await wait_until(lambda: gio.get_by_text("đã dùng 86 %", exact=False).count(), 10)
    check("Reading: new numbers after the read", await gio.get_by_text("đã dùng 86 %", exact=False).count() == 1)

    # Failed read: previous numbers stay, error line says when; account state untouched.
    await invoke(page, "__test.quota", {"accountId": ids["Mây"], "text": "fail"})
    await may.scroll_into_view_if_needed()
    await may.get_by_role("button", name="Đọc lại hạn mức của Mây", exact=True).click()
    err = may.get_by_text("Không đọc được lúc", exact=False)
    await wait_until(lambda: err.count(), 10)
    check("Error: line shown with the time of the old numbers", await err.count() == 1 and "đang hiện số đọc lúc" in (await err.inner_text()), (await err.inner_text()) if await err.count() else "")
    check("Error: 51 % still shown", await may.get_by_role("meter", name="Hạn mức tuần đã dùng 51 %").count() == 1)
    check("Error: account still ready", (await account(page, "Mây"))["state"] == "ready")
    await may.locator('section[aria-label^="Hạn mức Muse"]').screenshot(path=str(OUT / "q06_block_error.png"))

    # Old numbers (read 7 h ago, R70/R75): still shown, marked “cũ”, read time kept, account not blocked by age alone.
    await invoke(page, "__test.quota", {"accountId": ids["Gió"], "ageMs": 7 * 3600 * 1000})
    await gio.scroll_into_view_if_needed()
    stale_chip = gio.get_by_text("cũ", exact=True)
    await wait_until(lambda: stale_chip.count(), 10)
    check("Stale 7 h: chip “cũ” shown", await stale_chip.count() == 1)
    check("Stale 7 h: numbers kept (86 %)", await gio.get_by_role("meter", name="Hạn mức tuần đã dùng 86 %").count() == 1)
    check("Stale 7 h: read time still shown", await gio.get_by_text("Đọc lúc ", exact=False).count() >= 1)
    check("Stale 7 h: account still ready", (await account(page, "Gió"))["state"] == "ready")
    check("Fresh account has no “cũ”", await suong.get_by_text("cũ", exact=True).count() == 0)
    await gio.locator('section[aria-label^="Hạn mức Muse"]').screenshot(path=str(OUT / "q06b_block_stale.png"))

    # 1024 × 728: one column, nothing cut without a tooltip.
    await page.set_viewport_size({"width": 1024, "height": 728})
    await asyncio.sleep(0.6)
    await check_layout(page, "1024 × 728")
    await may.scroll_into_view_if_needed()
    await shot(page, "q07_accounts_1024")
    await trang.scroll_into_view_if_needed()
    await shot(page, "q08_accounts_1024_blocked")

    # S02 account picker (Muse): weekly % per account, unread says so, Tự động explains the order.
    await page.set_viewport_size({"width": 1440, "height": 900})
    await go(page, "/")
    trigger = page.get_by_role("button", name="Tự động", exact=False).first
    await trigger.click()
    menu = page.get_by_role("menu", name="Tài khoản")
    await menu.wait_for(timeout=5000)
    text = await menu.inner_text()
    check("Picker: Tự động explains quota order", "Ưu tiên tài khoản còn hạn mức, chia đều" in text)
    check("Picker: Mây line “Sẵn sàng · tuần 51 %”", "Sẵn sàng · tuần 51 %" in text, text.replace("\n", " | ")[:300])
    check("Picker: Hoa line “chưa đọc hạn mức”", "chưa đọc hạn mức" in text)
    check("Picker: Trăng shows the limit with its week %", f"Hết hạn mức đến 00:00 · {RESET_DM} · tuần 100 %" in text)
    cut = await menu.evaluate("m => [...m.querySelectorAll('span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)")
    check("Picker: no line cut off", not cut, "; ".join(cut[:3]))
    await shot(page, "q09_picker")
    await page.keyboard.press("Escape")
    check("No renderer errors", not errors, "; ".join(errors[:3]))


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), ELECTRON_DISABLE_SECURITY_WARNINGS="1")
    app = launch(env)
    try:
        async with async_playwright() as p:
            browser, page = await connect(p)
            try:
                await scenario(page)
            except Exception:
                await page.screenshot(path=str(OUT / "zz_fail.png"))
                raise
            finally:
                await browser.close()
    finally:
        stop(app)
        (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
        passed = sum(1 for r in results if r["ok"])
        print(f"\n{passed}/{len(results)} PASS", flush=True)


asyncio.run(main())
