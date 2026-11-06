import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changelogMarkdown } from "@content/changelog";
import { RELEASES, SITE_URL } from "@content/site";
import pkg from "../package.json";

// Build 3.3 AC-OSS-01 — the public changelog is generated from the same release list as the website.
describe("CHANGELOG.md", () => {
  // A Windows checkout may turn LF into CRLF (core.autocrlf); the content, not the line ends, must match.
  const file = fs.readFileSync(path.resolve(__dirname, "../../CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");

  it("matches content/site.ts RELEASES (regenerate with `bun scripts/changelog.ts`)", () => {
    expect(file).toBe(changelogMarkdown(RELEASES, SITE_URL));
  });

  it("lists every release once, newest first, and the app's version is the newest or the next one", () => {
    const versions = [...file.matchAll(/^## (\S+) — \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
    expect(versions).toEqual(RELEASES.map((r) => r.version));
    expect(new Set(versions).size).toBe(versions.length);
    const n = (v: string) => Number(/beta\.(\d+)$/.exec(v)?.[1] ?? NaN);
    expect(n(pkg.version) - n(versions[0])).toBeGreaterThanOrEqual(0);
    expect(n(pkg.version) - n(versions[0])).toBeLessThanOrEqual(1);
  });
});
