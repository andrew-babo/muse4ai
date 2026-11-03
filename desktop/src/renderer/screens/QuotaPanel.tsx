import { Gauge, RefreshCw } from "lucide-react";
import { useState } from "react";
import { quotaPanelText, quotaView, type QuotaView } from "@shared/quota";
import type { Account } from "@shared/types";
import { IconButton, Spinner } from "../components/ui";
import { act } from "../lib/api";
import { useNow } from "../lib/hooks";
import { cx } from "../lib/ui";
import { t } from "@shared/i18n";

// Screens rev 8 §13 — “Hạn mức Muse” on the account card (S07-quota-*; AC-QTA-01/02/11). Numbers as Muse shows them,
// never a fake 0 % bar. The block keeps a fixed height while reading so the card does not jump.

const BAR: Record<QuotaView["tier"], string> = {
  ok: "bg-accent",
  unknown: "bg-neutral",
  low: "bg-attention",
  additional: "bg-attention",
  weekly_full: "bg-attention",
  exhausted: "bg-danger",
};

export function QuotaPanel({ account: a }: { account: Account }) {
  const now = useNow(60_000);
  const [asking, setAsking] = useState(false);
  const v = quotaView(a.quota, now);
  const raw = quotaPanelText(a.quota, now);
  const cur = Object.fromEntries(Object.entries(raw).map(([k, val]) => [k, typeof val === "string" ? t(val) : val])) as typeof raw;
  const reading = asking || !!a.quotaReading;
  const blocked = a.state === "limit_reached";
  const fromMuse = blocked && a.quota?.limitFrom === "muse";
  const read = async () => {
    setAsking(true);
    try {
      await act("account.readQuota", { id: a.id }, t("Đã cập nhật hạn mức"));
    } finally {
      setAsking(false);
    }
  };
  const used = Math.max(0, Math.min(100, v.weeklyUsed ?? 0));
  return (
    <section className="rounded-[12px] bg-ink/4 px-3 py-2.5 text-sm" aria-label={t("Hạn mức Muse của {alias}", { alias: a.alias })} aria-busy={reading}>
      <div className="flex items-center gap-2">
        <Gauge className="size-4 shrink-0 text-ink-2" aria-hidden />
        <h3 className="text-xs font-medium text-ink-2">{t("Hạn mức Muse")}</h3>
        {v.known && a.quota?.plan && (
          <span className="truncate text-xs text-ink-3" title={a.quota.plan}>
            · {a.quota.plan}
          </span>
        )}
        <span className="flex-1" />
        <IconButton label={t("Đọc lại hạn mức của {alias}", { alias: a.alias })} size="sm" onClick={() => void read()} disabled={reading}>
          {reading ? <Spinner /> : <RefreshCw className="size-3.5" />}
        </IconButton>
      </div>
      {v.known ? (
        <div className="mt-1.5 flex flex-col gap-2">
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink-2">{t("Tuần")}</span>
              <span className="truncate text-ink" title={cur.weekly ?? undefined}>
                {cur.weekly}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/8"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={used}
              aria-label={t("Hạn mức tuần đã dùng {weeklyUsed} %", { weeklyUsed: v.weeklyUsed })}
            >
              <div className={cx("h-full rounded-full transition-[width] duration-300", BAR[v.tier], v.stale && "opacity-50")} style={{ width: `${used}%` }} />
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="shrink-0 text-ink-2">{t("Token bổ sung")}</span>
            <span className={cx("truncate", v.additional === "available" ? "text-ink" : "text-ink-2")} title={cur.additional ?? undefined}>
              {cur.additional}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-[3.25rem] items-center justify-between gap-2 text-xs">
          <span className="text-ink-2">{t("Chưa đọc hạn mức")}</span>
          <button type="button" className="rounded-full px-2 py-1 font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-50" onClick={() => void read()} disabled={reading}>
            {reading ? t("Đang đọc…") : t("Đọc ngay")}
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
        {cur.readAt && <span>{cur.readAt}</span>}
        {v.stale && <span className="rounded-full bg-neutral-soft px-1.5 py-px text-ink-2">{t("cũ")}</span>}
        {blocked && <span>{t("lượt mới chuyển sang tài khoản khác")}</span>}
      </div>
      {fromMuse && <p className="mt-1 text-xs text-ink-2">{t("Muse báo hết hạn mức khi đang tạo")}</p>}
      {cur.error && <p className="mt-1 text-xs text-attention-ink">{cur.error}</p>}
    </section>
  );
}
