// Build 3.2 R142–R147 — a proxy may serve several accounts. Who uses a proxy is never stored on the proxy: it is read
// from the accounts (`account.proxyId`, the one source of truth), so the picker, the account card, the proxy table and
// the main process always agree. Pure TypeScript (no Electron/DOM) so main, renderer and tests share it.

export interface ShareProxy {
  id: string;
  label: string;
  health: string;
  latencyMs: number | null;
}

export interface ShareAccount {
  id: string;
  alias: string;
  proxyId: string | null;
  createdAt: number;
}

/** Accounts on `proxyId`, oldest first (stable order for labels); `except` leaves one account out (the one being edited). */
export function proxyUsers<A extends ShareAccount>(proxyId: string, accounts: readonly A[], except?: string | null): A[] {
  return accounts
    .filter((a) => a.proxyId === proxyId && a.id !== except)
    .sort((a, b) => a.createdAt - b.createdAt || a.alias.localeCompare(b.alias));
}

/** “Mây, Gió” — at most `max` names, then “+N” for the rest (names are never translated). */
export function namesSummary(names: readonly string[], max = 2): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

export interface ProxyChoice<P, A> {
  proxy: P;
  /** Other accounts on this proxy (the account being edited is left out). */
  users: A[];
}

const latency = (p: ShareProxy) => (p.latencyMs == null ? Number.POSITIVE_INFINITY : p.latencyMs);

/**
 * R144 — the order every proxy picker shows: unused first, then fewer users first; within a group lowest latency
 * first, then label. `healthyOnly` is the add-account rule (only a healthy proxy may start a new account).
 */
export function proxyChoices<P extends ShareProxy, A extends ShareAccount>(
  proxies: readonly P[],
  accounts: readonly A[],
  opts: { healthyOnly?: boolean; forAccountId?: string | null } = {},
): ProxyChoice<P, A>[] {
  return proxies
    .filter((p) => !opts.healthyOnly || p.health === "healthy")
    .map((proxy) => ({ proxy, users: proxyUsers(proxy.id, accounts, opts.forAccountId) }))
    .sort((a, b) => a.users.length - b.users.length || latency(a.proxy) - latency(b.proxy) || a.proxy.label.localeCompare(b.proxy.label));
}

/**
 * R143 — the proxy a new account gets when none is chosen: healthy, used by nobody, lowest latency. Never a shared
 * one: sharing is always the user's explicit choice.
 */
export function suggestProxy<P extends ShareProxy>(proxies: readonly P[], accounts: readonly ShareAccount[]): P | null {
  const first = proxyChoices(proxies, accounts, { healthyOnly: true })[0];
  return first && first.users.length === 0 ? first.proxy : null;
}

/** Proxies with at least one account (the “assigned” count of the proxy table). */
export function usedProxyCount(proxies: readonly { id: string }[], accounts: readonly { proxyId: string | null }[]): number {
  const used = new Set(accounts.map((a) => a.proxyId).filter((x): x is string => !!x));
  return proxies.filter((p) => used.has(p.id)).length;
}
