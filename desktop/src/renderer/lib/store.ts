import { useSyncExternalStore } from "react";
import { enabledCapabilities, isVibesCapability } from "@shared/capabilities";
import { mergeResync, upsertByRev } from "@shared/resync";
import { nextBusyConversations } from "@shared/chat";
import type { Account, ApiStatus, Asset, Batch, CapabilityKey, EngineStatus, ExtendChain, Job, Proxy, Settings, Snapshot } from "@shared/types";
import { t } from "@shared/i18n";

// Renderer state: one snapshot from the main process + batched events (spec §4.6). The renderer never owns business data.

export interface Toast {
  id: number;
  tone: "ok" | "danger" | "attention" | "info";
  title: string;
  body?: string;
  route?: string;
  action?: { label: string; run: () => void };
}

export interface UiState {
  ready: boolean;
  bootError: string | null;
  snap: Snapshot | null;
  route: string;
  history: string[];
  toasts: Toast[];
  previews: Record<string, string>;
  connected: boolean;
  lastBeat: number;
  confirmQuit: { running: number } | null;
  detailJobId: string | null;
  lightbox: { assetId: string; ids: string[] } | null;
  /** S06e — Kéo dài sheet for one asset. */
  extendAssetId: string | null;
  /** The opener's copy of that asset, shown at once while the sheet re-reads it (the main process re-checks on submit). */
  extendSeed: Asset | null;
  /** S03-chain drawer. */
  chainId: string | null;
  /** S07c2 — two-step login progress per account (main-process `login` events). */
  logins: Record<string, LoginProgressView>;
  live: string; // polite screen-reader announcement
}

export interface LoginProgressView {
  accountId: string;
  steps: { site: "muse" | "vibes"; state: "pending" | "active" | "done" | "skipped" | "deferred" | "cancelled" | "timeout" | "failed" }[];
  active: "muse" | "vibes" | null;
  done: boolean;
}

let state: UiState = {
  ready: false,
  bootError: null,
  snap: null,
  route: "/studio",
  history: [],
  toasts: [],
  previews: {},
  connected: true,
  lastBeat: Date.now(),
  confirmQuit: null,
  detailJobId: null,
  lightbox: null,
  extendAssetId: null,
  extendSeed: null,
  chainId: null,
  logins: {},
  live: "",
};

const subs = new Set<() => void>();
export function getState(): UiState {
  return state;
}
export function setState(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const s of subs) s();
}
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ---------------------------------------------------------------- entity event bus (job/asset lists live in screens)
type EntityListener = (type: string, payload: unknown) => void;
const entitySubs = new Set<EntityListener>();
export function onEntity(cb: EntityListener): () => void {
  entitySubs.add(cb);
  return () => entitySubs.delete(cb);
}

// ---------------------------------------------------------------- snapshot patching
function patchSnap(fn: (s: Snapshot) => Snapshot): void {
  if (!state.snap) return;
  setState({ snap: fn(state.snap) });
}
const upsert = upsertByRev;

// AC-APP-05 resync: ids deleted while the reconnect snapshot request is in flight, so it cannot resurrect them.
let resyncDeleted: Set<string> | null = null;
/** Re-reads the whole snapshot after a reconnect and merges it by record revision (newer copy wins). */
export async function resync(fetchSnapshot: () => Promise<Snapshot>): Promise<void> {
  const deleted = new Set<string>();
  resyncDeleted = deleted;
  try {
    const fresh = await fetchSnapshot();
    setState((s) => ({ snap: mergeResync(s.snap, fresh, deleted) }));
    recomputeCapabilities();
  } finally {
    if (resyncDeleted === deleted) resyncDeleted = null;
  }
}

let toastSeq = 1;
export function pushToast(arg: Omit<Toast, "id">, ttl = 6000): number {
  const id = toastSeq++;
  // The same notice again (e.g. a second “cần đăng nhập lại”) replaces the one on screen instead of stacking copies.
  const same = (x: Toast) => x.tone === arg.tone && x.title === arg.title && x.body === arg.body && x.route === arg.route && !x.action && !arg.action;
  setState((s) => ({ toasts: [...s.toasts.filter((x) => !same(x)).slice(-3), { ...arg, id }] }));
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}
export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((item) => item.id !== id) }));
}

let navigateFn: (route: string) => void = () => undefined;
export function bindNavigate(fn: (route: string) => void): void {
  navigateFn = fn;
}

export function applyEvents(batch: { type: string; payload: unknown; rev: number }[]): void {
  setState({ lastBeat: Date.now(), connected: true });
  for (const e of batch) {
    const p = e.payload as never;
    if (resyncDeleted && e.type.endsWith(".deleted")) resyncDeleted.add((p as { id: string }).id);
    switch (e.type) {
      case "account":
        patchSnap((s) => ({ ...s, accounts: upsert(s.accounts, p as Account) }));
        break;
      case "account.deleted":
        patchSnap((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== (p as { id: string }).id) }));
        break;
      case "proxy":
        if (p) patchSnap((s) => ({ ...s, proxies: upsert(s.proxies, p as Proxy) }));
        break;
      case "proxy.deleted":
        patchSnap((s) => ({ ...s, proxies: s.proxies.filter((x) => x.id !== (p as { id: string }).id) }));
        break;
      case "batch":
        patchSnap((s) => ({ ...s, batches: upsert(s.batches, p as Batch) }));
        break;
      case "batch.deleted":
        patchSnap((s) => ({ ...s, batches: s.batches.filter((x) => x.id !== (p as { id: string }).id) }));
        break;
      case "settings":
        patchSnap((s) => ({ ...s, settings: p as Settings }));
        break;
      case "engine":
        patchSnap((s) => ({ ...s, engine: p as EngineStatus }));
        break;
      case "counts":
        patchSnap((s) => ({ ...s, counts: p as Snapshot["counts"] }));
        break;
      case "chain":
        patchSnap((s) => ({ ...s, chains: upsert(s.chains ?? [], p as ExtendChain) }));
        break;
      case "snapshotCaps":
        patchSnap((s) => ({ ...s, capabilities: p as Record<CapabilityKey, boolean> }));
        break;
      case "login": {
        const lp = p as LoginProgressView;
        if (lp.done) {
          // One summary per login flow, whatever screen is open (S07c2); the finished flow is then forgotten.
          loginSummary(lp);
          setState((s) => {
            const next = { ...s.logins };
            delete next[lp.accountId];
            return { logins: next };
          });
        } else setState((s) => ({ logins: { ...s.logins, [lp.accountId]: lp } }));
        break;
      }
      case "api":
        patchSnap((s) => ({ ...s, api: p as ApiStatus }));
        break;
      case "preview": {
        const { accountId, dataUrl } = p as { accountId: string; dataUrl: string };
        setState((s) => ({ previews: { ...s.previews, [accountId]: dataUrl } }));
        break;
      }
      case "notice": {
        const n = p as { kind: string; title: string; body: string; route: string };
        const tone = n.kind === "batch_done" || n.kind === "chain_done" ? "ok" : n.kind === "info" ? "info" : "attention";
        pushToast({ tone, title: n.title, body: n.body, route: n.route }, 8000);
        setState({ live: `${n.title}. ${n.body}` });
        break;
      }
      case "navigate":
        navigateFn((p as { route: string }).route);
        break;
      case "confirmQuit":
        setState({ confirmQuit: p as { running: number } });
        break;
      case "heartbeat":
        break;
      default:
        break;
    }
    if (e.type === "job") trackConversationTurn(p as Job);
    if (e.type === "job" || e.type === "asset" || e.type === "chain") for (const l of entitySubs) l(e.type, p);
  }
  // capabilities follow account states
  if (batch.some((e) => e.type === "account" || e.type === "account.deleted")) recomputeCapabilities();
}

function trackConversationTurn(j: Job): void {
  const s = state.snap;
  if (!s || !j?.conversationId) return;
  const next = nextBusyConversations(s.busyConversations, j);
  if (next !== s.busyConversations) patchSnap((x) => ({ ...x, busyConversations: next }));
}

/** S07c2 — the toast at the end of a login flow, from the flow's own step results (the account event may lag). */
export function loginSummaryText(lp: LoginProgressView, acc: Pick<Account, "alias" | "state" | "vibes">): { tone: "ok" | "attention"; title: string; body?: string } | null {
  const m = lp.steps.find((x) => x.site === "muse")?.state;
  if (m === "timeout") return { tone: "attention", title: t("{alias}: bước đăng nhập Muse đã dừng sau 15 phút", { alias: acc.alias }) };
  if (m === "done" || m === "skipped") return { tone: "ok", title: t("{alias} đã sẵn sàng", { alias: acc.alias }) };
  return null;
}

function loginSummary(lp: LoginProgressView): void {
  const acc = state.snap?.accounts.find((a) => a.id === lp.accountId);
  const cur = acc ? loginSummaryText(lp, acc) : null;
  if (cur) pushToast(cur, 4500);
}

/** Muse capabilities follow account states; Vibes capabilities depend only on what the main process verified. */
function recomputeCapabilities(): void {
  patchSnap((s) => {
    const next = enabledCapabilities(s.accounts);
    for (const k of Object.keys(next) as CapabilityKey[]) if (isVibesCapability(k)) next[k] = !!s.capabilities?.[k];
    return { ...s, capabilities: next };
  });
}
