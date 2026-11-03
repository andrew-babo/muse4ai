// AC-ACC-08: removing an account deletes its browser profile. Its session data is cleared at once, but on Windows
// Chromium keeps the partition's files open until the app exits, so the folder itself can only go on the next start.
// At start-up — before any account session exists — every account profile folder that belongs to no current account
// is deleted. Only folders this app creates (Partitions/acc-*) are touched.
import fs from "node:fs";
import path from "node:path";

const PREFIX = "acc-";

export interface SweepResult {
  removed: number;
  failed: number;
}

export function sweepOrphanProfiles(sessionDataDir: string, liveAccountIds: Iterable<string>): SweepResult {
  const dir = path.join(sessionDataDir, "Partitions");
  const live = new Set([...liveAccountIds].map((id) => `${PREFIX}${id}`.toLowerCase()));
  const result: SweepResult = { removed: 0, failed: 0 };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result; // no profiles yet
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.toLowerCase().startsWith(PREFIX) || live.has(e.name.toLowerCase())) continue;
    try {
      fs.rmSync(path.join(dir, e.name), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      result.removed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
