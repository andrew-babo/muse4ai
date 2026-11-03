import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRightToLine, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allowedActions } from "@shared/jobMachine";
import { formatNumber } from "@shared/format";
import type { Account, Job, JobKind, JobState } from "@shared/types";
import { Confirm } from "../components/Overlay";
import { Button, Empty, SectionTitle, Spinner } from "../components/ui";
import { call } from "../lib/api";
import { useDebounced, useHotkey, useWindowWidth } from "../lib/hooks";
import { useJobList } from "../lib/jobs";
import { useRoute } from "../lib/router";
import { onEntity, pushToast, setState, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { ChainCard, chainActive } from "./Extend";
import { GRID, QueueRow, QuickPreview, type PreviewAnchor } from "./QueueRow";
import { t } from "@shared/i18n";

// S04 — Queue: every job, filter pills with counts, search, multi-select. Virtualized for 10.000 rows (AC-PERF-01);
// rows show what each job made and a quick look on hover/focus (Build 2.0 R117–R119).

const HOVER_DELAY_MS = 300;
const HIDE_GRACE_MS = 120;

const FILTERS: { key: string; label: string; states: JobState[]; kind?: JobKind }[] = [
  { key: "all", label: "Tất cả", states: [] },
  { key: "chat", label: "Hỏi đáp", states: [], kind: "chat" },
  { key: "running", label: "Đang chạy", states: ["preparing", "submitting", "submitted", "generating", "downloading", "download_retry"] },
  { key: "waiting", label: "Đang chờ", states: ["queued", "held", "retry_wait"] },
  { key: "review", label: "Cần xem", states: ["needs_review"] },
  { key: "failed", label: "Lỗi", states: ["failed"] },
  { key: "completed", label: "Xong", states: ["completed"] },
  { key: "cancelled", label: "Đã huỷ", states: ["cancelled"] },
];

const memory = { filter: "all", search: "", scroll: 0 };

export function Queue() {
  const r = useRoute();
  const initial = new URLSearchParams(r.path.split("?")[1] ?? "").get("f");
  const [filter, setFilter] = useState(initial ?? memory.filter);
  const [search, setSearch] = useState(memory.search);
  const q = useDebounced(search, 250);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as [string, Account])), [accounts]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const parent = useRef<HTMLDivElement | null>(null);
  const width = useWindowWidth();
  const narrow = width < 1100;
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];

  useEffect(() => {
    memory.filter = filter;
    memory.search = search;
  }, [filter, search]);
  useEffect(() => {
    if (r.name === "queue" && r.jobId) setState({ detailJobId: r.jobId });
    if (r.name === "queue" && r.chainId) setState({ chainId: r.chainId });
  }, [r.name, r.name === "queue" ? r.jobId : undefined, r.name === "queue" ? r.chainId : undefined]);
  const allChains = useUi((s) => s.snap?.chains);
  const activeChains = useMemo(() => (allChains ?? []).filter(chainActive), [allChains]);
  const [allChainsShown, setAllChainsShown] = useState(false);
  useEffect(() => {
    if (initial) setFilter(initial);
  }, [initial]);

  const list = useJobList(
    { states: f.states.length ? f.states : undefined, kind: f.kind, search: q || undefined, order: "desc" },
    {
      key: `${filter}|${q}`,
      matches: (j: Job) => (!f.states.length || f.states.includes(j.state)) && (!f.kind || j.kind === f.kind) && (!q || j.prompt.toLowerCase().includes(q.toLowerCase())),
      pageSize: 200,
      firstPageSize: 60,
    },
  );

  // Pill counts follow the event stream (debounced).
  useEffect(() => {
    let cur: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => void call<Record<string, number>>("job.stateCounts", { search: q || undefined }, { quiet: true }).then(setCounts, () => undefined);
    refresh();
    const off = onEntity((type) => {
      if (type !== "job") return;
      if (cur) clearTimeout(cur);
      cur = setTimeout(refresh, 400);
    });
    return () => {
      off();
      if (cur) clearTimeout(cur);
    };
  }, [q]);

  useEffect(() => {
    if (filter === "failed") void call("job.markFailedSeen", {}, { quiet: true }).catch(() => undefined);
  }, [filter, counts.failed]);

  useHotkey((e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  });

  // ---- quick look (R118): one at a time, after 300 ms of hover or keyboard focus; hidden on leave, scroll, Esc, open.
  const [preview, setPreview] = useState<PreviewAnchor | null>(null);
  const previewRef = useRef<PreviewAnchor | null>(null);
  previewRef.current = preview;
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };
  const hidePreview = useCallback(() => {
    clearTimers();
    setPreview(null);
  }, []);
  const onHover = useCallback((id: string, el: HTMLElement, x: number | null) => {
    if (previewRef.current?.id === id) {
      // Moving inside the row whose quick look is open keeps it.
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      return;
    }
    clearTimers();
    if (previewRef.current) setPreview(null);
    showTimer.current = setTimeout(() => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      setPreview({ id, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, x });
    }, HOVER_DELAY_MS);
  }, []);
  const onLeave = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = null;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPreview(null), HIDE_GRACE_MS);
  }, []);
  const keepPreview = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);
  useEffect(() => clearTimers, []);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hidePreview();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", hidePreview);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", hidePreview);
    };
  }, [preview, hidePreview]);
  const onOpen = useCallback(
    (id: string) => {
      hidePreview();
      setState({ detailJobId: id });
    },
    [hidePreview],
  );
  const onToggle = useCallback((id: string, on?: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      if (on ?? !n.has(id)) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const rowH = narrow ? 84 : 92;
  const v = useVirtualizer({ count: list.items.length, getScrollElement: () => parent.current, estimateSize: () => rowH, overscan: 12 });
  const vItems = v.getVirtualItems();
  useEffect(() => {
    const last = vItems[vItems.length - 1];
    if (last && last.index >= list.items.length - 30 && list.hasMore) list.loadMore();
  }, [vItems, list]);
  useEffect(() => {
    if (parent.current && memory.scroll) parent.current.scrollTop = memory.scroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countOf = (key: string) => {
    const fx = FILTERS.find((x) => x.key === key)!;
    if (fx.kind === "chat") return counts.chat ?? 0;
    if (!fx.states.length) return counts.all ?? 0;
    return fx.states.reduce((s, st) => s + (counts[st] ?? 0), 0);
  };

  const selJobs = list.items.filter((j) => selected.has(j.id));
  const canCancel = selJobs.filter((j) => ["queued", "held", "retry_wait", "preparing", "needs_review"].includes(j.state));
  const canRetry = selJobs.filter((j) => allowedActions(j.state, { errorClass: j.errorClass }).includes("retry") || j.state === "cancelled");
  const canPrio = selJobs.filter((j) => j.state === "queued");

  const bulk = async (cmd: string, jobs: Job[], label: string) => {
    let ok = 0;
    for (const j of jobs) {
      try {
        await call(cmd, { jobId: j.id }, { quiet: true });
        ok++;
      } catch {
        /* counted below */
      }
    }
    pushToast({ tone: ok === jobs.length ? "ok" : "attention", title: t("{label} {ok}/{jobsCount} lượt", { label, ok: formatNumber(ok), jobsCount: formatNumber(jobs.length) }) }, 3500);
    setSelected(new Set());
  };

  return (
    <div className="flex h-full flex-col px-8 pt-6">
      <SectionTitle sub={t("{all} lượt · {value} đang chạy · {value2} đang chờ", { all: formatNumber(counts.all ?? 0), value: formatNumber(countOf("running")), value2: formatNumber(countOf("waiting")) })}>{t("Hàng chờ")}</SectionTitle>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("Lọc theo trạng thái")} className="flex flex-wrap gap-1.5">
          {FILTERS.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={filter === x.key}
              type="button"
              onClick={() => {
                setFilter(x.key);
                setSelected(new Set());
                if (parent.current) parent.current.scrollTop = 0;
              }}
              className={cx("inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors", filter === x.key ? "bg-ink text-on-ink" : "glass-card text-ink hover:bg-surface")}
            >
              {t(x.label)}
              <span className={cx("rounded-full px-1.5 text-xs", filter === x.key ? "bg-on-ink/20" : x.key === "review" && countOf(x.key) ? "bg-attention-soft text-attention-ink" : "bg-ink/6 text-ink-2")}>{formatNumber(countOf(x.key))}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Tìm prompt (Ctrl+F)")}
            aria-label={t("Tìm prompt")}
            className="glass-card h-9 w-full rounded-full pl-9 pr-8 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />
          {search && (
            <button type="button" aria-label={t("Xoá tìm kiếm")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-2 hover:bg-ink/5" onClick={() => setSearch("")}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {activeChains.length > 0 && (
        <section className="mt-4" aria-label={t("Chuỗi kéo dài đang chạy")}>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2">
            <ArrowRightToLine className="size-4" aria-hidden />{" "}{t("Chuỗi kéo dài · {activeChainsCount}", { activeChainsCount: formatNumber(activeChains.length) })}
            {activeChains.length > 2 && (
              <button type="button" className="ml-auto text-sm font-semibold text-accent-ink hover:underline" onClick={() => setAllChainsShown((v) => !v)}>
                {allChainsShown ? t("Thu gọn") : t("Xem cả {activeChainsCount} chuỗi", { activeChainsCount: formatNumber(activeChains.length) })}
              </button>
            )}
          </div>
          <div className={cx("grid gap-3", narrow ? "grid-cols-1" : "grid-cols-2")}>
            {(allChainsShown ? activeChains : activeChains.slice(0, 2)).map((c) => (
              <ChainCard key={c.id} chain={c} compact />
            ))}
          </div>
        </section>
      )}
      {selected.size > 0 && (
        <div className="glass-strong mt-3 flex flex-wrap items-center gap-2 rounded-full px-4 py-2" role="toolbar" aria-label={t("Thao tác nhiều lượt")}>
          <span className="text-sm font-medium text-ink">{t("Đã chọn {selectedCount}", { selectedCount: formatNumber(selected.size) })}</span>
          <Button size="sm" disabled={!canCancel.length} onClick={() => setConfirmCancel(true)}>
            {t("Huỷ ({canCancelCount})", { canCancelCount: canCancel.length })}
          </Button>
          <Button size="sm" disabled={!canRetry.length} onClick={() => void bulk("job.retry", canRetry, t("Đã thử lại"))}>
            {t("Thử lại ({canRetryCount})", { canRetryCount: canRetry.length })}
          </Button>
          <Button size="sm" disabled={!canPrio.length} onClick={() => void bulk("job.prioritize", canPrio, t("Đã ưu tiên"))}>
            {t("Ưu tiên ({canPrioCount})", { canPrioCount: canPrio.length })}
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            {t("Bỏ chọn")}
          </Button>
        </div>
      )}
      <div className="glass-card mb-5 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
        {!narrow && (
          <div className={cx("grid h-10 shrink-0 items-center border-b border-line px-3 text-xs font-medium text-ink-2", GRID)} role="row">
            <span>
              <input
                type="checkbox"
                aria-label={t("Chọn tất cả lượt đang hiện")}
                checked={list.items.length > 0 && selected.size === list.items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(list.items.map((j) => j.id)) : new Set())}
                className="size-4 accent-[var(--color-ink)]"
              />
            </span>
            <span>{t("Kết quả")}</span>
            <span>Prompt</span>
            <span>{t("Trạng thái")}</span>
            <span>{t("Tài khoản")}</span>
            <span>{t("Giờ")}</span>
            <span className="text-right">{t("Thời gian")}</span>
          </div>
        )}
        <div
          ref={parent}
          className="scroll-area min-h-0 flex-1"
          onScroll={(e) => {
            memory.scroll = e.currentTarget.scrollTop;
            if (preview || showTimer.current) hidePreview();
          }}
          role="grid"
          aria-rowcount={list.total}
          aria-busy={list.loading}
        >
          {list.items.length === 0 && !list.loading ? (
            <Empty
              title={filter === "all" && !q ? t("Chưa có lượt nào") : t("Không có lượt nào ở trạng thái này")}
              body={filter === "all" && !q ? t("Gửi lượt đầu tiên ở Studio hoặc tạo một lô.") : undefined}
              action={
                filter !== "all" || q ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                  >
                    {t("Xoá lọc")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div style={{ height: v.getTotalSize(), position: "relative" }}>
              {vItems.map((vi) => {
                const j = list.items[vi.index];
                if (!j) return null;
                return (
                  <QueueRow
                    key={j.id}
                    job={j}
                    account={j.accountId ? accById.get(j.accountId) ?? null : null}
                    selected={selected.has(j.id)}
                    narrow={narrow}
                    height={rowH}
                    top={vi.start}
                    previewed={preview?.id === j.id}
                    onOpen={onOpen}
                    onToggle={onToggle}
                    onHover={onHover}
                    onLeave={onLeave}
                  />
                );
              })}
            </div>
          )}
          {list.loading && (
            <div className="flex justify-center py-4">
              <Spinner label={t("Đang tải")} />
            </div>
          )}
        </div>
      </div>
      {preview &&
        (() => {
          const pj = list.items.find((x) => x.id === preview.id);
          return pj ? <QuickPreview job={pj} account={pj.accountId ? accById.get(pj.accountId) ?? null : null} anchor={preview} onEnter={keepPreview} onLeave={onLeave} /> : null;
        })()}
      <Confirm
        open={confirmCancel}
        title={t("Huỷ {canCancelCount} lượt?", { canCancelCount: canCancel.length })}
        body={t("Các lượt chưa gửi sẽ không chạy nữa. Anh có thể thử lại sau trong mục Đã huỷ.")}
        confirmLabel={t("Huỷ các lượt")}
        danger
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void bulk("job.cancel", canCancel, t("Đã huỷ"));
        }}
      />
    </div>
  );
}
