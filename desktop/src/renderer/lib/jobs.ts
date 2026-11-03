import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Job, JobFilter } from "@shared/types";
import { call } from "./api";
import { onEntity } from "./store";

// Paged job lists that stay live from the event stream (job/asset events), shared by Studio, Queue and Batch screens.

export type JobItem = Job & { assets: Asset[] };

interface Page {
  items: JobItem[];
  nextCursor: number | null;
  total: number;
}

/** Appends a page to the loaded rows, skipping rows a live event already inserted (one Set lookup per row). */
export function mergePage(prev: JobItem[], page: JobItem[]): JobItem[] {
  if (!prev.length) return page;
  const have = new Set(prev.map((x) => x.id));
  const fresh = page.filter((p) => !have.has(p.id));
  return fresh.length ? [...prev, ...fresh] : prev;
}

export function useJobList(
  filter: JobFilter,
  opts: { key: string; matches: (j: Job) => boolean; pageSize?: number; firstPageSize?: number; enabled?: boolean },
) {
  const [items, setItems] = useState<JobItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const matchRef = useRef(opts.matches);
  matchRef.current = opts.matches;
  const order = filter.order ?? "desc";
  const pageSize = opts.pageSize ?? 100;
  // R119: the first page only needs to fill the screen, so a filter/search switch answers quickly on slow machines;
  // later pages load ahead while scrolling.
  const firstPageSize = Math.min(opts.firstPageSize ?? pageSize, pageSize);

  const load = useCallback(
    async (more: boolean, cur: number | null) => {
      const id = ++reqId.current;
      setLoading(true);
      try {
        const page = await call<Page>("job.query", { ...filterRef.current, cursor: more ? cur : null, limit: more ? pageSize : firstPageSize }, { quiet: true });
        if (id !== reqId.current) return; // out-of-order response (G1)
        setItems((prev) => (more ? mergePage(prev, page.items) : page.items));
        setCursor(page.nextCursor);
        setTotal(page.total);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [pageSize, firstPageSize],
  );

  useEffect(() => {
    if (opts.enabled === false) return;
    setItems([]);
    setCursor(null);
    void load(false, null);
  }, [opts.key, opts.enabled, load]);

  useEffect(
    () =>
      onEntity((type, payload) => {
        if (type === "job") {
          const j = payload as Job;
          setItems((prev) => {
            const i = prev.findIndex((x) => x.id === j.id);
            const ok = matchRef.current(j);
            if (i >= 0) {
              if (!ok) {
                setTotal((prev) => Math.max(0, prev - 1));
                return prev.filter((x) => x.id !== j.id);
              }
              const next = prev.slice();
              next[i] = { ...prev[i], ...j, assets: prev[i].assets };
              return next;
            }
            if (!ok) return prev;
            setTotal((prev) => prev + 1);
            const item = { ...j, assets: [] };
            return order === "desc" ? [item, ...prev] : [...prev, item];
          });
        } else if (type === "asset") {
          const a = payload as Asset;
          setItems((prev) => {
            const i = prev.findIndex((x) => x.id === a.jobId);
            if (i < 0) return prev;
            const cur = prev[i];
            const assets = a.trashedAt ? cur.assets.filter((x) => x.id !== a.id) : cur.assets.some((x) => x.id === a.id) ? cur.assets.map((x) => (x.id === a.id ? a : x)) : [...cur.assets, a];
            const next = prev.slice();
            next[i] = { ...cur, assets };
            return next;
          });
        }
      }),
    [order],
  );

  return {
    items,
    total,
    loading,
    error,
    hasMore: cursor !== null,
    loadMore: () => {
      if (cursor !== null && !loading) void load(true, cursor);
    },
    reload: () => void load(false, null),
  };
}

export const RUNNING_STATES = ["preparing", "submitting", "submitted", "generating", "downloading", "download_retry"] as const;
export const WAITING_STATES = ["queued", "held", "retry_wait"] as const;
