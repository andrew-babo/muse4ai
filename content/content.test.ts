import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { AGENTS } from "./agents";
import { decodeDeeplink, deeplink, serverEntry } from "./deeplinks";
import { DOCS } from "./docs";
import { FACTS } from "./facts";
import { SHOT_IDS } from "./shotCatalog";
import { SHOTS } from "./shots";
import { createHash } from "node:crypto";
import { MEDIA } from "./media";
import { OG_IMAGES } from "./og";
import { STATIC_PAGES } from "./pages";
import { LATEST_RELEASE, RELEASES } from "./site";
import { USE_CASES } from "./usecases";
import {
  agentProblems,
  brandProblems,
  contentRoot,
  docTemplateProblems,
  forbiddenClaims,
  linkProblems,
  missingTranslations,
  referencedShots,
  secretProblems,
  seoProblems,
  strings,
  useCaseProblems,
} from "./validate";
import { SKILL_FILES, unzipStore, zipStore } from "./zip";
import { parseInline, withTerms } from "./inline";

const ROOT = path.resolve(__dirname, "..");

/** Shots captured as a 2× crop of one region instead of the full 1440×900 window (R3-SHOT.2). */
const CROPPED_SHOTS = ["accounts-quota", "queue-preview"];

describe("content: translations and claims", () => {
  it("AC-CNT-01 every visible string exists in English and Vietnamese", () => {
    expect(missingTranslations(contentRoot())).toEqual([]);
  });

  it("AC-CNT-01 reports the exact key when one translation is removed", () => {
    const broken = { a: { en: "Hello", vi: "" }, b: [{ en: "", vi: "Xin chào" }] };
    expect(missingTranslations(broken, "x")).toEqual(["x.a.vi is empty", "x.b[0].en is empty"]);
  });

  it("AC-CNT-02 no forbidden claim in content or the agent skill", () => {
    const skill = SKILL_FILES.map((f) => ({ path: f, text: readFileSync(path.join(ROOT, "agent-kit", f), "utf8") }));
    expect(forbiddenClaims([...strings(contentRoot()), ...skill])).toEqual([]);
  });

  it("AC-CNT-02 adding 'unlimited' to an article makes the scan fail", () => {
    expect(forbiddenClaims([{ path: "t", text: "Create unlimited videos with your account." }])).toHaveLength(1);
    expect(forbiddenClaims([{ path: "t", text: "This does not give you unlimited videos." }])).toEqual([]);
  });

  it("AC-SKILL-02 no secrets, real IPs, user paths, tunnels or emails anywhere", () => {
    const skill = SKILL_FILES.map((f) => ({ path: f, text: readFileSync(path.join(ROOT, "agent-kit", f), "utf8") }));
    expect(secretProblems([...strings(contentRoot()), ...skill])).toEqual([]);
    expect(secretProblems([{ path: "t", text: "key msk_1Ydqrwjd_xfPkRGy and 10.0.0.5" }])).toHaveLength(2);
  });
});

describe("content: articles", () => {
  it("AC-CNT-03 every article follows the template", () => {
    expect(docTemplateProblems()).toEqual([]);
  });

  it("covers the planned 24+ articles across all 11 chapters", () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(24);
  });

  it("every screenshot an article asks for exists in the capture catalog", () => {
    const unknown = referencedShots().filter((id) => !SHOT_IDS.includes(id));
    expect(unknown).toEqual([]);
  });

  it("AC-SHOT-01 every manifest shot is a real WebP: file present, sha256 and size match, ≤ 180 KB, 2× width 2880 unless a crop, synthetic, alt EN+VI, 1× twin", () => {
    const dir = path.join(ROOT, "content", "shots");
    const problems: string[] = [];
    for (const s of SHOTS) {
      const file = path.join(dir, s.file);
      let buf: Buffer;
      try {
        buf = readFileSync(file);
      } catch {
        problems.push(`${s.file}: missing`);
        continue;
      }
      if (buf.subarray(0, 4).toString() !== "RIFF" || buf.subarray(8, 12).toString() !== "WEBP") problems.push(`${s.file}: not WebP`);
      if (createHash("sha256").update(buf).digest("hex") !== s.sha256) problems.push(`${s.file}: sha256 differs`);
      if (buf.length !== s.bytes) problems.push(`${s.file}: size differs`);
      if (buf.length > 180 * 1024) problems.push(`${s.file}: ${buf.length} B > 180 KB`);
      if (s.w !== 2880 && !CROPPED_SHOTS.includes(s.id)) problems.push(`${s.file}: ${s.w} px wide without being a listed crop`);
      if (s.profile !== "synthetic") problems.push(`${s.file}: not the synthetic profile`);
      if (!s.alt.en.trim() || !s.alt.vi.trim()) problems.push(`${s.file}: alt text missing`);
      try {
        readFileSync(path.join(dir, s.file.replace(/\.webp$/, "@1x.webp")));
      } catch {
        problems.push(`${s.file}: no 1× file`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("AC-SHOT-03 every catalog screenshot ships in English and Vietnamese", () => {
    const missing = SHOT_IDS.flatMap((id) => (["en", "vi"] as const).filter((l) => !SHOTS.some((s) => s.id === id && s.locale === l)).map((l) => `${id}.${l}`));
    expect(missing).toEqual([]);
  });

  it("AC-CNT-04 internal links resolve and external links are official https", () => {
    expect(linkProblems()).toEqual([]);
  });

  it("AC-CNT-06 the first use of a term becomes a glossary link, later uses stay text", () => {
    const seen = new Set<string>();
    const toks = withTerms(parseInline("Use a proxy. Then another proxy."), "en", seen);
    const terms = toks.filter((t) => t.t === "term");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ id: "proxy", v: "proxy" });
  });
});

describe("content: SEO registry", () => {
  it("AC-WEB-SEO-01 titles ≤ 60, descriptions 70–160, unique per language", () => {
    expect(seoProblems()).toEqual([]);
  });
});

describe("content: agents", () => {
  it("AC-WEB-AG-03 statuses, configs and summaries are consistent", () => {
    expect(agentProblems()).toEqual([]);
  });

  it("AC-BRAND-01/02 agent brands are registered and Meta never has a logo", () => {
    expect(brandProblems()).toEqual([]);
  });

  it("ChatGPT is listed as later with a reason and no configuration", () => {
    const c = AGENTS.find((a) => a.slug === "chatgpt");
    expect(c?.status).toBe("later");
    expect(c?.config).toBeUndefined();
  });

  it("AC-WEB-AG-04 every config parses in its own format and carries the placeholder key", () => {
    for (const a of AGENTS) {
      if (!a.config) continue;
      const t = a.config.text;
      expect(t, a.slug).toContain(FACTS.placeholderKey);
      switch (a.config.format) {
        case "json-mcpServers":
        case "json-vscode":
        case "json-antigravity":
        case "json-opencode":
          expect(() => JSON.parse(t), a.slug).not.toThrow();
          break;
        case "toml-codex": {
          const parsed = parseToml(t) as { mcp_servers: { muse4ai: { url: string; http_headers: Record<string, string> } } };
          expect(parsed.mcp_servers.muse4ai.url).toBe(FACTS.localMcpUrl);
          expect(parsed.mcp_servers.muse4ai.http_headers["Authorization"]).toBe(`Bearer ${FACTS.placeholderKey}`);
          break;
        }
        case "yaml-hermes": {
          const parsed = parseYaml(t) as { mcp_servers: { muse4ai: { url: string; headers: Record<string, string> } } };
          expect(parsed.mcp_servers.muse4ai.headers["Authorization"]).toBe(`Bearer ${FACTS.placeholderKey}`);
          break;
        }
        default:
          break;
      }
    }
  });

  it("AC-WEB-AG-06 one-click links decode to exactly the copy-paste server entry", () => {
    const withLinks = AGENTS.filter((a) => a.deeplink);
    expect(withLinks.map((a) => a.slug).sort()).toEqual(["cursor", "lm-studio", "vscode-copilot"]);
    for (const a of withLinks) {
      const link = deeplink(a);
      expect(link, a.slug).toBeDefined();
      expect(decodeDeeplink(link as string)).toEqual(serverEntry(a));
    }
  });

  it("public-only agents explain that the Quick tunnel address changes", () => {
    for (const a of AGENTS.filter((x) => x.status !== "later" && x.connection.includes("public"))) {
      expect(a.notes.some((n) => /Quick tunnel/.test(n.en)), a.slug).toBe(true);
    }
  });
});

describe("content: use cases", () => {
  it("has the 18 planned use cases", () => {
    expect(USE_CASES).toHaveLength(18);
  });

  it("AC-WEB-UC-02/05 each has media, limits, docs, two related and disclosures where needed", () => {
    expect(useCaseProblems()).toEqual([]);
  });

  it("R3-UC.1 every sample a use case names exists in the media registry", () => {
    const missing = USE_CASES.flatMap((u) => u.media.filter((id) => !MEDIA.some((m) => m.id === id)).map((id) => `${u.slug}: ${id}`));
    expect(missing).toEqual([]);
  });
});

describe("content: sample media (P5)", () => {
  type LedgerEntry = { kind: string; account: string; job_id: string; status: string; published?: { file: string; sha256: string } };
  const ledger = JSON.parse(readFileSync(path.join(ROOT, "docs/build-3.0/evidence/media/ledger.json"), "utf8")) as Record<string, LedgerEntry>;
  const pointer = (url: string) => {
    const file = decodeURIComponent(url.split("/").pop() ?? "");
    return JSON.parse(readFileSync(path.join(ROOT, "content", "media", `${file}.asset.json`), "utf8")) as { url: string; size: number; content_type: string };
  };

  it("AC-MEDIA-01 at most 40 Muse turns (at most 16 videos) for use cases, at most 8 home showcase clips, all on test accounts", () => {
    const all = Object.entries(ledger);
    const rows = all.filter(([id]) => !id.startsWith("home-") && !id.startsWith("uc4-")).map(([, r]) => r);
    const stitched = all.filter(([id]) => id.startsWith("uc4-")).map(([, r]) => r);
    expect(stitched.length).toBeLessThanOrEqual(8);
    const home = all.filter(([id]) => id.startsWith("home-")).map(([, r]) => r);
    expect(rows.length).toBeLessThanOrEqual(40);
    expect(rows.filter((r) => r.kind === "video").length).toBeLessThanOrEqual(16);
    expect(home.length).toBeLessThanOrEqual(8);
    for (const r of [...rows, ...home, ...stitched]) {
      expect(r.account).toMatch(/^test account [A-Z]$/);
      expect(r.job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("R3-UC.2 every shown sample is a succeeded test-account job from the ledger", () => {
    for (const m of MEDIA) {
      const row = ledger[m.id];
      expect(row?.published, m.id).toBeTruthy();
      expect(row?.status, m.id).toBe("succeeded");
      expect(m.jobRef, m.id).toBe(row?.job_id);
      expect(m.account).toBe("test");
      expect(m.prompt.en.length, m.id).toBeGreaterThan(20);
      expect(m.alt.en && m.alt.vi && m.alt.en !== m.alt.vi, m.id).toBeTruthy();
    }
  });

  it("AC-WEB-PERF-02 / AC-WEB-UC-03 URLs come from CDN pointers; no image or poster above 200 KB; videos have posters", () => {
    for (const m of MEDIA) {
      const urls = [m.url, m.small, ...(m.poster ? [m.poster] : [])];
      for (const u of urls) expect(pointer(u).url, m.id).toBe(u);
      expect(pointer(m.url).size, m.id).toBe(m.bytes);
      const stills = m.kind === "image" ? [m.url, m.small] : [m.small, m.poster as string];
      for (const u of stills) {
        const p = pointer(u);
        expect(p.content_type, `${m.id} ${u}`).toBe("image/webp");
        expect(p.size, `${m.id} ${u}`).toBeLessThanOrEqual(200 * 1024);
      }
      if (m.kind === "video") {
        expect(m.poster, m.id).toBeTruthy();
        expect(pointer(m.url).content_type, m.id).toBe("video/mp4");
        expect(m.durationS, m.id).toBeGreaterThan(0);
      }
    }
  });
});

describe("agent skill", () => {
  const skill = readFileSync(path.join(ROOT, "agent-kit/muse4ai/SKILL.md"), "utf8");

  it("AC-SKILL-01 frontmatter name, short description, ≤ 500 lines, 4 references", () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    expect(fm).not.toBeNull();
    const meta = parseYaml(fm?.[1] ?? "") as { name: string; description: string };
    expect(meta.name).toBe("muse4ai");
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(skill.split("\n").length).toBeLessThanOrEqual(500);
    for (const f of SKILL_FILES.slice(1)) expect(skill).toContain(f.replace("muse4ai/", ""));
  });

  it("AC-SKILL-03 every muse_* tool the skill names exists in the app", () => {
    const all = SKILL_FILES.map((f) => readFileSync(path.join(ROOT, "agent-kit", f), "utf8")).join("\n");
    const named = new Set(all.match(/\bmuse_[a-z_]+\b/g) ?? []);
    const known = new Set<string>(FACTS.mcpTools);
    expect([...named].filter((n) => !known.has(n))).toEqual([]);
  });

  it("AC-SKILL-04 the ZIP holds muse4ai/SKILL.md + 4 references with identical bytes", () => {
    const entries = SKILL_FILES.map((f) => ({ name: f, data: new Uint8Array(readFileSync(path.join(ROOT, "agent-kit", f))) }));
    const zip = zipStore(entries);
    const back = unzipStore(zip);
    expect(back.map((e) => e.name)).toEqual([...SKILL_FILES]);
    back.forEach((e, i) => expect(Buffer.from(e.data).equals(Buffer.from(entries[i]?.data ?? []))).toBe(true));
  });
});

describe("share images (AC-WEB-SEO-06)", () => {
  /** Width/height from a JPEG's SOF marker. */
  const jpegSize = (buf: Buffer) => {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1] ?? 0;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  };

  it("home, hubs, every agent page and every use case have a share image in both languages", () => {
    const ids = [
      ...STATIC_PAGES.filter((p) => p.ogImage).map((p) => `page-${p.id}`),
      ...AGENTS.filter((a) => a.status !== "hidden").map((a) => `agent-${a.slug}`),
      ...USE_CASES.map((u) => `usecase-${u.slug}`),
    ];
    const missing = ids.flatMap((id) => (["en", "vi"] as const).map((l) => `${id}.${l}`)).filter((k) => !OG_IMAGES.includes(k));
    expect(missing).toEqual([]);
  });

  it("every listed share image is a 1200×630 JPEG of at most 300 KB", () => {
    for (const key of OG_IMAGES) {
      const buf = readFileSync(path.join(ROOT, "public", "og", `${key}.jpg`));
      expect(buf.length, key).toBeLessThanOrEqual(300 * 1024);
      expect(jpegSize(buf), key).toEqual({ w: 1200, h: 630 });
    }
  });
});


describe("the newest release is really downloadable (R3-DL.1)", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "desktop", "package.json"), "utf8")) as { version: string };

  it("the download page points at a hosted installer file, not a placeholder", () => {
    expect(LATEST_RELEASE.url, "download page would show the private-beta note instead of a file").toMatch(
      /^\/__l5e\/assets-v1\/[0-9a-f-]{36}\/[\w.-]+\.exe$/,
    );
  });

  it("the newest listed release is the version the desktop package builds", () => {
    expect(LATEST_RELEASE.version).toBe(pkg.version);
  });

  it("every release with a file carries a 64-digit checksum and a byte count", () => {
    for (const r of RELEASES.filter((x) => x.url)) {
      expect(r.sha256, r.version).toMatch(/^[0-9A-F]{64}$/);
      expect(r.bytes, r.version).toBeGreaterThan(0);
    }
  });
});
