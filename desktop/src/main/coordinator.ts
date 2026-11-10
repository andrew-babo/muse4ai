import { museExtendEligibility, museExtendPathReason, museWaitReason, validateMuseExtend, nextMuseChainStep, MUSE_EXTEND_MAX_STEPS, MUSE_EXTEND_TIMEOUT_MS } from "../shared/museExtend";
import { createHash, randomBytes } from "node:crypto";
import { onGenericFailure, onQuotaLimit, isExpiredTimedState, acceptsWork, ACCOUNT_LABEL } from "../shared/accountMachine";
import { enabledCapabilities, VERIFIED_CAPABILITIES, VIBES_CAPABILITIES } from "../shared/capabilities";
import { COOLDOWN_MS, FAIL_LIMIT, FAIL_WINDOW_MS, QUOTA_AUTO_READS_MAX } from "../shared/constants";
import { failQuotaRead, mergeQuotaRead, quotaBlock, quotaRank, quotaReadReason, quotaView, quotaWantsStartupRead } from "../shared/quota";
import {
  classifyAuthMe,
  extendEligibility,
  formatSeconds,
  loginPlan,
  looksLikeSegment,
  maskName,
  maskRemote,
  nextChainStep,
  normaliseDirective,
  remainingSteps,
  validateExtend,
  vibesAcceptsWork,
  vibesTimedOut,
  vibesWaitReason,
  LOGIN_STEP_TIMEOUT_MS,
  VIBES_LIMIT_DEFAULT_MS,
  VIBES_CHECK_FRESH_MS,
  VIBES_SUBMIT_GAP_MS,
  VIBES_AGE_NOTE,
  type AuthMeResponse,
  type LoginSite,
} from "../shared/vibes";
import { DISK_PAUSE_BYTES, DISK_WARN_BYTES, IMAGE_TIMEOUT_MS, VIDEO_EDIT_TIMEOUT_MS, LEASE_RELEASE_WAIT_MS, PRIORITY_BATCH, PRIORITY_BUMPED, PRIORITY_STANDALONE, REF_MAX_PER_JOB, REPEAT_MAX, REPEAT_MIN, VIDEO_TIMEOUT_MS } from "../shared/constants";
import { t } from "../shared/i18n";
import { dayKey, formatDate, formatNumber, formatTime, formatUntil } from "../shared/format";
import { AFTER_SUBMIT, assertTransition, ERROR_LABEL, isRetryableError, JOB_LABEL, PRE_SUBMIT, publicJob, TERMINAL } from "../shared/jobMachine";
import { parseProxyList, maskIp, type ProxyImportResult } from "../shared/proxyParse";
import { redact, registerSecret } from "../shared/redact";
import { downloadRetryDelay, preSubmitRetryDelay } from "../shared/retry";
import { capKey, schedule, type SchedAccount } from "../shared/scheduler";
import { suggestProxy } from "../shared/proxyShare";
import { clampInt, EXEC_DEFAULTS, GLOBAL_CONCURRENCY_RANGE, inRange, MAX_CONCURRENT_RANGE, SELF_CHECK_FIRST_MS, UI_MAX_RANGE, UI_PAGES_RANGE, UI_PAGE_MIN_FREE_BYTES, type ExecMode, type ExecPath, type HttpReason, type BridgeStatus, EXEC_REASON_LABEL } from "../shared/execution";
import { anyPathSupports, jobNeeds, type AttachmentNeed } from "../shared/pathCapability";
import { CHAT_ATTACH_MAX, CHAT_ATTACH_TOTAL_MAX, validateChatPrompt } from "../shared/chat";
import { ExecutionManager, type HttpTimings } from "./execution";
import { GW_CONV_PREFIX, HttpJobRunner, httpSourceFp } from "./httpRunner";
import type { HttpChannel } from "./adapter/muse/httpChannel";
import { summarize } from "../shared/batchParse";
import type {
  Account,
  AccountState,
  Batch,
  BatchRow,
  BatchSettings,
  CapabilityKey,
  ChainPlan,
  ChainStep,
  EngineStatus,
  ErrorClass,
  ExtendChain,
  ExtendMode,
  JobKind,
  JobMode,
  JobState,
  Proxy,
  Settings,
  Site,
  Snapshot,
  VibesSite,
} from "../shared/types";
import { validateAlias, validatePrompt } from "../shared/validate";
import { AbortedError, AdapterError, type MediaRef, type MuseAdapter, type ObserveResult, type ProxyTestResult, type VibesAdapter, sleep, throwIfAborted } from "./adapter/types";
import { InvalidMediaError, type MediaStore } from "./media";
import type { ChainRow, JobRow, Repo, VibesPrivate } from "./repo";

export interface Notice {
  kind: "batch_done" | "needs_login" | "checkpoint" | "account_paused" | "review" | "disk" | "ui_changed" | "info" | "vibes" | "chain" | "chain_done" | "quota" | "oauth";
  title: string;
  body: string;
  route: string;
}

export interface ProxyCreds {
  username: string | null;
  password: string | null;
}

export type LoginResult = boolean | "restricted";

export interface AccountUi {
  /**
   * Opens the login window of one site for this account; resolves true when a logged-in session is detected,
   * "restricted" when Vibes shows its under-18 block (AC-VIB-15), false if closed, skipped or cancelled (R41).
   */
  openLogin(accountId: string, site?: Site): Promise<LoginResult>;
  /** Ends a login window that is waiting (Bỏ qua Vibes, Huỷ, step timeout): its openLogin resolves false. */
  cancelLogin?(accountId: string, site?: Site): void;
  showTakeover(accountId: string, site?: Site): void;
  hideTakeover(accountId: string): void;
  applyProxy(accountId: string): void;
  destroy(accountId: string): Promise<void>;
  /** R39 — Vibes off: the profile sends nothing to vibes.ai / auth.meta.com. */
  setVibesEnabled?(accountId: string, on: boolean): void;
  /** “Đã xong, kiểm tra phiên” (S07c2): check the waiting login window now instead of at the next poll. */
  pokeLogin?(accountId: string, site: Site): void;
}

/** Two-step login progress shown in S07c2 (R41). */
export interface LoginProgress {
  accountId: string;
  /** skipped = already logged in (silent check); deferred = the user chose “Bỏ qua Vibes, dùng Muse trước”. */
  steps: { site: LoginSite; state: "pending" | "active" | "done" | "skipped" | "deferred" | "cancelled" | "timeout" | "failed" }[];
  active: LoginSite | null;
  done: boolean;
}

const HOLD_OFF = "Vibes đang tắt cho tài khoản này";
const HOLD_IDENTITY = "Phiên Vibes đã đổi tài khoản — chờ anh chọn";
const OWNER_REMOVED = "Tài khoản sở hữu video nguồn đã bị xoá";

export interface CoordinatorDeps {
  repo: Repo;
  media: MediaStore;
  adapterFor: (accountId: string) => MuseAdapter;
  /** R99 — each UI run keeps a dedicated page until its last download. */
  workAdapterFor?: (accountId: string, jobId: string) => MuseAdapter;
  releaseUiWork?: (accountId: string, jobId: string) => void;
  /** rev 6 — the account's Vibes adapter (same profile and proxy, its own page). */
  vibesFor?: (accountId: string) => VibesAdapter;
  ui: AccountUi;
  /** R41f — tests shorten the 15-minute login step limit. */
  loginStepTimeoutMs?: number;
  vault: { set(ref: string, value: string): void; get(ref: string): string | null; delete(ref: string): void };
  testProxy: (proxyId: string) => Promise<ProxyTestResult>;
  emit: (type: string, payload: unknown) => void;
  notify: (n: Notice) => void;
  log: (level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>) => void;
  diskFree: (dir: string) => Promise<number | null>;
  defaults: Settings;
  now?: () => number;
  version: string;
  timers?: boolean; // false in unit tests that drive tick() manually
  /** Build 2.0 — the account's direct channel (R94–R96). Absent → no HTTP path (every account runs as `ui`). */
  channelFor?: (accountId: string) => HttpChannel;
  dropChannel?: (accountId: string) => void;
  httpTimings?: Partial<HttpTimings>;
  /** R99 — UI pages one account may use at once (main page + work pages). Default 1 until work pages exist. */
  uiPagesPerAccount?: number;
  /** Free physical memory (R99 extra UI page gate). */
  freeMemBytes?: () => number;
}

export class CommandError extends Error {
  constructor(message: string, public code = "invalid") {
    super(message);
  }
}

interface Lease {
  kind: "job" | "login" | "check" | "takeover" | "quota" | "proxy";
  jobId?: string;
  abort?: AbortController;
  /** Site of the job (R3: one job per account across both sites). */
  site?: Site;
  /** R102 proxy change waiting for the user's “Dừng chờ” answer: the lock lapses at this time. */
  until?: number;
}

/** R102 — how long a proxy change keeps the account locked while the user is asked “Dừng chờ”. */
const PROXY_ASK_HOLD_MS = 2 * 60_000;

const PROGRESS_STATES: JobState[] = ["submitted", "generating", "downloading", "download_retry"];

export class Coordinator {
  repo: Repo;
  private leases = new Map<string, Lease>();
  private running = new Map<string, { accountId: string; abort: AbortController; promise: Promise<void>; path: ExecPath; site: Site }>();
  /** Build 2.0 — HTTP path state, channel pump, probes (in memory). */
  readonly exec: ExecutionManager;
  private http: HttpJobRunner;
  private firstFrameAt: number | null = null;
  private pendingTakeover = new Set<string>();
  private reconcileDone = new Set<string>();
  private uiChangedKinds = new Set<JobKind>();
  private vibesUiChanged = false;
  /** Test mode / unit tests only: pretend this version verified a capability (B37). */
  private verifiedOverride: Partial<Record<CapabilityKey, boolean>> = {};
  private chainNotified = new Set<string>();
  /** Time of the last session check that found Vibes ready, per account (in memory only). */
  private vibesReadyCheck = new Map<string, number>();
  private loginProgress = new Map<string, LoginProgress>();
  private tickTimer: NodeJS.Timeout | null = null;
  private schedTimer: NodeJS.Timeout | null = null;
  private diskTimer: NodeJS.Timeout | null = null;
  private diskFreeBytes: number | null = null;
  private recovered: Snapshot["recovered"] = null;
  private batchDoneNotified = new Set<string>();
  /** R71 (d–f): one-off Usage reads asked for (start-up check, end of a limit, Muse reported a limit). */
  private quotaPending = new Set<string>();
  /** Automatic Usage reads running now (≤ QUOTA_AUTO_READS_MAX app-wide). */
  private quotaReading = new Set<string>();
  private quotaRuns = new Set<Promise<unknown>>();
  /** R75: “Tất cả tài khoản Muse đã hết hạn mức” is shown once until an account works again. */
  private allQuotaNotified = false;
  private stopped = false;
  engineExtra: Pick<EngineStatus, "gpuCompositing" | "osTransparency" | "osReducedMotion"> = { gpuCompositing: true, osTransparency: true, osReducedMotion: false };
  windowVisible = () => true;

  constructor(private d: CoordinatorDeps) {
    this.repo = d.repo;
    this.exec = new ExecutionManager({
      channelFor: (id) => {
        if (!d.channelFor) throw new Error("no direct channel in this build");
        return d.channelFor(id);
      },
      dropChannel: d.dropChannel,
      lastHttpSuccessAt: () => this.repo.lastHttpSuccessAt(),
      now: () => this.now(),
      log: (level, scope, msg, data) => d.log(level, scope, msg, data),
      changed: (id) => (id ? this.emitAccount(id) : this.emitBridgeChange()),
      switchedToUi: (id, reason) => {
        const a = this.repo.getAccount(id);
        if (a) this.d.notify({ kind: "info", title: `${a.alias} chuyển sang chạy giao diện`, body: EXEC_REASON_LABEL[reason] ?? "kênh trực tiếp lỗi", route: `/accounts?focus=${id}` });
        this.requestSchedule();
      },
      incompatible: () => this.d.notify({ kind: "ui_changed", title: "Kênh trực tiếp Muse không tương thích", body: "Các tài khoản tạm chạy qua giao diện. Bấm “Kiểm ngay” trong Cài đặt › Chạy việc khi muốn thử lại.", route: "/settings/run" }),
      httpEnabled: () => !!d.channelFor && this.settings().bridgeHttpEnabled,
      timings: d.httpTimings,
    });
    this.http = new HttpJobRunner({
      repo: this.repo,
      exec: this.exec,
      media: () => this.media(),
      now: () => this.now(),
      setJob: (j, st, patch) => this.setJob(j, st, patch),
      emitJob: (j) => this.emitJob(j),
      emitAsset: (a) => this.d.emit("asset", a),
      log: (level, scope, msg, data) => this.d.log(level, scope, msg, data),
      fail: (jobId, accountId, err, afterSend, attemptId) => this.handleRunError(jobId, accountId, err, afterSend, attemptId),
      diskPaused: () => this.engineStatus().diskState === "paused",
      refreshDisk: () => this.refreshDisk(),
      accountAlias: (id) => this.repo.getAccount(id)?.alias ?? null,
      worked: (id) => {
        const a2 = this.repo.getAccount(id);
        if (!a2) return;
        const today = dayKey(this.now());
        this.setAccount(id, { lastActiveAt: this.now(), todayDate: today, todayCount: (a2.todayDate === today ? a2.todayCount : 0) + 1 });
      },
      completeChainStep: (id) => this.completeChainStep(id),
      insertMediaAsset: (job, accountId, stored, museSource) => this.insertMuseAsset(job, accountId, { src: "", kind: job.kind === "video" ? "video" : "image", ...(museSource ? { museSource } : {}) }, stored, this.repo.getAccount(accountId)?.alias ?? null),
    });
  }

  /** Live runs on one account (both paths, both sites). */
  private runsOn(id: string): { jobId: string; path: ExecPath; site: Site; abort: AbortController; promise: Promise<void> }[] {
    const out: { jobId: string; path: ExecPath; site: Site; abort: AbortController; promise: Promise<void> }[] = [];
    for (const [jobId, r] of this.running) if (r.accountId === id) out.push({ jobId, path: r.path, site: r.site, abort: r.abort, promise: r.promise });
    return out;
  }

  /** Runs that use an account page (UI path on Muse, any Vibes run). */
  private pageRunsOn(id: string): number {
    let n = 0;
    for (const r of this.running.values()) if (r.accountId === id && (r.path === "ui" || r.site === "vibes")) n++;
    return n;
  }

  now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  settings(): Settings {
    return this.repo.getSettings(this.d.defaults);
  }

  // ======================================================== lifecycle
  /**
   * `deferSessionChecks`: the app shell calls revalidateSessions() itself once the window has drawn its first frame,
   * so the account pages (one Chromium renderer each) do not compete with the first paint.
   */
  async init(opts: { deferSessionChecks?: boolean } = {}): Promise<void> {
    this.recover();
    await this.refreshDisk();
    if (this.d.timers !== false) {
      this.tickTimer = setInterval(() => void this.tick(), 1000);
      this.diskTimer = setInterval(() => void this.refreshDisk(), 60_000);
    }
    if (!opts.deferSessionChecks) this.revalidateSessions();
    this.requestSchedule();
  }

  private sessionsRevalidated = false;
  /** Provider availability, independent of legacy account flags in the store. */
  supportsVibes(): boolean {
    return !!this.d.vibesFor;
  }
  /** Re-validate sessions of accounts that were active before restart; Vibes only where it was ever ready (R42). Once per run. */
  revalidateSessions(): void {
    if (this.sessionsRevalidated || this.stopped) return;
    this.sessionsRevalidated = true;
    this.firstFrameAt ??= this.now();
    void this.recoverHttpSources().catch(() => undefined);
    for (const a of this.repo.listAccounts()) {
      if (!a.proxyId) continue;
      const museCheck = a.state === "ready" || a.state === "busy" ? this.checkSession(a.id, true).then((r) => (this.afterStartupCheck(r), r)) : Promise.resolve(null);
      if (this.d.vibesFor && a.vibes.enabled && a.vibes.hasIdentity) void museCheck.then(() => this.checkVibes(a.id, true)).catch(() => undefined);
      else void museCheck;
    }
  }

  private httpSourcesRecovered = false;
  /**
   * Once per run: HTTP videos made before sources were saved get their `gw:` source back from a read-only history
   * read (HttpJobRunner.findOldSources), so they can be extended. Accounts with nothing to recover open no channel.
   */
  async recoverHttpSources(): Promise<number> {
    if (this.httpSourcesRecovered || this.stopped || !this.d.channelFor || !this.settings().bridgeHttpEnabled) return 0;
    this.httpSourcesRecovered = true;
    let recovered = 0;
    for (const a of this.repo.listAccounts()) {
      if (a.execMode === "ui" || (a.state !== "ready" && a.state !== "busy")) continue;
      const items = this.repo.httpVideosWithoutSource(a.id).flatMap((r) => {
        const job = this.repo.getJob(r.jobId);
        return job ? [{ assetId: r.assetId, job, bytes: r.bytes }] : [];
      });
      if (!items.length) continue;
      let found: Awaited<ReturnType<HttpJobRunner["findOldSources"]>>;
      try {
        found = await this.http.findOldSources(a.id, items, new AbortController().signal);
      } catch (e) {
        this.d.log("warn", "job", "source.recover.failed", { accountId: a.id, error: String((e as Error)?.message ?? e).slice(0, 200) });
        continue;
      }
      for (const f of found) {
        const done = this.repo.tx(() => {
          if (this.repo.assetRemoteSourceId(f.assetId)) return false;
          const src = this.repo.insertRemoteSource({ provider: "muse", ownerAccountId: a.id, ownerIdentityFp: httpSourceFp(a.id), projectId: null, batchId: null, contentId: "", entityId: null, handle: null, videoUrl: null, originalPrompt: null, config: null, createdAt: this.now(), museSource: f.museSource });
          if (!this.repo.attachRemoteSource(f.assetId, src.id)) return false;
          if (f.tip) {
            const job = this.repo.getJob(this.repo.getAsset(f.assetId)?.jobId ?? "");
            this.repo.ensureChatConversation(a.id, f.museSource.conversation, job?.apiKeyId ?? null);
            if (!this.repo.museConversation(a.id, f.museSource.conversation)?.tip) this.repo.setMuseTip(a.id, f.museSource.conversation, f.assetId);
          }
          return true;
        });
        if (!done) continue;
        recovered++;
        const asset = this.repo.getAsset(f.assetId);
        if (asset) this.d.emit("asset", asset);
      }
    }
    this.d.log("info", "job", "source.recover", { recovered });
    return recovered;
  }

  /** R71 (d): the account page is loaded for the start-up session check anyway — read Usage then if it is old. */
  private afterStartupCheck(a: Account | null): void {
    if (!a || this.stopped || a.state !== "ready" || !quotaWantsStartupRead(a.quota, this.now())) return;
    this.quotaPending.add(a.id);
    this.requestSchedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.exec.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.diskTimer) clearInterval(this.diskTimer);
    if (this.schedTimer) clearTimeout(this.schedTimer);
  }

  /** F10 / R12 — restore queue and leases from the local store before accepting input. */
  recover(): void {
    const now = this.now();
    let recovered = 0;
    // Steps of the previous run that never ended would show “Đang chạy” forever; the jobs themselves are reconciled below.
    const interrupted = this.repo.closeOpenAttempts(now, "app đóng trước khi bước này xong");
    const nonTerminal = this.repo.jobsInStates(["queued", "held", "preparing", "submitting", "submitted", "generating", "downloading", "download_retry", "retry_wait", "needs_review"]);
    for (const j of nonTerminal) {
      if (j.state !== "needs_review") recovered++;
      if (j.state === "preparing") this.setJob(j, "queued", { accountId: null });
      else if (j.state === "submitting" && !j.submitIntentAt) this.setJob(j, "queued", { accountId: null });
      else if ((AFTER_SUBMIT.has(j.state) || j.state === "submitting") && !j.remoteRef && !j.remoteSessionId && j.state !== "submitting") {
        this.setJob(j, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Mất dấu lượt sau khi app đóng" });
      }
      // submitted/generating/downloading with remote ref and "submitting" with intent are reconciled by tick().
    }
    for (const a of this.repo.listAccounts()) {
      if (a.state === "busy" || a.state === "logging_in" || a.state === "takeover") this.setAccount(a.id, { state: "ready", stateUntil: null });
    }
    const review = this.repo.countJobs(["needs_review"]);
    this.media().cleanupOrphans(new Set(this.repo.jobsInStates(["submitting", "submitted", "generating", "downloading", "download_retry"]).map((j) => j.id)));
    this.recovered = recovered > 0 || review > 0 ? { recovered, review } : null;
    this.d.log("info", "recovery", "restored queue", { recovered, review, interrupted, at: now });
  }

  private media(): MediaStore {
    return this.d.media;
  }

  // ======================================================== snapshot / events
  snapshot(): Snapshot {
    const accounts = this.accountsView();
    return {
      accounts,
      proxies: this.repo.listProxies(),
      batches: this.repo.listBatches(),
      settings: this.settings(),
      engine: this.engineStatus(),
      capabilities: enabledCapabilities(accounts, this.verified()),
      counts: this.counts(),
      chains: this.listChains(),
      recovered: this.recovered,
      busyConversations: this.repo.busyConversations(),
      rev: this.repo.currentRev(),
    };
  }

  dismissRecovered(): void {
    this.recovered = null;
  }

  engineStatus(): EngineStatus {
    const free = this.diskFreeBytes;
    return {
      connected: true,
      uiChangedKinds: [...this.uiChangedKinds],
      vibesUiChanged: this.vibesUiChanged,
      diskFreeBytes: free,
      diskState: free === null ? "ok" : free < DISK_PAUSE_BYTES ? "paused" : free < DISK_WARN_BYTES ? "warn" : "ok",
      version: this.d.version,
      ...this.engineExtra,
      bridge: this.exec.bridge(),
    };
  }

  counts(): Snapshot["counts"] {
    return { unfinished: this.repo.countUnfinished(), review: this.repo.countJobs(["needs_review"]), failedUnseen: this.repo.countFailedUnseen() };
  }

  private withLease(a: Account): Account {
    const l = this.leases.get(a.id);
    const runs = this.runsOn(a.id);
    const first = runs.find((r) => r.path === "ui" || r.site === "vibes") ?? runs[0];
    const runningHttp = runs.filter((r) => r.path === "http").length;
    return {
      ...a,
      currentJobId: first?.jobId ?? null,
      currentSite: first ? first.site : null,
      quotaReading: l?.kind === "quota",
      execution: this.exec.view(this.d.channelFor ? a : { ...a, execMode: "ui" }, runningHttp, runs.length - runningHttp),
    };
  }

  /** Build 2.0 R109 — each account's live execution view (path, HTTP health, running counts) for `/v1/status`. */
  executionViews(): Map<string, NonNullable<Account["execution"]>> {
    return new Map(this.accountsView().map((a) => [a.id, a.execution!]));
  }

  private accountsView(): Account[] {
    return this.repo.listAccounts().map((a) => this.withLease(a));
  }

  private accountView(id: string): Account | null {
    const a = this.repo.getAccount(id);
    return a ? this.withLease(a) : null;
  }

  /** Which page of the account is in use right now (live preview shows that one). */
  activeSite(id: string): Site | null {
    const l = this.leases.get(id);
    if (!l) {
      const r = this.runsOn(id).find((x) => x.path === "ui" || x.site === "vibes");
      return r ? r.site : null;
    }
    if (l.kind === "job") return l.site ?? "muse";
    if (l.kind === "takeover") return this.takeoverSite.get(id) ?? "muse";
    if (l.kind === "login") return this.loginProgress.get(id)?.active ?? "muse";
    return "muse";
  }

  /** Capabilities this version verified (+ test overrides). */
  verified(): Record<CapabilityKey, boolean> {
    const caps = { ...VERIFIED_CAPABILITIES, ...this.verifiedOverride } as Record<CapabilityKey, boolean>;
    if (!this.d.vibesFor) for (const key of VIBES_CAPABILITIES) caps[key] = false;
    return caps;
  }

  /** The direct channel exists in this build and is switched on (otherwise every account works as UI). */
  extendHttpOn(): boolean {
    return !!this.d.channelFor && this.settings().bridgeHttpEnabled;
  }

  /** Test mode only (`__test.setVerified`) — the production path for Vibes is a code change after a live trial (B37). */
  testSetVerified(caps: Partial<Record<CapabilityKey, boolean>>): Record<CapabilityKey, boolean> {
    this.verifiedOverride = { ...this.verifiedOverride, ...caps };
    this.d.emit("snapshotCaps", enabledCapabilities(this.repo.listAccounts(), this.verified()));
    this.requestSchedule();
    return this.verified();
  }

  private emitJob(j: JobRow | null | undefined): void {
    if (j) this.d.emit("job", publicJob(j));
  }

  private emitAccount(id: string): void {
    const a = this.accountView(id);
    if (a) this.d.emit("account", a);
  }

  private emitCounts(): void {
    this.d.emit("counts", this.counts());
  }

  private emitBatch(id: string | null): void {
    if (!id) return;
    const b = this.repo.getBatch(id);
    if (b) this.d.emit("batch", b);
  }

  emitEngine(): void {
    this.d.emit("engine", this.engineStatus());
  }

  /**
   * App-wide bridge change: the engine status always; every account card too when compatibility flipped, because each
   * card's execution view (HTTP off · “không tương thích”, active path) is derived from it (AC-VIEW-01 state 7).
   */
  private lastCompat: BridgeStatus["compat"] | null = null;
  private emitBridgeChange(): void {
    this.emitEngine();
    const compat = this.exec.bridge().compat;
    if (compat === this.lastCompat) return;
    const first = this.lastCompat === null;
    this.lastCompat = compat;
    if (first && compat !== "incompatible") return;
    for (const a of this.repo.listAccounts()) this.emitAccount(a.id);
  }

  // ======================================================== state helpers
  private setJob(j: JobRow | string, to: JobState, patch: Partial<JobRow> = {}): JobRow {
    const cur = typeof j === "string" ? this.repo.getJob(j)! : this.repo.getJob(j.id)!;
    if (cur.state !== to) assertTransition(cur.state, to);
    const extra: Partial<JobRow> = {};
    if (to === "failed") extra.seen = false;
    if (TERMINAL.has(to) && !patch.completedAt) extra.completedAt = this.now();
    const updated = this.repo.updateJob(cur.id, { ...patch, ...extra, state: to }, this.now());
    this.emitJob(updated);
    if (cur.state !== to) {
      this.emitCounts();
      if (updated.batchId) this.onBatchJobChanged(updated.batchId);
      if (updated.chainId) this.onChainJobChanged(updated, cur.state);
      if (to === "needs_review") {
        this.d.notify({ kind: "review", title: "1 lượt cần anh xem", body: updated.prompt.slice(0, 80), route: `/queue/${updated.id}` });
      }
    }
    return updated;
  }

  private setAccount(id: string, patch: Partial<Account>, opts: { silent?: boolean } = {}): Account {
    const before = this.repo.getAccount(id);
    const a = this.repo.updateAccount(id, patch);
    this.emitAccount(id);
    if (before && patch.state && patch.state !== before.state) {
      if (opts.silent) {
        this.requestSchedule();
        return a;
      }
      if (patch.state === "needs_login") this.d.notify({ kind: "needs_login", title: `${a.alias} cần đăng nhập lại`, body: "Mở để đăng nhập lại tài khoản Muse", route: `/accounts/${id}/takeover` });
      if (patch.state === "checkpoint") this.d.notify({ kind: "checkpoint", title: `${a.alias} cần xác minh`, body: "Muse yêu cầu xác minh tài khoản", route: `/accounts/${id}/takeover` });
      if (patch.state === "limit_reached") this.notifyQuota(a);
      else this.allQuotaNotified = false;
      this.requestSchedule();
    }
    return a;
  }

  /** R75 — one notice per account entering `limit_reached` (both sources), and one when every account is out. */
  private notifyQuota(a: Account): void {
    const now = this.now();
    const accounts = this.repo.listAccounts();
    const others = accounts.some((x) => x.id !== a.id && acceptsWork(x.state));
    const until = a.stateUntil ? formatUntil(a.stateUntil, now) : null;
    this.d.notify({
      kind: "quota",
      title: `${a.alias} hết hạn mức`,
      body: others ? "Lượt mới chuyển sang tài khoản khác" : until ? `Lượt chờ tới ${until}` : "Lượt chờ tài khoản còn hạn mức",
      route: `/accounts?focus=${a.id}`,
    });
    if (!this.allQuotaNotified && accounts.length > 0 && accounts.every((x) => x.state === "limit_reached")) {
      this.allQuotaNotified = true;
      const first = Math.min(...accounts.map((x) => x.stateUntil ?? Infinity));
      this.d.notify({
        kind: "quota",
        title: "Tất cả tài khoản Muse đã hết hạn mức",
        body: Number.isFinite(first) ? `Lượt chờ tới ${formatUntil(first, now)}` : "Lượt chờ tới khi có tài khoản còn hạn mức",
        route: "/accounts",
      });
    }
  }

  /**
   * rev 6 (R40): Vibes state of one account. Never touches the Muse state. Notifies on the transitions the user must act
   * on (once per transition: a repeated check in the same state adds nothing, AC-VIB-05).
   */
  private setVibes(id: string, patch: Partial<VibesSite & VibesPrivate>, opts: { silent?: boolean } = {}): Account {
    const before = this.repo.getAccount(id);
    const a = this.repo.updateVibes(id, patch);
    this.emitAccount(id);
    if (before && patch.status && patch.status !== before.vibes.status) {
      if (opts.silent) {
        this.emitChainsFor(id);
        this.requestSchedule();
        return a;
      }
      const route = `/accounts/${id}/takeover?site=vibes`;
      // AC-VIB-10: the login link opens S07c2 at the Vibes step (only from a toast of this run, see toast.ts).
      if (patch.status === "needs_login") this.d.notify({ kind: "needs_login", title: `${a.alias} cần đăng nhập lại Vibes`, body: "Mở để đăng nhập lại Vibes cho tài khoản này", route: `/accounts/${id}/login?site=vibes` });
      if (patch.status === "checkpoint") this.d.notify({ kind: "checkpoint", title: `${a.alias} cần xác minh Vibes`, body: "Meta yêu cầu xác minh trước khi dùng Vibes", route });
      if (patch.status === "restricted") this.d.notify({ kind: "vibes", title: `${a.alias} chưa dùng được Vibes`, body: `${patch.note === VIBES_AGE_NOTE ? VIBES_AGE_NOTE : "Meta chưa mở Vibes cho tài khoản này"} — Muse vẫn chạy bình thường`, route: `/accounts/${id}` });
      if (patch.status === "identity_changed") this.d.notify({ kind: "vibes", title: `${a.alias}: đã đổi tài khoản Vibes`, body: "Chọn dùng tài khoản Vibes mới hoặc đăng nhập lại tài khoản cũ", route: `/accounts/${id}` });
      this.emitChainsFor(id);
      this.requestSchedule();
    }
    return a;
  }

  /** R43 — unexplained Vibes failure: Vibes rests 120 s; the 3rd within 15 minutes pauses the whole account (R8). */
  private applyVibesFailure(id: string): void {
    const now = this.now();
    const recent = [...this.repo.vibesPrivate(id).failTimes.filter((t) => now - t < FAIL_WINDOW_MS), now];
    if (recent.length >= FAIL_LIMIT) {
      this.repo.updateVibes(id, { failTimes: [] });
      const cur = this.repo.getAccount(id);
      const a = this.setAccount(id, { state: "paused", stateUntil: null, stateNote: `Vibes lỗi ${recent.length} lần trong 15 phút` });
      if (cur?.state !== "paused") this.d.notify({ kind: "account_paused", title: `${a.alias} đã tạm dừng`, body: `Vibes lỗi ${recent.length} lần trong 15 phút. Mở để kiểm tra rồi chạy lại.`, route: `/accounts/${id}` });
      return;
    }
    this.setVibes(id, { status: "cooling_down", statusUntil: now + COOLDOWN_MS, failTimes: recent });
  }

  /** R8 / AC-ACC-09: an unexplained account failure cools down 120 s; the 3rd within 15 minutes pauses it and tells the user. */
  private applyGenericFailure(id: string): void {
    const cur = this.repo.getAccount(id);
    if (!cur) return;
    const p = onGenericFailure(cur.failTimes, this.now());
    const a = this.setAccount(id, p);
    if (p.state === "paused" && cur.state !== "paused") {
      this.d.notify({ kind: "account_paused", title: `${a.alias} đã tạm dừng`, body: `${p.stateNote ?? "Lỗi lặp lại"}. Mở để kiểm tra rồi chạy lại.`, route: `/accounts/${id}` });
    }
  }

  private onBatchJobChanged(batchId: string): void {
    const b = this.repo.getBatch(batchId);
    if (!b) return;
    const c = b.counts;
    const open = c.total - c.completed - c.failed - c.cancelled - c.review;
    if ((b.state === "running" || b.state === "cancelled") && open === 0 && c.running === 0) {
      const finalState = b.state === "cancelled" ? "cancelled" : "done";
      if (b.state !== finalState) this.repo.updateBatch(batchId, { state: finalState });
      if (finalState === "done" && !this.batchDoneNotified.has(batchId)) {
        this.batchDoneNotified.add(batchId);
        this.d.notify({ kind: "batch_done", title: `Lô “${b.name}” xong: ${formatNumber(c.completed)}/${formatNumber(c.total)}`, body: c.failed || c.review ? `${c.failed} lỗi · ${c.review} cần xem` : "Tất cả đã xong", route: `/batch/${batchId}` });
      }
    }
    this.emitBatch(batchId);
  }

  // ======================================================== scheduling
  requestSchedule(): void {
    if (this.stopped || this.schedTimer) return;
    this.schedTimer = setTimeout(() => {
      this.schedTimer = null;
      this.runScheduler();
    }, 20);
  }

  /** One scheduler pass (also callable directly from tests). */
  runScheduler(): void {
    if (this.stopped) return;
    const s = this.settings();
    const proxies = new Map(this.repo.listProxies().map((p) => [p.id, p]));
    const accounts = this.repo.listAccounts();
    const httpBuild = !!this.d.channelFor;
    // R99 — app total of live runs (1–100) and UI pages app-wide (1–8).
    const globalCap = clampInt(s.globalConcurrency, GLOBAL_CONCURRENCY_RANGE, EXEC_DEFAULTS.globalConcurrency);
    const uiPagesCap = clampInt(s.concurrencyUiPages, UI_PAGES_RANGE, EXEC_DEFAULTS.uiPages);
    // 1) Reconcile orphans (jobs past submit without a live task) on their own account first, on the path they were sent.
    for (const j of this.repo.jobsInStates(["submitting", "submitted", "generating", "downloading", "download_retry"])) {
      if (j.site === "vibes" && !this.d.vibesFor) continue;
      if (this.running.size >= globalCap) break;
      if (this.running.has(j.id) || !j.accountId) continue;
      const acc = accounts.find((a) => a.id === j.accountId);
      if (!acc) {
        this.setJob(j, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Tài khoản đã bị xoá" });
        continue;
      }
      const path: ExecPath = j.execPath === "http" && httpBuild ? "http" : "ui";
      if (path === "http") {
        // R91/R102: an accepted HTTP turn keeps being followed (read-only) whatever the account is doing, except a pause.
        if (acc.state === "paused" || this.leases.get(acc.id)?.kind === "takeover" && !j.acceptedAt) continue;
      } else {
        const canWork = j.site === "vibes" ? vibesAcceptsWork(acc.vibes) && !["paused", "proxy_error", "takeover", "logging_in"].includes(acc.state) : acceptsWork(acc.state);
        if (!canWork || this.leases.has(acc.id) || this.pageRunsOn(acc.id) > 0) continue;
      }
      if (this.reconcileDone.has(j.id) && j.state === "submitting" && path === "ui") continue;
      this.startRun(j.id, acc.id, true, path);
    }

    // A job with a live run is never assigned again, whatever its stored state says.
    const queuedRows = this.repo.jobsInStates(["queued"]).filter((j) => !this.running.has(j.id) && (j.site !== "vibes" || !!this.d.vibesFor));
    const now = this.now();
    // 2) R71/R103: due Usage reads first — they take the account's `quota` lease synchronously (UI sends wait, HTTP runs).
    this.startQuotaReads(accounts, proxies, queuedRows, now);

    // 3) Assign queued work (R98–R100).
    const uiPerAccount = Math.max(1, this.d.uiPagesPerAccount ?? 1);
    let uiPagesUsed = 0;
    for (const r of this.running.values()) if (r.path === "ui" || r.site === "vibes") uiPagesUsed++;
    const sched: SchedAccount[] = accounts.map((a) => {
      const p = a.proxyId ? proxies.get(a.proxyId) : undefined;
      const runs = this.runsOn(a.id);
      const lease = this.leases.get(a.id);
      const mode: ExecMode = httpBuild ? a.execMode : "ui";
      const max = clampInt(a.maxConcurrent, MAX_CONCURRENT_RANGE, EXEC_DEFAULTS.maxConcurrent);
      return {
        id: a.id,
        state: a.state,
        proxyHealthy: !!p && p.health === "healthy",
        running: runs.length,
        runningUi: runs.filter((r) => r.path === "ui" && r.site === "muse").length,
        runningVibes: runs.filter((r) => r.site === "vibes").length,
        lastActiveAt: a.lastActiveAt,
        capabilities: a.capabilities,
        vibes: a.vibes,
        vibesReadyAt: (this.repo.vibesPrivate(a.id).lastSubmitAt ?? -Infinity) + VIBES_SUBMIT_GAP_MS,
        quotaRank: quotaRank(quotaView(a.quota, now).tier),
        execMode: mode,
        maxConcurrent: max,
        uiMaxConcurrent: Math.min(uiPerAccount, clampInt(a.uiMaxConcurrent, UI_MAX_RANGE, EXEC_DEFAULTS.uiMaxConcurrent)),
        httpUsable: httpBuild && this.exec.usable(a.id),
        httpDegraded: httpBuild && this.exec.healthOf(a.id).state !== "healthy" && this.exec.healthOf(a.id).state !== "unknown",
        locked: !!lease && lease.kind !== "quota",
        mainPageBusy: lease?.kind === "quota",
      };
    });
    const queued = queuedRows.map((j) => ({
      id: j.id,
      kind: j.kind,
      mode: j.mode,
      accountPref: j.accountPref,
      priority: j.priority,
      seq: j.seq,
      site: j.site,
      operation: j.operation,
      boundAccountId: j.boundAccountId,
      attachments: this.attachmentNeeds(j.referenceIds),
      continues: !!j.conversationId,
      extendSource: j.operation === "extend" && j.site !== "vibes" ? this.extendSourcePath(j.sourceAssetId) : undefined,
    }));
    if (!queued.length) return;
    const diskPaused = this.engineStatus().diskState === "paused";
    if (diskPaused) return;
    const assignments = schedule({
      queued,
      accounts: sched,
      perAccount: 1,
      globalCap,
      totalRunning: this.running.size,
      disabledKinds: [...this.uiChangedKinds],
      vibesDisabled: this.vibesUiChanged,
      verified: this.verified(),
      now,
      uiPagesCap,
      uiPagesUsed,
      memoryForExtraPage: (this.d.freeMemBytes?.() ?? Infinity) >= UI_PAGE_MIN_FREE_BYTES,
    });
    for (const a of assignments) this.startRun(a.jobId, a.accountId, false, a.path);
  }

  /** Kinds and sizes of a job's attachments (path capability, §4.2). */
  private attachmentNeeds(refIds: string[]): AttachmentNeed[] {
    const out: AttachmentNeed[] = [];
    for (const id of refIds) {
      const r = this.repo.getRef(id);
      if (r) out.push({ kind: r.kind ?? (r.mime.startsWith("video/") ? "video" : "image"), bytes: r.bytes });
    }
    return out;
  }

  /**
   * R71 — start the automatic Usage reads that are due: only on a free account (no lease) with a healthy proxy, `ready`
   * (or `limit_reached` with a pending one-off read), at most QUOTA_AUTO_READS_MAX at once. Never during a job.
   */
  private startQuotaReads(accounts: Account[], proxies: Map<string, Proxy>, queued: JobRow[], now: number): void {
    if (this.stopped) return;
    for (const a of accounts) {
      if (this.quotaReading.size >= QUOTA_AUTO_READS_MAX) return;
      if (this.leases.has(a.id) || this.pageRunsOn(a.id) > 0 || !a.proxyId || proxies.get(a.proxyId)?.health !== "healthy") continue;
      const pending = this.quotaPending.has(a.id);
      // R103: live HTTP turns keep the account "busy" but leave the main page free — the read may go ahead.
      if (!(a.state === "ready" || a.state === "busy" || (pending && a.state === "limit_reached"))) continue;
      const hasWork = queued.some((j) => j.site === "muse" && (j.boundAccountId ? j.boundAccountId === a.id : j.accountPref === "auto" || j.accountPref === a.id));
      const reason = quotaReadReason({ q: a.quota, now, sentSinceRead: this.repo.museSentSince(a.id, a.quota?.readAt ?? 0), pending, hasWork });
      if (!reason) continue;
      this.d.log("info", "quota", "automatic usage read", { id: a.id, reason });
      const run = this.refreshQuota(a.id, true).catch(() => undefined);
      this.quotaRuns.add(run);
      void run.finally(() => this.quotaRuns.delete(run));
    }
  }

  /** Timers: retry_wait due, timed account states, daily counters. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    // R102: a proxy change whose “Dừng chờ” question was never answered stops holding the account.
    for (const [id, l] of this.leases) if (l.kind === "proxy" && l.until !== undefined && l.until <= now) this.cancelProxyChange(id);
    for (const j of this.repo.jobsInStates(["retry_wait"])) {
      if (j.stateUntil !== null && j.stateUntil <= now) this.setJob(j, "queued", { stateUntil: null });
    }
    for (const a of this.repo.listAccounts()) {
      if (isExpiredTimedState(a, now)) {
        // R74: the end of a quota limit is confirmed by reading Usage again before new work.
        const wasLimit = a.state === "limit_reached";
        if (wasLimit) this.quotaPending.add(a.id);
        this.setAccount(a.id, { state: "ready", stateUntil: null, ...(wasLimit && a.quota?.limitFrom ? { quota: { ...a.quota, limitFrom: null } } : {}) });
        void this.checkSession(a.id, true);
      }
      // Timed Vibes states end by themselves; the next Vibes job re-checks the session (no background checks, R42).
      if (vibesTimedOut(a.vibes, now)) this.setVibes(a.id, { status: "ready", statusUntil: null, note: null });
      const today = dayKey(now);
      if (a.todayDate !== today && a.todayCount !== 0) this.setAccount(a.id, { todayCount: 0, todayDate: today });
    }
    if (this.d.channelFor) {
      const accounts = this.repo.listAccounts();
      // R92: read-only probes for accounts whose HTTP is down (never for paused/needs_login/limit/proxy/takeover).
      for (const a of this.exec.dueProbes(accounts)) void this.exec.probe(a, false).then(() => this.requestSchedule()).catch(() => undefined);
      // R97: self-check 60 s after the first frame and every 6 h when no HTTP turn succeeded for 6 h.
      if (this.exec.selfCheckDue(this.firstFrameAt, SELF_CHECK_FIRST_MS)) void this.exec.selfCheck(accounts).catch(() => undefined);
    }
    this.runScheduler();
  }

  private async refreshDisk(): Promise<void> {
    try {
      const prev = this.engineStatus().diskState;
      this.diskFreeBytes = await this.d.diskFree(this.settings().libraryDir);
      const next = this.engineStatus().diskState;
      if (next !== prev) {
        this.emitEngine();
        if (next === "paused") this.d.notify({ kind: "disk", title: "Ổ đĩa sắp đầy", body: "Đã tạm dừng tải về cho tới khi có thêm chỗ trống", route: "/settings/general" });
        if (next === "ok") this.requestSchedule();
      }
    } catch {
      /* ignore */
    }
  }

  // ======================================================== job execution
  private startRun(jobId: string, accountId: string, reconcile: boolean, path: ExecPath = "ui"): void {
    const abort = new AbortController();
    const site: Site = this.repo.getJob(jobId)?.site ?? "muse";
    const run = site === "vibes" ? this.runVibesJob(jobId, accountId, abort, reconcile) : path === "http" ? this.http.run(jobId, accountId, abort, reconcile) : this.runJob(jobId, accountId, abort, reconcile);
    const promise = run
      .catch((e) => {
        if (!this.stopped) this.d.log("error", "job", "run crashed", { jobId, accountId, error: redact(e) });
      })
      .finally(() => {
        if (path === "ui" && site === "muse") this.d.releaseUiWork?.(accountId, jobId);
        this.running.delete(jobId);
        if (this.stopped) return; // quitting: the store may already be closed
        const acc = this.repo.getAccount(accountId);
        if (acc?.state === "busy" && this.runsOn(accountId).length === 0) this.setAccount(accountId, { state: "ready" });
        else this.emitAccount(accountId);
        if (this.pendingTakeover.has(accountId) && this.pageRunsOn(accountId) === 0) {
          this.pendingTakeover.delete(accountId);
          this.enterTakeover(accountId);
        }
        this.requestSchedule();
      });
    this.running.set(jobId, { accountId, abort, promise, path, site });
    if (this.repo.getAccount(accountId)?.state === "ready" && site === "muse") this.setAccount(accountId, { state: "busy" });
    else this.emitAccount(accountId);
  }

  /** Waits for all in-flight work (tests). */
  async idle(): Promise<void> {
    while (this.running.size || this.quotaRuns.size) {
      await Promise.all([...this.running.values()].map((r) => r.promise.catch(() => undefined)));
      await Promise.all([...this.quotaRuns]);
    }
  }

  private async runJob(jobId: string, accountId: string, abort: AbortController, reconcile: boolean): Promise<void> {
    let job = this.repo.getJob(jobId);
    if (!job) return;
    const acc = this.repo.getAccount(accountId);
    if (!acc) return;
    if (acc.state === "ready") this.setAccount(accountId, { state: "busy" });
    else this.emitAccount(accountId);
    const adapter = this.d.workAdapterFor?.(accountId, jobId) ?? this.d.adapterFor(accountId);
    if (job.operation === "extend") return this.runMuseExtend(jobId, accountId, abort, reconcile, adapter);
    const spec = {
      jobId,
      kind: job.kind,
      mode: job.mode,
      prompt: job.prompt,
      referencePaths: job.referenceIds.map((id) => this.repo.getRef(id)?.path).filter((p): p is string => !!p),
      referenceMedia: job.referenceIds.some((id) => this.repo.getRef(id)?.mime === "video/mp4") ? "video" as const : "image" as const,
    };
    let afterSend = reconcile;
    const attemptId = this.repo.insertAttempt({ jobId, accountId, proxyId: acc.proxyId, phase: reconcile ? "reconcile" : "generate", startedAt: this.now(), path: "ui" });
    try {
      // The job leaves "queued" synchronously, before any await: while it is still queued the scheduler may lease
      // it to a second account (beta.29 live run: Thử A preparing, Thử B submitting the same job).
      // R86 §path: the job and each attempt record the path that sent it (live 01/11: UI runs showed path null).
      if (!reconcile) job = this.setJob(job, "preparing", { accountId, execPath: "ui", startedAt: this.now(), attemptNo: job.attemptNo + 1, errorClass: null, errorMessage: null, stateUntil: null });
      this.repo.clearMuseIdentity(accountId);
      if (adapter.identity) {
        const identity = await adapter.identity(abort.signal);
        if (identity) this.repo.setMuseIdentity(accountId, this.identityFp(identity));
      }
      if (!reconcile) {
        const r = await adapter.submit(spec, {
          signal: abort.signal,
          onBeforeSend: () => {
            throwIfAborted(abort.signal); // cancelled / held / taken over while preparing → never click Send
            afterSend = true;
            job = this.setJob(jobId, "submitting", { submitIntentAt: this.now() });
          },
        });
        throwIfAborted(abort.signal);
        job = this.setJob(jobId, "submitted", { remoteRef: r.remoteRef, acceptedAt: r.acceptedAt });
      } else if (job.state === "submitting" && job.remoteRef) {
        job = this.setJob(jobId, "submitted", { acceptedAt: job.acceptedAt ?? this.now() });
      } else if (job.state === "submitting" && !job.remoteRef) {
        // R12: intent written, acceptance unknown → look in this account's Muse history.
        this.reconcileDone.add(jobId);
        const ref = await adapter.findByPrompt(spec, job.submitIntentAt ?? 0);
        if (!ref) {
          this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "not_found", errorClass: "AMBIGUOUS_SUBMIT", note: "Không thấy trong lịch sử Muse" });
          this.setJob(jobId, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Không xác minh được Muse đã nhận lượt này" });
          return;
        }
        job = this.setJob(jobId, "submitted", { remoteRef: ref, acceptedAt: this.now() });
      }
      if (job.state === "submitted") job = this.setJob(jobId, "generating");
      let result: ObserveResult;
      if (job.state === "generating" || job.state === "downloading" || job.state === "download_retry") {
        result = await adapter.observe(job.remoteRef, job.kind, { signal: abort.signal, timeoutMs: job.kind !== "video" ? IMAGE_TIMEOUT_MS : job.referenceIds.some((id) => this.repo.getRef(id)?.mime === "video/mp4") ? VIDEO_EDIT_TIMEOUT_MS : VIDEO_TIMEOUT_MS });
      } else return;
      throwIfAborted(abort.signal);
      const wanted = result.media.filter((m) => m.kind === job!.kind);
      if (wanted.length === 0) {
        const msg = result.media.length && job.kind === "video" ? "Muse trả về ảnh thay vì video" : "Muse không trả về tệp nào";
        this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "no_media", errorClass: "UNKNOWN", note: msg });
        this.setJob(jobId, "failed", { errorClass: "UNKNOWN", errorMessage: msg });
        return;
      }
      this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "generated" });
      await this.downloadAll(jobId, accountId, adapter, wanted, abort.signal);
      const a2 = this.repo.getAccount(accountId);
      if (a2) {
        const today = dayKey(this.now());
        this.setAccount(accountId, { lastActiveAt: this.now(), todayDate: today, todayCount: (a2.todayDate === today ? a2.todayCount : 0) + 1 });
      }
    } catch (e) {
      // Once aborted (cancel, batch pause, takeover, removal, quit) the aborting path owns the job and account state;
      // a late adapter result or error must not overwrite it (e.g. takeover → cooldown).
      this.handleRunError(jobId, accountId, abort.signal.aborted ? new AbortedError() : e, afterSend, attemptId);
    }
  }

  private async downloadAll(jobId: string, accountId: string, adapter: { download(media: MediaRef, signal: AbortSignal): Promise<Uint8Array> }, media: ObserveResult["media"], signal: AbortSignal): Promise<void> {
    let job = this.repo.getJob(jobId)!;
    if (job.state !== "downloading") job = this.setJob(job, "downloading");
    const batch = job.batchId ? this.repo.getBatch(job.batchId) : null;
    const alias = this.repo.getAccount(accountId)?.alias ?? null;
    const shas = this.repo.assetsForJob(jobId).map((a) => a.sha256);
    for (let i = 0; i < media.length; i++) {
      let failures = 0;
      for (;;) {
        while (this.engineStatus().diskState === "paused") {
          await sleep(5000, signal);
          await this.refreshDisk();
        }
        const att = this.repo.insertAttempt({ jobId, accountId, proxyId: this.repo.getAccount(accountId)?.proxyId ?? null, phase: "download", startedAt: this.now(), path: "ui" });
        job = this.repo.updateJob(jobId, { downloadAttempts: (this.repo.getJob(jobId)?.downloadAttempts ?? 0) + 1 }, this.now());
        try {
          const bytes = await adapter.download(media[i], signal);
          const chain = job.chainId ? { id: job.chainId, step: job.stepIndex ?? 1 } : null;
          const stored = await this.media().store({ jobId, n: i + 1, bytes, expectedKind: job.kind, batchName: batch?.name ?? null, at: this.now(), existingShas: shas, chain });
          if ("duplicateOf" in stored) {
            this.repo.endAttempt(att, { endedAt: this.now(), outcome: "duplicate" });
            break;
          }
          shas.push(stored.sha256);
          const asset = job.site === "vibes" ? this.insertVibesAsset(job, accountId, media[i], stored, alias) : this.insertMuseAsset(job, accountId, media[i], stored, alias) /* source + lineage */;

          this.d.emit("asset", asset);
          this.repo.endAttempt(att, { endedAt: this.now(), outcome: "downloaded" });
          break;
        } catch (e) {
          if (e instanceof AbortedError) throw e;
          failures++;
          const msg = e instanceof InvalidMediaError ? e.message : redact(e);
          this.repo.endAttempt(att, { endedAt: this.now(), outcome: "download_failed", errorClass: "DOWNLOAD_FAILED", note: msg });
          const delay = downloadRetryDelay(failures);
          if (delay === null) {
            this.setJob(jobId, "needs_review", { errorClass: "DOWNLOAD_FAILED", errorMessage: `Tải về lỗi ${failures} lần: ${msg}` });
            return;
          }
          this.setJob(jobId, "download_retry", { errorMessage: msg });
          await sleep(delay, signal);
          this.setJob(jobId, "downloading");
        }
      }
    }
    this.media().cleanupStaging(jobId);
    if (job.chainId) this.completeChainStep(jobId);
    else this.setJob(jobId, "completed", { errorClass: null, errorMessage: null, completedAt: this.now() });
  }

  /** The path that made a Muse source video: its conversation key says which path can address it (pathCapability). */
  private extendSourcePath(assetId: string | null): "http" | "ui" {
    const sourceId = assetId ? this.repo.assetRemoteSourceId(assetId) : null;
    const conv = sourceId ? this.repo.getRemoteSource(sourceId)?.museSource?.conversation : null;
    return conv?.startsWith(GW_CONV_PREFIX) ? "http" : "ui";
  }

  private insertMuseAsset(job: JobRow, accountId: string, media: MediaRef, stored: { path: string; sha256: string; mime: string; width: number; height: number; durationMs: number | null; bytes: number }, alias: string | null) {
    return this.repo.tx(() => {
      // A gw: (HTTP) source is owned by the account itself: the channel proves the session before every extend send
      // (the source file must be in that session's history), so no page identity is read for it.
      const fp = media.museSource?.conversation.startsWith(GW_CONV_PREFIX) ? httpSourceFp(accountId) : this.repo.museIdentity(accountId);
      const source = media.museSource && fp ? this.repo.insertRemoteSource({ provider: "muse", ownerAccountId: accountId, ownerIdentityFp: fp, projectId: null, batchId: null, contentId: "", entityId: null, handle: null, videoUrl: null, originalPrompt: null, config: null, createdAt: this.now(), museSource: media.museSource }) : null;
      const asset = this.repo.insertAsset({ ...stored, jobId: job.id, batchId: job.batchId, kind: job.kind === "video" ? "video" : "image", accountAlias: alias, prompt: job.prompt, createdAt: this.now(), site: "muse", parentAssetId: job.sourceAssetId, chainId: job.chainId, stepIndex: job.stepIndex, remoteSourceId: source?.id ?? null });
      if (source?.museSource) this.repo.setMuseTip(accountId, source.museSource.conversation, asset.id);
      return asset;
    });
  }

  private async runMuseExtend(jobId: string, accountId: string, abort: AbortController, reconcile: boolean, adapter: MuseAdapter): Promise<void> {
    let job = this.repo.getJob(jobId);
    if (!job) return;
    if (!this.verified()["muse.video.extend"]) {
      this.setJob(job, reconcile ? "needs_review" : "failed", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Kéo dài Muse chưa được xác minh trên bản này" });
      return;
    }
    const attempt = this.repo.insertAttempt({ jobId, accountId, proxyId: this.repo.getAccount(accountId)?.proxyId ?? null, phase: reconcile ? "reconcile" : "extend", startedAt: this.now(), path: "ui" });
    let afterSend = reconcile;
    try {
      // Leave "queued" before the first await so the scheduler cannot lease this job again (see runJob).
      if (!reconcile) job = this.setJob(job, "preparing", { accountId, execPath: "ui", startedAt: this.now(), attemptNo: job.attemptNo + 1 });
      if (!adapter.submitExtend || !adapter.observeExtend || !adapter.identity) throw new AdapterError("UI_CHANGED", "Bản này chưa xác minh được hội thoại Muse để kéo dài");
      const sourceId = job.sourceAssetId ? this.repo.assetRemoteSourceId(job.sourceAssetId) : null;
      const source = sourceId ? this.repo.getRemoteSource(sourceId) : null;
      if (!source?.museSource || source.provider !== "muse" || source.ownerAccountId !== accountId) throw new AdapterError("UI_CHANGED", "Mất nguồn hội thoại Muse");
      const rawIdentity = await adapter.identity(abort.signal);
      if (!rawIdentity) throw new AdapterError("PRE_SUBMIT_TRANSIENT", "Chưa xác minh được danh tính Muse");
      const identity = this.identityFp(rawIdentity);
      this.repo.setMuseIdentity(accountId, identity);
      if (identity !== source.ownerIdentityFp) throw new AdapterError("CHECKPOINT", "Phiên Muse đã đổi tài khoản");
      let checkpoint = this.repo.museCheckpoint(jobId);
      const save = (c: import("../shared/museExtend").MuseCheckpoint) => this.repo.setMuseCheckpoint(jobId, c);
      if (!reconcile) {
        checkpoint = await adapter.submitExtend(source.museSource, job.extendMode ?? "auto", job.directive, {
          signal: abort.signal, onCheckpoint: save,
          onBeforeSend: (ref) => {
            throwIfAborted(abort.signal);
            afterSend = true;
            this.repo.markMuseUnresolved(accountId, source.museSource?.conversation ?? "", jobId);
            job = this.setJob(jobId, "submitting", { submitIntentAt: this.now(), remoteRef: ref ?? null });
          },
        });
        job = this.setJob(jobId, "submitted", { acceptedAt: this.now() });
      }
      if (!checkpoint) throw new AdapterError("AMBIGUOUS_SUBMIT", "Mất dấu lời nhắn Muse", { afterSend: true });
      if (job.state === "submitting") job = this.setJob(jobId, "submitted");
      if (job.state === "submitted") job = this.setJob(jobId, "generating");
      const result = await adapter.observeExtend(checkpoint, { signal: abort.signal, timeoutMs: MUSE_EXTEND_TIMEOUT_MS, onCheckpoint: save });
      if (result.media.length !== 1 || !result.media[0]?.museSource) throw new AdapterError("AMBIGUOUS_SUBMIT", "Không xác định được video tích luỹ", { afterSend: true });
      await this.downloadAll(jobId, accountId, adapter, result.media, abort.signal);
      this.repo.endAttempt(attempt, { endedAt: this.now(), outcome: "completed" });
    } catch (e) {
      this.handleRunError(jobId, accountId, abort.signal.aborted ? new AbortedError() : e, afterSend, attempt);
    }
  }

  // ======================================================== Vibes jobs (spec rev 6 R43–R49)
  private async runVibesJob(jobId: string, accountId: string, abort: AbortController, reconcile: boolean): Promise<void> {
    let job = this.repo.getJob(jobId);
    if (!job) return;
    const acc = this.repo.getAccount(accountId);
    if (!acc) return;
    if (!this.d.vibesFor) {
      this.setJob(job, job.state === "queued" || job.state === "preparing" ? "failed" : "needs_review", { errorClass: "UNKNOWN", errorMessage: "Bản này chưa chạy được Vibes" });
      return;
    }
    if (acc.state === "ready") this.setAccount(accountId, { state: "busy" });
    else this.emitAccount(accountId);
    const adapter = this.d.vibesFor(accountId);
    let afterSend = reconcile;
    const attemptId = this.repo.insertAttempt({ jobId, accountId, proxyId: acc.proxyId, phase: reconcile ? "reconcile" : job.operation === "extend" ? "extend" : "generate", startedAt: this.now(), path: "ui" });
    try {
      if (!reconcile) {
        job = this.setJob(job, "preparing", { accountId, startedAt: this.now(), attemptNo: job.attemptNo + 1, errorClass: null, errorMessage: null, stateUntil: null });
        // R42: the Vibes session is checked before every Vibes job, from this account's own page. A successful check
        // of the last few seconds (switching Vibes on, the login flow) is that check — never two requests in a row.
        const fresh = this.vibesReadyCheck.get(accountId);
        const recent = fresh !== undefined && this.now() - fresh < VIBES_CHECK_FRESH_MS && acc.vibes.status === "ready";
        const seen = recent ? "ready" : this.applyAuthMe(accountId, await adapter.checkSession(abort.signal));
        throwIfAborted(abort.signal);
        if (seen !== "ready") {
          const v = this.repo.getAccount(accountId)!.vibes;
          if (v.status === "identity_changed") {
            this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "held", note: HOLD_IDENTITY });
            this.setJob(jobId, "held", { accountId: null, errorMessage: HOLD_IDENTITY });
            return;
          }
          throw new AdapterError(seen === "transient" ? "PRE_SUBMIT_TRANSIENT" : v.status === "checkpoint" ? "CHECKPOINT" : "SESSION_EXPIRED", v.note ?? "Vibes chưa sẵn sàng");
        }
        const spec = this.vibesSpec(job, accountId);
        const r = await adapter.submit(spec, {
          signal: abort.signal,
          onBeforeSend: (batchId?: string) => {
            throwIfAborted(abort.signal); // cancelled / held / taken over while preparing → never send
            afterSend = true;
            const t = this.now();
            job = this.setJob(jobId, "submitting", { submitIntentAt: t, remoteRef: batchId ?? null });
            this.repo.updateVibes(accountId, { lastSubmitAt: t });
          },
        });
        throwIfAborted(abort.signal);
        if (r.projectId) this.repo.updateVibes(accountId, { projectId: r.projectId });
        job = this.setJob(jobId, "submitted", { remoteRef: r.remoteRef ?? job.remoteRef, acceptedAt: r.acceptedAt });
      } else if (job.state === "submitting") {
        // R48: intent written, acceptance unknown → read exactly this batch on this account's Vibes page.
        this.reconcileDone.add(jobId);
        if (!job.remoteRef) {
          this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "not_found", errorClass: "AMBIGUOUS_SUBMIT", note: "Không có mã lượt Vibes" });
          this.setJob(jobId, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Không xác minh được Vibes đã nhận lượt này" });
          return;
        }
        job = this.setJob(jobId, "submitted", { acceptedAt: job.acceptedAt ?? this.now() });
      }
      if (job.state === "submitted") job = this.setJob(jobId, "generating");
      if (!(job.state === "generating" || job.state === "downloading" || job.state === "download_retry")) return;
      const result = await adapter.observe(job.remoteRef!, { signal: abort.signal, timeoutMs: VIDEO_TIMEOUT_MS });
      throwIfAborted(abort.signal);
      const wanted = result.media.filter((m) => m.kind === "video");
      if (wanted.length === 0) {
        const msg = "Vibes không trả về video nào";
        this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "no_media", errorClass: "UNKNOWN", note: msg });
        this.setJob(jobId, "failed", { errorClass: "UNKNOWN", errorMessage: msg });
        return;
      }
      this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: "generated" });
      await this.downloadAll(jobId, accountId, adapter, wanted, abort.signal);
      if (this.repo.getAccount(accountId)) this.setAccount(accountId, { lastActiveAt: this.now() });
    } catch (e) {
      this.handleRunError(jobId, accountId, abort.signal.aborted ? new AbortedError() : e, afterSend, attemptId);
    }
  }

  /** What the Vibes adapter needs for one job; the source's remote ids come from the store (R46: never a previous handle). */
  private vibesSpec(job: JobRow, accountId: string) {
    const priv = this.repo.vibesPrivate(accountId);
    let source = null;
    if (job.operation === "extend") {
      const rsId = job.sourceAssetId ? this.repo.assetRemoteSourceId(job.sourceAssetId) : null;
      const rs = rsId ? this.repo.getRemoteSource(rsId) : null;
      if (!rs || rs.status !== "ok") throw new AdapterError("UNKNOWN", "Không còn video nguồn để kéo dài", { definitive: true });
      if (rs.ownerAccountId !== accountId) throw new AdapterError("UNKNOWN", "Video nguồn thuộc tài khoản khác", { definitive: true });
      if (rs.ownerIdentityFp !== priv.identityFp) {
        throw new AdapterError("UNKNOWN", `Phiên Vibes của ${this.repo.getAccount(accountId)?.alias ?? "tài khoản"} đã đổi tài khoản`, { definitive: true });
      }
      source = { projectId: rs.projectId, batchId: rs.batchId ?? "", contentId: rs.contentId, entityId: rs.entityId, handle: rs.handle, videoUrl: rs.videoUrl, originalPrompt: rs.originalPrompt, config: rs.config };
    }
    const ref = job.referenceIds[0] ? this.repo.getRef(job.referenceIds[0]) : null;
    return {
      jobId: job.id,
      operation: job.operation,
      prompt: job.operation === "extend" ? (source?.originalPrompt || job.prompt) : job.prompt,
      mode: job.mode,
      referencePath: ref?.path ?? null,
      extendMode: job.extendMode,
      directive: job.extendMode === "directive" ? job.directive : null,
      source,
      projectId: priv.projectId,
    };
  }

  /** R44/R49 — asset + its RemoteSource in one transaction, with lineage. */
  private insertVibesAsset(job: JobRow, accountId: string, media: MediaRef, stored: { path: string; sha256: string; mime: string; width: number; height: number; durationMs: number | null; bytes: number }, alias: string | null) {
    const fp = this.repo.vibesPrivate(accountId).identityFp;
    return this.repo.tx(() => {
      const rs =
        media.remote && fp
          ? this.repo.insertRemoteSource({
              provider: "vibes",
              ownerAccountId: accountId,
              ownerIdentityFp: fp,
              projectId: media.remote.projectId,
              batchId: media.remote.batchId,
              contentId: media.remote.contentId,
              entityId: media.remote.entityId,
              handle: media.remote.handle,
              videoUrl: media.remote.videoUrl,
              originalPrompt: media.remote.originalPrompt,
              config: media.remote.config,
              createdAt: this.now(),
            })
          : null;
      return this.repo.insertAsset({
        jobId: job.id,
        batchId: job.batchId,
        path: stored.path,
        sha256: stored.sha256,
        kind: "video",
        mime: stored.mime,
        width: stored.width,
        height: stored.height,
        durationMs: stored.durationMs,
        bytes: stored.bytes,
        accountAlias: alias,
        prompt: job.prompt,
        createdAt: this.now(),
        site: "vibes",
        parentAssetId: job.sourceAssetId,
        chainId: job.chainId,
        stepIndex: job.stepIndex,
        remoteSourceId: rs?.id ?? null,
      });
    });
  }

  /** Session result of GET /api/auth/me → Vibes state + identity (R42). */
  private applyAuthMe(id: string, r: AuthMeResponse): "ready" | "not_ready" | "transient" {
    const acc = this.repo.getAccount(id);
    if (!acc) return "transient";
    const priv = this.repo.vibesPrivate(id);
    const out = classifyAuthMe(r, !!priv.identityFp);
    const now = this.now();
    if (out.kind === "transient") {
      this.repo.updateVibes(id, { note: out.note, checkedAt: now });
      this.emitAccount(id);
      return "transient";
    }
    this.vibesReadyCheck.delete(id);
    if (out.kind === "state") {
      // AC-VIB-15: “not logged in” says nothing new about an account Vibes refused; only a working session lifts it.
      if (acc.vibes.status === "restricted" && (out.status === "logged_out" || out.status === "needs_login")) {
        this.repo.updateVibes(id, { checkedAt: now });
        this.emitAccount(id);
        return "not_ready";
      }
      this.setVibes(id, { status: out.status, note: out.note, statusUntil: null, checkedAt: now });
      return "not_ready";
    }
    const fp = this.identityFp(out.userId);
    const masked = maskName(out.username) ?? "tài khoản Vibes";
    if (!priv.identityFp || priv.identityFp === fp) {
      const wasChanged = acc.vibes.status === "identity_changed";
      const timed = (acc.vibes.status === "limit_reached" || acc.vibes.status === "cooling_down") && acc.vibes.statusUntil !== null && acc.vibes.statusUntil > now;
      this.setVibes(id, {
        ...(timed ? {} : { status: "ready" as const, statusUntil: null }),
        identityFp: fp,
        identityMasked: masked,
        pendingFp: null,
        pendingIdentityMasked: null,
        note: timed ? acc.vibes.note : null,
        checkedAt: now,
      });
      if (wasChanged) this.releaseVibesJobs(id);
      if (timed) this.vibesReadyCheck.delete(id);
      else this.vibesReadyCheck.set(id, now);
      return timed ? "not_ready" : "ready";
    }
    // R42: another Vibes account is logged in in this profile.
    this.setVibes(id, { status: "identity_changed", pendingFp: fp, pendingIdentityMasked: masked, note: "Phiên Vibes đã đổi sang tài khoản khác", checkedAt: now });
    this.holdVibesJobs(id, HOLD_IDENTITY);
    return "not_ready";
  }

  private identityFp(userId: string): string {
    let salt = this.repo.getMeta("vibes_salt");
    if (!salt) {
      salt = randomBytes(16).toString("hex");
      this.repo.setMeta("vibes_salt", salt);
    }
    return createHash("sha256").update(salt + userId).digest("hex").slice(0, 12);
  }

  /** R39/R42 — Vibes work of this account waits as `held` with the reason. */
  private holdVibesJobs(id: string, msg: string): void {
    for (const j of this.repo.jobsInStates(["queued", "retry_wait"])) {
      if (j.site === "vibes" && (j.boundAccountId === id || j.accountPref === id)) this.setJob(j, "held", { stateUntil: null, accountId: null, errorMessage: msg });
    }
  }

  private releaseVibesJobs(id: string): void {
    for (const j of this.repo.jobsInStates(["held"])) {
      if (j.site === "vibes" && !j.batchId && (j.boundAccountId === id || j.accountPref === id) && (j.errorMessage === HOLD_OFF || j.errorMessage === HOLD_IDENTITY)) {
        this.setJob(j, "queued", { errorMessage: null });
      }
    }
    this.requestSchedule();
  }

  // ======================================================== extend chains (R46–R47)
  private insertChainJob(chain: ChainRow, sourceAssetId: string, stepIndex: number): JobRow {
    const root = this.repo.getAsset(chain.rootAssetId);
    return this.repo.insertJob({
      batchId: null,
      kind: "video",
      mode: "text",
      prompt: root?.prompt || "Kéo dài video",
      referenceIds: [],
      accountPref: chain.accountId ?? "auto",
      state: "queued",
      priority: chain.priority,
      clientRequestId: null,
      apiKeyId: chain.apiKeyId,
      site: chain.site,
      operation: "extend",
      boundAccountId: chain.accountId,
      sourceAssetId,
      chainId: chain.id,
      stepIndex,
      extendMode: chain.mode,
      directive: chain.directive,
      now: this.now(),
    });
  }

  /** “Hoàn tất lần k + RemoteSource + tạo lần k+1” in one transaction (R46); the unique (chain, step) index forbids a second successor. */
  private completeChainStep(jobId: string): void {
    let next: JobRow | null = null;
    const job = this.repo.getJob(jobId)!;
    this.repo.tx(() => {
      const done = this.setJob(job, "completed", { errorClass: null, errorMessage: null, completedAt: this.now() });
      next = this.advanceChain(done);
    });
    if (next) this.emitJob(next);
    this.emitCounts();
    if (job.chainId) {
      this.emitChain(job.chainId);
      this.notifyChainEnd(job.chainId);
    }
    this.requestSchedule();
  }

  private advanceChain(job: JobRow): JobRow | null {
    const chain = job.chainId ? this.repo.getChain(job.chainId) : null;
    if (!chain) return null;
    const outputs = this.repo.assetsForJob(job.id).filter((a) => a.kind === "video");
    const out = outputs.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0] ?? null;
    const source = job.sourceAssetId ? this.repo.getAsset(job.sourceAssetId) : null;
    const stepsDone = chain.stepsDone + 1;
    const base = { stepsDone, lastAssetId: out?.id ?? chain.lastAssetId, lastDurationMs: out?.durationMs ?? chain.lastDurationMs };
    const now = this.now();
    if (chain.status === "cancelled" || chain.status === "stopped") {
      this.repo.updateChain(chain.id, base, now);
      return null;
    }
    if (looksLikeSegment(source?.durationMs ?? null, out?.durationMs ?? null)) {
      // R49: a shorter output is an appended segment, never a longer video → stop, never join segments silently.
      this.repo.updateChain(chain.id, { ...base, status: chain.site === "muse" ? "needs_review" : "stopped", reason: `${chain.site === "muse" ? "Muse" : "Vibes"} trả về đoạn nối thêm — chưa kéo dài tiếp được` }, now);
      return null;
    }
    const d = (chain.site === "muse" ? nextMuseChainStep : nextChainStep)({ plan: chain.plan, maxSteps: chain.maxSteps, stepsDone, sourceMs: source?.durationMs ?? null, outputMs: out?.durationMs ?? null });
    if (d.action === "continue" && out) {
      this.repo.updateChain(chain.id, { ...base, status: "running", reason: null }, now);
      return this.insertChainJob(chain, out.id, (job.stepIndex ?? stepsDone) + 1);
    }
    const reason = d.action === "continue" ? "Vibes không kéo dài thêm" : d.reason;
    this.repo.updateChain(chain.id, { ...base, status: d.action === "complete" ? "completed" : "stopped", reason }, now);
    if (chain.site === "muse") this.repo.releaseMuseConversation(chain.id);
    return null;
  }

  /** Chain reaction to a step that failed, needs review or was cancelled/resolved (R47). */
  private onChainJobChanged(job: JobRow, from: JobState): void {
    const chain = job.chainId ? this.repo.getChain(job.chainId) : null;
    if (!chain) return;
    const k = job.stepIndex ?? chain.stepsDone + 1;
    const live = chain.status === "running" || chain.status === "waiting";
    const now = this.now();
    // R57/R59: a Muse step that failed (Muse answered without a file) or that the user cancelled/dismissed no longer
    // holds the conversation as unresolved. A late file Muse might still post makes the old head fail its head check
    // before any next send, so nothing is ever attributed blindly.
    if (chain.site === "muse" && (job.state === "failed" || job.state === "cancelled")) this.repo.clearMuseUnresolved(job.id);
    if (job.state === "failed" && live) {
      this.repo.updateChain(chain.id, { status: "stopped", reason: `Lần ${k} lỗi: ${job.errorMessage || (job.errorClass ? ERROR_LABEL[job.errorClass] : "lỗi không xác định")}` }, now);
      this.notifyChainEnd(chain.id);
    } else if (job.state === "needs_review" && live) {
      this.repo.updateChain(chain.id, { status: "needs_review", reason: `Lần ${k} cần anh xem` }, now);
      this.notifyChainEnd(chain.id);
    } else if (job.state === "cancelled" && (live || chain.status === "needs_review")) {
      this.repo.updateChain(chain.id, { status: "stopped", reason: from === "needs_review" ? `Đã bỏ lần ${k}` : `Lần ${k} đã huỷ` }, now);
    } else if ((job.state === "queued" || job.state === "downloading") && from === "needs_review" && chain.status === "needs_review") {
      this.repo.updateChain(chain.id, { status: "running", reason: null }, now);
    } else if (job.state === "completed") {
      return; // handled by completeChainStep inside its transaction
    }
    if (chain.site === "muse" && ["stopped", "cancelled"].includes(this.repo.getChain(chain.id)?.status ?? "")) this.repo.releaseMuseConversation(chain.id);
    this.emitChain(chain.id);
  }

  /** R47 waiting is derived: a running chain whose next step cannot start shows “Đang chờ {lý do}”. */
  chainView(row: ChainRow): ExtendChain {
    const { priority: _p, clientRequestId: _c, apiFingerprint: _f, ...view } = row;
    if (row.status === "running" && row.currentJobId) {
      const j = this.repo.getJob(row.currentJobId);
      if (j && (j.state === "queued" || j.state === "held")) {
        const acc = row.accountId ? this.repo.getAccount(row.accountId) : null;
        const reason = acc ? row.site === "muse" ? museWaitReason(acc) : vibesWaitReason(acc, formatTime) : null;
        if (reason) return { ...view, status: "waiting", reason: `Đang chờ ${reason}` };
      }
    }
    return view;
  }

  private emitChain(id: string): void {
    const c = this.repo.getChain(id);
    if (c) this.d.emit("chain", this.chainView(c));
  }

  private emitChainsFor(accountId: string): void {
    for (const c of this.repo.chainsForAccount(accountId, ["running", "needs_review"])) this.d.emit("chain", this.chainView(c));
  }

  /** AC-EXT-23 — one notification when a chain stops by itself (never per step, never for the user's own Dừng chuỗi). */
  private notifyChainEnd(id: string): void {
    const c = this.repo.getChain(id);
    if (!c || !["completed", "stopped", "needs_review"].includes(c.status)) return;
    const key = `${id}:${c.status}:${c.stepsDone}`;
    if (this.chainNotified.has(key)) return;
    this.chainNotified.add(key);
    const route = `/queue/chain/${id}`;
    if (c.status === "completed") this.d.notify({ kind: "chain_done", title: `Chuỗi kéo dài xong · ${formatSeconds(c.lastDurationMs)}`, body: c.reason ?? "", route });
    else if (c.status === "stopped") this.d.notify({ kind: "chain", title: `Chuỗi kéo dài dừng: ${c.reason ?? ""}`, body: c.lastDurationMs ? `Bản dài nhất ${formatSeconds(c.lastDurationMs)}` : "", route });
    else this.d.notify({ kind: "chain", title: "Chuỗi kéo dài cần anh xem", body: c.reason ?? "", route });
  }

  /** Kéo dài (F16): validates in the main process (R45 — the UI is not a security boundary), then queues step 1. */
  startExtend(input: {
    assetId: string;
    mode: ExtendMode;
    directive?: string | null;
    plan: ChainPlan;
    clientRequestId: string;
    api?: { keyId: string; fingerprint: string };
  }): { chain: ExtendChain; jobIds: string[]; replayed: boolean } {
    const existing = this.repo.chainByClientRequest(input.clientRequestId);
    if (existing) return { chain: this.chainView(existing), jobIds: this.repo.jobsForChain(existing.id).map((j) => j.id), replayed: true };
    const asset = this.repo.getAsset(input.assetId);
    if (!asset) throw new CommandError("Không còn tác phẩm này", "not_found");
    if (asset.site === "vibes" && !this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "not_extendable");
    const owner = asset.sourceOwnerId ? this.repo.getAccount(asset.sourceOwnerId) : null;
    const info = asset.site === "muse" ? museExtendEligibility(asset, owner, !!this.verified()["muse.video.extend"]) : extendEligibility(asset, owner, !!this.verified()["vibes.video.extend"], formatTime);
    if (!info) throw new CommandError("Chỉ kéo dài được video", "not_extendable");
    if (!info.ok) throw new CommandError(info.reason ?? "Không kéo dài được video này", "not_extendable");
    const maxSteps = asset.site === "muse" ? MUSE_EXTEND_MAX_STEPS : this.settings().extendMaxSteps;
    const err = asset.site === "muse" ? validateMuseExtend({ mode: input.mode, directive: input.directive, plan: input.plan }, maxSteps, asset.durationMs) : validateExtend({ mode: input.mode, directive: input.directive, plan: input.plan }, maxSteps);
    if (err) throw new CommandError(err);
    const directive = input.mode === "directive" ? normaliseDirective(input.directive) : null;
    if (!owner) throw new CommandError("Tài khoản tạo video này đã bị xoá", "not_extendable");
    const sourceId = this.repo.assetRemoteSourceId(asset.id);
    const museSource = sourceId ? this.repo.getRemoteSource(sourceId)?.museSource : null;
    if (asset.site === "muse" && museSource) {
      // Each step runs on the path that made the video (pathCapability extendSource): refuse now rather than queue a
      // chain the owner account's mode can never run.
      const via = museSource.conversation.startsWith(GW_CONV_PREFIX) ? "http" : "ui";
      const httpOn = this.extendHttpOn();
      const why = museExtendPathReason(via, httpOn ? owner.execMode : "ui", httpOn);
      if (why) throw new CommandError(why, "capability");
    }
    const { chain, job } = this.repo.tx(() => {
      if (asset.site === "muse") {
        if (!museSource) throw new CommandError("Video này chưa có nguồn hội thoại Muse — video tạo trước bản này hoặc một lượt Muse trả nhiều video; tạo video mới để kéo dài", "not_extendable");
        const branch = this.repo.museConversation(owner.id, museSource.conversation);
        if (!branch || branch.tip !== asset.id) throw new CommandError("Video nguồn không còn là đầu nhánh đã xác nhận", "not_extendable");
        if (branch.chain || branch.unresolved) throw new CommandError("Hội thoại này đang có chuỗi kéo dài chưa giải quyết", "conversation_busy");
      }
      const c = this.repo.insertChain({
        site: asset.site,
        accountId: owner.id,
        rootAssetId: asset.id,
        mode: input.mode,
        directive,
        plan: input.plan,
        maxSteps,
        priority: input.api ? PRIORITY_BATCH : PRIORITY_STANDALONE,
        apiKeyId: input.api?.keyId ?? null,
        clientRequestId: input.clientRequestId,
        apiFingerprint: input.api?.fingerprint ?? null,
        now: this.now(),
      });
      if (museSource && asset.site === "muse" && !this.repo.reserveMuseConversation(owner.id, museSource.conversation, c.id)) throw new CommandError("Hội thoại đang bận", "conversation_busy");
      return { chain: c, job: this.insertChainJob(c, asset.id, 1) };
    });
    this.emitJob(job);
    this.emitCounts();
    this.emitChain(chain.id);
    this.requestSchedule();
    return { chain: this.chainView(this.repo.getChain(chain.id)!), jobIds: [job.id], replayed: false };
  }

  /** Dừng chuỗi (R47): the running step follows R9, no further step is created. */
  cancelChain(id: string): ExtendChain {
    const c = this.mustChain(id);
    if (c.status === "completed" || c.status === "stopped" || c.status === "cancelled") throw new CommandError("Chuỗi đã dừng", "state");
    this.repo.updateChain(id, { status: "cancelled", reason: "Anh đã dừng chuỗi" }, this.now());
    const cur = c.currentJobId ? this.repo.getJob(c.currentJobId) : null;
    if (cur && ["queued", "held", "retry_wait", "preparing", "submitted", "generating", "needs_review"].includes(cur.state)) this.cancelJob(cur.id);
    if (c.site === "muse") this.repo.releaseMuseConversation(id);
    this.emitChain(id);
    return this.chainView(this.repo.getChain(id)!);
  }

  /** Tiếp tục chuỗi (R47): from the longest finished output, only the remaining steps, still capped by the maximum. */
  continueChain(id: string): ExtendChain {
    const c = this.mustChain(id);
    if (c.site === "vibes" && !this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "not_extendable");
    if (!["stopped", "cancelled", "needs_review"].includes(c.status)) throw new CommandError("Chuỗi đang chạy hoặc đã xong", "state");
    if (c.currentJobId) throw new CommandError("Lần trước của chuỗi còn chưa xong — xử lý lần đó trước", "state");
    const left = remainingSteps(c.plan, c.stepsDone, c.maxSteps);
    if (left <= 0) throw new CommandError("Chuỗi đã đủ số lần", "state");
    const sourceId = c.lastAssetId ?? c.rootAssetId;
    const asset = this.repo.getAsset(sourceId);
    if (!asset) throw new CommandError("Không còn video nguồn", "not_found");
    const owner = asset.sourceOwnerId ? this.repo.getAccount(asset.sourceOwnerId) : null;
    const info = asset.site === "muse" ? museExtendEligibility(asset, owner, !!this.verified()["muse.video.extend"]) : extendEligibility(asset, owner, !!this.verified()["vibes.video.extend"], formatTime);
    if (!info?.ok) throw new CommandError(info?.reason ?? "Không kéo dài được video này", "not_extendable");
    const nextIndex = Math.max(0, ...this.repo.jobsForChain(id).map((j) => j.stepIndex ?? 0)) + 1;
    const job = this.repo.tx(() => {
      if (c.site === "muse" && owner) {
        const sourceId = this.repo.assetRemoteSourceId(asset.id);
        const source = sourceId ? this.repo.getRemoteSource(sourceId)?.museSource : null;
        if (!source || this.repo.museConversation(owner.id, source.conversation)?.tip !== asset.id || !this.repo.reserveMuseConversation(owner.id, source.conversation, id)) throw new CommandError("Hội thoại chưa được đối soát hoặc đang bận", "conversation_busy");
      }
      this.repo.updateChain(id, { status: "running", reason: null }, this.now());
      return this.insertChainJob(this.repo.getChain(id)!, sourceId, nextIndex);
    });
    this.emitJob(job);
    this.emitCounts();
    this.emitChain(id);
    this.requestSchedule();
    return this.chainView(this.repo.getChain(id)!);
  }

  chainDetail(id: string): { chain: ExtendChain; steps: ChainStep[]; root: ReturnType<Repo["getAsset"]> } {
    const c = this.mustChain(id);
    const steps: ChainStep[] = this.repo.jobsForChain(id).map((j) => {
      const out = this.repo.assetsForJob(j.id).filter((a) => a.kind === "video").sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0] ?? null;
      return { step: j.stepIndex ?? 0, jobId: j.id, state: j.state, assetId: out?.id ?? null, durationMs: out?.durationMs ?? null, at: j.completedAt ?? j.createdAt };
    });
    return { chain: this.chainView(c), steps, root: this.repo.getAsset(c.rootAssetId) };
  }

  listChains(): ExtendChain[] {
    return this.repo.listChains().slice(0, 200).map((c) => this.chainView(c));
  }

  private mustChain(id: string): ChainRow {
    const c = this.repo.getChain(id);
    if (!c) throw new CommandError("Không còn chuỗi này", "not_found");
    return c;
  }

  private handleRunError(jobId: string, accountId: string, e: unknown, afterSend: boolean, attemptId: string): void {
    const job = this.repo.getJob(jobId);
    if (!job) return;
    const cls: ErrorClass | "ABORT" = e instanceof AdapterError ? e.cls : e instanceof AbortedError ? "ABORT" : "UNKNOWN";
    const message = e instanceof AdapterError ? redact(e.message) : redact(e);
    const notStarted = e instanceof AdapterError && !!e.detail.notStarted;
    const sent = (afterSend || (e instanceof AdapterError && !!e.detail.afterSend)) && !notStarted;
    this.repo.endAttempt(attemptId, { endedAt: this.now(), outcome: cls === "ABORT" ? "aborted" : "error", errorClass: cls === "ABORT" ? null : cls, note: message });
    this.d.log(cls === "ABORT" ? "info" : "warn", "job", "run ended with error", { jobId, accountId, cls, sent, message });
    if (job.state === "cancelled" || TERMINAL.has(job.state)) return;
    if (cls === "ABORT") {
      // Aborts come from cancel / batch pause / takeover / account removal; those paths set the final state themselves.
      // Only a job still mid-preparation (quit, removal) goes back to the queue; held/queued stay as set.
      if (job.state === "preparing") this.setJob(job, "queued", { accountId: null, execPath: null });
      return;
    }
    const definitive = e instanceof AdapterError && !!e.detail.definitive;
    // Build 2.0 R90 — Muse reported unusual activity: pause the account, stop all of its traffic, never switch paths.
    if (cls === "ANOMALY_REPORTED") {
      // Muse refused this very send: the job never started and waits for another account (R7); then pause the account.
      const cur = this.repo.getJob(jobId);
      if (cur && !sent && (cur.state === "preparing" || cur.state === "submitting")) {
        this.setJob(cur, "queued", { accountId: null, execPath: null, remoteSessionId: null, baselineUserMsgs: null, submitIntentAt: null, errorClass: cls, errorMessage: ERROR_LABEL[cls] });
      }
      this.pauseForAnomaly(accountId, message);
      return;
    }
    // Build 2.0 R89 — a technical failure of the HTTP path before anything left: back to the queue (health counted).
    if (!sent && (cls === "HTTP_CONNECT_FAILED" || cls === "HTTP_STREAM_LOST" || cls === "HTTP_PROTOCOL_MISMATCH" || cls === "HTTP_FETCH_FAILED")) {
      if (job.state === "preparing" || job.state === "submitting") this.setJob(job, "queued", { accountId: null, execPath: null, errorClass: cls, errorMessage: ERROR_LABEL[cls] });
      return;
    }
    // ----- account side effects (rev 6: a Vibes job's session/quota/page errors belong to the Vibes side only, R40)
    const acc = this.repo.getAccount(accountId);
    if (acc && definitive) {
      /* the service itself refused this job: nothing is wrong with the account */
    } else if (acc && job.site === "vibes" && cls !== "PROXY_FAILED") {
      this.applyVibesError(accountId, cls, e, message);
    } else if (acc) {
      if (cls === "SESSION_EXPIRED") this.setAccount(accountId, { state: "needs_login", stateUntil: null, stateNote: message });
      else if (cls === "CHECKPOINT") this.setAccount(accountId, { state: "checkpoint", stateUntil: null, stateNote: message });
      else if (cls === "PROXY_FAILED") {
        this.setAccount(accountId, { state: "proxy_error", stateUntil: null, stateNote: message });
        if (acc.proxyId) this.d.emit("proxy", this.repo.updateProxy(acc.proxyId, { health: "failed", lastError: message }));
      } else if (cls === "QUOTA_LIMIT") {
        const t = onQuotaLimit(this.now(), e instanceof AdapterError ? e.detail.resetAt ?? null : null);
        // R73: remember the source, and read Usage once when this run ends to learn Muse's reset time.
        this.quotaPending.add(accountId);
        this.setAccount(accountId, { ...t, stateNote: `Muse báo hết hạn mức · đến ${formatUntil(t.stateUntil, this.now())}`, quota: { ...(acc.quota ?? { readAt: 0 }), limitFrom: "muse" } });
      } else if (cls === "UNKNOWN") {
        this.applyGenericFailure(accountId);
      } else if (cls === "UI_CHANGED") {
        if (!this.uiChangedKinds.has(job.kind)) {
          this.uiChangedKinds.add(job.kind);
          this.emitEngine();
          this.d.notify({ kind: "ui_changed", title: "Muse vừa đổi giao diện", body: `Tạm dừng các lượt ${job.kind === "image" ? "ảnh" : "video"} chờ bản cập nhật`, route: "/queue" });
        }
      }
    }
    // ----- job outcome
    if (definitive) {
      this.setJob(job, "failed", { errorClass: cls, errorMessage: message || ERROR_LABEL[cls] });
      return;
    }
    if (cls === "CONTENT_REFUSED") {
      this.setJob(job, "failed", { errorClass: cls, errorMessage: message || ERROR_LABEL.CONTENT_REFUSED }); // R6: no retry, no account switch
      return;
    }
    if (sent) {
      if (cls === "QUOTA_LIMIT") return void this.setJob(job, "failed", { errorClass: cls, errorMessage: ERROR_LABEL.QUOTA_LIMIT });
      if ((cls === "SESSION_EXPIRED" || cls === "CHECKPOINT" || cls === "PROXY_FAILED") && (job.remoteRef || job.remoteSessionId)) {
        // R7: wait for the account to come back, then reconcile (job stays in progress; tick() resumes it).
        const what = job.site === "vibes" && cls !== "PROXY_FAILED" ? "Vibes của tài khoản" : ACCOUNT_LABEL[cls === "PROXY_FAILED" ? "proxy_error" : cls === "CHECKPOINT" ? "checkpoint" : "needs_login"].toLowerCase();
        this.repo.updateJob(job.id, { errorMessage: `Chờ ${what} được xử lý rồi đối soát` }, this.now());
        this.emitJob(this.repo.getJob(job.id));
        return;
      }
      // R48: a Vibes trigger whose answer was lost is reconciled once by its batch id before anyone is asked.
      if (job.site === "vibes" && cls === "AMBIGUOUS_SUBMIT" && job.state === "submitting" && job.remoteRef && !this.reconcileDone.has(job.id)) {
        this.repo.updateJob(job.id, { errorMessage: "Đang kiểm lại trên Vibes theo mã lượt" }, this.now());
        this.emitJob(this.repo.getJob(job.id));
        return;
      }
      // Never resubmit blindly after send (R4/R12).
      this.setJob(job, "needs_review", { errorClass: cls === "UNKNOWN" ? "AMBIGUOUS_SUBMIT" : cls, errorMessage: message || ERROR_LABEL[cls] });
      return;
    }
    // Before send: the job itself is fine → hand it back to the queue (R5, R7, AC-ACC-07, AC-JOB-09).
    if (cls === "SESSION_EXPIRED" || cls === "CHECKPOINT" || cls === "PROXY_FAILED" || cls === "QUOTA_LIMIT" || cls === "UI_CHANGED") {
      const clear = notStarted ? { remoteRef: null, submitIntentAt: null, acceptedAt: null, remoteSessionId: null, baselineUserMsgs: null } : {};
      this.repo.releaseConversationTurn(job.id);
      if (job.conversationId) this.repo.reserveConversationTurn(job.conversationId, job.id); // still this job's turn
      this.setJob(job, "queued", { accountId: null, execPath: null, errorClass: cls, errorMessage: ERROR_LABEL[cls], ...clear });
      return;
    }
    const failures = (this.repo.getJob(job.id)?.preSubmitFailures ?? 0) + 1;
    const delay = preSubmitRetryDelay(failures, this.settings().preSubmitRetries);
    if (delay === null) {
      this.setJob(job, "failed", { errorClass: cls, errorMessage: message || ERROR_LABEL[cls], preSubmitFailures: failures });
    } else {
      this.setJob(job, "retry_wait", { accountId: null, execPath: null, stateUntil: this.now() + delay, errorClass: cls, errorMessage: message || ERROR_LABEL[cls], preSubmitFailures: failures });
    }
  }

  /**
   * Build 2.0 R90 — pause, one notification, stop every run of the account (followed turns → needs_review for a later
   * reconcile, unsent → queue), close its channel. Never a path switch.
   */
  private pauseForAnomaly(id: string, message: string): void {
    const cur = this.repo.getAccount(id);
    if (!cur) return;
    const note = "Muse báo hoạt động bất thường";
    if (cur.state !== "paused") {
      this.setAccount(id, { state: "paused", stateUntil: null, stateNote: note }, { silent: true });
      this.d.notify({ kind: "account_paused", title: `${cur.alias} đã tạm dừng`, body: `${note}. Kiểm tài khoản trên Muse rồi cho chạy lại.`, route: `/accounts/${id}` });
      this.d.log("warn", "path", "path.anomaly", { id, message: message.slice(0, 120) });
    }
    for (const r of this.runsOn(id)) {
      const j = this.repo.getJob(r.jobId);
      if (j && PRE_SUBMIT.has(j.state)) this.setJob(j, "queued", { accountId: null, execPath: null });
      else if (j && !TERMINAL.has(j.state) && j.state !== "needs_review") this.setJob(j, "needs_review", { errorClass: "ANOMALY_REPORTED", errorMessage: "Tài khoản tạm dừng vì Muse báo bất thường — đối soát khi anh cho chạy lại" });
      r.abort.abort();
    }
    try {
      this.d.channelFor?.(id).close({ unloadPage: true });
    } catch {
      /* no channel */
    }
  }

  /** R40/R43/R51 — Vibes errors change only the Vibes side (proxy errors stay account-wide). */
  private applyVibesError(accountId: string, cls: ErrorClass, e: unknown, message: string): void {
    const a = this.repo.getAccount(accountId)!;
    const v = a.vibes;
    if (cls === "SESSION_EXPIRED") {
      // A pre-send session check already wrote the exact state (logged_out, restricted …); only a live session expires here.
      if (v.status === "ready" || v.status === "cooling_down" || v.status === "limit_reached") {
        this.setVibes(accountId, { status: v.hasIdentity ? "needs_login" : "logged_out", statusUntil: null, note: message });
      }
    } else if (cls === "CHECKPOINT") {
      if (v.status !== "checkpoint") this.setVibes(accountId, { status: "checkpoint", statusUntil: null, note: message });
    } else if (cls === "QUOTA_LIMIT") {
      const resetAt = e instanceof AdapterError ? (e.detail.resetAt ?? null) : null;
      const now = this.now();
      const until = resetAt && resetAt > now ? resetAt : now + VIBES_LIMIT_DEFAULT_MS;
      this.setVibes(accountId, { status: "limit_reached", statusUntil: until, note: `Hết lượt Vibes đến ${formatTime(until)}` });
    } else if (cls === "UNKNOWN") {
      this.applyVibesFailure(accountId);
    } else if (cls === "UI_CHANGED") {
      if (!this.vibesUiChanged) {
        this.vibesUiChanged = true;
        this.emitEngine();
        this.d.notify({ kind: "ui_changed", title: "Vibes vừa đổi giao diện", body: "Tạm dừng các lượt Vibes chờ bản cập nhật — việc Muse vẫn chạy", route: "/queue" });
      }
    }
  }

  // ======================================================== job commands
  createJobs(input: {
    kind: JobKind;
    mode: JobMode;
    prompt: string;
    referenceIds: string[];
    accountPref: string;
    repeat: number;
    clientRequestId: string;
    /** R25 — jobs from the agent API: same checks, batch priority, remember the key and request fingerprint. */
    api?: { keyId: string; fingerprint: string };
    /** rev 6 — where to generate (default Muse). */
    site?: Site;
  }): string[] {
    const existing = this.repo.jobsByClientRequest(input.clientRequestId);
    if (existing.length) return existing.map((j) => j.id); // AC-GEN-02
    const p = validatePrompt(input.prompt);
    if (!p.ok) throw new CommandError(p.reason);
    if (input.repeat < REPEAT_MIN || input.repeat > REPEAT_MAX) throw new CommandError(`Số lần lặp phải từ ${REPEAT_MIN} đến ${REPEAT_MAX}`);
    const refIds = [...new Set(input.referenceIds)];
    if (input.mode === "reference" && (refIds.length < 1 || refIds.length > REF_MAX_PER_JOB)) throw new CommandError(`Chế độ “Từ ảnh” cần 1–${REF_MAX_PER_JOB} ảnh tham chiếu`);
    if (input.mode === "text" && refIds.length) throw new CommandError("Chế độ “Từ chữ” không dùng ảnh tham chiếu");
    for (const r of refIds) if (!this.repo.getRef(r)) throw new CommandError("Ảnh tham chiếu không còn");
    if (input.accountPref !== "auto" && !this.repo.getAccount(input.accountPref)) throw new CommandError("Tài khoản không còn");
    const site: Site = input.site ?? "muse";
    if (site === "vibes" && !this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "capability");
    if (refIds.some((id) => this.repo.getRef(id)?.mime.startsWith("video/")) && (input.kind !== "video" || site !== "muse")) throw new CommandError("Video tham chiếu chỉ dùng để sửa video trên Muse");
    // Live 01/11: 1 MP4 + up to 3 images delivered; 2 MP4s in one turn were never accepted by Muse.
    if (refIds.filter((id) => this.repo.getRef(id)?.mime.startsWith("video/")).length > 1) throw new CommandError("Mỗi lượt chỉ sửa được 1 video MP4 (có thể kèm nhiều ảnh)");
    if (site === "vibes" && input.kind !== "video") throw new CommandError("Vibes chỉ tạo video", "capability");
    const caps = enabledCapabilities(this.repo.listAccounts(), this.verified());
    if (!caps[capKey(input.kind, input.mode, site)]) {
      throw new CommandError(site === "vibes" ? "Vibes chưa được kiểm trên phiên bản này" : "Chưa hỗ trợ trên phiên bản Muse hiện tại", "capability");
    }
    const ids = this.repo.tx(() =>
      Array.from({ length: input.repeat }, () =>
        this.repo.insertJob({
          batchId: null,
          kind: input.kind,
          mode: input.mode,
          prompt: p.value,
          referenceIds: refIds,
          accountPref: input.accountPref,
          state: "queued",
          priority: input.api ? PRIORITY_BATCH : PRIORITY_STANDALONE,
          clientRequestId: input.clientRequestId,
          apiKeyId: input.api?.keyId ?? null,
          apiFingerprint: input.api?.fingerprint ?? null,
          site,
          now: this.now(),
        }).id,
      ),
    );
    for (const id of ids) this.emitJob(this.repo.getJob(id));
    this.emitCounts();
    this.requestSchedule();
    return ids;
  }

  /**
   * Build 2.0 R81–R85 — one generic “Hỏi đáp” job: prompt verbatim, attachments (R82), optional conversation to
   * continue on its owner account (one unfinished turn per conversation). Replays by client request id first.
   */
  createChatJob(input: {
    prompt: string;
    referenceIds: string[];
    accountPref: string;
    clientRequestId: string;
    conversationId?: string | null;
    api?: { keyId: string; fingerprint: string };
  }): string {
    const existing = this.repo.jobsByClientRequest(input.clientRequestId);
    if (existing.length) return existing[0].id;
    const p = validateChatPrompt(input.prompt);
    if (!p.ok) throw new CommandError(p.error, "validation");
    const refIds = [...new Set(input.referenceIds)];
    if (refIds.length > CHAT_ATTACH_MAX) throw new CommandError(`Tối đa ${CHAT_ATTACH_MAX} tệp đính kèm`, "attachment_limit");
    let total = 0;
    for (const id of refIds) {
      const r = this.repo.getRef(id);
      if (!r) throw new CommandError("Tệp đính kèm không còn", "not_found");
      total += r.bytes;
    }
    if (total > CHAT_ATTACH_TOTAL_MAX) throw new CommandError("Tổng tệp đính kèm vượt 50 MiB", "attachment_limit");
    let accountPref = input.accountPref;
    let bound: string | null = null;
    const convId = input.conversationId ?? null;
    if (convId) {
      const conv = this.repo.museConversationById(convId);
      const meta = this.repo.conversationMeta(convId);
      // Unknown, foreign (another API key's) and media conversations all get the same not_found (desktop/AGENTS.md).
      if (!conv || !meta || meta.kind !== "chat" || (input.api && meta.ownerApiKeyId !== input.api.keyId)) throw new CommandError("Không tìm thấy hội thoại", "not_found");
      if (!conv.conversation.startsWith(GW_CONV_PREFIX)) throw new CommandError("Hội thoại này tạo bằng giao diện — bản này chưa hỏi tiếp được qua kênh trực tiếp", "capability");
      if (accountPref !== "auto" && accountPref !== conv.accountId) throw new CommandError("Hội thoại thuộc tài khoản khác", "conversation_account_mismatch");
      bound = conv.accountId;
      accountPref = conv.accountId;
    } else if (accountPref !== "auto" && !this.repo.getAccount(accountPref)) throw new CommandError("Tài khoản không còn", "not_found");
    const needs = jobNeeds({ kind: "chat", mode: "text", attachments: this.attachmentNeeds(refIds), continues: !!convId });
    const accounts = this.repo.listAccounts().filter((a) => !bound || a.id === bound);
    const modes = accounts.map((a) => (this.d.channelFor ? a.execMode : "ui"));
    if (!accounts.length || !anyPathSupports(needs, modes, !!this.d.channelFor && this.settings().bridgeHttpEnabled)) {
      throw new CommandError("Chưa tài khoản nào chạy được Hỏi đáp với các tệp này (kênh trực tiếp tắt hoặc loại tệp chưa hỗ trợ)", "capability");
    }
    const id = this.repo.tx(() => {
      const job = this.repo.insertJob({
        batchId: null,
        kind: "chat",
        mode: "text",
        prompt: p.value,
        referenceIds: refIds,
        accountPref,
        state: "queued",
        priority: input.api ? PRIORITY_BATCH : PRIORITY_STANDALONE,
        clientRequestId: input.clientRequestId,
        apiKeyId: input.api?.keyId ?? null,
        apiFingerprint: input.api?.fingerprint ?? null,
        site: "muse",
        boundAccountId: bound,
        conversationId: convId,
        now: this.now(),
      });
      if (convId && !this.repo.reserveConversationTurn(convId, job.id)) throw new CommandError("Hội thoại đang có một lượt chưa xong", "conversation_busy");
      return job.id;
    });
    this.emitJob(this.repo.getJob(id));
    this.emitCounts();
    this.requestSchedule();
    return id;
  }

  cancelJob(jobId: string): JobRow {
    const j = this.mustJob(jobId);
    if (["queued", "held", "retry_wait", "preparing"].includes(j.state)) {
      const r = this.running.get(jobId);
      const out = this.setJob(j, "cancelled", { stateUntil: null });
      r?.abort.abort();
      return out;
    }
    if (j.state === "submitted" || j.state === "generating") {
      // R9 — stop waiting locally; Muse may still generate and count quota.
      const r = this.running.get(jobId);
      const out = this.setJob(j, "cancelled", {
        errorMessage: j.site === "vibes" ? "Đã ngừng chờ trên máy — Vibes có thể vẫn tạo và tính lượt" : "Đã ngừng chờ trên máy — Muse có thể vẫn tạo và tính hạn mức",
      });
      r?.abort.abort();
      return out;
    }
    if (j.state === "needs_review") return this.setJob(j, "cancelled", {});
    throw new CommandError(`Không huỷ được lượt ở trạng thái “${JOB_LABEL[j.state]}”`, "state");
  }

  retryJob(jobId: string): JobRow {
    const j = this.mustJob(jobId);
    if (j.state === "failed" && !isRetryableError(j.errorClass)) throw new CommandError("Muse đã từ chối nội dung này — sửa prompt rồi gửi lại", "state");
    if (j.state !== "failed" && j.state !== "cancelled") throw new CommandError(`Không thử lại được lượt ở trạng thái “${JOB_LABEL[j.state]}”`, "state");
    const out = this.setJob(j, "queued", { accountId: null, errorClass: null, errorMessage: null, preSubmitFailures: 0, downloadAttempts: 0, remoteRef: null, submitIntentAt: null, acceptedAt: null, completedAt: null, stateUntil: null });
    this.requestSchedule();
    return out;
  }

  retryNow(jobId: string): JobRow {
    const j = this.mustJob(jobId);
    if (j.state !== "retry_wait") throw new CommandError("Lượt không ở trạng thái chờ thử lại", "state");
    const out = this.setJob(j, "queued", { stateUntil: null });
    this.requestSchedule();
    return out;
  }

  prioritize(jobId: string): JobRow {
    const j = this.mustJob(jobId);
    if (j.state !== "queued") throw new CommandError("Chỉ ưu tiên được lượt đang chờ", "state");
    const out = this.repo.updateJob(jobId, { priority: PRIORITY_BUMPED }, this.now());
    this.emitJob(out);
    this.requestSchedule();
    return out;
  }

  changeAccount(jobId: string, accountPref: string): JobRow {
    const j = this.mustJob(jobId);
    if (j.state !== "queued") throw new CommandError("Chỉ đổi tài khoản cho lượt đang chờ", "state");
    if (j.boundAccountId) throw new CommandError("Lần kéo dài chỉ chạy trên tài khoản sở hữu video nguồn", "state"); // R50
    if (accountPref !== "auto" && !this.repo.getAccount(accountPref)) throw new CommandError("Tài khoản không còn");
    const out = this.repo.updateJob(jobId, { accountPref }, this.now());
    this.emitJob(out);
    this.requestSchedule();
    return out;
  }

  resolveReview(jobId: string, resolution: "import" | "resend" | "dismiss"): JobRow {
    const j = this.mustJob(jobId);
    if (j.state !== "needs_review") throw new CommandError("Lượt không cần xem lại", "state");
    if (resolution === "dismiss") return this.setJob(j, "cancelled", {});
    if (resolution === "resend") {
      const out = this.setJob(j, "queued", { accountId: null, remoteRef: null, submitIntentAt: null, acceptedAt: null, errorClass: null, errorMessage: null, preSubmitFailures: 0, downloadAttempts: 0 });
      this.requestSchedule();
      return out;
    }
    if (!j.remoteRef || !j.accountId) throw new CommandError(j.site === "vibes" ? "Không có mã lượt Vibes để kiểm lại" : "Không có liên kết tới lượt bên Muse để nhập lại", "state");
    const out = this.setJob(j, "downloading", { errorClass: null, errorMessage: null });
    this.requestSchedule();
    return out;
  }

  /** Build 2.0 R85 — one Hỏi đáp conversation by its app handle: turns in order, owner account, whether a turn is open. */
  conversationView(handle: string, apiKeyId?: string | null) {
    const conv = this.repo.museConversationById(handle);
    const meta = this.repo.conversationMeta(handle);
    // Unknown and foreign handles look the same (desktop/AGENTS.md).
    if (!conv || !meta || meta.kind !== "chat" || (apiKeyId !== undefined && apiKeyId !== null && meta.ownerApiKeyId !== apiKeyId)) throw new CommandError("Không tìm thấy hội thoại", "not_found");
    const jobs = this.repo.jobsForConversation(handle);
    return {
      conversationId: handle,
      accountId: conv.accountId,
      accountAlias: this.repo.getAccount(conv.accountId)?.alias ?? null,
      busy: !!meta.busyJobId,
      turns: jobs.map((j) => ({ job: publicJob(j), assets: this.repo.assetsForJob(j.id) })),
    };
  }

  jobDetail(jobId: string) {
    const job = this.mustJob(jobId);
    return { job: publicJob(job), attempts: this.repo.attemptsForJob(jobId), assets: this.repo.assetsForJob(jobId) };
  }

  private mustJob(id: string): JobRow {
    const j = this.repo.getJob(id);
    if (!j) throw new CommandError("Không còn lượt này", "not_found");
    return j;
  }

  // ======================================================== batches
  saveDraft(input: { id?: string | null; name: string; settings: BatchSettings; rows: BatchRow[] }): Batch {
    const name = input.name.trim() || t("Lô {date}", { date: formatDate(this.now()) });
    if (input.id) {
      const b = this.repo.getBatch(input.id);
      if (!b) throw new CommandError("Không còn lô này", "not_found");
      if (b.state !== "draft") throw new CommandError("Chỉ sửa được lô nháp", "state");
      const out = this.repo.updateBatch(input.id, { name, settings: input.settings, rows: input.rows });
      this.d.emit("batch", out);
      return out;
    }
    const out = this.repo.insertBatch({ name, state: "draft", settings: input.settings, rows: input.rows, now: this.now() });
    this.d.emit("batch", out);
    return out;
  }

  /** F4.4 — one transaction creates the batch's jobs. References are imported by the caller beforehand. */
  startBatch(batchId: string, refMap: Map<string, string>): Batch {
    const b = this.repo.getBatch(batchId);
    if (!b) throw new CommandError("Không còn lô này", "not_found");
    if (b.state !== "draft") throw new CommandError("Lô đã bắt đầu", "state");
    const summary = summarize(b.rows);
    if (summary.batchError) throw new CommandError(summary.batchError);
    const valid = b.rows.filter((r) => !r.error);
    if (!valid.length) throw new CommandError("Không có dòng hợp lệ để chạy");
    const caps = enabledCapabilities(this.repo.listAccounts());
    this.repo.tx(() => {
      for (const r of valid) {
        if (!caps[`${r.kind}.${r.mode}` as CapabilityKey]) throw new CommandError(`Dòng ${r.line}: chế độ chưa hỗ trợ`);
        const refId = r.reference ? refMap.get(r.reference) : undefined;
        if (r.mode === "reference" && !refId) throw new CommandError(`Dòng ${r.line}: không đọc được ảnh tham chiếu`);
        for (let k = 0; k < r.repeat; k++) {
          this.repo.insertJob({
            batchId,
            kind: r.kind,
            mode: r.mode,
            prompt: r.prompt,
            referenceIds: refId ? [refId] : [],
            accountPref: b.settings.accountPref || "auto",
            state: "queued",
            priority: PRIORITY_BATCH,
            clientRequestId: null,
            now: this.now(),
          });
        }
      }
      this.repo.updateBatch(batchId, { state: "running" });
    });
    this.emitCounts();
    this.emitBatch(batchId);
    this.requestSchedule();
    return this.repo.getBatch(batchId)!;
  }

  pauseBatch(id: string): Batch {
    const b = this.mustBatch(id);
    if (b.state !== "running") throw new CommandError("Lô không chạy", "state");
    const toAbort: string[] = [];
    this.repo.tx(() => {
      // AC-BAT-03: every unsent job is held, including one still preparing (e.g. uploading its reference image).
      for (const j of this.repo.jobsForBatch(id, ["queued", "retry_wait", "preparing"])) {
        this.repo.updateJob(j.id, { state: "held", stateUntil: null, accountId: null }, this.now());
        if (j.state === "preparing") toAbort.push(j.id);
      }
      this.repo.updateBatch(id, { state: "paused" });
    });
    for (const jid of toAbort) this.running.get(jid)?.abort.abort();
    this.afterBatchBulk(id);
    return this.repo.getBatch(id)!;
  }

  resumeBatch(id: string): Batch {
    const b = this.mustBatch(id);
    if (b.state !== "paused") throw new CommandError("Lô không tạm dừng", "state");
    this.repo.tx(() => {
      for (const j of this.repo.jobsForBatch(id, ["held"])) this.repo.updateJob(j.id, { state: "queued" }, this.now());
      this.repo.updateBatch(id, { state: "running" });
    });
    this.afterBatchBulk(id);
    this.onBatchJobChanged(id); // everything may have finished while paused → done + one batch_done notification now
    this.requestSchedule();
    return this.repo.getBatch(id)!;
  }

  cancelRemaining(id: string): Batch {
    const b = this.mustBatch(id);
    if (b.state !== "running" && b.state !== "paused") throw new CommandError("Lô không còn lượt chờ", "state");
    const toAbort: string[] = [];
    this.repo.tx(() => {
      for (const j of this.repo.jobsForBatch(id, ["queued", "held", "retry_wait", "preparing"])) {
        this.repo.updateJob(j.id, { state: "cancelled", completedAt: this.now(), stateUntil: null }, this.now());
        if (j.state === "preparing") toAbort.push(j.id);
      }
      this.repo.updateBatch(id, { state: "cancelled" });
    });
    for (const jid of toAbort) this.running.get(jid)?.abort.abort();
    this.afterBatchBulk(id);
    this.onBatchJobChanged(id);
    return this.repo.getBatch(id)!;
  }

  retryFailed(id: string): Batch {
    this.mustBatch(id);
    let n = 0;
    this.repo.tx(() => {
      for (const j of this.repo.jobsForBatch(id, ["failed"])) {
        if (!isRetryableError(j.errorClass)) continue; // AC-BAT-04
        this.repo.updateJob(j.id, { state: "queued", accountId: null, errorClass: null, errorMessage: null, preSubmitFailures: 0, downloadAttempts: 0, remoteRef: null, submitIntentAt: null, acceptedAt: null, completedAt: null }, this.now());
        n++;
      }
      if (n) this.repo.updateBatch(id, { state: "running" });
    });
    if (!n) throw new CommandError("Không có lượt lỗi nào thử lại được", "state");
    this.batchDoneNotified.delete(id);
    this.afterBatchBulk(id);
    this.requestSchedule();
    return this.repo.getBatch(id)!;
  }

  deleteDraft(id: string): void {
    const b = this.mustBatch(id);
    if (b.state !== "draft") throw new CommandError("Chỉ xoá được lô nháp", "state");
    this.repo.deleteBatch(id);
    this.d.emit("batch.deleted", { id });
  }

  private afterBatchBulk(id: string): void {
    for (const j of this.repo.jobsForBatch(id)) this.emitJob(j);
    this.emitBatch(id);
    this.emitCounts();
  }

  private mustBatch(id: string): Batch {
    const b = this.repo.getBatch(id);
    if (!b) throw new CommandError("Không còn lô này", "not_found");
    return b;
  }

  // ======================================================== accounts
  addAccount(input: { alias: string; avatar: number; proxyId?: string | null }): Account {
    const accounts = this.repo.listAccounts();
    const v = validateAlias(input.alias, accounts.map((a) => a.alias));
    if (!v.ok) throw new CommandError(v.reason);
    const proxies = this.repo.listProxies();
    // Build 3.2 R143: a proxy another account uses may be chosen on purpose; the automatic pick is only ever an unused one.
    const proxy = input.proxyId ? proxies.find((p) => p.id === input.proxyId) : suggestProxy(proxies, accounts);
    if (!proxy && input.proxyId) throw new CommandError("Không còn proxy này", "not_found");
    if (!proxy) throw new CommandError("Chưa có proxy khoẻ nào trống — nhập proxy trước", "no_proxy");
    if (proxy.health !== "healthy") throw new CommandError("Proxy chưa được kiểm hoặc đang lỗi", "no_proxy");
    const acc = this.repo.insertAccount({ alias: v.value, avatar: input.avatar, proxyId: proxy.id, now: this.now() });
    this.emitAccount(acc.id);
    return this.accountView(acc.id)!;
  }

  renameAccount(id: string, alias: string, avatar?: number): Account {
    const acc = this.mustAccount(id);
    const v = validateAlias(alias, this.repo.listAccounts().map((a) => a.alias), acc.alias);
    if (!v.ok) throw new CommandError(v.reason);
    this.repo.updateAccount(id, { alias: v.value, ...(avatar !== undefined ? { avatar } : {}) });
    this.emitAccount(id);
    return this.accountView(id)!;
  }

  /** Build 2.0 R86/R98 — Cách chạy: mode + caps; applies to sends after this (running jobs keep their path). */
  setExecution(id: string, v: { mode: ExecMode; maxConcurrent: number; uiMaxConcurrent: number }): Account {
    this.mustAccount(id);
    if (!["auto", "http", "ui"].includes(v.mode)) throw new CommandError("Cách chạy không hợp lệ", "validation");
    if (!inRange(v.maxConcurrent, MAX_CONCURRENT_RANGE)) throw new CommandError(`Tối đa việc cùng lúc phải từ ${MAX_CONCURRENT_RANGE.min} đến ${MAX_CONCURRENT_RANGE.max}`, "validation");
    if (!inRange(v.uiMaxConcurrent, UI_MAX_RANGE)) throw new CommandError(`Tối đa qua giao diện phải từ ${UI_MAX_RANGE.min} đến ${UI_MAX_RANGE.max}`, "validation");
    this.setAccount(id, { execMode: v.mode, maxConcurrent: v.maxConcurrent, uiMaxConcurrent: v.uiMaxConcurrent });
    this.d.log("info", "path", "exec.set", { id, mode: v.mode, max: v.maxConcurrent, uiMax: v.uiMaxConcurrent });
    this.requestSchedule();
    return this.accountView(id)!;
  }

  /** R92 — “Thử HTTP ngay”: one read-only probe (repeated within 30 s → ignored). */
  async probeHttp(id: string): Promise<Account> {
    const a = this.mustAccount(id);
    if (!this.d.channelFor) throw new CommandError("Bản này không có kênh trực tiếp", "unavailable");
    if (a.execMode === "ui") throw new CommandError("Tài khoản đang chọn chỉ chạy giao diện", "state");
    if (["needs_login", "checkpoint", "paused", "limit_reached", "proxy_error", "takeover"].includes(a.state)) throw new CommandError(`Không thử khi tài khoản ${ACCOUNT_LABEL[a.state].toLowerCase()}`, "state");
    await this.exec.probe(a, true);
    this.requestSchedule();
    return this.accountView(id)!;
  }

  /** R97 — “Kiểm ngay”: probe every ready auto/http account in turn. */
  async bridgeCheckNow(): Promise<EngineStatus["bridge"]> {
    if (!this.d.channelFor) throw new CommandError("Bản này không có kênh trực tiếp", "unavailable");
    const r = await this.exec.checkNow(this.repo.listAccounts());
    this.requestSchedule();
    return r;
  }

  pauseAccount(id: string): Account {
    this.mustAccount(id);
    return this.setAccount(id, { state: "paused", stateUntil: null });
  }

  resumeAccount(id: string): Account {
    const a = this.mustAccount(id);
    if (a.state !== "paused" && a.state !== "proxy_error" && a.state !== "cooling_down") return this.accountView(id)!;
    this.setAccount(id, { state: "ready", stateUntil: null, failTimes: [] });
    void this.checkSession(id, true);
    return this.accountView(id)!;
  }

  /**
   * R102 — change an account's proxy under an exclusive lock: no new send on either path while it is held; unsent runs
   * go back to the queue at once; turns Muse already has get up to `waitMs` to finish. Past that the caller asks
   * “Dừng chờ” and calls again with `force`: those turns → needs_review, then the change goes through. The direct
   * channel (and its page) is dropped so the next connect goes out through the new proxy.
   */
  async setAccountProxy(id: string, proxyId: string, force = false, waitMs = LEASE_RELEASE_WAIT_MS): Promise<{ changed: boolean; needsForce?: boolean; account: Account }> {
    this.mustAccount(id);
    const p = this.repo.getProxy(proxyId);
    if (!p) throw new CommandError("Không còn proxy này", "not_found");
    // Build 3.2 R143: a proxy other accounts use is accepted (shared on purpose); AC-PRX-02 of Build 1.0 no longer applies.
    const held = this.leases.get(id);
    // A change already asked “Dừng chờ” keeps its lock until the answer (this call) or the hold lapses.
    const resuming = held?.kind === "proxy" && held.until !== undefined;
    if (held && !resuming) throw new CommandError("Tài khoản đang đăng nhập, được điều khiển hoặc đang kiểm — thử lại sau", "busy");
    const lease: Lease = resuming ? held! : { kind: "proxy" };
    lease.until = undefined;
    this.leases.set(id, lease);
    let asking = false;
    try {
      const runs = this.runsOn(id);
      if (runs.length) this.d.log("info", "account", "proxy.wait", { id, runs: runs.length, force });
      const unsent = runs.filter((r) => PRE_SUBMIT.has(this.repo.getJob(r.jobId)?.state ?? "queued"));
      for (const r of unsent) {
        const j = this.repo.getJob(r.jobId);
        if (j && PRE_SUBMIT.has(j.state)) this.setJob(j, "queued", { accountId: null, execPath: null });
        r.abort.abort();
      }
      await Promise.all(unsent.map((r) => r.promise.catch(() => undefined)));
      const sent = runs.filter((r) => !unsent.includes(r));
      if (sent.length && !force) {
        const done = await Promise.race([Promise.all(sent.map((r) => r.promise)).then(() => true), sleep(waitMs).then(() => false)]).catch(() => true);
        if (!done) {
          lease.until = this.now() + PROXY_ASK_HOLD_MS;
          asking = true;
          return { changed: false, needsForce: true, account: this.accountView(id)! };
        }
      } else if (sent.length) {
        for (const r of sent) {
          const j = this.repo.getJob(r.jobId);
          if (j && !TERMINAL.has(j.state) && j.state !== "needs_review") this.setJob(j, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Đã đổi proxy khi lượt đang chạy — mở Muse để xem kết quả" });
          r.abort.abort();
        }
        await Promise.all(sent.map((r) => r.promise.catch(() => undefined)));
      }
      this.applyProxyChange(id, proxyId);
      return { changed: true, account: this.accountView(id)! };
    } finally {
      if (!asking && this.leases.get(id) === lease) this.leases.delete(id);
      this.emitAccount(id);
      this.requestSchedule();
    }
  }

  /** The user closed the “Dừng chờ” question without stopping: the proxy stays, the lock is released. */
  cancelProxyChange(id: string): void {
    const l = this.leases.get(id);
    if (l?.kind !== "proxy" || l.until === undefined) return;
    this.leases.delete(id);
    this.emitAccount(id);
    this.requestSchedule();
  }

  private applyProxyChange(id: string, proxyId: string): void {
    const acc = this.mustAccount(id);
    this.repo.updateAccount(id, { proxyId });
    this.d.ui.applyProxy(id);
    // The direct channel's socket was opened through the old proxy; the next connect rebuilds it on the new one.
    if (acc.proxyId !== proxyId) this.exec.forget(id);
    if (acc.state === "proxy_error") this.setAccount(id, { state: "ready", stateNote: null });
    this.emitAccount(id);
    queueMicrotask(() => void this.checkSession(id, true));
  }

  async checkSession(id: string, quiet = false): Promise<Account> {
    const acc = this.mustAccount(id);
    if (this.leases.has(id) || this.pageRunsOn(id) > 0) return this.accountView(id)!;
    if (!acc.proxyId) {
      if (!quiet) throw new CommandError("Tài khoản chưa có proxy", "no_proxy");
      return this.accountView(id)!;
    }
    const lease: Lease = { kind: "check" };
    this.leases.set(id, lease);
    // R2: login/takeover may take the profile over while a check is in flight; then that flow owns the account state.
    const superseded = () => this.leases.get(id) !== lease;
    try {
      await this.d.adapterFor(id).checkSession();
      if (superseded()) return this.accountView(id)!;
      const cur = this.repo.getAccount(id)!;
      // The check went through this account's proxy, so the proxy works again (also after a manual resume).
      const proxy = cur.proxyId ? this.repo.getProxy(cur.proxyId) : null;
      if (proxy && proxy.health === "failed") this.d.emit("proxy", this.repo.updateProxy(proxy.id, { health: "healthy", lastError: null }));
      if (cur.state === "limit_reached" && cur.stateUntil && cur.stateUntil > this.now()) return this.accountView(id)!;
      if (cur.state !== "paused" && cur.state !== "takeover") this.setAccount(id, { state: "ready", stateUntil: null, stateNote: null });
    } catch (e) {
      if (superseded()) return this.accountView(id)!;
      const cls = e instanceof AdapterError ? e.cls : "UNKNOWN";
      const note = e instanceof AdapterError ? redact(e.message) : redact(e);
      const map: Partial<Record<ErrorClass, AccountState>> = { SESSION_EXPIRED: "needs_login", CHECKPOINT: "checkpoint", PROXY_FAILED: "proxy_error" };
      const st = map[cls];
      // Known causes map to their own state (AC-ACC-04: an expired session is needs_login, never a cooldown);
      // only unexplained failures count toward the generic cooldown/pause rule (R8).
      if (st) this.setAccount(id, { state: st, stateNote: note });
      else this.applyGenericFailure(id);
      // The proxy itself is what failed: show it in Settings → Proxy too (one truth for proxy health).
      if (cls === "PROXY_FAILED") this.d.emit("proxy", this.repo.updateProxy(acc.proxyId, { health: "failed", lastError: note }));
      if (!quiet) this.d.log("warn", "account", "session check failed", { id, cls });
    } finally {
      if (this.leases.get(id) === lease) this.leases.delete(id);
      this.requestSchedule();
    }
    return this.accountView(id)!;
  }

  // ======================================================== Vibes session + two-step login (R41, R42)
  /** Kiểm phiên Vibes (button, after takeover, at start for accounts that were ever ready). Never a background loop. */
  async checkVibes(id: string, quiet = false): Promise<Account> {
    const acc = this.mustAccount(id);
    if (!this.d.vibesFor && !quiet) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "unavailable");
    if (!acc.vibes.enabled) {
      if (!quiet) throw new CommandError("Vibes đang tắt cho tài khoản này", "vibes_off");
      return this.accountView(id)!;
    }
    if (!this.d.vibesFor) return this.accountView(id)!;
    if (!acc.proxyId) {
      if (!quiet) throw new CommandError("Tài khoản chưa có proxy", "no_proxy");
      return this.accountView(id)!;
    }
    if (this.leases.has(id) || this.runsOn(id).some((r) => r.site === "vibes")) {
      if (!quiet) throw new CommandError("Tài khoản đang bận — thử lại khi rảnh", "busy");
      return this.accountView(id)!;
    }
    const lease: Lease = { kind: "check" };
    this.leases.set(id, lease);
    try {
      await this.vibesCheckInner(id, () => this.leases.get(id) !== lease);
    } finally {
      if (this.leases.get(id) === lease) this.leases.delete(id);
      this.requestSchedule();
    }
    return this.accountView(id)!;
  }

  /** One Vibes session check without lease handling (the caller owns the account). */
  private async vibesCheckInner(id: string, superseded: () => boolean): Promise<"ready" | "not_ready" | "transient"> {
    try {
      const r = await this.d.vibesFor!(id).checkSession();
      if (superseded() || !this.repo.getAccount(id)) return "transient";
      return this.applyAuthMe(id, r);
    } catch (e) {
      if (superseded() || !this.repo.getAccount(id)) return "transient";
      const cls = e instanceof AdapterError ? e.cls : "UNKNOWN";
      const note = e instanceof AdapterError ? redact(e.message) : redact(e);
      if (cls === "PROXY_FAILED") {
        // R42: a network failure keeps the Vibes state; the proxy itself is what failed (R1), shown for the whole account.
        const acc = this.repo.getAccount(id)!;
        this.setAccount(id, { state: "proxy_error", stateNote: note });
        if (acc.proxyId) this.d.emit("proxy", this.repo.updateProxy(acc.proxyId, { health: "failed", lastError: note }));
      } else {
        this.repo.updateVibes(id, { note, checkedAt: this.now() });
        this.emitAccount(id);
      }
      return "transient";
    }
  }

  loginState(id: string): LoginProgress | null {
    return this.loginProgress.get(id) ?? null;
  }

  private emitLogin(id: string): void {
    const p = this.loginProgress.get(id);
    if (p) this.d.emit("login", { ...p, steps: p.steps.map((s) => ({ ...s })) });
  }

  /**
   * F2/F14 — login plan Muse → Vibes under ONE lease (R41c): no page is released between the steps, capability probing
   * included, and a late result of an older flow never overwrites a newer one (B36).
   */
  openLogin(id: string, only?: Site): Account {
    const acc = this.mustAccount(id);
    if (!acc.proxyId) throw new CommandError("Tài khoản chưa có proxy", "no_proxy");
    const l = this.leases.get(id);
    if ((l && l.kind !== "check") || this.pageRunsOn(id) > 0) throw new CommandError("Tài khoản đang làm việc", "busy");
    if (only === "vibes" && !acc.vibes.enabled) throw new CommandError("Vibes đang tắt cho tài khoản này — bật lại trong ⋯", "vibes_off");
    if (only === "vibes" && !this.d.vibesFor) throw new CommandError("Bản này chưa chạy được Vibes", "unavailable");
    let plan = loginPlan(acc.state, acc.vibes, only);
    if (!this.d.vibesFor) plan = plan.filter((s) => s !== "vibes");
    if (!plan.length) plan = ["muse"]; // nothing pending: the button still opens Muse (previous behaviour)
    const lease: Lease = { kind: "login" };
    this.leases.set(id, lease);
    const progress: LoginProgress = { accountId: id, steps: plan.map((site) => ({ site, state: "pending" as const })), active: null, done: false };
    this.loginProgress.set(id, progress);
    this.emitLogin(id);
    void this.runLogin(id, lease, progress, only === "vibes");
    return this.accountView(id)!;
  }

  private async runLogin(id: string, lease: Lease, progress: LoginProgress, vibesAsked = false): Promise<void> {
    const owned = () => this.leases.get(id) === lease && !!this.repo.getAccount(id);
    try {
      for (const step of progress.steps) {
        if (!owned() || progress.done) break;
        step.state = "active";
        progress.active = step.site;
        this.emitLogin(id);
        step.state = step.site === "muse" ? await this.loginMuseStep(id, owned) : await this.loginVibesStep(id, owned, vibesAsked);
        this.emitLogin(id);
        // (d) Muse closed/cancelled → the plan ends; a Vibes step that is closed/skipped never undoes Muse.
        if (step.site === "muse" && step.state !== "done" && step.state !== "skipped") break;
      }
    } catch (e) {
      this.d.log("warn", "account", "login flow failed", { id, error: redact(e) });
    } finally {
      for (const s of progress.steps) if (s.state === "pending" || s.state === "active") s.state = "cancelled";
      progress.active = null;
      progress.done = true;
      this.emitLogin(id);
      this.loginProgress.delete(id);
      if (this.leases.get(id) === lease) this.leases.delete(id);
      if (this.repo.getAccount(id)) this.emitAccount(id);
      this.requestSchedule();
    }
  }

  private async waitLogin(id: string, site: Site): Promise<"ok" | "closed" | "timeout" | "restricted"> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.d.loginStepTimeoutMs ?? LOGIN_STEP_TIMEOUT_MS);
    });
    try {
      const r = await Promise.race([this.d.ui.openLogin(id, site).then((ok) => (ok === "restricted" ? ("restricted" as const) : ok ? ("ok" as const) : ("closed" as const))), timeout]);
      if (r === "timeout") this.d.ui.cancelLogin?.(id, site);
      return r;
    } catch {
      return "closed";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async loginMuseStep(id: string, owned: () => boolean): Promise<LoginProgress["steps"][number]["state"]> {
    const prev = this.repo.getAccount(id)!.state;
    const keep = prev === "paused" || prev === "cooling_down" || prev === "limit_reached";
    // (b) silent check first: a live Muse session is ✓ “Đã đăng nhập sẵn” without loading the login page.
    if (prev !== "new") {
      try {
        const caps = await this.d.adapterFor(id).probeCapabilities();
        if (!owned()) return "cancelled";
        this.setAccount(id, keep ? { capabilities: caps } : { state: "ready", stateNote: null, capabilities: caps, failTimes: [] });
        return "skipped";
      } catch {
        if (!owned()) return "cancelled";
      }
    }
    this.setAccount(id, { state: "logging_in", stateUntil: null });
    const r = await this.waitLogin(id, "muse");
    if (!owned()) return "cancelled";
    if (r === "ok") {
      const caps = await this.d.adapterFor(id).probeCapabilities().catch(() => ({}));
      if (!owned()) return "cancelled";
      this.setAccount(id, { state: "ready", stateNote: null, capabilities: caps, failTimes: [] });
      return "done";
    }
    const back = prev === "logging_in" ? "needs_login" : prev;
    this.setAccount(id, { state: back, stateNote: r === "timeout" ? "Bước đăng nhập Muse đã dừng sau 15 phút" : null }, { silent: true });
    return r === "timeout" ? "timeout" : "cancelled";
  }

  private skipRequested = new Set<string>();

  private async loginVibesStep(id: string, owned: () => boolean, asked: boolean): Promise<LoginProgress["steps"][number]["state"]> {
    this.skipRequested.delete(id);
    const pre = await this.vibesCheckInner(id, () => !owned());
    if (!owned()) return "cancelled";
    if (pre === "ready") return "skipped";
    const cur = this.repo.getAccount(id)!.vibes;
    // No login loop for an account Vibes does not serve (R42) — unless the user asked to try again (AC-VIB-15).
    if (cur.status === "restricted" && !asked) return "failed";
    const prevStatus = cur.status === "logging_in" ? (cur.hasIdentity ? "needs_login" : "logged_out") : cur.status;
    this.setVibes(id, { status: "logging_in" }, { silent: true });
    const r = await this.waitLogin(id, "vibes");
    const skipped = this.skipRequested.delete(id);
    if (!this.repo.getAccount(id)) return "cancelled";
    if (r === "restricted" && owned()) {
      // AC-VIB-15: Vibes refused this Meta account as under 18 — say so now instead of waiting out the step.
      this.setVibes(id, { status: "restricted", note: VIBES_AGE_NOTE, statusUntil: null, checkedAt: this.now() });
      return "failed";
    }
    if (r === "ok" && owned()) {
      const res = await this.vibesCheckInner(id, () => !owned());
      if (res === "ready") return "done";
      if (this.repo.getAccount(id)?.vibes.status === "logging_in") this.setVibes(id, { status: prevStatus }, { silent: true });
      return "failed";
    }
    // (a)(b)(f): closed, skipped or timed out → Vibes keeps its previous state, no notification.
    this.setVibes(id, { status: prevStatus, note: r === "timeout" ? "Bước đăng nhập Vibes đã dừng sau 15 phút" : cur.note }, { silent: true });
    return r === "timeout" ? "timeout" : skipped ? "deferred" : "cancelled";
  }

  /** “Đã xong, kiểm tra phiên” (S07c2). */
  loginCheckNow(id: string): void {
    const p = this.loginProgress.get(id);
    if (p?.active) this.d.ui.pokeLogin?.(id, p.active);
  }

  /** “Bỏ qua Vibes, dùng Muse trước” (S07c2). */
  skipLoginStep(id: string): void {
    const p = this.loginProgress.get(id);
    if (p?.active !== "vibes") return;
    this.skipRequested.add(id);
    this.d.ui.cancelLogin?.(id, "vibes");
  }

  /** Huỷ the whole plan: the waiting step resolves false; finished steps stay. */
  cancelLogin(id: string): void {
    const p = this.loginProgress.get(id);
    if (p) for (const s of p.steps) if (s.state === "pending") s.state = "cancelled";
    this.d.ui.cancelLogin?.(id, p?.active ?? undefined);
  }

  /** R39 — “Dùng Vibes cho tài khoản này”. */
  setVibesEnabled(id: string, on: boolean): Account {
    if (on && !this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "unavailable");
    const acc = this.mustAccount(id);
    if (acc.vibes.enabled === on) return this.accountView(id)!;
    if (!on && this.runsOn(id).some((r) => r.site === "vibes")) throw new CommandError("Tài khoản đang chạy một lượt Vibes — chờ xong rồi tắt", "busy");
    if (!on && this.leases.get(id)?.kind === "login") throw new CommandError("Tài khoản đang đăng nhập — xong rồi tắt", "busy");
    this.repo.updateVibes(id, { enabled: on });
    this.emitAccount(id);
    this.d.ui.setVibesEnabled?.(id, on);
    if (!on) this.holdVibesJobs(id, HOLD_OFF);
    else {
      this.releaseVibesJobs(id);
      void this.checkVibes(id, true); // exactly one check when switched back on (AC-VIB-11)
    }
    this.emitChainsFor(id);
    this.requestSchedule();
    return this.accountView(id)!;
  }

  /** R42 — “Dùng tài khoản Vibes mới”: the new identity is recorded; sources of the old one stay locked. */
  acceptVibesIdentity(id: string): Account {
    if (!this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "unavailable");
    const acc = this.mustAccount(id);
    if (acc.vibes.status !== "identity_changed") throw new CommandError("Không có tài khoản Vibes mới để chọn", "state");
    const priv = this.repo.vibesPrivate(id);
    if (!priv.pendingFp) throw new CommandError("Kiểm phiên Vibes lại trước", "state");
    this.setVibes(id, { status: "ready", identityFp: priv.pendingFp, identityMasked: acc.vibes.pendingIdentityMasked, pendingFp: null, pendingIdentityMasked: null, note: null, statusUntil: null });
    // Extend steps of the old identity can never run on the new one: stop them with the reason (R45).
    const reason = `Phiên Vibes của ${acc.alias} đã đổi tài khoản`;
    for (const j of this.repo.jobsInStates(["queued", "held", "retry_wait"])) {
      if (j.site === "vibes" && j.operation === "extend" && j.boundAccountId === id) {
        const rsId = j.sourceAssetId ? this.repo.assetRemoteSourceId(j.sourceAssetId) : null;
        const rs = rsId ? this.repo.getRemoteSource(rsId) : null;
        if (!rs || rs.ownerIdentityFp !== priv.pendingFp) {
          if (j.chainId) this.repo.updateChain(j.chainId, { status: "stopped", reason }, this.now());
          this.setJob(j, "cancelled", { errorMessage: reason, stateUntil: null });
        }
      }
    }
    this.releaseVibesJobs(id);
    return this.accountView(id)!;
  }

  takeoverStart(id: string, mode: "afterCurrent" | "now", site: Site = "muse"): Account {
    if (site === "vibes" && !this.d.vibesFor) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "unavailable");
    this.mustAccount(id);
    const l = this.leases.get(id);
    const runs = this.runsOn(id);
    // R102: page runs (UI path, Vibes) follow the Build 1.0 takeover rules; unsent HTTP runs go back to the queue;
    // accepted HTTP turns keep being followed read-only while the user controls the page.
    const pageRuns = runs.filter((r) => r.path === "ui" || r.site === "vibes");
    if (pageRuns.length && mode === "afterCurrent") {
      this.pendingTakeover.add(id);
      this.takeoverSite.set(id, site);
      this.setAccount(id, { stateNote: "Sẽ chuyển sang điều khiển khi xong lượt hiện tại" });
      return this.accountView(id)!;
    }
    if (l && l.kind !== "check") throw new CommandError("Tài khoản đang bận", "busy");
    for (const r of runs) {
      const j = this.repo.getJob(r.jobId);
      if (!j) continue;
      if (PRE_SUBMIT.has(j.state)) {
        this.setJob(j, "queued", { accountId: null, execPath: null });
        r.abort.abort();
      } else if (r.path === "ui" || r.site === "vibes") {
        if (!TERMINAL.has(j.state)) this.setJob(j, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Anh đã dừng giữa chừng để điều khiển" });
        r.abort.abort();
      }
    }
    this.enterTakeover(id, site);
    return this.accountView(id)!;
  }

  private takeoverSite = new Map<string, Site>();

  private enterTakeover(id: string, site: Site = this.takeoverSite.get(id) ?? "muse"): void {
    this.leases.set(id, { kind: "takeover" });
    this.setAccount(id, { state: "takeover", stateNote: null });
    this.d.ui.showTakeover(id, site);
  }

  async takeoverEnd(id: string): Promise<Account> {
    this.mustAccount(id);
    this.pendingTakeover.delete(id);
    if (this.leases.get(id)?.kind === "takeover") this.leases.delete(id);
    this.d.ui.hideTakeover(id);
    this.takeoverSite.delete(id);
    this.setAccount(id, { state: "ready" });
    const out = await this.checkSession(id, true);
    const a = this.repo.getAccount(id);
    if (this.d.vibesFor && a?.vibes.enabled && a.vibes.hasIdentity) return this.checkVibes(id, true); // legacy provider only
    return out;
  }

  /** “Đọc hạn mức Muse” (button). Same path as the automatic reads (R71); a failure keeps the previous numbers (R69). */
  async readQuota(id: string): Promise<Account> {
    this.mustAccount(id);
    return this.refreshQuota(id, false);
  }

  /** Test only (`__test.quota` ageMs, refused outside MUSE4AI_TEST): the stored snapshot was read `ms` earlier — stands in for hours passing. */
  ageQuotaForTest(id: string, ms: number): void {
    const q = this.repo.getAccount(id)?.quota;
    if (!q) return;
    this.repo.updateAccount(id, {
      quota: { ...q, readAt: q.readAt - ms, ...(typeof q.checkedAt === "number" ? { checkedAt: q.checkedAt - ms } : {}) },
    });
    this.emitAccount(id);
  }

  /**
   * One Usage read under the account's `quota` lease (R2). The lease is taken before the first await, so the scheduler
   * pass that started it never hands this account a job meanwhile. Success → merged snapshot + R73/R74 decision;
   * failure → previous numbers kept, attempt recorded (R69), back-off for automatic reads (R71); never an account state.
   */
  private async refreshQuota(id: string, auto: boolean): Promise<Account> {
    if (this.leases.has(id) || this.pageRunsOn(id) > 0) {
      if (!auto) throw new CommandError("Tài khoản đang bận — thử lại khi rảnh", "busy");
      return this.accountView(id)!;
    }
    const lease: Lease = { kind: "quota" };
    this.leases.set(id, lease);
    this.quotaPending.delete(id);
    if (auto) this.quotaReading.add(id);
    this.emitAccount(id);
    const superseded = () => this.leases.get(id) !== lease;
    let failure: string | null = null;
    try {
      const read = await this.d.adapterFor(id).readQuota();
      if (superseded()) return this.accountView(id)!;
      const prev = this.repo.getAccount(id)?.quota ?? null;
      this.repo.updateAccount(id, { quota: mergeQuotaRead(prev, read, this.now()) });
      this.applyQuotaSnapshot(id);
    } catch (e) {
      if (superseded()) return this.accountView(id)!;
      failure = e instanceof AdapterError ? redact(e.message) : "Không đọc được hạn mức của Muse";
      const prev = this.repo.getAccount(id)?.quota ?? null;
      this.repo.updateAccount(id, { quota: failQuotaRead(prev, failure, this.now()) });
      this.d.log("warn", "quota", "usage read failed", { id, auto, error: failure });
    } finally {
      if (this.leases.get(id) === lease) this.leases.delete(id);
      this.quotaReading.delete(id);
      this.emitAccount(id);
      this.requestSchedule();
    }
    if (failure && !auto) throw new CommandError(failure, "quota_read_failed");
    return this.accountView(id)!;
  }

  /**
   * R73/R74 — act on the stored snapshot. Nothing left → `limit_reached` before any send (source “usage”); an existing
   * limit takes Muse's reset time. Something left again → lift only a limit the snapshot itself set (a limit Muse
   * reported may be about something else and keeps its time).
   */
  private applyQuotaSnapshot(id: string): void {
    const a = this.repo.getAccount(id);
    if (!a?.quota) return;
    const block = quotaBlock(a.quota, this.now());
    if (block) {
      // A read during live HTTP turns ("busy", R103) blocks too: running turns finish, nothing new is sent.
      if (a.state === "ready" || a.state === "busy") this.setAccount(id, { state: "limit_reached", stateUntil: block.until, stateNote: block.reason, quota: { ...a.quota, limitFrom: "usage" } });
      else if (a.state === "limit_reached") this.setAccount(id, { stateUntil: block.until, stateNote: block.reason });
    } else if (a.state === "limit_reached" && a.quota.limitFrom === "usage") {
      this.setAccount(id, { state: "ready", stateUntil: null, stateNote: null, quota: { ...a.quota, limitFrom: null } });
    }
  }

  /** Test mode only (IPC `__test.setCaps`): pretend Muse reported a capability as missing for this account. */
  testSetCapabilities(id: string, caps: Record<string, boolean>): Account {
    const acc = this.mustAccount(id);
    this.setAccount(id, { capabilities: { ...acc.capabilities, ...caps } });
    return this.accountView(id)!;
  }

  async exitIp(id: string): Promise<{ ip: string | null; country: string | null }> {
    const acc = this.mustAccount(id);
    if (!acc.proxyId) throw new CommandError("Tài khoản chưa có proxy", "no_proxy");
    try {
      const r = await this.d.adapterFor(id).exitIp();
      return { ip: maskIp(r.ip), country: r.country };
    } catch (e) {
      // Never fall back to a direct check: a failure here means the account's proxy is not usable.
      this.d.log("warn", "account", "exit ip check failed", { id, error: redact(e) });
      throw new CommandError("Không kiểm được IP: proxy của tài khoản này không kết nối được", "proxy_failed");
    }
  }

  /** R16 / AC-ACC-08. Returns needsForce when an after-submit job is still running after the wait. */
  async removeAccount(id: string, force = false, waitMs = LEASE_RELEASE_WAIT_MS): Promise<{ removed: boolean; needsForce?: boolean }> {
    const acc = this.mustAccount(id);
    this.setAccount(id, { state: "paused" });
    const l = this.leases.get(id);
    // R16 on every run of the account, both paths: unsent → back to the queue; sent → wait, then force.
    const runs = this.runsOn(id);
    const unsent = runs.filter((r) => PRE_SUBMIT.has(this.repo.getJob(r.jobId)?.state ?? "queued"));
    for (const r of unsent) r.abort.abort();
    await Promise.all(unsent.map((r) => r.promise.catch(() => undefined)));
    const sent = runs.filter((r) => !unsent.includes(r));
    if (sent.length && !force) {
      const done = await Promise.race([Promise.all(sent.map((r) => r.promise)).then(() => true), sleep(waitMs).then(() => false)]).catch(() => true);
      if (!done) return { removed: false, needsForce: true };
    } else if (sent.length) {
      for (const r of sent) {
        const jj = this.repo.getJob(r.jobId);
        if (jj && !TERMINAL.has(jj.state) && jj.state !== "needs_review") this.setJob(jj, "needs_review", { errorClass: "AMBIGUOUS_SUBMIT", errorMessage: "Tài khoản bị xoá khi lượt đang chạy" });
        r.abort.abort();
      }
      await Promise.all(sent.map((r) => r.promise.catch(() => undefined)));
    }
    if (l) l.abort?.abort();
    // R50: extend steps bound to this account are cancelled (never moved), their chains stop and the sources lock.
    const now = this.now();
    for (const c of this.repo.chainsForAccount(id, ["running", "waiting", "needs_review"])) {
      this.repo.updateChain(c.id, { status: "stopped", reason: OWNER_REMOVED }, now);
    }
    for (const j of this.repo.jobsInStates(["queued", "held", "retry_wait", "preparing"])) {
      if (j.boundAccountId === id) this.setJob(j, "cancelled", { errorMessage: OWNER_REMOVED, stateUntil: null, accountId: null });
    }
    this.repo.markSourcesOwnerRemoved(id);
    for (const c of this.repo.chainsForAccount(id)) this.emitChain(c.id);
    // Unsent work pinned to this account goes back to automatic choice (after the abort above, so a job that was
    // preparing on it and has just returned to the queue is included).
    for (const j of this.repo.jobsInStates(["queued", "held", "retry_wait"])) {
      if (j.accountPref === id && !j.boundAccountId) {
        const u = this.repo.updateJob(j.id, { accountPref: "auto" }, this.now());
        this.emitJob(u);
      }
    }
    this.leases.delete(id);
    this.exec.forget(id);
    await this.d.ui.destroy(id);
    this.repo.deleteAccount(id);
    this.d.emit("account.deleted", { id });
    this.requestSchedule();
    return { removed: true };
  }

  private mustAccount(id: string): Account {
    const a = this.repo.getAccount(id);
    if (!a) throw new CommandError("Không còn tài khoản này", "not_found");
    return a;
  }

  // ======================================================== proxies
  importProxies(text: string): ProxyImportResult {
    const results = parseProxyList(text, this.repo.proxyKeys());
    const errors: ProxyImportResult["errors"] = [];
    let added = 0;
    let skipped = 0;
    let index = this.repo.listProxies().length;
    for (const r of results) {
      if (r.duplicate) {
        skipped++;
        continue;
      }
      if (!r.ok || !r.value) {
        errors.push({ line: r.line, item: r.item, error: r.error ?? "Dòng không hợp lệ" });
        continue;
      }
      index++;
      let secretRef: string | null = null;
      if (r.value.username && r.value.password) {
        secretRef = `proxy:${r.value.host}:${r.value.port}`;
        registerSecret(r.value.password);
        registerSecret(r.value.username);
        this.d.vault.set(secretRef, JSON.stringify({ u: r.value.username, p: r.value.password }));
      }
      const p = this.repo.insertProxy({ label: `P${String(index).padStart(2, "0")}`, scheme: r.value.scheme, host: r.value.host, port: r.value.port, secretRef, now: this.now() });
      this.d.emit("proxy", p);
      added++;
    }
    return { added, skipped, errors };
  }

  proxyCreds(proxyId: string): ProxyCreds {
    const ref = this.repo.proxySecretRef(proxyId);
    if (!ref) return { username: null, password: null };
    const raw = this.d.vault.get(ref);
    if (!raw) return { username: null, password: null };
    const v = JSON.parse(raw) as { u: string; p: string };
    return { username: v.u, password: v.p };
  }

  async testProxy(id: string): Promise<void> {
    const p = this.repo.getProxy(id);
    if (!p) throw new CommandError("Không còn proxy này", "not_found");
    this.d.emit("proxy", this.repo.updateProxy(id, { health: "testing" }));
    const r = await this.d.testProxy(id).catch((e) => ({ ok: false, error: redact(e) }) as ProxyTestResult);
    const out = this.repo.updateProxy(id, {
      health: r.ok ? "healthy" : "failed",
      exitIpMasked: r.ok ? maskIp(r.ip) : p.exitIpMasked,
      country: r.ok ? r.country ?? null : p.country,
      latencyMs: r.ok ? r.latencyMs ?? null : null,
      lastTestedAt: this.now(),
      lastError: r.ok ? null : redact(r.error ?? "Không kết nối được"),
    });
    this.d.emit("proxy", out);
    // R147: every account that stopped on this proxy comes back once it answers again.
    if (r.ok) {
      for (const a of this.repo.accountsOnProxy(id)) {
        if (a.state !== "proxy_error") continue;
        this.setAccount(a.id, { state: "ready", stateNote: null });
        void this.checkSession(a.id, true);
      }
    }
    this.requestSchedule();
  }

  async testAllProxies(concurrency = 3): Promise<{ healthy: number; failed: number }> {
    const ids = this.repo.listProxies().map((p) => p.id);
    for (const id of ids) this.d.emit("proxy", this.repo.updateProxy(id, { health: "testing" }));
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        await this.testProxy(id).catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    const all = this.repo.listProxies();
    return { healthy: all.filter((p) => p.health === "healthy").length, failed: all.filter((p) => p.health === "failed").length };
  }

  removeProxy(id: string): void {
    const p = this.repo.getProxy(id);
    if (!p) throw new CommandError("Không còn proxy này", "not_found");
    const users = this.repo.accountsOnProxy(id);
    const running = users.find((a) => this.leases.has(a.id) || this.runsOn(a.id).length || a.state === "busy" || a.state === "logging_in" || a.state === "takeover");
    if (running) throw new CommandError(`Proxy đang dùng cho ${running.alias} khi tài khoản đang chạy`, "busy");
    if (users.length) this.repo.tx(() => users.forEach((a) => this.repo.updateAccount(a.id, { proxyId: null })));
    for (const a of users) this.emitAccount(a.id);
    const ref = this.repo.proxySecretRef(id);
    if (ref) this.d.vault.delete(ref);
    this.repo.deleteProxy(id);
    this.d.emit("proxy.deleted", { id });
  }

  /** R147 — takes the proxy off every account on it, or off none when one of them is working. */
  unassignProxy(id: string): void {
    if (!this.repo.getProxy(id)) return;
    const users = this.repo.accountsOnProxy(id);
    if (!users.length) return;
    if (users.some((a) => this.leases.has(a.id) || this.runsOn(a.id).length)) throw new CommandError("Tài khoản đang làm việc", "busy");
    this.repo.tx(() => users.forEach((a) => this.repo.updateAccount(a.id, { proxyId: null })));
    for (const a of users) this.emitAccount(a.id);
  }

  // ======================================================== settings & misc
  /** True when the user (or a start-up rule) saved this setting, false when it is only the built-in default. */
  hasStoredSetting(key: keyof Settings): boolean {
    return this.repo.hasSetting(key);
  }
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
    this.repo.setSetting(key, value);
    const s = this.settings();
    this.d.emit("settings", s);
    if (key === "globalConcurrency" || key === "perAccountConcurrency" || key === "concurrencyUiPages") this.requestSchedule();
    if (key === "bridgeHttpEnabled") {
      this.d.log("info", "path", "bridge.switch", { on: !!value });
      for (const a of this.repo.listAccounts()) this.emitAccount(a.id);
      this.emitEngine();
      this.requestSchedule();
    }
    if (key === "libraryDir") void this.refreshDisk();
    return s;
  }

  runningCount(): number {
    return this.running.size;
  }

  inFlightCount(): number {
    return this.repo.countJobs(["preparing", "submitting", "submitted", "generating", "downloading", "download_retry"]);
  }

  pauseAll(): void {
    for (const b of this.repo.listBatches()) if (b.state === "running") this.pauseBatch(b.id);
  }

  /** S10 “Thử lại”: each site's banner clears only its own pause (Muse keeps running when Vibes changed, and back). */
  clearUiChanged(kind?: JobKind, site?: Site): void {
    if (kind) this.uiChangedKinds.delete(kind);
    else if (site === "vibes") this.vibesUiChanged = false;
    else if (site === "muse") this.uiChangedKinds.clear();
    else {
      this.uiChangedKinds.clear();
      this.vibesUiChanged = false;
    }
    this.emitEngine();
    this.requestSchedule();
  }

  markFailedSeen(): void {
    this.repo.markFailedSeen();
    this.emitCounts();
  }

  accountLabel(a: Account): string {
    return ACCOUNT_LABEL[a.state];
  }
}

export { PROGRESS_STATES };
