import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROUTES, CREDITS, DOCS, SITE_URL, SUGGESTED_PATHS, buildIndex, doc, search } from "@content/index";
import { agentInstructions } from "@content/agentPrompt";
import { GUIDE_RESOURCE, SKILL_SOURCES, skillBody } from "@content/skill";
import { SCREEN_HELP, guideOrder, guideToc, helpSlugFor, resolveGuideLink, webDocUrl } from "../src/shared/guideHelp";
import { SERVER_INSTRUCTIONS } from "../src/shared/api/mcpProtocol";
import { installSkill, safeRelative, skillTarget, SkillInstallError } from "../src/main/skillInstall";
import { quotaPanelText } from "../src/shared/quota";
import { setLocale, t } from "../src/shared/i18n";
import { makeApi, mcpPost, modernMeta, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, type Harness } from "./helpers";

// Build 3.0 — in-app Guide (R3-APP), Agent Skill install (R3-SKILL.6/7), MCP guide resource (R3-SKILL.8) and the two
// English-mode leftovers (R3-APP.10).

const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

describe("Guide content (R3-APP.3–5)", () => {
  it("AC-APP-GUIDE-03: the app shows exactly the website's articles (same slugs, none lost by chapter)", () => {
    const inApp = guideOrder().map((d) => d.slug);
    expect(new Set(inApp)).toEqual(new Set(DOCS.map((d) => d.slug)));
    expect(inApp).toHaveLength(DOCS.length);
    expect(guideToc().length).toBeGreaterThanOrEqual(10);
  });

  it("AC-APP-GUIDE-04: every article's 'Open this screen' route exists in the app router", async () => {
    const { match } = await import("../src/renderer/lib/router");
    const expected: Record<string, string> = { "/studio": "studio", "/queue": "queue", "/batch": "batches", "/batch/new": "batchNew", "/library": "library", "/accounts": "accounts", "/guide": "guide" };
    for (const r of APP_ROUTES) {
      const m = match(r);
      if (r.startsWith("/settings/")) expect(m, r).toEqual({ name: "settings", tab: r.split("/")[2] });
      else expect(m.name, r).toBe(expected[r]);
    }
    for (const d of DOCS) if (d.appRoute) expect(APP_ROUTES, d.slug).toContain(d.appRoute);
    expect(doc("create-image")?.appRoute).toBe("/studio");
  });

  it("AC-APP-GUIDE-05: search ignores accents and case; nothing found → 3 suggestions that exist", () => {
    const index = buildIndex("vi").filter((e) => e.kind === "doc");
    expect(search(index, "hang cho").map((e) => e.path)).toContain("/docs/queue");
    expect(search(index, "HÀNG CHỜ").map((e) => e.path)).toContain("/docs/queue");
    expect(search(index, "zzqq")).toEqual([]);
    expect(SUGGESTED_PATHS).toHaveLength(3);
    for (const p of SUGGESTED_PATHS) expect(doc(p.replace("/docs/", "")), p).toBeDefined();
  });

  it("AC-APP-GUIDE-08: each main screen's '?' opens its own article", () => {
    expect(helpSlugFor("/studio")).toBe("create-image");
    expect(helpSlugFor("/queue/job-123")).toBe("queue");
    expect(helpSlugFor("/batch/new")).toBe("batches");
    expect(helpSlugFor("/library")).toBe("library");
    expect(helpSlugFor("/accounts?focus=a1")).toBe("accounts-and-limits");
    expect(helpSlugFor("/settings/api")).toBe("connect-overview");
    expect(helpSlugFor("/settings/proxy")).toBe("proxies-and-modes");
    expect(helpSlugFor("/settings/about")).toBe("open-source");
    expect(helpSlugFor("/settings/general")).toBe("settings-overview");
    for (const h of SCREEN_HELP) expect(doc(h.slug), h.prefix).toBeDefined();
  });

  it("R3-APP.7: article links stay in the Guide; other pages and https go to the browser (after a confirm); others are refused", () => {
    expect(resolveGuideLink("/docs/queue", "en")).toEqual({ kind: "guide", route: "/guide/queue" });
    expect(resolveGuideLink("/agents/cursor", "vi")).toEqual({ kind: "web", url: `${SITE_URL}/vi/agents/cursor` });
    expect(resolveGuideLink("https://code.claude.com/docs/en/mcp", "en")).toEqual({ kind: "web", url: "https://code.claude.com/docs/en/mcp" });
    expect(resolveGuideLink("javascript:alert(1)", "en")).toBeNull();
    expect(resolveGuideLink("http://example.com", "en")).toBeNull();
    expect(resolveGuideLink("//evil.example", "en")).toBeNull();
    expect(webDocUrl("install", "vi")).toBe(`${SITE_URL}/vi/docs/install`);
    expect(webDocUrl("install", "en")).toBe(`${SITE_URL}/docs/install`);
  });
});

describe("Open source in the app (R3-APP.9)", () => {
  it("AC-APP-OSS-02: license files packed by the installer = credits with a notice file used in the installer", () => {
    const pkg = fs.readFileSync(path.resolve(__dirname, "../scripts/package-win.mjs"), "utf8");
    const packed = new Set([...pkg.matchAll(/"(LICENSES\/[^"]+)"/g)].map((m) => m[1]));
    const fromCredits = new Set(CREDITS.filter((c) => c.noticeFile && c.usedIn.includes("installer")).map((c) => c.noticeFile));
    expect(packed).toEqual(fromCredits);
    for (const f of packed) expect(fs.existsSync(path.resolve(__dirname, "..", f!)), f).toBe(true);
  });
});

describe("Agent Skill install (R3-SKILL.6)", () => {
  const enc = new TextEncoder();
  const files = () => Object.entries(SKILL_SOURCES).map(([name, text]) => ({ name, data: enc.encode(text) }));
  const sha = (b: Buffer | Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
  let home = "";
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
    home = "";
  });

  it("AC-SKILL-05: a fresh install writes every skill file under %USERPROFILE%\\.claude\\skills\\muse4ai with matching hashes", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-home-"));
    const r = installSkill(home, files(), { replace: false });
    expect(r.target).toBe(path.join(home, ".claude", "skills", "muse4ai"));
    expect(r.replaced).toBe(false);
    expect(r.files).toHaveLength(5);
    for (const [name, text] of Object.entries(SKILL_SOURCES)) {
      const p = path.join(r.target, ...name.split("/").slice(1));
      expect(sha(fs.readFileSync(p)), name).toBe(sha(enc.encode(text)));
    }
    // No temporary folders left next to it.
    expect(fs.readdirSync(path.dirname(r.target))).toEqual(["muse4ai"]);
  });

  it("AC-SKILL-06: existing folder + Cancel (no replace) changes nothing; Replace writes the new files", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-home-"));
    const target = skillTarget(home);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), "old skill");
    fs.writeFileSync(path.join(target, "mine.txt"), "user file");
    const before = sha(fs.readFileSync(path.join(target, "SKILL.md")));
    expect(() => installSkill(home, files(), { replace: false })).toThrowError(SkillInstallError);
    try {
      installSkill(home, files(), { replace: false });
    } catch (e) {
      expect((e as SkillInstallError).code).toBe("exists");
    }
    expect(sha(fs.readFileSync(path.join(target, "SKILL.md")))).toBe(before);
    expect(fs.existsSync(path.join(target, "mine.txt"))).toBe(true);

    const r = installSkill(home, files(), { replace: true });
    expect(r.replaced).toBe(true);
    expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toBe(SKILL_SOURCES["muse4ai/SKILL.md"]);
    expect(fs.existsSync(path.join(target, "mine.txt"))).toBe(false);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["muse4ai"]);
  });

  it("AC-SKILL-06: a file name that could leave the skill folder is refused and nothing is written", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-home-"));
    for (const bad of ["muse4ai/../evil.md", "/etc/passwd", "muse4ai/a\\..\\..\\b.md", "other/SKILL.md", "muse4ai/", "muse4ai/./x", "muse4ai/C:/x", "muse4ai"]) {
      expect(safeRelative(bad), bad).toBeNull();
      expect(() => installSkill(home, [{ name: bad, data: enc.encode("x") }], { replace: true }), bad).toThrowError(/không an toàn/);
    }
    expect(fs.existsSync(path.join(home, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(home, "evil.md"))).toBe(false);
    expect(safeRelative("muse4ai/references/tools.md")).toBe("references/tools.md");
  });

  it("AC-SKILL-07: the copied agent note has this PC's MCP address and no API key", () => {
    for (const locale of ["en", "vi"] as const) {
      const note = agentInstructions(locale, "http://127.0.0.1:47821/mcp");
      expect(note).toContain("http://127.0.0.1:47821/mcp");
      expect(note).toContain("muse_status");
      expect(note).not.toMatch(/msk_/);
      expect(note).not.toMatch(/Bearer\s+\S/);
    }
  });
});

describe("MCP guide resource (R3-SKILL.8)", () => {
  let h: Harness | null = null;
  let rig: ApiRig | null = null;
  let client: Client | null = null;
  afterEach(async () => {
    await client?.close().catch(() => undefined);
    client = null;
    await rig?.close();
    rig = null;
    if (h) {
      await h.coord.stop();
      h.close();
      h = null;
    }
  });

  it("AC-MCP-01: the first sentence stands alone (≤ 200 chars, names Muse4AI) and the whole text is ≤ 2,000 chars", () => {
    const first = SERVER_INSTRUCTIONS.slice(0, SERVER_INSTRUCTIONS.indexOf(".") + 1);
    expect(first.length).toBeLessThanOrEqual(200);
    expect(first).toContain("Muse4AI");
    expect(first).toMatch(/image/);
    expect(first).toMatch(/video/);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
    expect(SERVER_INSTRUCTIONS).toContain(GUIDE_RESOURCE.uri);
  });

  it("AC-MCP-02: official SDK lists and reads muse4ai://guide (text/markdown = SKILL.md body); tools are unchanged", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const transport = new StreamableHTTPClientTransport(new URL(`${rig.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${rig.gen}` } } });
    client = new Client({ name: "guide-test", version: "1.0.0" });
    await client.connect(transport);
    expect(client.getServerCapabilities()?.resources).toBeDefined();
    const list = await client.listResources();
    expect(list.resources).toEqual([expect.objectContaining({ uri: "muse4ai://guide", mimeType: "text/markdown" })]);
    const read = await client.readResource({ uri: "muse4ai://guide" });
    expect(read.contents).toHaveLength(1);
    expect(read.contents[0]).toMatchObject({ uri: "muse4ai://guide", mimeType: "text/markdown" });
    const text = (read.contents[0] as { text: string }).text;
    expect(text).toBe(skillBody());
    expect(text.startsWith("# Muse4AI")).toBe(true);
    expect(text).not.toContain("description:");
    const tools = await client.listTools();
    expect(tools.tools.map((x) => x.name).sort()).toEqual(["muse_cancel_job", "muse_chat", "muse_extend_video", "muse_generate", "muse_get_extend", "muse_get_job", "muse_list_jobs", "muse_status"]);
    await expect(client.readResource({ uri: "muse4ai://nope" })).rejects.toThrow(/Unknown resource/);
  });

  it("AC-MCP-02: the 2026-07-28 era answers resources/list and resources/read too", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const hd = (method: string) => ({ "mcp-protocol-version": "2026-07-28", "mcp-method": method });
    const list = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "resources/list", params: { _meta: modernMeta() } }, { headers: hd("resources/list") });
    expect(list.status).toBe(200);
    expect(list.json.result.resources[0].uri).toBe("muse4ai://guide");
    const read = await mcpPost(rig, { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "muse4ai://guide", _meta: modernMeta() } }, { headers: hd("resources/read") });
    expect(read.json.result.contents[0].text).toBe(skillBody());
    const bad = await mcpPost(rig, { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "file:///etc/passwd", _meta: modernMeta() } }, { headers: hd("resources/read") });
    expect(bad.json.error.code).toBe(-32002);
  });
});

describe("English leftovers (R3-APP.10)", () => {
  afterEach(() => setLocale("vi"));

  it("AC-APP-I18N-01: the quota line and the DNS step read in English with no Vietnamese left", () => {
    setLocale("en");
    const now = Date.UTC(2026, 10, 2, 9, 0, 0);
    const text = quotaPanelText(
      { plan: "Free plan", usedPercent: 0, resetsOn: "Nov 9", resetAt: Date.UTC(2026, 10, 9), readAt: now - 60_000, additional: { usedPercent: 0, remainingLabel: "4.9B tokens left", remainingApprox: 4.9e9, expiryLabel: "Never expires" } },
      now,
    );
    const shown = [text.weekly, text.additional, text.readAt].map((x) => t(x));
    for (const s of shown) expect(s, s).not.toMatch(VI_CHARS);
    expect(shown[1]).toBe("4.9B tokens remaining · does not expire · 0 % used");
    expect(t("Đã trỏ tới 203.0.113.10")).toBe("Now pointing to 203.0.113.10");
    const warn = t("Đã trỏ tới 203.0.113.10 — Tên miền trỏ tới IP khác IP của máy — có thể đang qua proxy Cloudflare hoặc NAT");
    expect(warn).not.toMatch(VI_CHARS);
    expect(warn.startsWith("Now pointing to 203.0.113.10")).toBe(true);
  });
});
