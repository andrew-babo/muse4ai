import { ArrowUp, FileText, Image as ImageIcon, ImagePlus, Layers, Loader2, MessageSquare, Paperclip, Sparkles, Users, Video, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { hasWorkingAccount } from "@shared/capabilities";
import { CHAT_ATTACH_FILE_MAX, CHAT_ATTACH_MAX, CHAT_ATTACH_TOTAL_MAX, CHAT_PROMPT_MAX, validateChatPrompt } from "@shared/chat";
import { PROMPT_COUNTER_FROM, PROMPT_MAX, REF_MAX_PER_JOB, REF_SOFT_MAX, REPEAT_MAX } from "@shared/constants";
import { SHARED_CONTEXT_NOTE } from "@shared/execution";
import { formatBytes, formatNumber } from "@shared/format";
import { acceptsWork } from "@shared/accountMachine";
import { capKey } from "@shared/scheduler";
import type { CapabilityKey, JobKind, JobMode, Site } from "@shared/types";
import { validatePrompt } from "@shared/validate";
import { Avatar } from "../components/Avatar";
import { Menu } from "../components/Overlay";
import { IconButton } from "../components/ui";
import { call } from "../lib/api";
import { getDraft, setDraft, useDraft, type RefView } from "../lib/composer";
import { navigate } from "../lib/router";
import { pushToast, useUi } from "../lib/store";
import { CONVERSATION_BUSY } from "./ChatResult";
import { cx, museAccountLine, uid } from "../lib/ui";
import { t } from "@shared/i18n";

// S02-composer (screens §4): pill composer, Enter sends, Shift+Enter newline, Ctrl+V pastes an image, drop anywhere in Studio.
// Build 2.0 S02c — “Hỏi đáp”: prompt sent verbatim (≤ 32.000), up to 10 files (documents, images, MP4), optional conversation.

/** Chat counter appears early: a 32.000-character prompt is long enough that the limit matters well before it. */
const CHAT_COUNTER_FROM = 1_000;
const CHAT_ACCEPT = ".csv,.txt,.md,.json,.pdf,image/png,image/jpeg,image/webp,video/mp4,text/csv,text/plain,text/markdown,application/json,application/pdf";

function readDataUrl(file: File): Promise<string> {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export async function attachFile(file: File): Promise<RefView | null> {
  const p = window.muse?.pathForFile(file);
  try {
    if (p) return await call<RefView>("reference.addPath", { filePath: p });
    if (file.size > 20 * 1024 * 1024) {
      pushToast({ tone: "danger", title: t("Tệp tham chiếu lớn hơn 20 MB") });
      return null;
    }
    return await call<RefView>("reference.addBytes", { data: await readDataUrl(file), name: file.name || t("Ảnh dán") });
  } catch {
    return null;
  }
}

/** R82 — a chat attachment: the main process sniffs the bytes and keeps documents by their (sanitized) name. */
export async function attachChatFile(file: File): Promise<RefView | null> {
  if (file.size > CHAT_ATTACH_FILE_MAX) {
    pushToast({ tone: "danger", title: t("“{name}” lớn hơn 20 MB", { name: file.name }) });
    return null;
  }
  const p = window.muse?.pathForFile(file);
  try {
    if (p) return await call<RefView>("chat.attachPath", { filePath: p }, { quiet: true });
    return await call<RefView>("chat.attachBytes", { data: await readDataUrl(file), name: file.name || t("Tệp dán") }, { quiet: true });
  } catch (e) {
    // AC-VIEW-05: several files dropped at once — each refused one is named on its own; the others still attach.
    pushToast({ tone: "danger", title: t("Không đính kèm được “{name}”", { name: file.name || t("Tệp dán") }), body: e instanceof Error ? e.message : undefined }, 8000);
    return null;
  }
}

/** Adds a picked file to the chat draft, enforcing R82 limits (count, total size, no duplicates). */
export function addChatFile(ref: RefView): void {
  const d = getDraft();
  if (d.chatFiles.some((r) => r.id === ref.id)) return;
  if (d.chatFiles.length >= CHAT_ATTACH_MAX) {
    pushToast({ tone: "info", title: t("Tối đa {CHAT_ATTACH_MAX} tệp cho một câu hỏi", { CHAT_ATTACH_MAX }) }, 3500);
    return;
  }
  const total = d.chatFiles.reduce((s, r) => s + (r.bytes ?? 0), 0) + (ref.bytes ?? 0);
  if (total > CHAT_ATTACH_TOTAL_MAX) {
    pushToast({ tone: "info", title: t("Tổng tệp đính kèm vượt 50 MB") }, 3500);
    return;
  }
  setDraft({ chatFiles: [...d.chatFiles, ref] });
}

export function useAttach() {
  return async (file: File) => {
    if (getDraft().kind === "chat") {
      const ref = await attachChatFile(file);
      if (ref) addChatFile(ref);
      return;
    }
    const ref = await attachFile(file);
    if (!ref) return;
    const d = getDraft();
    if (d.references.some((r) => r.id === ref.id)) return; // the same picture twice
    if (d.references.length >= REF_MAX_PER_JOB) {
      pushToast({ tone: "info", title: t("Tối đa {REF_MAX_PER_JOB} ảnh tham chiếu cho một lượt", { REF_MAX_PER_JOB }) }, 3500);
      return;
    }
    if (d.mode === "text") pushToast({ tone: "info", title: t("Đã chuyển sang “Từ ảnh”"), body: t("Ảnh sẽ dùng làm tham chiếu cho lượt tiếp theo.") }, 3500);
    if (d.references.length === REF_SOFT_MAX) pushToast({ tone: "info", title: t("Trên {REF_SOFT_MAX} ảnh, Muse có thể bỏ sót ảnh", { REF_SOFT_MAX }), body: t("Thử thật: 10 ảnh vẫn đủ; 15 ảnh Muse chuyển sang ghép phẳng, không có tiếng.") }, 5000);
    const video = ref.mime === "video/mp4";
    setDraft({ references: [...d.references, ref], mode: "reference", ...(video ? { kind: "video", site: "muse", referenceMedia: "video" } : {}) });
  };
}

function ChatFileChip({ file, index, onRemove }: { file: RefView; index: number; onRemove: () => void }) {
  const name = file.filename ?? file.name;
  const media = file.mime?.startsWith("image/");
  return (
    <div className="relative flex h-14 max-w-[240px] items-center gap-2 rounded-[12px] bg-surface/70 py-1.5 pl-1.5 pr-8 ring-1 ring-line">
      {media ? (
        <img src={file.url} alt="" className="size-11 shrink-0 rounded-[9px] object-cover" />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[9px] bg-ink/5 text-ink-2">{file.mime === "video/mp4" ? <Video className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink" title={name}>
          {name}
        </span>
        {file.bytes ? <span className="block font-mono text-xs text-ink-2">{formatBytes(file.bytes)}</span> : null}
      </span>
      <button type="button" aria-label={t("Bỏ tệp {index}: {name}", { index: index + 1, name })} title={t("Bỏ tệp")} onClick={onRemove} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full text-ink-2 hover:bg-ink/8 hover:text-ink">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Composer({ centered = false }: { centered?: boolean }) {
  const d = useDraft();
  const caps = useUi((s) => s.snap?.capabilities);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const attach = useAttach();
  const chat = d.kind === "chat";

  // Toasts stack above the composer instead of over its send button (Chrome.tsx reads --composer-clear).
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => {
      const r = el.getBoundingClientRect();
      const under = r.right > window.innerWidth - 380; // a toast is 360 px wide, 20 px from the right edge
      document.documentElement.style.setProperty("--composer-clear", `${under ? Math.max(0, window.innerHeight - r.top) : 0}px`);
    };
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    set();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
      document.documentElement.style.removeProperty("--composer-clear");
    };
  }, [centered]);
  const editVideo = !chat && (d.referenceMedia === "video" || d.references.some((r) => r.mime === "video/mp4"));
  // rev 6: Nơi tạo exists only for video; an image (and a chat) is always made on Muse.
  const site: Site = "muse";
  const key = capKey(d.kind, d.mode, site);
  const supported = caps ? caps[key] : true;
  const ready = hasWorkingAccount(accounts);
  const conv = chat ? d.conversation : null;
  const convBusy = useUi((s) => !!conv && !!s.snap?.busyConversations?.[conv.id]);

  useEffect(() => {
    ta.current?.focus();
  }, [d.focusTick]);

  // Auto-grow 1–8 lines.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 22;
    el.style.height = `${Math.min(el.scrollHeight, line * 8 + 8)}px`;
  }, [d.prompt]);

  const check = chat ? validateChatPrompt(d.prompt) : validatePrompt(d.prompt);
  const blockReason = useMemo(() => {
    if (!d.prompt.trim()) return chat ? t("Nhập câu hỏi trước khi gửi") : t("Nhập mô tả trước khi gửi");
    if (!check.ok) return t("reason" in check ? check.reason : check.error);
    if (!supported) return chat ? t("Hỏi đáp chưa được kiểm trên phiên bản Muse hiện tại") : t("Chưa hỗ trợ trên phiên bản Muse hiện tại");
    if (chat) return convBusy ? t(CONVERSATION_BUSY) : null;
    if (d.mode === "reference" && !d.references.length) return editVideo ? t("Thêm video MP4") : t("Thêm ảnh tham chiếu");
    if (editVideo && !d.references.some((r) => r.mime === "video/mp4")) return t("Thêm video MP4");
    return null;
  }, [d.prompt, d.mode, d.references, supported, check, site, editVideo, chat, convBusy]);

  const send = async () => {
    if (sending || blockReason) return;
    setSending(true);
    const sentPrompt = d.prompt;
    try {
      if (chat) {
        await call("chat.create", {
          prompt: d.prompt,
          referenceIds: d.chatFiles.map((r) => r.id),
          accountPref: conv ? conv.accountId : d.accountPref,
          clientRequestId: uid(),
          conversationId: conv?.id ?? null,
        });
        setLastSent(sentPrompt);
        setDraft({ prompt: "", chatFiles: [] });
      } else {
        await call<string[]>("job.create", {
          kind: d.kind,
          mode: d.mode,
          prompt: d.prompt,
          referenceIds: d.mode === "reference" ? d.references.map((r) => r.id) : [],
          accountPref: d.accountPref,
          repeat: d.repeat,
          clientRequestId: uid(),
          site,
        });
        setLastSent(sentPrompt);
        setDraft({ prompt: "" });
      }
    } catch {
      /* toast shown */
    } finally {
      setSending(false);
      ta.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "z" && e.ctrlKey && !d.prompt && lastSent) {
      e.preventDefault();
      setDraft({ prompt: lastSent });
      setLastSent(null);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.kind === "file" && (chat || i.type.startsWith("image/")));
    if (item) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        void attach(f);
      }
    }
  };

  const setKind = (kind: JobKind) => setDraft({ kind });
  const setMode = (mode: JobMode) => setDraft({ mode, referenceMedia: "image", references: mode === "text" ? [] : d.references.filter((r) => !r.mime?.startsWith("video/")) });
  const capHint = (k: CapabilityKey) => (caps && !caps[k] ? t("Chưa hỗ trợ trên phiên bản Muse hiện tại") : undefined);
  const modeKey = (m: JobMode) => capKey(d.kind, m, site);
  const prefAccount = accounts.find((a) => a.id === (conv ? conv.accountId : d.accountPref));
  const len = d.prompt.length;
  const max = chat ? CHAT_PROMPT_MAX : PROMPT_MAX;
  const counterFrom = chat ? CHAT_COUNTER_FROM : PROMPT_COUNTER_FROM;

  return (
    <div ref={root} className={cx("w-full", centered ? "max-w-[760px]" : "")}>
      {!ready && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md bg-attention-soft px-4 py-2 text-sm text-ink" role="status">
          <span>
            {!accounts.length
              ? t("Chưa có tài khoản nào — thêm tài khoản để bắt đầu tạo")
              : t("Chưa có tài khoản sẵn sàng — lượt sẽ chờ trong hàng")}
          </span>
          <button type="button" className="font-semibold text-accent-ink hover:underline" onClick={() => navigate("/accounts")}>
            {t("Mở Tài khoản")}
          </button>
        </div>
      )}
      <div className="glass rounded-[28px] px-4 pb-3 pt-3 transition-shadow focus-within:shadow-[0_0_0_2px_rgb(from_var(--color-accent)_r_g_b/0.55),var(--shadow-float)]">
        {conv && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-sm font-medium text-accent-ink">
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t("Tiếp hội thoại{value}", { value: conv.alias ? ` · ${conv.alias}` : "" })}</span>
              <button type="button" aria-label={t("Bỏ tiếp hội thoại, hỏi trong hội thoại mới")} title={t("Hỏi trong hội thoại mới")} onClick={() => setDraft({ conversation: null })} className="flex size-6 items-center justify-center rounded-full hover:bg-accent/15">
                <X className="size-3.5" />
              </button>
            </span>
          </div>
        )}
        {chat && d.chatFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1" aria-label={t("Tệp đính kèm")}>
            {d.chatFiles.map((f, i) => (
              <ChatFileChip key={f.id} file={f} index={i} onRemove={() => setDraft({ chatFiles: d.chatFiles.filter((x) => x.id !== f.id) })} />
            ))}
            <span className="text-sm text-ink-2">
              {t("{chatFilesCount}/{CHAT_ATTACH_MAX} tệp", { chatFilesCount: d.chatFiles.length, CHAT_ATTACH_MAX })}
            </span>
          </div>
        )}
        {!chat && d.references.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            {d.references.map((r, i) => (
              <div key={r.id} className="relative">
                {r.mime === "video/mp4" ? <video src={r.url} controls preload="metadata" aria-label={t("Video tham chiếu {i}: {name}", { i: i + 1, name: r.name })} className="h-24 w-40 rounded-md object-cover ring-1 ring-line" /> : <img src={r.url} alt={t("Ảnh tham chiếu {i}: {name}", { i: i + 1, name: r.name })} className="size-16 rounded-[12px] object-cover ring-1 ring-line" />}
                <button
                  type="button"
                  aria-label={t("Bỏ ảnh tham chiếu {i}", { i: i + 1 })}
                  title={t("Bỏ ảnh tham chiếu")}
                  onClick={() => {
                    const next = d.references.filter((x) => x.id !== r.id);
                    setDraft({ references: next, ...(next.length ? {} : { mode: "text" as JobMode }) });
                  }}
                  className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-ink text-on-ink shadow"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <span className="truncate text-sm text-ink-2">{editVideo ? t("{referencesCount} tệp tham chiếu", { referencesCount: d.references.length }) : t("{referencesCount} ảnh tham chiếu", { referencesCount: d.references.length })}</span>
          </div>
        )}
        <label htmlFor="composer-input" className="sr-only">
          {chat ? t("Câu hỏi cho Muse") : t("Mô tả ảnh hoặc video")}
        </label>
        <textarea
          id="composer-input"
          ref={ta}
          rows={1}
          value={d.prompt}
          onChange={(e) => setDraft({ prompt: e.target.value })}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={chat ? (conv ? t("Hỏi tiếp trong hội thoại này…") : t("Hỏi Muse bất cứ điều gì, đính kèm tệp nếu cần…")) : editVideo ? t("Muốn sửa video thế nào…") : d.mode === "reference" ? (d.kind === "image" ? t("Muốn sửa ảnh thế nào…") : t("Mô tả chuyển động cho ảnh…")) : d.kind === "image" ? t("Mô tả ảnh anh muốn tạo…") : t("Mô tả video anh muốn tạo…")}
          maxLength={max + 200}
          className="block w-full resize-none bg-transparent px-2 py-1.5 text-md leading-[22px] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
          aria-describedby="composer-hint"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chat ? (
            <IconButton label={t("Đính kèm tệp (CSV, TXT, MD, JSON, PDF, ảnh, MP4)")} variant="secondary" size="md" onClick={() => fileInput.current?.click()}>
              <Paperclip className="size-[18px]" />
            </IconButton>
          ) : (
            <IconButton label={editVideo ? t("Thêm video MP4") : t("Thêm ảnh hoặc video tham chiếu")} variant="secondary" size="md" onClick={() => fileInput.current?.click()}>
              {editVideo ? <Video className="size-[18px]" /> : <ImagePlus className="size-[18px]" />}
            </IconButton>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={chat ? CHAT_ACCEPT : "image/png,image/jpeg,image/webp,video/mp4"}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void (async () => {
                for (const f of files) await attach(f);
              })();
            }}
          />
          <div role="radiogroup" aria-label={t("Loại")} className="inline-flex h-10 items-center rounded-full bg-ink/5 p-1">
            {(
              [
                ["image", t("Ảnh"), ImageIcon],
                ["video", "Video", Video],
                ["chat", t("Hỏi đáp"), MessageSquare],
              ] as const
            ).map(([k, label, Icon]) => {
              const hint = k === "chat" ? (caps && !caps["chat.text"] ? t("Hỏi đáp chưa được kiểm trên phiên bản Muse hiện tại") : undefined) : capHint(capKey(k, d.mode, "muse"));
              return (
                <button key={k} type="button" role="radio" aria-checked={d.kind === k} title={hint} onClick={() => setKind(k)} className={cx("inline-flex h-full items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors", d.kind === k ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink", hint && "opacity-50")}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
          {!chat && (
            <Menu
              label={t("Cách tạo")}
              items={[
                { label: d.kind === "image" ? t("Từ chữ") : t("Video từ chữ"), icon: <Sparkles className="size-4" />, checked: d.mode === "text", onSelect: () => setMode("text"), disabled: !!capHint(modeKey("text")), hint: capHint(modeKey("text")) },
                { label: d.kind === "image" ? t("Từ ảnh (sửa ảnh)") : t("Từ ảnh (ảnh → video)"), icon: <Wand2 className="size-4" />, checked: d.mode === "reference" && !editVideo, onSelect: () => setMode("reference"), disabled: !!capHint(modeKey("reference")), hint: capHint(modeKey("reference")) },
                ...(d.kind === "video" && site === "muse" ? [{ label: t("Sửa video (MP4 → video)"), icon: <Video className="size-4" />, checked: editVideo, onSelect: () => setDraft({ mode: "reference", referenceMedia: "video" }) }] : []),
              ]}
              trigger={(p) => (
                <button type="button" {...p} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink hover:bg-ink/8">
                  {d.mode === "text" ? <Sparkles className="size-4" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
                  {editVideo ? t("Sửa video") : d.mode === "text" ? t("Từ chữ") : t("Từ ảnh")}
                </button>
              )}
            />
          )}
          {!chat && (
            <Menu
              label={t("Số lần lặp")}
              width={180}
              items={Array.from({ length: REPEAT_MAX }, (_, i) => ({ label: t("×{i}{value}", { i: i + 1, value: i === 0 ? t(" — một lượt") : t(" — {i} lượt riêng", { i: i + 1 }) }), checked: d.repeat === i + 1, onSelect: () => setDraft({ repeat: i + 1 }) }))}
              trigger={(p) => (
                <button type="button" {...p} title={t("Số lượt tạo với cùng prompt")} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink hover:bg-ink/8">
                  <Layers className="size-4" aria-hidden />{t("×{repeat}", { repeat: d.repeat })}
                </button>
              )}
            />
          )}
          {conv ? (
            // R85 — a continued conversation stays on the account that owns it.
            <span className="inline-flex h-10 max-w-[200px] items-center gap-1.5 rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink" title={t("Hội thoại chỉ chạy trên tài khoản đã tạo ra nó")}>
              {prefAccount ? <Avatar account={prefAccount} size={20} showStatus={false} /> : <Users className="size-4" aria-hidden />}
              <span className="truncate">{prefAccount?.alias ?? conv.alias ?? t("Tài khoản của hội thoại")}</span>
            </span>
          ) : (
            <Menu
              label={t("Tài khoản")}
              width={340}
              items={[
                { label: t("Tự động"), detail: t("Ưu tiên tài khoản còn hạn mức, chia đều"), icon: <Users className="size-4" />, checked: d.accountPref === "auto", onSelect: () => setDraft({ accountPref: "auto" }) },
                ...(accounts.length ? [{ label: "", separator: true } as const] : []),
                ...accounts.map((a) => {
                  // The status that matters is the one of the site the job goes to (R40).
                  const label = museAccountLine(a);
                  const off = !acceptsWork(a.state) && a.state !== "busy";
                  return { label: a.alias, detail: label, icon: <Avatar account={a} size={18} showStatus={false} />, checked: d.accountPref === a.id, onSelect: () => setDraft({ accountPref: a.id }), hint: off ? t("{label} — lượt sẽ chờ tài khoản này", { label }) : undefined };
                }),
              ]}
              trigger={(p) => (
                <button type="button" {...p} className="inline-flex h-10 max-w-[200px] items-center gap-1.5 rounded-full bg-ink/5 px-3.5 text-sm font-medium text-ink hover:bg-ink/8">
                  {prefAccount ? <Avatar account={prefAccount} size={20} showStatus={false} /> : <Users className="size-4" aria-hidden />}
                  <span className="truncate">{prefAccount ? prefAccount.alias : t("Tự động")}</span>
                </button>
              )}
            />
          )}
          <div className="ml-auto flex items-center gap-3">
            {len >= counterFrom && (
              <span className={cx("font-mono text-xs", len > max ? "text-danger-ink" : "text-ink-2")} aria-live="polite">
                {formatNumber(len)}/{formatNumber(max)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!!blockReason || sending}
              aria-label={blockReason ? t("Gửi — {blockReason}", { blockReason }) : t("Gửi (Enter)")}
              title={blockReason ?? t("Gửi (Enter)")}
              className="flex size-12 items-center justify-center rounded-full bg-ink text-on-ink shadow-lg transition-transform duration-150 hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100"
            >
              {sending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" strokeWidth={2.4} />}
            </button>
          </div>
        </div>
      </div>
      {chat && (
        <p className="mt-2 px-4 text-sm text-ink-2" role="note">
          {t(SHARED_CONTEXT_NOTE)}
        </p>
      )}
      <p id="composer-hint" className="sr-only">
        {chat ? t("Enter để gửi, Shift+Enter xuống dòng, Ctrl+V để dán tệp đính kèm.") : t("Enter để gửi, Shift+Enter xuống dòng, Ctrl+V để dán ảnh tham chiếu.")}
      </p>
    </div>
  );
}
