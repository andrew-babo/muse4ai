import fs from "node:fs";
import path from "node:path";
import { LOG_MAX_BYTES, LOG_RETENTION_DAYS } from "../shared/constants";
import { redact } from "../shared/redact";

// R20 — JSON lines, redacted, rotated at 10 MB, kept 14 days. Correlation id = jobId (G5).

export class Logger {
  private file = "";
  constructor(private dir: string, private now: () => number = Date.now) {
    fs.mkdirSync(dir, { recursive: true });
    this.prune();
  }

  private currentFile(): string {
    const d = new Date(this.now());
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    let f = path.join(this.dir, `app-${day}.log`);
    let n = 1;
    while (fs.existsSync(f) && fs.statSync(f).size >= LOG_MAX_BYTES) f = path.join(this.dir, `app-${day}-${n++}.log`);
    return f;
  }

  log(level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>): void {
    const line = redact(JSON.stringify({ ts: new Date(this.now()).toISOString(), level, scope, msg, ...(data ? { data } : {}) }));
    try {
      if (!this.file || !fs.existsSync(this.file) || fs.statSync(this.file).size >= LOG_MAX_BYTES || !this.file.includes(this.dayStamp())) this.file = this.currentFile();
      fs.appendFileSync(this.file, line + "\n");
    } catch {
      /* logging must never crash the app */
    }
    if (process.env.MUSE4AI_DEBUG) console.log(line);
  }

  private dayStamp(): string {
    const d = new Date(this.now());
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  prune(): void {
    const cutoff = this.now() - LOG_RETENTION_DAYS * 86_400_000;
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  files(): string[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => path.join(this.dir, f));
  }
}
