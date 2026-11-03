import { useUi, setState, getState, bindNavigate } from "./store";
import { call } from "./api";

// Internal desktop routes (screens.md §3). Last route is persisted so the app reopens where the user left.

export type RouteMatch =
  | { name: "onboarding" }
  | { name: "studio" }
  | { name: "queue"; jobId?: string; chainId?: string }
  | { name: "batches" }
  | { name: "batchNew" }
  | { name: "batch"; id: string }
  | { name: "library"; assetId?: string }
  | { name: "accounts"; id?: string; panel?: "preview" | "takeover" | "login" }
  | { name: "settings"; tab: string }
  | { name: "guide"; slug?: string };

export const NAV = [
  { route: "/studio", label: "Studio", key: "1" },
  { route: "/queue", label: "Hàng chờ", key: "2" },
  { route: "/batch", label: "Hàng loạt", key: "3" },
  { route: "/library", label: "Thư viện", key: "4" },
  { route: "/accounts", label: "Tài khoản", key: "5" },
  { route: "/settings/general", label: "Cài đặt", key: "6" },
  // Build 3.0 R3-APP.1: the Guide is the 7th item, below Settings, so Ctrl+1…6 keep their places.
  { route: "/guide", label: "Hướng dẫn", key: "7" },
] as const;

export function match(route: string): RouteMatch {
  const parts = route.split("?")[0].split("/").filter(Boolean);
  const [a, b, c] = parts;
  switch (a) {
    case "onboarding":
      return { name: "onboarding" };
    case "queue":
      // /queue/chain/:id opens S03-chain (also the route of a chain notification).
      if (b === "chain") return c ? { name: "queue", chainId: c } : { name: "queue" };
      return { name: "queue", jobId: b };
    case "batch":
      if (!b) return { name: "batches" };
      if (b === "new") return { name: "batchNew" };
      return { name: "batch", id: b };
    case "library":
      return { name: "library", assetId: b };
    case "accounts":
      // /accounts/:id/login?site=… = a “cần đăng nhập lại” link: starts that site's login step (AC-VIB-10).
      return { name: "accounts", id: b, panel: c === "preview" || c === "takeover" || c === "login" ? c : undefined };
    case "settings":
      return { name: "settings", tab: b || "general" };
    case "guide":
      return b ? { name: "guide", slug: b } : { name: "guide" };
    default:
      return { name: "studio" };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function navigate(route: string, opts: { replace?: boolean } = {}): void {
  const s = getState();
  if (route === s.route) return;
  // The job drawer belongs to the screen it was opened on: leaving that screen (sidebar shortcut, notification
  // click) closes it, otherwise it would cover the screen the user asked for (AC-APP-06).
  const leaving = match(route).name !== match(s.route).name;
  setState({ route, history: opts.replace ? s.history : [...s.history.slice(-30), s.route], ...(leaving ? { detailJobId: null, chainId: null } : {}) });
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!route.startsWith("/onboarding")) void call("app.setRoute", { route }, { quiet: true }).catch(() => undefined);
  }, 400);
}

export function back(): void {
  const s = getState();
  const prev = s.history[s.history.length - 1];
  if (!prev) return;
  setState({ route: prev, history: s.history.slice(0, -1) });
}

export function useRoute(): RouteMatch & { path: string } {
  const path = useUi((s) => s.route);
  return { ...match(path), path };
}

bindNavigate((r) => navigate(r));
