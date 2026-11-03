import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CADDY_DOWNLOAD_TIMEOUT_MS, CADDY_RESTART_DELAYS_S, CADDY_STABLE_MS, CADDY_STOP_TIMEOUT_MS, type CaddyBinary } from "../../shared/api/constants";
import { buildCaddyfile, DOMAIN_MSG, parseCaddyLog, type CaddyConfigInput, type CaddyPhase, type PortCheck } from "../../shared/api/domain";
import { extractEntry } from "./archive";
import { childEnv, downloadVerified, HashMismatchError, lineFeeder, portFree as defaultPortFree, removeFile, sha256File, stopChild, stopOrphan, writePidFile, type SpawnFn } from "./childProc";

// R35 — Caddy as a hidden child of the app: pinned release (archive + executable SHA-256, re-checked before every
// start), generated Caddyfile (admin off, no persisted config, h1/h2 only, only /v1/* and /mcp to loopback,
// per-run ingress marker), port 443/80 checked first, restart back-off, PID + path ownership for leftovers.


/** Caddy lines that carry no signal for the user (see onLine). */
const CADDY_QUIET = /unable to set keepalive/i;
export interface CaddyRun {
  host: string;
  apiPort: number;
}

export interface CaddyStatus {
  phase: CaddyPhase;
  progress: number | null;
  error: string | null;
  attempt: number;
  port: PortCheck | null;
  certError: string | null;
  certObtaining: boolean;
  certObtainedAt: number | null;
  pid: number | null;
}

export interface CaddyDeps {
  binDir: string;
  /** `%LOCALAPPDATA%\MuseStudio\caddy` — Caddyfile, pid file and `data` (certificate store) live here. */
  caddyDir: string;
  binary: CaddyBinary | null;
  fetch: typeof fetch;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
  onChange: (s: CaddyStatus) => void;
  /** Certificate obtained / failed or Caddy started → the monitor checks again soon. */
  onEvent?: (kind: "started" | "obtained" | "cert_error") => void;
  now?: () => number;
  spawn?: SpawnFn;
  processPath?: (pid: number) => Promise<string | null>;
  kill?: (pid: number) => void;
  portFree?: (port: number) => Promise<boolean>;
  /** Tests: back-off and stability window. */
  delaysS?: number[];
  stableMs?: number;
  /** Tests only: local CA and high ports. */
  config?: Partial<Pick<CaddyConfigInput, "issuer" | "httpPort" | "httpsPort">>;
}

const OFF: CaddyStatus = { phase: "off", progress: null, error: null, attempt: 0, port: null, certError: null, certObtaining: false, certObtainedAt: null, pid: null };

export class CaddyManager {
  private status: CaddyStatus = { ...OFF };
  private child: ChildProcess | null = null;
  private retiring = new WeakSet<ChildProcess>();
  private run: CaddyRun | null = null;
  /** Bumped by every start/stop request: only the newest request may launch. */
  private seq = 0;
  /** Bumped whenever the current launch must be abandoned. */
  private gen = 0;
  private currentMarker: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private lastExitReason: string | null = null;
  private logBudget = { windowStart: 0, lines: 0 };

  constructor(private d: CaddyDeps) {}

  get exePath(): string | null {
    return this.d.binary ? path.join(this.d.binDir, this.d.binary.file) : null;
  }
  get dataDir(): string {
    return path.join(this.d.caddyDir, "data");
  }
  private get pidFile(): string {
    return path.join(this.d.caddyDir, "caddy.pid");
  }
  private get configFile(): string {
    return path.join(this.d.caddyDir, "Caddyfile");
  }
  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  getStatus(): CaddyStatus {
    return { ...this.status };
  }

  /** Ingress marker of the running Caddy (null when none is running): the API requires it on domain requests. */
  marker(): string | null {
    return this.currentMarker;
  }

  childPid(): number | null {
    return this.child?.pid ?? null;
  }

  private set(patch: Partial<CaddyStatus>): void {
    this.status = { ...this.status, ...patch };
    this.d.onChange(this.getStatus());
  }

  // ---------------------------------------------------------------- lifecycle
  /** Starts, or restarts when host/port changed. Returns immediately; progress goes through onChange. */
  start(run: CaddyRun): void {
    const same = this.run && this.run.host === run.host && this.run.apiPort === run.apiPort && this.status.phase !== "error" && this.status.phase !== "off";
    if (same) return;
    const seq = ++this.seq;
    void this.halt().then(() => {
      if (seq !== this.seq) return;
      this.run = run;
      this.set({ ...OFF, phase: "starting" });
      void this.launch(++this.gen);
    });
  }

  retry(): void {
    const run = this.run ?? null;
    if (!run) return;
    this.run = null;
    this.start(run);
  }

  async stop(): Promise<void> {
    ++this.seq;
    await this.halt();
  }

  private async halt(): Promise<void> {
    this.gen++;
    this.run = null;
    this.currentMarker = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = this.stableTimer = null;
    const child = this.child;
    this.child = null;
    if (child) this.retiring.add(child);
    await stopChild(child, CADDY_STOP_TIMEOUT_MS);
    removeFile(this.pidFile);
    if (this.status.phase !== "off" || this.status.error) this.set({ ...OFF });
  }

  /** Synchronous kill for app quit. */
  killNow(): void {
    this.gen++;
    this.seq++;
    this.currentMarker = null;
    try {
      if (this.child) this.retiring.add(this.child);
      this.child?.kill();
    } catch {
      /* gone */
    }
    this.child = null;
    removeFile(this.pidFile);
  }

  cleanupOrphan(): Promise<"none" | "killed" | "kept"> {
    return stopOrphan(this.pidFile, this.exePath, { processPath: this.d.processPath, kill: this.d.kill, log: (l, m, data) => this.d.log(l, m, data) }, "caddy");
  }

  // ---------------------------------------------------------------- binary
  async ensureBinary(gen: number): Promise<string> {
    const b = this.d.binary;
    const exe = this.exePath;
    if (!b || !exe) throw new Error(DOMAIN_MSG.unsupported);
    fs.mkdirSync(this.d.binDir, { recursive: true });
    if (fs.existsSync(exe)) {
      const h = await sha256File(exe);
      if (h === b.sha256) return exe;
      removeFile(exe);
      this.d.log("warn", "caddy binary hash mismatch — deleted", { expected: b.sha256, actual: h });
      throw new Error(DOMAIN_MSG.hashMismatch);
    }
    this.set({ phase: "downloading", progress: 0, error: null });
    const archive = path.join(this.d.binDir, path.basename(new URL(b.url).pathname));
    try {
      const bytes = await downloadVerified({
        url: b.url,
        dest: archive,
        sha256: b.archiveSha256,
        expectedBytes: b.archiveBytes,
        timeoutMs: CADDY_DOWNLOAD_TIMEOUT_MS,
        fetch: this.d.fetch,
        cancelled: () => gen !== this.gen,
        onProgress: (p) => this.set({ phase: "downloading", progress: p }),
      });
      const part = `${exe}.part`;
      await extractEntry(archive, b.entry, part);
      const h = await sha256File(part);
      if (h !== b.sha256) {
        removeFile(part);
        throw new HashMismatchError(b.sha256, h);
      }
      fs.renameSync(part, exe);
      if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
      this.d.log("info", "caddy downloaded and verified", { bytes });
      return exe;
    } catch (e) {
      if (e instanceof HashMismatchError) {
        this.d.log("warn", "downloaded caddy hash mismatch", { expected: e.expected, actual: e.actual });
        throw new Error(DOMAIN_MSG.hashMismatch);
      }
      if ((e as Error).message === "cancelled") throw e;
      this.d.log("warn", "caddy download failed", { error: (e as Error).message });
      throw new Error(DOMAIN_MSG.download);
    } finally {
      removeFile(archive);
      removeFile(`${exe}.part`);
    }
  }

  // ---------------------------------------------------------------- run loop
  private async launch(gen: number): Promise<void> {
    const run = this.run;
    if (!run || gen !== this.gen) return;
    let exe: string;
    try {
      exe = await this.ensureBinary(gen);
    } catch (e) {
      if (gen !== this.gen) return;
      this.set({ phase: "error", error: (e as Error).message, progress: null });
      return;
    }
    if (gen !== this.gen) return;
    this.set({ phase: "starting", progress: null, error: null, port: { state: "running", detail: DOMAIN_MSG.portChecking } });
    const free = this.d.portFree ?? defaultPortFree;
    const httpsPort = this.d.config?.httpsPort ?? 443;
    const httpPort = this.d.config?.httpPort ?? 80;
    const httpsFree = await free(httpsPort);
    if (gen !== this.gen) return;
    if (!httpsFree) {
      this.d.log("warn", "port 443 busy — caddy not started", { port: httpsPort });
      this.set({ phase: "error", error: DOMAIN_MSG.port443, port: { state: "fail", detail: DOMAIN_MSG.port443 } });
      return;
    }
    const httpBusy = !(await free(httpPort));
    if (gen !== this.gen) return;
    const port: PortCheck = httpBusy ? { state: "warn", detail: DOMAIN_MSG.port80 } : { state: "ok", detail: DOMAIN_MSG.portOk };
    const marker = randomBytes(16).toString("hex");
    fs.mkdirSync(this.dataDir, { recursive: true });
    const cfg = buildCaddyfile({ host: run.host, apiPort: run.apiPort, marker, storageDir: this.dataDir, httpBusy, ...this.d.config });
    fs.writeFileSync(this.configFile, cfg);
    this.lastExitReason = null;
    let child: ChildProcess;
    try {
      child = (this.d.spawn ?? nodeSpawn)(exe, ["run", "--config", this.configFile, "--adapter", "caddyfile"], {
        windowsHide: true,
        shell: false,
        cwd: this.d.caddyDir,
        // Caddy's own data/config folders stay inside the app's folder (nothing under %AppData%\Caddy or ~/.local).
        env: childEnv({ XDG_DATA_HOME: path.join(this.d.caddyDir, "xdg-data"), XDG_CONFIG_HOME: path.join(this.d.caddyDir, "xdg-config") }),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      this.d.log("error", "caddy spawn failed", { error: String(e) });
      return this.failed(gen, DOMAIN_MSG.exited);
    }
    this.child = child;
    this.currentMarker = marker;
    this.set({ phase: "starting", port, pid: child.pid ?? null });
    if (child.pid) writePidFile(this.pidFile, { pid: child.pid, exe, startedAt: this.now() });
    const feed = lineFeeder((line) => this.onLine(gen, line));
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
    child.on("error", (e) => this.d.log("warn", "caddy process error", { error: String(e) }));
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.retiring.has(child) || gen !== this.gen) return;
      this.currentMarker = null;
      removeFile(this.pidFile);
      this.d.log("warn", "caddy exited", { code, signal });
      this.failed(gen, this.lastExitReason ?? DOMAIN_MSG.exited);
    });
  }

  private onLine(gen: number, raw: string): void {
    const line = raw.trim();
    if (!line || gen !== this.gen) return;
    const ev = parseCaddyLog(line);
    switch (ev.kind) {
      case "started":
        this.set({ phase: "running", error: null });
        this.d.log("info", "caddy running", {});
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => {
          if (gen === this.gen) this.status.attempt = 0;
        }, this.d.stableMs ?? CADDY_STABLE_MS);
        this.stableTimer.unref?.();
        this.d.onEvent?.("started");
        break;
      case "obtaining":
        this.set({ certObtaining: true });
        break;
      case "obtained":
        this.set({ certObtaining: false, certError: null, certObtainedAt: this.now() });
        this.d.log("info", "certificate obtained", {});
        this.d.onEvent?.("obtained");
        break;
      case "cert_error":
        this.set({ certError: ev.detail });
        this.d.onEvent?.("cert_error");
        break;
      case "bind_error":
        this.lastExitReason = DOMAIN_MSG.port443;
        break;
    }
    // Windows Server 2016 cannot set TCP keepalive on accepted sockets: Caddy warns on every new connection,
    // harmless, and it would fill the log budget while agents poll. Skip it before counting.
    if (CADDY_QUIET.test(line)) return;
    // Bounded logging, hostname never logged (the line may contain it; the redactor masks secrets only).
    const now = Date.now();
    if (now - this.logBudget.windowStart > 60_000) this.logBudget = { windowStart: now, lines: 0 };
    if (this.logBudget.lines++ < 30) {
      let msg = line;
      try {
        const j = JSON.parse(line) as { level?: string; msg?: string; logger?: string };
        msg = `${j.level ?? ""} ${j.logger ?? ""} ${j.msg ?? ""}`.trim();
      } catch {
        msg = line.replace(/[a-z0-9.-]+\.[a-z]{2,63}/gi, "•••").slice(0, 200);
      }
      this.d.log(ev.kind === "log" && ev.level === "warn" ? "warn" : "info", "caddy", { line: msg.slice(0, 200) });
    }
  }

  private failed(gen: number, reason: string): void {
    if (gen !== this.gen) return;
    if (this.stableTimer) clearTimeout(this.stableTimer);
    const attempt = this.status.attempt + 1;
    const delays = this.d.delaysS ?? CADDY_RESTART_DELAYS_S;
    if (attempt > delays.length) {
      this.set({ phase: "error", error: DOMAIN_MSG.gaveUp, attempt, pid: null });
      return;
    }
    this.set({ phase: "retrying", error: reason, attempt, pid: null });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (gen === this.gen) void this.launch(gen);
    }, delays[attempt - 1] * 1000);
  }
}
