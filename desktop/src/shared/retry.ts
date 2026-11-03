import { DOWNLOAD_RETRY_DELAYS_MS, PRE_SUBMIT_RETRY_DELAYS_MS } from "./constants";

/**
 * R4 — automatic retry only for errors before submit. `failuresSoFar` counts the failure that just happened (1-based).
 * Returns the delay before the next attempt, or null when the job must become `failed`.
 * AC-JOB-01: fail → 30 s → fail → 120 s → fail → failed (3 attempts total).
 */
export function preSubmitRetryDelay(failuresSoFar: number, maxRetries = PRE_SUBMIT_RETRY_DELAYS_MS.length): number | null {
  if (failuresSoFar < 1 || failuresSoFar > maxRetries) return null;
  return PRE_SUBMIT_RETRY_DELAYS_MS[Math.min(failuresSoFar - 1, PRE_SUBMIT_RETRY_DELAYS_MS.length - 1)];
}

/** R4 — download retries are separate from generation; never resubmits the generation. */
export function downloadRetryDelay(downloadFailures: number): number | null {
  if (downloadFailures < 1 || downloadFailures > DOWNLOAD_RETRY_DELAYS_MS.length) return null;
  return DOWNLOAD_RETRY_DELAYS_MS[downloadFailures - 1];
}
