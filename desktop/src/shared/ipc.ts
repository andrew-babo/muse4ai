import { z } from "zod";
import { REF_MAX_PER_JOB } from "./constants";

// IPC contract (spec §4.6). The main process validates every payload with these schemas; unknown commands are rejected (AC-SEC-02).

const id = z.string().min(1).max(100);
const kind = z.enum(["image", "video"]);
const mode = z.enum(["text", "reference"]);
const accountPref = z.string().min(1).max(100);
const site = z.enum(["muse", "vibes"]);
const chainPlan = z.object({ type: z.enum(["steps", "target"]), value: z.number().int().min(1).max(300) });
const rowSchema = z.object({
  line: z.number().int().min(0),
  prompt: z.string().max(20000),
  kind,
  mode,
  reference: z.string().max(1000).nullable(),
  repeat: z.number().int(),
  error: z.string().nullable(),
});
const batchSettings = z.object({ kind, mode, accountPref, repeat: z.number().int().min(1).max(4) });
const jobState = z.enum(["queued", "held", "preparing", "submitting", "submitted", "generating", "downloading", "download_retry", "retry_wait", "needs_review", "completed", "failed", "cancelled"]);

export const COMMANDS = {
  "app.snapshot": z.object({}),
  "app.ping": z.object({}),
  "app.markReady": z.object({ ms: z.number().min(0).max(600_000), scriptMs: z.number().min(0).max(600_000).optional(), snapMs: z.number().min(0).max(600_000).optional() }),
  "app.setRoute": z.object({ route: z.string().max(300) }),
  "app.dismissRecovered": z.object({}),
  "app.quit": z.object({ force: z.boolean().optional() }),
  "app.quitInfo": z.object({}),
  "app.trayExplained": z.object({}),
  /** A link inside a Hỏi đáp answer, opened after the user confirmed it (http/https only). */
  "app.openUrl": z.object({ url: z.string().min(1).max(2048) }),
  "win.minimize": z.object({}),
  "win.maximize": z.object({}),
  "win.close": z.object({}),

  "job.create": z.object({
    kind,
    mode,
    prompt: z.string().max(20000),
    referenceIds: z.array(id).max(REF_MAX_PER_JOB),
    accountPref,
    repeat: z.number().int().min(1).max(4),
    clientRequestId: z.string().min(8).max(100),
    site: site.optional(),
  }),
  "job.cancel": z.object({ jobId: id }),
  "job.retry": z.object({ jobId: id }),
  "job.retryNow": z.object({ jobId: id }),
  "job.prioritize": z.object({ jobId: id }),
  "job.changeAccount": z.object({ jobId: id, accountPref }),
  "job.resolveReview": z.object({ jobId: id, resolution: z.enum(["import", "resend", "dismiss"]) }),
  "job.get": z.object({ jobId: id }),
  "job.query": z.object({
    states: z.array(jobState).optional(),
    chainId: z.string().max(100).optional(),
    batchId: z.string().max(100).nullable().optional(),
    accountId: z.string().max(100).optional(),
    kind: z.enum(["image", "video", "chat"]).optional(), // Build 2.0: the Hàng chờ “Hỏi đáp” filter
    search: z.string().max(500).optional(),
    standaloneOnly: z.boolean().optional(),
    cursor: z.number().nullable().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),
  "job.markFailedSeen": z.object({}),
  "job.stateCounts": z.object({ batchId: z.string().max(100).nullable().optional(), search: z.string().max(500).optional() }),

  "batch.parse": z.object({ text: z.string().max(5_000_000), fileName: z.string().max(300).optional(), baseDir: z.string().max(1000).optional(), defaults: z.object({ kind, mode, repeat: z.number().int().min(1).max(4) }) }),
  "batch.pickFile": z.object({}),
  "batch.saveDraft": z.object({ id: z.string().max(100).nullable().optional(), name: z.string().max(120), settings: batchSettings, rows: z.array(rowSchema).max(5000) }),
  "batch.start": z.object({ id }),
  "batch.pause": z.object({ id }),
  "batch.resume": z.object({ id }),
  "batch.cancelRemaining": z.object({ id }),
  "batch.retryFailed": z.object({ id }),
  "batch.delete": z.object({ id }),
  "batch.exportCsv": z.object({ id }),
  "batch.openFolder": z.object({ id }),
  "batch.fromAssets": z.object({ assetIds: z.array(id).min(1).max(1000) }),

  "reference.pick": z.object({}),
  "reference.addPath": z.object({ filePath: z.string().max(1000) }),
  "reference.addBytes": z.object({ data: z.string().max(40_000_000), name: z.string().max(300).optional() }),
  "reference.fromAsset": z.object({ assetId: id }),

  "account.add": z.object({ alias: z.string().max(100), avatar: z.number().int().min(0).max(7), proxyId: z.string().max(100).nullable().optional() }),
  "account.rename": z.object({ id, alias: z.string().max(100), avatar: z.number().int().min(0).max(7).optional() }),
  "account.remove": z.object({ id, force: z.boolean().optional() }),
  "account.pause": z.object({ id }),
  "account.resume": z.object({ id }),
  "account.setProxy": z.object({ id, proxyId: id, force: z.boolean().optional() }),
  "account.cancelProxyChange": z.object({ id }),
  "account.openLogin": z.object({ id, site: site.optional() }),
  "account.cancelLogin": z.object({ id }),
  "account.skipLoginStep": z.object({ id }),
  "account.loginCheckNow": z.object({ id }),
  "account.loginState": z.object({ id }),
  "account.showWindow": z.object({ id, site: site.optional() }),
  "account.checkSession": z.object({ id }),
  "account.previewStart": z.object({ id }),
  "account.previewStop": z.object({ id }),
  "account.takeoverStart": z.object({ id, mode: z.enum(["afterCurrent", "now"]), site: site.optional() }),
  "account.takeoverEnd": z.object({ id }),
  "account.readQuota": z.object({ id }),
  "account.exitIp": z.object({ id }),
  "account.suggestProxy": z.object({}),
  // rev 6 (R39–R42): the account's Vibes side.
  "account.checkVibes": z.object({ id }),
  "account.setVibesEnabled": z.object({ id, enabled: z.boolean() }),
  "account.acceptVibesIdentity": z.object({ id }),
  // Build 2.0 R86/R92/R98 — Cách chạy of the account and the read-only “Thử HTTP ngay”.
  "account.setExecution": z.object({ id, mode: z.enum(["auto", "http", "ui"]), maxConcurrent: z.number().int().min(1).max(20), uiMaxConcurrent: z.number().int().min(1).max(5) }),
  "account.probeHttp": z.object({ id }),
  "bridge.checkNow": z.object({}),

  // Build 2.0 R81–R85 — Hỏi đáp: prompt verbatim, up to 10 attachments, optional conversation handle to continue.
  "chat.create": z.object({
    prompt: z.string().max(32_000),
    referenceIds: z.array(id).max(10),
    accountPref,
    clientRequestId: z.string().min(8).max(100),
    conversationId: z.string().min(1).max(100).nullable().optional(),
  }),
  "chat.pickAttachment": z.object({}),
  "chat.attachPath": z.object({ filePath: z.string().max(1000) }),
  "chat.attachBytes": z.object({ data: z.string().max(40_000_000), name: z.string().max(300) }),
  "chat.conversation": z.object({ conversationId: z.string().min(1).max(100) }),
  "chat.readText": z.object({ assetId: id }),

  // rev 6 (F16, R45–R47): Kéo dài video. The main process re-validates everything (the UI is not a boundary).
  "extend.start": z.object({ assetId: id, mode: z.enum(["auto", "directive"]), directive: z.string().max(5000).nullable().optional(), plan: chainPlan, clientRequestId: z.string().min(8).max(100) }),
  "chain.get": z.object({ id }),
  "chain.list": z.object({}),
  "chain.cancel": z.object({ id }),
  "chain.continue": z.object({ id }),

  "proxy.import": z.object({ text: z.string().max(1_000_000) }),
  "proxy.pickFile": z.object({}),
  "proxy.test": z.object({ id }),
  "proxy.testAll": z.object({}),
  "proxy.remove": z.object({ id }),
  "proxy.unassign": z.object({ id }),

  "library.query": z.object({
    kind: kind.optional(),
    collapseChains: z.boolean().optional(),
    batchId: z.string().max(100).optional(),
    accountAlias: z.string().max(100).optional(),
    favorite: z.boolean().optional(),
    search: z.string().max(500).optional(),
    fromDate: z.number().optional(),
    toDate: z.number().optional(),
    cursor: z.number().nullable().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  "library.facets": z.object({}),
  "library.reveal": z.object({ assetId: id }),
  "library.open": z.object({ assetId: id }),
  "library.copyFile": z.object({ assetId: id }),
  "library.trash": z.object({ assetIds: z.array(id).min(1).max(1000) }),
  "library.favorite": z.object({ assetId: id, value: z.boolean() }),
  "library.rescan": z.object({}),
  "library.get": z.object({ assetId: id }),

  "settings.set": z.object({
    key: z.enum(["perAccountConcurrency", "globalConcurrency", "preSubmitRetries", "notifications", "launchAtLogin", "displayMode", "onboardingStep", "riskAccepted", "lastRoute", "closeToTrayExplained", "extendMaxSteps", "bridgeHttpEnabled", "concurrencyUiPages", "language", "updateCheck"]),
    value: z.union([z.number(), z.boolean(), z.string().max(300)]),
  }),
  "settings.pickLibraryDir": z.object({}),
  "settings.openDataDir": z.object({}),
  "diagnostics.export": z.object({}),
  "engine.clearUiChanged": z.object({ site: z.enum(["muse", "vibes"]).optional() }),

  // Build 3.3 — update check / download / install and rollback (AC-UPD, AC-RBK). Main re-checks everything.
  "update.status": z.object({}),
  "update.check": z.object({}),
  "update.download": z.object({}),
  "update.cancel": z.object({}),
  "update.install": z.object({ force: z.boolean().optional() }),
  "update.rollback": z.object({ force: z.boolean().optional() }),
  "update.dismissJustUpdated": z.object({}),
  "update.openPage": z.object({}),

  // Agent API (spec §4.8, F12). Keys are shown once in the api.createKey result and never again.
  "api.status": z.object({}),
  "api.setEnabled": z.object({ enabled: z.boolean() }),
  "api.setPort": z.object({ port: z.number().int().min(1024).max(65535) }),
  "api.setAccess": z.object({ access: z.enum(["local", "lan", "cloudflare_quick", "cloudflare_named"]), confirmInternet: z.boolean().optional() }),
  "api.setNamedTunnel": z.object({ hostname: z.string().min(1).max(253), token: z.string().max(4096).nullable().optional() }),
  "api.clearTunnelToken": z.object({}),
  "api.retryTunnel": z.object({}),
  // R34–R36 — domain pointing at this machine (an extra way in next to the tunnel).
  "api.setDomain": z.object({ enabled: z.boolean(), host: z.string().max(300).optional(), proxy: z.enum(["managed", "external"]).optional(), confirmInternet: z.boolean().optional() }),
  "api.domainRetry": z.object({}),
  "api.domainCheck": z.object({}),
  "api.createKey": z.object({ name: z.string().min(1).max(80), scope: z.enum(["generate", "read"]) }),
  "api.revokeKey": z.object({ id: z.string().min(1).max(40) }),
  "api.revokeClient": z.object({ id: z.string().min(1).max(64) }),
  "api.dismissConsent": z.object({ id: z.string().min(1).max(64) }),
  "api.requestLog": z.object({ limit: z.number().int().min(1).max(200).optional() }),
  "api.openDocs": z.object({}),
  // Build 3.0 R3-SKILL.5/6 — the Muse4AI Agent Skill: where it would go, install (Replace only when asked), save as ZIP.
  "skill.info": z.object({}),
  "skill.install": z.object({ replace: z.boolean() }),
  "skill.saveZip": z.object({}),
  "__test.freeze": z.object({ ms: z.number().int().min(1).max(30000) }),
  "__test.script": z.object({ accountId: id, steps: z.array(z.record(z.string(), z.unknown())).max(20) }),
  "__test.metrics": z.object({}),
  "__test.trayQuit": z.object({}),
  "__test.navigate": z.object({ route: z.string().max(200) }),
  "__test.activateToast": z.object({ route: z.string().max(200), fromThisRun: z.boolean() }),
  "__test.setCaps": z.object({ accountId: id, caps: z.record(z.string(), z.boolean()) }),
  "__test.seed": z.object({ jobs: z.number().int().min(0).max(5000), assets: z.number().int().min(0).max(20000) }),
  "__test.setVerified": z.object({ caps: z.record(z.string(), z.boolean()) }),
  "__test.quota": z.object({
    accountId: id,
    text: z.string().max(2000).nullable().optional(),
    delayMs: z.number().int().min(0).max(20000).optional(),
    /** Shift the stored snapshot back in time (stale state, R75), without touching the fake panel. */
    ageMs: z.number().int().min(0).max(30 * 86_400_000).optional(),
  }),
  "__test.gw": z.object({
    accountId: id,
    steps: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
    completeMs: z.number().int().min(0).max(600_000).optional(),
    replyText: z.string().max(100_000).optional(),
    /** Files the fake Muse returns with every answer on this account (E2E of chat outputs). */
    replyFiles: z.array(z.object({ name: z.string().min(1).max(200), mime: z.string().min(1).max(100), text: z.string().max(100_000) })).max(5).optional(),
  }),
  "__test.vibes": z.object({ accountId: id, steps: z.array(z.record(z.string(), z.unknown())).max(20).optional(), me: z.array(z.unknown()).max(10).optional() }),
  /** Build 3.2 E2E: show the account's real Muse window (the takeover path) on a page, hide it, read or close its extra pages. */
  "__test.extra": z.object({ accountId: id, op: z.enum(["open", "state", "hide", "close"]), url: z.string().max(500).optional(), keepTabs: z.boolean().optional() }),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandInput<K extends CommandName> = z.infer<(typeof COMMANDS)[K]>;

export const SETTINGS_VALIDATORS: Record<string, z.ZodTypeAny> = {
  /** Build 1.0 key kept for old clients; the per-account cap now lives on each account (R98). */
  perAccountConcurrency: z.number().int().min(1).max(20),
  /** Build 2.0 R99 — app total over both paths. */
  globalConcurrency: z.number().int().min(1).max(100),
  concurrencyUiPages: z.number().int().min(1).max(8),
  bridgeHttpEnabled: z.boolean(),
  preSubmitRetries: z.number().int().min(0).max(2),
  notifications: z.boolean(),
  launchAtLogin: z.boolean(),
  displayMode: z.enum(["auto", "full", "light", "solid"]),
  onboardingStep: z.number().int().min(0).max(4),
  riskAccepted: z.boolean(),
  lastRoute: z.string().max(300),
  closeToTrayExplained: z.boolean(),
  extendMaxSteps: z.number().int().min(1).max(60),
  language: z.enum(["vi", "en"]),
  updateCheck: z.boolean(),
};

export type CommandResult = { ok: true; data: unknown } | { ok: false; error: string; code?: string };

export interface EventBatchItem {
  type: string;
  payload: unknown;
  rev: number;
}
