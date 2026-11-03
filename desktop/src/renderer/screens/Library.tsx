import { museExtendEligibility } from "@shared/museExtend";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ArrowRightToLine, ChevronLeft, ChevronRight, Copy, ExternalLink, Film, FolderOpen, Heart, Image as ImageIcon, Images, Layers, Play, RefreshCw, Search, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes, formatDateTime, formatElapsed, formatNumber, formatTime } from "@shared/format";
import type { Asset, Batch, JobKind, Page } from "@shared/types";
import { Confirm, Menu, useLayer, useOverlayPresence } from "../components/Overlay";
import { Button, Empty, IconButton, SectionTitle, SitePill, Spinner } from "../components/ui";
import { act, call } from "../lib/api";
import { useDebounced, useFocusTrap, useHotkey, useWindowWidth } from "../lib/hooks";
import { navigate } from "../lib/router";
import { onEntity, pushToast, setState, useUi } from "../lib/store";
import { assetUrl, cx, thumbUrl } from "../lib/ui";
import { useAsReference } from "./JobCard";
import { Lineage, openExtend } from "./Extend";
import { t } from "@shared/i18n";

// S06 library grid (virtualized rows) + S06b lightbox. Files live on disk; the app only indexes them (R13).

const memory: { kind: JobKind | "all"; batchId: string; account: string; fav: boolean; search: string; scroll: number } = { kind: "all", batchId: "", account: "", fav: false, search: "", scroll: 0 };

export function Library() {
  const [kind, setKind] = useState<JobKind | "all">(memory.kind);
  const [batchId, setBatchId] = useState(memory.batchId);
  const [account, setAccount] = useState(memory.account);
  const [fav, setFav] = useState(memory.fav);
  const [search, setSearch] = useState(memory.search);
  const q = useDebounced(search, 250);
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<{ batches: { id: string; name: string }[]; accounts: string[] }>({ batches: [], accounts: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmTrash, setConfirmTrash] = useState<string[] | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const req = useRef(0);
  const parent = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const width = useWindowWidth();
  const batches = useUi((s) => s.snap?.batches ?? []);
  const caps = useUi((s) => s.snap?.capabilities);

  useEffect(() => {
    Object.assign(memory, { kind, batchId, account, fav, search });
  }, [kind, batchId, account, fav, search]);

  // S06-chain: a Kéo dài chain is one tile (its newest output) with “Chuỗi · n bản”.
  const filter = useMemo(() => ({ kind: kind === "all" ? undefined : kind, batchId: batchId || undefined, accountAlias: account || undefined, favorite: fav || undefined, search: q || undefined, collapseChains: true }), [kind, batchId, account, fav, q]);
  const matches = useCallback(
    (a: Asset) => !a.trashedAt && a.kind !== "file" && (!filter.kind || a.kind === filter.kind) && (!filter.batchId || (filter.batchId === "__standalone" ? a.batchId === null : a.batchId === filter.batchId)) && (!filter.accountAlias || a.accountAlias === filter.accountAlias) && (!filter.favorite || a.favorite) && (!filter.search || a.prompt.toLowerCase().includes(filter.search.toLowerCase())),
    [filter],
  );

  const load = useCallback(
    async (more: boolean, cur: number | null) => {
      const id = ++req.current;
      setLoading(true);
      try {
        const page = await call<Page<Asset>>("library.query", { ...filter, cursor: more ? cur : null, limit: 240 }, { quiet: true });
        if (id !== req.current) return;
        setItems((prev) => (more ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setTotal(page.total);
      } finally {
        if (id === req.current) setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    void load(false, null);
    setSelected(new Set());
  }, [load]);
  useEffect(() => {
    void call<typeof facets>("library.facets", {}, { quiet: true }).then(setFacets, () => undefined);
  }, [total]);
  useEffect(
    () =>
      onEntity((type, p) => {
        if (type !== "asset") return;
        const a = p as Asset;
        setItems((prev) => {
          const i = prev.findIndex((x) => x.id === a.id);
          if (i >= 0) {
            if (!matches(a)) {
              setTotal((prev) => prev - 1);
              return prev.filter((x) => x.id !== a.id);
            }
            const n = prev.slice();
            n[i] = a;
            return n;
          }
          if (!matches(a)) return prev;
          // A new output of a chain replaces that chain's tile instead of adding a second one.
          const same = a.chainId ? prev.find((x) => x.chainId === a.chainId) : undefined;
          if (same) return [{ ...a, chainCount: (same.chainCount ?? 1) + 1 }, ...prev.filter((x) => x.chainId !== a.chainId)];
          setTotal((prev) => prev + 1);
          return [a, ...prev];
        });
      }),
    [matches],
  );

  useHotkey((e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === "Delete" && selected.size && tag !== "INPUT" && tag !== "TEXTAREA") {
      setConfirmTrash([...selected]);
    } else if (e.key === " " && selected.size === 1 && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
      e.preventDefault();
      setState({ lightbox: { assetId: [...selected][0], ids: items.map((x) => x.id) } });
    }
  });

  const cols = width < 1100 ? 3 : width < 1440 ? 4 : 5;
  const rowCount = Math.ceil(items.length / cols);
  const gridW = (parent.current?.clientWidth ?? width - 400) - 4;
  const cell = Math.floor((gridW - (cols - 1) * 12) / cols);
  const v = useVirtualizer({ count: rowCount, getScrollElement: () => parent.current, estimateSize: () => cell + 12, overscan: 4 });
  useEffect(() => v.measure(), [cell, v]);
  const vRows = v.getVirtualItems();
  useEffect(() => {
    const last = vRows[vRows.length - 1];
    if (last && last.index >= rowCount - 6 && cursor !== null && !loading) void load(true, cursor);
  }, [vRows, rowCount, cursor, loading, load]);

  const ids = items.map((x) => x.id);
  const selAssets = items.filter((a) => selected.has(a.id));
  const allImages = selAssets.length > 0 && selAssets.every((a) => a.kind === "image" && !a.missing);
  // AC-LIB-06: say exactly what to change instead of a silent disabled button.
  const videoBlock = selAssets.some((a) => a.kind === "video") ? t("Bỏ chọn video") : selAssets.some((a) => a.missing) ? t("Bỏ chọn tệp không còn trên máy") : caps && !caps["video.reference"] ? t("Muse chưa hỗ trợ video từ ảnh") : null;
  const videoFromImages = async () => {
    const b = await call<Batch>("batch.fromAssets", { assetIds: [...selected] }).catch(() => null);
    if (b) navigate(`/batch/${b.id}`);
  };
  const toggle = (id: string, e?: React.MouseEvent) => {
    setSelected((s) => {
      const n = new Set(s);
      if (e?.shiftKey && s.size) {
        const lastId = [...s][s.size - 1];
        const a = ids.indexOf(lastId);
        const b = ids.indexOf(id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(ids[i]);
      } else if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  return (
    <div className="flex h-full flex-col px-8 pt-6">
      <SectionTitle
        sub={t("{total} tác phẩm", { total: formatNumber(total) })}
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={cx("size-4", rescanning && "animate-spin")} />}
            onClick={async () => {
              setRescanning(true);
              const r = await call<{ missing: number; restored: number }>("library.rescan").catch(() => null);
              setRescanning(false);
              if (r) pushToast({ tone: "ok", title: t("Đã quét lại thư viện"), body: t("{missing} tệp không còn · {restored} tệp tìm lại được", { missing: r.missing, restored: r.restored }) }, 4000);
              void load(false, null);
            }}
          >
            {t("Quét lại")}
          </Button>
        }
      >
        {t("Thư viện")}
      </SectionTitle>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 items-center rounded-full bg-ink/5 p-1" role="radiogroup" aria-label={t("Loại")}>
          {(
            [
              ["all", t("Tất cả")],
              ["image", t("Ảnh")],
              ["video", "Video"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("h-full rounded-full px-3 text-sm font-medium", kind === k ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        <Menu
          label={t("Lọc theo lô")}
          width={280}
          items={[{ label: t("Mọi lô"), checked: !batchId, onSelect: () => setBatchId("") }, { label: t("Lượt lẻ (Studio)"), checked: batchId === "__standalone", onSelect: () => setBatchId("__standalone") }, ...facets.batches.map((b) => ({ label: b.name, checked: batchId === b.id, onSelect: () => setBatchId(b.id) }))]}
          trigger={(p) => (
            <Button size="sm" {...p}>
              {batchId === "__standalone" ? t("Lượt lẻ") : batchId ? batches.find((b) => b.id === batchId)?.name ?? facets.batches.find((b) => b.id === batchId)?.name ?? t("Lô") : t("Mọi lô")}
            </Button>
          )}
        />
        <Menu
          label={t("Lọc theo tài khoản")}
          items={[{ label: t("Mọi tài khoản"), checked: !account, onSelect: () => setAccount("") }, ...facets.accounts.map((a) => ({ label: a, checked: account === a, onSelect: () => setAccount(a) }))]}
          trigger={(p) => (
            <Button size="sm" {...p}>
              {account || t("Mọi tài khoản")}
            </Button>
          )}
        />
        <Button size="sm" variant={fav ? "primary" : "secondary"} icon={<Heart className="size-4" fill={fav ? "currentColor" : "none"} />} onClick={() => setFav((f) => !f)} aria-pressed={fav}>
          {t("Yêu thích")}
        </Button>
        <div className="relative ml-auto w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Tìm theo prompt (Ctrl+F)")} aria-label={t("Tìm theo prompt")} className="glass-card h-9 w-full rounded-full pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:outline-none" />
        </div>
      </div>
      <div
        ref={parent}
        className="scroll-area relative mt-4 min-h-0 flex-1 pb-24"
        onScroll={(e) => {
          memory.scroll = e.currentTarget.scrollTop;
        }}
      >
        {items.length === 0 && !loading ? (
          <Empty icon={<Images className="size-6" />} title={total === 0 && !q && kind === "all" && !batchId && !fav ? t("Chưa có tác phẩm nào") : t("Không có tác phẩm khớp bộ lọc")} body={total === 0 && !q ? t("Tạo tác phẩm đầu tiên ở Studio — ảnh và video tải về sẽ hiện ở đây.") : undefined} action={<Button variant="primary" onClick={() => navigate("/studio")}>{t("Mở Studio")}</Button>} />
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {vRows.map((vr) => (
              <div key={vr.index} className="absolute inset-x-0 flex gap-3" style={{ top: vr.start, height: cell }}>
                {items.slice(vr.index * cols, vr.index * cols + cols).map((a) => {
                  const sel = selected.has(a.id);
                  return (
                    <div key={a.id} className={cx("group relative overflow-hidden rounded-md bg-canvas-deep ring-1 transition-shadow", sel ? "ring-2 ring-accent" : "ring-line")} style={{ width: cell, height: cell }}>
                      <button type="button" className="block size-full" onClick={(e) => (e.ctrlKey || e.shiftKey || selected.size ? toggle(a.id, e) : setState({ lightbox: { assetId: a.id, ids } }))} aria-label={`${a.kind === "video" ? "Video" : t("Ảnh")}: ${a.prompt.slice(0, 80)}`}>
                        {a.missing ? (
                          <span className="flex size-full flex-col items-center justify-center gap-2 text-sm text-ink-2">
                            <AlertTriangle className="size-5 text-attention-ink" />{" "}{t("Không tìm thấy file")}
                          </span>
                        ) : (
                          <img src={thumbUrl(a.id)} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        )}
                      </button>
                      {a.kind === "video" && !a.missing && (
                        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-ink/70 px-1.5 py-0.5 text-xs text-on-ink">
                          <Play className="size-3" fill="currentColor" /> {a.durationMs ? formatElapsed(a.durationMs).replace(" s", "s") : ""}
                        </span>
                      )}
                      {a.favorite && <Heart className="pointer-events-none absolute right-2 top-2 size-4 text-danger-ink" fill="currentColor" aria-label={t("Yêu thích")} />}
                      {a.chainId && (
                        <span className={cx("pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-ink/70 px-1.5 py-0.5 text-xs text-on-ink")}>
                          <Layers className="size-3" aria-hidden />{" "}{t("Chuỗi · {chainCount} bản", { chainCount: formatNumber(a.chainCount ?? 1) })}
                        </span>
                      )}
                      <label className={cx("absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-surface/90 shadow transition-opacity", sel || selected.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
                        <input type="checkbox" checked={sel} onChange={() => toggle(a.id)} aria-label={t("Chọn")} className="size-3.5 accent-[var(--color-accent)]" />
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-4">
            <Spinner label={t("Đang tải")} />
          </div>
        )}
      </div>
      {selected.size > 0 && (
        <div className="glass-strong fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2" role="toolbar" aria-label={t("Thao tác đã chọn")}>
          <span className="whitespace-nowrap px-1 text-sm font-medium text-ink">{t("Đã chọn {selectedCount}", { selectedCount: formatNumber(selected.size) })}</span>
          <Button size="sm" icon={<Film className="size-4" />} disabled={!allImages || !!videoBlock} aria-describedby={videoBlock ? "lib-video-block" : undefined} title={videoBlock ?? t("Mở lô nháp, mỗi ảnh một dòng")} onClick={() => void videoFromImages()}>
            {t("Tạo video")}
          </Button>
          {videoBlock && (
            <span id="lib-video-block" className="whitespace-nowrap text-sm text-ink-2">
              {videoBlock}
            </span>
          )}
          <Button size="sm" icon={<Trash2 className="size-4" />} onClick={() => setConfirmTrash([...selected])}>
            {t("Thùng rác")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("Bỏ chọn")}
          </Button>
        </div>
      )}
      <Confirm
        open={!!confirmTrash}
        title={t("Chuyển {confirmTrashCount} tệp vào Thùng rác?", { confirmTrashCount: confirmTrash?.length ?? 0 })}
        body={t("Tệp được chuyển vào Thùng rác của Windows, anh vẫn khôi phục được từ đó.")}
        confirmLabel={t("Chuyển vào Thùng rác")}
        danger
        onCancel={() => setConfirmTrash(null)}
        onConfirm={async () => {
          const list = confirmTrash ?? [];
          setConfirmTrash(null);
          const r = await call<{ trashed: number; failed: number }>("library.trash", { assetIds: list }).catch(() => null);
          if (r) pushToast({ tone: r.failed ? "attention" : "ok", title: t("Đã chuyển {trashed} tệp vào Thùng rác{value}", { trashed: r.trashed, value: r.failed ? t(" · {failed} lỗi", { failed: r.failed }) : "" }) }, 3500);
          setSelected(new Set());
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S06b
export function Lightbox() {
  const lb = useUi((s) => s.lightbox);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [broken, setBroken] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ref = useFocusTrap(!!lb);
  const isTop = useLayer(!!lb);
  useOverlayPresence(!!lb, "side");
  const accounts = useUi((s) => s.snap?.accounts);
  const extendCaps = useUi((s) => s.snap?.capabilities);
  const httpOn = useUi((s) => !!s.snap?.settings.bridgeHttpEnabled);
  const close = useCallback(() => setState({ lightbox: null }), []);
  const idx = lb ? lb.ids.indexOf(lb.assetId) : -1;
  const go = useCallback(
    (d: number) => {
      if (!lb) return;
      const n = lb.ids[idx + d];
      if (n) setState({ lightbox: { ...lb, assetId: n } });
    },
    [lb, idx],
  );
  useEffect(() => {
    if (!lb) return;
    setBroken(false);
    void call<Asset | null>("library.get", { assetId: lb.assetId }, { quiet: true }).then(setAsset, () => setAsset(null));
  }, [lb]);
  useEffect(() => {
    if (!lb) return;
    const on = (e: KeyboardEvent) => {
      if (confirmTrash || !isTop()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " && videoRef.current && !["BUTTON", "VIDEO", "INPUT", "TEXTAREA", "A"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        if (videoRef.current.paused) void videoRef.current.play();
        else videoRef.current.pause();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [lb, go, close, confirmTrash, isTop]);
  if (!lb) return null;
  const owner = asset?.sourceOwnerId ? accounts?.find((a) => a.id === asset.sourceOwnerId) ?? null : null;
  const extend = asset?.site === "muse" ? museExtendEligibility(asset, owner, !!extendCaps?.["muse.video.extend"], { httpOn }) : null;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t("Xem lớn")} className="fixed inset-0 z-50 flex bg-canvas/95 backdrop-blur-sm">
      {/* The stage takes focus on open so ← → Space work at once (AC-LIB-05); buttons keep their own Space/Enter. */}
      <div
        data-autofocus
        tabIndex={0}
        aria-label={asset?.kind === "video" ? t("Video đang xem — Space để phát hoặc dừng, ← → để chuyển") : t("Ảnh đang xem — ← → để chuyển")}
        className={cx("relative flex min-w-0 flex-1 items-center justify-center p-10 pt-14 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60", asset?.chainId && "pb-32")}
      >
        {asset ? (
          broken || asset.missing ? (
            <div className="glass-card flex flex-col items-center gap-3 rounded-lg p-8 text-center">
              <AlertTriangle className="size-6 text-attention-ink" />
              <div className="text-base font-medium text-ink">{asset.missing ? t("Không tìm thấy file trên máy") : t("Không mở được tệp này")}</div>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void act("library.reveal", { assetId: asset.id })}>
                {t("Hiện trong thư mục")}
              </Button>
            </div>
          ) : asset.kind === "video" ? (
            <video ref={videoRef} key={asset.id} src={assetUrl(asset.id)} controls autoPlay loop className="max-h-full max-w-full rounded-md shadow-2xl" onError={() => setBroken(true)} />
          ) : (
            <img key={asset.id} src={assetUrl(asset.id)} alt={asset.prompt} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" onError={() => setBroken(true)} />
          )
        ) : (
          <Spinner label={t("Đang mở")} />
        )}
        {asset?.chainId && (
          <div className="absolute inset-x-10 bottom-5 flex justify-center">
            <Lineage asset={asset} />
          </div>
        )}
        {idx > 0 && (
          <IconButton label={t("Trước (←)")} variant="secondary" size="lg" className="absolute left-5 top-1/2 -translate-y-1/2" onClick={() => go(-1)}>
            <ChevronLeft className="size-5" />
          </IconButton>
        )}
        {idx < lb.ids.length - 1 && (
          <IconButton label={t("Sau (→)")} variant="secondary" size="lg" className="absolute right-5 top-1/2 -translate-y-1/2" onClick={() => go(1)}>
            <ChevronRight className="size-5" />
          </IconButton>
        )}
      </div>
      <aside className="glass-strong m-3 mt-[52px] flex w-[320px] shrink-0 flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-sm text-ink-2">
            {idx + 1}/{lb.ids.length}
          </span>
          <IconButton label={t("Đóng (Esc)")} size="sm" onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>
        {asset && (
          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-4 px-5 py-3">
            <p className="whitespace-pre-wrap text-base text-ink" data-selectable>
              {asset.prompt}
            </p>
            <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-2">{t("Loại")}</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                {asset.kind === "image" ? <><ImageIcon className="size-3.5" />{" "}{t("Ảnh")}</> : <><Film className="size-3.5" /> Video</>}
                <SitePill site={asset.site} />
              </dd>
              {asset.stepIndex ? (
                <>
                  <dt className="text-ink-2">{t("Kéo dài")}</dt>
                  <dd className="text-ink">{t("Lần {stepIndex}", { stepIndex: asset.stepIndex })}</dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t("Kích thước")}</dt>
              <dd className="font-mono text-xs leading-5 text-ink">
                {t("{width}×{height}{value} · {bytes}", { width: asset.width, height: asset.height, value: asset.durationMs ? ` · ${formatElapsed(asset.durationMs)}` : "", bytes: formatBytes(asset.bytes) })}
              </dd>
              <dt className="text-ink-2">{t("Tài khoản")}</dt>
              <dd className="text-ink">{asset.accountAlias ?? "—"}</dd>
              <dt className="text-ink-2">{t("Tạo lúc")}</dt>
              <dd className="font-mono text-xs leading-5 text-ink">{formatDateTime(asset.createdAt)}</dd>
            </dl>
            <div className="flex flex-col gap-2">
              {extend && (
                <>
                  <Button variant={extend.ok ? "primary" : "secondary"} icon={<ArrowRightToLine className="size-4" />} disabled={!extend.ok} aria-describedby={extend.ok ? undefined : "lb-extend-why"} onClick={() => openExtend(asset.id, asset)}>
                    {t("Kéo dài video")}
                  </Button>
                  {!extend.ok && (
                    <p id="lb-extend-why" className="-mt-1 text-xs text-ink-2">
                      {t(extend.reason)}
                    </p>
                  )}
                </>
              )}
              <Button icon={<ExternalLink className="size-4" />} onClick={() => void act("library.open", { assetId: asset.id })}>
                {t("Mở file")}
              </Button>
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void act("library.reveal", { assetId: asset.id })}>
                {t("Hiện trong thư mục")}
              </Button>
              <Button icon={<Copy className="size-4" />} onClick={() => void act("library.copyFile", { assetId: asset.id }, t("Đã chép file"))}>
                {t("Chép file")}
              </Button>
              <Button icon={<Heart className="size-4" fill={asset.favorite ? "currentColor" : "none"} />} onClick={async () => setAsset((await act<Asset>("library.favorite", { assetId: asset.id, value: !asset.favorite })) ?? asset)}>
                {asset.favorite ? t("Bỏ yêu thích") : t("Yêu thích")}
              </Button>
              {asset.kind === "image" && (
                <>
                  <Button
                    icon={<Wand2 className="size-4" />}
                    onClick={() => {
                      close();
                      void useAsReference(asset, "image");
                    }}
                  >
                    {t("Dùng làm ảnh tham chiếu")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Film className="size-4" />}
                    onClick={() => {
                      close();
                      void useAsReference(asset, "video");
                    }}
                  >
                    {t("Tạo video từ ảnh này")}
                  </Button>
                </>
              )}
              {asset.kind === "video" && <Button icon={<Wand2 className="size-4" />} onClick={() => { close(); void useAsReference(asset, "video"); }}>{t("Sửa video")}</Button>}
              <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmTrash(true)}>
                {t("Thùng rác")}
              </Button>
            </div>
          </div>
        )}
      </aside>
      <Confirm
        open={confirmTrash}
        title={t("Chuyển tệp này vào Thùng rác?")}
        body={t("Anh vẫn khôi phục được từ Thùng rác của Windows.")}
        confirmLabel={t("Chuyển vào Thùng rác")}
        danger
        onCancel={() => setConfirmTrash(false)}
        onConfirm={async () => {
          setConfirmTrash(false);
          if (!asset) return;
          const r = await call<{ trashed: number }>("library.trash", { assetIds: [asset.id] }).catch(() => null);
          if (r?.trashed) {
            const next = lb.ids[idx + 1] ?? lb.ids[idx - 1];
            const ids = lb.ids.filter((x) => x !== asset.id);
            setState({ lightbox: next ? { assetId: next, ids } : null });
          }
        }}
      />
    </div>,
    document.body,
  );
}
