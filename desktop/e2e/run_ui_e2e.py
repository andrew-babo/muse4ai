"""
Build 2.0 UI E2E (Linux build machine): real Electron app (main process, SQLite, renderer) with the fake Muse adapter
and the fake Muse gateway (`__test.gw`, rules B38 — no network to Meta). Covers screens.md §1 for Build 2.0:
S07 “Cách chạy” block + S07e dialog (AC-EXE-01/02 UI part), S09g “Chạy việc” (switch, Kiểm ngay, app-wide limits),
S02c Hỏi đáp (prompt, attachment, shared-memory note, answer, files, Hỏi tiếp in the same conversation — AC-CHAT-01/05/06
UI part), S04 Hỏi đáp filter, S03c drawer (answer, path, text preview) and the B-HTTP incompatibility banner (AC-EXE-09
UI part), at 1440 × 900 and 1024 × 728.

Run from desktop/ after `npm run build`:
  python3 e2e/run_ui_e2e.py
Needs xvfb-run and Python Playwright. Screenshots go to $OUT (default /tmp/e2e-run/run/img).
"""
import asyncio
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-run/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
PORT = 9337
SHARED_NOTE = "Các việc trên cùng tài khoản dùng chung bộ nhớ Muse"
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


async def snap(page):
    return await invoke(page, "app.snapshot")


async def account(page, alias):
    return next(a for a in (await snap(page))["accounts"] if a["alias"] == alias)


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
    await asyncio.sleep(0.6)


def launch(env):
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


async def no_hscroll(page, label):
    ok = await page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    check(f"{label}: no horizontal scroll", ok)


async def cut_report(page, selector):
    return await page.evaluate(
        """(sel) => {
          const bad = [];
          for (const root of document.querySelectorAll(sel)) {
            for (const el of root.querySelectorAll('span, p, h3')) {
              if (el.scrollWidth > el.clientWidth + 1 && !el.title && !el.closest('[title]')) bad.push(el.textContent);
            }
          }
          return bad;
        }""",
        selector,
    )


async def jobs(page, **f):
    return (await invoke(page, "job.query", {"order": "asc", "limit": 100, **f}))["items"]


async def scenario(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.set_viewport_size({"width": 1440, "height": 900})
    await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
    await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
    await invoke(page, "proxy.import", {"text": "198.51.100.31:8080:u1:p1\n198.51.100.32:8080:u2:p2"})
    await invoke(page, "proxy.testAll")
    await asyncio.sleep(1.5)
    proxies = [x["id"] for x in (await snap(page))["proxies"]]
    ids = {}
    for i, alias in enumerate(["Mây", "Gió"]):
        a = await invoke(page, "account.add", {"alias": alias, "avatar": i, "proxyId": proxies[i]})
        ids[alias] = a["id"]
        await invoke(page, "account.checkSession", {"id": a["id"]})
    await wait_until(lambda: _all_ready(page), 20)

    # ---------------------------------------------------------------- S07 “Cách chạy” block
    await go(page, "/accounts")
    may = page.get_by_role("region", name="Cách chạy của Mây")
    check("S07: Mây has a “Cách chạy” block", await may.count() == 1)
    check("S07: default mode chip “Tự động”", await may.get_by_text("Tự động", exact=True).count() == 1)
    check("S07: load meter 0 of 10", await may.get_by_role("meter", name="Đang làm 0 trên tối đa 10 việc").count() == 1)
    check("S07: path split shown", await may.get_by_text("HTTP 0 · Giao diện 0", exact=True).count() == 1)
    await may.scroll_into_view_if_needed()
    await shot(page, "r01_accounts_block")

    # ---------------------------------------------------------------- S07e dialog
    await page.get_by_role("button", name="Đổi cách chạy của Mây").click()
    dlg = page.get_by_role("dialog", name="Cách chạy · Mây")
    await dlg.wait_for(timeout=5000)
    check("S07e: Tự động is the checked choice", (await dlg.get_by_role("radio", name="Tự động Khuyên dùng", exact=False).get_attribute("aria-checked")) == "true")
    check("S07e: shared-memory note in the dialog", await dlg.get_by_text(SHARED_NOTE, exact=False).count() == 1)
    await page.keyboard.press("ArrowDown")
    check("S07e: arrow keys move the choice to Chỉ HTTP", (await dlg.get_by_role("radio", name="Chỉ HTTP", exact=False).get_attribute("aria-checked")) == "true")
    await shot(page, "r02_run_dialog")
    await dlg.get_by_role("button", name="Lưu", exact=True).click()
    a = await wait_until(lambda: _mode_is(page, "Mây", "http"), 5)
    check("S07e: saved mode reads back as http", bool(a))
    check("S07: chip now “Chỉ HTTP”", bool(await wait_until(lambda: _count(may.get_by_text("Chỉ HTTP", exact=True)), 5)))
    # Put it back so “Tự động” stays the tested default for the rest.
    await page.get_by_role("button", name="Đổi cách chạy của Mây").click()
    await dlg.wait_for(timeout=5000)
    await dlg.get_by_role("radio", name="Tự động Khuyên dùng", exact=False).click()
    await dlg.get_by_role("button", name="Lưu", exact=True).click()
    check("S07e: mode back to auto", bool(await wait_until(lambda: _mode_is(page, "Mây", "auto"), 5)))

    # ---------------------------------------------------------------- S09g Chạy việc
    await go(page, "/settings/run")
    sw = page.get_by_role("switch", name="Kênh trực tiếp (HTTP)")
    check("S09g: HTTP switch on by default", (await sw.get_attribute("aria-checked")) == "true")
    check("S09g: app-wide limit shows 40", await page.get_by_text("Tối đa toàn app", exact=True).count() == 1)
    await page.get_by_role("button", name="Kiểm ngay").click()
    res = page.get_by_role("list", name="Kết quả kiểm từng tài khoản")

    async def both_ok():
        t = await res.inner_text()
        return t.count("Đạt") >= 2
    check("S09g: Kiểm ngay — both accounts “Đạt”", bool(await wait_until(both_ok, 20)), (await res.inner_text()).replace("\n", " | "))
    await shot(page, "r03_settings_run")

    # ---------------------------------------------------------------- S02c Hỏi đáp
    await go(page, "/")
    await page.get_by_role("radio", name="Hỏi đáp", exact=True).click()
    box = page.get_by_label("Câu hỏi cho Muse")
    check("S02c: chat prompt box labelled", await box.count() == 1)
    check("S02c: shared-memory note under the composer", await page.get_by_role("note").filter(has_text=SHARED_NOTE).count() == 1)
    csv = WORK / "doanh-thu.csv"
    csv.write_text("thang,doanh_thu\n1,120\n2,150\n3,162\n", encoding="utf-8")
    await page.locator("input[type=file]").first.set_input_files(str(csv))
    chips = page.get_by_label("Tệp đính kèm")
    check("S02c: attachment chip shows the file name", bool(await wait_until(lambda: _has_text(chips, "doanh-thu.csv"), 8)))
    await box.fill("Tổng doanh thu quý 1 là bao nhiêu?")
    await shot(page, "r04_chat_composer")
    await box.press("Enter")

    async def answered(n):
        js = [j for j in await jobs(page, kind="chat") if j["state"] == "completed"]
        return js if len(js) >= n else None
    js = await wait_until(lambda: answered(1), 30)
    check("S02c: chat job completed", bool(js), json.dumps([(j["state"], j.get("execPath")) for j in await jobs(page, kind="chat")]))
    first = (js or [{}])[0]
    check("S02c: ran on the HTTP path", first.get("execPath") == "http")
    check("S02c: attachment kept on the job", len(first.get("referenceIds") or []) == 1)
    check("S02c: conversation handle is an app handle", str(first.get("conversationId") or "").startswith("mc_"))
    check("S02c: no Muse session id reaches the renderer", "remoteSessionId" not in first)
    card = page.get_by_role("article", name="Lượt: Tổng doanh thu quý 1", exact=False)
    check("S02c: answer text on the card", bool(await wait_until(lambda: _has_text(card, "Trả lời: Tổng doanh thu quý 1"), 8)))
    await shot(page, "r05_chat_answer")

    # Hỏi tiếp — same conversation, same account (R85).
    await card.get_by_role("button", name="Hỏi tiếp").click()
    check("S02c: “Tiếp hội thoại” chip in the composer", await page.get_by_text("Tiếp hội thoại", exact=False).count() >= 1)
    await box.fill("Tháng nào tăng mạnh nhất?")
    await box.press("Enter")
    js = await wait_until(lambda: answered(2), 30)
    check("S02c: follow-up completed", bool(js))
    if js:
        check("S02c: follow-up in the same conversation", js[1]["conversationId"] == js[0]["conversationId"])
        check("S02c: follow-up on the same account", js[1]["accountId"] == js[0]["accountId"])
    await shot(page, "r06_chat_followup")

    # A reply with files on Gió (picked by hand).
    await invoke(page, "__test.gw", {"accountId": ids["Gió"], "replyText": "Đây là bảng tổng hợp.", "replyFiles": [{"name": "tong-hop.csv", "mime": "text/csv", "text": "quy,doanh_thu\nQ1,432\n"}]})
    await page.get_by_role("button", name="Bỏ tiếp hội thoại, hỏi trong hội thoại mới").click()
    await page.get_by_role("button", name="Tự động", exact=False).first.click()
    menu = page.get_by_role("menu", name="Tài khoản")
    await menu.wait_for(timeout=5000)
    await menu.get_by_role("menuitemradio", name="Gió", exact=False).click()
    await box.fill("Xuất bảng tổng hợp quý 1 dạng CSV")
    await box.press("Enter")
    js = await wait_until(lambda: answered(3), 30)
    check("S02c: file reply completed", bool(js))
    fcard = page.get_by_role("article", name="Lượt: Xuất bảng tổng hợp", exact=False)
    files = fcard.get_by_role("list", name="Tệp Muse trả về")
    check("S02c: returned file listed", bool(await wait_until(lambda: _has_text(files, "tong-hop.csv"), 10)))
    check("S02c: CSV can be previewed", await files.get_by_role("button", name="Xem").count() == 1)
    await files.get_by_role("button", name="Xem").click()
    prev = page.get_by_role("dialog", name="tong-hop.csv", exact=False)
    await prev.wait_for(timeout=5000)
    check("S03c: text preview shows the CSV", bool(await wait_until(lambda: _has_text(prev, "Q1,432"), 5)))
    await shot(page, "r07_file_preview")
    await page.keyboard.press("Escape")
    await fcard.scroll_into_view_if_needed()
    await shot(page, "r08_file_card")
    check("Library: chat files stay out of the grid", (await invoke(page, "library.query", {"limit": 50}))["total"] == 0)

    # ---------------------------------------------------------------- S04 Hỏi đáp filter + S03c drawer
    await go(page, "/queue")
    pill = page.get_by_role("tab", name="Hỏi đáp", exact=False).first
    await pill.click()
    await asyncio.sleep(0.6)
    rows = await page.get_by_text("Hỏi đáp", exact=True).count()
    check("S04: Hỏi đáp filter shows the chat rows", rows >= 3, f"labels={rows}")
    await shot(page, "r09_queue_chat")
    await page.get_by_text("Xuất bảng tổng hợp quý 1 dạng CSV", exact=True).first.click()
    drawer = page.get_by_role("dialog", name="Chi tiết lượt", exact=False)
    await drawer.wait_for(timeout=5000)
    check("S03c: drawer shows the answer", bool(await wait_until(lambda: _has_text(drawer, "Đây là bảng tổng hợp."), 5)))
    check("S03c: drawer shows the path", await drawer.get_by_text("Đường chạy", exact=True).count() == 1)
    await shot(page, "r10_drawer_chat")
    await page.keyboard.press("Escape")

    # ---------------------------------------------------------------- 1024 × 728 layout
    await page.set_viewport_size({"width": 1024, "height": 728})
    await go(page, "/accounts")
    await no_hscroll(page, "Accounts 1024")
    bad = await cut_report(page, 'section[aria-label^="Cách chạy"]')
    check("Accounts 1024: run block text fits (or has a tooltip)", not bad, "; ".join(bad[:3]))
    await shot(page, "r11_accounts_1024")
    await go(page, "/")
    await no_hscroll(page, "Studio 1024")
    await shot(page, "r12_studio_1024")
    await page.set_viewport_size({"width": 1440, "height": 900})

    # ---------------------------------------------------------------- B-HTTP banner (two accounts report protocol mismatch)
    for alias in ["Mây", "Gió"]:
        await invoke(page, "__test.gw", {"accountId": ids[alias], "steps": [{"phase": "probe", "error": "protocol_mismatch"}]})
        await invoke(page, "account.probeHttp", {"id": ids[alias]})
    await go(page, "/")
    banner = page.get_by_role("status").filter(has_text="Kênh trực tiếp Muse không tương thích")
    check("B-HTTP: banner after two mismatching accounts", bool(await wait_until(lambda: _count(banner), 8)))
    await shot(page, "r13_banner")
    await banner.get_by_role("button", name="Xem").click()
    await asyncio.sleep(0.6)
    check("B-HTTP: “Xem” opens Cài đặt › Chạy việc", await page.get_by_role("switch", name="Kênh trực tiếp (HTTP)").count() == 1)
    check("S09g: incompatibility alert shown", await page.get_by_role("alert").filter(has_text="không tương thích").count() == 1)
    await page.get_by_role("button", name="Kiểm ngay").click()

    async def compat_ok():
        b = (await snap(page))["engine"]["bridge"]
        return b if b["compat"] == "ok" and not b["checking"] else None
    check("S09g: Kiểm ngay lifts the incompatibility", bool(await wait_until(compat_ok, 20)))
    await go(page, "/")
    gone = await wait_until(lambda: _gone(banner), 6)
    if not gone:
        await shot(page, "zz_banner_still")
    check("B-HTTP: banner gone after a passing check", bool(gone), json.dumps((await snap(page))["engine"]["bridge"], ensure_ascii=False)[:300])

    check("No renderer errors", not errors, "; ".join(errors[:3]))


async def _all_ready(page):
    s = await snap(page)
    return all(a["state"] == "ready" for a in s["accounts"]) and len(s["accounts"]) == 2


async def _mode_is(page, alias, mode):
    a = await account(page, alias)
    return a if a["execMode"] == mode else None


async def _has_text(loc, text):
    try:
        return text in (await loc.inner_text(timeout=1000))
    except Exception:
        return False


async def _gone(loc):
    return await loc.count() == 0


async def _count(loc):
    return await loc.count()


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    if env.get("NIX_LD_LIBRARY_PATH"):  # nix build machines keep Chromium's shared libraries here
        env["LD_LIBRARY_PATH"] = env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", "")
    env = dict(env, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), MUSE4AI_FAKE_GEN_MS="1500", ELECTRON_DISABLE_SECURITY_WARNINGS="1")
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
