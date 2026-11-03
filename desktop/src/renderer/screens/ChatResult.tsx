import type React from "react";
import { Copy, Eye, ExternalLink, FileText, FolderOpen, MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { canOpenFile, canPreviewText, splitAnswer, splitLinks } from "@shared/chat";
import { parseMarkdown, plainText, type Block, type Inline } from "@shared/markdown";
import { formatBytes } from "@shared/format";
import type { Asset, Job } from "@shared/types";
import { Confirm, Dialog } from "../components/Overlay";
import { Button, Spinner } from "../components/ui";
import { act, call } from "../lib/api";
import { focusComposer, setDraft } from "../lib/composer";
import { navigate } from "../lib/router";
import { pushToast, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { t } from "@shared/i18n";

// Build 2.0 S02c/S03c — a Hỏi đáp answer: the text Muse wrote (verbatim) and the files it returned (R83–R85).

/** R85 — why “Hỏi tiếp” is off: the conversation already has an unfinished turn. */
export const CONVERSATION_BUSY = "Hội thoại đang có lượt chưa xong — chờ lượt đó xong rồi hỏi tiếp";

/** Collapsed answers show this many characters; the full text is one click away. */
const ANSWER_PREVIEW = 1_200;

/** R84 stores outputs as `{yyyyMMdd-HHmmss}_{id6}_{n}_{name}`; people read the name Muse gave the file. */
const STORED_PREFIX = /^\d{8}-\d{6}_[A-Za-z0-9]{6}_\d+_/;

export function fileName(a: Asset): string {
  const leaf = a.filename ?? a.path.split(/[\\/]/).pop() ?? t("tệp");
  return leaf.replace(STORED_PREFIX, "") || leaf;
}

export function copyText(text: string, title: string) {
  void navigator.clipboard.writeText(text);
  pushToast({ tone: "ok", title }, 2500);
}

/** R85 — continue the job's conversation from the composer (same account, app handle only). */
export function continueConversation(job: Pick<Job, "conversationId" | "accountId">, alias: string | null) {
  if (!job.conversationId || !job.accountId) return;
  setDraft({ kind: "chat", prompt: "", chatFiles: [], conversation: { id: job.conversationId, accountId: job.accountId, alias } });
  navigate("/studio");
  focusComposer();
}

export function ChatFiles({ assets }: { assets: Asset[] }) {
  const [preview, setPreview] = useState<Asset | null>(null);
  if (!assets.length) return null;
  return (
    <>
      <ul className="flex flex-col gap-1.5" aria-label={t("Tệp Muse trả về")}>
        {assets.map((a) => {
          const name = fileName(a);
          const openable = !a.missing && canOpenFile(name);
          const previewable = !a.missing && canPreviewText(name, a.bytes);
          return (
            <li key={a.id} className="flex items-center gap-3 rounded-[12px] bg-surface/70 px-3 py-2 ring-1 ring-line">
              <FileText className="size-5 shrink-0 text-ink-2" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink" title={name} data-selectable>
                  {name}
                </span>
                <span className="block font-mono text-xs text-ink-2">{a.missing ? t("Không tìm thấy file") : formatBytes(a.bytes)}</span>
              </span>
              {previewable && (
                <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(a)}>
                  {t("Xem")}
                </Button>
              )}
              {openable && (
                <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => void act("library.open", { assetId: a.id })}>
                  {t("Mở")}
                </Button>
              )}
              {!a.missing && (
                <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => void act("library.reveal", { assetId: a.id })} title={openable ? t("Hiện trong thư mục") : t("Loại tệp này có thể chạy chương trình nên app chỉ mở thư mục chứa nó")}>
                  {t("Mở thư mục")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {preview && <TextPreview asset={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function TextPreview({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    void call<{ text: string; filename: string }>("chat.readText", { assetId: asset.id }, { quiet: true }).then(
      (r) => live && setState({ text: r.text }),
      (e: Error) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [asset.id]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={fileName(asset)}
      width={760}
      footer={
        <>
          {state && "text" in state && (
            <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => copyText(state.text, t("Đã chép nội dung tệp"))}>
              {t("Chép")}
            </Button>
          )}
          <Button variant="primary" onClick={onClose} data-autofocus>
            {t("Đóng")}
          </Button>
        </>
      }
    >
      {!state ? (
        <div className="flex justify-center py-10">
          <Spinner label={t("Đang đọc tệp")} />
        </div>
      ) : "error" in state ? (
        <p className="text-sm text-danger-ink">{state.error}</p>
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-ink/4 p-3 font-mono text-xs leading-5 text-ink" data-selectable tabIndex={0}>
          {state.text}
        </pre>
      )}
    </Dialog>
  );
}

/**
 * AC-VIEW-04 — the answer stays text: React escapes it (no HTML runs, no image loads); fenced ``` blocks are monospace;
 * http(s) links are buttons that open outside the app only after a confirmation.
 */
export function AnswerBody({ text, clamp, links = true, className }: { text: string; clamp: boolean; links?: boolean; className?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const parts = splitAnswer(text);
  const inl = (xs: Inline[]): React.ReactNode =>
    xs.map((x, i) =>
      x.t === "strong" ? <strong key={i} className="font-semibold text-ink">{inl(x.c)}</strong>
      : x.t === "em" ? <em key={i}>{inl(x.c)}</em>
      : x.t === "code" ? <code key={i} className="rounded bg-ink/6 px-1 py-0.5 font-mono text-[0.9em]">{x.v}</code>
      : splitLinks(x.v).map((l, j) =>
          l.kind === "link" && links ? (
            <button key={`${i}-${j}`} type="button" className="break-all text-left font-medium text-accent-ink underline underline-offset-2 hover:no-underline" onClick={() => setLink(l.url)} title={t("Mở {url} (hỏi trước)", { url: l.url })}>{l.text}</button>
          ) : <span key={`${i}-${j}`} className="whitespace-pre-wrap">{l.text}</span>,
        ),
    );
  const block = (b: Block, k: string) => {
    switch (b.t) {
      case "h": return b.level === 1 ? <h2 key={k} className="mt-2 text-xl font-semibold text-ink">{inl(b.c)}</h2> : <h3 key={k} className="mt-2 text-lg font-semibold text-ink">{inl(b.c)}</h3>;
      case "p": {
        const solo = b.c.length === 1 && b.c[0].t === "strong";
        return solo ? <h3 key={k} className="mt-3 text-[1.05rem] font-semibold text-ink first:mt-0">{inl(b.c)}</h3> : <p key={k} className="break-words">{inl(b.c)}</p>;
      }
      case "ul": return <ul key={k} className="ml-5 list-disc space-y-1.5 marker:text-ink-2">{b.items.map((it, i) => <li key={i} className="pl-1">{inl(it)}</li>)}</ul>;
      case "ol": return <ol key={k} start={b.start} className="ml-5 list-decimal space-y-1.5 marker:text-ink-2">{b.items.map((it, i) => <li key={i} className="pl-1">{inl(it)}</li>)}</ol>;
      case "quote": return <blockquote key={k} className="border-l-2 border-line pl-3 text-ink-2">{inl(b.c)}</blockquote>;
      case "hr": return <hr key={k} className="my-1 border-line" />;
      case "table": return (
        <div key={k} className="overflow-x-auto rounded-[10px] ring-1 ring-line">
          <table className="w-full text-sm"><thead className="bg-ink/4"><tr>{b.head.map((c, i) => <th key={i} className="px-3 py-2 text-left font-semibold">{inl(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inl(c)}</td>)}</tr>)}</tbody></table>
        </div>);
      case "widget": return <p key={k} className="inline-flex w-fit items-center gap-2 rounded-full bg-ink/4 px-3 py-1 text-sm text-ink-2 ring-1 ring-line">{t("Muse kèm một bảng tương tác — chỉ xem được trên trang Muse")}</p>;
    }
  };
  return (
    <div className={cx("flex flex-col gap-3 text-base leading-7 text-ink", clamp && "line-clamp-[12]", className)} data-selectable>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <pre key={i} className="overflow-x-auto whitespace-pre rounded-md bg-ink/5 p-3 font-mono text-sm leading-5 text-ink" aria-label={p.lang ? t("Khối mã {lang}", { lang: p.lang }) : t("Khối mã")} tabIndex={0}>
            <code>{p.text}</code>
          </pre>
        ) : (
          parseMarkdown(p.text).map((b, j) => block(b, `${i}-${j}`))
        ),
      )}
      <Confirm
        open={!!link}
        title={t("Mở liên kết ngoài app?")}
        body={
          <div className="space-y-2">
            <p>{t("Liên kết này do Muse viết trong câu trả lời. App không kiểm nội dung trang đó.")}</p>
            <p className="break-all rounded-md bg-ink/4 px-3 py-2 font-mono text-sm text-ink" data-selectable>
              {link}
            </p>
          </div>
        }
        confirmLabel={t("Mở liên kết")}
        onCancel={() => setLink(null)}
        onConfirm={() => {
          const url = link;
          setLink(null);
          if (url) void act("app.openUrl", { url });
        }}
      />
    </div>
  );
}

export function ChatAnswer({ job, files, alias, compact = false }: { job: Job; files: Asset[]; alias: string | null; compact?: boolean }) {
  const [full, setFull] = useState(false);
  const convBusy = useUi((s) => !!job.conversationId && !!s.snap?.busyConversations?.[job.conversationId]);
  const text = job.resultText ?? "";
  const long = text.length > ANSWER_PREVIEW;
  const shown = full || !long ? text : `${text.slice(0, ANSWER_PREVIEW).trimEnd()}…`;
  return (
    <div className="flex flex-col gap-3">
      {text ? (
        <article className="max-w-[72ch]">
          <AnswerBody text={shown} clamp={compact && !full} />
          {long && (
            <button type="button" className="mt-3 text-sm font-semibold text-accent-ink hover:underline" onClick={() => setFull((f) => !f)} aria-expanded={full}>
              {full ? t("Thu gọn") : t("Xem đầy đủ")}
            </button>
          )}
          {job.resultTextTruncated && <p className="mt-2 text-sm text-ink-2">{t("Câu trả lời dài hơn 1 MB — bản đầy đủ nằm trong tệp bên dưới.")}</p>}
        </article>
      ) : (
        !files.length && <p className="text-sm text-ink-2">{t("Muse không viết câu trả lời nào.")}</p>
      )}
      <ChatFiles assets={files} />
      {job.outputsTruncated && <p className="text-sm text-ink-2">{t("Muse trả nhiều tệp hơn giới hạn — app chỉ giữ 20 tệp đầu.")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {job.conversationId && job.accountId && (
          <>
            <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="size-4" />} disabled={convBusy} title={convBusy ? t(CONVERSATION_BUSY) : undefined} aria-describedby={convBusy ? `busy-${job.id}` : undefined} onClick={() => continueConversation(job, alias)}>
              {t("Hỏi tiếp")}
            </Button>
            {convBusy && (
              <span id={`busy-${job.id}`} className="text-sm text-ink-2">
                {t(CONVERSATION_BUSY)}
              </span>
            )}
          </>
        )}
        {text && (
          <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => copyText(plainText(text), t("Đã chép câu trả lời"))}>
            {t("Chép câu trả lời")}
          </Button>
        )}
      </div>
    </div>
  );
}
