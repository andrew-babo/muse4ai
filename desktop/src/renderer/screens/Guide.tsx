import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Copy, Download, ExternalLink, FileText, ImageOff, Lightbulb, Search, Sparkles, TerminalSquare, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AGENTS,
  CREDITS,
  GLOSSARY,
  SUGGESTED_PATHS,
  blocks,
  buildIndex,
  doc,
  parseInline,
  pick,
  search,
  shot,
  stepTitle,
  withTerms,
  type CodeBlock,
  type Credit,
  type DocArticle,
  type Inline,
  type Locale,
} from "@content/index";
import { agentInstructions } from "@content/agentPrompt";
import { guideNeighbours, guideToc, resolveGuideLink, webDocUrl } from "@shared/guideHelp";
import { getLocale, t } from "@shared/i18n";
import type { ApiStatus } from "@shared/types";
import { Confirm, Dialog } from "../components/Overlay";
import { Button, IconButton, TextInput } from "../components/ui";
import { act, call } from "../lib/api";
import { useHotkey, useWindowWidth } from "../lib/hooks";
import { navigate } from "../lib/router";
import { pushToast } from "../lib/store";
import { cx } from "../lib/ui";

// Build 3.0 A01–A03 — the Guide: the same articles as the website, bundled in the app (no network), with search, real
// screenshots, "Open this screen", "View on web" (confirmed) and the "For AI agents" card (copy note, skill ZIP,
// install for Claude Code). Content comes only from the shared `content/` registry.

/** Screenshots bundled from content/shots (R3-APP.2): file name → URL inside the app bundle. Only the 2× files —
 * the 1× copies exist for the website's srcset and would double the app's size for nothing. */
const SHOT_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob(["../../../../content/shots/*.webp", "!../../../../content/shots/*@1x.webp"], { eager: true, query: "?url", import: "default" }) as Record<string, string>).map(([k, v]) => [k.split("/").pop()!, v]),
);
/** License texts shipped with the installer (desktop/LICENSES), shown in the Open source chapter (AC-APP-OSS-01). */
const LICENSE_TEXTS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../../../LICENSES/*.txt", { eager: true, query: "?raw", import: "default" }) as Record<string, string>).map(([k, v]) => [`LICENSES/${k.split("/").pop()}`, v]),
);

type LinkAsk = { url: string } | null;

export function Guide({ slug }: { slug?: string }) {
  const locale = getLocale();
  const width = useWindowWidth();
  const toc = useMemo(() => guideToc(), []);
  const first = toc[0]!.docs[0]!;
  const article = slug ? doc(slug) : first;
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState<LinkAsk>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const wide = width >= 1440;

  // Scroll to the top of a newly opened article.
  useEffect(() => {
    articleRef.current?.scrollTo({ top: 0 });
  }, [article?.slug]);

  useHotkey((e) => {
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  });

  const openLink = (href: string) => {
    const r = resolveGuideLink(href, locale);
    if (!r) return;
    if (r.kind === "guide") navigate(r.route);
    else setAsk({ url: r.url });
  };

  return (
    <div className="flex h-full min-h-0 gap-6 px-8 pt-6">
      <aside className="flex w-[248px] shrink-0 flex-col" aria-label={t("Mục lục hướng dẫn")}>
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-ink-2" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t("Hướng dẫn")}</h1>
        </div>
        <label className="relative mt-4 block">
          <span className="sr-only">{t("Tìm trong hướng dẫn")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <TextInput
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("Tìm bài, ví dụ “hàng chờ”")}
            className="pl-9 pr-8"
            aria-controls="guide-results"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-3 hover:text-ink" aria-label={t("Xoá tìm kiếm")}>
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <div className="scroll-area -mx-2 mt-3 min-h-0 flex-1 px-2 pb-6">
          {query.trim() ? <SearchResults query={query} locale={locale} current={article?.slug} /> : <Toc toc={toc} locale={locale} current={article?.slug} />}
          {!wide && (
            <div className="mt-6">
              <AgentCard locale={locale} onOpenLink={openLink} />
            </div>
          )}
        </div>
      </aside>

      <div ref={articleRef} className="scroll-area min-w-0 flex-1 pb-10" id="guide-article">
        {article ? <Article d={article} locale={locale} onOpenLink={openLink} onWeb={(url) => setAsk({ url })} /> : <NotFoundArticle first={first} locale={locale} />}
      </div>

      {wide && (
        <aside className="scroll-area w-[280px] shrink-0 pb-10" aria-label={t("Cho AI agent")}>
          <AgentCard locale={locale} onOpenLink={openLink} />
        </aside>
      )}

      <Confirm
        open={!!ask}
        title={t("Mở trang web?")}
        body={
          <span className="block">
            {t("Trang này mở trong trình duyệt mặc định của anh:")}
            <code className="mt-2 block break-all rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink">{ask?.url}</code>
          </span>
        }
        confirmLabel={t("Mở trình duyệt")}
        cancelLabel={t("Huỷ")}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const url = ask?.url;
          setAsk(null);
          if (url) void act("app.openUrl", { url });
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ table of contents

function Toc({ toc, locale, current }: { toc: ReturnType<typeof guideToc>; locale: Locale; current?: string }) {
  return (
    <nav aria-label={t("Các chương")}>
      <ol className="flex flex-col gap-4">
        {toc.map((c) => (
          <li key={c.id}>
            <div className="px-2 text-sm font-semibold text-ink">
              <span className="mr-1.5 font-mono text-xs text-ink-3">{c.order}</span>
              {pick(c.title, locale)}
            </div>
            <ul className="mt-1 flex flex-col">
              {c.docs.map((d) => (
                <li key={d.slug}>
                  <button
                    type="button"
                    onClick={() => navigate(`/guide/${d.slug}`)}
                    aria-current={current === d.slug ? "page" : undefined}
                    className={cx("w-full rounded-[10px] px-2 py-1.5 text-left text-sm leading-snug", current === d.slug ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:bg-surface/60 hover:text-ink")}
                  >
                    {pick(d.title, locale)}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SearchResults({ query, locale, current }: { query: string; locale: Locale; current?: string }) {
  const index = useMemo(() => buildIndex(locale).filter((e) => e.kind === "doc"), [locale]);
  const hits = search(index, query, 20);
  const slugOf = (path: string) => path.replace(/^\/docs\//, "");
  if (hits.length === 0) {
    return (
      <div id="guide-results" role="status" className="px-2 text-sm">
        <p className="text-ink-2">{t("Không thấy bài nào khớp “{query}”.", { query: query.trim() })}</p>
        <p className="mt-3 text-xs font-medium text-ink-3">{t("Thử các bài này")}</p>
        <ul className="mt-1 flex flex-col">
          {SUGGESTED_PATHS.map((p) => {
            const d = doc(slugOf(p));
            return d ? (
              <li key={p}>
                <button type="button" onClick={() => navigate(`/guide/${d.slug}`)} className="w-full rounded-[10px] px-2 py-1.5 text-left text-sm text-accent-ink hover:bg-accent-soft">
                  {pick(d.title, locale)}
                </button>
              </li>
            ) : null;
          })}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <p className="px-2 text-xs font-medium text-ink-3" role="status">
        {t("{count} bài", { count: hits.length })}
      </p>
      <ul id="guide-results" className="mt-1 flex flex-col">
        {hits.map((h) => (
          <li key={h.path}>
            <button
              type="button"
              onClick={() => navigate(`/guide/${slugOf(h.path)}`)}
              aria-current={current === slugOf(h.path) ? "page" : undefined}
              className={cx("w-full rounded-[10px] px-2 py-2 text-left", current === slugOf(h.path) ? "bg-surface shadow-sm" : "hover:bg-surface/60")}
            >
              <span className="block text-sm font-medium text-ink">{h.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{h.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ article

function Article({ d, locale, onOpenLink, onWeb }: { d: DocArticle; locale: Locale; onOpenLink: (href: string) => void; onWeb: (url: string) => void }) {
  const { prev, next } = guideNeighbours(d.slug);
  // Glossary terms link once per article (first use), like the website (AC-CNT-06).
  const seen = new Set<string>();
  const rich = (text: string) => <Rich text={text} locale={locale} seen={seen} onOpenLink={onOpenLink} />;
  const chapter = guideToc().find((c) => c.id === d.chapter);
  return (
    <article className="mx-auto max-w-[760px]" data-selectable lang={locale}>
      <nav aria-label={t("Vị trí")} className="flex items-center gap-1 text-sm text-ink-3">
        <span>{t("Hướng dẫn")}</span>
        <ChevronRight className="size-3.5" aria-hidden />
        <span>{chapter ? pick(chapter.title, locale) : ""}</span>
      </nav>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{pick(d.title, locale)}</h2>
      <p className="mt-2 text-md leading-relaxed text-ink-2">{rich(pick(d.summary, locale))}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {d.appRoute && d.appRoute !== "/guide" && (
          <Button size="sm" variant="primary" icon={<ArrowRight className="size-4" />} onClick={() => navigate(d.appRoute!)}>
            {t("Mở màn này")}
          </Button>
        )}
        <Button size="sm" variant="quiet" icon={<ExternalLink className="size-4" />} onClick={() => onWeb(webDocUrl(d.slug, locale))}>
          {t("Xem trên web")}
        </Button>
      </div>

      {d.before.length > 0 && (
        <section className="mt-6 rounded-lg bg-accent-soft/60 px-5 py-4" aria-labelledby="g-before">
          <h3 id="g-before" className="text-base font-semibold text-ink">
            {t("Trước khi bắt đầu")}
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-base text-ink">
            {d.before.map((b, i) => (
              <li key={i}>{rich(pick(b, locale))}</li>
            ))}
          </ul>
        </section>
      )}

      <ol className="mt-6 flex flex-col gap-7">
        {d.steps.map((s, i) => (
          <li key={i}>
            <h3 className="flex items-baseline gap-2.5 text-lg font-semibold text-ink">
              <span className="font-mono text-sm text-ink-3">{i + 1}</span>
              {stepTitle(pick(s.title, locale))}
            </h3>
            <Body text={pick(s.body, locale)} render={rich} />
            {s.code && <Code block={s.code} locale={locale} />}
            {s.shot && <Shot id={s.shot} locale={locale} />}
          </li>
        ))}
      </ol>

      {d.slug === "glossary" && <Glossary locale={locale} />}
      {d.slug === "open-source" && <Credits locale={locale} onOpenLink={onOpenLink} />}

      <section className="mt-8 flex gap-3 rounded-lg bg-ok-soft/70 px-5 py-4" aria-labelledby="g-ok">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok-ink" aria-hidden />
        <div>
          <h3 id="g-ok" className="text-base font-semibold text-ink">
            {t("Kiểm tra thành công")}
          </h3>
          <Body text={pick(d.success, locale)} render={rich} />
        </div>
      </section>

      {d.troubleshoot.length > 0 && (
        <section className="mt-8" aria-labelledby="g-fix">
          <h3 id="g-fix" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Lightbulb className="size-5 text-attention-ink" aria-hidden />
            {t("Nếu không chạy")}
          </h3>
          <dl className="mt-3 flex flex-col gap-4">
            {d.troubleshoot.map((x, i) => (
              <div key={i} className="glass-card rounded-md px-4 py-3">
                <dt className="text-base font-medium text-ink">{pick(x.q, locale)}</dt>
                <dd>
                  <Body text={pick(x.a, locale)} render={rich} small />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {d.related.length > 0 && (
        <section className="mt-8" aria-labelledby="g-rel">
          <h3 id="g-rel" className="text-base font-semibold text-ink">
            {t("Bài liên quan")}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {d.related.map((r) => {
              const rd = doc(r);
              return rd ? (
                <li key={r}>
                  <button type="button" onClick={() => navigate(`/guide/${r}`)} className="glass-card rounded-full px-3 py-1.5 text-sm text-ink hover:bg-surface">
                    {pick(rd.title, locale)}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

      <nav aria-label={t("Bài trước và bài sau")} className="mt-10 grid grid-cols-2 gap-3 border-t border-line pt-5">
        {prev ? (
          <button type="button" onClick={() => navigate(`/guide/${prev.slug}`)} className="glass-card flex flex-col items-start rounded-md px-4 py-3 text-left hover:bg-surface">
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <ArrowLeft className="size-3.5" aria-hidden />
              {t("Bài trước")}
            </span>
            <span className="mt-0.5 text-sm font-medium text-ink">{pick(prev.title, locale)}</span>
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" onClick={() => navigate(`/guide/${next.slug}`)} className="glass-card flex flex-col items-end rounded-md px-4 py-3 text-right hover:bg-surface">
            <span className="flex items-center gap-1 text-xs text-ink-3">
              {t("Bài sau")}
              <ArrowRight className="size-3.5" aria-hidden />
            </span>
            <span className="mt-0.5 text-sm font-medium text-ink">{pick(next.title, locale)}</span>
          </button>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

function NotFoundArticle({ first, locale }: { first: DocArticle; locale: Locale }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center" role="status">
      <FileText className="mx-auto size-8 text-ink-3" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold text-ink">{t("Không có bài này")}</h2>
      <p className="mt-1 text-base text-ink-2">{t("Bài có thể đã đổi tên. Chọn một bài ở mục lục hoặc bắt đầu từ đầu.")}</p>
      <Button className="mt-4" size="sm" onClick={() => navigate(`/guide/${first.slug}`)}>
        {pick(first.title, locale)}
      </Button>
    </div>
  );
}

function Body({ text, render, small }: { text: string; render: (s: string) => ReactNode; small?: boolean }) {
  return (
    <div className={cx("mt-2 flex flex-col gap-2 leading-relaxed text-ink", small ? "text-sm" : "text-base")}>
      {blocks(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i}>{render(b.v)}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{render(it)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Rich({ text, locale, seen, onOpenLink }: { text: string; locale: Locale; seen: Set<string>; onOpenLink: (href: string) => void }) {
  const tokens: Inline[] = withTerms(parseInline(text), locale, seen);
  return (
    <>
      {tokens.map((x, i) => {
        switch (x.t) {
          case "b":
            return (
              <strong key={i} className="font-semibold">
                {x.v}
              </strong>
            );
          case "code":
            return (
              <code key={i} className="rounded-[6px] bg-ink/6 px-1.5 py-0.5 font-mono text-[0.9em]">
                {x.v}
              </code>
            );
          case "link":
            return (
              <button key={i} type="button" onClick={() => onOpenLink(x.href)} className="font-medium text-accent-ink underline decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink">
                {x.v}
              </button>
            );
          case "term": {
            const g = GLOSSARY.find((y) => y.id === x.id);
            return (
              <button key={i} type="button" onClick={() => navigate("/guide/glossary")} title={g ? pick(g.definition, locale) : undefined} className="underline decoration-ink-3 decoration-dotted underline-offset-4 hover:decoration-ink">
                {x.v}
              </button>
            );
          }
          default:
            return <Fragment key={i}>{x.v}</Fragment>;
        }
      })}
    </>
  );
}

function Code({ block, locale }: { block: CodeBlock; locale: Locale }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="mt-3 overflow-hidden rounded-md bg-ink text-on-ink">
      <figcaption className="flex items-center justify-between gap-2 border-b border-on-ink/10 px-4 py-2 font-mono text-xs text-on-ink/70">
        <span className="truncate">{block.caption ? pick(block.caption, locale) : block.lang}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(block.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-on-ink hover:bg-on-ink/10"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? t("Đã chép") : t("Chép")}
        </button>
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-relaxed" data-selectable>
        <code>{block.text}</code>
      </pre>
    </figure>
  );
}

function Shot({ id, locale }: { id: string; locale: Locale }) {
  const s = shot(id, locale);
  const url = s ? SHOT_URLS[s.file] : undefined;
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!s) return null;
  const alt = pick(s.alt, locale);
  if (!url || broken)
    return (
      <div className="mt-3 flex items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-ink-2" role="img" aria-label={alt}>
        <ImageOff className="size-4 shrink-0" aria-hidden />
        <span>{alt}</span>
      </div>
    );
  return (
    <figure className="mt-3">
      <button type="button" onClick={() => setOpen(true)} className="block w-full overflow-hidden rounded-md border border-line shadow-sm transition-shadow hover:shadow-md" aria-label={t("Phóng to ảnh: {alt}", { alt })}>
        <img src={url} alt={alt} width={s.w / 2} height={s.h / 2} loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-auto w-full" />
      </button>
      <figcaption className="mt-1.5 text-xs text-ink-3">{alt}</figcaption>
      <Dialog open={open} onClose={() => setOpen(false)} title={alt} width={Math.min(1280, s.w / 2 + 48)}>
        <img src={url} alt={alt} className="h-auto w-full rounded-md" />
      </Dialog>
    </figure>
  );
}

function Glossary({ locale }: { locale: Locale }) {
  return (
    <dl className="mt-6 flex flex-col divide-y divide-line">
      {[...GLOSSARY]
        .sort((a, b) => pick(a.term, locale).localeCompare(pick(b.term, locale), locale))
        .map((g) => (
          <div key={g.id} id={`term-${g.id}`} className="py-3">
            <dt className="text-base font-semibold text-ink">{pick(g.term, locale)}</dt>
            <dd className="mt-1 text-base text-ink-2">{pick(g.definition, locale)}</dd>
          </div>
        ))}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ A03 open source

function Credits({ locale, onOpenLink }: { locale: Locale; onOpenLink: (href: string) => void }) {
  const items = CREDITS.filter((c) => c.usedIn.includes("app"));
  const [open, setOpen] = useState<Credit | null>(null);
  return (
    <section className="mt-6" aria-labelledby="g-credits">
      <h3 id="g-credits" className="text-lg font-semibold text-ink">
        {t("Dự án mã mở trong Muse4AI")}
      </h3>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((c) => (
          <li key={c.id} className="glass-card flex flex-wrap items-start justify-between gap-3 rounded-md px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-ink">{c.name}</div>
              <div className="mt-0.5 text-sm text-ink-2">{pick(c.note, locale)}</div>
              <div className="mt-1 font-mono text-xs text-ink-3">{c.license}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {c.noticeFile && LICENSE_TEXTS[c.noticeFile] !== undefined && (
                <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => setOpen(c)}>
                  {t("Giấy phép")}
                </Button>
              )}
              <IconButton label={t("Mở trang dự án")} size="sm" onClick={() => onOpenLink(c.url)}>
                <ExternalLink className="size-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? t("Giấy phép {name}", { name: open.name }) : ""} width={720}>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-ink/5 p-4 font-mono text-xs leading-relaxed text-ink" data-selectable>
          {open?.noticeFile ? LICENSE_TEXTS[open.noticeFile] : ""}
        </pre>
      </Dialog>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ A02 for AI agents

function AgentCard({ locale, onOpenLink }: { locale: Locale; onOpenLink: (href: string) => void }) {
  const [busy, setBusy] = useState<null | "copy" | "zip" | "install">(null);
  const [confirm, setConfirm] = useState<null | { target: string; exists: boolean }>(null);
  const withSkills = AGENTS.filter((a) => a.skills && a.status !== "hidden").sort((a, b) => a.rank - b.rank);

  const copyNote = async () => {
    setBusy("copy");
    try {
      const st = await call<ApiStatus>("api.status", {}, { quiet: true }).catch(() => null);
      const base = st?.localUrl ?? `http://127.0.0.1:${st?.port ?? 47821}`;
      await navigator.clipboard.writeText(agentInstructions(locale, `${base}/mcp`));
      pushToast(
        st?.localUrl
          ? { tone: "ok", title: t("Đã chép lời dặn cho agent"), body: t("Dán vào agent, rồi thêm khoá API trong phần cài đặt của agent.") }
          : { tone: "attention", title: t("Đã chép lời dặn cho agent"), body: t("API cho agent đang tắt — bật trong Cài đặt › API & agent trước khi agent gọi."), route: "/settings/api" },
        5000,
      );
    } finally {
      setBusy(null);
    }
  };

  const saveZip = async () => {
    setBusy("zip");
    try {
      const r = await act<{ path: string } | null>("skill.saveZip");
      if (r) pushToast({ tone: "ok", title: t("Đã lưu skill"), body: r.path }, 5000);
    } finally {
      setBusy(null);
    }
  };

  const askInstall = async () => {
    const info = await call<{ target: string; exists: boolean }>("skill.info", {}, { quiet: true }).catch(() => null);
    if (info) setConfirm(info);
  };

  const install = async (replace: boolean) => {
    setBusy("install");
    try {
      const r = await act<{ target: string; replaced: boolean }>("skill.install", { replace });
      if (r) pushToast({ tone: "ok", title: r.replaced ? t("Đã thay skill cho Claude Code") : t("Đã cài skill cho Claude Code"), body: r.target }, 6000);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <section className="glass-card rounded-lg p-5" aria-labelledby="g-agent">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent-ink" aria-hidden />
        <h2 id="g-agent" className="text-md font-semibold text-ink">
          {t("Cho AI agent")}
        </h2>
      </div>
      <p className="mt-1.5 text-sm text-ink-2">{t("Dạy agent cách dùng Muse4AI: lời dặn ngắn, hoặc bộ skill đầy đủ.")}</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button variant="primary" size="sm" className="w-full justify-start" icon={<Copy className="size-4" />} loading={busy === "copy"} onClick={() => void copyNote()}>
          {t("Sao chép lời dặn cho agent")}
        </Button>
        <Button size="sm" className="w-full justify-start" icon={<Download className="size-4" />} loading={busy === "zip"} onClick={() => void saveZip()}>
          {t("Tải skill (.zip)")}
        </Button>
        <Button size="sm" className="w-full justify-start" icon={<TerminalSquare className="size-4" />} loading={busy === "install"} onClick={() => void askInstall()}>
          {t("Cài cho Claude Code")}
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-3">{t("Lời dặn không chứa khoá API. Anh tự thêm khoá trong cài đặt của agent.")}</p>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-xs font-medium text-ink-3">{t("Agent hỗ trợ skill")}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{withSkills.map((a) => a.name).join(" · ")}</p>
        <button type="button" onClick={() => onOpenLink("/docs/agent-skill")} className="mt-2 text-sm font-medium text-accent-ink hover:underline">
          {t("Đọc bài về skill")}
        </button>
      </div>
      <Confirm
        open={!!confirm}
        title={confirm?.exists ? t("Thay skill đã có?") : t("Cài skill cho Claude Code?")}
        body={
          <span className="block">
            {confirm?.exists ? t("Thư mục này đã có skill Muse4AI. Thay thế sẽ ghi đè các tệp trong đó; Huỷ giữ nguyên mọi tệp.") : t("Em sẽ chép 5 tệp skill vào thư mục:")}
            <code className="mt-2 block break-all rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink">{confirm?.target}</code>
          </span>
        }
        confirmLabel={confirm?.exists ? t("Thay thế") : t("Cài")}
        cancelLabel={t("Huỷ")}
        danger={confirm?.exists}
        busy={busy === "install"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void install(!!confirm?.exists)}
      />
    </section>
  );
}
