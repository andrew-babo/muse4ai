import { Bot } from "lucide-react";
import { useUi } from "../lib/store";
import { t } from "@shared/i18n";

/** “API · {tên khoá}” for jobs created through the agent API (screens §10). Renders nothing for Studio jobs. */
export function apiSourceLabel(keys: { id: string; name: string; revokedAt: number | null }[] | undefined, apiKeyId: string | null | undefined): string | null {
  if (!apiKeyId) return null;
  const k = keys?.find((x) => x.id === apiKeyId);
  if (!k) return "API";
  return `API · ${k.name}${k.revokedAt ? t(" (đã thu hồi)") : ""}`;
}

export function ApiSourcePill({ apiKeyId }: { apiKeyId: string | null | undefined }) {
  const keys = useUi((s) => s.snap?.api?.keys);
  const label = apiSourceLabel(keys, apiKeyId);
  if (!label) return null;
  return (
    <span className="inline-flex max-w-[200px] shrink-0 items-center gap-1 truncate rounded-full border border-line bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-2" title={label}>
      <Bot className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
