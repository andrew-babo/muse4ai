import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BRAND } from "../../shared/brand";
import {
  PUBLIC_FAIL_THRESHOLD,
  TUNNEL_HEALTH_INTERVAL_MS,
  TUNNEL_DOWNLOAD_TIMEOUT_MS,
  TUNNEL_ONLINE_TIMEOUT_MS,
  TUNNEL_RESTART_DELAYS_S,
  TUNNEL_STABLE_MS,
  TUNNEL_STOP_TIMEOUT_MS,
  selfCheckHeaders,
  type TunnelBinary,
} from "../../shared/api/constants";
import type { TunnelState, TunnelStatus } from "../../shared/types";
import { childEnv as baseEnv, defaultProcessPath, freePort, samePath, sha256File } from "./childProc";

// R30 — cloudflared as a hidden child process of the app: pinned build + SHA-256, no service, no machine config,
// token only in the child's environment, "online" only after the public URL answers with our instance id.

export interface TunnelRun {
  mode: "quick" | "named";
  originPort: number;
  /** Named tunnels: the public hostname the user configured in Cloudflare. */
  hostname?: string;
  /** Named tunnels: connector token (passed as TUNNEL_TOKEN env only). */
  token?: string;
}

export interface TunnelDeps {
  binDir: string;
  binary: TunnelBinary | null;
  instanceId: string;
  /** Sent on health checks so the API leaves them out of the request log. */
  selfCheckToken?: string;
  fetch: typeof fetch;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
  onChange: (s: TunnelStatus) => void;
  now?: () => number;
  spawn?: typeof nodeSpawn;
  /** Executable path of a running process, or null if it is not running. */
  processPath?: (pid: number) => Promise<string | null>;
  kill?: (pid: number) => void;
  /** Overrides for tests. */
  delaysS?: number[];
  onlineTimeoutMs?: number;
  probeIntervalMs?: number;
  /** R30 rev 5 — check while online, and how many failures in a row restart cloudflared. */
  healthIntervalMs?: number;
  failThreshold?: number;
}

/** Token only in the child's environment (never argv/config/logs). */
const childEnv = (token?: string) => baseEnv(token ? { TUNNEL_TOKEN: token } : {});

export const TUNNEL_MSG = {
  hashMismatch: "Tệp đường hầm không khớp mã kiểm tra — đã xoá tệp, không chạy. Bấm Thử lại để tải lại",
  download: "Không tải được chương trình đường hầm (cloudflared) — kiểm tra mạng rồi bấm Thử lại",
  unsupported: "Máy này chưa hỗ trợ đường hầm Cloudflare",
  noEdge: "Không nối được tới Cloudflare — mạng có thể chặn kết nối ra ngoài (cổng 7844)",
  quickRefused: "Cloudflare từ chối tạo địa chỉ tạm thời (giới hạn) — thử lại sau ít phút",
  badToken: "Token đường hầm không hợp lệ — dán lại token từ Cloudflare",
  verify: "Đường hầm đã chạy nhưng địa chỉ công khai chưa trả lời đúng app — kiểm tra cấu hình tên miền",
  gaveUp: "Đường hầm dừng 5 lần liên tiếp — bấm Thử lại",
  missingNamed: "Chưa nhập đủ token và tên miền cho đường hầm riêng",
  lost: "Mất kết nối, đang nối lại",
} as const;

export { sha256File, freePort, defaultProcessPath };

export class TunnelManager {
  private status: TunnelStatus = { state: "off", progress: null, url: null, error: null, since: null, attempt: 0, hasToken: false };
  private child: ChildProcess | null = null;
  private retiring = new WeakSet<ChildProcess>();
  /** Bumped by every start/stop request: only the newest request may launch (fast toggles leave one process). */
  private seq = 0;
  private gen = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private healthFails = 0;
  private run: TunnelRun | null = null;
  private hostname: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private stderrBudget = { windowStart: 0, lines: 0 };
  private lastStderrError: string | null = null;

  constructor(private d: TunnelDeps) {}

  get exePath(): string | null {
    return this.d.binary ? path.join(this.d.binDir, this.d.binary.file) : null;
  }
  private get pidFile(): string {
    return path.join(this.d.binDir, "tunnel.pid");
  }
  private get configFile(): string {
    return path.join(this.d.binDir, "cloudflared-muse.yml");
  }
  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }

  /** Hostnames the API server must accept as "public" right now (needed before verification succeeds). */
  publicHosts(): string[] {
    return this.hostname ? [this.hostname] : [];
  }

  childPid(): number | null {
    return this.child?.pid ?? null;
  }

  private set(state: TunnelState, patch: Partial<TunnelStatus> = {}): void {
    const changed = state !== this.status.state;
    this.status = { ...this.status, ...patch, state, since: changed ? this.now() : this.status.since };
    this.d.onChange(this.getStatus());
  }

  setHasToken(v: boolean): void {
    if (this.status.hasToken !== v) {
      this.status = { ...this.status, hasToken: v };
      this.d.onChange(this.getStatus());
    }
  }

  // ---------------------------------------------------------------- lifecycle
  /** Starts (or restarts with new settings). Returns immediately; progress is reported through onChange. */
  start(run: TunnelRun): void {
    const same = this.run && JSON.stringify(this.run) === JSON.stringify(run) && this.status.state !== "error" && this.status.state !== "off";
    if (same) return;
    const seq = ++this.seq;
    void this.halt().then(() => {
      if (seq !== this.seq) return;
      this.run = run;
      this.status.attempt = 0;
      void this.launch(++this.gen);
    });
  }

  retry(): void {
    if (!this.run) return;
    const run = this.run;
    this.run = null;
    this.start(run);
  }

  /** Stops the child and waits for it to exit (≤ 3 s, then force). */
  async stop(): Promise<void> {
    ++this.seq;
    await this.halt();
  }

  private async halt(): Promise<void> {
    this.gen++;
    this.run = null;
    this.hostname = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stopHealth();
    this.retryTimer = this.stableTimer = null;
    const child = this.child;
    this.child = null;
    if (child) this.retiring.add(child);
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
          resolve();
        }, TUNNEL_STOP_TIMEOUT_MS);
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
    this.removePidFile();
    if (this.status.state !== "off" || this.status.url || this.status.error) this.set("off", { url: null, error: null, progress: null, attempt: 0 });
  }

  /** Synchronous kill for app quit. */
  killNow(): void {
    this.gen++;
    this.seq++;
    this.stopHealth();
    try {
      if (this.child) this.retiring.add(this.child);
      this.child?.kill();
    } catch {
      /* gone */
    }
    this.child = null;
    this.removePidFile();
  }

  /** R30 — a cloudflared left behind by a crash is stopped only if it is our PID *and* our executable. */
  async cleanupOrphan(): Promise<"none" | "killed" | "kept"> {
    let rec: { pid: number; exe: string } | null = null;
    try {
      rec = JSON.parse(fs.readFileSync(this.pidFile, "utf8"));
    } catch {
      return "none";
    }
    this.removePidFile();
    if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 0 || typeof rec.exe !== "string") return "none";
    const actual = await (this.d.processPath ?? defaultProcessPath)(rec.pid);
    const ours = this.exePath;
    if (actual && ours && samePath(actual, rec.exe) && samePath(actual, ours)) {
      try {
        (this.d.kill ?? ((pid) => process.kill(pid)))(rec.pid);
        this.d.log("info", "stopped leftover tunnel process", { pid: rec.pid });
        return "killed";
      } catch {
        return "kept";
      }
    }
    if (actual !== null) this.d.log("info", "leftover tunnel pid belongs to another program — not touched", { pid: rec.pid });
    return actual === null ? "none" : "kept";
  }

  private removePidFile(): void {
    try {
      fs.rmSync(this.pidFile, { force: true });
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- binary (pinned, verified)
  /** Ensures the pinned binary exists and matches; downloads it if absent. Throws with a user message. */
  async ensureBinary(gen: number): Promise<string> {
    const b = this.d.binary;
    const exe = this.exePath;
    if (!b || !exe) throw new Error(TUNNEL_MSG.unsupported);
    fs.mkdirSync(this.d.binDir, { recursive: true });
    if (fs.existsSync(exe)) {
      const h = await sha256File(exe);
      if (h === b.sha256) return exe;
      fs.rmSync(exe, { force: true });
      this.d.log("warn", "tunnel binary hash mismatch — deleted", { expected: b.sha256, actual: h });
      throw new Error(TUNNEL_MSG.hashMismatch);
    }
    this.set("downloading", { progress: 0, error: null });
    const part = `${exe}.part`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TUNNEL_DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await this.d.fetch(b.url, { signal: ac.signal, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || b.bytes;
      const h = createHash("sha256");
      const out = fs.createWriteStream(part);
      let got = 0;
      let lastReport = 0;
      const reader = res.body.getReader();
      for (;;) {
        if (gen !== this.gen) throw new Error("cancelled");
        const { done, value } = await reader.read();
        if (done) break;
        h.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        const now = Date.now();
        if (now - lastReport > 250) {
          lastReport = now;
          this.set("downloading", { progress: Math.min(1, got / total) });
        }
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
      const digest = h.digest("hex");
      if (digest !== b.sha256) {
        fs.rmSync(part, { force: true });
        this.d.log("warn", "downloaded tunnel binary hash mismatch", { expected: b.sha256, actual: digest, bytes: got });
        throw new Error(TUNNEL_MSG.hashMismatch);
      }
      fs.renameSync(part, exe);
      if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
      this.d.log("info", "tunnel binary downloaded and verified", { bytes: got });
      return exe;
    } catch (e) {
      fs.rmSync(part, { force: true });
      const msg = (e as Error).message;
      if (msg === TUNNEL_MSG.hashMismatch || msg === "cancelled") throw e;
      this.d.log("warn", "tunnel download failed", { error: msg });
      throw new Error(TUNNEL_MSG.download);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- run loop
  private async launch(gen: number): Promise<void> {
    const run = this.run;
    if (!run || gen !== this.gen) return;
    if (run.mode === "named" && (!run.token || !run.hostname)) {
      this.set("error", { error: TUNNEL_MSG.missingNamed, url: null, progress: null });
      return;
    }
    let exe: string;
    try {
      exe = await this.ensureBinary(gen);
    } catch (e) {
      if (gen !== this.gen) return;
      this.set("error", { error: (e as Error).message, progress: null, url: null });
      return;
    }
    if (gen !== this.gen) return;
    this.set("starting", { progress: null, error: null, url: null });
    const metricsPort = await freePort();
    if (gen !== this.gen) return;
    fs.writeFileSync(this.configFile, "# Muse4AI: empty on purpose so a user-wide cloudflared config is never picked up\n");
    const args = ["tunnel", "--config", this.configFile, "--no-autoupdate", "--metrics", `127.0.0.1:${metricsPort}`, "--loglevel", "info"];
    if (run.mode === "quick") args.push("--url", `http://127.0.0.1:${run.originPort}`);
    else args.push("run");
    this.hostname = run.mode === "named" ? run.hostname!.toLowerCase() : null;
    this.lastStderrError = null;
    let child: ChildProcess;
    try {
      child = (this.d.spawn ?? nodeSpawn)(exe, args, { windowsHide: true, shell: false, env: childEnv(run.mode === "named" ? run.token : undefined), stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      this.d.log("error", "tunnel spawn failed", { error: String(e) });
      return this.failed(gen, TUNNEL_MSG.noEdge);
    }
    this.child = child;
    if (child.pid) fs.writeFileSync(this.pidFile, JSON.stringify({ pid: child.pid, exe, startedAt: this.now() }));
    const onLine = (line: string) => this.onStderr(line);
    let buf = "";
    const feed = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 8192) buf = "";
    };
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
    child.on("error", (e) => this.d.log("warn", "tunnel process error", { error: String(e) }));
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.retiring.has(child) || gen !== this.gen) return;
      this.stopHealth();
      this.d.log("warn", "tunnel process exited", { code, signal });
      this.removePidFile();
      this.failed(gen, this.lastStderrError ?? TUNNEL_MSG.noEdge);
    });

    // Wait for the hostname (quick) and the public URL to answer with our instance id.
    const deadline = Date.now() + (this.d.onlineTimeoutMs ?? TUNNEL_ONLINE_TIMEOUT_MS);
    const interval = this.d.probeIntervalMs ?? 2000;
    while (gen === this.gen && Date.now() < deadline && this.child === child) {
      if (!this.hostname) this.hostname = await this.readQuickHostname(metricsPort);
      if (this.hostname) {
        if (this.status.state !== "verifying") this.set("verifying", { url: `https://${this.hostname}` });
        if (await this.probe(this.hostname)) {
          if (gen !== this.gen) return;
          this.set("online", { url: `https://${this.hostname}`, error: null });
          this.d.log("info", "tunnel online", { mode: run.mode });
          this.stableTimer = setTimeout(() => {
            if (gen === this.gen) this.status.attempt = 0;
          }, TUNNEL_STABLE_MS);
          this.startHealth(gen, child);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    if (gen !== this.gen || this.child !== child) return;
    this.d.log("warn", "tunnel did not verify in time", { mode: run.mode, hostname: !!this.hostname });
    const reason = this.lastStderrError ?? (this.hostname ? TUNNEL_MSG.verify : TUNNEL_MSG.noEdge);
    this.child = null;
    try {
      child.kill();
    } catch {
      /* gone */
    }
    this.failed(gen, reason);
  }

  // ---------------------------------------------------------------- health while online (R30 rev 5)
  private stopHealth(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = null;
    this.healthFails = 0;
  }

  private startHealth(gen: number, child: ChildProcess): void {
    this.stopHealth();
    const tick = () => {
      this.healthTimer = setTimeout(async () => {
        this.healthTimer = null;
        if (gen !== this.gen || this.child !== child || !this.hostname) return;
        const ok = await this.probe(this.hostname);
        if (gen !== this.gen || this.child !== child) return;
        if (ok) {
          this.healthFails = 0;
          return tick();
        }
        this.healthFails++;
        this.d.log("warn", "tunnel health check failed", { fails: this.healthFails });
        if (this.healthFails < (this.d.failThreshold ?? PUBLIC_FAIL_THRESHOLD)) return tick();
        // Lost: restart cloudflared, counted as one attempt of the back-off.
        this.healthFails = 0;
        this.child = null;
        this.retiring.add(child);
        try {
          child.kill();
        } catch {
          /* gone */
        }
        this.removePidFile();
        this.failed(gen, TUNNEL_MSG.lost);
      }, this.d.healthIntervalMs ?? TUNNEL_HEALTH_INTERVAL_MS);
      this.healthTimer.unref?.();
    };
    tick();
  }

  private failed(gen: number, reason: string): void {
    if (gen !== this.gen) return;
    if (this.stableTimer) clearTimeout(this.stableTimer);
    const attempt = this.status.attempt + 1;
    const delays = this.d.delaysS ?? TUNNEL_RESTART_DELAYS_S;
    if (attempt > delays.length) {
      this.set("error", { error: `${TUNNEL_MSG.gaveUp} (${reason})`, url: null, attempt });
      return;
    }
    const delay = delays[attempt - 1];
    this.set("retrying", { error: reason, url: null, attempt });
    this.hostname = this.run?.mode === "named" ? (this.run.hostname ?? null) : null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (gen === this.gen) void this.launch(gen);
    }, delay * 1000);
  }

  private async readQuickHostname(metricsPort: number): Promise<string | null> {
    try {
      const r = await this.d.fetch(`http://127.0.0.1:${metricsPort}/quicktunnel`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { hostname?: string };
      const h = typeof j.hostname === "string" ? j.hostname.trim().toLowerCase() : "";
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
    } catch {
      return null;
    }
  }

  private async probe(hostname: string): Promise<boolean> {
    try {
      const r = await this.d.fetch(`https://${hostname}/v1/health`, { signal: AbortSignal.timeout(8000), headers: selfCheckHeaders(this.d.selfCheckToken) });
      if (!r.ok) return false;
      const j = (await r.json()) as { instance?: string; service?: string };
      return j.service === BRAND.id && j.instance === this.d.instanceId;
    } catch {
      return false;
    }
  }

  private onStderr(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    if (/failed to (request|unmarshal) quick tunnel|429 Too Many Requests/i.test(line)) this.lastStderrError = TUNNEL_MSG.quickRefused;
    else if (/Unauthorized|invalid tunnel secret|token is not valid|Provided Tunnel token/i.test(line)) this.lastStderrError = TUNNEL_MSG.badToken;
    else if (/failed to dial to edge|dial tcp .*7844|edge discovery: error/i.test(line)) this.lastStderrError = TUNNEL_MSG.noEdge;
    if (!this.hostname && this.run?.mode === "quick") {
      const m = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i.exec(line);
      if (m) this.hostname = m[1].toLowerCase();
    }
    // Bounded logging: at most 30 lines per minute from the child.
    const now = Date.now();
    if (now - this.stderrBudget.windowStart > 60_000) this.stderrBudget = { windowStart: now, lines: 0 };
    if (this.stderrBudget.lines++ < 30) this.d.log(/ERR|error/i.test(line) ? "warn" : "info", "cloudflared", { line: line.slice(0, 300) });
  }
}
