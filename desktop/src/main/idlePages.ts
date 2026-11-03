// A hidden Muse page keeps running Meta's web app (timers, rendering — account windows are not throttled so a
// generation in the background is not slowed down). Measured on the reference VPS: ~8 % of a CPU core per idle
// account page plus GPU work. A page with nothing to do is therefore unloaded after a quiet period; its session
// (the login) stays, and the next step rebuilds the page exactly as after a crash. Pure, unit-tested.

export const IDLE_UNLOAD_MS = 5 * 60_000;
/** Until it is unloaded, a quiet hidden page is throttled (timers slowed, no rendering) after this much quiet. */
export const QUIET_THROTTLE_MS = 30_000;

export interface PageActivity {
  /** Shown to the user (login, takeover). */
  visible: boolean;
  /** Live preview running in the app. */
  previewing: boolean;
  /** Waiting for the user to finish logging in. */
  loggingIn: boolean;
  /** The account is working on a job. */
  busy: boolean;
  /** Last time any step used the page (ms epoch). */
  lastUse: number;
}

export function shouldUnloadPage(a: PageActivity, now: number, idleMs: number = IDLE_UNLOAD_MS): boolean {
  if (a.visible || a.previewing || a.loggingIn || a.busy) return false;
  return now - a.lastUse >= idleMs;
}

/**
 * Measured on the reference VPS (software GPU): a freshly loaded hidden Muse page costs ~45 % of a core until it is
 * unloaded. Throttling it once quiet removes that cost; any step that uses the page lifts the throttle first, so a
 * generation in the background still runs at full speed.
 */
export function shouldThrottlePage(a: PageActivity, now: number, quietMs: number = QUIET_THROTTLE_MS): boolean {
  return shouldUnloadPage(a, now, quietMs);
}
