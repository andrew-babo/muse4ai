import fs from "node:fs";
import path from "node:path";
import { BRAND } from "../shared/brand";

// Data locations (spec §4.5, R22: the installer never touches these).
export interface AppPaths {
  roaming: string; // %APPDATA%\MuseStudio
  local: string; // %LOCALAPPDATA%\MuseStudio
  db: string;
  backups: string;
  logs: string;
  vault: string;
  profiles: string;
  thumbs: string;
  refs: string;
  defaultLibrary: string;
}

export function makePaths(roaming: string, local: string, pictures: string): AppPaths {
  return {
    roaming,
    local,
    db: path.join(roaming, "data", "muse.sqlite"),
    backups: path.join(roaming, "backups"),
    logs: path.join(roaming, "logs"),
    vault: path.join(roaming, "vault.json"),
    profiles: path.join(local, "profiles"),
    thumbs: path.join(local, "thumbs"),
    refs: path.join(local, "refs"),
    defaultLibrary: path.join(pictures, BRAND.name),
  };
}

/** True when `child` is inside one of `roots` (path traversal guard for the media protocol). */
export function isInside(child: string, roots: string[]): boolean {
  const c = path.resolve(child);
  return roots.some((r) => {
    const rel = path.relative(path.resolve(r), c);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

/**
 * True only if a file can really be created and removed in `dir` (creating it if needed).
 * A real write probe, because fs.access(W_OK) ignores Windows ACLs (AC-ONB-02).
 */
export function canWriteDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.muse-write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
