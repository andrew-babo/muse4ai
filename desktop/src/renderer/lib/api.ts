import { t } from "@shared/i18n";
import { pushToast } from "./store";

// Typed door to the main process. Errors surface as a toast unless the caller handles them.

export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

const bridge = (): MuseBridge | null => (typeof window !== "undefined" && window.muse ? window.muse : null);

export async function call<T = unknown>(command: string, input: Record<string, unknown> = {}, opts: { quiet?: boolean } = {}): Promise<T> {
  const b = bridge();
  if (!b) throw new ApiError(t("Không có kết nối tới bộ máy"), "no_bridge");
  const r = await b.invoke(command, input);
  if (!r.ok) {
    // Main writes errors in Vietnamese; they are shown in the UI language (R121).
    const message = t(r.error);
    if (!opts.quiet) pushToast({ tone: "danger", title: message });
    throw new ApiError(message, r.code);
  }
  return r.data as T;
}

/** Fire-and-report: shows the error toast, swallows the rejection (for button handlers). */
export function act<T = unknown>(command: string, input: Record<string, unknown> = {}, success?: string): Promise<T | undefined> {
  return call<T>(command, input).then(
    (d) => {
      if (success) pushToast({ tone: "ok", title: success }, 3500);
      return d;
    },
    () => undefined,
  );
}

export const hasBridge = () => !!bridge();
