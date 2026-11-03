"""
Build 2.0 view E2E (Linux build machine): real Electron app (main process, SQLite, renderer) with the fake Muse adapter
and the fake Muse gateway (`__test.gw`, rules B38 — no network to Meta). Covers the "E" part of spec AC-VIEW-01…06:

  VIEW-01  S07 “Cách chạy” block in 7 states (healthy, flaky, Tự động on the UI page, Chỉ HTTP down, Chỉ giao diện,
           switch off, incompatible): chip, label, reason/time, “Thử HTTP ngay” only when down, load meter numbers.
  VIEW-02  S07e dialog: −/+ to the bounds, typed 0/21/6, Huỷ, Lưu, keyboard only, visible focus.
  VIEW-03  S09g Cài đặt › Chạy việc: switch, Kiểm ngay results with time, app-wide limits outside 1–100 / 1–8 not saved,
           incompatibility alert text.
  VIEW-04  Hỏi đáp detail: HTML stays text and never runs/loads, fenced code is monospace, links open only after a
           confirmation, “Chép câu trả lời” copies result_text exactly, path badge + attempt timeline.
  VIEW-05  Studio Hỏi đáp: drop CSV/PDF/PNG + one wrong file, 32 001 characters, Gửi creates exactly one chat job,
           “Hỏi tiếp” off with a reason while the conversation is busy and on again when it is free.
  VIEW-06  Full/light/solid glass: names for screen readers, text contrast ≥ 4.5:1 (large text ≥ 3:1), no motion with
           reduced motion.

Run from desktop/ after `npm run build`:
  python3 e2e/view_ui_e2e.py
Needs xvfb-run and Python Playwright. Screenshots go to $OUT (default /tmp/e2e-view/run/img).
"""
import asyncio
import base64
import json
import os
import re
import shutil
import struct
import subprocess
import time
import urllib.request
import zlib
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-view/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
PORT = 9338
ALIASES = ["An", "Bình", "Châu", "Dũng", "Giang"]
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


async def text_of(loc):
    try:
        return await loc.inner_text(timeout=1500)
    except Exception:
        return ""


async def jobs(page, **f):
    return (await invoke(page, "job.query", {"order": "asc", "limit": 200, **f}))["items"]


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


def tiny_png():
    raw = b"\x00\xff\x00\x00" * 1  # one red pixel row (filter byte + RGB)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


TINY_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"

# Contrast of every visible text element under the selectors: text colour over the composited background chain
# (semi-transparent glass composited over white — the blur behind glass is not modelled).
CONTRAST_JS = r"""
(sels) => {
  const parse = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = c.match(/^color\(srgb ([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    // Any other CSS colour (oklch, lab, color-mix results…): let the browser paint it and read the pixel back.
    const cv = parse.cv || (parse.cv = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }));
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = '#010203';
    cv.fillStyle = c;
    if (cv.fillStyle === '#010203' && c.trim() !== '#010203') return null;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = { checked: 0, unparsed: 0, fails: [], min: 99, samples: [] };
  const seen = new Set();
  for (const sel of sels) for (const root of document.querySelectorAll(sel)) for (const el of [root, ...root.querySelectorAll('*')]) {
    if (seen.has(el)) continue; seen.add(el);
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    if (el.closest('[disabled],[aria-disabled="true"]')) continue; // WCAG 1.4.3 exempts inactive controls
    const chain = [];
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); chain.push(s.backgroundColor); opacity *= Number(s.opacity); }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    let bad = false;
    for (let i = chain.length - 1; i >= 0; i--) { const c = parse(chain[i]); if (!c) { bad = true; break; } if (c.a > 0) bg = over(c, bg); }
    const fg0 = parse(cs.color);
    if (bad || !fg0) { out.unparsed++; if (out.samples.length < 3) out.samples.push(cs.color + ' / ' + chain.join(',').slice(0, 120)); continue; }
    const fg = over({ ...fg0, a: fg0.a * opacity }, bg);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const k = ratio(fg, bg);
    out.checked++;
    out.min = Math.min(out.min, k);
    if (k < need) out.fails.push(`${el.textContent.trim().slice(0, 40)} (${k.toFixed(2)} < ${need})`);
  }
  out.min = Math.round(out.min * 100) / 100;
  return out;
}
"""

UNNAMED_JS = r"""
(sels) => {
  const bad = [];
  for (const sel of sels) for (const root of document.querySelectorAll(sel)) for (const el of root.querySelectorAll('button, [role=radio], [role=switch], input, [role=meter]')) {
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || (el.getAttribute('aria-labelledby') ? 'x' : '');
    if (!name) bad.push(el.outerHTML.slice(0, 80));
  }
  return bad;
}
"""


async def scenario(page):
    errors = []
    dialogs = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: (dialogs.append(d.message), asyncio.ensure_future(d.dismiss())))
    requests = []
    page.on("request", lambda r: requests.append(r.url))
    await page.set_viewport_size({"width": 1440, "height": 900})
    await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
    await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
    await invoke(page, "proxy.import", {"text": "\n".join(f"198.51.100.{40 + i}:8080:u{i}:p{i}" for i in range(6))})
    await invoke(page, "proxy.testAll")
    await asyncio.sleep(1.5)
    proxies = [x["id"] for x in (await snap(page))["proxies"]]
    ids = {}
    for i, alias in enumerate(ALIASES):
        a = await invoke(page, "account.add", {"alias": alias, "avatar": i, "proxyId": proxies[i]})
        ids[alias] = a["id"]
        await invoke(page, "account.checkSession", {"id": a["id"]})

    async def all_ready():
        s = await snap(page)
        return len(s["accounts"]) == 5 and all(a["state"] == "ready" for a in s["accounts"])
    check("setup: 5 accounts ready", bool(await wait_until(all_ready, 25)))
    await invoke(page, "account.setExecution", {"id": ids["Dũng"], "mode": "http", "maxConcurrent": 10, "uiMaxConcurrent": 2})
    await invoke(page, "account.setExecution", {"id": ids["Giang"], "mode": "ui", "maxConcurrent": 10, "uiMaxConcurrent": 2})

    # ================================================================ AC-VIEW-01 — seven states
    fail = {"phase": "probe", "error": "connect_failed"}
    for alias in ["Châu", "Dũng"]:
        await invoke(page, "__test.gw", {"accountId": ids[alias], "steps": [fail, fail, fail]})
    for rnd in range(3):
        if rnd == 2:
            await invoke(page, "__test.gw", {"accountId": ids["Bình"], "steps": [fail]})
        await invoke(page, "bridge.checkNow", {})
    await go(page, "/accounts")

    def block(alias):
        return page.get_by_role("region", name=f"Cách chạy của {alias}")

    async def state_of(alias):
        b = block(alias)
        t = await text_of(b)
        probe = await b.get_by_role("button", name="Thử HTTP ngay").count()
        return t, probe

    expect = {
        "An": ("Tự động", r"Đang dùng HTTP", False),
        "Bình": ("Tự động", r"HTTP chập chờn \(1 lỗi\)", False),
        "Châu": ("Tự động", r"Đang dùng Giao diện · HTTP lỗi lúc \d\d:\d\d · thử lại \d\d:\d\d", True),
        "Dũng": ("Chỉ HTTP", r"(?<!Giao diện · )HTTP lỗi lúc \d\d:\d\d · thử lại \d\d:\d\d", True),
        "Giang": ("Chỉ giao diện", r"Đang dùng Giao diện", False),
    }
    for alias, (chip, label, probe) in expect.items():
        t, n = await state_of(alias)
        check(f"VIEW-01 {alias}: chip “{chip}”", await block(alias).get_by_text(chip, exact=True).count() == 1, t.replace("\n", " | "))
        check(f"VIEW-01 {alias}: label /{label}/", bool(re.search(label, t)), t.replace("\n", " | "))
        check(f"VIEW-01 {alias}: “Thử HTTP ngay” {'shown' if probe else 'hidden'}", (n == 1) == probe, f"count={n}")
        check(f"VIEW-01 {alias}: load meter 0 of 10", await block(alias).get_by_role("meter", name="Đang làm 0 trên tối đa 10 việc").count() == 1)
    dung = await account(page, "Dũng")
    check("VIEW-01: Dũng (Chỉ HTTP, down) has no active path", dung["execution"]["activePath"] == "none", json.dumps(dung["execution"]))
    chau = await account(page, "Châu")
    check("VIEW-01: Châu (Tự động, down) runs on the UI page", chau["execution"]["activePath"] == "ui")
    sw_note = page.get_by_text("Châu chuyển sang chạy giao diện", exact=True)
    check("PATH-04 (E): notice “Châu chuyển sang chạy giao diện” shown", bool(await wait_until(lambda: _count(sw_note), 5)))
    check("PATH-04 (E): the notice names the reason", await page.get_by_text("không kết nối được", exact=True).count() >= 1)
    check("PATH-05 (E): no switch notice for the Chỉ HTTP account", await page.get_by_text("Dũng chuyển sang chạy giao diện", exact=False).count() == 0)
    def switches(alias):
        return [l for l in _log_lines() if "path.switch" in l and ids[alias] in l and '"ui"' in l]
    await wait_until(lambda: _async(len(switches("Châu")) >= 1), 8)
    check("PATH-04 (E): exactly one switch to the UI page for Châu in the app log", len(switches("Châu")) == 1, f"{len(switches('Châu'))}")
    check("PATH-05 (E): no switch to the UI page for Dũng (Chỉ HTTP)", len(switches("Dũng")) == 0)
    await block("An").scroll_into_view_if_needed()
    await shot(page, "v01_states_1")
    await block("Giang").scroll_into_view_if_needed()
    await shot(page, "v01_states_2")

    # “Thử HTTP ngay” on Dũng: probe succeeds (no scripted failure left) → back to HTTP.
    await block("Dũng").get_by_role("button", name="Thử HTTP ngay").click()
    ok = await wait_until(lambda: _label_matches(block("Dũng"), r"Đang dùng HTTP"), 15)
    check("VIEW-01: “Thử HTTP ngay” brings Dũng back to “Đang dùng HTTP”", bool(ok), await text_of(block("Dũng")))
    check("VIEW-01: toast “Dũng: HTTP dùng được”", await page.get_by_text("Dũng: HTTP dùng được", exact=False).count() >= 1)

    # State 6 — HTTP switch off app-wide.
    await invoke(page, "settings.set", {"key": "bridgeHttpEnabled", "value": False})
    await asyncio.sleep(0.8)
    t_an, n_an = await state_of("An")
    t_gi, _ = await state_of("Giang")
    check("VIEW-01 switch off: An “HTTP đã tắt”", "HTTP đã tắt" in t_an, t_an.replace("\n", " | "))
    check("VIEW-01 switch off: Giang “Đang dùng Giao diện”", "Đang dùng Giao diện" in t_gi)
    check("VIEW-01 switch off: no “Thử HTTP ngay” anywhere", await page.get_by_role("button", name="Thử HTTP ngay").count() == 0)
    await block("An").scroll_into_view_if_needed()
    await shot(page, "v01_switch_off")
    await invoke(page, "settings.set", {"key": "bridgeHttpEnabled", "value": True})
    await asyncio.sleep(0.5)

    # State 7 — incompatible (two accounts report a protocol mismatch).
    for alias in ["An", "Bình"]:
        await invoke(page, "__test.gw", {"accountId": ids[alias], "steps": [{"phase": "probe", "error": "protocol_mismatch"}]})
        await invoke(page, "account.probeHttp", {"id": ids[alias]})
    await asyncio.sleep(0.6)
    t_an, _ = await state_of("An")
    check("VIEW-01 incompatible: “Kênh trực tiếp không tương thích”", "Kênh trực tiếp không tương thích" in t_an, t_an.replace("\n", " | "))
    banner = page.get_by_role("status").filter(has_text="Kênh trực tiếp Muse không tương thích — đang chạy qua giao diện")
    check("VIEW-01 incompatible: B-HTTP banner text", await banner.count() == 1)
    await block("An").scroll_into_view_if_needed()
    await shot(page, "v01_incompatible")
    await go(page, "/settings/run")
    alert = page.get_by_role("alert").filter(has_text="Kênh trực tiếp Muse không tương thích. App đang chạy qua giao diện; bấm “Kiểm ngay” sau khi cập nhật.")
    check("VIEW-03: incompatibility alert wording", await alert.count() == 1)
    await shot(page, "v03_incompatible_alert")

    # ================================================================ AC-VIEW-03 — Cài đặt › Chạy việc
    await page.get_by_role("button", name="Kiểm ngay").click()

    async def compat_ok():
        b = (await snap(page))["engine"]["bridge"]
        return b if b["compat"] == "ok" and not b["checking"] else None
    b = await wait_until(compat_ok, 25)
    check("VIEW-03: Kiểm ngay lifts the incompatibility", bool(b))
    res = page.get_by_role("list", name="Kết quả kiểm từng tài khoản")
    rows = await res.get_by_role("listitem").all_inner_texts()
    timed = [r for r in rows if re.search(r"(Đạt|lỗi|Lỗi|fake).*\d\d:\d\d", r.replace("\n", " "))]
    check("VIEW-03: each HTTP account has a result with its time", len(rows) == 4 and len(timed) == 4, " | ".join(r.replace("\n", " ") for r in rows))
    check("VIEW-03: Giang (Chỉ giao diện) is not in the HTTP check list", not any("Giang" in r for r in rows))
    sw = page.get_by_role("switch", name="Kênh trực tiếp (HTTP)")
    await sw.click()
    off = await wait_until(lambda: _setting_is(page, "bridgeHttpEnabled", False), 5)
    aria = await wait_until(lambda: _attr_is(sw, "aria-checked", "false"), 5)
    check("VIEW-03: switch click turns HTTP off", bool(off) and bool(aria), f"saved_off={off} aria={await sw.get_attribute('aria-checked')}")
    kn = page.get_by_role("button", name="Kiểm ngay")
    kn_off = await wait_until(lambda: _disabled(kn), 4)
    check("VIEW-03: Kiểm ngay disabled while off", bool(kn_off), f"count={await kn.count()} disabled={await kn.get_attribute('disabled')} aria={await kn.get_attribute('aria-disabled')}")
    await shot(page, "v03_switch_off")
    await sw.click()
    check("VIEW-03: switch click turns HTTP on again", bool(await wait_until(lambda: _setting_is(page, "bridgeHttpEnabled", True), 5)))
    total = page.get_by_label("Tối đa toàn app", exact=True)
    pages_in = page.get_by_label("Tối đa trang giao diện", exact=True)
    for box, val, key, before in [(total, "101", "globalConcurrency", None), (total, "0", "globalConcurrency", None), (pages_in, "9", "concurrencyUiPages", None), (pages_in, "0", "concurrencyUiPages", None)]:
        before = (await snap(page))["settings"][key]
        await box.fill(val)
        await asyncio.sleep(1.0)
        after = (await snap(page))["settings"][key]
        check(f"VIEW-03: {key} = {val} is not saved", after == before, f"before={before} after={after}")
        await box.fill(str(before))
        await asyncio.sleep(0.8)
    await total.fill("30")
    check("VIEW-03: a valid app-wide limit (30) is saved", bool(await wait_until(lambda: _setting_is(page, "globalConcurrency", 30), 4)))
    await total.fill("40")
    await wait_until(lambda: _setting_is(page, "globalConcurrency", 40), 4)
    await shot(page, "v03_settings_run")

    # ================================================================ AC-VIEW-02 — S07e dialog
    await go(page, "/accounts")
    gear = page.get_by_role("button", name="Đổi cách chạy của An")
    await gear.focus()
    await page.keyboard.press("Enter")
    dlg = page.get_by_role("dialog", name="Cách chạy · An")
    await dlg.wait_for(timeout=5000)
    focused = await page.evaluate("() => document.activeElement?.getAttribute('data-mode')")
    check("VIEW-02: Enter opens the dialog with focus on the current mode", focused == "auto", f"focus={focused}")
    await page.keyboard.press("ArrowDown")
    check("VIEW-02: ArrowDown selects Chỉ HTTP", (await dlg.locator('[data-mode="http"]').get_attribute("aria-checked")) == "true")
    await page.keyboard.press("ArrowUp")
    check("VIEW-02: ArrowUp back to Tự động", (await dlg.locator('[data-mode="auto"]').get_attribute("aria-checked")) == "true")
    order = []
    vis = []
    for _ in range(8):
        await page.keyboard.press("Tab")
        info = await page.evaluate(
            """() => { const e = document.activeElement; const s = getComputedStyle(e);
                return { n: e.getAttribute('aria-label') || e.textContent.trim(), fv: e.matches(':focus-visible'),
                         ring: s.outlineStyle !== 'none' || s.boxShadow !== 'none' }; }"""
        )
        order.append(info["n"])
        vis.append(info["fv"] and info["ring"])
    want = ["Giảm Tối đa việc cùng lúc", "Tối đa việc cùng lúc", "Tăng Tối đa việc cùng lúc", "Giảm Tối đa qua giao diện", "Tối đa qua giao diện", "Tăng Tối đa qua giao diện", "Huỷ", "Lưu"]
    check("VIEW-02: Tab order mode → box 1 → box 2 → Huỷ → Lưu", order == want, " > ".join(order))
    check("VIEW-02: focus is visible on every stop", all(vis), json.dumps(vis))
    inc = dlg.get_by_role("button", name="Tăng Tối đa việc cùng lúc")
    for _ in range(12):
        if await inc.is_disabled():
            break
        await inc.click()
    max_in = dlg.get_by_label("Tối đa việc cùng lúc", exact=True)
    check("VIEW-02: + stops at 20", (await max_in.input_value()) == "20" and await inc.is_disabled())
    inc_ui = dlg.get_by_role("button", name="Tăng Tối đa qua giao diện")
    for _ in range(6):
        if await inc_ui.is_disabled():
            break
        await inc_ui.click()
    ui_in = dlg.get_by_label("Tối đa qua giao diện", exact=True)
    check("VIEW-02: UI + stops at 5", (await ui_in.input_value()) == "5" and await inc_ui.is_disabled())
    save = dlg.get_by_role("button", name="Lưu", exact=True)
    for val in ["0", "21"]:
        await max_in.fill(val)
        err = await dlg.get_by_text("Nhập từ 1 đến 20", exact=True).count()
        check(f"VIEW-02: {val} shows the range and blocks Lưu", err == 1 and await save.is_disabled(), f"err={err}")
    await max_in.fill("6")
    check("VIEW-02: 6 is accepted", await dlg.get_by_text("Nhập từ 1 đến 20", exact=True).count() == 0 and not await save.is_disabled())
    await shot(page, "v02_dialog_values")
    await page.keyboard.press("Escape")
    await asyncio.sleep(0.4)
    a = await account(page, "An")
    check("VIEW-02: Esc = Huỷ, nothing saved", await dlg.count() == 0 and a["maxConcurrent"] == 10 and a["uiMaxConcurrent"] == 2, f"{a['maxConcurrent']}/{a['uiMaxConcurrent']}")
    await gear.focus()
    await page.keyboard.press("Space")
    await dlg.wait_for(timeout=5000)
    await dlg.get_by_label("Tối đa việc cùng lúc", exact=True).fill("6")
    await dlg.get_by_role("button", name="Huỷ", exact=True).focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    saved = await wait_until(lambda: _max_is(page, "An", 6), 5)
    check("VIEW-02: Space opens, Tab → Lưu + Enter saves 6", bool(saved))
    check("VIEW-02: the card shows the new limit at once", bool(await wait_until(lambda: _count(block("An").get_by_role("meter", name="Đang làm 0 trên tối đa 6 việc")), 4)))
    await block("An").scroll_into_view_if_needed()
    await shot(page, "v02_saved")

    # ================================================================ AC-VIEW-04 — Hỏi đáp detail
    html = "<img src=x onerror=alert(1)>"
    reply = f"Kết quả {html} thử.\n```python\nprint(\"xin chao\")\nx = 1\n```\nNguồn: https://example.com/bao-cao."
    await invoke(page, "__test.gw", {"accountId": ids["An"], "replyText": reply})
    req_before = len(requests)
    await invoke(page, "chat.create", {"prompt": "Kiểm hiển thị câu trả lời", "referenceIds": [], "accountPref": ids["An"], "clientRequestId": "view04-0001", "conversationId": None})

    async def done_chat(prompt):
        js = [j for j in await jobs(page, kind="chat") if j["prompt"] == prompt and j["state"] == "completed"]
        return js[0] if js else None
    j4 = await wait_until(lambda: done_chat("Kiểm hiển thị câu trả lời"), 30)
    check("VIEW-04: chat job completed on HTTP", bool(j4) and j4.get("execPath") == "http")
    await go(page, "/queue")
    await page.get_by_role("tab", name="Hỏi đáp", exact=False).first.click()
    await asyncio.sleep(0.5)
    await page.get_by_text("Kiểm hiển thị câu trả lời", exact=True).first.click()
    drawer = page.get_by_role("dialog", name="Chi tiết lượt", exact=False)
    await drawer.wait_for(timeout=5000)
    await asyncio.sleep(0.6)
    dt = await text_of(drawer)
    check("VIEW-04: HTML shown as plain text", html in dt)
    imgs = await page.evaluate("() => document.querySelectorAll('img[src=\"x\"], img[onerror]').length")
    check("VIEW-04: no <img> element created from the answer", imgs == 0, f"imgs={imgs}")
    check("VIEW-04: nothing ran (no alert)", not dialogs, "; ".join(dialogs))
    check("VIEW-04: no request for the answer's image", not any(re.search(r"/x$", u) for u in requests[req_before:]))
    code = drawer.locator("pre code").filter(has_text='print("xin chao")')
    font = await code.evaluate("e => getComputedStyle(e).fontFamily") if await code.count() else ""
    check("VIEW-04: fenced code in a monospace block", await code.count() == 1 and re.search(r"mono|consolas|courier", font, re.I) is not None, font)
    check("VIEW-04: code block keeps its lines", (await code.inner_text() if await code.count() else "") == 'print("xin chao")\nx = 1')
    link = drawer.get_by_role("button", name="https://example.com/bao-cao", exact=True)
    check("VIEW-04: link shown without the trailing dot", await link.count() == 1)
    await shot(page, "v04_drawer_answer")
    await link.click()
    conf = page.get_by_role("dialog", name="Mở liên kết ngoài app?")
    await conf.wait_for(timeout=4000)
    check("VIEW-04: confirmation shows the full URL", "https://example.com/bao-cao" in await text_of(conf))
    check("VIEW-04: nothing opened before confirming", not _opened())
    await shot(page, "v04_link_confirm")
    await conf.get_by_role("button", name="Không", exact=True).click()
    await asyncio.sleep(0.5)
    check("VIEW-04: “Không” opens nothing", not _opened())
    await link.click()
    await conf.wait_for(timeout=4000)
    await conf.get_by_role("button", name="Mở liên kết", exact=True).click()
    check("VIEW-04: “Mở liên kết” opens it (test mode logs the host)", bool(await wait_until(lambda: _async(_opened()), 5)), str(_opened()))
    await drawer.get_by_role("button", name="Chép câu trả lời").click()
    await asyncio.sleep(0.4)
    try:
        clip = await page.evaluate("() => navigator.clipboard.readText()")
    except Exception as e:  # noqa: BLE001
        clip = f"<clipboard read failed: {e}>"
    check("VIEW-04: “Chép câu trả lời” copies result_text exactly", clip == j4.get("resultText") == reply, repr(clip[:80]))
    check("VIEW-04: path badge “Đường chạy · HTTP”", "Đường chạy\nHTTP" in dt or re.search(r"Đường chạy\s+HTTP", dt) is not None)
    tl = drawer.get_by_role("heading", name="Các lần thử")
    items = await drawer.locator("ol li").all_inner_texts()
    check("VIEW-04: attempt timeline with the HTTP path", await tl.count() == 1 and any("HTTP" in i for i in items), " | ".join(i.replace("\n", " ") for i in items))
    await page.keyboard.press("Escape")

    # ================================================================ AC-VIEW-05 — Studio Hỏi đáp
    await invoke(page, "__test.gw", {"accountId": ids["An"], "replyText": "Đã nhận câu hỏi."})
    await go(page, "/")
    await page.get_by_role("radio", name="Hỏi đáp", exact=True).click()
    box = page.get_by_label("Câu hỏi cho Muse")
    files = {
        "doanh-thu.csv": ("text/csv", b"thang,doanh_thu\n1,120\n"),
        "bao-cao.pdf": ("application/pdf", TINY_PDF),
        "bieu-do.png": ("image/png", tiny_png()),
        "cong-cu.exe": ("application/octet-stream", b"MZ\x90\x00" + bytes(60)),
    }
    payload = [{"name": n, "type": t, "b64": base64.b64encode(b).decode()} for n, (t, b) in files.items()]
    await page.evaluate(
        """(files) => {
          const dt = new DataTransfer();
          for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
          const target = document.querySelector('#composer-input');
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        }""",
        payload,
    )
    chips = page.get_by_label("Tệp đính kèm")

    async def three_chips():
        t = await text_of(chips)
        return t if all(n in t for n in ["doanh-thu.csv", "bao-cao.pdf", "bieu-do.png"]) else None
    ct = await wait_until(three_chips, 10)
    check("VIEW-05: CSV, PDF and PNG attach from one drop", bool(ct), (ct or await text_of(chips)).replace("\n", " | "))
    check("VIEW-05: the wrong file is not attached", "cong-cu.exe" not in (await text_of(chips)))
    toast = page.get_by_text("Không đính kèm được “cong-cu.exe”", exact=False)
    check("VIEW-05: the wrong file gets its own error", bool(await wait_until(lambda: _count(toast), 6)))
    check("VIEW-05: counter shows 3/10 tệp", await page.get_by_text("3/10 tệp", exact=True).count() == 1)
    await shot(page, "v05_drop_files")
    send = page.locator("button[aria-label^='Gửi']")
    await box.fill("a" * 32001)
    await asyncio.sleep(0.3)
    lab = await send.get_attribute("aria-label") or ""
    check("VIEW-05: 32 001 characters cannot be sent", await send.is_disabled() and "32.000" in lab, lab)
    n_before = len(await jobs(page, kind="chat"))
    await box.press("Enter")
    await asyncio.sleep(0.6)
    check("VIEW-05: Enter with 32 001 characters creates nothing", len(await jobs(page, kind="chat")) == n_before)
    await shot(page, "v05_too_long")
    await box.fill("Tóm tắt ba tệp đính kèm")
    await page.get_by_role("button", name="Tự động", exact=False).first.click()
    menu = page.get_by_role("menu", name="Tài khoản")
    await menu.wait_for(timeout=5000)
    await menu.get_by_role("menuitemradio", name=re.compile(r"^An\b")).click()
    await box.focus()
    await box.press("Enter")
    await box.press("Enter")
    await send.click(force=True)
    await asyncio.sleep(1.2)
    created = [j for j in await jobs(page, kind="chat") if j["prompt"] == "Tóm tắt ba tệp đính kèm"]
    check("VIEW-05: Gửi creates exactly one chat job", len(created) == 1, f"jobs={len(created)}")
    check("VIEW-05: the job carries the 3 files", bool(created) and len(created[0]["referenceIds"]) == 3)
    await wait_until(lambda: done_chat("Tóm tắt ba tệp đính kèm"), 30)

    # “Hỏi tiếp” while the conversation is busy, then free again.
    await invoke(page, "__test.gw", {"accountId": ids["An"], "completeMs": 12000, "replyText": "Lượt tiếp đã xong."})
    card4 = page.get_by_role("article", name="Lượt: Kiểm hiển thị câu trả lời", exact=False)
    await card4.scroll_into_view_if_needed()
    follow = card4.get_by_role("button", name="Hỏi tiếp")
    check("VIEW-05: “Hỏi tiếp” on when the conversation is free", await follow.count() == 1 and not await follow.is_disabled())
    await follow.click()
    check("VIEW-05: “Tiếp hội thoại · An” chip", await page.get_by_text("Tiếp hội thoại · An", exact=False).count() >= 1)
    await box.fill("Hỏi tiếp lượt hai")
    await box.press("Enter")
    j_follow = await wait_until(lambda: _job_running(page, "Hỏi tiếp lượt hai"), 10)
    check("VIEW-05: follow-up is in the same conversation", bool(j_follow) and j_follow["conversationId"] == j4["conversationId"])
    busy = await wait_until(lambda: _disabled(follow), 6)
    check("VIEW-05: busy → “Hỏi tiếp” off", bool(busy))
    reason = card4.get_by_text("Hội thoại đang có lượt chưa xong — chờ lượt đó xong rồi hỏi tiếp", exact=True)
    check("VIEW-05: busy → reason shown next to it", await reason.count() == 1)
    await box.fill("Chen ngang")
    lab = await send.get_attribute("aria-label") or ""
    check("VIEW-05: busy → composer Gửi off with the same reason", await send.is_disabled() and "Hội thoại đang có lượt chưa xong" in lab, lab)
    await shot(page, "v05_busy")
    acc_an = await account(page, "An")
    check("VIEW-01: load meter counts the running HTTP turn", acc_an["execution"]["runningHttp"] == 1, json.dumps(acc_an["execution"]))
    await wait_until(lambda: done_chat("Hỏi tiếp lượt hai"), 30)
    free = await wait_until(lambda: _enabled(follow), 8)
    check("VIEW-05: free again → “Hỏi tiếp” on", bool(free))
    check("VIEW-05: free again → reason gone", await reason.count() == 0)
    check("VIEW-05: free again → composer Gửi on", not await send.is_disabled())
    await box.fill("")
    await page.get_by_role("button", name="Bỏ tiếp hội thoại, hỏi trong hội thoại mới").click()
    await shot(page, "v05_free")

    # ================================================================ AC-CC-08 (E) — proxy change while an HTTP turn runs
    await invoke(page, "__test.gw", {"accountId": ids["Bình"], "completeMs": 100000, "replyText": "Lượt dài."})
    await invoke(page, "chat.create", {"prompt": "Lượt dài trên Bình", "referenceIds": [], "accountPref": ids["Bình"], "clientRequestId": "cc08-long-0001", "conversationId": None})
    long_job = await wait_until(lambda: _job_state(page, "Lượt dài trên Bình", ("submitted", "generating")), 15)
    check("CC-08 (E): a turn Muse accepted is running on Bình", bool(long_job), json.dumps(long_job)[:200] if long_job else "")
    old_proxy = (await account(page, "Bình"))["proxyId"]
    await go(page, "/accounts")
    await page.get_by_role("button", name="Thao tác cho Bình").click()
    await page.get_by_role("menuitem", name="Đổi proxy").click()
    pd = page.get_by_role("dialog", name="Đổi proxy cho Bình")
    await pd.wait_for(timeout=5000)
    free = pd.get_by_role("radio").filter(has_not_text="đang dùng")
    check("CC-08 (E): the dialog offers the free proxy", await free.count() == 1)
    await free.first.click()
    await pd.get_by_role("button", name="Đổi proxy", exact=True).click()
    waiting = page.get_by_role("dialog", name="Đang chờ Bình xong lượt đang chạy")
    await waiting.wait_for(timeout=5000)
    check("CC-08 (E): waiting dialog with the 60 s countdown", "còn tối đa" in await text_of(waiting))
    await shot(page, "c08_proxy_waiting")
    await invoke(page, "chat.create", {"prompt": "Gửi trong lúc chờ đổi proxy", "referenceIds": [], "accountPref": ids["Bình"], "clientRequestId": "cc08-new-0001", "conversationId": None})
    await asyncio.sleep(3)
    nj = [j for j in await jobs(page, kind="chat") if j["prompt"] == "Gửi trong lúc chờ đổi proxy"]
    check("CC-08 (E): nothing new is sent while waiting", bool(nj) and nj[0]["state"] == "queued", nj[0]["state"] if nj else "missing")
    force = page.get_by_role("dialog", name="Lượt đang tạo chưa xong")
    t0 = time.time()
    await force.wait_for(timeout=80000)
    waited = time.time() - t0 + 3
    check("CC-08 (E): asks “Dừng chờ” after about 60 s", 50 <= waited <= 75, f"{waited:.0f} s")
    await shot(page, "c08_proxy_force")
    await invoke(page, "__test.gw", {"accountId": ids["Bình"], "completeMs": 800, "replyText": "Sau khi đổi proxy."})
    await force.get_by_role("button", name="Dừng chờ và đổi proxy").click()
    changed = await wait_until(lambda: _proxy_changed(page, "Bình", old_proxy), 10)
    check("CC-08 (E): proxy changed after “Dừng chờ”", bool(changed))
    lj = await wait_until(lambda: _job_state(page, "Lượt dài trên Bình", ("needs_review",)), 10)
    check("CC-08 (E): the accepted turn moves to “Cần anh xem”", bool(lj))
    nd = await wait_until(lambda: _job_state(page, "Gửi trong lúc chờ đổi proxy", ("completed",)), 30)
    check("CC-08 (E): the queued job runs after the change", bool(nd))

    # ================================================================ AC-VIEW-06 — glass modes, names, contrast, motion
    regions = ['section[aria-label^="Cách chạy"]', '[role="dialog"]', 'main']
    for mode in ["full", "light", "solid"]:
        await invoke(page, "settings.set", {"key": "displayMode", "value": mode})
        await asyncio.sleep(0.5)
        got = await page.evaluate("() => document.documentElement.dataset.glass")
        check(f"VIEW-06 {mode}: glass mode applied", got == mode, f"data-glass={got}")
        await go(page, "/accounts")
        c1 = await page.evaluate(CONTRAST_JS, ['section[aria-label^="Cách chạy"]'])
        await page.get_by_role("button", name="Đổi cách chạy của Bình").click()
        await page.get_by_role("dialog", name="Cách chạy · Bình").wait_for(timeout=4000)
        c2 = await page.evaluate(CONTRAST_JS, ['[role="dialog"]'])
        unnamed = await page.evaluate(UNNAMED_JS, ['[role="dialog"]', 'section[aria-label^="Cách chạy"]'])
        await shot(page, f"v06_{mode}_dialog")
        await page.keyboard.press("Escape")
        await go(page, "/settings/run")
        c3 = await page.evaluate(CONTRAST_JS, ["main"])
        unnamed += await page.evaluate(UNNAMED_JS, ["main"])
        await go(page, "/")
        c4 = await page.evaluate(CONTRAST_JS, ['article[aria-label^="Lượt"]'])
        await shot(page, f"v06_{mode}_studio")
        fails = c1["fails"] + c2["fails"] + c3["fails"] + c4["fails"]
        checked = c1["checked"] + c2["checked"] + c3["checked"] + c4["checked"]
        mins = [c["min"] for c in (c1, c2, c3, c4)]
        unparsed = c1['unparsed'] + c2['unparsed'] + c3['unparsed'] + c4['unparsed']
        check(f"VIEW-06 {mode}: text contrast ≥ 4.5:1 (large ≥ 3:1)", not fails and checked > 50 and unparsed == 0, f"checked={checked} min={min(mins)} unparsed={unparsed} {(c1['samples'] + c3['samples'])[:2]} fails={fails[:4]}")
        check(f"VIEW-06 {mode}: every control has a name", not unnamed, "; ".join(unnamed[:3]))
    await invoke(page, "settings.set", {"key": "displayMode", "value": "auto"})
    await go(page, "/accounts")
    radios = await page.evaluate("() => 0")
    await page.get_by_role("button", name="Đổi cách chạy của Bình").click()
    dlg_b = page.get_by_role("dialog", name="Cách chạy · Bình")
    await dlg_b.wait_for(timeout=4000)
    names = [await r.get_attribute("aria-checked") is not None and (await r.inner_text()).split("\n")[0] for r in await dlg_b.get_by_role("radio").all()]
    check("VIEW-06: mode choices are named radios", names == ["Tự động", "Chỉ HTTP", "Chỉ giao diện"], json.dumps(names, ensure_ascii=False))
    check("VIEW-06: number boxes are labelled", await dlg_b.get_by_label("Tối đa việc cùng lúc", exact=True).count() == 1 and await dlg_b.get_by_label("Tối đa qua giao diện", exact=True).count() == 1)
    await page.keyboard.press("Escape")
    del radios
    await page.emulate_media(reduced_motion="reduce")
    await asyncio.sleep(0.3)
    motion = await page.evaluate(
        """() => {
          const fill = document.querySelector('[role=meter] > div');
          const s = fill ? getComputedStyle(fill) : null;
          const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length;
          return { transition: s ? s.transitionDuration : null, running };
        }"""
    )
    check("VIEW-06: reduced motion — meter has no transition", motion["transition"] in ("0s", "1e-06s", "0.000001s"), json.dumps(motion))
    check("VIEW-06: reduced motion — no endless animation running", motion["running"] == 0, json.dumps(motion))
    await page.emulate_media(reduced_motion="no-preference")
    # Windows “Show animations” off reaches the page as html[data-motion="reduce"] (engine.osReducedMotion).
    motion2 = await page.evaluate(
        """() => { document.documentElement.dataset.motion = 'reduce';
          const fill = document.querySelector('[role=meter] > div'); const t = fill ? getComputedStyle(fill).transitionDuration : null;
          delete document.documentElement.dataset.motion; return t; }"""
    )
    check("VIEW-06: Windows reduced-motion flag — meter has no transition", motion2 in ("0s", "1e-06s", "0.000001s"), str(motion2))

    # AC-GW-07 (E): everything the renderer received, plus the diagnostics bundle, for the leak scan after shutdown.
    seen = {"jobs": await invoke(page, "job.query", {"limit": 200}), "snapshot": await snap(page)}
    seen["conversation"] = await invoke(page, "chat.conversation", {"conversationId": j4["conversationId"]})
    (WORK / "ipc-dump.json").write_text(json.dumps(seen, ensure_ascii=False))
    d = await invoke(page, "diagnostics.export", {})
    check("GW-07 (E): diagnostics bundle exported", bool(d) and Path(d["path"]).exists(), json.dumps(d))

    check("No renderer errors", not errors, "; ".join(errors[:3]))


def _log_lines():
    out = []
    for p in (WORK / "data").rglob("*.log"):
        try:
            out += p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            pass
    return out


def leak_scan():
    """AC-GW-07 (E): Muse thread ids / session ids from the store never appear in logs, IPC data or diagnostics."""
    import sqlite3
    import zipfile
    dbs = [p for p in (WORK / "data").rglob("muse.sqlite") if p.is_file()]  # the app store only (not backups/Chromium caches)
    secrets = set()
    for db in dbs:
        con = sqlite3.connect(str(db))
        try:
            for (v,) in con.execute("SELECT remote_session_id FROM jobs WHERE remote_session_id IS NOT NULL"):
                secrets.add(str(v))
            for (v,) in con.execute("SELECT conversation FROM muse_conversations"):
                secrets.add(str(v))
        except Exception as e:  # noqa: BLE001
            check("GW-07 (E): store readable for the scan", False, repr(e))
        finally:
            con.close()
    check("GW-07 (E): the store holds Muse ids to look for", len(secrets) >= 5, f"{len(secrets)}")
    hay = {"logs": "\n".join(_log_lines()), "ipc": (WORK / "ipc-dump.json").read_text(encoding="utf-8") if (WORK / "ipc-dump.json").exists() else ""}
    diag = ""
    for z in (WORK / "save").glob("*.zip"):
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                diag += zf.read(n).decode("utf-8", errors="ignore")
    hay["diagnostics"] = diag
    check("GW-07 (E): diagnostics bundle has content", len(diag) > 200, f"{len(diag)} chars")
    for where, text in hay.items():
        hits = [x for x in secrets if x and x in text]
        check(f"GW-07 (E): no Muse session/thread id in {where}", not hits, f"{len(hits)} hit(s)")
        bad = re.findall(r"(?i)(notary[_-]?token|access_token|session_token|\bcookie\b)\W{1,4}[A-Za-z0-9._-]{12,}", text)
        check(f"GW-07 (E): no token/cookie value in {where}", not bad, "; ".join(bad[:2]))


async def persistence(page):
    """AC-PATH-01 (E): modes and limits changed in the UI survive an app restart and show on the cards."""
    await go(page, "/accounts")
    s = await snap(page)
    by = {a["alias"]: a for a in s["accounts"]}
    check("PATH-01 (E): after restart An keeps max 6", by["An"]["maxConcurrent"] == 6 and by["An"]["execMode"] == "auto")
    check("PATH-01 (E): after restart Dũng stays Chỉ HTTP, Giang Chỉ giao diện", by["Dũng"]["execMode"] == "http" and by["Giang"]["execMode"] == "ui")
    check("PATH-01 (E): untouched accounts keep auto/10/2", all(by[x]["execMode"] == "auto" and by[x]["maxConcurrent"] == 10 and by[x]["uiMaxConcurrent"] == 2 for x in ["Bình", "Châu"]))
    blk = lambda a: page.get_by_role("region", name=f"Cách chạy của {a}")  # noqa: E731
    check("PATH-01 (E): cards show the kept modes", await blk("Dũng").get_by_text("Chỉ HTTP", exact=True).count() == 1 and await blk("Giang").get_by_text("Chỉ giao diện", exact=True).count() == 1)
    check("PATH-01 (E): An's card shows max 6", await blk("An").get_by_role("meter", name=re.compile(r"trên tối đa 6 việc")).count() == 1)
    await blk("Dũng").scroll_into_view_if_needed()
    await shot(page, "p01_after_restart")


def _opened():
    hits = []
    for p in (WORK / "data").rglob("*.log"):
        try:
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if "openUrl.test" in line:
                    hits.append(line)
        except Exception:
            pass
    return [h for h in hits if "example.com" in h]


async def _async(v):
    return v


async def _label_matches(loc, pattern):
    return re.search(pattern, await text_of(loc)) is not None


async def _setting_is(page, key, value):
    return (await snap(page))["settings"][key] == value


async def _max_is(page, alias, n):
    return (await account(page, alias))["maxConcurrent"] == n


async def _attr_is(loc, name, value):
    return (await loc.get_attribute(name)) == value


async def _count(loc):
    return await loc.count()


async def _disabled(loc):
    return await loc.count() == 1 and await loc.is_disabled()


async def _enabled(loc):
    return await loc.count() == 1 and not await loc.is_disabled()


async def _job_state(page, prompt, states):
    js = [j for j in await jobs(page, kind="chat") if j["prompt"] == prompt and j["state"] in states]
    return js[0] if js else None


async def _proxy_changed(page, alias, old):
    return (await account(page, alias))["proxyId"] not in (None, old)


async def _job_running(page, prompt):
    js = [j for j in await jobs(page, kind="chat") if j["prompt"] == prompt and j["state"] not in ("queued", "completed", "failed", "cancelled")]
    return js[0] if js else None


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    if env.get("NIX_LD_LIBRARY_PATH"):  # nix build machines keep Chromium's shared libraries here
        env["LD_LIBRARY_PATH"] = env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", "")
    (WORK / "save").mkdir(parents=True, exist_ok=True)
    env = dict(env, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), MUSE4AI_TEST_SAVE_DIR=str(WORK / "save"), MUSE4AI_FAKE_GEN_MS="1500", ELECTRON_DISABLE_SECURITY_WARNINGS="1")
    try:
        for phase in ("main", "restart"):
            app = launch(env)
            try:
                async with async_playwright() as p:
                    browser, page = await connect(p)
                    try:
                        await (scenario(page) if phase == "main" else persistence(page))
                    except Exception as e:  # noqa: BLE001
                        check(f"{phase}: finished without an exception", False, repr(e)[:300])
                        await page.screenshot(path=str(OUT / f"zz_fail_{phase}.png"))
                    finally:
                        await browser.close()
            finally:
                stop(app)
            if phase == "main":
                leak_scan()
    finally:
        (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
        passed = sum(1 for r in results if r["ok"])
        print(f"\n{passed}/{len(results)} PASS", flush=True)


asyncio.run(main())
