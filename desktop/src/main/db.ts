import fs from "node:fs";
import path from "node:path";

// Local SQLite store (node:sqlite, WAL). The main process is its only writer (AGENTS.md).

export type SqliteModule = typeof import("node:sqlite");
export type Database = import("node:sqlite").DatabaseSync;

export const SCHEMA_VERSION = 7;

/** WAL + synchronous=NORMAL: a committed write survives the app process being killed (AC-JOB-04). */
export const CONNECTION_PRAGMAS = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=5000;";

const MIGRATIONS: Record<number, string> = {
  1: `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY, alias TEXT NOT NULL, alias_key TEXT NOT NULL UNIQUE, avatar INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL, state_until INTEGER, state_note TEXT, proxy_id TEXT UNIQUE, capabilities TEXT NOT NULL DEFAULT '{}',
  today_count INTEGER NOT NULL DEFAULT 0, today_date TEXT NOT NULL DEFAULT '', quota TEXT, last_active_at INTEGER,
  fail_times TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS proxies(
  id TEXT PRIMARY KEY, label TEXT NOT NULL, scheme TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
  secret_ref TEXT, has_auth INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'untested', exit_ip_masked TEXT,
  country TEXT, latency_ms INTEGER, last_tested_at INTEGER, last_error TEXT, account_id TEXT UNIQUE,
  created_at INTEGER NOT NULL, rev INTEGER NOT NULL, UNIQUE(host, port));
CREATE TABLE IF NOT EXISTS batches(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL,
  settings TEXT NOT NULL, rows TEXT NOT NULL DEFAULT '[]', rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, batch_id TEXT, kind TEXT NOT NULL, mode TEXT NOT NULL,
  prompt TEXT NOT NULL, reference_ids TEXT NOT NULL DEFAULT '[]', account_pref TEXT NOT NULL DEFAULT 'auto', account_id TEXT,
  state TEXT NOT NULL, state_until INTEGER, priority INTEGER NOT NULL DEFAULT 0, attempt_no INTEGER NOT NULL DEFAULT 0,
  pre_submit_failures INTEGER NOT NULL DEFAULT 0, download_attempts INTEGER NOT NULL DEFAULT 0, error_class TEXT, error_message TEXT,
  remote_ref TEXT, submit_intent_at INTEGER, accepted_at INTEGER, client_request_id TEXT, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, seen INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS jobs_batch ON jobs(batch_id);
CREATE INDEX IF NOT EXISTS jobs_client ON jobs(client_request_id);
CREATE INDEX IF NOT EXISTS jobs_account_intent ON jobs(account_id, submit_intent_at);
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, account_id TEXT, proxy_id TEXT, phase TEXT NOT NULL, started_at INTEGER NOT NULL,
  ended_at INTEGER, outcome TEXT, error_class TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS attempts_job ON attempts(job_id);
CREATE TABLE IF NOT EXISTS refs(
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, path TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER NOT NULL,
  height INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, batch_id TEXT, path TEXT NOT NULL, sha256 TEXT NOT NULL, kind TEXT NOT NULL,
  mime TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER, bytes INTEGER NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0, trashed_at INTEGER, missing INTEGER NOT NULL DEFAULT 0, account_alias TEXT,
  prompt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assets_created ON assets(created_at);
CREATE INDEX IF NOT EXISTS assets_job ON assets(job_id);
CREATE INDEX IF NOT EXISTS assets_batch ON assets(batch_id);
`,
  // rev 4 (spec §4.8): jobs remember which API key created them; keys store only SHA-256; request log without secrets.
  2: `
ALTER TABLE jobs ADD COLUMN api_key_id TEXT;
ALTER TABLE jobs ADD COLUMN api_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS jobs_api_key ON jobs(api_key_id, seq);
CREATE TABLE IF NOT EXISTS api_keys(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, scope TEXT NOT NULL, token_sha256 TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS api_requests(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, key_id TEXT, method TEXT NOT NULL, route TEXT NOT NULL,
  status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, code TEXT, ip_masked TEXT, via TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS api_requests_ts ON api_requests(ts);
CREATE TABLE IF NOT EXISTS api_replies(
  client_request_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
`,
  // rev 6 (spec §4.3, R39–R53, rules B34): additive only. Vibes side per account, remote sources (main process only),
  // extend chains, and lineage columns. The Muse side stays in accounts (its AccountSite row is that projection).
  3: `
CREATE TABLE IF NOT EXISTS account_sites(
  account_id TEXT NOT NULL, site TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'logged_out',
  status_until INTEGER, note TEXT, identity_fp TEXT, identity_masked TEXT, pending_fp TEXT, pending_masked TEXT,
  checked_at INTEGER, fail_times TEXT NOT NULL DEFAULT '[]', project_id TEXT, last_submit_at INTEGER,
  PRIMARY KEY(account_id, site));
INSERT OR IGNORE INTO account_sites(account_id, site, enabled, status) SELECT id, 'vibes', 1, 'logged_out' FROM accounts;
CREATE TABLE IF NOT EXISTS remote_sources(
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, owner_account_id TEXT NOT NULL, owner_identity_fp TEXT NOT NULL,
  project_id TEXT, batch_id TEXT, content_id TEXT NOT NULL, entity_id TEXT, handle TEXT, video_url TEXT, original_prompt TEXT,
  config TEXT, status TEXT NOT NULL DEFAULT 'ok', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS remote_sources_owner ON remote_sources(owner_account_id);
CREATE TABLE IF NOT EXISTS extend_chains(
  id TEXT PRIMARY KEY, account_id TEXT, root_asset_id TEXT NOT NULL, mode TEXT NOT NULL, directive TEXT, plan TEXT NOT NULL,
  max_steps INTEGER NOT NULL, steps_done INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, reason TEXT, last_asset_id TEXT,
  last_duration_ms INTEGER, priority INTEGER NOT NULL DEFAULT 0, api_key_id TEXT, client_request_id TEXT UNIQUE, api_fingerprint TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS extend_chains_api ON extend_chains(api_key_id);
ALTER TABLE jobs ADD COLUMN site TEXT NOT NULL DEFAULT 'muse';
ALTER TABLE jobs ADD COLUMN operation TEXT NOT NULL DEFAULT 'generate';
ALTER TABLE jobs ADD COLUMN bound_account_id TEXT;
ALTER TABLE jobs ADD COLUMN source_asset_id TEXT;
ALTER TABLE jobs ADD COLUMN chain_id TEXT;
ALTER TABLE jobs ADD COLUMN step_index INTEGER;
ALTER TABLE jobs ADD COLUMN extend_mode TEXT;
ALTER TABLE jobs ADD COLUMN directive TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_chain_step ON jobs(chain_id, step_index) WHERE chain_id IS NOT NULL;
ALTER TABLE assets ADD COLUMN site TEXT NOT NULL DEFAULT 'muse';
ALTER TABLE assets ADD COLUMN parent_asset_id TEXT;
ALTER TABLE assets ADD COLUMN chain_id TEXT;
ALTER TABLE assets ADD COLUMN step_index INTEGER;
ALTER TABLE assets ADD COLUMN remote_source_id TEXT;
CREATE INDEX IF NOT EXISTS assets_chain ON assets(chain_id, created_at);
`,
  4: `
ALTER TABLE remote_sources ADD COLUMN muse_source TEXT;
ALTER TABLE jobs ADD COLUMN muse_checkpoint TEXT;
ALTER TABLE extend_chains ADD COLUMN site TEXT NOT NULL DEFAULT 'vibes';
CREATE TABLE muse_identities(account_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
CREATE TABLE muse_conversations(
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL, conversation TEXT NOT NULL, tip_asset_id TEXT,
  reserved_chain_id TEXT, unresolved_job_id TEXT,
  PRIMARY KEY(account_id, conversation));
`,
  // Build 2.0 (spec §4.3, R112): additive only. Execution per account, chat jobs (generic bridge), file outputs.
  // Settings: the old app total (1–8 pages) becomes the UI-page cap; the new app total is 40. A fresh store (no
  // accounts, nothing saved) keeps the code defaults (8 pages, 40).
  5: `
ALTER TABLE accounts ADD COLUMN exec_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE accounts ADD COLUMN max_concurrent INTEGER NOT NULL DEFAULT 10;
ALTER TABLE accounts ADD COLUMN ui_max_concurrent INTEGER NOT NULL DEFAULT 2;
ALTER TABLE jobs ADD COLUMN exec_path TEXT;
ALTER TABLE jobs ADD COLUMN remote_session_id TEXT;
ALTER TABLE jobs ADD COLUMN baseline_user_msgs INTEGER;
ALTER TABLE jobs ADD COLUMN result_text TEXT;
ALTER TABLE jobs ADD COLUMN result_text_truncated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN outputs_truncated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN conversation_id TEXT;
CREATE INDEX IF NOT EXISTS jobs_session ON jobs(remote_session_id) WHERE remote_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_conversation ON jobs(conversation_id, seq) WHERE conversation_id IS NOT NULL;
ALTER TABLE attempts ADD COLUMN path TEXT;
ALTER TABLE attempts ADD COLUMN read_path TEXT;
ALTER TABLE refs ADD COLUMN kind TEXT NOT NULL DEFAULT 'image';
UPDATE refs SET kind='video' WHERE mime LIKE 'video/%';
ALTER TABLE refs ADD COLUMN filename TEXT;
ALTER TABLE assets ADD COLUMN filename TEXT;
ALTER TABLE assets ADD COLUMN zone_marked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE muse_conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'media';
ALTER TABLE muse_conversations ADD COLUMN owner_api_key_id TEXT;
ALTER TABLE muse_conversations ADD COLUMN busy_job_id TEXT;
INSERT OR IGNORE INTO settings(key, value)
  SELECT 'concurrencyUiPages', CAST(MIN(8, MAX(1, COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key='globalConcurrency'), 4))) AS TEXT)
  WHERE EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM settings WHERE key='globalConcurrency');
UPDATE settings SET value='40' WHERE key='globalConcurrency';
`,
  // Build 3.1 (spec rev 8 R131–R141): the app's own OAuth 2.1 server. Additive only — clients register themselves,
  // codes and refresh tokens are kept as SHA-256 digests, and approvals wait in oauth_consents for the pairing code.
  6: `
CREATE TABLE IF NOT EXISTS oauth_clients(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL DEFAULT '[]', scope TEXT NOT NULL DEFAULT '[]',
  grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS oauth_codes(
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '[]',
  code_sha256 TEXT NOT NULL UNIQUE, challenge TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT 'S256',
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE INDEX IF NOT EXISTS oauth_codes_client ON oauth_codes(client_id);
CREATE TABLE IF NOT EXISTS oauth_tokens(
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, family TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '[]',
  refresh_sha256 TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_used_at INTEGER, revoked_at INTEGER, replaced_at INTEGER);
CREATE INDEX IF NOT EXISTS oauth_tokens_client ON oauth_tokens(client_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens(family);
CREATE TABLE IF NOT EXISTS oauth_consents(
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_name TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '[]', challenge TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT 'S256',
  state TEXT, pairing TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, decision TEXT);
`,
  // Build 3.2 (R142): a proxy may serve several accounts. `accounts.proxy_id` becomes the only record of who uses a
  // proxy: the table is rebuilt without its UNIQUE constraint and `proxies` without its duplicate `account_id`. An
  // account that lost its pointer but is still named by its old proxy row gets it back; dangling pointers are cleared.
  7: `
UPDATE accounts SET proxy_id = (SELECT p.id FROM proxies p WHERE p.account_id = accounts.id)
  WHERE proxy_id IS NULL AND EXISTS (SELECT 1 FROM proxies p WHERE p.account_id = accounts.id);
UPDATE accounts SET proxy_id = NULL WHERE proxy_id IS NOT NULL AND proxy_id NOT IN (SELECT id FROM proxies);
CREATE TABLE accounts_v7(
  id TEXT PRIMARY KEY, alias TEXT NOT NULL, alias_key TEXT NOT NULL UNIQUE, avatar INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL, state_until INTEGER, state_note TEXT, proxy_id TEXT, capabilities TEXT NOT NULL DEFAULT '{}',
  today_count INTEGER NOT NULL DEFAULT 0, today_date TEXT NOT NULL DEFAULT '', quota TEXT, last_active_at INTEGER,
  fail_times TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, rev INTEGER NOT NULL,
  exec_mode TEXT NOT NULL DEFAULT 'auto', max_concurrent INTEGER NOT NULL DEFAULT 10, ui_max_concurrent INTEGER NOT NULL DEFAULT 2);
INSERT INTO accounts_v7(id, alias, alias_key, avatar, state, state_until, state_note, proxy_id, capabilities, today_count,
  today_date, quota, last_active_at, fail_times, created_at, rev, exec_mode, max_concurrent, ui_max_concurrent)
  SELECT id, alias, alias_key, avatar, state, state_until, state_note, proxy_id, capabilities, today_count,
  today_date, quota, last_active_at, fail_times, created_at, rev, exec_mode, max_concurrent, ui_max_concurrent FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_v7 RENAME TO accounts;
CREATE INDEX IF NOT EXISTS accounts_proxy ON accounts(proxy_id);
CREATE TABLE proxies_v7(
  id TEXT PRIMARY KEY, label TEXT NOT NULL, scheme TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
  secret_ref TEXT, has_auth INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'untested', exit_ip_masked TEXT,
  country TEXT, latency_ms INTEGER, last_tested_at INTEGER, last_error TEXT,
  created_at INTEGER NOT NULL, rev INTEGER NOT NULL, UNIQUE(host, port));
INSERT INTO proxies_v7(id, label, scheme, host, port, secret_ref, has_auth, health, exit_ip_masked, country, latency_ms,
  last_tested_at, last_error, created_at, rev)
  SELECT id, label, scheme, host, port, secret_ref, has_auth, health, exit_ip_masked, country, latency_ms,
  last_tested_at, last_error, created_at, rev FROM proxies;
DROP TABLE proxies;
ALTER TABLE proxies_v7 RENAME TO proxies;
`,
};

export interface OpenResult {
  db: Database;
  migratedFrom: number | null;
  backupPath: string | null;
}

export class MigrationError extends Error {
  constructor(message: string, public restoredFrom: string | null) {
    super(message);
  }
}

/** The store file is unreadable/corrupt (screens S00 error state: offer the newest good backup). */
export class CorruptStoreError extends MigrationError {
  constructor(message: string) {
    super(message, null);
  }
}

const CORRUPT_RE = /not a database|malformed|corrupt|file is encrypted/i;

export function readSchemaVersion(db: Database): number {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}

/**
 * Opens (and migrates) the store. Before any schema upgrade of an existing file a copy is written to `backupDir`;
 * a failed migration restores that copy and throws MigrationError (AC-REL-04).
 */
export function openDatabase(
  sqlite: SqliteModule,
  file: string,
  backupDir: string,
  opts: { targetVersion?: number; migrations?: Record<number, string>; now?: () => number } = {},
): OpenResult {
  const target = opts.targetVersion ?? SCHEMA_VERSION;
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? Date.now;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const existed = fs.existsSync(file);
  let db: Database;
  try {
    db = new sqlite.DatabaseSync(file);
  } catch (e) {
    if (CORRUPT_RE.test(String((e as Error).message))) throw new CorruptStoreError(`Dữ liệu cục bộ bị hỏng (${(e as Error).message})`);
    throw e;
  }
  try {
    db.exec(CONNECTION_PRAGMAS);
    const integrity = db.prepare("PRAGMA quick_check").get() as Record<string, string> | undefined;
    if (integrity && Object.values(integrity)[0] !== "ok") throw new CorruptStoreError("Dữ liệu cục bộ bị hỏng (quick_check)");
  } catch (e) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    if (e instanceof CorruptStoreError) throw e;
    if (CORRUPT_RE.test(String((e as Error).message))) throw new CorruptStoreError(`Dữ liệu cục bộ bị hỏng (${(e as Error).message})`);
    throw e;
  }
  const current = readSchemaVersion(db);
  if (current > target) {
    db.close();
    throw new MigrationError(`Dữ liệu thuộc phiên bản mới hơn (v${current}) so với app (v${target})`, null);
  }
  if (current === target) return { db, migratedFrom: null, backupPath: null };
  let backupPath: string | null = null;
  if (existed && current > 0) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    backupPath = path.join(backupDir, `before-v${target}-from-v${current}-${now()}.sqlite`);
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  }
  try {
    for (let v = current + 1; v <= target; v++) {
      const sql = migrations[v];
      if (!sql) throw new Error(`Thiếu bước nâng dữ liệu v${v}`);
      db.exec("BEGIN IMMEDIATE");
      db.exec(sql);
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v));
      db.exec("COMMIT");
    }
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    db.close();
    if (backupPath) {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
      fs.copyFileSync(backupPath, file);
      db = new sqlite.DatabaseSync(file);
      db.close();
    }
    throw new MigrationError(`Nâng dữ liệu lỗi: ${(e as Error).message}`, backupPath);
  }
  return { db, migratedFrom: existed ? current : null, backupPath };
}

/** Daily snapshot on first launch of the day, keep 7 (plan §6). */
export function dailyBackup(db: Database, backupDir: string, now = Date.now()): string | null {
  const d = new Date(now);
  const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const target = path.join(backupDir, `daily-${key}.sqlite`);
  if (fs.existsSync(target)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const daily = fs
    .readdirSync(backupDir)
    .filter((f) => /^daily-\d{8}\.sqlite$/.test(f))
    .sort();
  for (const f of daily.slice(0, Math.max(0, daily.length - 7))) fs.rmSync(path.join(backupDir, f), { force: true });
  return target;
}

/** Newest backup in `backupDir` that opens and passes quick_check (daily or pre-upgrade copies), or null. */
export function latestGoodBackup(sqlite: SqliteModule, backupDir: string): { path: string; mtimeMs: number } | null {
  if (!fs.existsSync(backupDir)) return null;
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => ({ path: path.join(backupDir, f), mtimeMs: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files) {
    try {
      const db = new sqlite.DatabaseSync(f.path, { readOnly: true });
      try {
        const r = db.prepare("PRAGMA quick_check").get() as Record<string, string> | undefined;
        if (r && Object.values(r)[0] === "ok" && readSchemaVersion(db) > 0) return f;
      } finally {
        db.close();
      }
    } catch {
      /* unreadable backup → try the next one */
    }
  }
  return null;
}

/** Keeps the corrupt store (and its WAL files) beside it for diagnosis, then puts the backup in its place. */
export function restoreFromBackup(file: string, backupPath: string, now = Date.now()): string {
  const kept = `${file}.corrupt-${now}`;
  if (fs.existsSync(file)) fs.renameSync(file, kept);
  for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, kept + suffix);
  fs.copyFileSync(backupPath, file);
  return kept;
}
