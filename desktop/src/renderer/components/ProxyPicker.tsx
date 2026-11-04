import { useMemo } from "react";
import { Info } from "lucide-react";
import { formatLatency } from "@shared/format";
import { namesSummary, proxyChoices } from "@shared/proxyShare";
import type { Account, Proxy } from "@shared/types";
import { t } from "@shared/i18n";
import { cx } from "../lib/ui";

// Build 3.2 R144/R145 — one proxy list for “Thêm tài khoản” and “Đổi proxy”: who already uses each proxy is always
// visible (read from the accounts), unused proxies come first, and choosing a shared one only shows a gentle note.

export function sharedProxyNote(users: readonly Pick<Account, "alias">[]): string | null {
  return users.length ? t("Proxy này đang dùng cho {names}. Dùng chung được, nhưng các tài khoản sẽ ra cùng một địa chỉ IP.", { names: namesSummary(users.map((u) => u.alias)) }) : null;
}

export function ProxyPicker({
  proxies,
  accounts,
  value,
  onChange,
  healthyOnly = false,
  forAccountId = null,
  label,
}: {
  proxies: Proxy[];
  accounts: Account[];
  value: string | null;
  onChange: (id: string) => void;
  /** Add-account rule: only a healthy proxy may start a new account. */
  healthyOnly?: boolean;
  /** The account being edited: left out of the “in use by” names and marked on its current proxy. */
  forAccountId?: string | null;
  label: string;
}) {
  const choices = useMemo(() => proxyChoices(proxies, accounts, { healthyOnly, forAccountId }), [proxies, accounts, healthyOnly, forAccountId]);
  const current = forAccountId ? accounts.find((a) => a.id === forAccountId)?.proxyId ?? null : null;
  const picked = choices.find((c) => c.proxy.id === value);
  const note = picked && picked.proxy.id !== current ? sharedProxyNote(picked.users) : null;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-[264px] flex-col gap-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label={label}>
        {choices.map(({ proxy: p, users }) => {
          const on = value === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(p.id)}
                className={cx("flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors", on ? "bg-accent-soft ring-1 ring-accent" : "bg-ink/4 hover:bg-ink/6")}
              >
                <span className={cx("size-2 shrink-0 rounded-full", p.health === "healthy" ? "bg-ok" : p.health === "failed" ? "bg-danger" : "bg-neutral")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {p.label} · {p.scheme.toUpperCase()} · {p.country ?? t("chưa kiểm")}
                  </span>
                  <span className={cx("block truncate text-xs", users.length ? "text-ink-2" : "text-ok-ink")}>
                    {users.length ? t("Đang dùng: {names}", { names: namesSummary(users.map((u) => u.alias)) }) : t("Chưa ai dùng")}
                  </span>
                </span>
                {p.latencyMs ? <span className="shrink-0 font-mono text-xs text-ink-2">{formatLatency(p.latencyMs)}</span> : null}
                {p.id === current && <span className="shrink-0 rounded-full bg-ink/6 px-2 py-0.5 text-xs text-ink-2">{t("đang dùng")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {note && (
        <p className="flex items-start gap-2 rounded-[12px] bg-attention-soft px-3 py-2 text-sm text-attention-ink" role="status">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}
