import type { UpdateStatus } from "./updates";
import type { Locale } from "./i18n";
// Domain types shared by main, renderer and tests. Source of rules: docs/build-1.0/spec.md (rev 3), docs/build-2.0/spec.md (rev 1).
import type { AccountExecution, BridgeStatus, ExecMode, ExecPath } from "./execution";

/** Build 2.0 R81 — `chat` is the generic bridge (“Hỏi đáp”): prompt (+ files) in, text + any files out. */
export type JobKind = "image" | "video" | "chat";
/** What a stored output is: media (library) or any other file Muse returned (R83). */
export type AssetKind = "image" | "video" | "file";
export type JobMode = "text" | "reference";

export type JobState =
  | "queued"
  | "held"
  | "preparing"
  | "submitting"
  | "submitted"
  | "generating"
  | "downloading"
  | "download_retry"
  | "retry_wait"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";

export type AccountState =
  | "new"
  | "logging_in"
  | "ready"
  | "busy"
  | "takeover"
  | "cooling_down"
  | "limit_reached"
  | "needs_login"
  | "checkpoint"
  | "proxy_error"
  | "paused";

export type ErrorClass =
  | "PRE_SUBMIT_TRANSIENT"
  | "AMBIGUOUS_SUBMIT"
  | "SESSION_EXPIRED"
  | "CHECKPOINT"
  | "QUOTA_LIMIT"
  | "CONTENT_REFUSED"
  /** rev 7.1 R64: Muse itself answered that its tool/service failed (e.g. upstream 502) — nothing was made. */
  | "PROVIDER_ERROR"
  | "PROXY_FAILED"
  | "UI_CHANGED"
  | "DOWNLOAD_FAILED"
  /** Build 2.0 R93: Muse certainly did not receive this send (its conversation never appeared) — not resent automatically. */
  | "NOT_ACCEPTED"
  /** Build 2.0 R83(e): Muse finished the turn with neither text nor a file. */
  | "EMPTY_RESPONSE"
  /** Build 2.0 R89 — technical failures of the HTTP path (count toward switching paths, never a content outcome). */
  | "HTTP_CONNECT_FAILED"
  | "HTTP_STREAM_LOST"
  | "HTTP_PROTOCOL_MISMATCH"
  | "HTTP_FETCH_FAILED"
  /** Build 2.0 R90: Muse reported unusual activity / a restricted account — pause, never switch paths. */
  | "ANOMALY_REPORTED"
  | "UNKNOWN";

export type ProxyScheme = "http" | "https" | "socks5";
export type ProxyHealth = "untested" | "testing" | "healthy" | "failed";
export type BatchState = "draft" | "running" | "paused" | "done" | "cancelled";
export type DisplayMode = "full" | "light" | "solid";
export type MuseCapabilityKey = "image.text" | "image.reference" | "video.text" | "video.reference" | "chat.text";
/** §4.7 rev 6 — Vibes capabilities stay off until verified live on this app version (rules B37). */
export type VibesCapabilityKey = "vibes.video.text" | "vibes.video.reference" | "vibes.video.extend";
export type CapabilityKey = MuseCapabilityKey | VibesCapabilityKey | "muse.video.extend";

/** rev 6 — one account profile, two sites (spec C9, R39–R40). */
export type Site = "muse" | "vibes";
export type JobOperation = "generate" | "extend";
export type ExtendMode = "auto" | "directive";
export type VibesStatus =
  | "off"
  | "logged_out"
  | "logging_in"
  | "ready"
  | "needs_login"
  | "checkpoint"
  | "restricted"
  | "identity_changed"
  | "limit_reached"
  | "cooling_down";

/** Vibes side of an account (spec R40). Identity is only ever the masked name here; the fingerprint stays in the main process. */
export interface VibesSite {
  /** “Dùng Vibes cho tài khoản này” (R39), on by default. */
  enabled: boolean;
  status: VibesStatus;
  statusUntil: number | null;
  note: string | null;
  identityMasked: string | null;
  /** Vibes was ready at least once (decides needs_login vs logged_out, R42). */
  hasIdentity: boolean;
  /** identity_changed: masked name of the newly seen Vibes account. */
  pendingIdentityMasked: string | null;
  checkedAt: number | null;
}

export type RemoteSourceStatus = "ok" | "owner_removed" | "identity_changed";
export type ChainStatus = "running" | "waiting" | "needs_review" | "completed" | "stopped" | "cancelled";
export interface ChainPlan {
  type: "steps" | "target";
  /** steps: N lần; target: T giây. */
  value: number;
}

/** A Kéo dài chain (spec F16, R46–R47). */
export interface ExtendChain {
  id: string;
  /** rev 7: where the chain runs (from its source video). */
  site?: Site;
  accountId: string | null;
  accountAlias: string | null;
  rootAssetId: string;
  mode: ExtendMode;
  directive: string | null;
  plan: ChainPlan;
  maxSteps: number;
  stepsDone: number;
  status: ChainStatus;
  /** Why the chain stopped / completed / waits (plain words). */
  reason: string | null;
  lastAssetId: string | null;
  lastDurationMs: number | null;
  currentJobId: string | null;
  apiKeyId: string | null;
  createdAt: number;
  updatedAt: number;
  rev: number;
}

export interface ChainStep {
  step: number;
  jobId: string;
  state: JobState;
  assetId: string | null;
  durationMs: number | null;
  /** When the step finished (or was created, while it runs). */
  at: number | null;
}

/** Whether the Kéo dài button is offered for an asset (R45). */
export interface ExtendInfo {
  ok: boolean;
  /** Exact lock reason when !ok. */
  reason: string | null;
  /** Owner account waits (needs login, limit …): chain will wait. */
  waitNote: string | null;
}

/** Spec R69 — the “Additional tokens” part of Muse's Usage panel, as Muse shows it. */
export interface QuotaAdditional {
  usedPercent: number | null;
  /** Verbatim, e.g. “5B tokens left”. */
  remainingLabel: string | null;
  /** Approximate count from the label's display unit (5B → 5e9), only to tell “some left” from “none left”. */
  remainingApprox: number | null;
  /** Verbatim, e.g. “Never expires”. */
  expiryLabel: string | null;
}

/** Where a `limit_reached` came from (R73/R74): Muse refused a job, or the app's own Usage read. */
export type QuotaLimitFrom = "muse" | "usage";

/** Spec R69 — one account's Usage snapshot (weekly + additional tokens). Older snapshots carry only plan/usedPercent/resetsOn/readAt. */
export interface Quota {
  plan?: string;
  /** Weekly part: % used, 0–100. */
  usedPercent?: number;
  /** Weekly reset label as Muse shows it (“Nov 2”). */
  resetsOn?: string;
  /** Earliest local time of that reset date (A14); null when it cannot be derived. */
  resetAt?: number | null;
  /** Object = shown in Usage; null = Usage has no such part; undefined = unknown (older snapshot). */
  additional?: QuotaAdditional | null;
  /** Last successful read; 0 = never read successfully. */
  readAt: number;
  /** Last read attempt (success or failure). */
  checkedAt?: number;
  /** Plain-words reason of the last failed attempt (cleared on success). */
  error?: string | null;
  /** Consecutive failed attempts (R71 back-off). */
  failures?: number;
  /** Meaningful only while the account is `limit_reached`. */
  limitFrom?: QuotaLimitFrom | null;
}

export interface Account {
  id: string;
  alias: string;
  avatar: number;
  state: AccountState;
  stateUntil: number | null;
  stateNote: string | null;
  proxyId: string | null;
  capabilities: Partial<Record<CapabilityKey, boolean>>;
  todayCount: number;
  todayDate: string;
  quota: Quota | null;
  lastActiveAt: number | null;
  failTimes: number[];
  currentJobId: string | null;
  /** Site of the job the account is working on right now (null when idle). */
  currentSite: Site | null;
  /** A Usage read is running on this account right now (lease, in memory only — R71). */
  quotaReading?: boolean;
  vibes: VibesSite;
  /** Build 2.0 R86/R98 — how this account runs Muse work and how many jobs at once. */
  execMode: ExecMode;
  maxConcurrent: number;
  uiMaxConcurrent: number;
  /** Runtime view (path in use, HTTP health, counts); filled by the coordinator, never stored. */
  execution?: AccountExecution;
  createdAt: number;
  rev: number;
}

export interface Proxy {
  id: string;
  label: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  hasAuth: boolean;
  health: ProxyHealth;
  exitIpMasked: string | null;
  country: string | null;
  latencyMs: number | null;
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  rev: number;
}

export interface BatchSettings {
  kind: JobKind;
  mode: JobMode;
  accountPref: string; // "auto" or account id
  repeat: number;
}

export interface BatchRow {
  line: number;
  prompt: string;
  kind: JobKind;
  mode: JobMode;
  reference: string | null; // file path (draft) — becomes referenceId on start
  repeat: number;
  error: string | null;
}

export interface BatchCounts {
  total: number;
  completed: number;
  running: number;
  waiting: number;
  failed: number;
  review: number;
  cancelled: number;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: number;
  state: BatchState;
  settings: BatchSettings;
  rows: BatchRow[];
  counts: BatchCounts;
  rev: number;
}

export interface Job {
  id: string;
  batchId: string | null;
  kind: JobKind;
  mode: JobMode;
  prompt: string;
  referenceIds: string[];
  accountPref: string;
  accountId: string | null;
  state: JobState;
  stateUntil: number | null;
  priority: number;
  attemptNo: number;
  downloadAttempts: number;
  errorClass: ErrorClass | null;
  errorMessage: string | null;
  remoteRef: string | null;
  submitIntentAt: number | null;
  acceptedAt: number | null;
  clientRequestId: string | null;
  /** Set when the job was created through the agent API (R25/R26). */
  apiKeyId: string | null;
  /** rev 6 — where it runs and what it does. Muse jobs: site muse, operation generate. */
  site: Site;
  operation: JobOperation;
  /** R50 — extend steps are pinned to the account that owns the source; never reassigned. */
  boundAccountId: string | null;
  sourceAssetId: string | null;
  chainId: string | null;
  stepIndex: number | null;
  extendMode: ExtendMode | null;
  directive: string | null;
  /** Build 2.0 — path the job was sent on (null before sending). */
  execPath: ExecPath | null;
  /** Build 2.0 R83 — chat answer (≤ 1 MiB) and whether it was cut (full text is then an output file). */
  resultText: string | null;
  resultTextTruncated: boolean;
  /** R83(c): Muse returned more files than the limit. */
  outputsTruncated: boolean;
  /** R85 — app conversation handle (`mc_…`) the job continues or created; never a Muse id. */
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  seq: number;
  rev: number;
}

export interface Attempt {
  id: string;
  jobId: string;
  accountId: string | null;
  proxyId: string | null;
  phase: "generate" | "download" | "reconcile" | "extend";
  /** Build 2.0 — path of this attempt (a read-only pickup may use the other path than the send, R91). */
  path?: ExecPath | null;
  startedAt: number;
  endedAt: number | null;
  outcome: string | null;
  errorClass: ErrorClass | null;
  note: string | null;
}

export interface ReferenceFile {
  id: string;
  sha256: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  /** Build 2.0 R82 — documents (CSV/TXT/MD/JSON/PDF) join images and MP4. */
  kind?: "image" | "video" | "document";
  /** Sanitized original name (documents keep their name for Muse). */
  filename?: string | null;
}

export interface Asset {
  id: string;
  jobId: string;
  batchId: string | null;
  path: string;
  sha256: string;
  kind: AssetKind;
  mime: string;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number;
  /** Build 2.0 — sanitized name of a chat output file (R84). */
  filename?: string | null;
  favorite: boolean;
  trashedAt: number | null;
  missing: boolean;
  accountAlias: string | null;
  prompt: string;
  /** rev 6 lineage (R49). */
  site: Site;
  parentAssetId: string | null;
  chainId: string | null;
  stepIndex: number | null;
  /** Remote source state (null for Muse/imported files); the remote ids themselves never leave the main process. */
  sourceStatus: RemoteSourceStatus | null;
  sourceOwnerId: string | null;
  /** Which path made a Muse source (an HTTP `gw:` session or the page): an extend step must run on that path. */
  sourceVia?: "http" | "ui" | null;
  /** Library collapses a chain into one tile: number of outputs of this chain (only on the newest one). */
  chainCount?: number;
  createdAt: number;
  rev: number;
}

export type ApiAccess = "local" | "lan" | "cloudflare_quick" | "cloudflare_named";
/** R34 — who terminates HTTPS for the domain: Caddy run by the app, or a proxy the user already runs. */
export type ApiDomainProxy = "managed" | "external";
export type ApiScope = "generate" | "read";

export interface Settings {
  onboardingStep: number; // 0..4, 4 = done
  riskAccepted: boolean;
  libraryDir: string;
  perAccountConcurrency: number;
  globalConcurrency: number;
  preSubmitRetries: number;
  notifications: boolean;
  launchAtLogin: boolean;
  displayMode: DisplayMode | "auto";
  lastRoute: string;
  closeToTrayExplained: boolean;
  /** R23 — API off by default; these three persist across restarts. */
  apiEnabled: boolean;
  apiPort: number;
  apiAccess: ApiAccess;
  /** Hostname for the user's own Cloudflare tunnel (R29); the token lives in the vault. */
  apiNamedHost: string;
  /** R34 — domain pointing at this machine: an extra way in, independent of apiAccess. Off by default. */
  apiDomainEnabled: boolean;
  apiDomainHost: string;
  apiDomainProxy: ApiDomainProxy;
  /** R46 — “Tối đa mỗi chuỗi kéo dài” (1–60). */
  extendMaxSteps: number;
  /** Build 2.0 R97 — “Kênh trực tiếp (HTTP)”, on by default. */
  bridgeHttpEnabled: boolean;
  /** Build 2.0 R99 — UI work pages app-wide (1–8). `globalConcurrency` is the app total (1–100). */
  concurrencyUiPages: number;
  /** Build 2.0 R120 — UI language; Vietnamese by default. */
  language: Locale;
  /** Build 3.3 AC-UPD-02 — check the website for a newer version at start and every 12 hours (on by default). */
  updateCheck: boolean;
}

export interface EngineStatus {
  connected: boolean;
  uiChangedKinds: JobKind[];
  /** rev 6 — Vibes changed its web app: Vibes jobs pause, Muse keeps running. */
  vibesUiChanged: boolean;
  diskFreeBytes: number | null;
  diskState: "ok" | "warn" | "paused";
  gpuCompositing: boolean;
  osTransparency: boolean;
  osReducedMotion: boolean;
  version: string;
  /** Build 2.0 — app-wide HTTP bridge status (S09g, B-HTTP). */
  bridge?: BridgeStatus;
}

export interface ApiKeyView {
  id: string;
  name: string;
  scope: ApiScope;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export type TunnelState = "off" | "downloading" | "starting" | "verifying" | "online" | "retrying" | "error";

export interface TunnelStatus {
  state: TunnelState;
  /** 0..1 while downloading. */
  progress: number | null;
  /** Public https origin once verified (or the named hostname being verified). */
  url: string | null;
  error: string | null;
  since: number | null;
  attempt: number;
  hasToken: boolean;
}

export type DomainState = "off" | "preparing" | "checking" | "pending" | "online" | "error";
export type DomainStepKey = "dns" | "port" | "cert" | "app";
export type DomainStepState = "pending" | "running" | "ok" | "warn" | "fail" | "skip";
export interface DomainStep {
  state: DomainStepState;
  detail: string | null;
}

export interface DomainStatus {
  enabled: boolean;
  host: string;
  proxy: ApiDomainProxy;
  /** off · preparing (downloading/starting Caddy) · checking (first round) · pending (needs DNS/firewall/cert) · online · error (Caddy stopped, Retry). */
  state: DomainState;
  /** 0..1 while Caddy downloads. */
  progress: number | null;
  /** `https://{host}` once online. */
  url: string | null;
  /** Hard error of the app's Caddy (hash, port 443, gave up); null otherwise. */
  error: string | null;
  steps: Record<DomainStepKey, DomainStep>;
  /** Hints (port 80 busy, other IP, last online at …). */
  notes: string[];
  /** Public IPv4 seen from the Internet (suggestion for the A record). */
  publicIp: string | null;
  dnsIps: string[];
  checkedAt: number | null;
  lastOnlineAt: number | null;
  /** Caddy restart attempt (R35 back-off). */
  attempt: number;
  /** Path of the app's Caddy executable, for the administrator firewall command. */
  caddyPath: string | null;
}

/** R38 — addresses an agent can use right now (or soon). */
export interface AgentUrl {
  via: "domain" | "tunnel" | "lan" | "local";
  url: string;
  online: boolean;
  internet: boolean;
}

export interface ApiStatus {
  enabled: boolean;
  port: number;
  access: ApiAccess;
  listening: boolean;
  localUrl: string | null;
  lanUrls: string[];
  error: string | null;
  /** Free port next to a busy/blocked one, offered as a one-click fix; null otherwise. */
  suggestedPort: number | null;
  namedHost: string;
  tunnel: TunnelStatus;
  domain: DomainStatus;
  urls: AgentUrl[];
  keys: ApiKeyView[];
  /** Apps connected through OAuth and approvals waiting for the user's code (R131–R141). */
  oauth: OAuthState;
}

/** One connection request waiting for the six-digit code in the app window. */
export interface OAuthPending {
  id: string;
  clientName: string;
  /** Where the app will return to — shown so the user can recognise it. */
  redirectHost: string;
  scopes: string[];
  /** The code the user reads off this window and types in the browser. */
  pairing: string;
  expiresAt: number;
  triesLeft: number;
}

/** An app that was approved once and can still get tokens. */
export interface OAuthClient {
  id: string;
  name: string;
  scope: string[];
  createdAt: number;
  lastUsedAt: number | null;
  activeTokens: number;
}

export interface OAuthState {
  pending: OAuthPending[];
  clients: OAuthClient[];
}

export interface ApiRequestLog {
  seq: number;
  ts: number;
  keyName: string | null;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  code: string | null;
  ipMasked: string | null;
  via: "local" | "lan" | "tunnel" | "domain";
}

export interface Snapshot {
  accounts: Account[];
  proxies: Proxy[];
  batches: Batch[];
  settings: Settings;
  engine: EngineStatus;
  capabilities: Record<CapabilityKey, boolean>;
  counts: { unfinished: number; review: number; failedUnseen: number };
  /** rev 6 — Kéo dài chains (newest first, at most 200); live updates arrive as `chain` events. */
  chains: ExtendChain[];
  recovered: { recovered: number; review: number } | null;
  api?: ApiStatus;
  /** Build 3.3 — update check, download and rollback state (live updates arrive as `update` events). */
  update?: UpdateStatus;
  /** R85 — app conversation handle → the job holding its one unfinished turn (kept current from `job` events). */
  busyConversations?: Record<string, string>;
  rev: number;
}

export interface JobFilter {
  states?: JobState[];
  chainId?: string;
  batchId?: string | null;
  accountId?: string;
  kind?: JobKind;
  search?: string;
  standaloneOnly?: boolean;
  cursor?: number | null; // seq
  limit?: number;
  order?: "asc" | "desc";
}

export interface AssetFilter {
  kind?: AssetKind;
  /** Library: show a chain as one tile (its newest output). */
  collapseChains?: boolean;
  batchId?: string;
  accountAlias?: string;
  favorite?: boolean;
  search?: string;
  fromDate?: number;
  toDate?: number;
  cursor?: number | null; // createdAt
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: number | null;
  total: number;
}
