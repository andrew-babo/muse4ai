import { tl, type Locale } from "../i18n";
import { ERROR_LABEL, JOB_LABEL, TERMINAL } from "../jobMachine";
import type { Asset, ChainPlan, ChainStatus, ExtendMode, Job, JobState } from "../types";

/** R122: app-made words in a view (label, note, error message, stop reason) in the caller's language; Muse/user text stays. */
const say = (locale: Locale | undefined, vi: string | null): string | null => (vi === null ? null : locale ? tl(locale, vi) : vi);

// §4.8 — what an agent sees of a job. Pure mapping; URLs are built by the caller.

export type ApiJobStatus = "queued" | "running" | "needs_review" | "succeeded" | "failed" | "cancelled";

const STATUS: Record<JobState, ApiJobStatus> = {
  queued: "queued",
  held: "queued",
  retry_wait: "queued",
  preparing: "queued",
  submitting: "running",
  submitted: "running",
  generating: "running",
  downloading: "running",
  download_retry: "running",
  needs_review: "needs_review",
  completed: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

export const API_STATUSES: ApiJobStatus[] = ["queued", "running", "needs_review", "succeeded", "failed", "cancelled"];

export function apiStatus(state: JobState): ApiJobStatus {
  return STATUS[state];
}

export function statesFor(status: ApiJobStatus): JobState[] {
  return (Object.keys(STATUS) as JobState[]).filter((s) => STATUS[s] === status);
}

/** Nothing more will happen without a person (terminal, or waiting for the user's review). */
export function isSettled(state: JobState): boolean {
  return TERMINAL.has(state) || state === "needs_review";
}

export interface ApiOutput {
  asset_id: string;
  kind: Asset["kind"];
  mime: string;
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  sha256: string;
  download_url: string | null;
  download_expires_at: string | null;
  available: boolean;
  /**
   * rev 7.1 R65: app-issued handle of the Muse conversation this video belongs to (Muse videos only). Pass it to
   * POST /v1/conversations/{id}/extend or muse_extend_video to continue the conversation's latest video.
   */
  conversation_id: string | null;
  /** Build 2.0 R109 — file name as stored (chat files keep Muse's sanitized name; media get the library name). */
  filename: string | null;
}

export interface ApiJob {
  id: string;
  kind: Job["kind"];
  mode: Job["mode"];
  prompt: string;
  status: ApiJobStatus;
  state: JobState;
  label: string;
  account: string | null;
  error: { code: string; message: string } | null;
  note: string | null;
  needs_human: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
  /** rev 6 (R53): where it ran and what it did; never any Vibes remote id (R52). */
  site: Job["site"];
  operation: Job["operation"];
  source_asset_id: string | null;
  chain_id: string | null;
  step: number | null;
  outputs: ApiOutput[];
  /** Build 2.0 R109 — the path the send used (http/ui), null before it was sent or for Vibes. */
  path: "http" | "ui" | null;
  /** Build 2.0 — app handle of the Muse conversation (chat turns; Muse videos via their output). */
  conversation_id: string | null;
  /** Build 2.0 R83 — chat only: Muse's answer verbatim (≤ 1 MiB; the full text is an output .md when cut). */
  result: { text: string; text_truncated: boolean } | null;
  /** e.g. `outputs_truncated` (more than 20 files or 2 GiB in one turn, R83(c)). */
  warnings: string[];
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

/** Resolves the conversation handle of an output (null for anything that cannot be continued by conversation). */
export type ConversationOf = (a: Asset) => string | null;
const noConversation: ConversationOf = () => null;

export function toApiJob(
  j: Job,
  assets: Asset[],
  accountAlias: string | null,
  link: (a: Asset) => { url: string; expiresAt: number } | null,
  conversationOf: ConversationOf = noConversation,
  locale?: Locale,
): ApiJob {
  const failed = j.state === "failed";
  const cancelledNote = j.state === "cancelled" ? j.errorMessage : null;
  return {
    id: j.id,
    kind: j.kind,
    mode: j.mode,
    prompt: j.prompt,
    status: apiStatus(j.state),
    state: j.state,
    label: say(locale, JOB_LABEL[j.state])!,
    account: accountAlias,
    error: failed && j.errorClass ? { code: j.errorClass, message: say(locale, j.errorMessage || ERROR_LABEL[j.errorClass])! } : null,
    note: say(locale, cancelledNote ?? (j.state === "needs_review" ? "Đang chờ người dùng xem trong Muse4AI" : j.state === "retry_wait" ? j.errorMessage : null)),
    needs_human: j.state === "needs_review",
    created_at: iso(j.createdAt)!,
    updated_at: iso(j.updatedAt)!,
    completed_at: iso(j.completedAt),
    version: j.rev,
    site: j.site,
    operation: j.operation,
    source_asset_id: j.sourceAssetId,
    chain_id: j.chainId,
    step: j.stepIndex,
    outputs: assets.map((a) => toApiOutput(a, link, conversationOf)),
    path: j.site === "muse" ? (j.execPath ?? null) : null,
    conversation_id: j.conversationId ?? assets.map((a) => (a.site === "muse" && a.kind === "video" ? conversationOf(a) : null)).find((c) => !!c) ?? null,
    result: j.kind === "chat" && j.state === "completed" ? { text: j.resultText ?? "", text_truncated: !!j.resultTextTruncated } : null,
    warnings: j.outputsTruncated ? ["outputs_truncated"] : [],
  };
}

export function toApiOutput(a: Asset, link: (a: Asset) => { url: string; expiresAt: number } | null, conversationOf: ConversationOf = noConversation): ApiOutput {
  const available = !a.trashedAt && !a.missing;
  const l = available ? link(a) : null;
  return {
    asset_id: a.id,
    kind: a.kind,
    mime: a.mime,
    width: a.width,
    height: a.height,
    duration_ms: a.durationMs,
    bytes: a.bytes,
    sha256: a.sha256,
    download_url: l?.url ?? null,
    download_expires_at: l ? new Date(l.expiresAt * 1000).toISOString() : null,
    available,
    conversation_id: a.site === "muse" && a.kind === "video" ? conversationOf(a) : null,
    filename: a.filename ?? null,
  };
}

// ---------------------------------------------------------------- Kéo dài chains (R53)
export interface ApiChainStep {
  step: number;
  job_id: string;
  status: ApiJobStatus;
  state: JobState;
  duration_ms: number | null;
  output: ApiOutput | null;
}

export interface ApiChain {
  id: string;
  /** rev 7.1: muse | vibes — where the chain runs (decided by the source video). */
  site: "muse" | "vibes";
  /** Muse chains: the conversation handle (same as the outputs' conversation_id); null for Vibes. */
  conversation_id: string | null;
  status: ChainStatus;
  stop_reason: string | null;
  mode: ExtendMode;
  directive: string | null;
  plan: { times: number } | { target_seconds: number };
  max_steps: number;
  steps_done: number;
  account: string | null;
  source_asset_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  steps: ApiChainStep[];
  latest_output: ApiOutput | null;
}

/** Nothing more will happen to the chain without a person. */
export function chainSettled(status: ChainStatus): boolean {
  return status === "completed" || status === "stopped" || status === "cancelled" || status === "needs_review";
}

export function apiPlan(p: ChainPlan): ApiChain["plan"] {
  return p.type === "steps" ? { times: p.value } : { target_seconds: p.value };
}

export function toApiChain(
  c: { id: string; site?: "muse" | "vibes"; status: ChainStatus; reason: string | null; mode: ExtendMode; directive: string | null; plan: ChainPlan; maxSteps: number; stepsDone: number; accountAlias: string | null; rootAssetId: string; lastAssetId: string | null; createdAt: number; updatedAt: number; rev: number },
  steps: { step: number; jobId: string; state: JobState; asset: Asset | null }[],
  latest: Asset | null,
  link: (a: Asset) => { url: string; expiresAt: number } | null,
  conversationId: string | null = null,
  conversationOf: ConversationOf = noConversation,
  locale?: Locale,
): ApiChain {
  return {
    id: c.id,
    site: c.site ?? "vibes",
    conversation_id: (c.site ?? "vibes") === "muse" ? conversationId : null,
    status: c.status,
    stop_reason: say(locale, c.reason),
    mode: c.mode,
    directive: c.directive,
    plan: apiPlan(c.plan),
    max_steps: c.maxSteps,
    steps_done: c.stepsDone,
    account: c.accountAlias,
    source_asset_id: c.rootAssetId,
    created_at: iso(c.createdAt)!,
    updated_at: iso(c.updatedAt)!,
    version: c.rev,
    steps: steps.map((s) => ({ step: s.step, job_id: s.jobId, status: apiStatus(s.state), state: s.state, duration_ms: s.asset?.durationMs ?? null, output: s.asset ? toApiOutput(s.asset, link, conversationOf) : null })),
    latest_output: latest ? toApiOutput(latest, link, conversationOf) : null,
  };
}
