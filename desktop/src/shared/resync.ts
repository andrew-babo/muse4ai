// AC-APP-05: after the renderer reconnects it re-reads the whole snapshot, but events keep arriving while that
// request is in flight. Every record carries the store's monotonic `rev`, so the newer copy of each record wins
// no matter which arrived first. Pure (no Electron/DOM) so it is unit-tested in plain Node.
import type { Snapshot } from "./types";

type Revved = { id: string; rev: number };

/** Upsert that never lets an older copy of a record replace a newer one (equal rev → incoming, e.g. fresher counts). */
export function upsertByRev<T extends Revved>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  if (list[i].rev > item.rev) return list;
  const next = list.slice();
  next[i] = item;
  return next;
}

function mergeList<T extends Revved>(current: T[], fresh: T[], freshRev: number, deleted: ReadonlySet<string>): T[] {
  const cur = new Map(current.map((x) => [x.id, x]));
  const out = fresh.filter((x) => !deleted.has(x.id)).map((x) => {
    const c = cur.get(x.id);
    return c && c.rev > x.rev ? c : x;
  });
  const have = new Set(out.map((x) => x.id));
  // Created (and already delivered by an event) after the snapshot was read.
  for (const c of current) if (!have.has(c.id) && !deleted.has(c.id) && c.rev > freshRev) out.push(c);
  return out;
}

/**
 * Snapshot to show after a reconnect: the fresh snapshot, except records an event already delivered in a newer
 * revision, records created after the snapshot was read, and records deleted while the request was in flight.
 */
export function mergeResync(current: Snapshot | null, fresh: Snapshot, deletedSinceRequest: ReadonlySet<string> = new Set()): Snapshot {
  if (!current) return fresh;
  return {
    ...fresh,
    accounts: mergeList(current.accounts, fresh.accounts, fresh.rev, deletedSinceRequest),
    proxies: mergeList(current.proxies, fresh.proxies, fresh.rev, deletedSinceRequest),
    batches: mergeList(current.batches, fresh.batches, fresh.rev, deletedSinceRequest),
    chains: mergeList(current.chains ?? [], fresh.chains ?? [], fresh.rev, deletedSinceRequest),
    rev: Math.max(current.rev, fresh.rev),
  };
}
