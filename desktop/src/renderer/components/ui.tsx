import { Loader2, Minus, Plus } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import type { StatusTone } from "@shared/accountMachine";
import { cx, TONE_CLASS } from "../lib/ui";
import { t } from "@shared/i18n";
import { HelpButton } from "./HelpButton";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink/90 active:bg-ink/80",
  secondary: "glass-card text-ink hover:bg-surface",
  ghost: "text-ink hover:bg-ink/5 active:bg-ink/10",
  danger: "bg-danger text-on-ink hover:bg-danger/90",
  quiet: "text-ink-2 hover:text-ink hover:bg-ink/5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background,color,box-shadow,transform] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-md" : "h-10 px-4 text-base",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, variant = "ghost", size = "md", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Pill({ tone, children, className, icon }: { tone: StatusTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", TONE_CLASS[tone].pill, className)}>
      {icon ?? <span className={cx("size-1.5 rounded-full", TONE_CLASS[tone].dot)} aria-hidden />}
      {children}
    </span>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-ink-2", className)} aria-label={label} role={label ? "status" : undefined} aria-hidden={label ? undefined : true} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40", checked ? "bg-ink" : "bg-ink/15")}
    >
      <span className={cx("inline-block size-5 rounded-full bg-surface shadow transition-transform duration-150", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}

/** WAI-ARIA radio group: one Tab stop (the checked option), arrow keys / Home / End move and select. */
export function Segmented<T extends string>({ value, options, onChange, label, size = "md", autoFocus }: { value: T; options: { value: T; label: string; icon?: ReactNode; disabled?: boolean; hint?: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md"; autoFocus?: boolean }) {
  const enabled = options.filter((o) => !o.disabled);
  const tabStop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir && e.key !== "Home" && e.key !== "End") return;
    if (!enabled.length) return;
    e.preventDefault();
    const i = Math.max(0, enabled.findIndex((o) => o.value === value));
    const next = e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[enabled.length - 1] : enabled[(i + dir + enabled.length) % enabled.length];
    if (next.value !== value) onChange(next.value);
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx("inline-flex items-center rounded-full bg-ink/5 p-1", size === "sm" ? "h-9" : "h-10")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={o.value === tabStop ? 0 : -1}
          data-value={o.value}
          data-autofocus={autoFocus && value === o.value ? true : undefined}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-full items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-10 w-full rounded-[12px] border bg-surface px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        invalid ? "border-danger" : "border-line-strong",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-danger-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

/** Number field with − / + buttons (screens §11.4: ±1 lần or ±5 giây). Typing is allowed; the value is clamped on blur. */
export function Stepper({ value, onChange, min, max, step = 1, label, suffix, id }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; suffix?: string; id?: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="inline-flex h-10 items-center rounded-[12px] border border-line-strong bg-surface">
      <button type="button" aria-label={t("Giảm {label}", { label })} className="flex h-full w-9 items-center justify-center rounded-l-[12px] text-ink-2 hover:bg-ink/5 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus className="size-4" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        onBlur={() => onChange(clamp(Number.isFinite(value) ? value : min))}
        className="h-full w-14 bg-transparent text-center font-mono text-base text-ink [appearance:textfield] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="pr-1 text-sm text-ink-2">{suffix}</span>}
      <button type="button" aria-label={t("Tăng {label}", { label })} className="flex h-full w-9 items-center justify-center rounded-r-[12px] text-ink-2 hover:bg-ink/5 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(clamp((Number.isFinite(value) ? value : min) + step))}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Neutral “Vibes” pill next to the kind label (screens §11.3), styled like the API source pill. */
export function SitePill({ site }: { site: "muse" | "vibes" }) {
  if (site !== "vibes") return null;
  return <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-2">Vibes</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-2">{children}</kbd>;
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="flex size-14 items-center justify-center rounded-full bg-surface text-ink-2 shadow-sm">{icon}</div>}
      <h3 className="text-md font-semibold text-ink">{title}</h3>
      {body && <p className="max-w-md text-base text-ink-2">{body}</p>}
      {action}
    </div>
  );
}

export function SectionTitle({ children, actions, sub, help = true }: { children: ReactNode; actions?: ReactNode; sub?: ReactNode; /** "?" that opens this screen's Guide article (R3-APP.8). */ help?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{children}</h1>
          {help && <HelpButton className="-mb-0.5 text-ink-2 hover:text-ink" />}
        </div>
        {sub && <p className="mt-1 text-base text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
