import skillMd from "../agent-kit/muse4ai/SKILL.md?raw";
import setupMd from "../agent-kit/muse4ai/references/setup.md?raw";
import toolsMd from "../agent-kit/muse4ai/references/tools.md?raw";
import workflowsMd from "../agent-kit/muse4ai/references/workflows.md?raw";
import troubleshootingMd from "../agent-kit/muse4ai/references/troubleshooting.md?raw";
import { FACTS } from "./facts";
import { SKILL_FILES, zipStore } from "./zip";

/**
 * The Muse4AI Agent Skill (R3-SKILL). One source for the website download,
 * the app's "Download skill" / "Install for Claude Code" buttons and the MCP
 * resource `muse4ai://guide`, so the three never drift apart.
 */
export type SkillFile = (typeof SKILL_FILES)[number];

export const SKILL_SOURCES: Record<SkillFile, string> = {
  "muse4ai/SKILL.md": skillMd,
  "muse4ai/references/setup.md": setupMd,
  "muse4ai/references/tools.md": toolsMd,
  "muse4ai/references/workflows.md": workflowsMd,
  "muse4ai/references/troubleshooting.md": troubleshootingMd,
};

/** File name of the downloadable skill (R3-SKILL.5). */
export const SKILL_ZIP_NAME = `muse4ai-skill-${FACTS.appVersion}.zip`;

/** The skill as a stored ZIP whose entries are byte-identical to the sources (AC-SKILL-04). */
export function skillZip(): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  return zipStore(SKILL_FILES.map((name) => ({ name, data: enc.encode(SKILL_SOURCES[name]) })));
}

/** SKILL.md without its YAML front matter: the text agents read (R3-SKILL.8). */
export function skillBody(): string {
  const src = SKILL_SOURCES["muse4ai/SKILL.md"].replace(/\r\n/g, "\n");
  const m = /^---\n[\s\S]*?\n---\n+/.exec(src);
  return m ? src.slice(m[0].length) : src;
}

/** MCP resource that carries the skill body (AC-MCP-02). */
export const GUIDE_RESOURCE = {
  uri: "muse4ai://guide",
  name: "muse4ai-guide",
  title: "Muse4AI guide for agents",
  description: "How to use the Muse4AI tools well: check status first, unique request_id, waiting, retries and usage limits.",
  mimeType: "text/markdown",
} as const;
