// Which screen the app reopens on at start-up. It resumes the last screen, but never into a detail of something
// that no longer exists (a job/batch/account deleted since, or a route an old notification left behind) and never
// straight back into an account's live panels, which start work on mount. Pure, unit-tested.
import type { Snapshot } from "./types";

export function resumeRoute(snap: Pick<Snapshot, "settings" | "batches" | "accounts">, jobExists: boolean | null): string {
  if (snap.settings.onboardingStep < 4) return "/onboarding";
  const route = snap.settings.lastRoute || "/studio";
  const [root, id] = route.slice(1).split("/");
  if (!id) return route;
  if (root === "queue") return jobExists === false ? "/queue" : route;
  if (root === "batch") return snap.batches.some((b) => b.id === id) ? `/batch/${id}` : "/batch";
  if (root === "accounts") return snap.accounts.some((a) => a.id === id) ? `/accounts/${id}` : "/accounts";
  return route;
}

/** Job id when the remembered route is a job detail, so the caller can check it still exists. */
export function resumeJobId(lastRoute: string | null | undefined): string | null {
  const m = /^\/queue\/([^/]+)$/.exec(lastRoute ?? "");
  return m ? m[1] : null;
}
