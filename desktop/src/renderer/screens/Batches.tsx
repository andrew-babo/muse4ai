import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, CheckCircle2, Download, FileText, FolderOpen, Image as ImageIcon, Layers, Pause, Play, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CSV_SAMPLE, summarize } from "@shared/batchParse";
import { BATCH_MAX_JOBS, REPEAT_MAX } from "@shared/constants";
import { formatDateTime, formatElapsed, formatNumber } from "@shared/format";
import type { Account, Batch, BatchRow, BatchSettings, CapabilityKey, Job, JobKind, JobMode } from "@shared/types";
import { Avatar } from "../components/Avatar";
import { Confirm, Dialog, Menu } from "../components/Overlay";
import { Button, Empty, IconButton, Pill, SectionTitle, Segmented, Spinner, TextInput } from "../components/ui";
import { act, call } from "../lib/api";
import { useNow } from "../lib/hooks";
import { useJobList } from "../lib/jobs";
import { navigate } from "../lib/router";
import { setState, useUi } from "../lib/store";
import { cx, jobLabel, jobPhase, JOB_TONE, PHASES, thumbUrl } from "../lib/ui";
import { t } from "@shared/i18n";

// S05c list · S05a import & check · S05 running batch (AC-BAT-*).

const BATCH_STATE: Record<Batch["state"], { label: string; tone: "neutral" | "accent" | "attention" | "ok" }> = {
  draft: { label: "Nháp", tone: "neutral" },
  running: { label: "Đang chạy", tone: "accent" },
  paused: { label: "Tạm dừng", tone: "attention" },
  done: { label: "Xong", tone: "ok" },
  cancelled: { label: "Đã huỷ", tone: "neutral" },
};

export function BatchList() {
  const batches = useUi((s) => s.snap?.batches ?? []);
  const sorted = [...batches].sort((a, b) => b.createdAt - a.createdAt);
  const [del, setDel] = useState<Batch | null>(null);
  return (
    <div className="scroll-area h-full px-8 pt-6">
      <SectionTitle
        sub={t("Nhập danh sách prompt từ tệp .txt hoặc .csv, kiểm từng dòng rồi chạy đều trên các tài khoản")}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate("/batch/new")}>
            {t("Lô mới")}
          </Button>
        }
      >
        {t("Hàng loạt")}
      </SectionTitle>
      {sorted.length === 0 ? (
        <Empty
          icon={<Layers className="size-6" />}
          title={t("Chưa có lô nào")}
          body={t("Một lô có thể chứa tới 1.000 lượt. Em chạy lần lượt, chia đều cho các tài khoản đang rảnh.")}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate("/batch/new")}>
              {t("Lô mới")}
            </Button>
          }
        />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 pb-8 xl:grid-cols-2">
          {sorted.map((b) => {
            const st = BATCH_STATE[b.state];
            const c = b.counts;
            const total = b.state === "draft" ? summarize(b.rows).totalJobs : c.total;
            const done = c.completed;
            return (
              <li key={b.id}>
                <div className="glass-card flex items-center gap-4 rounded-lg p-4">
                  <button type="button" onClick={() => navigate(`/batch/${b.id}`)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-surface text-ink-2 shadow-sm">
                      <Layers className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-medium text-ink">{b.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                        <Pill tone={st.tone}>{t(st.label)}</Pill>
                        {b.state === "draft" ? t("{total} lượt", { total: formatNumber(total) }) : t("{done}/{total} xong", { done: formatNumber(done), total: formatNumber(total) })}
                        {c.failed > 0 && <span className="text-danger-ink">{t("· {failed} lỗi", { failed: formatNumber(c.failed) })}</span>}
                        {c.review > 0 && <span className="text-attention-ink">{t("· {review} cần xem", { review: formatNumber(c.review) })}</span>}
                        <span className="font-mono text-xs">· {formatDateTime(b.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                  {b.state === "draft" && (
                    <IconButton label={t("Xoá nháp")} size="sm" onClick={() => setDel(b)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Confirm
        open={!!del}
        title={t("Xoá lô nháp?")}
        body={t("“{name}” chưa chạy lượt nào. Xoá sẽ không ảnh hưởng thư viện.", { name: del?.name ?? "" })}
        confirmLabel={t("Xoá nháp")}
        danger
        onCancel={() => setDel(null)}
        onConfirm={() => {
          if (del) void act("batch.delete", { id: del.id });
          setDel(null);
        }}
      />
    </div>
  );
}

export function BatchRoute({ id }: { id: string }) {
  const batch = useUi((s) => s.snap?.batches.find((b) => b.id === id) ?? null);
  if (!batch) return <Empty title={t("Không còn lô này")} action={<Button onClick={() => navigate("/batch")}>{t("Về danh sách lô")}</Button>} />;
  return batch.state === "draft" ? <BatchEditor draft={batch} /> : <BatchRun batch={batch} />;
}

// ------------------------------------------------------------------------------------------------ S05a
export function BatchEditor({ draft }: { draft?: Batch }) {
  const caps = useUi((s) => s.snap?.capabilities);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const [name, setName] = useState(draft?.name ?? "");
  const [settings, setSettings] = useState<BatchSettings>(draft?.settings ?? { kind: "image", mode: "text", accountPref: "auto", repeat: 1 });
  const [rows, setRows] = useState<BatchRow[]>(draft?.rows ?? []);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [baseDir, setBaseDir] = useState<string | undefined>();
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "start">(null);
  const [showSample, setShowSample] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [dragging, setDragging] = useState(false);
  const summary = useMemo(() => summarize(rows), [rows]);

  const parse = async (arg: string, fname?: string, dir?: string) => {
    setParsing(true);
    try {
      const r = await call<{ rows: BatchRow[] }>("batch.parse", { text: arg, fileName: fname, baseDir: dir, defaults: { kind: settings.kind, mode: settings.mode, repeat: settings.repeat } });
      setRows(r.rows);
      if (!name && fname) setName(fname.replace(/\.(txt|csv)$/i, ""));
    } catch {
      /* toast */
    } finally {
      setParsing(false);
    }
  };

  const pick = async () => {
    const r = await call<{ text: string; fileName: string; baseDir: string } | null>("batch.pickFile").catch(() => null);
    if (!r) return;
    setText(r.text);
    setFileName(r.fileName);
    setBaseDir(r.baseDir);
    void parse(r.text, r.fileName, r.baseDir);
  };

  const onDropFile = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return;
    const text2 = await f.text();
    const p = window.muse?.pathForFile(f) ?? "";
    const dir = p ? p.replace(/[\\/][^\\/]*$/, "") : undefined;
    setText(text2);
    setFileName(f.name);
    setBaseDir(dir);
    void parse(text2, f.name, dir);
  };

  const save = async (start: boolean) => {
    setBusy(start ? "start" : "save");
    try {
      const b = await call<Batch>("batch.saveDraft", { id: draftId, name, settings, rows });
      setDraftId(b.id);
      if (start) {
        await call<Batch>("batch.start", { id: b.id });
        navigate(`/batch/${b.id}`, { replace: true });
      } else navigate(`/batch/${b.id}`, { replace: true });
    } catch {
      /* toast */
    } finally {
      setBusy(null);
    }
  };

  const unsupported = (k: JobKind, m: JobMode) => caps && !caps[(k === "chat" ? "chat.text" : `${k}.${m}`) as CapabilityKey];
  const garbled = text.includes("\uFFFD");

  return (
    <div
      className="relative flex h-full flex-col px-8 pt-6"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = Array.from(e.dataTransfer.files).find((x) => /\.(txt|csv)$/i.test(x.name));
        if (f) void onDropFile(f);
      }}
    >
      <SectionTitle
        sub={rows.length ? t("{validCount} dòng hợp lệ · {errorCount} lỗi · {totalJobs} lượt sẽ chạy", { validCount: formatNumber(summary.validCount), errorCount: formatNumber(summary.errorCount), totalJobs: formatNumber(summary.totalJobs) }) : t("Dán danh sách prompt hoặc kéo thả tệp .txt/.csv")}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/batch")}>
              {t("Đóng")}
            </Button>
            <Button onClick={() => void save(false)} loading={busy === "save"} disabled={!rows.length}>
              {t("Lưu nháp")}
            </Button>
            <Button variant="primary" icon={<Play className="size-4" />} loading={busy === "start"} disabled={!summary.validCount || !!summary.batchError} onClick={() => void save(true)} title={summary.batchError ? t(summary.batchError) : undefined}>
              {t("Bắt đầu {totalJobs} lượt", { totalJobs: formatNumber(summary.totalJobs) })}
            </Button>
          </>
        }
      >
        {draft ? t("Lô nháp") : t("Lô mới")}
      </SectionTitle>
      <div className="mt-5 grid min-h-0 flex-1 grid-cols-[minmax(320px,380px)_1fr] gap-4 pb-5">
        <div className="scroll-area flex flex-col gap-4">
          <div className="glass-card flex flex-col gap-3 rounded-lg p-4">
            <label className="text-sm font-medium text-ink" htmlFor="batch-name">
              {t("Tên lô")}
            </label>
            <TextInput id="batch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ví dụ: Bộ ảnh cà phê tháng 10")} maxLength={120} />
            <div className="text-sm font-medium text-ink">{t("Mặc định cho các dòng")}</div>
            <Segmented
              label={t("Loại")}
              value={settings.kind}
              onChange={(k) => setSettings((s) => ({ ...s, kind: k }))}
              options={[
                { value: "image", label: t("Ảnh"), icon: <ImageIcon className="size-4" />, disabled: !!unsupported("image", settings.mode) },
                { value: "video", label: "Video", icon: <Play className="size-4" />, disabled: !!unsupported("video", settings.mode) },
              ]}
            />
            <Segmented
              label={t("Cách tạo")}
              value={settings.mode}
              onChange={(m) => setSettings((s) => ({ ...s, mode: m }))}
              options={[
                { value: "text", label: t("Từ chữ") },
                { value: "reference", label: t("Từ ảnh (cột reference)"), disabled: !!unsupported(settings.kind, "reference") },
              ]}
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-2">{t("Lặp mỗi dòng")}</span>
              <Segmented label={t("Lặp")} size="sm" value={String(settings.repeat)} onChange={(v) => setSettings((s) => ({ ...s, repeat: Number(v) }))} options={Array.from({ length: REPEAT_MAX }, (_, i) => ({ value: String(i + 1), label: t("×{i}", { i: i + 1 }) }))} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-2">{t("Tài khoản")}</span>
              <Menu
                label={t("Tài khoản cho lô")}
                items={[{ label: t("Tự động"), checked: settings.accountPref === "auto", onSelect: () => setSettings((s) => ({ ...s, accountPref: "auto" })) }, ...accounts.map((a) => ({ label: a.alias, checked: settings.accountPref === a.id, onSelect: () => setSettings((s) => ({ ...s, accountPref: a.id })) }))]}
                trigger={(p) => (
                  <Button size="sm" {...p}>
                    {accounts.find((a) => a.id === settings.accountPref)?.alias ?? t("Tự động")}
                  </Button>
                )}
              />
            </div>
            <p className="text-xs text-ink-2">{t("Đổi mặc định sẽ áp cho lần đọc danh sách tiếp theo. Tối đa {BATCH_MAX_JOBS} lượt mỗi lô.", { BATCH_MAX_JOBS: formatNumber(BATCH_MAX_JOBS) })}</p>
          </div>
          <div className="glass-card flex flex-col gap-3 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <label htmlFor="batch-text" className="text-sm font-medium text-ink">
                {t("Danh sách prompt")}
              </label>
              <button type="button" className="text-sm font-medium text-accent-ink hover:underline" onClick={() => setShowSample(true)}>
                {t("Xem mẫu CSV")}
              </button>
            </div>
            <textarea
              id="batch-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("Mỗi dòng một prompt.\nDòng bắt đầu bằng # là ghi chú.")}
              rows={9}
              className="w-full resize-none rounded-[12px] border border-line-strong bg-surface p-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {garbled && (
              <p className="flex items-start gap-2 text-sm text-attention-ink" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />{" "}{t("Có ký tự lạ — tệp có thể không phải UTF-8. Mở tệp trong Notepad, chọn Lưu thành → Mã hoá UTF-8 rồi thử lại.")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void parse(text, fileName, baseDir)} loading={parsing} disabled={!text.trim()}>
                {t("Kiểm danh sách")}
              </Button>
              <Button size="sm" icon={<Upload className="size-4" />} onClick={() => void pick()}>
                {t("Chọn tệp…")}
              </Button>
              {summary.errorCount > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setRows((r) => r.filter((x) => !x.error))}>
                  {t("Bỏ các dòng lỗi")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="glass-card flex min-h-0 flex-col overflow-hidden rounded-lg">
          {summary.batchError && (
            <div className="flex items-center gap-2 bg-danger-soft px-4 py-2 text-sm text-ink" role="alert">
              <AlertTriangle className="size-4 text-danger-ink" /> {t(summary.batchError)}
            </div>
          )}
          {rows.length === 0 ? (
            <Empty icon={<FileText className="size-6" />} title={t("Chưa có dòng nào")} body={t("Dán danh sách bên trái rồi bấm “Kiểm danh sách”, hoặc kéo thả tệp .txt/.csv vào đây.")} />
          ) : (
            <RowsTable rows={rows} onRemove={(line) => setRows((r) => r.filter((x) => x.line !== line))} />
          )}
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft">
          <div className="glass-strong rounded-md px-5 py-3 text-base font-medium text-ink">{t("Thả tệp .txt hoặc .csv")}</div>
        </div>
      )}
      <Dialog open={showSample} onClose={() => setShowSample(false)} title={t("Mẫu CSV")} width={640} footer={<Button onClick={() => setShowSample(false)}>{t("Đóng")}</Button>}>
        <p className="mb-3">{t("Dòng đầu là tiêu đề. Chỉ cột “prompt” bắt buộc; kind = image/video, mode = text/reference, reference = đường dẫn ảnh trên máy, repeat = 1–4.")}</p>
        <pre className="scroll-area rounded-[12px] bg-ink/5 p-3 font-mono text-xs text-ink" data-selectable>
          {t(CSV_SAMPLE)}
        </pre>
      </Dialog>
    </div>
  );
}

function RowsTable({ rows, onRemove }: { rows: BatchRow[]; onRemove: (line: number) => void }) {
  const parent = useRef<HTMLDivElement | null>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 52, overscan: 10 });
  return (
    <>
      <div className="grid h-10 shrink-0 grid-cols-[56px_1fr_90px_110px_60px_40px] items-center border-b border-line px-3 text-xs font-medium text-ink-2">
        <span>{t("Dòng")}</span>
        <span>Prompt</span>
        <span>{t("Loại")}</span>
        <span>{t("Cách tạo")}</span>
        <span>{t("Lặp")}</span>
        <span />
      </div>
      <div ref={parent} className="scroll-area min-h-0 flex-1">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div key={r.line} className={cx("absolute inset-x-0 grid grid-cols-[56px_1fr_90px_110px_60px_40px] items-center border-b border-line px-3", r.error && "bg-danger-soft")} style={{ top: vi.start, height: 52 }}>
                <span className="font-mono text-xs text-ink-2">#{r.line}</span>
                <span className="min-w-0 pr-3">
                  <span className="block truncate text-sm text-ink" title={r.prompt}>
                    {r.prompt || <em className="text-ink-3">{t("(trống)")}</em>}
                  </span>
                  {r.error ? (
                    <span className="block truncate text-xs text-danger-ink">{t(r.error)}</span>
                  ) : r.reference ? (
                    <span className="flex items-center gap-1 truncate text-xs text-ink-2" title={r.reference}>
                      <ImageIcon className="size-3" aria-hidden /> {r.reference.split(/[\\/]/).pop()}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-ink-2">{r.kind === "image" ? t("Ảnh") : "Video"}</span>
                <span className="text-sm text-ink-2">{r.mode === "text" ? t("Từ chữ") : t("Từ ảnh")}</span>
                <span className="text-sm text-ink-2">{t("×{repeat}", { repeat: r.repeat })}</span>
                <IconButton label={t("Bỏ dòng {line}", { line: r.line })} size="sm" onClick={() => onRemove(r.line)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ S05
export function BatchRun({ batch }: { batch: Batch }) {
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as [string, Account])), [accounts]);
  const list = useJobList({ batchId: batch.id, order: "asc" }, { key: batch.id, matches: (j: Job) => j.batchId === batch.id, pageSize: 300 });
  const parent = useRef<HTMLDivElement | null>(null);
  const [confirm, setConfirm] = useState<null | "cancel">(null);
  const now = useNow(1000);
  const c = batch.counts;
  const st = BATCH_STATE[batch.state];
  const finished = batch.state === "done" || batch.state === "cancelled";
  const v = useVirtualizer({ count: list.items.length, getScrollElement: () => parent.current, estimateSize: () => 60, overscan: 10 });
  const vItems = v.getVirtualItems();
  useEffect(() => {
    const last = vItems[vItems.length - 1];
    if (last && last.index >= list.items.length - 40 && list.hasMore) list.loadMore();
  }, [vItems, list]);

  const segments = [
    { n: c.completed, cls: "bg-ok", label: "Xong" },
    { n: c.running, cls: "bg-accent", label: t("Đang chạy") },
    { n: c.review, cls: "bg-attention", label: t("Cần xem") },
    { n: c.failed, cls: "bg-danger", label: t("Lỗi") },
    { n: c.cancelled, cls: "bg-neutral", label: t("Đã huỷ") },
    { n: c.waiting, cls: "bg-ink/10", label: t("Đang chờ") },
  ];

  return (
    <div className="flex h-full flex-col px-8 pt-6">
      <SectionTitle
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={st.tone}>{finished ? `${t(st.label)} ${formatNumber(c.completed)}/${formatNumber(c.total)}` : t(st.label)}</Pill>
            <span>
              {t("{completed} xong · {running} đang chạy · {waiting} đang chờ{value}{value2}", { completed: formatNumber(c.completed), running: formatNumber(c.running), waiting: formatNumber(c.waiting), value: c.failed ? t(" · {failed} lỗi", { failed: formatNumber(c.failed) }) : "", value2: c.review ? t(" · {review} cần xem", { review: formatNumber(c.review) }) : "" })}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/batch")}>
              {t("Danh sách lô")}
            </Button>
            {batch.state === "running" && (
              <Button icon={<Pause className="size-4" />} onClick={() => void act("batch.pause", { id: batch.id })}>
                {t("Tạm dừng")}
              </Button>
            )}
            {batch.state === "paused" && (
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void act("batch.resume", { id: batch.id })}>
                {t("Tiếp tục")}
              </Button>
            )}
            {(batch.state === "running" || batch.state === "paused") && c.waiting > 0 && (
              <Button variant="ghost" onClick={() => setConfirm("cancel")}>
                {t("Huỷ phần còn lại")}
              </Button>
            )}
            {c.failed > 0 && (
              <Button icon={<RotateCcw className="size-4" />} onClick={() => void act("batch.retryFailed", { id: batch.id }, t("Đã đưa các lượt lỗi vào hàng chờ"))}>
                {t("Thử lại lượt lỗi")}
              </Button>
            )}
            <Button icon={<FolderOpen className="size-4" />} onClick={() => void act("batch.openFolder", { id: batch.id })}>
              {t("Mở thư mục")}
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => void act<{ path: string } | null>("batch.exportCsv", { id: batch.id })}>
              {t("Xuất CSV")}
            </Button>
          </>
        }
      >
        {batch.name}
      </SectionTitle>
      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-ink/6" role="img" aria-label={segments.filter((s) => s.n).map((s) => `${t(s.label)} ${formatNumber(s.n)}`).join(", ")}>
        {segments.map((s) => (s.n ? <span key={s.label} className={cx("h-full transition-[width] duration-500", s.cls)} style={{ width: `${(s.n / Math.max(1, c.total)) * 100}%` }} /> : null))}
      </div>
      {finished && c.total > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <CheckCircle2 className="size-4 text-ok-ink" />{" "}{t("Lô đã kết thúc. Kết quả nằm trong thư viện, nhóm theo tên lô.")}
        </div>
      )}
      <div className="glass-card mb-5 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
        <div className="grid h-10 shrink-0 grid-cols-[56px_1fr_150px_130px_90px_64px] items-center border-b border-line px-3 text-xs font-medium text-ink-2">
          <span>#</span>
          <span>Prompt</span>
          <span>{t("Trạng thái")}</span>
          <span>{t("Tài khoản")}</span>
          <span className="text-right">{t("Thời gian")}</span>
          <span />
        </div>
        <div ref={parent} className="scroll-area min-h-0 flex-1">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {vItems.map((vi) => {
              const j = list.items[vi.index];
              if (!j) return null;
              const acc = j.accountId ? accById.get(j.accountId) ?? null : null;
              const ph = jobPhase(j.state);
              const elapsed = j.startedAt ? (j.completedAt ?? now) - j.startedAt : null;
              const a0 = j.assets[0];
              return (
                <button key={j.id} type="button" onClick={() => setState({ detailJobId: j.id })} className="absolute inset-x-0 grid grid-cols-[56px_1fr_150px_130px_90px_64px] items-center border-b border-line px-3 text-left hover:bg-surface/70" style={{ top: vi.start, height: 60 }}>
                  <span className="font-mono text-xs text-ink-2">{vi.index + 1}</span>
                  <span className="min-w-0 truncate pr-3 text-sm text-ink" title={j.prompt}>
                    {j.prompt}
                  </span>
                  <span className="flex flex-col items-start gap-0.5">
                    <Pill tone={JOB_TONE[j.state]}>{jobLabel(j.state)}</Pill>
                    {ph >= 0 && <span className="text-[11px] text-ink-2">{t(PHASES[ph])}</span>}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                    {acc && <Avatar account={acc} size={22} showStatus={false} />}
                    <span className="truncate">{acc?.alias ?? "—"}</span>
                  </span>
                  <span className="text-right font-mono text-xs text-ink-2">{elapsed !== null ? formatElapsed(elapsed) : "—"}</span>
                  <span className="flex justify-end">{a0 ? <img src={thumbUrl(a0.id)} alt="" className="size-10 rounded-[8px] object-cover ring-1 ring-line" loading="lazy" /> : j.state === "failed" ? <AlertTriangle className="size-4 text-danger-ink" aria-label={t("Lỗi")} /> : null}</span>
                </button>
              );
            })}
          </div>
          {list.loading && (
            <div className="flex justify-center py-4">
              <Spinner label={t("Đang tải")} />
            </div>
          )}
        </div>
      </div>
      <Confirm
        open={confirm === "cancel"}
        title={t("Huỷ phần còn lại của lô?")}
        body={t("{waiting} lượt chưa chạy sẽ bị huỷ. Lượt đang tạo vẫn chạy tiếp cho tới khi xong.", { waiting: formatNumber(c.waiting) })}
        confirmLabel={t("Huỷ phần còn lại")}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void act("batch.cancelRemaining", { id: batch.id });
        }}
      />
    </div>
  );
}
