import { CheckCircle2, Download, ExternalLink, History, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatDateTime } from "@shared/format";
import { getLocale, t } from "@shared/i18n";
import { isNewer, latestIsKept, type UpdateNote, type UpdateStatus } from "@shared/updates";
import { Confirm } from "../components/Overlay";
import { Button, IconButton, Pill, Spinner, Switch } from "../components/ui";
import { act, call } from "../lib/api";
import { useUi } from "../lib/store";

// Build 3.3 — Cài đặt › Giới thiệu › Cập nhật (Spec AC-UPD-02…08, AC-RBK-02/03). Everything shown comes from the main
// process's updater status; buttons only ask main to act, and main re-checks every rule.

const noteText = (n: UpdateNote) => (getLocale() === "vi" ? n.vi : n.en);

function Notes({ notes }: { notes: UpdateNote[] }) {
  if (!notes.length) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-2">
      {notes.map((n, i) => (
        <li key={i}>{noteText(n)}</li>
      ))}
    </ul>
  );
}

function StatusLine({ u }: { u: UpdateStatus }) {
  if (u.checking)
    return (
      <div className="flex items-center gap-2 text-base text-ink" role="status">
        <Spinner />
        {t("Đang kiểm tra bản mới…")}
      </div>
    );
  if (u.error)
    return (
      <div className="text-base text-ink" role="status">
        <div className="text-danger-ink">{t("Không kiểm tra được: {error}", { error: t(u.error) })}</div>
        {u.checkedAt !== null && <div className="text-sm text-ink-2">{t("Lần kiểm được gần nhất: {time}", { time: formatDateTime(u.checkedAt) })}</div>}
      </div>
    );
  if (u.available && u.latest)
    return (
      <div className="flex flex-wrap items-center gap-2 text-base text-ink" role="status">
        <Pill tone="accent" icon={<Sparkles className="size-3.5" aria-hidden />}>
          {t("Có bản mới")}
        </Pill>
        <span className="font-medium">{u.latest.version}</span>
        <span className="text-sm text-ink-2">
          {u.latest.bytes ? t("{date} · {size}", { date: u.latest.date, size: formatBytes(u.latest.bytes) }) : u.latest.date}
        </span>
      </div>
    );
  if (u.checkedAt !== null)
    return (
      <div className="flex items-center gap-2 text-base text-ink" role="status">
        <CheckCircle2 className="size-4 text-ok-ink" aria-hidden />
        <span>{t("Bạn đang dùng bản mới nhất")}</span>
        <span className="text-sm text-ink-2">{t("· kiểm lúc {time}", { time: formatDateTime(u.checkedAt) })}</span>
      </div>
    );
  return <div className="text-base text-ink-2">{t("Chưa kiểm tra bản mới lần nào.")}</div>;
}

function Progress({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
  return (
    <div className="min-w-0 flex-1">
      <div className="h-2 overflow-hidden rounded-full bg-ink/8" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Đang tải bản mới")}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-sm text-ink-2">{t("Đang tải {pct}% · {received} / {total}", { pct, received: formatBytes(received), total: formatBytes(total) })}</div>
    </div>
  );
}

function Actions({ u, onInstall }: { u: UpdateStatus; onInstall: () => void }) {
  const m = u.latest;
  if (!u.available || !m) return null;
  if (latestIsKept(u)) return <p className="text-sm text-ink-2">{t("Bản {version} đã có sẵn trên máy — bấm “Chuyển sang bản này” bên dưới, không cần tải lại.", { version: m.version })}</p>;
  if (!u.installable || !m.url)
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="primary" icon={<ExternalLink className="size-4" />} onClick={() => void act("update.openPage")}>
            {t("Mở trang tải về")}
          </Button>
        </div>
        <p className="text-sm text-ink-2">{!u.installable ? t("App này không chạy từ thư mục cài nên không tự cài được — hãy tải bộ cài trên website.") : t("Bản này chưa có bộ cài để tải trong app — xem trang tải về.")}</p>
      </div>
    );
  const d = u.download;
  if (d.state === "downloading")
    return (
      <div className="flex items-center gap-3">
        <Progress received={d.received} total={d.total} />
        <Button size="sm" variant="ghost" onClick={() => void act("update.cancel")}>
          {t("Huỷ")}
        </Button>
      </div>
    );
  if (d.state === "verifying")
    return (
      <div className="flex items-center gap-2 text-sm text-ink-2" role="status">
        <Spinner />
        {t("Đang kiểm tra mã SHA-256 của bộ cài…")}
      </div>
    );
  if (d.state === "ready")
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={onInstall}>
            {t("Cài và mở lại")}
          </Button>
        </div>
        <p className="text-sm text-ink-2">{t("Bộ cài đã tải và khớp mã kiểm tra. Muse4AI sẽ đóng, cài bản mới trong khoảng một phút rồi tự mở lại; dữ liệu, tài khoản và thư viện giữ nguyên.")}</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="primary" icon={<Download className="size-4" />} onClick={() => void act("update.download")}>
          {m.bytes ? t("Tải và cài ({size})", { size: formatBytes(m.bytes) }) : t("Tải và cài")}
        </Button>
      </div>
      {d.state === "error" && d.error && <p className="text-sm text-danger-ink">{t(d.error)}</p>}
    </div>
  );
}

function RollbackRow({ u, onRollback }: { u: UpdateStatus; onRollback: () => void }) {
  const r = u.rollback;
  if (!r.ok && r.reason === "not_installed") return null;
  // After going back, the version kept on disk is the newer one: offer it as "switch to", never "go back to".
  if (r.ok && isNewer(r.version, u.current))
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-base text-ink">
            <History className="size-4 text-ink-2" aria-hidden />
            {t("Bản mới hơn còn giữ: {version}", { version: r.version })}
          </div>
          <div className="text-sm text-ink-2">{t("Bạn đã quay lại bản {current}. Mở lại bản {version} bất cứ lúc nào; dữ liệu giữ nguyên.", { current: u.current, version: r.version })}</div>
        </div>
        <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={onRollback}>
          {t("Chuyển sang bản này")}
        </Button>
      </div>
    );
  const why = r.ok
    ? null
    : r.reason === "newer_data"
      ? t("Bản {version} không đọc được dữ liệu hiện tại (kho dữ liệu đã nâng cấp), nên không quay lại được.", { version: r.version ?? "" })
      : r.reason === "unknown"
        ? t("Không rõ bản {version} có đọc được dữ liệu hiện tại không, nên app không mời quay lại.", { version: r.version ?? "" })
        : t("Chưa có bản trước. Sau mỗi lần cập nhật, máy giữ lại một bản cũ để quay lại khi cần.");
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-base text-ink">
          <History className="size-4 text-ink-2" aria-hidden />
          {r.version ? t("Bản trước còn giữ: {version}", { version: r.version }) : t("Bản trước")}
        </div>
        <div className="text-sm text-ink-2">{why ?? t("Mở lại bản này nếu bản mới có vấn đề. Dữ liệu giữ nguyên.")}</div>
      </div>
      {r.ok && (
        <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={onRollback}>
          {t("Quay lại bản này")}
        </Button>
      )}
    </div>
  );
}

export function UpdateCard({ children }: { children?: React.ReactNode }) {
  const u = useUi((x) => x.snap?.update);
  const autoCheck = useUi((x) => x.snap?.settings.updateCheck ?? true);
  const [confirm, setConfirm] = useState<{ kind: "install"; running: number } | { kind: "rollback"; running: number; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!u) return null;

  const install = async (force: boolean) => {
    setBusy(true);
    try {
      const r = await call<{ needsConfirm: boolean; running: number }>("update.install", { force });
      if (r.needsConfirm) setConfirm({ kind: "install", running: r.running });
      else setConfirm(null);
    } catch {
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="glass-card mb-4 rounded-lg p-5" aria-labelledby="update-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="update-title" className="text-md font-semibold text-ink">
            {t("Cập nhật")}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t("Phiên bản đang dùng: {version}", { version: u.current })}</p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={u.checking} onClick={() => void act("update.check")}>
          {t("Kiểm tra ngay")}
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {u.justUpdated && (
          <div className="rounded-[14px] bg-ok-soft p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-base font-medium text-ink">{t("Đã cập nhật từ {from} lên {version}", { from: u.justUpdated.from, version: u.current })}</div>
              <IconButton size="sm" label={t("Đóng")} onClick={() => void act("update.dismissJustUpdated")}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="mt-2">
              <Notes notes={u.justUpdated.notes} />
            </div>
          </div>
        )}
        <StatusLine u={u} />
        {u.available && u.latest && <Notes notes={u.latest.notes} />}
        <Actions u={u} onInstall={() => void install(false)} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-base text-ink">{t("Tự kiểm tra bản mới")}</div>
            <div className="text-sm text-ink-2">{t("Lúc mở app và mỗi 12 giờ, app chỉ đọc một tệp nhỏ trên website Muse4AI — không gửi dữ liệu nào của bạn.")}</div>
          </div>
          <Switch checked={autoCheck} label={t("Tự kiểm tra bản mới")} onChange={(v) => void act("settings.set", { key: "updateCheck", value: v })} />
        </div>
        <RollbackRow u={u} onRollback={() => u.rollback.ok && setConfirm({ kind: "rollback", running: 0, version: u.rollback.version })} />
        {children}
      </div>
      <Confirm
        open={confirm?.kind === "install"}
        title={t("Còn {running} lượt đang chạy", { running: confirm?.running ?? 0 })}
        body={t("Cài ngay sẽ đóng Muse4AI. Lượt đã gửi sẽ được đối soát khi mở lại app; lượt chưa gửi vẫn nằm trong hàng chờ. Hoặc để sau, khi các lượt xong.")}
        confirmLabel={t("Cài ngay")}
        cancelLabel={t("Để sau")}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void install(true)}
      />
      <Confirm
        open={confirm?.kind === "rollback"}
        title={
          confirm?.kind === "rollback" && isNewer(confirm.version, u.current)
            ? t("Chuyển sang bản {version}?", { version: confirm.version })
            : t("Quay lại bản {version}?", { version: confirm?.kind === "rollback" ? confirm.version : "" })
        }
        body={t("Muse4AI sẽ đóng rồi mở bản {version}. Dữ liệu, tài khoản và thư viện giữ nguyên; bản {current} vẫn nằm trên máy. Lượt đang chạy (nếu có) sẽ được đối soát khi mở lại.", { version: confirm?.kind === "rollback" ? confirm.version : "", current: u.current })}
        confirmLabel={confirm?.kind === "rollback" && isNewer(confirm.version, u.current) ? t("Chuyển") : t("Quay lại")}
        cancelLabel={t("Không")}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          await call("update.rollback", { force: true }).catch(() => undefined);
          setBusy(false);
          setConfirm(null);
        }}
      />
    </section>
  );
}

/** Dot for the sidebar and the Giới thiệu tab while a newer version is waiting (AC-UPD-04). */
export function useUpdateDot(): boolean {
  return useUi((x) => !!x.snap?.update?.available);
}
