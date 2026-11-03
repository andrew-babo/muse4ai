import { AlertTriangle, Ban, Clock3, FileWarning, Film, Image as ImageIcon, Loader2, MessageSquare, Play } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { formatDateTime, formatElapsed, formatNumber, formatTime } from "@shared/format";
import { t } from "@shared/i18n";
import { ERROR_HINT } from "@shared/jobMachine";
import { plainText } from "@shared/markdown";
import type { Account, Asset, Job, JobKind } from "@shared/types";
import { ApiSourcePill } from "../components/ApiSource";
import { Avatar } from "../components/Avatar";
import { Pill, SitePill } from "../components/ui";
import { useNow } from "../lib/hooks";
import type { JobItem } from "../lib/jobs";
import { assetUrl, cx, jobLabel, jobPhase, JOB_TONE, PHASES, refUrl, thumbUrl } from "../lib/ui";
import { AnswerBody } from "./ChatResult";

// S04 rows (Build 2.0 R117–R119): a 16:9 picture of what the job made (or is making), two prompt lines, and a quick
// look on hover/focus. Rows are memoised and only a running row's own clock ticks, so a 10.000-job list never
// re-renders every second.

export const KIND_LABEL: Record<JobKind, string> = { image: "Ảnh", video: "Video", chat: "Hỏi đáp" };

const RUNNING = new Set<Job["state"]>(["preparing", "submitting", "submitted", "generating", "downloading", "download_retry"]);
const WAITING = new Set<Job["state"]>(["queued", "held", "retry_wait"]);

export const isRunning = (j: Pick<Job, "state">) => RUNNING.has(j.state);

/** Extend steps read “Kéo dài · lần k” first, so a row says what it does even when the prompt is the root's. */
export function rowTitle(j: Job): string {
  return j.operation === "extend" ? t("Kéo dài · lần {step} · {prompt}", { step: j.stepIndex ?? 1, prompt: j.prompt }) : j.prompt;
}

/** Media files a job returned (images/videos; documents are shown as a count). */
function mediaOf(j: JobItem): Asset[] {
  return j.assets.filter((a) => a.kind === "image" || a.kind === "video");
}

export function KindIcon({ kind, className }: { kind: JobKind; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "chat" ? MessageSquare : Film;
  return <Icon className={className} aria-hidden />;
}

/** Time the job has been running (or ran). Only a running job's cell ticks (R119). */
export function Elapsed({ job, className }: { job: Pick<Job, "state" | "startedAt" | "completedAt" | "updatedAt">; className?: string }) {
  const running = RUNNING.has(job.state) && !!job.startedAt && !job.completedAt;
  const now = useNow(1000, running);
  if (!job.startedAt) return <span className={className}>—</span>;
  const end = job.completedAt ?? (running ? now : job.updatedAt);
  return <span className={className}>{formatElapsed(Math.max(0, end - job.startedAt))}</span>;
}

function Duration({ ms }: { ms: number | null }) {
  if (!ms) return null;
  return <span className="rounded-[5px] bg-ink/70 px-1 py-px font-mono text-[10px] leading-4 text-on-ink">{formatElapsed(ms).replace(" s", "s")}</span>;
}

/** The 16:9 picture at the start of a row (R117). */
export function QueueTile({ job, className }: { job: JobItem; className?: string }) {
  const media = mediaOf(job);
  const first = media[0];
  const [refBroken, setRefBroken] = useState(false);
  const base = cx("relative flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] ring-1 ring-line", className);

  if (first) {
    if (first.missing)
      return (
        <span className={cx(base, "flex-col gap-0.5 bg-ink/5 text-ink-2")} data-tile="missing">
          <FileWarning className="size-4 text-attention-ink" aria-hidden />
          <span className="px-1 text-center text-[10px] leading-3">{t("Không tìm thấy tệp")}</span>
        </span>
      );
    return (
      <span className={cx(base, "bg-canvas-deep")} data-tile={first.kind}>
        <img src={thumbUrl(first.id)} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
        {first.kind === "video" && (
          <>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-6 items-center justify-center rounded-full bg-ink/65 text-on-ink backdrop-blur-sm">
                <Play className="ml-px size-3" fill="currentColor" aria-hidden />
              </span>
            </span>
            <span className="absolute bottom-1 right-1">
              <Duration ms={first.durationMs} />
            </span>
          </>
        )}
        {media.length > 1 && <span className="absolute left-1 top-1 rounded-[5px] bg-ink/70 px-1 py-px text-[10px] font-semibold leading-4 text-on-ink">{formatNumber(media.length)}</span>}
      </span>
    );
  }

  if (job.kind === "chat" && job.resultText) {
    const line = plainText(job.resultText).replace(/\s+/g, " ").slice(0, 90);
    return (
      <span className={cx(base, "items-start justify-start bg-surface p-1.5 text-left")} data-tile="chat">
        <MessageSquare className="absolute right-1 top-1 size-3 text-ink-3" aria-hidden />
        <span className="line-clamp-3 pr-3 text-[10.5px] leading-[14px] text-ink-2">{line}</span>
      </span>
    );
  }

  if (job.state === "failed" || job.state === "needs_review") {
    const failed = job.state === "failed";
    return (
      <span className={cx(base, "flex-col gap-1", failed ? "bg-danger-soft text-danger-ink" : "bg-attention-soft text-attention-ink")} data-tile={failed ? "failed" : "review"}>
        <AlertTriangle className="size-4" aria-hidden />
        <span className="text-[10.5px] font-medium leading-3">{failed ? t("Lỗi") : t("Cần xem")}</span>
      </span>
    );
  }

  const refId = job.kind !== "chat" ? job.referenceIds[0] : undefined;
  const running = RUNNING.has(job.state);
  const phase = jobPhase(job.state);
  return (
    <span className={cx(base, running ? "shimmer-bg" : "bg-ink/5", job.state === "cancelled" && "opacity-60")} data-tile={running ? "running" : job.state === "cancelled" ? "cancelled" : "waiting"}>
      {refId && !refBroken && <img src={refUrl(refId)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setRefBroken(true)} className="absolute inset-0 size-full scale-110 object-cover opacity-45 blur-[3px]" />}
      <span className="relative flex flex-col items-center gap-0.5 text-ink-2">
        {running ? <Loader2 className="size-4 animate-spin text-accent-ink" aria-hidden /> : job.state === "cancelled" ? <Ban className="size-4" aria-hidden /> : WAITING.has(job.state) ? <Clock3 className="size-4" aria-hidden /> : <KindIcon kind={job.kind} className="size-4" />}
        <span className="text-[10.5px] font-medium leading-3 text-ink">{running && phase >= 0 ? t(PHASES[phase]) : job.state === "cancelled" ? t("Đã huỷ") : t(KIND_LABEL[job.kind])}</span>
      </span>
    </span>
  );
}

export interface RowProps {
  job: JobItem;
  account: Account | null;
  selected: boolean;
  narrow: boolean;
  height: number;
  top: number;
  /** This row's quick look is open (a boolean, so opening one preview re-renders two rows, not the whole list). */
  previewed: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, on?: boolean) => void;
  onHover: (id: string, el: HTMLElement, x: number | null) => void;
  onLeave: () => void;
}

export const GRID = "grid-cols-[40px_140px_minmax(0,1fr)_150px_140px_64px_72px]";

export const QueueRow = memo(function QueueRow({ job: j, account: acc, selected, narrow, height, top, previewed, onOpen, onToggle, onHover, onLeave }: RowProps) {
  const title = rowTitle(j);
  const who = acc?.alias ?? (j.accountPref === "auto" ? t("Tự động") : "—");
  return (
    <div
      role="row"
      aria-selected={selected}
      aria-describedby={previewed ? "queue-preview" : undefined}
      data-job={j.id}
      tabIndex={0}
      onClick={() => onOpen(j.id)}
      // Hover intent: the quick look waits for the pointer to rest, and rows sliding under a still pointer (new jobs
      // arriving) never open one, because only real pointer movement starts the wait.
      onMouseMove={(e) => onHover(j.id, e.currentTarget, e.clientX)}
      onMouseLeave={onLeave}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onHover(j.id, e.currentTarget, null);
      }}
      onBlur={onLeave}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          // Without preventDefault the same key press reaches the drawer's newly focused close button and shuts it.
          e.preventDefault();
          onOpen(j.id);
        }
        if (e.key === " ") {
          e.preventDefault();
          onToggle(j.id);
        }
      }}
      className={cx("absolute inset-x-0 cursor-default border-b border-line px-3 transition-colors duration-100 hover:bg-surface/70 focus:bg-surface/80 focus:outline-none", selected && "bg-accent-soft hover:bg-accent-soft", narrow ? "flex items-center gap-3" : `grid ${GRID} items-center`)}
      style={{ top, height }}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex items-center">
        <input type="checkbox" aria-label={t("Chọn lượt")} checked={selected} onChange={(e) => onToggle(j.id, e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
      </span>
      <QueueTile job={j} className={narrow ? "h-[60px] w-[106px]" : "h-[72px] w-[128px]"} />
      {narrow ? (
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[0.94rem] leading-5 text-ink">{title}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-2">
            <Pill tone={JOB_TONE[j.state]}>{jobLabel(j.state)}</Pill>
            <span className="truncate">{who}</span>
            <span className="font-mono">{formatTime(j.createdAt)}</span>
            <Elapsed job={j} className="font-mono" />
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 pr-4">
            <div className="line-clamp-2 text-[0.94rem] leading-5 text-ink" title={title}>
              {title}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
              <KindIcon kind={j.kind} className="size-3.5 shrink-0" />
              <span>{t(KIND_LABEL[j.kind])}</span>
              {j.mode === "reference" && j.kind !== "chat" && <span className="text-ink-3">· {t("có tham chiếu")}</span>}
              <SitePill site={j.site} />
              <ApiSourcePill apiKeyId={j.apiKeyId} />
            </div>
          </div>
          <span>
            <Pill tone={JOB_TONE[j.state]}>{jobLabel(j.state)}</Pill>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <Avatar account={acc} size={26} showStatus={false} />
            <span className="truncate text-sm text-ink-2">{who}</span>
          </span>
          <span className="font-mono text-xs text-ink-2">{formatTime(j.createdAt)}</span>
          <Elapsed job={j} className="text-right font-mono text-xs text-ink-2" />
        </>
      )}
    </div>
  );
});

// ------------------------------------------------------------------------------------------------ quick look (R118)

export interface PreviewAnchor {
  id: string;
  rect: { top: number; bottom: number; left: number; right: number };
  /** Pointer x when the hover started (null for keyboard focus). */
  x: number | null;
}

const PREVIEW_W = 400;
const ANSWER_MAX = 600;

export function QuickPreview({ job, account, anchor, onEnter, onLeave }: { job: JobItem; account: Account | null; anchor: PreviewAnchor; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = anchor.rect;
    // Right side of the list, away from the pointer; left side when the pointer is already there.
    let left = r.right - PREVIEW_W - 20;
    if (anchor.x !== null && anchor.x > left - 12) left = r.left + 190;
    left = Math.max(12, Math.min(left, vw - PREVIEW_W - 12));
    let top = r.bottom + 6;
    if (top + h > vh - 12) top = r.top - h - 6;
    top = Math.max(12, Math.min(top, vh - h - 12));
    setPos({ top, left });
  }, [anchor, job.state, job.assets.length]);

  const media = mediaOf(job);
  const first = media[0];
  const docs = job.assets.length - media.length;
  const running = RUNNING.has(job.state);
  const phase = jobPhase(job.state);
  const answer = job.kind === "chat" && job.resultText ? job.resultText.slice(0, ANSWER_MAX) + (job.resultText.length > ANSWER_MAX ? "…" : "") : null;

  return (
    <div
      ref={ref}
      id="queue-preview"
      role="tooltip"
      data-quick-preview={job.id}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="glass-strong fixed z-[60] flex flex-col overflow-hidden rounded-lg shadow-xl"
      style={{ width: PREVIEW_W, top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
    >
      {first ? (
        first.missing ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-1.5 bg-ink/5 text-sm text-ink-2" data-preview="missing">
            <FileWarning className="size-6 text-attention-ink" aria-hidden />
            {t("Không tìm thấy tệp")}
          </div>
        ) : (
          <div className="relative bg-canvas-deep" style={{ aspectRatio: first.width && first.height ? `${first.width} / ${first.height}` : "16 / 9", maxHeight: 300 }}>
            {first.kind === "video" ? (
              <video key={first.id} src={assetUrl(first.id)} poster={thumbUrl(first.id)} autoPlay muted loop playsInline preload="metadata" className="size-full object-contain" data-preview="video" />
            ) : (
              <img src={thumbUrl(first.id)} alt="" decoding="async" className="size-full object-contain" data-preview="image" />
            )}
            {media.length > 1 && <span className="absolute left-2 top-2 rounded-md bg-ink/70 px-1.5 py-0.5 text-xs font-semibold text-on-ink">{t("{n} tệp", { n: formatNumber(media.length) })}</span>}
          </div>
        )
      ) : answer ? (
        <div className="max-h-[240px] overflow-hidden border-b border-line px-4 pt-3" data-preview="chat">
          <AnswerBody text={answer} clamp={false} links={false} className="gap-2 text-sm leading-6" />
        </div>
      ) : job.state === "failed" || job.state === "needs_review" ? (
        <div className={cx("flex gap-2.5 px-4 py-3 text-sm", job.state === "failed" ? "bg-danger-soft" : "bg-attention-soft")} data-preview="error">
          <AlertTriangle className={cx("mt-0.5 size-4 shrink-0", job.state === "failed" ? "text-danger-ink" : "text-attention-ink")} aria-hidden />
          <div className="min-w-0">
            <div className="font-medium text-ink">{job.state === "failed" ? t("Lượt này lỗi") : t("Cần anh xem lượt này")}</div>
            {job.errorMessage && <p className="mt-0.5 line-clamp-4 text-ink-2">{t(job.errorMessage)}</p>}
            {job.errorClass && ERROR_HINT[job.errorClass] && <p className="mt-1 text-ink">{t("Gợi ý: {hint}", { hint: t(ERROR_HINT[job.errorClass]) })}</p>}
          </div>
        </div>
      ) : (
        <div className={cx("flex flex-col items-center gap-2.5 px-4 py-5", running && "shimmer-bg")} data-preview={running ? "running" : "waiting"}>
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <KindIcon kind={job.kind} className="size-4 text-ink-2" />
            {jobLabel(job.state)}
            {running && (
              <>
                {" · "}
                <Elapsed job={job} className="font-mono" />
              </>
            )}
          </div>
          {phase >= 0 && (
            <ol className="flex items-center gap-2" aria-label={t("Giai đoạn: {phase}", { phase: t(PHASES[phase]) })}>
              {PHASES.map((p, i) => (
                <li key={p} className="flex items-center gap-1.5 text-xs text-ink-2">
                  <span className={cx("size-2 rounded-full", i < phase ? "bg-ok" : i === phase ? "bg-accent ring-4 ring-accent-soft" : "bg-ink/15")} aria-hidden />
                  <span className={i === phase ? "font-medium text-ink" : ""}>{t(p)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="max-h-[96px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-ink" data-selectable>
          {rowTitle(job)}
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
          <span className="flex items-center gap-1.5">
            <Avatar account={account} size={20} showStatus={false} />
            {account?.alias ?? (job.accountPref === "auto" ? t("Tự động") : "—")}
          </span>
          <span className="font-mono">{formatDateTime(job.createdAt)}</span>
          {job.startedAt && (
            <span>
              {t("Thời gian")} <Elapsed job={job} className="font-mono" />
            </span>
          )}
          {job.assets.length > 0 && <span>{docs > 0 && media.length > 0 ? t("{media} tệp + {docs} tài liệu", { media: formatNumber(media.length), docs: formatNumber(docs) }) : t("{n} tệp", { n: formatNumber(job.assets.length) })}</span>}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-ink-3">
          <span>{t("Bấm để xem chi tiết")}</span>
          <kbd className="rounded bg-ink/6 px-1.5 py-0.5 font-sans text-[10px] text-ink-2">Enter</kbd>
        </div>
      </div>
    </div>
  );
}
