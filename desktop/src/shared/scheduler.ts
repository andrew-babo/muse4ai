import { acceptsWork } from "./accountMachine";
import type { ExecMode, ExecPath } from "./execution";
import { effectiveUiMax } from "./execution";
import { choosePath, jobNeeds, type AttachmentNeed, type Need, type PathCapKey } from "./pathCapability";
import type { AccountState, CapabilityKey, JobKind, JobMode, JobOperation, Site, VibesSite } from "./types";
import { vibesAcceptsWork } from "./vibes";

// R19 (priority), Build 2.0 R98–R100 (slots per account and path, app caps, load-ratio order) + R72 quota order. Pure.
// R101 pacing is applied at send time by the coordinator (one send gate per account), not at assignment.

export interface SchedJob {
  id: string;
  kind: JobKind;
  mode: JobMode;
  accountPref: string; // "auto" | accountId
  priority: number;
  seq: number;
  /** rev 6 — defaults: muse / generate / unbound. */
  site?: Site;
  operation?: JobOperation;
  /** R50/R85 — extend steps and chat continuations run only on the owner account, never elsewhere. */
  boundAccountId?: string | null;
  /** Build 2.0 — attachments (kind + bytes) decide which path may carry the job (§4.2). */
  attachments?: AttachmentNeed[];
  continues?: boolean;
  /** Extend steps: the path that made the source video (pathCapability `extendSource`). */
  extendSource?: ExecPath;
}

export interface SchedAccount {
  id: string;
  state: AccountState;
  proxyHealthy: boolean;
  /** Live runs on this account, both paths (and Vibes). */
  running: number;
  lastActiveAt: number | null;
  capabilities: Partial<Record<CapabilityKey, boolean>>;
  /** rev 6 — Vibes side (R40). Missing = Vibes not usable. */
  vibes?: Pick<VibesSite, "enabled" | "status">;
  /** R43 — no Vibes send before this time (≥ 5 s after the previous one). */
  vibesReadyAt?: number;
  /** R72 — Muse quota group (0 = plenty or unknown … 3 = snapshot says nothing left). Orders “Tự động” only. */
  quotaRank?: number;
  /** Build 2.0 — execution settings; missing → Build 1.0 behaviour (UI path, `perAccount` slots). */
  execMode?: ExecMode;
  maxConcurrent?: number;
  uiMaxConcurrent?: number;
  /** HTTP may take new sends (health + app switch, R88/R97). */
  httpUsable?: boolean;
  /** Build 3.4 — the direct channel recently failed (degraded/down/unchecked after failures): "auto" tries it last. */
  httpDegraded?: boolean;
  /** Live UI runs (main page + work pages) and Vibes runs on this account. */
  runningUi?: number;
  runningVibes?: number;
  /** An exclusive operation (login, takeover, check, proxy change, removal) holds the account: no new sends (R102). */
  locked?: boolean;
  /** A Usage read holds the main page: no new UI sends on this account (R103). */
  mainPageBusy?: boolean;
}

export interface SchedInput {
  queued: SchedJob[];
  accounts: SchedAccount[];
  /** Build 1.0 per-account cap, used for accounts without `maxConcurrent`. */
  perAccount: number;
  globalCap: number;
  totalRunning: number;
  disabledKinds?: JobKind[]; // UI_CHANGED pauses a kind on the UI path (§4.7, Build 2.0 §4.2)
  /** rev 6 — UI_CHANGED on Vibes pauses Vibes jobs only. */
  vibesDisabled?: boolean;
  verified: Record<CapabilityKey, boolean>;
  now?: number;
  /** Build 2.0 R99 — UI pages app-wide (cap and in use); absent → no page limit (Build 1.0 tests). */
  uiPagesCap?: number;
  uiPagesUsed?: number;
  /** R99 — free memory allows opening an extra UI work page (beyond an account's main page). Default true. */
  memoryForExtraPage?: boolean;
  /** Path capability table override (tests). */
  pathCaps?: Parameters<typeof choosePath>[0]["caps"];
}

export interface Assignment {
  jobId: string;
  accountId: string;
  /** Build 2.0 — path chosen at assignment (R88); Vibes jobs run on the account's Vibes page ("ui"). */
  path: ExecPath;
}

export function capKey(kind: JobKind, mode: JobMode, site: Site = "muse", operation: JobOperation = "generate"): CapabilityKey {
  if (site === "vibes") return operation === "extend" ? "vibes.video.extend" : (`vibes.video.${mode}` as CapabilityKey);
  if (operation === "extend") return "muse.video.extend";
  if (kind === "chat") return "chat.text";
  return `${kind}.${mode}` as CapabilityKey;
}

export function sortQueue(jobs: SchedJob[]): SchedJob[] {
  return [...jobs].sort((a, b) => b.priority - a.priority || a.seq - b.seq);
}

const SHARED_BLOCK: ReadonlySet<AccountState> = new Set(["paused", "proxy_error", "takeover", "logging_in"]);

interface Work extends SchedAccount {
  max: number;
  uiMax: number;
  mode: ExecMode;
  ui: number;
  vib: number;
}

/** Account side of eligibility, independent of the path (state, proxy, capability probe, total slots). */
function baseEligible(acc: Work, job: SchedJob, verified: Record<CapabilityKey, boolean>, now: number): boolean {
  if (!acc.proxyHealthy || acc.locked || acc.running >= acc.max) return false;
  const site = job.site ?? "muse";
  if (site === "vibes") {
    if (SHARED_BLOCK.has(acc.state) || !acc.vibes || !vibesAcceptsWork(acc.vibes)) return false;
    if (acc.vibesReadyAt !== undefined && acc.vibesReadyAt > now) return false;
  } else if (!acceptsWork(acc.state)) return false;
  const key = capKey(job.kind, job.mode, site, job.operation ?? "generate");
  if (!verified[key]) return false;
  if (site === "muse" && acc.capabilities[key] === false) return false; // Vibes has no per-account probe (B37)
  return true;
}

/**
 * Build 2.0 — one pass. Each queued job (priority → creation order) goes to the eligible account with the lowest
 * load ratio (running/max), then quota group (Muse), longest idle, id; the path is chosen with it (R88). A job that
 * cannot run now waits without holding any slot. Never two assignments of one job (R66/R100).
 */
export function schedule(input: SchedInput): Assignment[] {
  const out: Assignment[] = [];
  const now = input.now ?? Date.now();
  const accounts: Work[] = input.accounts.map((a) => {
    const legacy = a.execMode === undefined;
    const max = a.maxConcurrent ?? input.perAccount;
    return {
      ...a,
      mode: a.execMode ?? "ui",
      max,
      uiMax: legacy ? max : effectiveUiMax(max, a.uiMaxConcurrent ?? max),
      ui: a.runningUi ?? (legacy ? a.running : 0),
      vib: a.runningVibes ?? 0,
      httpUsable: legacy ? false : !!a.httpUsable,
    };
  });
  let total = input.totalRunning;
  let pages = input.uiPagesUsed ?? 0;
  const pagesCap = input.uiPagesCap ?? Infinity;
  const memOk = input.memoryForExtraPage !== false;
  const disabled = new Set(input.disabledKinds ?? []);
  for (const job of sortQueue(input.queued)) {
    if (total >= input.globalCap) break;
    const site = job.site ?? "muse";
    if (site === "vibes" && input.vibesDisabled) continue;
    const needs: Need[] = jobNeeds({ kind: job.kind, mode: job.mode, site, operation: job.operation, attachments: job.attachments, continues: job.continues, extendSource: job.extendSource });
    let candidates = accounts.filter((a) => baseEligible(a, job, input.verified, now));
    if (job.boundAccountId) candidates = candidates.filter((a) => a.id === job.boundAccountId);
    else if (job.accountPref !== "auto") candidates = candidates.filter((a) => a.id === job.accountPref);
    const withPath: { acc: Work; path: ExecPath }[] = [];
    for (const acc of candidates) {
      if (site === "vibes") {
        // The Vibes page: one Vibes job at a time per account (R43), counts as a UI page, and never beside a Muse
        // UI run of the same profile (Build 1.0 AC-VIB-09 kept; HTTP runs do not use a page and may continue).
        if (acc.vib < 1 && acc.ui === 0 && pages < pagesCap) withPath.push({ acc, path: "ui" });
        continue;
      }
      const extraPage = acc.ui >= 1;
      const uiSlotFree = acc.vib === 0 && acc.ui < acc.uiMax && pages < pagesCap && (!extraPage || memOk) && !acc.mainPageBusy;
      const path = choosePath({ mode: acc.mode, httpUsable: !!acc.httpUsable, uiSlotFree, needs, uiDisabled: disabled.has(job.kind), caps: input.pathCaps });
      if (path) withPath.push({ acc, path });
    }
    if (withPath.length === 0) continue; // job waits; other jobs may still run (no global slot held)
    const rank = (a: Work) => (site === "muse" ? a.quotaRank ?? 0 : 0);
    // Build 3.4 — an account whose channel just failed goes last for HTTP work: on 10/11 a degraded account kept
    // getting new jobs that sat in "preparing" for minutes while healthy accounts were idle.
    const flaky = (w: { acc: Work; path: ExecPath }) => (w.path === "http" && w.acc.httpDegraded ? 1 : 0);
    withPath.sort(
      (x, y) =>
        flaky(x) - flaky(y) ||
        x.acc.running / x.acc.max - y.acc.running / y.acc.max ||
        rank(x.acc) - rank(y.acc) ||
        (x.acc.lastActiveAt ?? -Infinity) - (y.acc.lastActiveAt ?? -Infinity) ||
        x.acc.id.localeCompare(y.acc.id),
    );
    const { acc, path } = withPath[0];
    acc.running += 1;
    if (path === "ui") {
      pages += 1;
      if (site === "vibes") acc.vib += 1;
      else acc.ui += 1;
    }
    total += 1;
    out.push({ jobId: job.id, accountId: acc.id, path });
  }
  return out;
}

export type { PathCapKey };

