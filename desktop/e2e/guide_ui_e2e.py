"""
Build 3.0 Guide E2E (Linux build machine): the real Electron app with the in-app Guide and the "For AI agents" card.
Covers the "E" part of AC-APP-GUIDE-01/02/04/05/06/08, AC-APP-OSS-01 and AC-SKILL-04/05/06 (the "V" part — the same
checks on the Windows VPS — is run by the lab capture run, P4).

  GUIDE-01  sidebar item 7 + Ctrl+7 open /guide, item "Guide"/"Hướng dẫn" is current
  GUIDE-02  5 articles opened with zero http(s) requests from the renderer (everything is bundled)
  GUIDE-04  "Open this screen" on "Create an image" goes to /studio
  GUIDE-05  search "hang cho" finds "Queue"; "zzqq" shows no result + 3 suggestions
  GUIDE-06  switching EN → VI keeps the same article, now in Vietnamese
  GUIDE-07  "View on the web" asks first; Cancel opens nothing and the window stays in the app
  GUIDE-08  "?" on Queue opens the Queue article
  OSS-01    Open source chapter lists the app credits and opens the MIT license text
  SKILL-04  "Download skill" saves a ZIP byte-identical to the website's /downloads/muse4ai-skill.zip
  SKILL-05  "Install for Claude Code" → confirm → 5 files under <home>/.claude/skills/muse4ai
  SKILL-06  second install → "Replace?" → Cancel leaves the files untouched

Run from desktop/ after `npm run build`:  python3 e2e/guide_ui_e2e.py
Needs xvfb-run and Python Playwright. Screenshots go to $OUT (default /tmp/e2e-guide/run/img).
"""
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-guide/run"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
WEB = os.environ.get("WEB", "http://localhost:8080")
PORT = 9341
results = []


def check(name, ok, note=""):
    results.append({"check": name, "ok": bool(ok), "note": note})
    print(("PASS " if ok else "FAIL ") + name + (f" — {note}" if note else ""), flush=True)


async def shot(page, name):
    await asyncio.sleep(0.35)
    await page.screenshot(path=str(OUT / f"{name}.png"))


async def invoke(page, cmd, data=None):
    r = await page.evaluate("([c, d]) => window.muse.invoke(c, d)", [cmd, data or {}])
    if isinstance(r, dict) and "ok" in r:
        if not r["ok"]:
            raise RuntimeError(f"{cmd}: {r.get('error')}")
        return r.get("data")
    return r


async def route(page):
    return (await invoke(page, "app.snapshot"))["settings"]["lastRoute"]


async def go(page, r):
    await invoke(page, "__test.navigate", {"route": r})
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


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


async def scenario(page, home, save):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    net = []
    page.on("request", lambda r: net.append(r.url) if r.url.startswith(("http://", "https://")) else None)
    await page.set_viewport_size({"width": 1440, "height": 900})
    await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
    await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
    await invoke(page, "settings.set", {"key": "language", "value": "en"})
    await go(page, "/studio")

    # GUIDE-01: Ctrl+7
    await page.keyboard.press("Control+7")
    await asyncio.sleep(0.8)
    nav = page.get_by_role("navigation", name="Main navigation")
    current = await nav.locator('[aria-current="page"]').inner_text()
    r = await route(page)
    check("GUIDE-01 Ctrl+7 opens /guide with “Guide” current", r == "/guide" and current.strip() == "Guide", f"route={r} current={current!r}")
    await shot(page, "01_guide_en")

    # GUIDE-02: 5 articles, no network
    net.clear()
    for slug in ["install", "create-image", "queue", "connect-overview", "agent-skill"]:
        await go(page, f"/guide/{slug}")
    check("GUIDE-02 5 articles opened with 0 http(s) requests", len(net) == 0, f"{len(net)} requests {net[:3]}")
    h2 = await page.locator("#guide-article h2").first.inner_text()
    check("GUIDE-02 article renders its title", h2.strip() == "Teach your agent with the Muse4AI skill", h2)
    await shot(page, "02_agent_skill_en")

    # GUIDE-04
    await go(page, "/guide/create-image")
    await asyncio.sleep(0.6)
    imgs = await page.evaluate("""() => [...document.querySelectorAll('#guide-article figure img')].map(i => ({ src: i.currentSrc, w: i.naturalWidth, h: i.naturalHeight, alt: i.alt }))""")
    check(
        "GUIDE-03 the article shows its real screenshot from the app bundle (2880×1800, alt text, not http)",
        len(imgs) >= 1 and all(i["w"] == 2880 and i["h"] == 1800 and i["alt"].strip() and not i["src"].startswith("http") for i in imgs),
        json.dumps(imgs)[:300],
    )
    await shot(page, "03_create_image_en")
    await page.get_by_role("button", name="Open this screen").click()
    await asyncio.sleep(0.6)
    check("GUIDE-04 “Open this screen” → /studio", (await route(page)) == "/studio", await route(page))

    # GUIDE-08: "?" on Queue
    await go(page, "/queue")
    await page.get_by_role("button", name="Guide for this screen").first.click()
    await asyncio.sleep(0.6)
    check("GUIDE-08 “?” on Queue → /guide/queue", (await route(page)) == "/guide/queue", await route(page))

    # GUIDE-07: View on web → Cancel
    await page.get_by_role("button", name="View on the web").click()
    dlg = page.get_by_role("dialog")
    await dlg.wait_for(timeout=3000)
    body = await dlg.inner_text()
    await shot(page, "04_view_on_web_confirm")
    await dlg.get_by_role("button", name="Cancel").click()
    await asyncio.sleep(0.4)
    url = page.url
    check("GUIDE-07 “View on the web” asks first with the right URL; Cancel keeps the app", "/docs/queue" in body and url.startswith(("app://", "file://")), f"url={url}")

    # GUIDE-05: search
    await invoke(page, "settings.set", {"key": "language", "value": "vi"})
    await asyncio.sleep(0.8)
    box = page.get_by_placeholder("Tìm bài, ví dụ “hàng chờ”")
    await box.fill("hang cho")
    await asyncio.sleep(0.4)
    hits = await page.locator("#guide-results li").all_inner_texts()
    check("GUIDE-05 “hang cho” finds the Queue article", any(h.startswith("Theo dõi lượt trong Hàng chờ") or "Hàng chờ" in h for h in hits), str(hits[:3]))
    await shot(page, "05_search_vi")
    await box.fill("zzqq")
    await asyncio.sleep(0.4)
    sugg = await page.locator("#guide-results li").count()
    txt = await page.locator("#guide-results").inner_text()
    check("GUIDE-05 “zzqq” → no result + 3 suggestions", sugg == 3 and "zzqq" in txt, f"suggestions={sugg}")
    await shot(page, "06_search_empty_vi")
    await box.fill("")

    # GUIDE-06: language switch keeps the article
    await invoke(page, "settings.set", {"key": "language", "value": "en"})
    await go(page, "/guide/queue")
    en_title = (await page.locator("#guide-article h2").first.inner_text()).strip()
    await invoke(page, "settings.set", {"key": "language", "value": "vi"})
    await asyncio.sleep(0.8)
    vi_title = (await page.locator("#guide-article h2").first.inner_text()).strip()
    r = await route(page)
    check("GUIDE-06 EN → VI keeps the same article in Vietnamese", r == "/guide/queue" and en_title != vi_title and "Hàng chờ" in vi_title, f"{en_title!r} → {vi_title!r}")
    await shot(page, "07_queue_vi")
    await invoke(page, "settings.set", {"key": "language", "value": "en"})
    await asyncio.sleep(0.6)

    # OSS-01
    await go(page, "/guide/open-source")
    await page.get_by_role("button", name="License").first.click()
    dlg = page.get_by_role("dialog")
    await dlg.wait_for(timeout=3000)
    lic = await dlg.inner_text()
    await shot(page, "08_license")
    check("OSS-01 Open source lists credits and opens the MIT license text", "MIT License" in lic and "Permission is hereby granted" in lic, lic[:80])
    await page.keyboard.press("Escape")
    await asyncio.sleep(0.3)

    # SKILL-04: download ZIP
    await go(page, "/guide/agent-skill")
    await page.get_by_role("button", name="Download skill (.zip)").click()
    await asyncio.sleep(1.0)
    zips = list(Path(save).glob("muse4ai-skill-*.zip"))
    web_zip = WORK / "web-skill.zip"
    try:
        urllib.request.urlretrieve(f"{WEB}/downloads/muse4ai-skill.zip", web_zip)
        same = bool(zips) and sha(zips[0]) == sha(web_zip)
        note = f"{zips[0].name if zips else 'none'} {sha(zips[0])[:12] if zips else ''} vs web {sha(web_zip)[:12]}"
    except Exception as e:  # noqa: BLE001
        same, note = False, f"website not reachable: {e}"
    check("SKILL-04 app ZIP is byte-identical to the website ZIP", same, note)

    # SKILL-05: install
    target = Path(home) / ".claude" / "skills" / "muse4ai"
    await page.get_by_role("button", name="Install for Claude Code").click()
    dlg = page.get_by_role("dialog")
    await dlg.wait_for(timeout=3000)
    shown = await dlg.inner_text()
    await shot(page, "09_install_confirm")
    await dlg.get_by_role("button", name="Install", exact=True).click()
    await asyncio.sleep(1.0)
    files = sorted(str(p.relative_to(target)) for p in target.rglob("*") if p.is_file()) if target.exists() else []
    src = {f: sha(ROOT.parent / "agent-kit" / "muse4ai" / f) for f in files}
    ok = len(files) == 5 and all(sha(target / f) == src[f] for f in files) and str(target) in shown
    check("SKILL-05 install writes 5 files with matching hashes; dialog shows the folder", ok, ", ".join(files))
    await shot(page, "10_installed_toast")

    # SKILL-06: replace → cancel
    (target / "SKILL.md").write_text("changed by the user")
    before = sha(target / "SKILL.md")
    await page.get_by_role("button", name="Install for Claude Code").click()
    dlg = page.get_by_role("dialog")
    await dlg.wait_for(timeout=3000)
    title = await dlg.inner_text()
    await shot(page, "11_replace_confirm")
    await dlg.get_by_role("button", name="Cancel").click()
    await asyncio.sleep(0.5)
    check("SKILL-06 existing skill → “Replace?”; Cancel leaves the file untouched", "Replace the existing skill?" in title and sha(target / "SKILL.md") == before)

    check("no page errors", not errors, "; ".join(errors[:3]))


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    home = WORK / "home"
    save = WORK / "save"
    home.mkdir(parents=True)
    save.mkdir(parents=True)
    env = dict(os.environ)
    if env.get("NIX_LD_LIBRARY_PATH"):
        env["LD_LIBRARY_PATH"] = env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", "")
    env = dict(env, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), MUSE4AI_TEST_SAVE_DIR=str(save), MUSE4AI_TEST_HOME=str(home), ELECTRON_DISABLE_SECURITY_WARNINGS="1")
    app = launch(env)
    try:
        async with async_playwright() as p:
            browser, page = await connect(p)
            try:
                await scenario(page, home, save)
            except Exception as e:  # noqa: BLE001
                check("finished without an exception", False, repr(e)[:300])
                await page.screenshot(path=str(OUT / "zz_fail.png"))
            finally:
                await browser.close()
    finally:
        stop(app)
        (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
        passed = sum(1 for r in results if r["ok"])
        print(f"\n{passed}/{len(results)} PASS", flush=True)


asyncio.run(main())
