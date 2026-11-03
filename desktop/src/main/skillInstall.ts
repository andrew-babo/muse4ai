import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Build 3.0 R3-SKILL.6 — "Install for Claude Code": copies the Muse4AI Agent Skill into the user's Claude Code skills
// folder. Files are written to a temporary sibling folder and moved into place with one rename; an existing folder is
// replaced only when the user chose Replace; nothing is ever written outside the target folder.

export interface SkillFileInput {
  /** Path inside the skill, e.g. "muse4ai/SKILL.md" (the leading "muse4ai/" is the target folder itself). */
  name: string;
  data: Uint8Array;
}

export interface SkillTargetInfo {
  target: string;
  exists: boolean;
}

export interface SkillInstallResult {
  target: string;
  files: { path: string; sha256: string; bytes: number }[];
  replaced: boolean;
}

export class SkillInstallError extends Error {
  constructor(
    message: string,
    readonly code: "exists" | "unsafe_path" | "write_failed",
  ) {
    super(message);
  }
}

/** `%USERPROFILE%\.claude\skills\muse4ai` (Claude Code's personal skills folder). */
export function skillTarget(home: string): string {
  return path.join(home, ".claude", "skills", "muse4ai");
}

export function skillTargetInfo(home: string): SkillTargetInfo {
  const target = skillTarget(home);
  return { target, exists: fs.existsSync(target) };
}

/**
 * The file's path relative to the skill folder, or null when it could leave it (absolute paths, `..`, drive letters,
 * empty segments). Only names under "muse4ai/" are accepted.
 */
export function safeRelative(name: string): string | null {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) return null;
  if (name.includes("\0") || name.includes("\\") || name.includes(":")) return null;
  const parts = name.split("/");
  if (parts[0] !== "muse4ai" || parts.length < 2) return null;
  const rest = parts.slice(1);
  if (rest.some((p) => p === "" || p === "." || p === ".." || p.trim() !== p)) return null;
  return rest.join("/");
}

const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

export function installSkill(home: string, files: SkillFileInput[], opts: { replace: boolean }): SkillInstallResult {
  const target = skillTarget(home);
  const parent = path.dirname(target);
  const plan = files.map((f) => {
    const rel = safeRelative(f.name);
    if (rel === null) throw new SkillInstallError(`Tên tệp không an toàn: ${f.name}`, "unsafe_path");
    const dest = path.resolve(target, ...rel.split("/"));
    if (!dest.startsWith(target + path.sep)) throw new SkillInstallError(`Tên tệp không an toàn: ${f.name}`, "unsafe_path");
    return { rel, data: f.data };
  });
  const exists = fs.existsSync(target);
  if (exists && !opts.replace) throw new SkillInstallError("Thư mục skill đã có — chọn Thay thế hoặc Huỷ", "exists");

  const tag = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const temp = path.join(parent, `.muse4ai-new-${tag}`);
  const old = path.join(parent, `.muse4ai-old-${tag}`);
  try {
    fs.mkdirSync(temp, { recursive: true });
    for (const p of plan) {
      const dest = path.join(temp, ...p.rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, p.data);
    }
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new SkillInstallError(`Không ghi được skill: ${(e as Error).message}`, "write_failed");
  }
  try {
    if (exists) fs.renameSync(target, old);
    try {
      fs.renameSync(temp, target);
    } catch (e) {
      if (exists) fs.renameSync(old, target); // put the previous skill back untouched
      throw e;
    }
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new SkillInstallError(`Không ghi được skill: ${(e as Error).message}`, "write_failed");
  }
  if (exists) fs.rmSync(old, { recursive: true, force: true });
  return {
    target,
    replaced: exists,
    files: plan.map((p) => ({ path: path.join(target, ...p.rel.split("/")), sha256: sha256(p.data), bytes: p.data.length })),
  };
}
