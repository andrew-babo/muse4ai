import logoFull from "../assets/brand/andrew-babo-logo.png";
import logoMark from "../assets/brand/andrew-babo-mark.png";
import { navigate } from "../lib/router";
import { cx } from "../lib/ui";
import { t } from "@shared/i18n";

/** Maker signature. A name, so it reads the same in both UI languages (R123). */
export const MAKER_NAME = "Andrew Babo";
export const MAKER_SIGNATURE = `Made by ${MAKER_NAME}`;

/**
 * R123 — quiet credit at the foot of the sidebar: the small AB logo plus "Made by Andrew Babo".
 * Collapsed, only the logo stays. Opens Settings › About.
 */
export function SidebarCredit({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      type="button"
      data-maker-credit
      onClick={() => navigate("/settings/about")}
      title={collapsed ? MAKER_SIGNATURE : undefined}
      aria-label={`${MAKER_SIGNATURE} · ${t("Giới thiệu")}`}
      className={cx(
        "group no-drag flex items-center rounded-[12px] text-ink-3 opacity-80 transition-[opacity,background-color] duration-200 hover:bg-surface/60 hover:opacity-100",
        collapsed ? "mx-auto mb-3 size-10 justify-center" : "mx-4 mb-4 gap-2.5 px-2 py-1.5",
      )}
    >
      <img src={logoMark} alt="" aria-hidden draggable={false} className={cx("w-auto shrink-0 select-none", collapsed ? "h-[18px]" : "h-4")} />
      {!collapsed && (
        <span className="truncate text-xs leading-none tracking-[0.01em]">
          Made by <span className="font-medium text-ink-2 transition-colors group-hover:text-brand">{MAKER_NAME}</span>
        </span>
      )}
    </button>
  );
}

/** R123 — Settings › About: the full Andrew Babo logo on a warm panel. */
export function MakerCard() {
  return (
    <section data-maker-card className="glass-card mb-4 overflow-hidden rounded-lg">
      {/* Inner layer: the glass-card background (incl. the light-glass override) stays on the frame. */}
      <div className="brand-panel flex flex-col items-center px-6 pb-7 pt-8 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink-3">{t("Thiết kế và phát triển bởi")}</p>
        <img
          src={logoFull}
          alt={MAKER_NAME}
          draggable={false}
          width={720}
          height={426}
          className="mt-5 h-auto w-[264px] select-none"
        />
        <p className="mt-4 text-sm text-ink-3">© 2026 {MAKER_NAME}</p>
      </div>
    </section>
  );
}
