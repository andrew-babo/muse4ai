import { useEffect, useRef, useState } from "react";

export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

export function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function useHotkey(handler: (e: KeyboardEvent) => void, deps: unknown[] = []): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Open focus traps, newest last: overlays stack (Kéo dài sheet over the lightbox) and only the top one owns Tab. */
const traps: HTMLElement[] = [];
const focusablesIn = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
const focusInto = (node: HTMLElement) => (node.querySelector<HTMLElement>("[data-autofocus]") ?? focusablesIn(node)[0])?.focus();

/** Keeps focus inside a dialog and restores it to the opener on close (screens §6). */
export function useFocusTrap(active: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;
    traps.push(node);
    focusInto(node);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const act = document.activeElement;
      const inside = !!act && node.contains(act);
      // Focus inside another overlay belongs to that overlay; lost focus (body/outside) goes back to the top one.
      if (!inside && traps[traps.length - 1] !== node) return;
      const f = focusablesIn(node);
      if (!f.length) return;
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? f[f.length - 1] : f[0]).focus();
        return;
      }
      // Natively focusable elements outside the list (a <video controls>) keep the browser's own Tab order.
      const i = f.indexOf(act as HTMLElement);
      if (i === -1) return;
      if (e.shiftKey && i === 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const k = traps.indexOf(node);
      if (k >= 0) traps.splice(k, 1);
      // Back to the opener; if it is gone (re-rendered), into the overlay underneath so the keyboard user stays put.
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
      else if (traps.length) focusInto(traps[traps.length - 1]);
    };
  }, [active]);
  return ref;
}
