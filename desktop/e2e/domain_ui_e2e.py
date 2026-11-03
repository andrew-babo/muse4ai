"""
Phase 9 E2E (Linux build machine): real Electron app, real Settings › API & agent UI, real Quick Tunnel and real
Caddy download; fake Muse. Covers AC-DOM-16 / 17 / 19 (E) plus the port-443-busy path of AC-DOM-05a in the UI.

Run from desktop/ after `npm run build`:  python3 e2e/domain_ui_e2e.py  (needs xvfb-run + Python Playwright)
Screenshots go to $OUT (default /tmp/e2e-dom/img); IPv4 addresses are masked before every screenshot.
"""
import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(os.environ.get("WORK", "/tmp/e2e-dom"))
OUT = Path(os.environ.get("OUT", str(WORK / "img")))
PORT = 9333
DOMAIN = "api.muse4ai-e2e.example.com"
results = []


def check(name, ok, note=""):
    results.append({"check": name, "ok": bool(ok), "note": note})
    print(("PASS " if ok else "FAIL ") + name + (f" — {note}" if note else ""), flush=True)


def caddy_procs():
    out = subprocess.run(["pgrep", "-af", "caddy-2.11.7"], capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if "pgrep" not in l]


async def mask_and_shot(page, name):
    # A MutationObserver keeps public IPv4 addresses masked even when React re-renders the text before the shot.
    await page.evaluate(
        """() => {
      const mask = (t) => t.replace(/\\b(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\b/g, (m, a) => (a === '127' ? m : '203.0.113.x'));
      const run = (root) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) { const v = mask(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
      };
      run(document.body);
      if (!window.__ipMask) {
        window.__ipMask = new MutationObserver((ms) => { for (const m of ms) run(m.target.nodeType === 3 ? m.target.parentNode || document.body : m.target); });
        window.__ipMask.observe(document.body, { subtree: true, childList: true, characterData: true });
      }
    }"""
    )
    await asyncio.sleep(0.2)
    await page.screenshot(path=str(OUT / f"{name}.png"))


async def tab_to(page, predicate_js, max_tabs=80, shift=False):
    for _ in range(max_tabs):
        if await page.evaluate(predicate_js):
            return True
        await page.keyboard.press("Shift+Tab" if shift else "Tab")
    return await page.evaluate(predicate_js)


async def invoke(page, cmd, data=None):
    return await page.evaluate("([c, d]) => window.muse.invoke(c, d)", [cmd, data or {}])


async def wait_text(page, text, ms=90000):
    await page.get_by_text(text, exact=False).first.wait_for(timeout=ms)


async def main():
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    # Another program holds TCP 443 (AC-DOM-05a): the app must refuse to start Caddy and leave it alone.
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    blocker.bind(("0.0.0.0", 443))
    blocker.listen(5)
    env = dict(os.environ, MUSE4AI_TEST="1", MUSE4AI_DATA=str(WORK / "data"), ELECTRON_DISABLE_SECURITY_WARNINGS="1")
    if env.get("NIX_LD_LIBRARY_PATH") and env["NIX_LD_LIBRARY_PATH"] not in env.get("LD_LIBRARY_PATH", ""):  # nix machines keep Chromium's libraries here
        env["LD_LIBRARY_PATH"] = env["NIX_LD_LIBRARY_PATH"] + ":" + env.get("LD_LIBRARY_PATH", "")
    app = subprocess.Popen(
        ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", str(ROOT / "node_modules/electron/dist/electron"), "--no-sandbox", f"--remote-debugging-port={PORT}", "."],
        cwd=str(ROOT), env=env, stdout=open(WORK / "app.log", "w"), stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
            page = None
            for _ in range(60):
                for ctx in browser.contexts:
                    for pg in ctx.pages:
                        try:
                            if await pg.evaluate("() => !!window.muse"):
                                page = pg
                        except Exception:
                            pass
                if page:
                    break
                await asyncio.sleep(0.5)
            assert page, "app window not found"
            # The frameless window's content area at the 1024 × 728 minimum (Electron's CDP has no window bounds API).
            await page.set_viewport_size({"width": 1024, "height": 728})
            await invoke(page, "settings.set", {"key": "riskAccepted", "value": True})
            await invoke(page, "settings.set", {"key": "onboardingStep", "value": 4})
            await invoke(page, "__test.navigate", {"route": "/settings/api"})
            await page.get_by_role("switch", name="Bật API cho agent").click()
            await wait_text(page, "Đang chạy", 15000)
            # Quick tunnel (real Cloudflare) so the tunnel is online while the domain waits.
            await page.get_by_role("radio", name="Đường hầm tạm thời").click()
            await page.get_by_role("button", name="Mở ra Internet").click()
            await page.locator("code", has_text="trycloudflare.com").first.wait_for(timeout=120000)
            check("Đường hầm tạm thời trực tuyến (Cloudflare thật)", True)
            check("Nhãn chế độ mới: Chỉ máy này / Mạng riêng / Đường hầm tạm thời / Đường hầm có tên",
                  all([await page.get_by_role("radio", name=n).count() == 1 for n in ["Chỉ máy này", "Mạng riêng", "Đường hầm tạm thời", "Đường hầm có tên"]]))

            # ---- keyboard only from here (AC-DOM-16)
            await page.get_by_role("radio", name="Đường hầm tạm thời").focus()
            ok = await tab_to(page, "() => document.activeElement && document.activeElement.id === 'domain-host'")
            check("Tab tới ô Tên miền", ok)
            await page.keyboard.type(f"https://{DOMAIN.upper()}/v1/")
            ok = await tab_to(page, "() => document.activeElement && document.activeElement.textContent.trim() === 'App tự chạy HTTPS'", 5)
            check("Tab tới kiểu App tự chạy HTTPS", ok)
            ok = await tab_to(page, "() => document.activeElement && document.activeElement.textContent.trim() === 'Bật tên miền'", 5)
            check("Tab tới nút Bật tên miền", ok)
            await page.keyboard.press("Enter")
            await page.get_by_role("dialog").wait_for(timeout=5000)
            dlg = await page.get_by_role("dialog").inner_text()
            check("Hộp “Mở API ra Internet?” trước khi bật", "Mở API ra Internet?" in dlg and DOMAIN in dlg, DOMAIN)
            await mask_and_shot(page, "e9_confirm_domain")
            focused = await page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
            check("Focus ở nút Mở ra Internet", focused == "Mở ra Internet", str(focused))
            await page.keyboard.press("Enter")
            st = None
            for _ in range(240):
                st = (await invoke(page, "api.status"))["data"]
                if st["domain"]["state"] == "error":
                    break
                await asyncio.sleep(0.5)
            check("Lưu tên miền đã chuẩn hoá", st["domain"]["host"] == DOMAIN, st["domain"]["host"])
            check("Tải Caddy thật + kiểm mã, rồi dừng vì cổng 443 bận (AC-DOM-05a)", st["domain"]["state"] == "error" and st["domain"]["error"].startswith("Cổng 443 đang bị chương trình khác dùng"), st["domain"]["error"] or "")
            check("Không có tiến trình Caddy khi 443 bận", caddy_procs() == [], str(caddy_procs()))
            check("Tệp caddy đã tải đúng chỗ", (WORK / "data/local/bin/caddy-2.11.7").exists())
            check("Đường hầm vẫn Trực tuyến trong lúc tên miền lỗi", st["tunnel"]["state"] == "online")
            await wait_text(page, "Cổng 443 đang bị chương trình khác dùng", 10000)
            labels = await page.get_by_label("Các bước kiểm tên miền").inner_text()
            check("4 bước kiểm đúng nhãn", all(x in labels for x in ["Bản ghi DNS", "Cổng 80/443 trên máy", "Chứng chỉ HTTPS", "Gọi thử đúng app"]), "Bản ghi DNS · Cổng 80/443 trên máy · Chứng chỉ HTTPS · Gọi thử đúng app")
            await mask_and_shot(page, "e9_domain_port443_tunnel_online")
            # Copy the A record IP and the firewall command with the keyboard.
            ok = await tab_to(page, "() => /Chép (IP cho bản ghi A|tên miền)/.test(document.activeElement?.getAttribute('aria-label') || '')", 60)
            check("Tab tới nút chép IP bản ghi A", ok)
            await page.keyboard.press("Enter")
            await wait_text(page, "Đã chép", 5000)
            ok = await tab_to(page, "() => document.activeElement?.textContent?.includes('Tường lửa Windows')", 10)
            await page.keyboard.press("Enter")
            ok2 = await tab_to(page, "() => document.activeElement?.getAttribute('aria-label') === 'Chép lệnh mở tường lửa'", 10)
            check("Mở và chép lệnh tường lửa bằng bàn phím", ok and ok2)
            await page.keyboard.press("Enter")
            fw = await page.locator("code", has_text="New-NetFirewallRule").first.inner_text()
            check("Lệnh tường lửa chỉ cho tệp Caddy của app, cổng 80,443", "caddy-2.11.7" in fw and "-LocalPort 80,443" in fw, fw[:160])
            ok = await tab_to(page, "() => document.activeElement?.textContent?.trim() === 'Kiểm lại ngay'", 60, shift=True)
            check("Tab tới Kiểm lại ngay", ok)
            # Focus ring visible on the focused control (checked before Enter disables the button while checking).
            ring = await page.evaluate("() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth, s.outlineColor].join(' '); }")
            # 2px accent outline (rendered ≈ 1.9px when the window is zoomed to fit 1024 px).
            m = re.match(r"solid ([\d.]+)px rgb\(46, 99, 230\)", ring)
            check("Viền focus rõ (2px màu nhấn)", bool(m) and float(m.group(1)) >= 1.5, ring)
            await page.keyboard.press("Enter")
            await asyncio.sleep(1.5)
            hs = await page.evaluate("() => { const els=[document.documentElement, ...document.querySelectorAll('main, [data-scroll], .scroll-area')]; return els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.tagName + '.' + e.className).slice(0,5); }")
            check("Không cuộn ngang ở 1024 × 728", hs == [], str(hs))

            # ---- agent card (AC-DOM-17)
            picker = page.get_by_role("radiogroup", name="Địa chỉ cho agent")
            await picker.scroll_into_view_if_needed()
            checked = await picker.locator("[aria-checked=true]").inner_text()
            check("Mặc định là địa chỉ đường hầm", checked.startswith("Đường hầm"), checked)
            dom_btn = picker.get_by_role("radio", name=re.compile("^Tên miền"))
            dom_label = await dom_btn.inner_text()
            check("Danh sách có Tên miền · chưa trực tuyến", "chưa trực tuyến" in dom_label, dom_label.replace("\n", " "))
            await dom_btn.focus()
            await page.keyboard.press("Enter")
            await wait_text(page, "Địa chỉ này chưa trực tuyến", 5000)
            check("Chọn Tên miền → cảnh báo chưa trực tuyến", True)
            tabs = await page.get_by_role("tablist", name="Mẫu kết nối agent").inner_text()
            check("Mẫu có Python, Codex CLI, Gemini CLI", all(x in tabs for x in ["Python", "Codex CLI", "Gemini CLI"]), tabs.replace("\n", " "))
            for t in ["Python", "Codex CLI", "Gemini CLI"]:
                await page.get_by_role("tab", name=t).click()
                code = await page.locator("pre").last.inner_text()
                check(f"Mẫu {t} dùng đúng địa chỉ tên miền", f"https://{DOMAIN}" in code)
            fb = await page.get_by_text("Dự phòng", exact=True).count()
            check("Có ghi chú dự phòng cùng Idempotency-Key", fb == 1 and await page.get_by_text("cùng Idempotency-Key", exact=False).count() >= 1)
            await mask_and_shot(page, "e9_agent_address_domain_selected")

            # ---- external proxy (AC-DOM-19)
            await page.get_by_role("button", name="Tắt tên miền").click()
            await wait_text(page, "Đã tắt tên miền", 5000)
            st = (await invoke(page, "api.status"))["data"]
            check("Tắt tên miền → đường hầm vẫn Trực tuyến", st["tunnel"]["state"] == "online" and st["domain"]["state"] == "off")
            # The proxy choice is a radio group: one Tab stop (the checked option), arrow keys change it.
            ok = await tab_to(page, "() => document.activeElement?.textContent?.trim() === 'App tự chạy HTTPS'", 80)
            await page.keyboard.press("ArrowRight")
            ok = ok and await page.evaluate("() => document.activeElement?.textContent?.trim() === 'Proxy HTTPS có sẵn' && document.activeElement.getAttribute('aria-checked') === 'true'")
            check("Mũi tên chọn “Proxy HTTPS có sẵn” trong nhóm lựa chọn", ok)
            await page.get_by_role("button", name="Bật tên miền").click()
            await page.get_by_role("button", name="Mở ra Internet").click()
            for _ in range(60):
                st = (await invoke(page, "api.status"))["data"]
                if st["domain"]["checkedAt"]:
                    break
                await asyncio.sleep(0.5)
            d = st["domain"]
            check("Proxy có sẵn: không chạy Caddy", caddy_procs() == [] and d["proxy"] == "external", str(caddy_procs()))
            check("Proxy có sẵn: bỏ bước cổng, còn 3 bước", d["steps"]["port"]["state"] == "skip", json.dumps({k: v["state"] for k, v in d["steps"].items()}))
            check("DNS chưa có bản ghi → chờ", d["steps"]["dns"]["state"] == "running" and DOMAIN in (d["steps"]["dns"]["detail"] or ""), d["steps"]["dns"]["detail"] or "")
            port = st["port"]
            await page.get_by_role("radio", name="Caddy").click()
            c1 = await page.locator("pre", has_text="reverse_proxy").first.inner_text()
            await page.get_by_role("radio", name="nginx").click()
            c2 = await page.locator("pre", has_text="proxy_pass").first.inner_text()
            check("Mẫu Caddy và nginx đúng 127.0.0.1:{cổng}", f"127.0.0.1:{port}" in c1 and f"http://127.0.0.1:{port}" in c2 and "proxy_set_header Host $host" in c2)
            await mask_and_shot(page, "e9_domain_external")
            await page.get_by_role("switch", name="Bật API cho agent").click()
            await wait_text(page, "Proxy của anh vẫn chạy, sẽ trả lỗi 502", 10000)
            check("Tắt API → ghi chú proxy của anh trả 502", True)
            await mask_and_shot(page, "e9_api_off_external_note")
            try:
                await invoke(page, "__test.trayQuit")
            except Exception:
                pass
    finally:
        time.sleep(2)
        try:
            os.killpg(app.pid, 15)
        except Exception:
            pass
        blocker.close()
    passed = sum(r["ok"] for r in results)
    (WORK / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\n{passed}/{len(results)} PASS")
    sys.exit(0 if passed == len(results) else 1)


asyncio.run(main())
