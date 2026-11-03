// Windows toast helpers (pure, unit-tested). A toast that has expired into the Action Center has no live
// Electron object, so its click only reaches the app through the COM activator + Notification.handleActivation.
// The route therefore travels inside the toast's `launch` argument and is validated when it comes back,
// because any toast carrying our AppUserModelID can activate the app.

// Fixed (not per-run) so the CLSID baked into the Start Menu shortcut stays valid across restarts and updates.
export const TOAST_ACTIVATOR_CLSID = "{8C1F2D64-3B7A-4E59-9A0D-6E2B5C71F4A3}";

const ROUTE_ROOTS = new Set(["studio", "queue", "batch", "library", "accounts", "settings", "onboarding"]);
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const LAUNCH_PREFIX = "muse-route=";
/** The only query a notification may carry: which site's window to open (Vibes checkpoint → `?site=vibes`). */
const QUERY = /^site=(muse|vibes)$/;

export function isSafeRoute(route: unknown): route is string {
  if (typeof route !== "string" || route.length > 200 || !route.startsWith("/")) return false;
  const q = route.indexOf("?");
  if (q >= 0 && !QUERY.test(route.slice(q + 1))) return false;
  const parts = (q >= 0 ? route.slice(1, q) : route.slice(1)).split("/");
  if (parts.length > 3 || !ROUTE_ROOTS.has(parts[0])) return false;
  return parts.slice(1).every((p) => SEGMENT.test(p));
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const RUN = /^[A-Za-z0-9]{1,16}$/;
const RUN_ARG = /[&\s]run=([A-Za-z0-9]{1,16})(?:[&\s]|$)/;

/** `run` = id of the app run that showed the toast, so a click can tell a toast of this run from an older one. */
export function launchArgument(route: string, run?: string): string {
  const arg = LAUNCH_PREFIX + encodeURIComponent(isSafeRoute(route) ? route : "/queue");
  return run && RUN.test(run) ? `${arg}&run=${run}` : arg;
}

export function buildToastXml(o: { title: string; body: string; route: string; iconUrl?: string; silent?: boolean; run?: string }): string {
  const logo = o.iconUrl ? `<image placement="appLogoOverride" src="${escapeXml(o.iconUrl)}"/>` : "";
  const audio = o.silent ? `<audio silent="true"/>` : "";
  return (
    `<toast launch="${escapeXml(launchArgument(o.route, o.run))}" activationType="foreground">` +
    `<visual><binding template="ToastGeneric"><text>${escapeXml(o.title)}</text><text>${escapeXml(o.body)}</text>${logo}</binding></visual>` +
    audio +
    `</toast>`
  );
}

/** Route carried by an activation's raw arguments, or null when it is missing or not one of ours. */
export function routeFromActivation(args: unknown): string | null {
  if (typeof args !== "string") return null;
  const at = args.indexOf(LAUNCH_PREFIX);
  if (at < 0) return null;
  const raw = args.slice(at + LAUNCH_PREFIX.length).split(/[&\s]/)[0];
  let route: string;
  try {
    route = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isSafeRoute(route) ? route : null;
}

/** Run id carried by an activation (null for toasts without one or not ours). */
export function runFromActivation(args: unknown): string | null {
  if (typeof args !== "string" || !args.includes(LAUNCH_PREFIX)) return null;
  return RUN_ARG.exec(args)?.[1] ?? null;
}

const LOGIN_ROUTE = /^\/accounts\/([A-Za-z0-9_-]{1,64})\/login\?site=(muse|vibes)$/;

/**
 * AC-VIB-10 — a “cần đăng nhập lại” toast opens the login flow (S07c2, only that site's step) when it was shown by
 * this run of the app; an older toast clicked after a restart only shows the account's card, so a stale toast can
 * never pop a login window on its own. Every other route is returned unchanged.
 */
export function resolveNoticeRoute(route: string, sameRun: boolean): { route: string; login: { accountId: string; site: "muse" | "vibes" } | null } {
  const m = LOGIN_ROUTE.exec(route);
  if (!m) return { route, login: null };
  const [, accountId, site] = m;
  return sameRun ? { route: `/accounts/${accountId}/takeover?login=1`, login: { accountId, site: site as "muse" | "vibes" } } : { route: `/accounts?focus=${accountId}`, login: null };
}

/** Route from a command line Windows built from the toast's launch argument (relaunch / cold start). */
export function routeFromArgv(argv: readonly string[]): string | null {
  for (const a of argv) {
    if (typeof a === "string" && a.includes(LAUNCH_PREFIX)) return routeFromActivation(a);
  }
  return null;
}
