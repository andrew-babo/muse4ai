// Guide screenshots + Windows checks for Build 3.0 (R3-SHOT, AC-APP-GUIDE/SKILL V), run INSIDE an isolated
// MUSE4AI_TEST=1 lab copy of the app on Windows: load it through the lab main-process inspector with
// new Function("require","module","exports", src)(process.mainModule.require, m, m.exports), then call
// m.exports.run(cfg). It drives the window with CDP, writes PNGs + capture-log.jsonl + run.log into cfg.shotsDir
// and never needs a long-lived remote connection. Synthetic lab profile only — never the live app.
const fs = require("fs");
const path = require("path");
const { BrowserWindow } = require("electron");

const REDACT = String.raw`(lab) => {
  const esc = (s) => s.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  const rules = [
    [new RegExp(esc(lab + '\\data\\pictures'), 'gi'), '%USERPROFILE%\\Pictures'],
    [new RegExp(esc(lab + '\\data\\roaming'), 'gi'), '%APPDATA%\\MuseStudio'],
    [new RegExp(esc(lab + '\\data\\local'), 'gi'), '%LOCALAPPDATA%\\MuseStudio'],
    [new RegExp(esc(lab + '\\data'), 'gi'), '%APPDATA%\\MuseStudio'],
    [new RegExp(esc(lab + '\\home'), 'gi'), '%USERPROFILE%'],
    [new RegExp(esc(lab + '\\save'), 'gi'), '%USERPROFILE%\\Downloads'],
    [new RegExp(esc(lab + '\\app'), 'gi'), '%LOCALAPPDATA%\\Programs\\Muse4AI'],
    [new RegExp(esc(lab), 'gi'), '%USERPROFILE%'],
    [/C:\\Users\\[^\\\s"]+/gi, '%USERPROFILE%'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'Muse account'],
    [/msk_(?!YOUR_KEY)[A-Za-z0-9_\-]{4,}/g, 'msk_••••••••••••'],
    [/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/gi, 'https://your-tunnel.trycloudflare.com'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => (/^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(m) ? m : '203.0.113.10')],
    [/127\.0\.0\.1:47823/g, '127.0.0.1:47821'],
  ];
  let n = 0;
  const fix = (s) => { let o = s; for (const [re, to] of rules) o = o.replace(re, (...a) => { n++; return typeof to === 'function' ? to(a[0]) : to; }); return o; };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = tw.nextNode(); t; t = tw.nextNode()) { const v = fix(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; }
  for (const el of document.querySelectorAll('input, textarea')) {
    const v = fix(el.value || ''); if (v !== el.value) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); }
    const p = fix(el.placeholder || ''); if (p !== el.placeholder) el.placeholder = p;
  }
  for (const el of document.querySelectorAll('[title]')) { const v = fix(el.title); if (v !== el.title) el.title = v; }
  return n;
}`;

// Vietnamese letters actually visible on screen (screen-reader-only text excluded) — exact, unlike OCR.
const DOM_VI = String.raw`(() => { const re = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i; const out = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { const v = n.nodeValue; if (!re.test(v)) continue;
    const pe = n.parentElement; const pb = pe.getBoundingClientRect(); if (pe.closest('.sr-only') || pb.width < 2 || pb.height < 2) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
    if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
    const st = getComputedStyle(pe); if (st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    v.replace(/Tiếng Việt/g, ' ').split(/\s+/).filter((w) => re.test(w)).forEach((w) => out.add(w)); }
  return [...out].slice(0, 30); })()`;

const HELPERS = String.raw`(() => { if (window.__c) return 1; window.__c = {
  name(e) { return (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim(); },
  vis(e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; },
  find(sel, name, exact = true) { return [...document.querySelectorAll(sel)].filter((e) => this.vis(e) && (name == null || (exact ? this.name(e) === name : this.name(e).toLowerCase().includes(name.toLowerCase())))); },
  click(sel, name, exact = true, idx = 0) { const els = this.find(sel, name, exact); if (!els.length) throw new Error('not found: ' + sel + ' ' + name); els[idx < 0 ? els.length + idx : idx].click(); return els.length; },
  count(sel, name, exact = true) { return this.find(sel, name, exact).length; },
  fill(el, text) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); },
  scrollTo(e) { let p = e.parentElement; while (p && !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement; if (p) p.scrollTop += e.getBoundingClientRect().top - p.getBoundingClientRect().top - 8; document.scrollingElement.scrollTop = 0; },
  box(e) { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
}; return 1; })()`;

const L = {
  en: { image: "Image", video: "Video", chat: "Chat", fromText: "From text", fromImage: "From image (edit image)", fromImageShort: "From image", addAccount: "Add account", execFor: "Change execution method for Account A",
    createKey: "Create key", copiedClose: "Copied, close", checkList: "Check list", close: "Close", batchName: "Cafe menu set", keyName: "Cursor", batchPlaceholder: "Example: October coffee images",
    remote: "Allow calls from other computers", agents: "Connect an agent", removeRef: "Remove reference image 1", libItem: "Image:", recovered: /^Recovered \d+ jobs?/,
    refPrompt: "Place this mug on a light terrazzo countertop with soft side light, keep the glaze color and handle.",
    editVideoMode: "Edit video (MP4 → video)", extendVideo: "Extend video", videoItem: "Video:",
    editVideoShort: "Edit video", fromTextVideo: "Video from text", extendSheet: "Extend Muse video",
    editPrompt: "Make the afternoon light warmer and add a slow push-in at the end." },
  vi: { image: "Ảnh", video: "Video", chat: "Hỏi đáp", fromText: "Từ chữ", fromImage: "Từ ảnh (sửa ảnh)", fromImageShort: "Từ ảnh", addAccount: "Thêm tài khoản", execFor: "Đổi cách chạy của Account A",
    createKey: "Tạo khoá", copiedClose: "Đã chép, đóng", checkList: "Kiểm danh sách", close: "Đóng", batchName: "Bộ ảnh menu quán cà phê", keyName: "Codex", batchPlaceholder: "Ví dụ: Bộ ảnh cà phê tháng 10",
    remote: "Cho máy khác gọi tới", agents: "Kết nối agent", removeRef: "Bỏ ảnh tham chiếu 1", libItem: "Ảnh:", recovered: /^Đã khôi phục \d+ lượt/,
    refPrompt: "Đặt chiếc cốc này trên mặt bàn đá terrazzo sáng màu, ánh sáng dịu từ bên cạnh, giữ màu men và quai cốc.",
    editVideoMode: "Sửa video (MP4 → video)", extendVideo: "Kéo dài video", videoItem: "Video:",
    editVideoShort: "Sửa video", fromTextVideo: "Video từ chữ", extendSheet: "Kéo dài video Muse",
    editPrompt: "Cho ánh chiều ấm hơn và thêm một cú đẩy máy chậm ở cuối." },
};

exports.run = async function run(cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => fs.appendFileSync(path.join(cfg.shotsDir, "run.log"), new Date().toISOString() + " " + a.join(" ") + "\n");
  const win = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith("app://bundle/index.html"));
  const wc = win.webContents;
  if (win.isMinimized()) win.restore();
  win.show();
  wc.setBackgroundThrottling(false);
  const d = wc.debugger;
  if (!d.isAttached()) d.attach("1.3");
  const emulate = () => d.sendCommand("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await emulate();
  const page = async (js) => wc.executeJavaScript(js, true);
  const c = async (expr) => { await page(HELPERS); return page(`window.__c.${expr}`); };
  const inv = async (cmd, data) => {
    const r = await page(`window.muse.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(data || {})})`);
    if (r && typeof r === "object" && "ok" in r) { if (!r.ok) throw new Error(cmd + ": " + JSON.stringify(r.error)); return r.data; }
    return r;
  };
  const go = async (route, wait = 900) => { await inv("__test.navigate", { route }); await sleep(wait); };
  const lang = async (code) => { await inv("settings.set", { key: "language", value: code }); await sleep(900); };
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await d.sendCommand("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); await sleep(450); };
  const escape = () => key("Escape", "Escape", 27);
  const mouse = async (x, y) => { await d.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); };
  const fillLast = async (sel, text) => { await page(HELPERS); await page(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; window.__c.fill(els[els.length - 1], ${JSON.stringify(text)}); })()`); await sleep(250); };
  const fillFirst = async (sel, text) => { await page(HELPERS); await page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); window.__c.fill(el, ${JSON.stringify(text)}); })()`); await sleep(250); };
  const only = new Set(cfg.only || []);
  const skip = new Set(cfg.skip || []);
  const results = [];

  const shoot = async (id, loc, cropJs) => {
    if (skip.has(`${id}.${loc}`) || (only.size && !only.has(id))) { log("skip", id, loc); return; }
    await emulate();
    await sleep(cfg.settle || 900);
    let red = await page(`(${REDACT})(${JSON.stringify(cfg.lab)})`);
    await sleep(250);
    const params = { format: "png" };
    let clip = null;
    if (cropJs) {
      const b = await page(cropJs);
      const pad = 12;
      clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad, scale: 1 };
      params.clip = clip;
    }
    const domVi = loc === "en" ? await page(DOM_VI) : [];
    const s = await d.sendCommand("Page.captureScreenshot", params);
    const buf = Buffer.from(s.data, "base64");
    fs.writeFileSync(path.join(cfg.shotsDir, `${id}.${loc}.png`), buf);
    const rec = { id, locale: loc, file: `${id}.${loc}.png`, redactions: red, bytes: buf.length, clip, at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), domVi };
    fs.appendFileSync(path.join(cfg.shotsDir, "capture-log.jsonl"), JSON.stringify(rec) + "\n");
    results.push(rec);
    log("shot", id, loc, "redactions", red, "bytes", buf.length, "domVi", JSON.stringify(domVi));
  };

  const prep = async (loc) => {
    await lang(loc);
    await emulate();
    await sleep(500);
    const t = L[loc];
    const closed = await page(`(() => { const re = ${t.recovered.toString()}; let n = 0; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let x = tw.nextNode(); x; x = tw.nextNode()) { if (!re.test(x.nodeValue.trim())) continue; let p = x.parentElement; while (p && !p.querySelector('button')) p = p.parentElement; if (p) { const b = p.querySelectorAll('button'); b[b.length - 1].click(); n++; } }
      return n; })()`);
    if (closed) log("dismissed recovery notice", closed);
  };

  const radio = async (name) => { await c(`click('[role=radio]', ${JSON.stringify(name)})`); await sleep(350); };
  const button = async (name, exact = true, idx = 0) => { await c(`click('button', ${JSON.stringify(name)}, ${exact}, ${idx})`); await sleep(450); };
  const menuItem = async (name) => { await c(`click('[role^=menuitem]', ${JSON.stringify(name)}, false)`); await sleep(400); };

  const pasteRefs = async (files) => {
    for (const f of files) {
      const b64 = fs.readFileSync(f).toString("base64");
      await page(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), (ch) => ch.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bin], ${JSON.stringify(path.basename(f))}, { type: 'image/webp' }));
        const ta = [...document.querySelectorAll('textarea')].pop(); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return 1; })()`);
      await sleep(1600);
    }
  };

  // Studio › Video accepts an MP4 only through the file picker (pasting is images-only), so the file goes onto the hidden input.
  const attachVideo = async (file) => {
    const b64 = fs.readFileSync(file).toString("base64");
    const ok = await page(`(() => { const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), (ch) => ch.charCodeAt(0)); const dt = new DataTransfer();
      dt.items.add(new File([bin], ${JSON.stringify(path.basename(file))}, { type: 'video/mp4' }));
      const el = document.querySelector('input[type=file]'); if (!el) return 0; el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    if (!ok) throw new Error("no file input on this screen");
    await sleep(2200);
  };

  // The “Cách tạo” trigger carries the method now in use (“Từ chữ”, “Từ ảnh” or “Sửa video”), so the menu is opened by that name.
  const openMethodMenu = async (t) => {
    const ok = await page(`(() => { const want = new Set([${JSON.stringify(t.fromText)}, ${JSON.stringify(t.fromImageShort)}, ${JSON.stringify(t.editVideoShort)}]);
      const b = [...document.querySelectorAll('button[aria-haspopup=menu]')].find((x) => want.has(window.__c.name(x))); if (!b) return 0; b.click(); return 1; })()`);
    if (!ok) throw new Error("the generation-method menu is not on this screen");
    await sleep(500);
  };

  const phaseA = async (loc) => {
    const t = L[loc];
    await prep(loc);
    await escape();
    if (cfg.createKey) {
      const st = await inv("api.status");
      if (!(st.keys || []).some((k) => k.name === "Claude Code" && !k.revokedAt)) await inv("api.createKey", { name: "Claude Code", scope: "generate" });
    }
    await go("/studio", 1000);
    await radio(t.image);
    await fillLast("textarea", cfg.studioPrompt[loc].image);
    await shoot("studio-image", loc);
    await radio(t.video);
    await fillLast("textarea", cfg.studioPrompt[loc].video);
    await shoot("studio-video", loc);
    await fillLast("textarea", "");
    await radio(t.chat);
    await page(`(() => { const f = document.querySelector('[role=feed]'); if (f) f.scrollTo(0, f.scrollHeight); return 1; })()`);
    await sleep(600);
    await shoot("studio-ask", loc);
    await radio(t.image);
    await button(t.fromText);
    await menuItem(t.fromImage);
    await pasteRefs(cfg.refFiles);
    await fillLast("textarea", t.refPrompt);
    await shoot("studio-references", loc);
    for (let i = 0; i < 3; i++) { if (await c(`count('button', ${JSON.stringify(t.removeRef)})`)) await button(t.removeRef); }
    await fillLast("textarea", "");
    if (await c(`count('button', ${JSON.stringify(t.fromImageShort)})`)) { await button(t.fromImageShort); await menuItem(t.fromText); }
    await go("/library", 1200);
    await shoot("library-grid", loc);
    await page(`(() => { const b = [...document.querySelectorAll('main button[aria-label]')].find((e) => e.getAttribute('aria-label').startsWith(${JSON.stringify(t.libItem)})); b.click(); return 1; })()`);
    await sleep(1000);
    await shoot("library-detail", loc);
    await escape();
    await go("/accounts", 1000);
    await shoot("accounts-list", loc);
    await shoot("accounts-quota", loc, `(() => { const h = [...document.querySelectorAll('article h2')].find((e) => e.textContent.trim() === 'Account A'); return window.__c.box(h.closest('article')); })()`);
    await button(t.addAccount);
    await sleep(500);
    await shoot("accounts-add", loc);
    await escape();
    await button(t.execFor);
    await sleep(500);
    await shoot("accounts-mode", loc);
    await escape();
    for (const tab of ["general", "proxy", "run", "queue", "notifications", "security", "diagnostics", "about"]) {
      await go(`/settings/${tab}`, 1000);
      await shoot(`settings-${tab}`, loc);
    }
    await go("/settings/api", 1200);
    await shoot("settings-api", loc);
    await page(`(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === ${JSON.stringify(t.remote)}); window.__c.scrollTo(h); return 1; })()`);
    await sleep(600);
    await shoot("settings-remote", loc);
    await page(`(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === ${JSON.stringify(t.agents)}); window.__c.scrollTo(h); return 1; })()`);
    await sleep(600);
    await shoot("settings-api-agents", loc);
    await go("/guide", 1000);
    await shoot("guide-home", loc);
    await go("/guide/agent-skill", 1000);
    await shoot("guide-agent", loc);
  };

  // Studio › Video › “Sửa video (MP4 → video)”: one MP4 attached, the change asked in words.
  const phaseE = async (loc) => {
    const t = L[loc];
    await prep(loc);
    await escape();
    // The Studio timeline shows the newest jobs above the composer: make that a finished video (the pinned real
    // fixture prompt), so an English picture never shows an old Vietnamese conversation.
    const ctxPrompt = cfg.extendPrompt;
    const ctxId = await inv("job.create", { kind: "video", mode: "text", prompt: ctxPrompt, referenceIds: [], accountPref: "auto", repeat: 1, clientRequestId: `lab-ctx-${loc}-${Date.now()}`, site: "muse" });
    log("context video job", JSON.stringify(ctxId).slice(0, 120));
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const r = await inv("job.query", { kind: "video", order: "desc", limit: 1 });
      const j = (r.items || [])[0];
      if (j && j.prompt === ctxPrompt && ["completed", "failed", "needs_review"].includes(j.state)) break;
    }
    await go("/studio", 1000);
    await radio(t.video);
    await openMethodMenu(t);
    await menuItem(t.editVideoMode);
    await attachVideo(cfg.mp4File);
    await fillLast("textarea", t.editPrompt);
    await sleep(700);
    await shoot("studio-video-edit", loc);
    if (await c(`count('button', ${JSON.stringify(t.removeRef)})`)) await button(t.removeRef);
    await openMethodMenu(t);
    await menuItem(t.fromTextVideo);
    await fillLast("textarea", "");
    await sleep(400);
  };

  // A Muse video that carries its conversation source (fake gateway + MUSE4AI_FAKE_EXTEND=1) → “Kéo dài video” in the Library.
  // A Muse video that carries its conversation source (fake gateway + MUSE4AI_FAKE_EXTEND=1) → “Kéo dài video” in the Library.
  const phaseT = async (loc) => {
    const t = L[loc];
    await prep(loc);
    await escape();
    const prompt = cfg.extendPrompt;
    const label = `${t.videoItem} ${prompt.slice(0, 80)}`;
    // Accounts stay on “Auto”: the video is made over HTTP (fake gateway) and keeps its gw: Muse source, so the
    // Extend button must be enabled exactly as for a real user (build-3.0 Extend over HTTP).
    await inv("job.create", { kind: "video", mode: "text", prompt, referenceIds: [], accountPref: "auto", repeat: 1, clientRequestId: `lab-extend-${loc}-${Date.now()}`, site: "muse" });
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      const r = await inv("job.query", { kind: "video", order: "desc", limit: 1 });
      const j = (r.items || [])[0];
      if (j && j.state === "completed" && (j.assets || []).length) {
        log("extend source job done", j.id, "path", j.execPath);
        if (cfg.extendPath && j.execPath !== cfg.extendPath) throw new Error(`the source video ran on ${j.execPath}, expected ${cfg.extendPath}`);
        break;
      }
      if (j && ["failed", "needs_review"].includes(j.state)) throw new Error("the source video job " + j.state);
    }
    await go("/library", 1600);
    // The grid is newest-first, so the first tile with this prompt is the video this phase just made.
    const found = await page(`(() => { const b = [...document.querySelectorAll('main button[aria-label]')].find((e) => e.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return 0; b.click(); return 1; })()`);
    if (!found) throw new Error("the new video is not in the library grid");
    await sleep(1200);
    const gate = await page(`(() => { const b = [...document.querySelectorAll('button')].find((x) => window.__c.name(x) === ${JSON.stringify(t.extendVideo)}); return b ? (b.disabled ? 'disabled' : 'enabled') : 'missing'; })()`);
    log("extend button", gate);
    if (gate !== "enabled") throw new Error("the extend button is " + gate);
    // The click left a focus ring around the viewer stage; a guide picture shows the screen at rest.
    await page(`(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); return 1; })()`);
    await sleep(300);
    await shoot("library-extend", loc);
    await button(t.extendVideo);
    await sleep(1300);
    const sheet = await page(`(() => document.querySelectorAll('[role=dialog][aria-label^=${JSON.stringify(t.extendSheet)}]').length)()`);
    if (!sheet) throw new Error("the extend sheet did not open");
    await shoot("extend-sheet", loc);
    await escape();
    await sleep(600);
  };

  const startRunningBatch = async () => {
    const snap = await inv("app.snapshot");
    for (const a of snap.accounts) await inv("__test.gw", { accountId: a.id, completeMs: 600000 });
    const rows = cfg.runningBatch.map((prompt, i) => ({ line: i + 1, prompt, kind: "video", mode: "text", reference: null, repeat: 1, error: null }));
    const dr = await inv("batch.saveDraft", { id: null, name: "Lesson and B-roll clips", settings: { kind: "video", mode: "text", accountPref: "auto", repeat: 1 }, rows });
    await inv("batch.start", { id: dr && dr.id ? dr.id : dr });
    await sleep(6000);
    log("running batch started");
  };

  const phaseB = async (loc) => {
    const t = L[loc];
    await prep(loc);
    await go("/queue", 1200);
    await shoot("queue-list", loc);
    await page(`(() => { const row = [...document.querySelectorAll('[role=row]')].find((r) => r.textContent.includes('A small neighborhood shop counter')); row.scrollIntoView({ block: 'center' }); document.scrollingElement.scrollTop = 0; return 1; })()`);
    await sleep(700);
    const b = await page(`(() => { const row = [...document.querySelectorAll('[role=row]')].find((r) => r.textContent.includes('A small neighborhood shop counter')); const img = row.querySelector('img'); return window.__c.box(img); })()`);
    await mouse(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(1500);
    await shoot("queue-preview", loc);
    await mouse(5, 5);
    await sleep(500);
    await page(`(() => { const row = [...document.querySelectorAll('[role=row]')].find((r) => r.textContent.includes('A small neighborhood shop counter')); const el = [...row.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.includes('A small neighborhood shop counter')); el.click(); return 1; })()`);
    await sleep(1200);
    await shoot("queue-drawer", loc);
    await escape();
    await go("/batch", 1000);
    await shoot("batch-list", loc);
    await go("/batch/new", 1000);
    await page(`(() => { const el = document.querySelector('input[placeholder=${JSON.stringify(t.batchPlaceholder)}]'); window.__c.fill(el, ${JSON.stringify(t.batchName)}); return 1; })()`);
    await fillFirst("textarea", cfg.batchList.join("\n"));
    await button(t.checkList);
    await sleep(900);
    await shoot("batch-new", loc);
    await button(t.close);
    await sleep(600);
    const dlg = await page(`(() => { const d = document.querySelector('[role=dialog]'); if (!d) return 0; const b = [...d.querySelectorAll('button')].find((x) => /discard|don.t save|leave|bỏ|không lưu|rời/i.test(x.textContent)); if (b) { b.click(); return 2; } return 1; })()`);
    if (dlg === 1) await escape();
  };

  const phaseC = async (loc) => {
    const t = L[loc];
    await prep(loc);
    await escape();
    await go("/settings/api", 1200);
    await button(t.createKey);
    await sleep(700);
    await page(`(() => { window.__c.fill(document.querySelector('#key-name'), ${JSON.stringify(t.keyName)}); return 1; })()`);
    await sleep(300);
    await page(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].filter((x) => x.textContent.trim() === ${JSON.stringify(t.createKey)}).pop(); b.click(); return 1; })()`);
    await sleep(1200);
    await shoot("settings-api-key", loc);
    await page(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === ${JSON.stringify(t.copiedClose)}); if (b) b.click(); return b ? 1 : 0; })()`);
    await sleep(500);
  };

  const phaseV = async () => {
    const snap = await inv("app.snapshot");
    const a = snap.accounts.find((x) => x.alias === "Account A");
    await inv("__test.gw", { accountId: a.id, replyText: cfg.viAnswer, completeMs: 1500 });
    await inv("chat.create", { prompt: cfg.viChatPrompt, referenceIds: [], accountPref: a.id, clientRequestId: "lab-chat-hooks-vi-0001", conversationId: null });
    for (let i = 0; i < 60; i++) {
      const items = (await inv("job.query", { kind: "chat", order: "desc", limit: 3 })).items;
      if (items.length && items[0].kind === "chat" && ["completed", "failed", "needs_review"].includes(items[0].state)) { log("vi chat", items[0].state); break; }
      await sleep(2000);
    }
  };

  const phaseQ = async () => {
    const snap = await inv("app.snapshot");
    for (const a of snap.accounts) {
      const pct = a.alias === "Account A" ? 34 : 61;
      await inv("__test.quota", { accountId: a.id, text: `Free plan\nWeekly limit resets on ${cfg.resetLabel}\n${pct}% used\nAdditional tokens\nNever expires\n0% used (5B tokens left)\nUpgrade` });
      await inv("account.readQuota", { id: a.id });
    }
    await sleep(3000);
    const b = await inv("bridge.checkNow", {});
    log("quota re-applied; bridge check", JSON.stringify((b && b.results || []).map((r) => [r.alias, r.ok])));
    await sleep(3000);
  };

  const verdict = (id, pass, detail) => { log(pass ? "PASS" : "FAIL", id, "—", String(detail).slice(0, 400)); results.push({ id, pass, detail: String(detail).slice(0, 400) }); };
  const lastRoute = async () => (await inv("app.snapshot")).settings.lastRoute;
  const navCurrent = () => page(`(() => { const n = document.querySelector('nav[aria-label] [aria-current="page"]'); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; })()`);
  const ctrl7 = async () => { for (const type of ["rawKeyDown", "keyUp"]) await d.sendCommand("Input.dispatchKeyEvent", { type, modifiers: 2, key: "7", code: "Digit7", windowsVirtualKeyCode: 55 }); await sleep(900); };
  const findLogs = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) findLogs(f, out); else if (/^app-.*\.log$/.test(e.name)) out.push(f); } return out; };
  const openUrlCount = () => findLogs(path.join(cfg.lab, "data")).reduce((n, f) => n + fs.readFileSync(f, "utf8").split("\n").filter((l) => l.includes("openUrl.test") && l.includes(cfg.siteHost)).length, 0);
  const dialogText = () => page(`(() => [...document.querySelectorAll('[role=dialog]')].map((x) => x.textContent).join(' | '))()`);
  const dialogButton = async (label) => { const ok = await page(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].filter((x) => x.textContent.trim() === ${JSON.stringify(label)}).pop(); if (b) b.click(); return !!b; })()`); await sleep(700); return ok; };
  const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");

  const phaseG = async () => {
    await prep("en"); await escape(); await go("/studio", 800);
    await ctrl7();
    let r = await lastRoute(); let cur = await navCurrent();
    verdict("AC-APP-GUIDE-01 (V, EN)", r === "/guide" && cur === "Guide", `route=${r} current=${cur}`);
    await lang("vi"); await go("/studio", 800); await ctrl7();
    r = await lastRoute(); cur = await navCurrent();
    verdict("AC-APP-GUIDE-01 (V, VI)", r === "/guide" && cur === "Hướng dẫn", `route=${r} current=${cur}`);
    await lang("en");
    await go("/guide/create-image", 1000);
    await button("Open this screen");
    await sleep(600);
    r = await lastRoute();
    verdict("AC-APP-GUIDE-04 (V)", r === "/studio", `route=${r}`);
    await go("/guide/queue", 1000);
    const enView = await page(`(() => ({ h1: (document.querySelector('#guide-article h1') || document.querySelector('#guide-article h2'))?.textContent.trim(), img: [...document.querySelectorAll('#guide-article figure img')].map((i) => i.currentSrc.split('/').pop()), w: [...document.querySelectorAll('#guide-article figure img')].map((i) => i.naturalWidth) }))()`);
    await lang("vi"); await sleep(600);
    const viView = await page(`(() => ({ h1: (document.querySelector('#guide-article h1') || document.querySelector('#guide-article h2'))?.textContent.trim(), img: [...document.querySelectorAll('#guide-article figure img')].map((i) => i.currentSrc.split('/').pop()), w: [...document.querySelectorAll('#guide-article figure img')].map((i) => i.naturalWidth) }))()`);
    r = await lastRoute();
    verdict("AC-APP-GUIDE-06 (V)", r === "/guide/queue" && enView.h1 && viView.h1 && enView.h1 !== viView.h1 && enView.img.length > 0 && enView.img.every((x) => /\.en-/.test(x)) && viView.img.every((x) => /\.vi-/.test(x)) && viView.w.every((w) => w > 0),
      `route=${r} en=${JSON.stringify(enView)} vi=${JSON.stringify(viView)}`);
    await lang("en"); await sleep(500);
    const before = openUrlCount();
    const url0 = wc.getURL();
    await button("View on the web");
    await sleep(500);
    const body = await dialogText();
    await dialogButton("Cancel");
    const afterCancel = openUrlCount();
    await button("View on the web");
    await sleep(500);
    await dialogButton("Open browser");
    await sleep(1200);
    const afterOpen = openUrlCount();
    const want = `https://${cfg.siteHost}/docs/queue`;
    verdict("AC-APP-GUIDE-07 (V)", body.includes(want) && afterCancel === before && afterOpen === before + 1 && wc.getURL() === url0,
      `dialog has ${want}: ${body.includes(want)}; openUrl calls before/cancel/open = ${before}/${afterCancel}/${afterOpen}; window URL unchanged: ${wc.getURL() === url0} (test mode logs the call instead of starting a browser)`);
  };

  const phaseS = async () => {
    const target = path.join(cfg.lab, "home", ".claude", "skills", "muse4ai");
    const files = Object.keys(cfg.skillHashes);
    const hashes = () => files.map((f) => { const p = path.join(target, ...f.split("/")); return fs.existsSync(p) ? sha(p) : null; });
    const expect = files.map((f) => cfg.skillHashes[f]);
    const existed = fs.existsSync(target);
    await prep("en"); await escape(); await go("/guide", 900);
    await button("Install for Claude Code");
    await sleep(600);
    let body = await dialogText();
    await dialogButton("Install");
    await sleep(1500);
    let h = hashes();
    const toast = await page(`(() => document.body.innerText.includes(${JSON.stringify("Installed the skill for Claude Code")}) || document.body.innerText.includes(${JSON.stringify("muse4ai")}))()`);
    verdict("AC-SKILL-05 (V)", !existed && body.includes(".claude") && JSON.stringify(h) === JSON.stringify(expect) && toast, `target existed before: ${existed}; dialog shows folder: ${body.includes(".claude")}; ${files.length} files hash match: ${JSON.stringify(h) === JSON.stringify(expect)}`);
    // Replace? → Cancel leaves a changed file alone; Replace restores it.
    const probe = path.join(target, "SKILL.md");
    fs.appendFileSync(probe, "\nlab-marker\n");
    const changed = sha(probe);
    await button("Install for Claude Code");
    await sleep(600);
    body = await dialogText();
    const askedReplace = body.includes("Replace");
    await dialogButton("Cancel");
    await sleep(500);
    const keptOnCancel = sha(probe) === changed;
    await button("Install for Claude Code");
    await sleep(600);
    await dialogButton("Replace");
    await sleep(1500);
    h = hashes();
    verdict("AC-SKILL-06 (V)", askedReplace && keptOnCancel && JSON.stringify(h) === JSON.stringify(expect), `asked Replace: ${askedReplace}; Cancel kept the changed file: ${keptOnCancel}; Replace restored all files: ${JSON.stringify(h) === JSON.stringify(expect)}`);
  };

  const phaseK = async () => {
    const st0 = await inv("api.status");
    for (const k of st0.keys || []) if (k.name === "Lab MCP check" && !k.revokedAt) await inv("api.revokeKey", { id: k.id });
    const k = await inv("api.createKey", { name: "Lab MCP check", scope: "generate" });
    fs.writeFileSync(path.join(cfg.lab, "mcp-check.key"), k.token);
    await inv("api.setAccess", { access: "cloudflare_quick", confirmInternet: true });
    let url = null;
    for (let i = 0; i < 90 && !url; i++) { await sleep(2000); const st = await inv("api.status"); if (st.tunnel && st.tunnel.state === "online" && st.tunnel.url) url = st.tunnel.url; if (i % 10 === 0) log("tunnel", st.tunnel && st.tunnel.state, st.tunnel && st.tunnel.error); }
    fs.writeFileSync(path.join(cfg.lab, "mcp-check.url"), url || "");
    log("key + tunnel ready", url ? "online" : "NO TUNNEL", "keyId", k.key.id);
  };

  const phaseX = async () => {
    await inv("api.setAccess", { access: "local" });
    const st = await inv("api.status");
    for (const k of st.keys || []) if (!k.revokedAt) await inv("api.revokeKey", { id: k.id });
    for (const f of ["mcp-check.key", "mcp-check.url"]) { try { fs.unlinkSync(path.join(cfg.lab, f)); } catch {} }
    const st2 = await inv("api.status");
    log("cleanup: access", st2.access, "active keys", (st2.keys || []).filter((x) => !x.revokedAt).length);
  };

  const phaseO = async (loc) => { await lang(loc); await emulate(); await sleep(800); await shoot("onboarding-welcome", loc); };

  const phaseP = async () => {
    await inv("proxy.import", { text: "198.51.100.23:8080:labuser3:labpass3" });
    await inv("proxy.testAll");
    const b = await inv("bridge.checkNow", {});
    log("bridge check", JSON.stringify((b.results || []).map((r) => [r.alias, r.ok])));
    await sleep(4000);
  };

  log("run start", JSON.stringify(cfg.phases));
  for (const ph of cfg.phases) {
    const [name, loc, flag] = ph.split(":");
    log("phase", ph);
    try {
      if (name === "O") await phaseO(loc);
      else if (name === "P") await phaseP();
      else if (name === "Q") await phaseQ();
      else if (name === "G") await phaseG();
      else if (name === "S") await phaseS();
      else if (name === "K") await phaseK();
      else if (name === "X") await phaseX();
      else if (name === "A") await phaseA(loc);
      else if (name === "B") { if (flag === "start") await startRunningBatch(); await phaseB(loc); }
      else if (name === "C") await phaseC(loc);
      else if (name === "V") await phaseV();
      else if (name === "E") await phaseE(loc);
      else if (name === "T") await phaseT(loc);
    } catch (e) {
      log("ERROR in", ph, String(e && e.stack || e).slice(0, 600));
    }
  }
  await d.sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => {});
  log("run done", results.length, "shots");
  return results.length;
};
