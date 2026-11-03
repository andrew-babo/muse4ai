import { AGENTS, agentTitle } from "./agents";
import { CHAPTERS } from "./chapters";
import { DOCS } from "./docs";
import { STATIC_PAGES, staticPage } from "./pages";
import type { L, SiteRoute } from "./types";
import { USE_CASES } from "./usecases";

const SUFFIX = " · Muse4AI";

/** Adds " · Muse4AI" when it still fits in 60 characters (AC-WEB-SEO-01). */
function seoTitle(title: L): L {
  return {
    en: title.en.length + SUFFIX.length <= 60 ? title.en + SUFFIX : title.en,
    vi: title.vi.length + SUFFIX.length <= 60 ? title.vi + SUFFIX : title.vi,
  };
}

function crumb(id: string): { label: L; path: string } {
  const p = staticPage(id);
  return { label: p.label, path: p.path };
}

/**
 * Every indexable page of the website, in English paths (Vietnamese adds /vi).
 * The single registry behind routes, nav, sitemap, hreflang and search (R3-WEB.1).
 */
export function allRoutes(): SiteRoute[] {
  const routes: SiteRoute[] = STATIC_PAGES.map((p) => ({
    id: `page:${p.id}`,
    path: p.path,
    kind: p.id === "home" ? "home" : ["agents", "use-cases", "docs"].includes(p.id) ? "hub" : "page",
    title: p.title,
    description: p.description,
    jsonLd: p.jsonLd,
    crumbs: p.id === "home" ? [] : [crumb("home")],
    ogImage: p.ogImage,
  }));

  const chapterOrder = new Map(CHAPTERS.map((c) => [c.id, c.order]));
  const docs = [...DOCS].sort((a, b) => (chapterOrder.get(a.chapter) ?? 0) - (chapterOrder.get(b.chapter) ?? 0) || a.order - b.order);
  for (const d of docs) {
    routes.push({
      id: `doc:${d.slug}`,
      path: `/docs/${d.slug}`,
      kind: "doc",
      title: seoTitle(d.title),
      description: d.summary,
      jsonLd: ["TechArticle", "BreadcrumbList"],
      crumbs: [crumb("home"), crumb("docs")],
      ogImage: false,
      updated: d.updated,
    });
  }

  for (const a of [...AGENTS].filter((x) => x.status !== "hidden").sort((x, y) => x.rank - y.rank)) {
    routes.push({
      id: `agent:${a.slug}`,
      path: `/agents/${a.slug}`,
      kind: "agent",
      title: seoTitle(agentTitle(a)),
      description: a.summary,
      jsonLd: ["TechArticle", "BreadcrumbList"],
      crumbs: [crumb("home"), crumb("agents")],
      ogImage: true,
    });
  }

  for (const u of [...USE_CASES].sort((x, y) => x.rank - y.rank)) {
    routes.push({
      id: `usecase:${u.slug}`,
      path: `/use-cases/${u.slug}`,
      kind: "usecase",
      title: seoTitle(u.title),
      description: u.summary,
      jsonLd: ["TechArticle", "BreadcrumbList"],
      crumbs: [crumb("home"), crumb("use-cases")],
      ogImage: true,
    });
  }
  return routes;
}

let cache: Map<string, SiteRoute> | undefined;

/** Route by English path ("/docs/queue"). */
export function routeByPath(path: string): SiteRoute | undefined {
  cache ??= new Map(allRoutes().map((r) => [r.path, r]));
  return cache.get(path);
}

export function docsInOrder() {
  const chapterOrder = new Map(CHAPTERS.map((c) => [c.id, c.order]));
  return [...DOCS].sort((a, b) => (chapterOrder.get(a.chapter) ?? 0) - (chapterOrder.get(b.chapter) ?? 0) || a.order - b.order);
}
