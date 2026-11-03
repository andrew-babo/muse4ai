import { CircleHelp } from "lucide-react";
import { helpSlugFor } from "@shared/guideHelp";
import { t } from "@shared/i18n";
import { navigate, useRoute } from "../lib/router";
import { IconButton } from "./ui";

/** "?" next to a screen title: opens the Guide article for the screen the user is on (R3-APP.8, AC-APP-GUIDE-08). */
export function HelpButton({ className }: { className?: string }) {
  const r = useRoute();
  const slug = helpSlugFor(r.path);
  return (
    <IconButton label={t("Hướng dẫn cho màn này")} size="sm" className={className} onClick={() => navigate(`/guide/${slug}`)}>
      <CircleHelp className="size-[18px]" aria-hidden />
    </IconButton>
  );
}
