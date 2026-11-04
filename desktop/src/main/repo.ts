import type { MuseCheckpoint } from "../shared/museExtend";
import { randomUUID } from "node:crypto";
import { DEFAULT_GLOBAL_CONCURRENCY, DEFAULT_PER_ACCOUNT_CONCURRENCY, DEFAULT_UI_PAGES, PRE_SUBMIT_RETRY_DELAYS_MS } from "../shared/constants";
import { EXEC_DEFAULTS, type ExecMode, type ExecPath } from "../shared/execution";
import { API_DEFAULT_PORT } from "../shared/api/constants";
import { DEFAULT_LOCALE } from "../shared/i18n";
import { IN_FLIGHT, TERMINAL } from "../shared/jobMachine";
import type {
  Account,
  Asset,
  AssetFilter,
  Attempt,
  Batch,
  BatchCounts,
  ChainPlan,
  ChainStatus,
  ExtendChain,
  ExtendMode,
  Job,
  JobFilter,
  JobOperation,
  JobState,
  Page,
  Proxy,
  ReferenceFile,
  RemoteSourceStatus,
  Settings,
  Site,
  VibesSite,
  VibesStatus,
} from "../shared/types";
import { EXTEND_MAX_STEPS_DEFAULT } from "../shared/vibes";
import type { Database } from "./db";

type Row = Record<string, unknown>;

const J = (v: unknown, d: unknown) => {
  if (typeof v !== "string" || v === "") return d;
  try {
    return JSON.parse(v);
  } catch {
    return d;
  }
};
const N = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function defaultSettings(libraryDir: string): Settings {
  return {
    onboardingStep: 0,
    riskAccepted: false,
    libraryDir,
    perAccountConcurrency: DEFAULT_PER_ACCOUNT_CONCURRENCY,
    globalConcurrency: DEFAULT_GLOBAL_CONCURRENCY,
    preSubmitRetries: PRE_SUBMIT_RETRY_DELAYS_MS.length,
    notifications: true,
    launchAtLogin: false,
    displayMode: "auto",
    lastRoute: "/studio",
    closeToTrayExplained: false,
    apiEnabled: false,
    apiPort: API_DEFAULT_PORT,
    apiAccess: "local",
    apiNamedHost: "",
    apiDomainEnabled: false,
    apiDomainHost: "",
    apiDomainProxy: "managed",
    extendMaxSteps: EXTEND_MAX_STEPS_DEFAULT,
    bridgeHttpEnabled: true,
    concurrencyUiPages: DEFAULT_UI_PAGES,
    language: DEFAULT_LOCALE,
  };
}

const ACC_COLS: Record<string, string> = {
  alias: "alias",
  avatar: "avatar",
  state: "state",
  stateUntil: "state_until",
  stateNote: "state_note",
  proxyId: "proxy_id",
  capabilities: "capabilities",
  todayCount: "today_count",
  todayDate: "today_date",
  quota: "quota",
  lastActiveAt: "last_active_at",
  failTimes: "fail_times",
  execMode: "exec_mode",
  maxConcurrent: "max_concurrent",
  uiMaxConcurrent: "ui_max_concurrent",
};
const PROXY_COLS: Record<string, string> = {
  label: "label",
  health: "health",
  exitIpMasked: "exit_ip_masked",
  country: "country",
  latencyMs: "latency_ms",
  lastTestedAt: "last_tested_at",
  lastError: "last_error",
};
const JOB_COLS: Record<string, string> = {
  batchId: "batch_id",
  accountPref: "account_pref",
  accountId: "account_id",
  state: "state",
  stateUntil: "state_until",
  priority: "priority",
  attemptNo: "attempt_no",
  preSubmitFailures: "pre_submit_failures",
  downloadAttempts: "download_attempts",
  errorClass: "error_class",
  errorMessage: "error_message",
  remoteRef: "remote_ref",
  submitIntentAt: "submit_intent_at",
  acceptedAt: "accepted_at",
  startedAt: "started_at",
  completedAt: "completed_at",
  seen: "seen",
  prompt: "prompt",
  referenceIds: "reference_ids",
  kind: "kind",
  mode: "mode",
  boundAccountId: "bound_account_id",
  directive: "directive",
  extendMode: "extend_mode",
  execPath: "exec_path",
  remoteSessionId: "remote_session_id",
  baselineUserMsgs: "baseline_user_msgs",
  resultText: "result_text",
  resultTextTruncated: "result_text_truncated",
  outputsTruncated: "outputs_truncated",
  conversationId: "conversation_id",
};
const ASSET_COLS: Record<string, string> = { favorite: "favorite", trashedAt: "trashed_at", missing: "missing", path: "path" };
const JSON_FIELDS = new Set(["capabilities", "quota", "failTimes", "referenceIds", "settings", "rows", "plan"]);

function toDb(key: string, v: unknown): unknown {
  if (JSON_FIELDS.has(key)) return v === null ? null : JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined ? null : v;
}

export interface JobExtra {
  preSubmitFailures: number;
  seen: boolean;
  /** R27 — SHA-256 of the normalised API request body (never sent to the renderer as meaning, just stored). */
  apiFingerprint: string | null;
  /** Build 2.0 R96 — Muse conversation id of an HTTP send (main process only; stripped by publicJob). */
  remoteSessionId: string | null;
  /** R93 — user messages already in that conversation before this send (reconcile baseline). */
  baselineUserMsgs: number | null;
}

/** Main-process-only Vibes fields of an account (R42, R52): never part of a DTO. */
export interface VibesPrivate {
  identityFp: string | null;
  pendingFp: string | null;
  projectId: string | null;
  lastSubmitAt: number | null;
  failTimes: number[];
}

/** R52 — remote ids of a Vibes output; main process only. */
export interface RemoteSource {
  id: string;
  provider: Site;
  ownerAccountId: string;
  ownerIdentityFp: string;
  projectId: string | null;
  batchId: string | null;
  contentId: string;
  entityId: string | null;
  handle: string | null;
  videoUrl: string | null;
  originalPrompt: string | null;
  config: Record<string, unknown> | null;
  status: RemoteSourceStatus;
  createdAt: number;
  museSource?: { conversation: string; turn: string; output: string } | null;
}

export interface ChainRow extends ExtendChain {
  site: Site;
  priority: number;
  clientRequestId: string | null;
  apiFingerprint: string | null;
}

const VIBES_COLS: Record<string, string> = {
  enabled: "enabled",
  status: "status",
  statusUntil: "status_until",
  note: "note",
  identityMasked: "identity_masked",
  identityFp: "identity_fp",
  pendingFp: "pending_fp",
  pendingIdentityMasked: "pending_masked",
  checkedAt: "checked_at",
  failTimes: "fail_times",
  projectId: "project_id",
  lastSubmitAt: "last_submit_at",
};

const CHAIN_COLS: Record<string, string> = {
  status: "status",
  reason: "reason",
  stepsDone: "steps_done",
  lastAssetId: "last_asset_id",
  lastDurationMs: "last_duration_ms",
  plan: "plan",
  maxSteps: "max_steps",
  accountId: "account_id",
  updatedAt: "updated_at",
};

/** Asset rows with their remote source state (R45); the remote ids are not selected. */
const ASSET_SELECT = `SELECT a.*, rs.owner_account_id AS src_owner,
  CASE WHEN rs.id IS NULL THEN NULL WHEN rs.status != 'ok' THEN rs.status WHEN acc.id IS NULL THEN 'owner_removed'
       WHEN rs.provider = 'muse' AND rs.owner_identity_fp = 'gw:' || rs.owner_account_id THEN 'ok'
       WHEN rs.provider = 'muse' THEN CASE WHEN mi.fingerprint IS NULL OR mi.fingerprint != rs.owner_identity_fp THEN 'identity_changed' ELSE 'ok' END
       WHEN s.account_id IS NULL THEN 'owner_removed' WHEN rs.owner_identity_fp != COALESCE(s.identity_fp, '') THEN 'identity_changed' ELSE 'ok' END AS src_status,
  CASE WHEN rs.provider = 'muse' AND rs.muse_source IS NOT NULL THEN
       CASE WHEN substr(json_extract(rs.muse_source, '$.conversation'), 1, 3) = 'gw:' THEN 'http' ELSE 'ui' END END AS src_via
  FROM assets a LEFT JOIN remote_sources rs ON rs.id = a.remote_source_id
  LEFT JOIN account_sites s ON s.account_id = rs.owner_account_id AND s.site = 'vibes'
  LEFT JOIN accounts acc ON acc.id = rs.owner_account_id
  LEFT JOIN muse_identities mi ON mi.account_id = rs.owner_account_id`;

const ACCOUNT_SELECT = `SELECT a.*, s.enabled AS v_enabled, s.status AS v_status, s.status_until AS v_until, s.note AS v_note,
  s.identity_masked AS v_masked, s.identity_fp AS v_fp, s.pending_masked AS v_pmasked, s.checked_at AS v_checked
  FROM accounts a LEFT JOIN account_sites s ON s.account_id = a.id AND s.site = 'vibes'`;

export type JobRow = Job & JobExtra;

export class Repo {
  private rev = 0;
  constructor(public db: Database) {
    for (const t of ["accounts", "proxies", "batches", "jobs", "assets", "extend_chains"]) {
      const r = db.prepare(`SELECT MAX(rev) m FROM ${t}`).get() as { m: number | null };
      this.rev = Math.max(this.rev, r.m ?? 0);
    }
  }

  nextRev(): number {
    return ++this.rev;
  }
  currentRev(): number {
    return this.rev;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private patch(table: string, cols: Record<string, string>, id: string, patch: Record<string, unknown>): number {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const c = cols[k];
      if (!c) continue;
      sets.push(`${c}=?`);
      vals.push(toDb(k, v));
    }
    const rev = this.nextRev();
    sets.push("rev=?");
    vals.push(rev);
    this.db.prepare(`UPDATE ${table} SET ${sets.join(",")} WHERE id=?`).run(...(vals as never[]), id);
    return rev;
  }

  // ---------- settings ----------
  getSettings(defaults: Settings): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const out: Record<string, unknown> = { ...defaults };
    for (const r of rows) out[r.key] = J(r.value, (defaults as unknown as Record<string, unknown>)[r.key]);
    return out as unknown as Settings;
  }
  hasSetting(key: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM settings WHERE key = ?").get(key);
  }
  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, JSON.stringify(value));
  }

  // ---------- meta (install-wide values that are not settings, e.g. the identity salt) ----------
  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }

  // ---------- accounts ----------
  private mapVibes = (r: Row): VibesSite =>
    r.v_status === null || r.v_status === undefined
      ? { enabled: true, status: "logged_out", statusUntil: null, note: null, identityMasked: null, hasIdentity: false, pendingIdentityMasked: null, checkedAt: null }
      : {
          enabled: Number(r.v_enabled) === 1,
          status: r.v_status as VibesStatus,
          statusUntil: N(r.v_until),
          note: (r.v_note as string) ?? null,
          identityMasked: (r.v_masked as string) ?? null,
          hasIdentity: !!r.v_fp,
          pendingIdentityMasked: (r.v_pmasked as string) ?? null,
          checkedAt: N(r.v_checked),
        };
  private mapAccount = (r: Row): Account => ({
    id: String(r.id),
    alias: String(r.alias),
    avatar: Number(r.avatar),
    state: r.state as Account["state"],
    stateUntil: N(r.state_until),
    stateNote: (r.state_note as string) ?? null,
    proxyId: (r.proxy_id as string) ?? null,
    capabilities: J(r.capabilities, {}) as Account["capabilities"],
    todayCount: Number(r.today_count),
    todayDate: String(r.today_date),
    quota: J(r.quota, null) as Account["quota"],
    lastActiveAt: N(r.last_active_at),
    failTimes: J(r.fail_times, []) as number[],
    currentJobId: null,
    currentSite: null,
    execMode: (["auto", "http", "ui"].includes(String(r.exec_mode)) ? r.exec_mode : EXEC_DEFAULTS.mode) as ExecMode,
    maxConcurrent: r.max_concurrent === undefined || r.max_concurrent === null ? EXEC_DEFAULTS.maxConcurrent : Number(r.max_concurrent),
    uiMaxConcurrent: r.ui_max_concurrent === undefined || r.ui_max_concurrent === null ? EXEC_DEFAULTS.uiMaxConcurrent : Number(r.ui_max_concurrent),
    vibes: this.mapVibes(r),
    createdAt: Number(r.created_at),
    rev: Number(r.rev),
  });
  listAccounts(): Account[] {
    return (this.db.prepare(`${ACCOUNT_SELECT} ORDER BY a.created_at`).all() as Row[]).map(this.mapAccount);
  }
  getAccount(id: string): Account | null {
    const r = this.db.prepare(`${ACCOUNT_SELECT} WHERE a.id=?`).get(id) as Row | undefined;
    return r ? this.mapAccount(r) : null;
  }
  /** Main-process-only Vibes fields (identity fingerprint, project, last send). */
  vibesPrivate(id: string): VibesPrivate {
    const r = this.db.prepare("SELECT identity_fp, pending_fp, project_id, last_submit_at, fail_times FROM account_sites WHERE account_id=? AND site='vibes'").get(id) as Row | undefined;
    return {
      identityFp: (r?.identity_fp as string) ?? null,
      pendingFp: (r?.pending_fp as string) ?? null,
      projectId: (r?.project_id as string) ?? null,
      lastSubmitAt: N(r?.last_submit_at),
      failTimes: J(r?.fail_times, []) as number[],
    };
  }
  /** Updates the Vibes side; bumps the account's rev so the renderer merge (AGENTS.md) takes the new copy. */
  updateVibes(id: string, patch: Partial<VibesSite & VibesPrivate>): Account {
    this.db.prepare("INSERT OR IGNORE INTO account_sites(account_id, site) VALUES(?, 'vibes')").run(id);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const c = VIBES_COLS[k];
      if (!c) continue;
      sets.push(`${c}=?`);
      vals.push(toDb(k, v));
    }
    if (sets.length) this.db.prepare(`UPDATE account_sites SET ${sets.join(",")} WHERE account_id=? AND site='vibes'`).run(...(vals as never[]), id);
    this.patch("accounts", ACC_COLS, id, {});
    return this.getAccount(id)!;
  }
  insertAccount(a: { alias: string; avatar: number; proxyId: string | null; now: number }): Account {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO accounts(id,alias,alias_key,avatar,state,proxy_id,created_at,rev) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(id, a.alias, a.alias.toLocaleLowerCase("vi"), a.avatar, "new", a.proxyId, a.now, this.nextRev());
    this.db.prepare("INSERT OR IGNORE INTO account_sites(account_id, site, enabled, status) VALUES(?, 'vibes', 1, 'logged_out')").run(id);
    return this.getAccount(id)!;
  }
  updateAccount(id: string, patch: Partial<Account>): Account {
    const p: Record<string, unknown> = { ...patch };
    if (patch.alias !== undefined) {
      this.db.prepare("UPDATE accounts SET alias_key=? WHERE id=?").run(patch.alias.toLocaleLowerCase("vi"), id);
    }
    this.patch("accounts", ACC_COLS, id, p);
    return this.getAccount(id)!;
  }
  deleteAccount(id: string): void {
    this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    this.db.prepare("DELETE FROM account_sites WHERE account_id=?").run(id);
  }

  // ---------- proxies ----------
  private mapProxy = (r: Row): Proxy => ({
    id: String(r.id),
    label: String(r.label),
    scheme: r.scheme as Proxy["scheme"],
    host: String(r.host),
    port: Number(r.port),
    hasAuth: Number(r.has_auth) === 1,
    health: r.health as Proxy["health"],
    exitIpMasked: (r.exit_ip_masked as string) ?? null,
    country: (r.country as string) ?? null,
    latencyMs: N(r.latency_ms),
    lastTestedAt: N(r.last_tested_at),
    lastError: (r.last_error as string) ?? null,
    createdAt: Number(r.created_at),
    rev: Number(r.rev),
  });
  listProxies(): Proxy[] {
    return (this.db.prepare("SELECT * FROM proxies ORDER BY created_at, label").all() as Row[]).map(this.mapProxy);
  }
  getProxy(id: string): Proxy | null {
    const r = this.db.prepare("SELECT * FROM proxies WHERE id=?").get(id) as Row | undefined;
    return r ? this.mapProxy(r) : null;
  }
  proxySecretRef(id: string): string | null {
    const r = this.db.prepare("SELECT secret_ref FROM proxies WHERE id=?").get(id) as { secret_ref: string | null } | undefined;
    return r?.secret_ref ?? null;
  }
  insertProxy(p: { label: string; scheme: string; host: string; port: number; secretRef: string | null; now: number }): Proxy {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO proxies(id,label,scheme,host,port,secret_ref,has_auth,created_at,rev) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(id, p.label, p.scheme, p.host, p.port, p.secretRef, p.secretRef ? 1 : 0, p.now, this.nextRev());
    return this.getProxy(id)!;
  }
  updateProxy(id: string, patch: Partial<Proxy>): Proxy {
    this.patch("proxies", PROXY_COLS, id, patch as Record<string, unknown>);
    return this.getProxy(id)!;
  }
  /** Build 3.2 R142 — the accounts on a proxy, oldest first (`accounts.proxy_id` is the only record of who uses it). */
  accountsOnProxy(proxyId: string): Account[] {
    return (this.db.prepare("SELECT * FROM accounts WHERE proxy_id=? ORDER BY created_at, alias").all(proxyId) as Row[]).map(this.mapAccount);
  }
  deleteProxy(id: string): void {
    this.db.prepare("DELETE FROM proxies WHERE id=?").run(id);
  }
  proxyKeys(): string[] {
    return (this.db.prepare("SELECT host, port FROM proxies").all() as { host: string; port: number }[]).map((r) => `${r.host}:${r.port}`);
  }

  // ---------- batches ----------
  batchCounts(batchId: string): BatchCounts {
    const rows = this.db.prepare("SELECT state, COUNT(*) c FROM jobs WHERE batch_id=? GROUP BY state").all(batchId) as {
      state: JobState;
      c: number;
    }[];
    const c: BatchCounts = { total: 0, completed: 0, running: 0, waiting: 0, failed: 0, review: 0, cancelled: 0 };
    for (const r of rows) {
      c.total += r.c;
      if (r.state === "completed") c.completed += r.c;
      else if (r.state === "failed") c.failed += r.c;
      else if (r.state === "needs_review") c.review += r.c;
      else if (r.state === "cancelled") c.cancelled += r.c;
      else if (IN_FLIGHT.has(r.state)) c.running += r.c;
      else c.waiting += r.c;
    }
    return c;
  }
  private mapBatch = (r: Row): Batch => ({
    id: String(r.id),
    name: String(r.name),
    createdAt: Number(r.created_at),
    state: r.state as Batch["state"],
    settings: J(r.settings, {}) as Batch["settings"],
    rows: J(r.rows, []) as Batch["rows"],
    counts: this.batchCounts(String(r.id)),
    rev: Number(r.rev),
  });
  listBatches(): Batch[] {
    return (this.db.prepare("SELECT * FROM batches ORDER BY created_at DESC").all() as Row[]).map(this.mapBatch);
  }
  getBatch(id: string): Batch | null {
    const r = this.db.prepare("SELECT * FROM batches WHERE id=?").get(id) as Row | undefined;
    return r ? this.mapBatch(r) : null;
  }
  insertBatch(b: { id?: string; name: string; state: Batch["state"]; settings: Batch["settings"]; rows: Batch["rows"]; now: number }): Batch {
    const id = b.id ?? randomUUID();
    this.db
      .prepare("INSERT INTO batches(id,name,created_at,state,settings,rows,rev) VALUES(?,?,?,?,?,?,?)")
      .run(id, b.name, b.now, b.state, JSON.stringify(b.settings), JSON.stringify(b.rows), this.nextRev());
    return this.getBatch(id)!;
  }
  updateBatch(id: string, patch: Partial<Pick<Batch, "name" | "state" | "settings" | "rows">>): Batch {
    this.patch("batches", { name: "name", state: "state", settings: "settings", rows: "rows" }, id, patch as Record<string, unknown>);
    return this.getBatch(id)!;
  }
  touchBatch(id: string): Batch | null {
    if (!this.getBatch(id)) return null;
    this.patch("batches", {}, id, {});
    return this.getBatch(id);
  }
  deleteBatch(id: string): void {
    this.db.prepare("DELETE FROM batches WHERE id=?").run(id);
  }

  // ---------- jobs ----------
  private mapJob = (r: Row): JobRow => ({
    id: String(r.id),
    batchId: (r.batch_id as string) ?? null,
    kind: r.kind as Job["kind"],
    mode: r.mode as Job["mode"],
    prompt: String(r.prompt),
    referenceIds: J(r.reference_ids, []) as string[],
    accountPref: String(r.account_pref),
    accountId: (r.account_id as string) ?? null,
    state: r.state as JobState,
    stateUntil: N(r.state_until),
    priority: Number(r.priority),
    attemptNo: Number(r.attempt_no),
    preSubmitFailures: Number(r.pre_submit_failures),
    downloadAttempts: Number(r.download_attempts),
    errorClass: (r.error_class as Job["errorClass"]) ?? null,
    errorMessage: (r.error_message as string) ?? null,
    remoteRef: (r.remote_ref as string) ?? null,
    submitIntentAt: N(r.submit_intent_at),
    acceptedAt: N(r.accepted_at),
    clientRequestId: (r.client_request_id as string) ?? null,
    apiKeyId: (r.api_key_id as string) ?? null,
    apiFingerprint: (r.api_fingerprint as string) ?? null,
    site: ((r.site as string) ?? "muse") as Site,
    operation: ((r.operation as string) ?? "generate") as JobOperation,
    boundAccountId: (r.bound_account_id as string) ?? null,
    sourceAssetId: (r.source_asset_id as string) ?? null,
    chainId: (r.chain_id as string) ?? null,
    stepIndex: N(r.step_index),
    extendMode: ((r.extend_mode as string) ?? null) as ExtendMode | null,
    directive: (r.directive as string) ?? null,
    execPath: ((r.exec_path as string) ?? null) as ExecPath | null,
    remoteSessionId: (r.remote_session_id as string) ?? null,
    baselineUserMsgs: N(r.baseline_user_msgs),
    resultText: (r.result_text as string) ?? null,
    resultTextTruncated: Number(r.result_text_truncated ?? 0) === 1,
    outputsTruncated: Number(r.outputs_truncated ?? 0) === 1,
    conversationId: (r.conversation_id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    startedAt: N(r.started_at),
    completedAt: N(r.completed_at),
    seen: Number(r.seen) === 1,
    seq: Number(r.seq),
    rev: Number(r.rev),
  });
  insertJob(j: {
    batchId: string | null;
    kind: Job["kind"];
    mode: Job["mode"];
    prompt: string;
    referenceIds: string[];
    accountPref: string;
    state: JobState;
    priority: number;
    clientRequestId: string | null;
    apiKeyId?: string | null;
    apiFingerprint?: string | null;
    site?: Site;
    operation?: JobOperation;
    boundAccountId?: string | null;
    sourceAssetId?: string | null;
    chainId?: string | null;
    stepIndex?: number | null;
    extendMode?: ExtendMode | null;
    directive?: string | null;
    conversationId?: string | null;
    now: number;
  }): JobRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO jobs(id,batch_id,kind,mode,prompt,reference_ids,account_pref,state,priority,client_request_id,api_key_id,api_fingerprint,
           site,operation,bound_account_id,source_asset_id,chain_id,step_index,extend_mode,directive,conversation_id,created_at,updated_at,rev)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        j.batchId,
        j.kind,
        j.mode,
        j.prompt,
        JSON.stringify(j.referenceIds),
        j.accountPref,
        j.state,
        j.priority,
        j.clientRequestId,
        j.apiKeyId ?? null,
        j.apiFingerprint ?? null,
        j.site ?? "muse",
        j.operation ?? "generate",
        j.boundAccountId ?? null,
        j.sourceAssetId ?? null,
        j.chainId ?? null,
        j.stepIndex ?? null,
        j.extendMode ?? null,
        j.directive ?? null,
        j.conversationId ?? null,
        j.now,
        j.now,
        this.nextRev(),
      );
    return this.getJob(id)!;
  }
  getJob(id: string): JobRow | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return r ? this.mapJob(r) : null;
  }
  updateJob(id: string, patch: Partial<JobRow>, now: number): JobRow {
    this.patch("jobs", { ...JOB_COLS, updatedAt: "updated_at" }, id, { ...patch, updatedAt: now } as Record<string, unknown>);
    return this.getJob(id)!;
  }
  jobsByClientRequest(clientRequestId: string): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE client_request_id=? ORDER BY seq").all(clientRequestId) as Row[]).map(this.mapJob);
  }
  jobsInStates(states: JobState[]): JobRow[] {
    if (!states.length) return [];
    return (this.db.prepare(`SELECT * FROM jobs WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY seq`).all(...states) as Row[]).map(
      this.mapJob,
    );
  }
  jobsForBatch(batchId: string, states?: JobState[]): JobRow[] {
    const where = states?.length ? ` AND state IN (${states.map(() => "?").join(",")})` : "";
    return (this.db.prepare(`SELECT * FROM jobs WHERE batch_id=?${where} ORDER BY seq`).all(batchId, ...(states ?? [])) as Row[]).map(this.mapJob);
  }
  jobsForChain(chainId: string): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE chain_id=? ORDER BY step_index, seq").all(chainId) as Row[]).map(this.mapJob);
  }
  jobsForAccount(accountId: string, states: JobState[]): JobRow[] {
    return (
      this.db
        .prepare(`SELECT * FROM jobs WHERE account_id=? AND state IN (${states.map(() => "?").join(",")}) ORDER BY seq`)
        .all(accountId, ...states) as Row[]
    ).map(this.mapJob);
  }
  queryJobs(f: JobFilter): Page<JobRow> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.states?.length) {
      where.push(`state IN (${f.states.map(() => "?").join(",")})`);
      args.push(...f.states);
    }
    if (f.batchId) {
      where.push("batch_id=?");
      args.push(f.batchId);
    }
    if (f.chainId) {
      where.push("chain_id=?");
      args.push(f.chainId);
    }
    if (f.standaloneOnly) where.push("batch_id IS NULL");
    if (f.accountId) {
      where.push("account_id=?");
      args.push(f.accountId);
    }
    if (f.kind) {
      where.push("kind=?");
      args.push(f.kind);
    }
    if (f.search?.trim()) {
      where.push("prompt LIKE ? ESCAPE '\\'");
      args.push(`%${f.search.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    }
    const base = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM jobs ${base}`).get(...(args as never[])) as { c: number }).c;
    const order = f.order === "asc" ? "ASC" : "DESC";
    const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
    const pageWhere = [...where];
    const pageArgs = [...args];
    if (f.cursor !== undefined && f.cursor !== null) {
      pageWhere.push(order === "DESC" ? "seq < ?" : "seq > ?");
      pageArgs.push(f.cursor);
    }
    const sql = `SELECT * FROM jobs ${pageWhere.length ? "WHERE " + pageWhere.join(" AND ") : ""} ORDER BY seq ${order} LIMIT ?`;
    const items = (this.db.prepare(sql).all(...(pageArgs as never[]), limit + 1) as Row[]).map(this.mapJob);
    const more = items.length > limit;
    if (more) items.pop();
    return { items, nextCursor: more ? items[items.length - 1].seq : null, total };
  }
  /** Counts per state for the queue filter pills (S04). */
  stateCounts(batchId?: string | null, search?: string): Record<JobState, number> & { all: number; chat: number } {
    const where: string[] = [];
    const args: unknown[] = [];
    if (batchId) {
      where.push("batch_id=?");
      args.push(batchId);
    }
    if (search?.trim()) {
      where.push("prompt LIKE ? ESCAPE '\\'");
      args.push(`%${search.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    }
    const rows = this.db.prepare(`SELECT state, kind = 'chat' AS chat, COUNT(*) c FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} GROUP BY state, kind = 'chat'`).all(...(args as never[])) as { state: JobState; chat: number; c: number }[];
    const out = { all: 0, chat: 0 } as Record<JobState, number> & { all: number; chat: number };
    for (const r of rows) {
      out[r.state] = (out[r.state] ?? 0) + r.c;
      out.all += r.c;
      if (r.chat) out.chat += r.c; // Build 2.0 S04 “Hỏi đáp” pill
    }
    return out;
  }
  /** R71 — Muse jobs sent on an account after `since` (submit intent recorded), straight from the store. */
  museSentSince(accountId: string, since: number): number {
    return (this.db
      .prepare(`SELECT COUNT(*) c FROM jobs WHERE account_id = ? AND site = 'muse' AND submit_intent_at IS NOT NULL AND submit_intent_at > ?`)
      .get(accountId, since) as { c: number }).c;
  }
  countJobs(states: JobState[]): number {
    return (this.db.prepare(`SELECT COUNT(*) c FROM jobs WHERE state IN (${states.map(() => "?").join(",")})`).get(...states) as { c: number }).c;
  }
  countUnfinished(): number {
    return (this.db.prepare(`SELECT COUNT(*) c FROM jobs WHERE state NOT IN (${[...TERMINAL].map(() => "?").join(",")})`).get(...TERMINAL) as {
      c: number;
    }).c;
  }
  countFailedUnseen(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state='failed' AND seen=0").get() as { c: number }).c;
  }
  markFailedSeen(): void {
    this.db.prepare("UPDATE jobs SET seen=1 WHERE state='failed' AND seen=0").run();
  }

  // ---------- attempts ----------
  /**
   * R113 — per account and path, Muse jobs sent since `since`: sent, completed, failed/review by error code and the
   * median send→done time. Counts and codes only — no prompt, answer or conversation id.
   */
  pathCounters(since: number): { accountId: string; path: string; sent: number; completed: number; failed: number; needsReview: number; errors: Record<string, number>; medianMs: number | null }[] {
    const rows = this.db
      .prepare("SELECT account_id a, COALESCE(exec_path,'ui') p, state s, error_class e, submit_intent_at t0, completed_at t1 FROM jobs WHERE account_id IS NOT NULL AND submit_intent_at >= ? AND site='muse'")
      .all(since) as { a: string; p: string; s: string; e: string | null; t0: number; t1: number | null }[];
    const by = new Map<string, { accountId: string; path: string; sent: number; completed: number; failed: number; needsReview: number; errors: Record<string, number>; times: number[] }>();
    for (const r of rows) {
      const k = `${r.a}|${r.p}`;
      let g = by.get(k);
      if (!g) by.set(k, (g = { accountId: r.a, path: r.p, sent: 0, completed: 0, failed: 0, needsReview: 0, errors: {}, times: [] }));
      g.sent++;
      if (r.s === "completed") {
        g.completed++;
        if (r.t1 !== null && r.t1 >= r.t0) g.times.push(r.t1 - r.t0);
      } else if (r.s === "failed" || r.s === "needs_review") {
        if (r.s === "failed") g.failed++;
        else g.needsReview++;
        const code = r.e ?? "UNKNOWN";
        g.errors[code] = (g.errors[code] ?? 0) + 1;
      }
    }
    return [...by.values()].map(({ times, ...g }) => {
      times.sort((x, y) => x - y);
      const m = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2)) : null;
      return { ...g, medianMs: m };
    });
  }

  /** R97 — end time of the newest HTTP attempt that got its turn generated or downloaded (null = none). */
  lastHttpSuccessAt(): number | null {
    const r = this.db.prepare("SELECT MAX(ended_at) AS t FROM attempts WHERE path = 'http' AND outcome IN ('generated','downloaded')").get() as { t: number | null } | undefined;
    return r?.t ?? null;
  }

  insertAttempt(a: Omit<Attempt, "id" | "endedAt" | "outcome" | "errorClass" | "note">): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO attempts(id,job_id,account_id,proxy_id,phase,started_at,path) VALUES(?,?,?,?,?,?,?)")
      .run(id, a.jobId, a.accountId, a.proxyId, a.phase, a.startedAt, a.path ?? null);
    return id;
  }
  endAttempt(id: string, r: { endedAt: number; outcome: string; errorClass?: string | null; note?: string | null }): void {
    this.db
      .prepare("UPDATE attempts SET ended_at=?, outcome=?, error_class=?, note=? WHERE id=?")
      .run(r.endedAt, r.outcome, r.errorClass ?? null, r.note ?? null, id);
  }
  /** Attempts the previous run left open (the app was closed or killed mid-step); returns how many were closed. */
  closeOpenAttempts(endedAt: number, note: string): number {
    return Number(this.db.prepare("UPDATE attempts SET ended_at=?, outcome='interrupted', note=? WHERE ended_at IS NULL").run(endedAt, note).changes);
  }
  attemptsForJob(jobId: string): Attempt[] {
    return (this.db.prepare("SELECT * FROM attempts WHERE job_id=? ORDER BY started_at").all(jobId) as Row[]).map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      accountId: (r.account_id as string) ?? null,
      proxyId: (r.proxy_id as string) ?? null,
      phase: r.phase as Attempt["phase"],
      startedAt: Number(r.started_at),
      endedAt: N(r.ended_at),
      outcome: (r.outcome as string) ?? null,
      errorClass: (r.error_class as Attempt["errorClass"]) ?? null,
      note: (r.note as string) ?? null,
      path: ((r.path as string) ?? null) as Attempt["path"],
    }));
  }

  // ---------- references ----------
  private mapRef = (r: Row): ReferenceFile => ({
    id: String(r.id),
    sha256: String(r.sha256),
    path: String(r.path),
    mime: String(r.mime),
    width: Number(r.width),
    height: Number(r.height),
    bytes: Number(r.bytes),
    kind: ((r.kind as string) ?? (String(r.mime).startsWith("video/") ? "video" : "image")) as ReferenceFile["kind"],
    filename: (r.filename as string) ?? null,
  });
  findRefBySha(sha: string): ReferenceFile | null {
    const r = this.db.prepare("SELECT * FROM refs WHERE sha256=?").get(sha) as Row | undefined;
    return r ? this.mapRef(r) : null;
  }
  getRef(id: string): ReferenceFile | null {
    const r = this.db.prepare("SELECT * FROM refs WHERE id=?").get(id) as Row | undefined;
    return r ? this.mapRef(r) : null;
  }
  insertRef(r: Omit<ReferenceFile, "id"> & { now: number }): ReferenceFile {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO refs(id,sha256,path,mime,width,height,bytes,kind,filename,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, r.sha256, r.path, r.mime, r.width, r.height, r.bytes, r.kind ?? (r.mime.startsWith("video/") ? "video" : "image"), r.filename ?? null, r.now);
    return this.getRef(id)!;
  }

  // ---------- assets ----------
  private mapAsset = (r: Row): Asset => ({
    id: String(r.id),
    jobId: String(r.job_id),
    batchId: (r.batch_id as string) ?? null,
    path: String(r.path),
    sha256: String(r.sha256),
    kind: r.kind as Asset["kind"],
    mime: String(r.mime),
    width: Number(r.width),
    height: Number(r.height),
    durationMs: N(r.duration_ms),
    bytes: Number(r.bytes),
    filename: (r.filename as string) ?? null,
    favorite: Number(r.favorite) === 1,
    trashedAt: N(r.trashed_at),
    missing: Number(r.missing) === 1,
    accountAlias: (r.account_alias as string) ?? null,
    prompt: String(r.prompt),
    site: ((r.site as string) ?? "muse") as Site,
    parentAssetId: (r.parent_asset_id as string) ?? null,
    chainId: (r.chain_id as string) ?? null,
    stepIndex: N(r.step_index),
    sourceStatus: ((r.src_status as string) ?? null) as RemoteSourceStatus | null,
    sourceOwnerId: (r.src_owner as string) ?? null,
    sourceVia: ((r.src_via as string) ?? null) as "http" | "ui" | null,
    ...(r.chain_count !== undefined && r.chain_count !== null ? { chainCount: Number(r.chain_count) } : {}),
    createdAt: Number(r.created_at),
    rev: Number(r.rev),
  });
  insertAsset(
    a: Omit<Asset, "id" | "rev" | "favorite" | "trashedAt" | "missing" | "site" | "parentAssetId" | "chainId" | "stepIndex" | "sourceStatus" | "sourceOwnerId"> &
      Partial<Pick<Asset, "site" | "parentAssetId" | "chainId" | "stepIndex">> & { remoteSourceId?: string | null; zoneMarked?: boolean },
  ): Asset {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO assets(id,job_id,batch_id,path,sha256,kind,mime,width,height,duration_ms,bytes,account_alias,prompt,site,parent_asset_id,chain_id,step_index,remote_source_id,filename,zone_marked,created_at,rev)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id, a.jobId, a.batchId, a.path, a.sha256, a.kind, a.mime, a.width, a.height, a.durationMs, a.bytes, a.accountAlias, a.prompt,
        a.site ?? "muse", a.parentAssetId ?? null, a.chainId ?? null, a.stepIndex ?? null, a.remoteSourceId ?? null, a.filename ?? null, a.zoneMarked ? 1 : 0, a.createdAt, this.nextRev(),
      );
    return this.getAsset(id)!;
  }
  getAsset(id: string): Asset | null {
    const r = this.db.prepare(`${ASSET_SELECT} WHERE a.id=?`).get(id) as Row | undefined;
    return r ? this.mapAsset(r) : null;
  }
  assetsForJob(jobId: string): Asset[] {
    return (this.db.prepare(`${ASSET_SELECT} WHERE a.job_id=? ORDER BY a.created_at`).all(jobId) as Row[]).map(this.mapAsset);
  }
  /** One query for a whole list page (R119): same rows and order per job as assetsForJob, without one statement per row. */
  assetsForJobs(jobIds: readonly string[]): Map<string, Asset[]> {
    const out = new Map<string, Asset[]>(jobIds.map((id) => [id, []]));
    if (!jobIds.length) return out;
    const rows = this.db.prepare(`${ASSET_SELECT} WHERE a.job_id IN (SELECT value FROM json_each(?)) ORDER BY a.created_at`).all(JSON.stringify(jobIds)) as Row[];
    for (const r of rows) out.get(String(r.job_id))?.push(this.mapAsset(r));
    return out;
  }
  assetsForChain(chainId: string): Asset[] {
    return (this.db.prepare(`${ASSET_SELECT} WHERE a.chain_id=? ORDER BY a.step_index, a.created_at`).all(chainId) as Row[]).map(this.mapAsset);
  }
  allAssets(): Asset[] {
    return (this.db.prepare(`${ASSET_SELECT}`).all() as Row[]).map(this.mapAsset);
  }
  /** R52 — the remote source id behind an asset (main process only). */
  assetRemoteSourceId(assetId: string): string | null {
    const r = this.db.prepare("SELECT remote_source_id FROM assets WHERE id=?").get(assetId) as { remote_source_id: string | null } | undefined;
    return r?.remote_source_id ?? null;
  }
  updateAsset(id: string, patch: Partial<Asset>): Asset {
    this.patch("assets", ASSET_COLS, id, patch as Record<string, unknown>);
    return this.getAsset(id)!;
  }
  queryAssets(f: AssetFilter): Page<Asset> {
    const where: string[] = ["a.trashed_at IS NULL"];
    const args: unknown[] = [];
    if (f.kind) {
      where.push("a.kind=?");
      args.push(f.kind);
    } else {
      // Build 2.0 — chat output files (kind 'file') live with their answer in Studio/Queue, not in the picture/video grid.
      where.push("a.kind<>'file'");
    }
    if (f.batchId) {
      if (f.batchId === "__standalone") where.push("a.batch_id IS NULL");
      else {
        where.push("a.batch_id=?");
        args.push(f.batchId);
      }
    }
    if (f.accountAlias) {
      where.push("a.account_alias=?");
      args.push(f.accountAlias);
    }
    if (f.favorite) where.push("a.favorite=1");
    if (f.fromDate) {
      where.push("a.created_at>=?");
      args.push(f.fromDate);
    }
    if (f.toDate) {
      where.push("a.created_at<?");
      args.push(f.toDate);
    }
    if (f.search?.trim()) {
      where.push("a.prompt LIKE ? ESCAPE '\\'");
      args.push(`%${f.search.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    }
    // AC-EXT-14: one tile per chain — its newest output that is not in the trash.
    if (f.collapseChains) {
      where.push("(a.chain_id IS NULL OR a.id = (SELECT c.id FROM assets c WHERE c.chain_id = a.chain_id AND c.trashed_at IS NULL ORDER BY c.created_at DESC, c.id DESC LIMIT 1))");
    }
    const base = `WHERE ${where.join(" AND ")}`;
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM assets a ${base}`).get(...(args as never[])) as { c: number }).c;
    const limit = Math.min(Math.max(f.limit ?? 120, 1), 500);
    const pw = [...where];
    const pa = [...args];
    if (f.cursor !== undefined && f.cursor !== null) {
      pw.push("a.created_at < ?");
      pa.push(f.cursor);
    }
    const select = f.collapseChains
      ? ASSET_SELECT.replace("SELECT a.*,", "SELECT a.*, CASE WHEN a.chain_id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM assets c WHERE c.chain_id = a.chain_id AND c.trashed_at IS NULL) END AS chain_count,")
      : ASSET_SELECT;
    const items = (
      this.db.prepare(`${select} WHERE ${pw.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(...(pa as never[]), limit + 1) as Row[]
    ).map(this.mapAsset);
    const more = items.length > limit;
    if (more) items.pop();
    return { items, nextCursor: more ? items[items.length - 1].createdAt : null, total };
  }
  libraryFacets(): { batches: { id: string; name: string }[]; accounts: string[] } {
    const batches = this.db
      .prepare("SELECT DISTINCT b.id id, b.name name FROM assets a JOIN batches b ON b.id=a.batch_id WHERE a.trashed_at IS NULL ORDER BY b.created_at DESC")
      .all() as { id: string; name: string }[];
    const accounts = (this.db.prepare("SELECT DISTINCT account_alias a FROM assets WHERE account_alias IS NOT NULL AND trashed_at IS NULL").all() as {
      a: string;
    }[]).map((r) => r.a);
    return { batches, accounts };
  }

  // ---------- remote sources (R52: main process only) ----------
  private mapSource = (r: Row): RemoteSource => ({
    id: String(r.id),
    provider: r.provider as Site,
    ownerAccountId: String(r.owner_account_id),
    ownerIdentityFp: String(r.owner_identity_fp),
    projectId: (r.project_id as string) ?? null,
    batchId: (r.batch_id as string) ?? null,
    contentId: String(r.content_id),
    entityId: (r.entity_id as string) ?? null,
    handle: (r.handle as string) ?? null,
    videoUrl: (r.video_url as string) ?? null,
    originalPrompt: (r.original_prompt as string) ?? null,
    config: J(r.config, null) as Record<string, unknown> | null,
    museSource: J(r.muse_source, null) as RemoteSource["museSource"],
    status: r.status as RemoteSourceStatus,
    createdAt: Number(r.created_at),
  });
  insertRemoteSource(s: Omit<RemoteSource, "id" | "status">): RemoteSource {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO remote_sources(id,provider,owner_account_id,owner_identity_fp,project_id,batch_id,content_id,entity_id,handle,video_url,original_prompt,config,status,created_at,muse_source)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ok',?,?)`,
      )
      .run(id, s.provider, s.ownerAccountId, s.ownerIdentityFp, s.projectId, s.batchId, s.contentId, s.entityId, s.handle, s.videoUrl, s.originalPrompt, s.config ? JSON.stringify(s.config) : null, s.createdAt, s.museSource ? JSON.stringify(s.museSource) : null);
    return this.getRemoteSource(id)!;
  }
  /**
   * Muse videos made on the channel before HTTP sources were saved (no source, plain generate jobs), newest first —
   * candidates for the read-only source recovery.
   */
  httpVideosWithoutSource(accountId: string, limit = 50): { assetId: string; jobId: string; bytes: number }[] {
    return (
      this.db
        .prepare(
          `SELECT a.id, a.job_id, a.bytes FROM assets a JOIN jobs j ON j.id=a.job_id
           WHERE a.kind='video' AND a.site='muse' AND a.remote_source_id IS NULL AND j.exec_path='http' AND j.remote_session_id IS NOT NULL
             AND j.account_id=? AND j.operation='generate' AND j.state='completed'
           ORDER BY a.created_at DESC LIMIT ?`,
        )
        .all(accountId, limit) as Row[]
    ).map((r) => ({ assetId: String(r.id), jobId: String(r.job_id), bytes: Number(r.bytes) }));
  }
  /** Links a recovered source to an asset that has none (never replaces one). */
  attachRemoteSource(assetId: string, sourceId: string): boolean {
    return Number(this.db.prepare("UPDATE assets SET remote_source_id=?, rev=? WHERE id=? AND remote_source_id IS NULL").run(sourceId, this.nextRev(), assetId).changes) === 1;
  }
  getRemoteSource(id: string): RemoteSource | null {
    const r = this.db.prepare("SELECT * FROM remote_sources WHERE id=?").get(id) as Row | undefined;
    return r ? this.mapSource(r) : null;
  }
  /** R50 — the owner account was removed: its sources can never be extended again. */
  markSourcesOwnerRemoved(accountId: string): number {
    return Number(this.db.prepare("UPDATE remote_sources SET status='owner_removed' WHERE owner_account_id=? AND status='ok'").run(accountId).changes);
  }

  /** Muse private state never participates in renderer snapshots. */
  museIdentity(accountId: string): string | null {
    const r = this.db.prepare("SELECT fingerprint FROM muse_identities WHERE account_id=?").get(accountId) as { fingerprint: string } | undefined;
    return r?.fingerprint ?? null;
  }
  clearMuseIdentity(accountId: string): void {
    this.db.prepare("DELETE FROM muse_identities WHERE account_id=?").run(accountId);
  }
  setMuseIdentity(accountId: string, fingerprint: string): void {
    this.db.prepare("INSERT INTO muse_identities VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET fingerprint=excluded.fingerprint").run(accountId, fingerprint);
  }
  museCheckpoint(jobId: string): MuseCheckpoint | null {
    const r = this.db.prepare("SELECT muse_checkpoint FROM jobs WHERE id=?").get(jobId) as { muse_checkpoint: string | null } | undefined;
    return J(r?.muse_checkpoint, null) as MuseCheckpoint | null;
  }
  setMuseCheckpoint(jobId: string, checkpoint: MuseCheckpoint): void {
    this.db.prepare("UPDATE jobs SET muse_checkpoint=? WHERE id=?").run(JSON.stringify(checkpoint), jobId);
  }
  museConversation(accountId: string, conversation: string): { id: string; tip: string | null; chain: string | null; unresolved: string | null } | null {
    const r = this.db.prepare("SELECT * FROM muse_conversations WHERE account_id=? AND conversation=?").get(accountId, conversation) as Row | undefined;
    return r ? { id: String(r.id), tip: r.tip_asset_id as string | null, chain: r.reserved_chain_id as string | null, unresolved: r.unresolved_job_id as string | null } : null;
  }
  /** App-issued conversation handle (rev 7.1 R65) → the private record. Callers check ownership; never expose `conversation`. */
  museConversationById(id: string): { id: string; accountId: string; conversation: string; tip: string | null; chain: string | null; unresolved: string | null } | null {
    if (!/^mc_[0-9a-f-]{36}$/.test(id)) return null;
    const r = this.db.prepare("SELECT * FROM muse_conversations WHERE id=?").get(id) as Row | undefined;
    return r ? { id: String(r.id), accountId: String(r.account_id), conversation: String(r.conversation), tip: r.tip_asset_id as string | null, chain: r.reserved_chain_id as string | null, unresolved: r.unresolved_job_id as string | null } : null;
  }
  /** Handle of the Muse conversation an output belongs to (its saved source), or null for anything without one. */
  museConversationIdForAsset(assetId: string): string | null {
    const r = this.db
      .prepare("SELECT s.owner_account_id acc, s.muse_source ms FROM assets a JOIN remote_sources s ON s.id=a.remote_source_id WHERE a.id=? AND s.provider='muse' AND s.muse_source IS NOT NULL")
      .get(assetId) as { acc: string; ms: string } | undefined;
    const conversation = (J(r?.ms, null) as { conversation?: string } | null)?.conversation;
    if (!r || !conversation) return null;
    return this.museConversation(r.acc, conversation)?.id ?? null;
  }
  /** Build 2.0 R85 — the conversation of an HTTP chat (main-only key `gw:{session}`), created once per conversation. */
  ensureChatConversation(accountId: string, conversation: string, ownerApiKeyId: string | null): string {
    this.db
      .prepare("INSERT INTO muse_conversations(id,account_id,conversation,kind,owner_api_key_id) VALUES(?,?,?,'chat',?) ON CONFLICT(account_id,conversation) DO NOTHING")
      .run(`mc_${randomUUID()}`, accountId, conversation, ownerApiKeyId);
    return this.museConversation(accountId, conversation)!.id;
  }
  /** R85 — at most one unfinished turn per conversation: reserve it for this job (false = busy). */
  reserveConversationTurn(id: string, jobId: string): boolean {
    return Number(this.db.prepare("UPDATE muse_conversations SET busy_job_id=? WHERE id=? AND (busy_job_id IS NULL OR busy_job_id=?) AND reserved_chain_id IS NULL AND unresolved_job_id IS NULL").run(jobId, id, jobId).changes) === 1;
  }
  /** R85 — conversations with an unfinished turn (conversation → that job), for the renderer's “Hỏi tiếp” state. */
  busyConversations(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare("SELECT id, busy_job_id FROM muse_conversations WHERE busy_job_id IS NOT NULL").all() as Row[]) out[String(r.id)] = String(r.busy_job_id);
    return out;
  }
  releaseConversationTurn(jobId: string): void {
    this.db.prepare("UPDATE muse_conversations SET busy_job_id=NULL WHERE busy_job_id=?").run(jobId);
  }
  conversationMeta(id: string): { kind: "chat" | "media"; ownerApiKeyId: string | null; busyJobId: string | null } | null {
    if (!/^mc_[0-9a-f-]{36}$/.test(id)) return null;
    const r = this.db.prepare("SELECT kind, owner_api_key_id, busy_job_id FROM muse_conversations WHERE id=?").get(id) as Row | undefined;
    return r ? { kind: (r.kind as "chat" | "media") ?? "media", ownerApiKeyId: (r.owner_api_key_id as string) ?? null, busyJobId: (r.busy_job_id as string) ?? null } : null;
  }
  jobsForConversation(id: string): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE conversation_id=? ORDER BY seq").all(id) as Row[]).map(this.mapJob);
  }
  /** Extend steps sent into one Muse conversation: their source video's saved source names it (owner account + key). */
  extendJobsForConversation(accountId: string, conversation: string): JobRow[] {
    return (
      this.db
        .prepare(
          `SELECT j.* FROM jobs j JOIN assets a ON a.id=j.source_asset_id JOIN remote_sources s ON s.id=a.remote_source_id
           WHERE j.operation='extend' AND s.provider='muse' AND s.owner_account_id=? AND json_extract(s.muse_source,'$.conversation')=? ORDER BY j.seq`,
        )
        .all(accountId, conversation) as Row[]
    ).map(this.mapJob);
  }

  setMuseTip(accountId: string, conversation: string, assetId: string): void {
    this.db
      .prepare("INSERT INTO muse_conversations(id,account_id,conversation,tip_asset_id) VALUES(?,?,?,?) ON CONFLICT(account_id,conversation) DO UPDATE SET tip_asset_id=excluded.tip_asset_id, unresolved_job_id=NULL")
      .run(`mc_${randomUUID()}`, accountId, conversation, assetId);
  }
  reserveMuseConversation(accountId: string, conversation: string, chainId: string): boolean {
    return Number(this.db.prepare("UPDATE muse_conversations SET reserved_chain_id=? WHERE account_id=? AND conversation=? AND (reserved_chain_id IS NULL OR reserved_chain_id=?) AND unresolved_job_id IS NULL AND busy_job_id IS NULL").run(chainId, accountId, conversation, chainId).changes) === 1;
  }
  markMuseUnresolved(accountId: string, conversation: string, jobId: string): void {
    this.db.prepare("UPDATE muse_conversations SET unresolved_job_id=? WHERE account_id=? AND conversation=?").run(jobId, accountId, conversation);
  }
  /** The send of this step is settled (Muse answered without a file, or the user dismissed/cancelled it): not unresolved any more. */
  clearMuseUnresolved(jobId: string): void {
    this.db.prepare("UPDATE muse_conversations SET unresolved_job_id=NULL WHERE unresolved_job_id=?").run(jobId);
  }
  releaseMuseConversation(chainId: string): void {
    this.db.prepare("UPDATE muse_conversations SET reserved_chain_id=NULL WHERE reserved_chain_id=? AND unresolved_job_id IS NULL").run(chainId);
  }

  // ---------- extend chains ----------
  private mapChain = (r: Row): ChainRow => ({
    id: String(r.id),
    site: (r.site as Site) ?? "vibes",
    accountId: (r.account_id as string) ?? null,
    accountAlias: (r.alias as string) ?? null,
    rootAssetId: String(r.root_asset_id),
    mode: r.mode as ExtendMode,
    directive: (r.directive as string) ?? null,
    plan: J(r.plan, { type: "steps", value: 1 }) as ChainPlan,
    maxSteps: Number(r.max_steps),
    stepsDone: Number(r.steps_done),
    status: r.status as ChainStatus,
    reason: (r.reason as string) ?? null,
    lastAssetId: (r.last_asset_id as string) ?? null,
    lastDurationMs: N(r.last_duration_ms),
    currentJobId: (r.current_job_id as string) ?? null,
    apiKeyId: (r.api_key_id as string) ?? null,
    priority: Number(r.priority),
    clientRequestId: (r.client_request_id as string) ?? null,
    apiFingerprint: (r.api_fingerprint as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    rev: Number(r.rev),
  });
  private chainSelect = `SELECT c.*, acc.alias AS alias,
    (SELECT j.id FROM jobs j WHERE j.chain_id = c.id AND j.state NOT IN ('completed','failed','cancelled') ORDER BY j.step_index DESC LIMIT 1) AS current_job_id
    FROM extend_chains c LEFT JOIN accounts acc ON acc.id = c.account_id`;
  insertChain(c: {
    site?: Site;
    accountId: string;
    rootAssetId: string;
    mode: ExtendMode;
    directive: string | null;
    plan: ChainPlan;
    maxSteps: number;
    priority: number;
    apiKeyId: string | null;
    clientRequestId: string | null;
    apiFingerprint: string | null;
    now: number;
  }): ChainRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO extend_chains(id,account_id,root_asset_id,mode,directive,plan,max_steps,steps_done,status,priority,api_key_id,client_request_id,api_fingerprint,created_at,updated_at,rev,site)
         VALUES(?,?,?,?,?,?,?,0,'running',?,?,?,?,?,?,?,?)`,
      )
      .run(id, c.accountId, c.rootAssetId, c.mode, c.directive, JSON.stringify(c.plan), c.maxSteps, c.priority, c.apiKeyId, c.clientRequestId, c.apiFingerprint, c.now, c.now, this.nextRev(), c.site ?? "vibes");
    return this.getChain(id)!;
  }
  getChain(id: string): ChainRow | null {
    const r = this.db.prepare(`${this.chainSelect} WHERE c.id=?`).get(id) as Row | undefined;
    return r ? this.mapChain(r) : null;
  }
  chainByClientRequest(crid: string): ChainRow | null {
    const r = this.db.prepare(`${this.chainSelect} WHERE c.client_request_id=?`).get(crid) as Row | undefined;
    return r ? this.mapChain(r) : null;
  }
  chainsForAccount(accountId: string, statuses?: ChainStatus[]): ChainRow[] {
    const where = statuses?.length ? ` AND c.status IN (${statuses.map(() => "?").join(",")})` : "";
    return (this.db.prepare(`${this.chainSelect} WHERE c.account_id=?${where} ORDER BY c.created_at`).all(accountId, ...(statuses ?? [])) as Row[]).map(this.mapChain);
  }
  listChains(statuses?: ChainStatus[]): ChainRow[] {
    const where = statuses?.length ? ` WHERE c.status IN (${statuses.map(() => "?").join(",")})` : "";
    return (this.db.prepare(`${this.chainSelect}${where} ORDER BY c.created_at DESC`).all(...(statuses ?? [])) as Row[]).map(this.mapChain);
  }
  updateChain(id: string, patch: Partial<ChainRow>, now: number): ChainRow {
    this.patch("extend_chains", CHAIN_COLS, id, { ...patch, updatedAt: now } as Record<string, unknown>);
    return this.getChain(id)!;
  }
}
