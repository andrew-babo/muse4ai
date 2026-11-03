import { AlertTriangle, Moon, Pause, ShieldAlert, Unplug } from "lucide-react";
import type { Account } from "@shared/types";
import { accountStatus, AVATARS, cx, TONE_CLASS } from "../lib/ui";
import { t } from "@shared/i18n";

// Living avatar (spec §4.2, screens §1.1): identity + state. Never color-only: badge icon + text label elsewhere.

export function Avatar({ account, size = 40, showStatus = true, className }: { account: Pick<Account, "avatar" | "alias" | "state" | "stateUntil" | "stateNote"> | null; size?: number; showStatus?: boolean; className?: string }) {
  if (!account) {
    return (
      <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-ink/8 text-ink-3", className)} style={{ width: size, height: size }} aria-label={t("Đang chờ tài khoản")}>
        <span className="size-2 rounded-full bg-neutral" />
      </span>
    );
  }
  const st = accountStatus(account);
  const working = account.state === "busy" || account.state === "logging_in" || account.state === "takeover";
  const badge = size >= 32 && showStatus;
  const b = Math.max(14, Math.round(size * 0.36));
  return (
    <span className={cx("relative inline-flex shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={`${account.alias}: ${st.label}`}>
      {working && showStatus && (
        <span
          className="absolute -inset-[3px] animate-spin-slow rounded-full"
          style={{ background: "conic-gradient(from 0deg, var(--color-accent), transparent 65%, var(--color-accent))", mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))" }}
          aria-hidden
        />
      )}
      <span className={cx("relative block size-full overflow-hidden rounded-full bg-surface shadow-sm ring-1 ring-line", (account.state === "paused" || account.state === "new") && "opacity-60 grayscale-[40%]")}>
        <img src={AVATARS[account.avatar % AVATARS.length]} alt="" width={size} height={size} draggable={false} className={cx("size-full object-cover", working && "animate-breathe")} />
      </span>
      {badge && account.state !== "busy" && (
        <span
          className={cx("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-surface", TONE_CLASS[st.tone].dot)}
          style={{ width: account.state === "ready" ? Math.max(10, b * 0.7) : b, height: account.state === "ready" ? Math.max(10, b * 0.7) : b }}
          aria-hidden
        >
          {account.state === "cooling_down" || account.state === "limit_reached" ? (
            <Moon className="size-[60%] text-on-ink" />
          ) : account.state === "needs_login" || account.state === "checkpoint" ? (
            <ShieldAlert className="size-[60%] text-on-ink" />
          ) : account.state === "proxy_error" ? (
            <Unplug className="size-[60%] text-on-ink" />
          ) : account.state === "paused" ? (
            <Pause className="size-[55%] text-on-ink" />
          ) : account.state === "new" ? (
            <AlertTriangle className="size-[55%] text-on-ink" />
          ) : null}
        </span>
      )}
    </span>
  );
}
