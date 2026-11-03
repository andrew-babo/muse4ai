import { AlertTriangle, BookOpen, CheckCircle2, Clock3, HardDrive, Home, Images, Info, Layers, Plug, RefreshCw, Settings as SettingsIcon, Users, X, Wrench } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatNumber } from "@shared/format";
import logo from "../assets/logo.png";
import { call } from "../lib/api";
import { NAV, navigate, useRoute } from "../lib/router";
import { dismissToast, setState, useUi } from "../lib/store";
import { accountStatus, cx } from "../lib/ui";
import { Avatar } from "./Avatar";
import { LanguageSwitch, LanguageToggle } from "./LanguageSwitch";
import { SidebarCredit } from "./MakerCredit";
import { useOverlays } from "./Overlay";
import { Button, IconButton } from "./ui";
import { t, tc } from "@shared/i18n";

const NAV_ICONS = [Home, Clock3, Layers, Images, Users, SettingsIcon, BookOpen];

export function TitleBar() {
  return <div className="drag pointer-events-auto fixed inset-x-0 top-0 z-30 h-11" aria-hidden />;
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const r = useRoute();
  const counts = useUi((s) => s.snap?.counts);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const engine = useUi((s) => s.snap?.engine);
  const connected = useUi((s) => s.connected);
  const [hover, setHover] = useState<string | null>(null);
  const shown = accounts.slice(0, 6);
  const more = accounts.length - shown.length;
  const active = (route: string) => r.path === route || r.path.startsWith(route.replace("/general", "") + "/") || (route === "/settings/general" && r.path.startsWith("/settings"));
  return (
    <nav aria-label={t("Điều hướng chính")} className={cx("glass relative z-20 m-3 mr-0 flex shrink-0 flex-col rounded-lg pt-3 transition-[width] duration-200", collapsed ? "w-[72px] items-center" : "w-[264px]")}>
      <div className={cx("drag flex h-12 items-center gap-2.5", collapsed ? "justify-center" : "px-5")}>
        <img src={logo} alt="" width={30} height={30} className="size-[30px] rounded-[9px]" />
        {!collapsed && <span className="text-md font-semibold tracking-tight text-ink">Muse4AI</span>}
      </div>
      <ul className={cx("mt-3 flex flex-col gap-1", collapsed ? "items-center px-2" : "px-3")}>
        {NAV.map((n, i) => {
          const Icon = NAV_ICONS[i];
          const on = active(n.route);
          const badge = n.route === "/queue" && counts && counts.unfinished > 0 ? counts.unfinished : 0;
          const dot = n.route === "/queue" && counts && (counts.review > 0 || counts.failedUnseen > 0);
          return (
            <li key={n.route} className={collapsed ? "" : "w-full"}>
              <button
                type="button"
                onClick={() => navigate(n.route)}
                aria-current={on ? "page" : undefined}
                aria-label={collapsed ? tc("nav", n.label) : undefined}
                aria-keyshortcuts={`Control+${n.key}`}
                title={collapsed ? `${tc("nav", n.label)} (Ctrl+${n.key})` : `Ctrl+${n.key}`}
                className={cx(
                  "relative flex h-11 items-center gap-3 rounded-[14px] text-base transition-colors duration-150",
                  collapsed ? "w-11 justify-center" : "w-full px-3.5",
                  on ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2 hover:bg-surface/60 hover:text-ink",
                )}
              >
                <Icon className="size-[19px] shrink-0" aria-hidden />
                {!collapsed && <span className="flex-1 text-left">{tc("nav", n.label)}</span>}
                {badge > 0 && !collapsed && (
                  <span className="min-w-6 rounded-full bg-ink/8 px-2 py-0.5 text-center text-xs font-semibold text-ink" aria-label={t("{badge} lượt chưa xong", { badge })}>
                    {badge > 999 ? "999+" : formatNumber(badge)}
                  </span>
                )}
                {dot && <span className={cx("rounded-full bg-attention", collapsed ? "absolute right-1.5 top-1.5 size-2" : "size-2")} aria-label={t("Có lượt cần anh xem")} />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={cx("mt-5 h-px bg-line", collapsed ? "mx-3 w-10" : "mx-5")} />
      <div className={cx("scroll-area mt-4 min-h-0 flex-1 overflow-x-hidden", collapsed ? "px-2" : "px-3")}>
        {!collapsed && <div className="mb-2 px-2 text-sm font-medium text-ink-2">{tc("nav", "Tài khoản")}</div>}
        {accounts.length === 0 && !collapsed && (
          <button type="button" onClick={() => navigate("/accounts")} className="w-full rounded-[14px] px-2 py-2 text-left text-sm text-ink-2 hover:bg-surface/60">
            {t("Chưa có tài khoản — bấm để thêm")}
          </button>
        )}
        <ul className={cx("flex flex-col", collapsed ? "items-center gap-2" : "gap-0.5")}>
          {shown.map((a) => {
            const st = accountStatus(a);
            return (
              <li key={a.id} className="relative w-full" onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)}>
                <button
                  type="button"
                  onClick={() => navigate(`/accounts?focus=${a.id}`)}
                  className={cx("flex w-full items-center gap-3 rounded-[14px] py-1.5 text-left hover:bg-surface/60", collapsed ? "justify-center px-0" : "px-2")}
                  aria-label={`${a.alias} — ${st.label}`}
                >
                  <span className="relative shrink-0">
                    <Avatar account={a} size={collapsed ? 40 : 44} />
                  </span>
                  {!collapsed && (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-ink">{a.alias}</span>
                      <span className="block truncate text-sm text-ink-2">{a.state === "busy" && a.currentJobId ? t("Đang tạo") : st.label}</span>
                    </span>
                  )}
                </button>
                {hover === a.id && (a.stateNote || collapsed) && (
                  <div role="tooltip" className="glass-strong pointer-events-none absolute left-full top-1 z-50 ml-2 w-56 rounded-md px-3 py-2 text-sm text-ink">
                    <div className="font-medium">{a.alias}</div>
                    <div className="text-ink-2">{st.label}</div>
                    {a.stateNote && <div className="mt-1 text-ink-2">{t(a.stateNote)}</div>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {more > 0 && (
          <button type="button" onClick={() => navigate("/accounts")} className={cx("mt-1 rounded-[14px] py-1.5 text-sm font-medium text-ink-2 hover:bg-surface/60", collapsed ? "w-11" : "w-full px-2 text-left")}>
            +{more}
          </button>
        )}
      </div>
      {(!connected || engine?.diskState !== "ok") && (
        <div className={cx("m-3 rounded-md bg-attention-soft p-2.5 text-sm text-ink", collapsed && "p-2")} role="status">
          {!connected ? (
            <span className="flex items-center gap-2">
              <Plug className="size-4 shrink-0 text-attention-ink" aria-hidden />
              {!collapsed && t("Đang kết nối lại…")}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <HardDrive className="size-4 shrink-0 text-attention-ink" aria-hidden />
              {!collapsed && t("Ổ đĩa còn {diskFreeBytes}", { diskFreeBytes: formatBytes(engine?.diskFreeBytes ?? 0) })}
            </span>
          )}
        </div>
      )}
      {collapsed ? (
        <div className="flex justify-center pb-3 pt-1">
          <LanguageToggle origin="sidebar" />
        </div>
      ) : (
        <div className="px-5 pb-3 pt-2">
          <LanguageSwitch origin="sidebar" />
        </div>
      )}
      <SidebarCredit collapsed={collapsed} />
    </nav>
  );
}

/** S10 — system banners: lost engine connection, Muse UI changed, disk low. */
export function SystemBanners() {
  const engine = useUi((s) => s.snap?.engine);
  const connected = useUi((s) => s.connected);
  const recovered = useUi((s) => s.snap?.recovered);
  const [hideDisk, setHideDisk] = useState(false);
  const items: React.ReactNode[] = [];
  if (!connected)
    items.push(
      <Banner key="conn" tone="danger" icon={<Plug className="size-4" />} title={t("Đang kết nối lại…")} body={t("Bộ máy chạy nền không trả lời. Các lượt vẫn được lưu an toàn trên máy; tạm khoá thao tác cho đến khi nối lại.")}>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={() => location.reload()}>
          {t("Tải lại giao diện")}
        </Button>
      </Banner>,
    );
  if (engine?.uiChangedKinds.length)
    items.push(
      <Banner key="ui" tone="attention" icon={<Wrench className="size-4" />} title={t("Muse vừa đổi giao diện")} body={t("Em tạm dừng các lượt {value} để không gửi sai. Các lượt khác vẫn chạy.", { value: engine.uiChangedKinds.map((k) => (k === "image" ? t("ảnh") : "video")).join(t(" và ")) })}>
        <Button size="sm" variant="secondary" onClick={() => void call("engine.clearUiChanged", { site: "muse" })}>
          {t("Thử lại")}
        </Button>
      </Banner>,
    );
  if (engine && engine.diskState !== "ok" && !hideDisk)
    items.push(
      <Banner key="disk" tone={engine.diskState === "paused" ? "danger" : "attention"} icon={<HardDrive className="size-4" />} title={engine.diskState === "paused" ? t("Ổ đĩa gần đầy — đã tạm dừng tải về") : t("Ổ đĩa sắp đầy")} body={t("Còn {diskFreeBytes} trống ở thư mục thư viện.", { diskFreeBytes: formatBytes(engine.diskFreeBytes ?? 0) })}>
        <Button size="sm" variant="secondary" onClick={() => navigate("/settings/general")}>
          {t("Mở Cài đặt")}
        </Button>
        {engine.diskState === "warn" && (
          <IconButton label={t("Ẩn")} size="sm" onClick={() => setHideDisk(true)}>
            <X className="size-4" />
          </IconButton>
        )}
      </Banner>,
    );
  if (recovered && (recovered.recovered > 0 || recovered.review > 0))
    items.push(
      <Banner key="rec" tone="info" icon={<CheckCircle2 className="size-4" />} title={t("Đã khôi phục {recovered} lượt{value}", { recovered: formatNumber(recovered.recovered), value: recovered.review ? t(" · {review} cần xem", { review: formatNumber(recovered.review) }) : "" })} body={t("Hàng chờ được giữ nguyên từ lần mở trước.")}>
        {recovered.review > 0 && (
          <Button size="sm" variant="secondary" onClick={() => navigate("/queue?f=review")}>
            {t("Xem")}
          </Button>
        )}
        <IconButton
          label={t("Ẩn")}
          size="sm"
          onClick={() => {
            void call("app.dismissRecovered");
            setState((s) => ({ snap: s.snap ? { ...s.snap, recovered: null } : s.snap }));
          }}
        >
          <X className="size-4" />
        </IconButton>
      </Banner>,
    );
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 px-8 pt-3">{items}</div>;
}

function Banner({ tone, icon, title, body, children }: { tone: "danger" | "attention" | "info"; icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("glass-card flex items-center gap-3 rounded-md px-4 py-2.5", tone === "danger" ? "border-l-4 border-l-danger" : tone === "attention" ? "border-l-4 border-l-attention" : "border-l-4 border-l-accent")}>
      <span className={cx("shrink-0", tone === "danger" ? "text-danger-ink" : tone === "attention" ? "text-attention-ink" : "text-accent-ink")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-ink">{title}</div>
        {body && <div className="text-sm text-ink-2">{body}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const live = useUi((s) => s.live);
  const overlays = useOverlays();
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {live}
      </div>
      {/* Never over an overlay's buttons: beneath a modal's scrim; top-left (empty canvas / page header) beside a right panel. */}
      {/* Bottom-right sits above the Studio composer (its height is published as --composer-clear) so the send button stays reachable. */}
      <div data-toasts className={cx("pointer-events-none fixed flex w-[360px] flex-col gap-2", overlays.modal ? "z-40" : "z-[70]", overlays.side && !overlays.modal ? "left-5 top-5" : "right-5 bottom-[calc(var(--composer-clear,0px)+20px)]")}>
        {toasts.map((item) => (
          <div key={item.id} role={item.tone === "danger" ? "alert" : "status"} className="glass-strong pointer-events-auto flex items-start gap-3 rounded-md px-4 py-3">
            <span className={cx("mt-0.5 shrink-0", item.tone === "ok" ? "text-ok-ink" : item.tone === "danger" ? "text-danger-ink" : item.tone === "attention" ? "text-attention-ink" : "text-accent-ink")}>
              {item.tone === "ok" ? <CheckCircle2 className="size-4" /> : item.tone === "info" ? <Info className="size-4" /> : <AlertTriangle className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-ink">{item.title}</div>
              {item.body && <div className="mt-0.5 text-sm text-ink-2">{item.body}</div>}
              {(item.route || item.action) && (
                <button
                  type="button"
                  className="mt-1.5 text-sm font-semibold text-accent-ink hover:underline"
                  onClick={() => {
                    if (item.action) item.action.run();
                    else if (item.route) navigate(item.route);
                    dismissToast(item.id);
                  }}
                >
                  {item.action?.label ?? t("Mở")}
                </button>
              )}
            </div>
            <IconButton label={t("Đóng thông báo")} size="sm" className="-mr-2 -mt-1" onClick={() => dismissToast(item.id)}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </>
  );
}
