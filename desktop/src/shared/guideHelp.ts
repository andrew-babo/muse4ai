import { CHAPTERS, DOCS, SITE_URL, doc, localizedPath, type DocArticle, type Locale } from "@content/index";

// Build 3.0 R3-APP — pure rules of the in-app Guide (unit-tested in Node): which article each screen's "?" opens, where
// content links go (inside the Guide, or the website after a confirmation) and the article order.

/** The article a screen's "?" button opens (R3-APP.8, AC-APP-GUIDE-08). Keys are app route prefixes. */
export const SCREEN_HELP: readonly { prefix: string; slug: string }[] = [
  { prefix: "/studio", slug: "create-image" },
  { prefix: "/queue", slug: "queue" },
  { prefix: "/batch", slug: "batches" },
  { prefix: "/library", slug: "library" },
  { prefix: "/accounts", slug: "accounts-and-limits" },
  { prefix: "/settings/proxy", slug: "proxies-and-modes" },
  { prefix: "/settings/run", slug: "proxies-and-modes" },
  { prefix: "/settings/api", slug: "connect-overview" },
  { prefix: "/settings/security", slug: "privacy-and-data" },
  { prefix: "/settings/diagnostics", slug: "troubleshooting" },
  { prefix: "/settings/about", slug: "open-source" },
  { prefix: "/settings", slug: "settings-overview" },
  { prefix: "/guide", slug: "what-is-muse4ai" },
];

export function helpSlugFor(path: string): string {
  const p = path.split("?")[0] || "/studio";
  for (const h of SCREEN_HELP) if (p === h.prefix || p.startsWith(h.prefix + "/")) return h.slug;
  return "what-is-muse4ai";
}

/** Chapters in order, each with its articles in order (the Guide's table of contents). */
export function guideToc(): { id: string; order: number; title: DocArticle["title"]; docs: DocArticle[] }[] {
  return [...CHAPTERS]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, order: c.order, title: c.title, docs: DOCS.filter((d) => d.chapter === c.id).sort((a, b) => a.order - b.order) }))
    .filter((c) => c.docs.length > 0);
}

/** Every article in reading order (chapter order, then article order). */
export function guideOrder(): DocArticle[] {
  return guideToc().flatMap((c) => c.docs);
}

export function guideNeighbours(slug: string): { prev: DocArticle | null; next: DocArticle | null } {
  const all = guideOrder();
  const i = all.findIndex((d) => d.slug === slug);
  return { prev: i > 0 ? all[i - 1]! : null, next: i >= 0 && i < all.length - 1 ? all[i + 1]! : null };
}

/** The same article on the website, in the app's language ("View on web", R3-APP.7). */
export function webDocUrl(slug: string, locale: Locale): string {
  return `${SITE_URL}${localizedPath(`/docs/${slug}`, locale)}`;
}

export type GuideLink = { kind: "guide"; route: string } | { kind: "web"; url: string };

/**
 * Where a link inside an article goes: another article stays in the Guide; any other site page or an outside address
 * opens in the browser after the user confirms (the app window never navigates to the web).
 */
export function resolveGuideLink(href: string, locale: Locale): GuideLink | null {
  const m = /^\/docs\/([a-z0-9-]+)(#[\w-]+)?$/.exec(href);
  if (m && doc(m[1]!)) return { kind: "guide", route: `/guide/${m[1]}` };
  if (href.startsWith("/") && !href.startsWith("//")) return { kind: "web", url: `${SITE_URL}${localizedPath(href.split("#")[0]!, locale)}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}` };
  if (/^https:\/\/[^\s]+$/i.test(href)) return { kind: "web", url: href };
  return null;
}
