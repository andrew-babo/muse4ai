import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";

// Shared plumbing for the helper programs the app runs as hidden children (cloudflared R30, Caddy R35):
// pinned downloads, hash checks, minimal environment, bounded stop, PID + executable-path ownership.

export type SpawnFn = typeof nodeSpawn;

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return h.digest("hex");
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** True when nothing on this machine listens on `port` (all IPv4 and IPv6 addresses). */
export async function portFree(port: number): Promise<boolean> {
  for (const host of ["0.0.0.0", "::"]) {
    const r = await new Promise<"free" | "busy" | "skip">((resolve) => {
      const s = net.createServer();
      s.once("error", (e: NodeJS.ErrnoException) => resolve(e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL" ? "skip" : "busy"));
      s.listen({ host, port, exclusive: true, ipv6Only: host === "::" }, () => s.close(() => resolve("free")));
    });
    if (r === "busy") return false;
  }
  return true;
}

export async function defaultProcessPath(pid: number): Promise<string | null> {
  if (process.platform === "linux") {
    try {
      return fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "");
    } catch {
      return null;
    }
  }
  if (process.platform === "win32") {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${Math.trunc(pid)} -ErrorAction SilentlyContinue; if ($p) { $p.Path }`],
        { windowsHide: true, timeout: 10_000 },
        (err, stdout) => resolve(err ? null : stdout.trim() || null),
      );
    });
  }
  try {
    process.kill(pid, 0);
    return "";
  } catch {
    return null;
  }
}

export const samePath = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Minimal environment for a child: enough for Windows networking/DNS, nothing of the app's own env. */
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const keep = ["SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "PATH", "Path", "HOME", "LANG"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

/** Asks the child to exit and waits; force-kills after `timeoutMs`. */
export function stopChild(child: ChildProcess | null, timeoutMs: number): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
    try {
      child.kill();
    } catch {
      clearTimeout(t);
      resolve();
    }
  });
}

export interface PidRecord {
  pid: number;
  exe: string;
  startedAt?: number;
}

export function writePidFile(file: string, rec: PidRecord): void {
  fs.writeFileSync(file, JSON.stringify(rec));
}

export function removeFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * A child left behind by a crash is stopped only if the recorded PID still runs *our* executable
 * (same path as recorded and as the pinned file) — never another program that reused the PID.
 */
export async function stopOrphan(
  pidFile: string,
  ourExe: string | null,
  d: { processPath?: (pid: number) => Promise<string | null>; kill?: (pid: number) => void; log: (level: "info" | "warn", msg: string, data?: Record<string, unknown>) => void },
  label: string,
): Promise<"none" | "killed" | "kept"> {
  let rec: PidRecord | null = null;
  try {
    rec = JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return "none";
  }
  removeFile(pidFile);
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 0 || typeof rec.exe !== "string") return "none";
  const actual = await (d.processPath ?? defaultProcessPath)(rec.pid);
  if (actual && ourExe && samePath(actual, rec.exe) && samePath(actual, ourExe)) {
    try {
      (d.kill ?? ((pid) => process.kill(pid)))(rec.pid);
      d.log("info", `stopped leftover ${label} process`, { pid: rec.pid });
      return "killed";
    } catch {
      return "kept";
    }
  }
  if (actual !== null) d.log("info", `leftover ${label} pid belongs to another program — not touched`, { pid: rec.pid });
  return actual === null ? "none" : "kept";
}

export class HashMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super("hash mismatch");
  }
}

/**
 * Streams `url` into `dest` while hashing; the file only appears under `dest` when the SHA-256 matches.
 * Throws HashMismatchError, Error("cancelled") or the network error.
 */
export async function downloadVerified(o: {
  url: string;
  dest: string;
  sha256: string;
  expectedBytes: number;
  timeoutMs: number;
  fetch: typeof fetch;
  cancelled: () => boolean;
  onProgress: (p: number) => void;
}): Promise<number> {
  const part = `${o.dest}.part`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs);
  try {
    const res = await o.fetch(o.url, { signal: ac.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || o.expectedBytes;
    const h = createHash("sha256");
    const out = fs.createWriteStream(part);
    let got = 0;
    let last = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        if (o.cancelled()) throw new Error("cancelled");
        const { done, value } = await reader.read();
        if (done) break;
        h.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        const now = Date.now();
        if (now - last > 250) {
          last = now;
          o.onProgress(Math.min(1, got / total));
        }
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    const digest = h.digest("hex");
    if (digest !== o.sha256) throw new HashMismatchError(o.sha256, digest);
    fs.renameSync(part, o.dest);
    return got;
  } catch (e) {
    removeFile(part);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Splits a child's output into lines (bounded buffer). */
export function lineFeeder(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
    if (buf.length > 16_384) buf = "";
  };
}
