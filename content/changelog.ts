import type { Release } from "./types";

// Build 3.3 AC-OSS-01 — CHANGELOG.md at the repository root is generated from RELEASES (content/site.ts) by
// `bun scripts/changelog.ts`; desktop/test/changelog.test.ts fails when the file and the release list drift apart.
// Dependency-free so the website, the scripts and the desktop tests share it.

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function changelogMarkdown(releases: readonly Release[], siteUrl: string): string {
  const out: string[] = [
    "# Changelog",
    "",
    "All notable changes to Muse4AI, newest first. Downloads and the Vietnamese notes:",
    `[${siteUrl.replace(/^https:\/\//, "")}/download](${siteUrl}/download) · [Tiếng Việt](${siteUrl}/vi/download).`,
    "",
    "<!-- Generated from content/site.ts (RELEASES) by `bun scripts/changelog.ts`. Edit the release notes there, not here. -->",
  ];
  for (const r of releases) {
    out.push("", `## ${r.version} — ${r.date}`, "");
    for (const n of r.notes) out.push(`- ${n.en}`);
    if (r.url && r.sha256 && r.bytes) {
      const file = r.url.split("/").pop() ?? "installer";
      out.push("", `Installer \`${file}\` · ${mb(r.bytes)} · SHA-256 \`${r.sha256}\``);
    }
  }
  out.push("");
  return out.join("\n");
}
