import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/hooks";
import { cx } from "../lib/ui";
import { Button, IconButton } from "./ui";
import { t } from "@shared/i18n";

// Dialog, drawer and popover menu. All trap focus, close on Esc and return focus to the opener (screens §6).

// Overlays can stack (Kéo dài sheet over the lightbox, job drawer over the chain drawer): Esc closes only the top one.
const layers: number[] = [];
let layerSeq = 0;
export function useLayer(open: boolean): () => boolean {
  const id = useRef(0);
  useEffect(() => {
    if (!open) return;
    const me = ++layerSeq;
    id.current = me;
    layers.push(me);
    return () => {
      const i = layers.indexOf(me);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [open]);
  return useCallback(() => id.current !== 0 && layers[layers.length - 1] === id.current, []);
}

// Toasts must never cover an overlay's buttons: under a modal they sit beneath its scrim until it closes; next to a
// right-side panel (drawer, Kéo dài sheet, Xem lớn) they move to the top-left corner.
const presence = { modal: 0, side: 0 };
let presenceSnap = { modal: false, side: false };
const presenceSubs = new Set<() => void>();
function changePresence(kind: "modal" | "side", d: number): void {
  presence[kind] += d;
  presenceSnap = { modal: presence.modal > 0, side: presence.side > 0 };
  presenceSubs.forEach((f) => f());
}
export function useOverlayPresence(open: boolean, kind: "modal" | "side"): void {
  useEffect(() => {
    if (!open) return;
    changePresence(kind, 1);
    return () => changePresence(kind, -1);
  }, [open, kind]);
}
export function useOverlays(): { modal: boolean; side: boolean } {
  return useSyncExternalStore(
    (f) => {
      presenceSubs.add(f);
      return () => void presenceSubs.delete(f);
    },
    () => presenceSnap,
  );
}

export function Dialog({ open, onClose, title, children, footer, width = 480, labelledBy, dismissable = true }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; labelledBy?: string; dismissable?: boolean }) {
  const ref = useFocusTrap(open);
  const isTop = useLayer(open);
  useOverlayPresence(open, "modal");
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable && isTop()) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [open, onClose, dismissable, isTop]);
  if (!open) return null;
  const id = labelledBy ?? "dlg-title";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="glass-strong flex max-h-[calc(100vh-48px)] w-full flex-col rounded-lg" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <h2 id={id} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {dismissable && (
            <IconButton label={t("Đóng")} size="sm" onClick={onClose} className="-mr-2 -mt-1">
              <X className="size-4" />
            </IconButton>
          )}
        </div>
        <div className="scroll-area min-h-0 flex-1 px-6 py-4 text-base text-ink-2">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, title, body, confirmLabel, cancelLabel = t("Không"), danger, onConfirm, onCancel, busy, children }: { open: boolean; title: string; body?: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; busy?: boolean; children?: ReactNode }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="leading-relaxed">{body}</div>}
      {children}
    </Dialog>
  );
}

export function Drawer({ open, onClose, title, label, children, footer, width = 440, floating, top }: { open: boolean; onClose: () => void; title: ReactNode; /** Accessible name when the title is not plain text. */ label?: string; children: ReactNode; footer?: ReactNode; width?: number; floating?: boolean; top?: boolean }) {
  const ref = useFocusTrap(open);
  const isTop = useLayer(open);
  useOverlayPresence(open, "side");
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop()) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [open, onClose, isTop]);
  if (!open) return null;
  return createPortal(
    <div className={cx("fixed inset-0 flex justify-end", top ? "z-[60]" : "z-40", floating && "bg-scrim/40")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : t("Chi tiết"))} className="glass-strong m-3 mt-[52px] flex flex-col rounded-lg" style={{ width }}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0 flex-1 text-md font-semibold text-ink">{title}</div>
          <IconButton label={t("Đóng")} size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scroll-area min-h-0 flex-1 px-5 py-3">{children}</div>
        {footer && <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  detail?: string;
}

export function Menu({ trigger, items, align = "start", label, width = 240 }: { trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; ref: React.Ref<HTMLButtonElement> }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; label: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(items.length * 40 + 16, 420);
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    const left = align === "end" ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left, up });
  }, [open, items.length, align, width]);
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        const n = els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length];
        n?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu", ref: btn })}
      {open &&
        createPortal(
          <div ref={menu} role="menu" aria-label={label} className="glass-strong scroll-area fixed z-[60] max-h-[420px] rounded-md p-1.5" style={{ top: pos.top, left: pos.left, width }}>
            {items.map((it, i) =>
              it.separator ? (
                <div key={i} className="my-1 h-px bg-line" role="separator" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role={it.checked !== undefined ? "menuitemradio" : "menuitem"}
                  aria-checked={it.checked}
                  aria-disabled={it.disabled || undefined}
                  title={it.hint}
                  onClick={() => {
                    if (it.disabled) return;
                    setOpen(false);
                    it.onSelect?.();
                  }}
                  className={cx(
                    "flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-base transition-colors focus:bg-ink/5 focus:outline-none",
                    it.disabled ? "cursor-not-allowed text-ink-3" : it.danger ? "text-danger-ink hover:bg-danger-soft" : "text-ink hover:bg-ink/5",
                  )}
                >
                  {it.icon && <span className="flex size-4 shrink-0 items-center justify-center">{it.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {(it.detail || (it.disabled && it.hint)) && <span className="block truncate text-xs text-ink-2">{it.detail ?? it.hint}</span>}
                  </span>
                  {it.checked && <span className="size-2 rounded-full bg-accent" aria-hidden />}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
