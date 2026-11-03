import { ArrowDown, Coffee, Film, Mountain, Waves } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@shared/format";
import type { Account, ExtendChain } from "@shared/types";
import { Spinner } from "../components/ui";
import { focusComposer, getDraft, setDraft, useDraft } from "../lib/composer";
import { useJobList } from "../lib/jobs";
import { useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { Composer, useAttach } from "./Composer";
import { JobCard } from "./JobCard";
import { ChainCard } from "./Extend";
import { t } from "@shared/i18n";
import { HelpButton } from "../components/HelpButton";

// S02 — Studio (variant B): timeline of standalone jobs, newest next to the composer; variant A is the empty state.

const SUGGESTIONS = [
  { icon: Coffee, title: "Tách cà phê buổi sáng", prompt: "Một tách cà phê trên bàn gỗ, nắng sớm xuyên qua cửa sổ, hơi nước bốc nhẹ, ảnh chụp chân thực", kind: "image" as const },
  { icon: Mountain, title: "Núi trong sương", prompt: "Dãy núi phủ sương lúc bình minh, ánh sáng hồng nhạt, phong cách tranh màu nước tối giản", kind: "image" as const },
  { icon: Waves, title: "Sóng biển buổi sớm", prompt: "Những con sóng nhỏ vỗ vào bờ cát lúc bình minh, máy quay đứng yên, chuyển động chậm", kind: "video" as const },
  { icon: Film, title: "Phố đêm sau mưa", prompt: "Con phố nhỏ sau cơn mưa ban đêm, đèn neon phản chiếu trên mặt đường ướt, máy quay lướt chậm về phía trước", kind: "video" as const },
];

export function Studio() {
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a] as [string, Account])), [accounts]);
  const chains = useUi((s) => s.snap?.chains);
  const chainById = useMemo(() => new Map((chains ?? []).map((c) => [c.id, c] as [string, ExtendChain])), [chains]);
  const list = useJobList({ standaloneOnly: true, order: "desc" }, { key: "studio", matches: (j) => j.batchId === null, pageSize: 30 });
  const scroller = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [dragging, setDragging] = useState(false);
  const attach = useAttach();
  const items = useMemo(() => [...list.items].reverse(), [list.items]);
  // A Kéo dài chain is one card at the place of its newest step (screens §11.5), not one card per step.
  const newestOfChain = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of items) if (j.chainId) m.set(j.chainId, j.id);
    return m;
  }, [items]);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | null>(null);

  // Keep the newest card in view when the user is at the bottom; keep position when older pages load on top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = items[0]?.id ?? null;
    if (prevFirst.current && first !== prevFirst.current && !atBottom.current) el.scrollTop += el.scrollHeight - prevHeight.current;
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = el.scrollHeight;
    prevFirst.current = first;
  }, [items]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = bottom;
    setShowJump(!bottom);
    if (el.scrollTop < 200 && list.hasMore && !list.loading) {
      prevHeight.current = el.scrollHeight;
      list.loadMore();
    }
  }, [list]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      // Hỏi đáp takes every dropped file (each refused one is reported by name); media keeps the first picture.
      if (getDraft().kind === "chat") {
        void (async () => {
          for (const f of files) await attach(f);
        })();
        return;
      }
      const f = files.find((x) => x.type.startsWith("image/"));
      if (f) void attach(f);
    },
  };

  const empty = !list.loading && list.items.length === 0;

  if (empty) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center px-8 pb-10" {...dropProps}>
        <HelpButton className="absolute right-6 top-4 text-ink-2 hover:text-ink" />
        <div className="flex w-full max-w-[760px] flex-col items-center">
          <h1 className="text-center text-2xl font-semibold tracking-tight text-ink">{t("Hôm nay anh muốn tạo gì?")}</h1>
          <p className="mt-3 text-center text-md text-ink-2">
            {accounts.filter((a) => a.state === "ready" || a.state === "busy").length > 0
              ? t("{itemsCount} tài khoản sẵn sàng · ảnh ~25 giây, video ~1 phút", { itemsCount: accounts.filter((a) => a.state === "ready" || a.state === "busy").length })
              : t("Thêm tài khoản Muse để bắt đầu — lượt gửi trước vẫn được giữ trong hàng chờ")}
          </p>
          <div className="mt-8 w-full">
            <Composer centered />
          </div>
          <div className="mt-6 grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.title}
                type="button"
                onClick={() => {
                  setDraft({ prompt: t(s.prompt), kind: s.kind, mode: "text", references: [] });
                  focusComposer();
                }}
                className="glass-card group flex flex-col gap-2 rounded-md p-4 text-left transition-transform duration-150 hover:-translate-y-0.5"
              >
                <s.icon className="size-5 text-ink-2 group-hover:text-accent-ink" aria-hidden />
                <span className="text-base font-medium text-ink">{t(s.title)}</span>
                <span className="line-clamp-2 text-sm text-ink-2">{t(s.prompt)}</span>
              </button>
            ))}
          </div>
        </div>
        {dragging && <DropHint />}
      </div>
    );
  }

  let lastDay = "";
  return (
    <div className="relative flex h-full flex-col" {...dropProps}>
      <HelpButton className="absolute right-6 top-4 z-10 text-ink-2 hover:text-ink" />
      <div ref={scroller} onScroll={onScroll} className="scroll-area min-h-0 flex-1 px-8 pt-6" aria-label={t("Dòng thời gian")} role="feed" aria-busy={list.loading}>
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 pb-6">
          {list.hasMore && (
            <div className="flex justify-center py-2">
              {list.loading ? (
                <Spinner label={t("Đang tải thêm")} />
              ) : (
                <button type="button" className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => list.loadMore()}>
                  {t("Tải thêm lượt cũ")}
                </button>
              )}
            </div>
          )}
          {list.loading && !list.items.length && (
            <div className="flex justify-center py-20">
              <Spinner label={t("Đang tải")} />
            </div>
          )}
          {items.map((j) => {
            const chain = j.chainId ? chainById.get(j.chainId) : undefined;
            if (chain && newestOfChain.get(chain.id) !== j.id) return null;
            const day = formatDate(j.createdAt);
            const sep = day !== lastDay;
            lastDay = day;
            return (
              <div key={j.id} className="flex flex-col gap-4">
                {sep && (
                  <div className="flex items-center gap-3 pt-2 text-xs font-medium text-ink-3" role="separator">
                    <span className="h-px flex-1 bg-line" />
                    {day === formatDate(Date.now()) ? t("Hôm nay") : day}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                {chain ? <ChainCard chain={chain} /> : <JobCard job={j} account={j.accountId ? accById.get(j.accountId) ?? null : null} />}
              </div>
            );
          })}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          className="glass-strong absolute bottom-[150px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-ink"
        >
          <ArrowDown className="size-4" />{" "}{t("Lượt mới nhất")}
        </button>
      )}
      <div className={cx("px-8 pb-5 pt-2")}>
        <div className="mx-auto max-w-[1100px]">
          <Composer />
        </div>
      </div>
      {dragging && <DropHint />}
    </div>
  );
}

function DropHint() {
  const chat = useDraft().kind === "chat";
  return (
    <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft">
      <div className="glass-strong rounded-md px-5 py-3 text-base font-medium text-ink">{chat ? t("Thả tệp để đính kèm vào câu hỏi") : t("Thả ảnh để dùng làm tham chiếu")}</div>
    </div>
  );
}
