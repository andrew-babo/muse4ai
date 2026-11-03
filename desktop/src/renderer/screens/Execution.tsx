import { AlertTriangle, Cable, Monitor, RefreshCw, Settings2, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { bridgeCheckLine, EXEC_MODE_HINT, EXEC_MODE_LABEL, EXEC_PATH_LABEL, GLOBAL_CONCURRENCY_RANGE, MAX_CONCURRENT_RANGE, SHARED_CONTEXT_NOTE, stateLabel, UI_MAX_RANGE, UI_PAGES_RANGE, type AccountExecution, type BridgeStatus, type ExecMode } from "@shared/execution";
import { formatDateTime, formatTime } from "@shared/format";
import type { Account } from "@shared/types";
import { Dialog } from "../components/Overlay";
import { Button, Field, Spinner, Stepper, Switch } from "../components/ui";
import { act, call } from "../lib/api";
import { useNow } from "../lib/hooks";
import { navigate } from "../lib/router";
import { pushToast, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { t } from "@shared/i18n";

// Build 2.0 — S07 “Cách chạy” block, S07e dialog, S09g “Chạy việc” settings and the B-HTTP banner (screens.md §1).

/** States where the account takes no new work: the block dims and says so (screens §1 S07). */
const NO_NEW_WORK = new Set<Account["state"]>(["needs_login", "checkpoint", "paused", "new", "logging_in", "proxy_error", "takeover", "limit_reached"]);

function dotClass(e: AccountExecution): string {
  if (e.activePath === "none") return "bg-danger";
  if (e.activePath === "ui") return "bg-attention"; // incl. Tự động on the UI page while HTTP is down — work still runs
  if (e.httpState === "degraded") return "bg-attention";
  if (e.httpState === "unknown") return "bg-neutral";
  return "bg-ok";
}

export function ExecutionBlock({ account: a }: { account: Account }) {
  useNow(30_000); // relative times in the label
  const [editing, setEditing] = useState(false);
  const [probing, setProbing] = useState(false);
  const e = a.execution;
  if (!e) return null;
  const busy = e.runningHttp + e.runningUi;
  const pct = Math.min(100, Math.round((busy / Math.max(1, e.maxConcurrent)) * 100));
  const idle = NO_NEW_WORK.has(a.state);
  // AC-VIEW-01: “Thử HTTP ngay” only when HTTP is down (unknown/flaky states probe on their own).
  const canProbe = e.mode !== "ui" && e.httpState === "down";
  const probe = async () => {
    setProbing(true);
    try {
      const r = await call<Account>("account.probeHttp", { id: a.id });
      const ok = r.execution?.httpState === "healthy";
      pushToast({ tone: ok ? "ok" : "attention", title: ok ? t("{alias}: HTTP dùng được", { alias: a.alias }) : t("{alias}: HTTP vẫn lỗi", { alias: a.alias }), body: ok ? undefined : t(stateLabel(r.execution!, formatTime)) }, 4000);
    } catch {
      /* toast shown */
    } finally {
      setProbing(false);
    }
  };
  return (
    <section className={cx("rounded-[12px] bg-ink/4 px-3 py-2.5 text-sm", idle && "opacity-70")} aria-label={t("Cách chạy của {alias}", { alias: a.alias })}>
      <div className="flex items-center gap-2">
        <Cable className="size-4 shrink-0 text-ink-2" aria-hidden />
        <h3 className="text-xs font-medium text-ink-2">{t("Cách chạy")}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink shadow-sm">{t(EXEC_MODE_LABEL[e.mode])}</span>
        <span className="flex-1" />
        <button type="button" aria-label={t("Đổi cách chạy của {alias}", { alias: a.alias })} title={t("Đổi cách chạy")} onClick={() => setEditing(true)} className="inline-flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink">
          <Settings2 className="size-4" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className={cx("size-2 shrink-0 rounded-full", dotClass(e))} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-ink" title={t(stateLabel(e, formatTime))}>
          {e.probing || probing ? t("Đang thử HTTP…") : t(stateLabel(e, formatTime))}
        </span>
        {canProbe && (
          <button type="button" onClick={() => void probe()} disabled={probing || e.probing} className="shrink-0 rounded-full px-2 py-1 font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-50">
            {probing || e.probing ? <Spinner className="size-3.5" /> : t("Thử HTTP ngay")}
          </button>
        )}
      </div>
      <div className="mt-2">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-2">
            {t(EXEC_PATH_LABEL.http)} {e.runningHttp} · {t(EXEC_PATH_LABEL.ui)} {e.runningUi}
          </span>
          <span className="font-mono text-ink">
            {busy}/{e.maxConcurrent}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/8" role="meter" aria-valuemin={0} aria-valuemax={e.maxConcurrent} aria-valuenow={busy} aria-label={t("Đang làm {busy} trên tối đa {maxConcurrent} việc", { busy, maxConcurrent: e.maxConcurrent })}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {idle && <p className="mt-1.5 text-xs text-ink-2">{t("Không nhận việc mới")}</p>}
      {editing && <ExecutionDialog account={a} onClose={() => setEditing(false)} />}
    </section>
  );
}

const MODES: { value: ExecMode; icon: typeof Zap; badge?: string }[] = [
  { value: "auto", icon: Sparkles, badge: "Khuyên dùng" },
  { value: "http", icon: Zap },
  { value: "ui", icon: Monitor },
];

export function ExecutionDialog({ account: a, onClose }: { account: Account; onClose: () => void }) {
  const [mode, setMode] = useState<ExecMode>(a.execMode);
  const [max, setMax] = useState(a.maxConcurrent);
  const [uiMax, setUiMax] = useState(a.uiMaxConcurrent);
  const [busy, setBusy] = useState(false);
  const maxOk = Number.isInteger(max) && max >= MAX_CONCURRENT_RANGE.min && max <= MAX_CONCURRENT_RANGE.max;
  const uiOk = Number.isInteger(uiMax) && uiMax >= UI_MAX_RANGE.min && uiMax <= UI_MAX_RANGE.max;
  const e = a.execution;
  const save = async () => {
    if (!maxOk || !uiOk) return;
    setBusy(true);
    const r = await act<Account>("account.setExecution", { id: a.id, mode, maxConcurrent: max, uiMaxConcurrent: uiMax }, t("Đã lưu cách chạy"));
    setBusy(false);
    if (r) onClose();
  };
  const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const i = MODES.findIndex((m) => m.value === mode);
    const d = ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    ev.preventDefault();
    const next = MODES[(i + d + MODES.length) % MODES.length].value;
    setMode(next);
    ev.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("Cách chạy · {alias}", { alias: a.alias })}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Huỷ")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!maxOk || !uiOk} onClick={() => void save()}>
            {t("Lưu")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label={t("Cách chạy")} className="flex flex-col gap-2" onKeyDown={onKey}>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              data-mode={m.value}
              aria-checked={mode === m.value}
              tabIndex={mode === m.value ? 0 : -1}
              data-autofocus={mode === m.value ? true : undefined}
              onClick={() => setMode(m.value)}
              className={cx("flex items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors", mode === m.value ? "border-ink bg-surface shadow-sm" : "border-line hover:bg-surface/60")}
            >
              <m.icon className={cx("mt-0.5 size-5 shrink-0", mode === m.value ? "text-ink" : "text-ink-2")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-medium text-ink">
                  {t(EXEC_MODE_LABEL[m.value])}
                  {m.badge && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-ink">{t(m.badge)}</span>}
                </span>
                <span className="mt-0.5 block text-sm text-ink-2">{t(EXEC_MODE_HINT[m.value])}</span>
              </span>
              <span className={cx("mt-1 size-4 shrink-0 rounded-full border-2", mode === m.value ? "border-ink bg-ink shadow-[inset_0_0_0_3px_var(--color-surface)]" : "border-line-strong")} aria-hidden />
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("Tối đa việc cùng lúc")} htmlFor="exec-max" error={maxOk ? null : t("Nhập từ {min} đến {max}", { min: MAX_CONCURRENT_RANGE.min, max: MAX_CONCURRENT_RANGE.max })} hint={t("Tính chung cho cả HTTP và giao diện")}>
            <Stepper id="exec-max" label={t("Tối đa việc cùng lúc")} value={max} onChange={setMax} min={MAX_CONCURRENT_RANGE.min} max={MAX_CONCURRENT_RANGE.max} />
          </Field>
          <Field label={t("Tối đa qua giao diện")} htmlFor="exec-ui" error={uiOk ? null : t("Nhập từ {min} đến {max}", { min: UI_MAX_RANGE.min, max: UI_MAX_RANGE.max })} hint={t("Mỗi việc dùng một trang Muse riêng · thiếu RAM thì chờ")}>
            <Stepper id="exec-ui" label={t("Tối đa qua giao diện")} value={uiMax} onChange={setUiMax} min={UI_MAX_RANGE.min} max={UI_MAX_RANGE.max} />
          </Field>
        </div>
        {e && (
          <p className="text-sm text-ink-2">
            {t("Đang chạy: HTTP {runningHttp} · Giao diện {runningUi}. Áp dụng cho việc gửi mới; việc đang chạy giữ đường cũ.", { runningHttp: e.runningHttp, runningUi: e.runningUi })}
          </p>
        )}
        <p className="rounded-[12px] bg-ink/4 px-3 py-2 text-sm text-ink-2">{t(SHARED_CONTEXT_NOTE)}</p>
      </div>
    </Dialog>
  );
}

/** S09g — Cài đặt › Chạy việc. */
export function RunSettings() {
  const s = useUi((x) => x.snap?.settings);
  const bridge = useUi((x) => x.snap?.engine?.bridge);
  const accounts = useUi((x) => x.snap?.accounts ?? []);
  const [checking, setChecking] = useState(false);
  if (!s) return null;
  const httpAccounts = accounts.filter((a) => a.execMode !== "ui");
  const anyFree = httpAccounts.some((a) => a.state === "ready");
  const check = async () => {
    setChecking(true);
    try {
      await call<BridgeStatus>("bridge.checkNow", {});
    } catch {
      /* toast shown */
    } finally {
      setChecking(false);
    }
  };
  const incompatible = bridge?.compat === "incompatible";
  return (
    <>
      <section className="glass-card mb-4 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-md font-semibold text-ink">{t("Kênh trực tiếp (HTTP)")}</h2>
            <p className="mt-1 text-sm text-ink-2">{t("Kênh trực tiếp là cách nói chuyện nội bộ của Muse, có thể đổi bất kỳ lúc nào. Tắt thì mọi việc chạy qua giao diện.")}</p>
          </div>
          <Switch label={t("Kênh trực tiếp (HTTP)")} checked={s.bridgeHttpEnabled} onChange={(v) => void act("settings.set", { key: "bridgeHttpEnabled", value: v }, v ? t("Đã bật kênh trực tiếp") : t("Đã tắt kênh trực tiếp — mọi việc chạy qua giao diện"))} />
        </div>
        {incompatible && s.bridgeHttpEnabled && (
          <div className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-ink" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("Kênh trực tiếp Muse không tương thích. App đang chạy qua giao diện; bấm “Kiểm ngay” sau khi cập nhật.")}</span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" icon={checking || bridge?.checking ? <Spinner /> : <RefreshCw className="size-4" />} disabled={!s.bridgeHttpEnabled || checking || !!bridge?.checking || !anyFree} onClick={() => void check()}>
            {t("Kiểm ngay")}
          </Button>
          <span className="text-sm text-ink-2">
            {t(bridgeCheckLine(bridge ?? null, httpAccounts.some((a) => a.execution?.httpState === "healthy"), formatDateTime))}
            {httpAccounts.length > 0 && !anyFree && s.bridgeHttpEnabled ? ` · ${t("Kiểm ngay chạy được khi có tài khoản rảnh")}` : ""}
          </span>
        </div>
        {!httpAccounts.length ? (
          <p className="mt-3 text-sm text-ink-2">{t("Chưa có tài khoản dùng HTTP.")}</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line rounded-md border border-line" aria-label={t("Kết quả kiểm từng tài khoản")}>
            {httpAccounts.map((a) => {
              const r = bridge?.results.find((x) => x.accountId === a.id);
              const running = checking || !!bridge?.checking;
              return (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{a.alias}</span>
                  {running && !r ? (
                    <span className="text-ink-2">{t("Đang thử…")}</span>
                  ) : r ? (
                    <span className={cx("flex items-center gap-1.5", r.ok ? "text-ok-ink" : "text-danger-ink")}>
                      <span className={cx("size-2 rounded-full", r.ok ? "bg-ok" : "bg-danger")} aria-hidden />
                      {r.ok ? t("Đạt") : r.reason ? t(r.reason) : t("Lỗi")}
                      <span className="text-xs text-ink-3">{formatTime(r.at)}</span>
                    </span>
                  ) : a.execution && a.execution.httpState !== "unknown" && a.execution.httpState !== "off" ? (
                    // No “Kiểm ngay” result yet: show what real sends say about this account (R89 health).
                    <span className={cx("flex items-center gap-1.5", a.execution.httpState === "healthy" ? "text-ok-ink" : a.execution.httpState === "down" ? "text-danger-ink" : "text-attention-ink")}>
                      <span className={cx("size-2 rounded-full", a.execution.httpState === "healthy" ? "bg-ok" : a.execution.httpState === "down" ? "bg-danger" : "bg-attention")} aria-hidden />
                      {a.execution.httpState === "healthy" ? t("Đang chạy tốt") : t(stateLabel(a.execution, formatTime))}
                    </span>
                  ) : (
                    <span className="text-ink-3">{t("Chưa kiểm")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="glass-card mb-4 rounded-lg p-5">
        <h2 className="text-md font-semibold text-ink">{t("Giới hạn toàn app")}</h2>
        <p className="mt-1 text-sm text-ink-2">{t("Mỗi tài khoản có “Tối đa việc cùng lúc” riêng trong thẻ tài khoản. Hai số dưới đây là trần chung cho mọi tài khoản cộng lại.")}</p>
        <div className="mt-4 flex flex-col gap-4">
          <NumberSetting label={t("Tối đa toàn app")} hint={t("{min}–{max} việc đang chạy, cả HTTP lẫn giao diện", { min: GLOBAL_CONCURRENCY_RANGE.min, max: GLOBAL_CONCURRENCY_RANGE.max })} keyName="globalConcurrency" value={s.globalConcurrency} range={GLOBAL_CONCURRENCY_RANGE} />
          <NumberSetting label={t("Tối đa trang giao diện")} hint={t("{min}–{max} trang Muse mở cùng lúc trên cả máy (mỗi trang ~350 MB). Mỗi tài khoản mở tối đa số trang đặt ở thẻ tài khoản.", { min: UI_PAGES_RANGE.min, max: UI_PAGES_RANGE.max })} keyName="concurrencyUiPages" value={s.concurrencyUiPages} range={UI_PAGES_RANGE} />
        </div>
      </section>
    </>
  );
}

function NumberSetting({ label, hint, keyName, value, range }: { label: string; hint: string; keyName: "globalConcurrency" | "concurrencyUiPages"; value: number; range: { min: number; max: number } }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value || !Number.isInteger(v) || v < range.min || v > range.max) return;
    const timer = setTimeout(() => void act("settings.set", { key: keyName, value: v }), 400);
    return () => clearTimeout(timer);
  }, [v, value, keyName, range]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-base text-ink">{label}</div>
        <div className="text-sm text-ink-2">{hint}</div>
      </div>
      <Stepper label={label} value={v} onChange={setV} min={range.min} max={range.max} />
    </div>
  );
}

let bannerHidden = false;
/** B-HTTP — app-wide banner while the direct channel is incompatible (closing hides it until the app restarts). */
export function BridgeBanner() {
  const bridge = useUi((x) => x.snap?.engine?.bridge);
  const [hidden, setHidden] = useState(bannerHidden);
  if (hidden || !bridge?.httpEnabled || bridge.compat !== "incompatible") return null;
  return (
    <div className="mx-8 mt-3 flex items-center gap-3 rounded-md bg-attention-soft px-4 py-2 text-sm text-ink" role="status">
      <AlertTriangle className="size-4 shrink-0 text-attention-ink" aria-hidden />
      <span className="min-w-0 flex-1">{t("Kênh trực tiếp Muse không tương thích — đang chạy qua giao diện")}</span>
      <button type="button" className="font-semibold text-accent-ink hover:underline" onClick={() => navigate("/settings/run")}>
        {t("Xem")}
      </button>
      <button
        type="button"
        aria-label={t("Đóng thông báo")}
        className="inline-flex size-7 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5"
        onClick={() => {
          bannerHidden = true;
          setHidden(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
