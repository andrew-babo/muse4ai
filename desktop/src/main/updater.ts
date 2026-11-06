import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  consoleLaunchArgs,
  installerArgs,
  installerFileName,
  isNewer,
  mergeVersionsRecord,
  parseManifest,
  previousVersion,
  readVersionsRecord,
  rollbackCheck,
  staleInstallers,
  UPDATE_LIMITS,
  type DownloadState,
  type RollbackCheck,
  type UpdateManifest,
  type UpdateNote,
  type UpdateStatus,
  type VersionsRecord,
} from "../shared/updates";

// Build 3.3 — the app checks the website for a newer version, downloads and verifies its installer, runs it silently
// and reopens; it can also go back to the kept previous version (Spec AC-UPD-01…08, AC-RBK-01…03). No Electron
// imports: main.ts injects net.fetch, spawn and quit, so every rule here runs in plain Node tests.

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface InstallLayout {
  /** `%LOCALAPPDATA%\Programs\Muse4AI` (or the folder the installer was pointed at). */
  root: string;
  /** `<root>\tools\install.ps1`, kept by the installer for rollback/uninstall without the ZIP (AC-UNI-02). */
  installScript: string;
}

export interface UpdaterDeps {
  version: string;
  /** Store schema this build opens (db.ts SCHEMA_VERSION). */
  schema: number;
  manifestUrl: string;
  fetch(url: string, init: { signal: AbortSignal; headers: Record<string, string> }): Promise<Response>;
  /** `%LOCALAPPDATA%\MuseStudio\updates`. */
  updatesDir: string;
  /** `%APPDATA%\MuseStudio` — versions.json lives next to the store (AC-RBK-01). */
  roamingDir: string;
  /** Null when the app does not run from an installer-made folder (AC-UPD-08). */
  layout: InstallLayout | null;
  autoCheck(): boolean;
  locale(): "en" | "vi";
  diskFree(dir: string): Promise<number | null>;
  inFlight(): number;
  /** `verbatim`: args are one ready Windows command line (cmd.exe quoting), passed without Node's own quoting. */
  spawnDetached(file: string, args: string[], opts?: { verbatim?: boolean }): void;
  /** Normal quit (same as tray → Thoát without asking again). */
  quit(): void;
  emit(status: UpdateStatus): void;
  /** A newer version was found for the first time (AC-UPD-04). */
  announce(version: string): void;
  log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>): void;
  now?(): number;
  /** Windows PowerShell; injectable for tests. */
  powershell?: string;
  /** cmd.exe; injectable for tests. */
  comspec?: string;
  /** Test mode only: accept a fake release served over http from 127.0.0.1 (isolated lab). */
  loopbackHttp?: boolean;
}

interface Pending {
  from: string;
  to: string;
  notes: UpdateNote[];
}

const PROGRESS_EVERY_MS = 300;

export class Updater {
  private checking = false;
  private checkedAt: number | null = null;
  private error: string | null = null;
  private latest: UpdateManifest | null = null;
  private dl: { state: DownloadState; received: number; total: number; error: string | null } = { state: "idle", received: 0, total: 0, error: null };
  private abort: AbortController | null = null;
  private notified: string | null = null;
  private justUpdated: { from: string; notes: UpdateNote[] } | null = null;
  private rollbackCache: RollbackCheck = { ok: false, version: null, reason: "not_installed" };
  private timers: NodeJS.Timeout[] = [];

  constructor(private d: UpdaterDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }
  private stateFile(): string {
    return path.join(this.d.updatesDir, "state.json");
  }
  private pendingFile(): string {
    return path.join(this.d.updatesDir, "pending.json");
  }

  /** Start-up: remember what was announced, read the "just updated" note, clean old installers, refresh rollback. */
  init(storeSchema: number): void {
    fs.mkdirSync(this.d.updatesDir, { recursive: true });
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile(), "utf8")) as { notified?: unknown };
      if (typeof s.notified === "string") this.notified = s.notified;
    } catch {
      /* first run */
    }
    try {
      const p = JSON.parse(fs.readFileSync(this.pendingFile(), "utf8")) as Partial<Pending>;
      if (p.to === this.d.version && typeof p.from === "string") {
        this.justUpdated = { from: p.from, notes: Array.isArray(p.notes) ? p.notes.filter((n) => n && typeof n.en === "string" && typeof n.vi === "string") : [] };
        this.d.log("info", "updated", { from: p.from, to: p.to });
      } else this.d.log("warn", "pending update did not land", { expected: p.to ?? null });
      fs.rmSync(this.pendingFile(), { force: true });
    } catch {
      /* no update just happened */
    }
    try {
      for (const f of staleInstallers(fs.readdirSync(this.d.updatesDir), this.d.version)) fs.rmSync(path.join(this.d.updatesDir, f), { force: true });
    } catch (e) {
      this.d.log("warn", "old installers not cleaned", { error: String(e) });
    }
    this.writeVersions(storeSchema);
    this.refreshRollback();
  }

  /** AC-RBK-01 — which store schema every known version opens, and the store's schema now. */
  private writeVersions(storeSchema: number): void {
    const file = path.join(this.d.roamingDir, "versions.json");
    let prev: unknown = null;
    try {
      prev = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* first run of a build that records it */
    }
    const rec = mergeVersionsRecord(prev, { version: this.d.version, schema: this.d.schema, storeSchema });
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) {
      this.d.log("warn", "versions.json not written", { error: String(e) });
    }
  }

  private readVersions(): VersionsRecord | null {
    try {
      return readVersionsRecord(JSON.parse(fs.readFileSync(path.join(this.d.roamingDir, "versions.json"), "utf8")));
    } catch {
      return null;
    }
  }

  refreshRollback(): RollbackCheck {
    const l = this.d.layout;
    if (!l) return (this.rollbackCache = { ok: false, version: null, reason: "not_installed" });
    let folders: { name: string; mtimeMs: number; hasExe: boolean }[] = [];
    try {
      folders = fs
        .readdirSync(l.root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const p = path.join(l.root, e.name);
          return { name: e.name, mtimeMs: fs.statSync(p).mtimeMs, hasExe: fs.existsSync(path.join(p, "Muse4AI.exe")) };
        });
    } catch {
      /* unreadable → nothing to go back to */
    }
    this.rollbackCache = rollbackCheck(previousVersion(folders, this.d.version), this.readVersions());
    return this.rollbackCache;
  }

  status(): UpdateStatus {
    return {
      current: this.d.version,
      autoCheck: this.d.autoCheck(),
      checking: this.checking,
      checkedAt: this.checkedAt,
      error: this.error,
      latest: this.latest,
      available: !!this.latest && isNewer(this.latest.version, this.d.version),
      installable: !!this.d.layout,
      download: { ...this.dl },
      rollback: this.rollbackCache,
      justUpdated: this.justUpdated,
    };
  }

  private changed(): void {
    this.d.emit(this.status());
  }

  /** AC-UPD-02 — first automatic check a minute after the first frame, then every 12 hours (only while the switch is on). */
  schedule(): void {
    const tick = () => {
      if (this.d.autoCheck()) void this.check().catch(() => undefined);
    };
    this.timers.push(setTimeout(tick, UPDATE_LIMITS.firstDelayMs));
    this.timers.push(setInterval(tick, UPDATE_LIMITS.intervalMs));
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.abort?.abort();
  }

  dismissJustUpdated(): void {
    this.justUpdated = null;
    this.changed();
  }

  /** AC-UPD-02/03 — read the manifest (no user data sent), validate it, announce a new version once. */
  async check(): Promise<UpdateStatus> {
    if (this.checking) return this.status();
    this.checking = true;
    this.changed();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), UPDATE_LIMITS.timeoutMs);
    try {
      const res = await this.d.fetch(this.d.manifestUrl, { signal: ctl.signal, headers: { Accept: "application/json", "User-Agent": `Muse4AI/${this.d.version}` } });
      if (!res.ok) throw new UpdateError(`Website trả mã ${res.status}`, "http");
      const body = await readCapped(res, UPDATE_LIMITS.manifestMaxBytes);
      if (body === null) throw new UpdateError("Thông tin bản mới không hợp lệ", "invalid");
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        throw new UpdateError("Thông tin bản mới không hợp lệ", "invalid");
      }
      const parsed = parseManifest(json, res.url || this.d.manifestUrl, { loopbackHttp: this.d.loopbackHttp });
      if (!parsed.ok) {
        this.d.log("warn", "manifest refused", { reason: parsed.reason });
        throw new UpdateError("Thông tin bản mới không hợp lệ", "invalid");
      }
      const switched = this.latest?.version !== parsed.manifest.version;
      this.latest = parsed.manifest;
      if (switched && this.dl.state !== "downloading") this.dl = { state: "idle", received: 0, total: 0, error: null };
      this.error = null;
      this.checkedAt = this.now();
      const available = isNewer(parsed.manifest.version, this.d.version);
      this.d.log("info", "update check", { latest: parsed.manifest.version, available });
      if (available && this.notified !== parsed.manifest.version) {
        this.notified = parsed.manifest.version;
        this.saveState();
        this.d.announce(parsed.manifest.version);
      }
      if (available && parsed.manifest.url) await this.adoptVerifiedDownload();
    } catch (e) {
      this.error = e instanceof UpdateError ? e.message : ctl.signal.aborted ? "Website không trả lời trong 15 giây" : "Không kết nối được tới website";
      this.d.log("warn", "update check failed", { error: this.error, detail: e instanceof UpdateError ? undefined : String(e) });
    } finally {
      clearTimeout(timer);
      this.checking = false;
      this.changed();
    }
    return this.status();
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFile(), JSON.stringify({ notified: this.notified }));
    } catch (e) {
      this.d.log("warn", "update state not saved", { error: String(e) });
    }
  }

  private target(): { file: string; m: UpdateManifest & { url: string; sha256: string; bytes: number } } {
    const m = this.latest;
    if (!m || !isNewer(m.version, this.d.version)) throw new UpdateError("Đang dùng bản mới nhất", "no_update");
    if (!m.url || !m.sha256 || !m.bytes) throw new UpdateError("Bản này chưa có bộ cài để tải — mở trang tải về", "no_download");
    return { file: path.join(this.d.updatesDir, installerFileName(m.version)), m: m as UpdateManifest & { url: string; sha256: string; bytes: number } };
  }

  /** A file of the right size already on disk is reused once its hash matches (AC-UPD-05). Hashing runs off the main loop. */
  private async adoptVerifiedDownload(): Promise<void> {
    if (this.dl.state !== "idle" && this.dl.state !== "error") return;
    try {
      const { file, m } = this.target();
      if (!fs.existsSync(file) || fs.statSync(file).size !== m.bytes) return;
      const sum = await sha256File(file);
      if (sum === m.sha256 && (this.dl.state === "idle" || this.dl.state === "error")) {
        this.dl = { state: "ready", received: m.bytes, total: m.bytes, error: null };
        this.changed();
      }
    } catch {
      /* nothing reusable */
    }
  }

  /** AC-UPD-05 — stream to a .part file with progress, check size + SHA-256, then rename; any mismatch deletes it. */
  async download(): Promise<UpdateStatus> {
    const { file, m } = this.target();
    if (this.dl.state === "downloading" || this.dl.state === "verifying") return this.status();
    await this.adoptVerifiedDownload();
    if (this.dl.state === "ready") return this.status();
    const need = Math.ceil(m.bytes * UPDATE_LIMITS.diskFactor);
    const free = await this.d.diskFree(this.d.updatesDir);
    if (free !== null && free < need) {
      this.dl = { state: "error", received: 0, total: m.bytes, error: `Ổ đĩa không đủ chỗ: cần khoảng ${Math.ceil(need / 1e6)} MB trống` };
      this.changed();
      return this.status();
    }
    const part = `${file}.part`;
    const ctl = new AbortController();
    this.abort = ctl;
    this.dl = { state: "downloading", received: 0, total: m.bytes, error: null };
    this.changed();
    const hash = createHash("sha256");
    let fd: number | null = null;
    let last = 0;
    try {
      fs.mkdirSync(this.d.updatesDir, { recursive: true });
      fd = fs.openSync(part, "w");
      const res = await this.d.fetch(m.url, { signal: ctl.signal, headers: { "User-Agent": `Muse4AI/${this.d.version}` } });
      if (!res.ok || !res.body) throw new UpdateError(`Máy chủ trả mã ${res.status}`, "http");
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        if (this.dl.received + value.length > m.bytes) throw new UpdateError("Tệp tải về lớn hơn dự kiến — đã huỷ", "size");
        fs.writeSync(fd, value);
        hash.update(value);
        this.dl.received += value.length;
        if (this.now() - last >= PROGRESS_EVERY_MS) {
          last = this.now();
          this.changed();
        }
      }
      fs.closeSync(fd);
      fd = null;
      this.dl.state = "verifying";
      this.changed();
      const sum = hash.digest("hex").toUpperCase();
      if (this.dl.received !== m.bytes || sum !== m.sha256) throw new UpdateError("Tệp tải về không khớp mã kiểm tra — đã xoá, hãy tải lại", "checksum");
      fs.rmSync(file, { force: true });
      fs.renameSync(part, file);
      this.dl = { state: "ready", received: m.bytes, total: m.bytes, error: null };
      this.d.log("info", "update downloaded", { version: m.version, bytes: m.bytes });
    } catch (e) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
      fs.rmSync(part, { force: true });
      if (ctl.signal.aborted && !(e instanceof UpdateError)) {
        this.dl = { state: "idle", received: 0, total: 0, error: null };
        this.d.log("info", "update download cancelled", { version: m.version });
      } else {
        const msg = e instanceof UpdateError ? e.message : "Tải bị gián đoạn — kiểm tra mạng rồi thử lại";
        this.dl = { state: "error", received: 0, total: m.bytes, error: msg };
        this.d.log("warn", "update download failed", { version: m.version, error: msg, detail: e instanceof UpdateError ? undefined : String(e) });
      }
    } finally {
      if (this.abort === ctl) this.abort = null;
      this.changed();
    }
    return this.status();
  }

  cancelDownload(): UpdateStatus {
    this.abort?.abort();
    return this.status();
  }

  /**
   * AC-UPD-06 — re-check the file, ask first when jobs run, then start the installer silently (it installs into this
   * app's folder and reopens the new version) and quit the normal way.
   */
  async install(force: boolean): Promise<{ needsConfirm: boolean; running: number }> {
    const l = this.d.layout;
    if (!l) throw new UpdateError("App không chạy từ thư mục cài — hãy cài bằng bộ cài tải từ website", "not_installed");
    const { file, m } = this.target();
    if (this.dl.state !== "ready") throw new UpdateError("Bộ cài chưa tải xong", "not_ready");
    const running = this.d.inFlight();
    if (running > 0 && !force) return { needsConfirm: true, running };
    if (!fs.existsSync(file) || fs.statSync(file).size !== m.bytes || (await sha256File(file)) !== m.sha256) {
      fs.rmSync(file, { force: true });
      this.dl = { state: "error", received: 0, total: m.bytes, error: "Tệp bộ cài đã bị thay đổi — đã xoá, hãy tải lại" };
      this.changed();
      throw new UpdateError("Tệp bộ cài đã bị thay đổi — đã xoá, hãy tải lại", "checksum");
    }
    const pending: Pending = { from: this.d.version, to: m.version, notes: m.notes };
    fs.writeFileSync(this.pendingFile(), JSON.stringify(pending));
    this.d.log("info", "update install", { from: this.d.version, to: m.version, running });
    this.d.spawnDetached(file, installerArgs(this.d.locale(), l.root));
    setTimeout(() => this.d.quit(), 600);
    return { needsConfirm: false, running };
  }

  /** AC-RBK-03 — hand over to the kept install.ps1: it waits for this app to quit, switches version and opens it. */
  rollback(force: boolean): { needsConfirm: boolean; running: number; version: string } {
    const l = this.d.layout;
    const r = this.refreshRollback();
    if (!l || !r.ok) throw new UpdateError("Không quay lại được bản trước", "rollback_unavailable");
    const running = this.d.inFlight();
    if (running > 0 && !force) return { needsConfirm: true, running, version: r.version };
    const ps = this.d.powershell ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", l.installScript, "-Rollback", "-Target", r.version, "-CloseRunning", "-Gui", "-InstallRoot", l.root, "-Lang", this.d.locale()];
    // PowerShell needs a console of its own: started through cmd's `start`, never directly detached (lab 06/11).
    const line = consoleLaunchArgs(ps, args);
    if (!line) throw new UpdateError("Không quay lại được bản trước từ thư mục cài này", "rollback_unavailable");
    const cmd = this.d.comspec ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    this.d.log("info", "rollback", { from: this.d.version, to: r.version, running });
    this.d.spawnDetached(cmd, line, { verbatim: true });
    setTimeout(() => this.d.quit(), 600);
    return { needsConfirm: false, running, version: r.version };
  }
}

/** Reads at most `max` bytes; null when the body is bigger (AC-UPD-02). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(len) && len > max) return null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max + 1);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** SHA-256 of a file, streamed (a 170 MB installer must not freeze the main process). */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(file, { highWaterMark: 1 << 20 })
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex").toUpperCase()));
  });
}

/**
 * AC-UPD-08 — this app runs from an installer-made folder: `<root>\app-<version>\Muse4AI.exe` with the installer's
 * kept scripts in `<root>\tools`. A folder extracted by hand or a dev build returns null.
 */
export function detectInstall(execPath: string, version: string, exists: (p: string) => boolean = fs.existsSync): InstallLayout | null {
  const dir = path.dirname(execPath);
  if (path.basename(dir).toLowerCase() !== `app-${version}`.toLowerCase()) return null;
  const root = path.dirname(dir);
  const installScript = path.join(root, "tools", "install.ps1");
  if (!exists(installScript) || !exists(path.join(root, "tools", "uninstall.ps1"))) return null;
  return { root, installScript };
}
