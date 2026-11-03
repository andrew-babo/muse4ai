import { AlertTriangle, ArrowRightToLine, Copy, ExternalLink, Film, FolderOpen, Image as ImageIcon, Info, Maximize2, MessageSquare, MessageSquarePlus, MoreHorizontal, Play, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { memo, useState } from "react";
import { ERROR_HINT } from "@shared/jobMachine";
import { queuedWaitLabel } from "@shared/execution";
import { formatElapsed, formatTime } from "@shared/format";
import type { Account, Asset } from "@shared/types";
import { Avatar } from "../components/Avatar";
import { Menu, type MenuItem } from "../components/Overlay";
import { Button, IconButton, Pill, SitePill } from "../components/ui";
import { ApiSourcePill } from "../components/ApiSource";
import { act, call } from "../lib/api";
import { setDraft, focusComposer, type RefView } from "../lib/composer";
import { useNow } from "../lib/hooks";
import type { JobItem } from "../lib/jobs";
import { navigate } from "../lib/router";
import { pushToast, setState, useUi } from "../lib/store";
import { cx, jobLabel, jobPhase, JOB_TONE, PHASES, thumbUrl, uid } from "../lib/ui";
import { openChain, openExtend } from "./Extend";
import { ChatAnswer, continueConversation, copyText } from "./ChatResult";
import { t } from "@shared/i18n";

/** One-line, short prompt for a card's accessible names (the full prompt is shown on the card). */
function shortPrompt(prompt: string): string {
  const cur = prompt.replace(/\s+/g, " ").trim();
  return cur.length > 40 ? `${cur.slice(0, 39)}…` : cur;
}

export function openLightbox(assetId: string, ids: string[]) {
  setState({ lightbox: { assetId, ids } });
}

export async function useAsReference(asset: Asset, kind: "image" | "video") {
  const ref = await call<RefView>("reference.fromAsset", { assetId: asset.id }).catch(() => null);
  if (!ref) return;
  setDraft({ references: [ref], mode: "reference", kind, site: "muse", referenceMedia: asset.kind === "video" ? "video" : "image", prompt: "" });
  navigate("/studio");
  focusComposer();
}

export function assetMenu(asset: Asset, ids: string[]): MenuItem[] {
  return [
    { label: t("Xem lớn"), icon: <Maximize2 className="size-4" />, onSelect: () => openLightbox(asset.id, ids) },
    { label: t("Mở file"), icon: <ExternalLink className="size-4" />, onSelect: () => void act("library.open", { assetId: asset.id }) },
    { label: t("Hiện trong thư mục"), icon: <FolderOpen className="size-4" />, onSelect: () => void act("library.reveal", { assetId: asset.id }) },
    ...(asset.kind === "image"
      ? [
          { label: t("Dùng làm ảnh tham chiếu"), icon: <Wand2 className="size-4" />, onSelect: () => void useAsReference(asset, "image") },
          { label: t("Tạo video từ ảnh này"), icon: <Film className="size-4" />, onSelect: () => void useAsReference(asset, "video") },
        ]
      : [{ label: t("Sửa video"), icon: <Wand2 className="size-4" />, onSelect: () => void useAsReference(asset, "video") }, { label: t("Kéo dài video"), icon: <ArrowRightToLine className="size-4" />, onSelect: () => openExtend(asset.id, asset) }]),
  ];
}

function Media({ job, assets }: { job: JobItem; assets?: Asset[] }) {
  const list = assets ?? job.assets;
  const ids = list.map((a) => a.id);
  if (!list.length) return null;
  const many = list.length > 1;
  return (
    <div className={cx("grid gap-2.5", many ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-1")}>
      {list.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => openLightbox(a.id, ids)}
          className={cx("group relative overflow-hidden rounded-[14px] bg-canvas-deep ring-1 ring-line", !many && (a.kind === "video" ? "max-h-[360px]" : "max-w-[560px]"))}
          aria-label={t("Xem lớn {value}", { value: a.kind === "video" ? "video" : t("ảnh") })}
          style={{ aspectRatio: a.width && a.height ? `${a.width} / ${a.height}` : a.kind === "video" ? "16 / 9" : "3 / 2" }}
        >
          {a.missing ? (
            <span className="flex size-full flex-col items-center justify-center gap-1 text-sm text-ink-2">
              <AlertTriangle className="size-5 text-attention-ink" />
              {t("Không tìm thấy file")}
            </span>
          ) : (
            <img src={thumbUrl(a.id)} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
          )}
          {a.kind === "video" && !a.missing && (
            <>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-ink/70 text-on-ink backdrop-blur-sm">
                  <Play className="ml-0.5 size-5" fill="currentColor" />
                </span>
              </span>
              {a.durationMs ? <span className="absolute bottom-2 right-2 rounded-md bg-ink/70 px-1.5 py-0.5 font-mono text-xs text-on-ink">{formatElapsed(a.durationMs).replace(" s", "s")}</span> : null}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

function Progress({ job }: { job: JobItem }) {
  const now = useNow(1000);
  const phase = jobPhase(job.state);
  const since = job.startedAt ?? job.createdAt;
  const waiting = job.state === "queued" || job.state === "held" || job.state === "retry_wait";
  const pinned = useUi((s) => (job.accountPref === "auto" ? null : (s.snap?.accounts.find((a) => a.id === job.accountPref) ?? null)));
  return (
    <div className={cx("shimmer-bg relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-[14px] ring-1 ring-line", job.kind === "chat" ? "min-h-[120px] py-5" : "aspect-[16/7] max-h-[220px]")}>
      <Sparkles className={cx("size-6", waiting ? "text-ink-3" : "text-accent-ink")} aria-hidden />
      <div className="text-base font-medium text-ink">
        {waiting ? (job.state === "retry_wait" && job.stateUntil ? t("Thử lại sau {stateUntil}", { stateUntil: formatElapsed(job.stateUntil - now) }) : job.state === "held" ? t("Tạm giữ") : t(queuedWaitLabel(job, pinned))) : `${jobLabel(job.state)} · ${formatElapsed(now - since)}`}
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
  );
}

export function recreate(job: JobItem) {
  // A chat is asked again in a new conversation (R85); its attachments are reused as they were.
  if (job.kind === "chat") return act("chat.create", { prompt: job.prompt, referenceIds: job.referenceIds, accountPref: job.accountPref, clientRequestId: uid() }, t("Đã thêm câu hỏi vào hàng chờ"));
  return act(
    "job.create",
    { kind: job.kind, mode: job.mode, prompt: job.prompt, referenceIds: job.referenceIds, accountPref: job.accountPref, repeat: 1, clientRequestId: uid(), site: job.site },
    t("Đã thêm lượt mới vào hàng chờ"),
  );
}

export const JobCard = memo(function JobCard({ job, account }: { job: JobItem; account: Account | null }) {
  const [expanded, setExpanded] = useState(false);
  const inProgress = !["completed", "failed", "cancelled", "needs_review"].includes(job.state);
  const chat = job.kind === "chat";
  const media = job.assets.filter((a) => a.kind !== "file");
  const files = job.assets.filter((a) => a.kind === "file");
  const ids = media.map((a) => a.id);
  const first = media[0];
  const items: MenuItem[] = [
    ...(first ? assetMenu(first, ids) : []),
    ...(first ? [{ label: "", separator: true }] : []),
    ...(chat && job.resultText ? [{ label: t("Chép câu trả lời"), icon: <Copy className="size-4" />, onSelect: () => copyText(job.resultText ?? "", t("Đã chép câu trả lời")) }] : []),
    ...(chat && job.conversationId && job.accountId ? [{ label: t("Hỏi tiếp"), icon: <MessageSquarePlus className="size-4" />, onSelect: () => continueConversation(job, account?.alias ?? null) }] : []),
    {
      label: t("Chép prompt"),
      icon: <Copy className="size-4" />,
      onSelect: () => {
        void navigator.clipboard.writeText(job.prompt);
        pushToast({ tone: "ok", title: t("Đã chép prompt") }, 2500);
      },
    },
    job.operation === "extend"
      ? { label: t("Mở chuỗi kéo dài"), icon: <ArrowRightToLine className="size-4" />, onSelect: () => job.chainId && openChain(job.chainId), disabled: !job.chainId }
      : { label: t("Tạo lại"), icon: <RotateCcw className="size-4" />, onSelect: () => void recreate(job), disabled: inProgress },
    { label: t("Chi tiết"), icon: <Info className="size-4" />, onSelect: () => setState({ detailJobId: job.id }) },
  ];
  return (
    <article className="glass-card rounded-lg p-4" aria-label={t("Lượt: {value}", { value: job.prompt.slice(0, 60) })}>
      <header className="flex items-start gap-3">
        <Avatar account={account} size={40} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setExpanded((e) => !e)} className={cx("block w-full text-left text-base font-medium text-ink", !expanded && "line-clamp-2")} data-selectable title={expanded ? t("Thu gọn") : t("Xem đầy đủ")}>
            {job.prompt}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1">
              {job.kind === "image" ? <ImageIcon className="size-3.5" aria-hidden /> : chat ? <MessageSquare className="size-3.5" aria-hidden /> : <Film className="size-3.5" aria-hidden />}
              {job.kind === "image" ? t("Ảnh") : chat ? t("Hỏi đáp") : "Video"}
            </span>
            <SitePill site={job.site} />
            {chat ? (
              job.referenceIds.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t("{referenceIdsCount} tệp đính kèm", { referenceIdsCount: job.referenceIds.length })}</span>
                </>
              )
            ) : (
              <>
                <span aria-hidden>·</span>
                <span>{job.operation === "extend" ? t("Kéo dài · lần {stepIndex}", { stepIndex: job.stepIndex ?? 1 }) : job.mode === "text" ? t("Từ chữ") : t("Từ ảnh")}</span>
              </>
            )}
            {account && (
              <>
                <span aria-hidden>·</span>
                <span>{account.alias}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="font-mono text-xs">{formatTime(job.createdAt)}</span>
            <ApiSourcePill apiKeyId={job.apiKeyId} />
            {(job.state !== "completed" || (!chat && job.assets.length === 0)) && <Pill tone={JOB_TONE[job.state]}>{jobLabel(job.state)}</Pill>}
          </div>
        </div>
        <Menu label={t("Thao tác lượt")} align="end" items={items} trigger={(p) => <IconButton label={t("Thao tác cho lượt “{prompt}”", { prompt: shortPrompt(job.prompt) })} size="sm" {...p}><MoreHorizontal className="size-4" /></IconButton>} />
      </header>
      <div className="mt-3 pl-[52px]">
        {inProgress && <Progress job={job} />}
        {job.state === "completed" && !chat && <Media job={job} />}
        {job.state === "completed" && chat && (
          <div className="flex flex-col gap-3">
            {media.length > 0 && <Media job={job} assets={media} />}
            <ChatAnswer job={job} files={files} alias={account?.alias ?? null} compact />
          </div>
        )}
        {job.state === "failed" && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-danger-soft px-4 py-3">
            <AlertTriangle className="size-4 shrink-0 text-danger-ink" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-ink">{job.errorMessage ? t(job.errorMessage) : t("Lỗi")}</span>
            {job.errorClass === "CONTENT_REFUSED" ? (
              <Button
                size="sm"
                onClick={() => {
                  setDraft(chat ? { prompt: job.prompt, kind: "chat" } : { prompt: job.prompt, kind: job.kind, mode: job.mode === "reference" ? "text" : job.mode });
                  focusComposer();
                }}
              >
                {t("Sửa prompt")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => void act("job.retry", { jobId: job.id })}>
                {job.errorClass && ERROR_HINT[job.errorClass] ? t(ERROR_HINT[job.errorClass]!) : t("Thử lại")}
              </Button>
            )}
          </div>
        )}
        {job.state === "needs_review" && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-attention-soft px-4 py-3">
            <AlertTriangle className="size-4 shrink-0 text-attention-ink" aria-hidden />
            <span className="min-w-0 flex-1 text-sm text-ink">{job.errorMessage ? t(job.errorMessage) : t("Không chắc Muse đã nhận lượt này")}</span>
            <Button size="sm" onClick={() => setState({ detailJobId: job.id })}>
              {t("Xem và quyết định")}
            </Button>
          </div>
        )}
        {job.state === "cancelled" && <p className="text-sm text-ink-2">{job.errorMessage ? t(job.errorMessage) : t("Đã huỷ")}</p>}
      </div>
    </article>
  );
});
