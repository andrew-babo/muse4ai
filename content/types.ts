/**
 * Build 3.0 shared content model (spec §4). Pure data types: no imports from
 * the web app or the desktop app, so both packages can read the same content.
 */

export type Locale = "en" | "vi";
export const LOCALES: readonly Locale[] = ["en", "vi"] as const;
export const DEFAULT_LOCALE: Locale = "en";

/** Every visible string exists in both languages. */
export interface L<T = string> {
  en: T;
  vi: T;
}

export type Slug = string;
export type ShotId = string;
export type MediaId = string;

/** Desktop app screens a guide article can open ("Open this screen"). */
export type AppRoute =
  | "/studio"
  | "/queue"
  | "/batch"
  | "/batch/new"
  | "/library"
  | "/accounts"
  | "/guide"
  | "/settings/general"
  | "/settings/proxy"
  | "/settings/run"
  | "/settings/queue"
  | "/settings/notifications"
  | "/settings/api"
  | "/settings/security"
  | "/settings/diagnostics"
  | "/settings/about";

export const APP_ROUTES: readonly AppRoute[] = [
  "/studio",
  "/queue",
  "/batch",
  "/batch/new",
  "/library",
  "/accounts",
  "/guide",
  "/settings/general",
  "/settings/proxy",
  "/settings/run",
  "/settings/queue",
  "/settings/notifications",
  "/settings/api",
  "/settings/security",
  "/settings/diagnostics",
  "/settings/about",
];

export type CodeLang = "json" | "toml" | "yaml" | "bash" | "powershell" | "text" | "http";

export interface CodeBlock {
  lang: CodeLang;
  text: string;
  /** Optional caption shown above the block, e.g. the file name to edit. */
  caption?: L;
}

export interface Step {
  title: L;
  body: L;
  shot?: ShotId;
  code?: CodeBlock;
}

export interface QA {
  q: L;
  a: L;
}

export type ChapterId =
  | "start"
  | "account"
  | "studio"
  | "queue"
  | "batch"
  | "library"
  | "accounts"
  | "agents"
  | "settings"
  | "help"
  | "credits";

export interface Chapter {
  id: ChapterId;
  order: number;
  title: L;
  summary: L;
}

export interface DocArticle {
  slug: Slug;
  chapter: ChapterId;
  order: number;
  title: L;
  /** One sentence, ≤ 200 characters (AC-CNT-03). */
  summary: L;
  before: L[];
  steps: Step[];
  success: L;
  troubleshoot: QA[];
  related: Slug[];
  /** Screen the in-app "Open this screen" button goes to. */
  appRoute?: AppRoute;
  /** ISO date of the last meaningful content change. */
  updated: string;
  /** Technical reference pages (REST/MCP) may use developer vocabulary. */
  advanced?: boolean;
}

export type ConnectionKind = "local" | "public" | "bridge";
export type AgentStatus = "verified" | "documented" | "later" | "hidden";
export type ConfigFormat =
  | "json-mcpServers"
  | "json-vscode"
  | "json-antigravity"
  | "json-opencode"
  | "toml-codex"
  | "yaml-hermes"
  | "cli"
  | "form";

export interface AgentConfig {
  format: ConfigFormat;
  /** Where this goes (file path or screen), in plain words. */
  where: L;
  text: string;
}

export interface Evidence {
  appVersion: string;
  date: string;
  /** Repository-relative path of the evidence file. */
  path: string;
}

export type BrandId = string;

export interface Agent {
  slug: Slug;
  name: string;
  vendor: string;
  site: string;
  docsUrl: string;
  connection: ConnectionKind[];
  status: AgentStatus;
  evidence?: Evidence;
  /** Why the agent is "later" (status = later). */
  laterReason?: L;
  config?: AgentConfig;
  deeplink?: "cursor" | "vscode" | "lmstudio";
  /** Supports Agent Skills (SKILL.md) per its official docs. */
  skills: boolean;
  summary: L;
  steps: Step[];
  notes: L[];
  brand: BrandId;
  /** Ordering on hubs (lower first). */
  rank: number;
}

export type UseCaseCategory = "sales" | "education" | "creators" | "office" | "dev";

export interface UseCase {
  slug: Slug;
  category: UseCaseCategory;
  title: L;
  summary: L;
  who: L;
  outcome: L;
  lanes: { you: L; agent: L; muse4ai: L };
  prompt: L;
  media: MediaId[];
  limits: L[];
  docs: Slug[];
  related: Slug[];
  disclosure?: L;
  /** Shown in full (true) or as a shorter page. */
  featured: boolean;
  rank: number;
}

export interface Media {
  id: MediaId;
  kind: "image" | "video";
  /** Asset CDN path (`/__l5e/assets-v1/…`, from a `content/media/*.asset.json` pointer) or absolute https URL. */
  url: string;
  /** Smaller rendition for cards: 800 px image, or 640 px poster for a video. */
  small: string;
  /** Video only: 1280 px poster (WebP). */
  poster?: string;
  posterBytes?: number;
  w: number;
  h: number;
  durationS?: number;
  bytes: number;
  /** Exact prompt sent to Muse (English in both locales — it is what Muse received). */
  prompt: L;
  alt: L;
  generatedAt: string;
  account: "test";
  /** Muse job id recorded in the media ledger (AC-MEDIA-01). */
  jobRef: string;
}

export interface Shot {
  id: ShotId;
  locale: Locale;
  /** File name under content/shots/ (WebP, 2x). */
  file: string;
  w: number;
  h: number;
  bytes: number;
  sha256: string;
  appVersion: string;
  capturedAt: string;
  profile: "synthetic";
  alt: L;
}

export type CreditGroup = "referenced" | "design" | "legacy" | "app" | "web" | "font" | "tool" | "runtime-download";

export interface Credit {
  id: string;
  name: string;
  url: string;
  license: string;
  group: CreditGroup;
  /** What it is used for, in plain words. */
  note: L;
  /** License text shipped with the installer (desktop/LICENSES/…). */
  noticeFile?: string;
  usedIn: ("app" | "web" | "installer")[];
  /** npm package names this entry covers (AC-WEB-OSS-02). */
  packages?: string[];
}

export type LogoPolicy = "logo" | "text";

export interface Brand {
  id: BrandId;
  owner: string;
  policy: LogoPolicy;
  rulesUrl: string;
  asset?: { file: string; sourceUrl: string; downloadedAt: string; sha256: string };
  /** Why the policy is what it is. */
  reason: string;
}

export interface Release {
  version: string;
  date: string;
  bytes: number | null;
  sha256: string | null;
  /** Public download URL; null while the beta is private (R3-DL.2). */
  url: string | null;
  notes: L[];
}

export interface Author {
  name: string;
  bio: L | null;
  sameAs: string[];
}

export interface GlossaryTerm {
  id: string;
  term: L;
  /** Case-insensitive whole-word patterns that trigger the first-use link. */
  match: L<string[]>;
  definition: L;
}

export type JsonLdKind = "WebSite" | "SoftwareApplication" | "TechArticle" | "BreadcrumbList" | "Person";

export type RouteKind = "home" | "page" | "hub" | "doc" | "agent" | "usecase";

export interface SiteRoute {
  id: string;
  /** English path; Vietnamese is "/vi" + path. */
  path: string;
  kind: RouteKind;
  title: L;
  description: L;
  jsonLd: JsonLdKind[];
  /** Breadcrumb trail above this page (excluding the page itself). */
  crumbs: { label: L; path: string }[];
  /** Has a generated 1200x630 share image. */
  ogImage: boolean;
  /** Last content change (ISO date) when known. */
  updated?: string;
}
