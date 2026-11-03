import { useEffect, useRef } from "react";
import { getLocale, LOCALES, t, type Locale } from "@shared/i18n";
import { call } from "../lib/api";
import { getState, pushToast, setState, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { Segmented } from "./ui";

// R120 — language picker (Onboarding first step, Settings › Chung, sidebar footer). The language names are shown in
// their own language so either reader can find theirs. Switching re-renders the whole UI at once (App keys its tree by
// language); focus returns to the picker the user used.

let refocus: string | null = null;

function patchLanguage(l: Locale) {
  setState((s) => (s.snap ? { snap: { ...s.snap, settings: { ...s.snap.settings, language: l } } } : {}));
}

export async function chooseLanguage(l: Locale, origin: string): Promise<void> {
  const before = getState().snap?.settings.language ?? getLocale();
  if (l === before) return;
  refocus = origin;
  patchLanguage(l); // instant; main confirms with its settings event
  try {
    await call("settings.set", { key: "language", value: l }, { quiet: true });
  } catch (e) {
    patchLanguage(before);
    pushToast({ tone: "danger", title: t("Chưa đổi được ngôn ngữ"), body: e instanceof Error ? e.message : undefined }, 6000);
  }
}

function useRefocus(origin: string, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (refocus !== origin) return;
    refocus = null;
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [origin, ref]);
}

export function LanguageSwitch({ origin, size = "sm", className }: { origin: string; size?: "sm" | "md"; className?: string }) {
  const lang = useUi((s) => s.snap?.settings.language ?? getLocale());
  const ref = useRef<HTMLDivElement>(null);
  useRefocus(origin, ref);
  return (
    <div ref={ref} className={className} lang={lang}>
      <Segmented
        label={t("Ngôn ngữ giao diện")}
        size={size}
        value={lang}
        options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
        onChange={(v) => void chooseLanguage(v, origin)}
      />
    </div>
  );
}

/** Collapsed sidebar: one small button that flips between the two languages. */
export function LanguageToggle({ origin }: { origin: string }) {
  const lang = useUi((s) => s.snap?.settings.language ?? getLocale());
  const ref = useRef<HTMLDivElement>(null);
  const next: Locale = lang === "vi" ? "en" : "vi";
  useEffect(() => {
    if (refocus !== origin) return;
    refocus = null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, [origin]);
  const nextLabel = LOCALES.find((l) => l.id === next)!.label;
  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() => void chooseLanguage(next, origin)}
        aria-label={t("Đổi ngôn ngữ sang {language}", { language: nextLabel })}
        title={nextLabel}
        className={cx("flex h-9 w-11 items-center justify-center rounded-[12px] text-xs font-semibold uppercase tracking-wide text-ink-2 transition-colors hover:bg-surface/60 hover:text-ink")}
      >
        {lang}
      </button>
    </div>
  );
}
