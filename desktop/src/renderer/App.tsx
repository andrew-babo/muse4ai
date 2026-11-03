import { Fragment, useEffect, useState } from "react";
import { getLocale, setLocale, type Locale } from "@shared/i18n";
import type { Snapshot } from "@shared/types";
import { Sidebar, SystemBanners, TitleBar, Toasts } from "./components/Chrome";
import { Confirm } from "./components/Overlay";
import { Button, Spinner } from "./components/ui";
import { cx } from "./lib/ui";
import { call, hasBridge } from "./lib/api";
import { focusComposer } from "./lib/composer";
import { useHotkey, useWindowWidth } from "./lib/hooks";
import { back, NAV, navigate, useRoute } from "./lib/router";
import { CONNECTION_LOST_MS } from "@shared/constants";
import { applyEvents, getState, resync, setState, subscribe, useUi } from "./lib/store";
import { resumeJobId, resumeRoute } from "@shared/resumeRoute";
import { Accounts } from "./screens/Accounts";
import { BatchEditor, BatchList, BatchRoute } from "./screens/Batches";
import { JobDrawer } from "./screens/JobDrawer";
import { ChainDrawer, ExtendSheet } from "./screens/Extend";
import { Library, Lightbox } from "./screens/Library";
import { Onboarding } from "./screens/Onboarding";
import { Queue } from "./screens/Queue";
import { Settings } from "./screens/Settings";
import { Studio } from "./screens/Studio";
import { Guide } from "./screens/Guide";
import { BridgeBanner } from "./screens/Execution";
import { t } from "@shared/i18n";

// Root: boot from the main-process snapshot, apply batched events, route, global shortcuts and display mode.

/** When the bundle started running (renderer time origin = navigation start); logged with the first frame. */
const SCRIPT_MS = performance.now();

function useBoot() {
  useEffect(() => {
    if (!hasBridge()) {
      setState({ bootError: t("Giao diện này chỉ chạy bên trong ứng dụng Muse4AI.") });
      return;
    }
    const off = window.muse.onEvents(applyEvents);
    let cancelled = false;
    const boot = async () => {
      try {
        const snap = await call<Snapshot>("app.snapshot", {}, { quiet: true });
        const snapMs = performance.now();
        const jobId = resumeJobId(snap.settings.lastRoute);
        const jobExists = jobId ? await call("job.get", { jobId }, { quiet: true }).then(() => true, () => false) : null;
        if (cancelled) return;
        const route = resumeRoute(snap, jobExists);
        setState({ snap, ready: true, route, lastBeat: Date.now() });
        // Two frames later the first screen is painted and clickable: report it for the §5 start-up budget.
        requestAnimationFrame(() => requestAnimationFrame(() => void call("app.markReady", { ms: performance.now(), scriptMs: SCRIPT_MS, snapMs }, { quiet: true }).catch(() => undefined)));
      } catch (e) {
        setState({ bootError: (e as Error).message });
      }
    };
    void boot();
    // Heartbeat watchdog (AC-APP-05): main pulses every HEARTBEAT_MS; a gap > CONNECTION_LOST_MS means the
    // engine is hung or gone. When pulses resume, re-read the whole snapshot so nothing missed stays stale.
    // Only after the first snapshot: the window loads while the engine is still opening the store.
    const timer = setInterval(() => {
      const st = getState();
      if (st.ready && st.connected && Date.now() - st.lastBeat > CONNECTION_LOST_MS) setState({ connected: false });
    }, 250);
    let wasConnected = true;
    const unsub = subscribe(() => {
      const c = getState().connected;
      if (c && !wasConnected && getState().ready) void resync(() => call<Snapshot>("app.snapshot", {}, { quiet: true })).catch(() => undefined);
      wasConnected = c;
    });
    return () => {
      cancelled = true;
      off();
      unsub();
      clearInterval(timer);
    };
  }, []);
}

function useDisplayMode() {
  const mode = useUi((s) => s.snap?.settings.displayMode ?? "auto");
  const gpu = useUi((s) => s.snap?.engine.gpuCompositing ?? true);
  const transparency = useUi((s) => s.snap?.engine.osTransparency ?? true);
  const reducedMotion = useUi((s) => s.snap?.engine.osReducedMotion ?? false);
  useEffect(() => {
    const effective = !transparency ? "solid" : mode === "auto" ? (gpu ? "full" : "light") : mode;
    document.documentElement.dataset.glass = effective;
  }, [mode, gpu, transparency]);
  // AC-A11Y-03: Windows "Show animations" off → avatars stand still (styles.css html[data-motion="reduce"]).
  useEffect(() => {
    if (reducedMotion) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reducedMotion]);
}

/**
 * R120: the UI language comes from the settings snapshot. It is applied before children render, and the screen tree is
 * keyed by it so every text (including memoised rows and module-level label tables read at render) switches at once
 * without a restart. Drafts and the open route live in stores, so nothing the user typed is lost.
 */
function useLanguage(): Locale {
  const lang = useUi((s) => s.snap?.settings.language ?? getLocale());
  if (getLocale() !== lang) setLocale(lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return lang;
}

export function App() {
  useBoot();
  useDisplayMode();
  const lang = useLanguage();
  const ready = useUi((s) => s.ready);
  const bootError = useUi((s) => s.bootError);
  const confirmQuit = useUi((s) => s.confirmQuit);
  const connected = useUi((s) => s.connected);
  const r = useRoute();
  const width = useWindowWidth();
  const [quitting, setQuitting] = useState(false);

  useHotkey((e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-7]$/.test(e.key)) {
      e.preventDefault();
      navigate(NAV[Number(e.key) - 1].route);
    } else if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      navigate("/studio");
      setTimeout(focusComposer, 30);
    } else if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  });

  if (bootError)
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="glass max-w-md rounded-lg p-8">
          <h1 className="text-lg font-semibold text-ink">{t("Không khởi động được giao diện")}</h1>
          <p className="mt-2 text-base text-ink-2">{bootError}</p>
          {hasBridge() && (
            <Button className="mt-4" onClick={() => location.reload()}>
              {t("Thử lại")}
            </Button>
          )}
        </div>
      </div>
    );
  if (!ready)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="canvas-glow" />
        <Spinner className="size-6" label={t("Đang mở Muse4AI")} />
      </div>
    );

  const onboarding = r.name === "onboarding";
  let view: React.ReactNode;
  switch (r.name) {
    case "onboarding":
      view = <Onboarding />;
      break;
    case "queue":
      view = <Queue />;
      break;
    case "batches":
      view = <BatchList />;
      break;
    case "batchNew":
      view = <BatchEditor />;
      break;
    case "batch":
      view = <BatchRoute id={r.id} />;
      break;
    case "library":
      view = <Library />;
      break;
    case "accounts":
      view = <Accounts />;
      break;
    case "settings":
      view = <Settings />;
      break;
    case "guide":
      view = <Guide slug={r.slug} />;
      break;
    default:
      view = <Studio />;
  }

  return (
    <Fragment key={lang}>
    <div className="relative flex h-full">
      <div className="canvas-glow" aria-hidden />
      <TitleBar />
      {!onboarding && <Sidebar collapsed={width < 1280} />}
      <main className="relative z-10 flex min-w-0 flex-1 flex-col pt-11" id="main">
        <SystemBanners />
        {!onboarding && <BridgeBanner />}
        {/* Lost engine: data stays visible but dimmed and inert, so no write can be attempted (spec §2.6, AC-APP-05). */}
        <div className={cx("min-h-0 flex-1", !connected && "pointer-events-none opacity-60")} inert={!connected} aria-busy={!connected}>
          {view}
        </div>
      </main>
      <div inert={!connected} className="contents">
        <ChainDrawer />
        <JobDrawer />
        <Lightbox />
        <ExtendSheet />
      </div>
      <Toasts />
      <Confirm
        open={!!confirmQuit}
        title={t("Thoát khi còn lượt đang chạy?")}
        body={t("Còn {running} lượt đang tạo. Lượt đã gửi sẽ được đối soát khi mở lại app; lượt chưa gửi vẫn nằm trong hàng chờ.", { running: confirmQuit?.running ?? 0 })}
        confirmLabel={t("Thoát")}
        cancelLabel={t("Tiếp tục chạy")}
        danger
        busy={quitting}
        onCancel={() => setState({ confirmQuit: null })}
        onConfirm={async () => {
          setQuitting(true);
          await call("app.quit", { force: true }).catch(() => undefined);
        }}
      />
    </div>
    </Fragment>
  );
}
