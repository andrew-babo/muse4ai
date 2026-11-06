// Build 3.3 — update check and rollback rules (pure: no Electron, no file system), shared by main, renderer and tests.
// Spec: docs/build-3.3/spec.md (AC-UPD-01…08, AC-RBK-01…03).

/** Where the website publishes the newest release (built from content/site.ts LATEST_RELEASE). */
export const UPDATE_MANIFEST_PATH = "/releases/latest.json";

export const UPDATE_LIMITS = {
  /** AC-UPD-02 — the manifest is a few hundred bytes; anything bigger is not ours. */
  manifestMaxBytes: 64 * 1024,
  timeoutMs: 15_000,
  /** AC-UPD-03 — a real installer is ~170 MB; outside this range the manifest is wrong. */
  minBytes: 1_000_000,
  maxBytes: 1_000_000_000,
  /** AC-UPD-02 — first automatic check after the first frame, then every 12 hours. */
  firstDelayMs: 60_000,
  intervalMs: 12 * 3600_000,
  /** AC-UPD-05 — free space needed before a download starts, as a multiple of its size. */
  diskFactor: 1.2,
  notesMax: 20,
  noteMaxChars: 2000,
} as const;

export interface UpdateNote {
  en: string;
  vi: string;
}

export interface UpdateManifest {
  version: string;
  date: string;
  /** Absolute https URL on the same origin as the manifest, or null when this release is not offered for download. */
  url: string | null;
  sha256: string | null;
  bytes: number | null;
  notes: UpdateNote[];
  /** The website's download page (same origin). */
  page: string;
}

// ---------------------------------------------------------------------------------------------- versions

interface ParsedVersion {
  core: [number, number, number];
  pre: (number | string)[];
}

const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(v: unknown): ParsedVersion | null {
  if (typeof v !== "string" || v.length > 64) return null;
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  const pre = m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

export function isVersion(v: unknown): v is string {
  return parseVersion(v) !== null;
}

/**
 * Semantic-version order (AC-UPD-03): a release is newer than its pre-releases, numeric pre-release parts compare as
 * numbers (`beta.34` > `beta.4`), numbers sort before words, and a longer list wins when all shared parts are equal.
 * Returns null when either side is not a version, so a bad value can never look "newer".
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  const n = Math.min(x.pre.length, y.pre.length);
  for (let i = 0; i < n; i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length === y.pre.length ? 0 : x.pre.length < y.pre.length ? -1 : 1;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

// ---------------------------------------------------------------------------------------------- manifest

export type ManifestCheck = { ok: true; manifest: UpdateManifest } | { ok: false; reason: string };

function httpsOrigin(u: string, loopbackHttp = false): string | null {
  try {
    const url = new URL(u);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url.origin;
    // Test mode only (MUSE4AI_TEST=1): the isolated Windows lab serves a fake release from 127.0.0.1 over plain http.
    return loopbackHttp && url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Validates the website's manifest (AC-UPD-03). `from` is the URL the manifest was finally read from (after redirects):
 * the installer and the page must live on that same https origin, so a manifest can never point the app elsewhere.
 */
export function parseManifest(raw: unknown, from: string, opts: { loopbackHttp?: boolean } = {}): ManifestCheck {
  const lb = !!opts.loopbackHttp;
  const origin = httpsOrigin(from, lb);
  if (!origin) return { ok: false, reason: "not_https" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "shape" };
  const r = raw as Record<string, unknown>;
  if (!isVersion(r.version)) return { ok: false, reason: "version" };
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { ok: false, reason: "date" };
  if (typeof r.page !== "string" || httpsOrigin(r.page, lb) !== origin) return { ok: false, reason: "page" };
  if (!Array.isArray(r.notes) || r.notes.length > UPDATE_LIMITS.notesMax) return { ok: false, reason: "notes" };
  const notes: UpdateNote[] = [];
  for (const n of r.notes) {
    const o = n as Record<string, unknown> | null;
    if (!o || typeof o.en !== "string" || typeof o.vi !== "string" || o.en.length > UPDATE_LIMITS.noteMaxChars || o.vi.length > UPDATE_LIMITS.noteMaxChars) return { ok: false, reason: "notes" };
    notes.push({ en: o.en, vi: o.vi });
  }
  if (r.url === null) {
    return { ok: true, manifest: { version: r.version, date: r.date, url: null, sha256: null, bytes: null, notes, page: r.page } };
  }
  if (typeof r.url !== "string" || httpsOrigin(r.url, lb) !== origin) return { ok: false, reason: "url" };
  if (typeof r.sha256 !== "string" || !/^[0-9A-Fa-f]{64}$/.test(r.sha256)) return { ok: false, reason: "sha256" };
  if (typeof r.bytes !== "number" || !Number.isInteger(r.bytes) || r.bytes < UPDATE_LIMITS.minBytes || r.bytes > UPDATE_LIMITS.maxBytes) return { ok: false, reason: "bytes" };
  return { ok: true, manifest: { version: r.version, date: r.date, url: r.url, sha256: r.sha256.toUpperCase(), bytes: r.bytes, notes, page: r.page } };
}

/** File name of a downloaded installer: only a validated version goes into it, never anything from the URL. */
export function installerFileName(version: string): string {
  if (!isVersion(version)) throw new Error("invalid version");
  return `Muse4AI-${version}-Setup-win-x64.exe`;
}

/** Leftover installers to delete at start (AC-UPD-07): every downloaded one whose version is not newer than this app. */
export function staleInstallers(files: string[], current: string): string[] {
  return files.filter((f) => {
    const m = /^Muse4AI-(.+)-Setup-win-x64\.exe(?:\.part)?$/.exec(f);
    if (!m) return false;
    if (f.endsWith(".part")) return true;
    const c = compareVersions(m[1], current);
    return c !== null && c <= 0;
  });
}

/**
 * Arguments for the in-app "Cài và mở lại" (AC-UPD-06): Inno Setup runs silently (progress window only) in the app's
 * language, installs into the folder this app runs from and reopens the new version afterwards.
 */
export function installerArgs(lang: "en" | "vi", installRoot: string): string[] {
  const root = installRoot.replace(/[\\/]+$/, "");
  if (!root || /["\r\n]/.test(root)) throw new Error("invalid install folder");
  return ["/SILENT", "/NORESTART", "/SP-", `/LANG=${lang}`, `/INSTALLROOT=${root}`, "/RELAUNCH=1"];
}

/**
 * AC-RBK-03 — cmd.exe arguments (pass verbatim) that start a console program in its own new console through
 * `start /min`, so it outlives the app. A detached powershell.exe has no console and exits before its first line,
 * and a non-detached child is killed with the app (Windows lab 06/11). Every part is quoted unless plainly safe;
 * `"` and `%` (cmd expands it even inside quotes) are refused — null — because they cannot be passed safely.
 */
export function consoleLaunchArgs(exe: string, args: string[]): string[] | null {
  const all = [exe, ...args];
  if (all.some((a) => !a || /["%\r\n\0]/.test(a))) return null;
  const q = (a: string) => (/^[A-Za-z0-9._:\\/=-]+$/.test(a) ? a : `"${a}"`);
  return ["/d", "/v:off", "/s", "/c", `"start "" /min ${all.map(q).join(" ")}"`];
}

// ---------------------------------------------------------------------------------------------- rollback

/**
 * Store schema each released version can open, for versions released before they recorded it themselves
 * (v6 arrived with beta.30, v7 with beta.32). Versions not listed are "unknown" and never offered for rollback.
 */
export const KNOWN_SCHEMAS: Readonly<Record<string, number>> = {
  "2.0.0-beta.30": 6,
  "2.0.0-beta.31": 6,
  "2.0.0-beta.32": 7,
  "2.0.0-beta.33": 7,
};

/** `%APPDATA%\MuseStudio\versions.json` (AC-RBK-01): written only by the main process after the store opens. */
export interface VersionsRecord {
  /** Schema of the store as it is now (after any migration). */
  storeSchema: number;
  /** Store schema each app version can open. */
  versions: Record<string, number>;
}

const schemaOk = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 1000;

export function readVersionsRecord(raw: unknown): VersionsRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!schemaOk(r.storeSchema) || !r.versions || typeof r.versions !== "object") return null;
  const versions: Record<string, number> = {};
  for (const [v, s] of Object.entries(r.versions as Record<string, unknown>)) if (isVersion(v) && schemaOk(s)) versions[v] = s;
  return { storeSchema: r.storeSchema, versions };
}

/** The record after this version opened the store: known history + what was there + this version (newest 40 kept). */
export function mergeVersionsRecord(prev: unknown, cur: { version: string; schema: number; storeSchema: number }): VersionsRecord {
  const old = readVersionsRecord(prev);
  const all: Record<string, number> = { ...KNOWN_SCHEMAS, ...(old?.versions ?? {}) };
  if (isVersion(cur.version) && schemaOk(cur.schema)) all[cur.version] = cur.schema;
  const keep = Object.keys(all)
    .sort((a, b) => compareVersions(b, a) ?? 0)
    .slice(0, 40);
  return { storeSchema: cur.storeSchema, versions: Object.fromEntries(keep.map((v) => [v, all[v]])) };
}

export type RollbackReason = "not_installed" | "none" | "unknown" | "newer_data";
export type RollbackCheck = { ok: true; version: string } | { ok: false; version: string | null; reason: RollbackReason };

/** AC-RBK-02 — the kept previous version is offered only when it can open the store as it is now. */
export function rollbackCheck(previous: string | null, record: VersionsRecord | null): RollbackCheck {
  if (!previous || !isVersion(previous)) return { ok: false, version: null, reason: "none" };
  const schema = record?.versions[previous] ?? KNOWN_SCHEMAS[previous];
  if (!record || schema === undefined) return { ok: false, version: previous, reason: "unknown" };
  if (schema < record.storeSchema) return { ok: false, version: previous, reason: "newer_data" };
  return { ok: true, version: previous };
}

/**
 * The previous version kept next to the running one: `app-<version>` folders with the app inside, newest first by
 * modification time (the same rule as install.ps1 -Rollback), excluding the running version and interrupted leftovers.
 */
export function previousVersion(folders: { name: string; mtimeMs: number; hasExe: boolean }[], current: string): string | null {
  const c = folders
    .filter((f) => f.hasExe && /^app-/.test(f.name) && !f.name.includes(".bak-") && f.name !== `app-${current}`)
    .map((f) => ({ v: f.name.slice(4), t: f.mtimeMs }))
    .filter((f) => isVersion(f.v))
    .sort((a, b) => b.t - a.t);
  return c[0]?.v ?? null;
}

// ---------------------------------------------------------------------------------------------- status shown in the UI

export type DownloadState = "idle" | "downloading" | "verifying" | "ready" | "error";

export interface UpdateStatus {
  current: string;
  autoCheck: boolean;
  checking: boolean;
  checkedAt: number | null;
  /** Vietnamese source text of the last check error (translated when shown), null when the last check worked. */
  error: string | null;
  latest: UpdateManifest | null;
  /** A newer version than this app exists. */
  available: boolean;
  /** This app runs from an installer-made folder, so "Cài và mở lại" works (AC-UPD-08). */
  installable: boolean;
  download: { state: DownloadState; received: number; total: number; error: string | null };
  rollback: RollbackCheck;
  /** Set once after an in-app update: the version we came from and the notes of this version (AC-UPD-07). */
  justUpdated: { from: string; notes: UpdateNote[] } | null;
}

/**
 * After going back, the newest version may already sit on disk as the kept version: then "Chuyển sang bản này"
 * opens it at once and downloading the same installer again is pointless (AC-RBK-03).
 */
export function latestIsKept(u: Pick<UpdateStatus, "current" | "latest" | "available" | "rollback">): boolean {
  return !!(u.available && u.latest && u.rollback.ok && u.rollback.version === u.latest.version && isNewer(u.latest.version, u.current));
}

