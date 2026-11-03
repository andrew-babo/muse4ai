import { useSyncExternalStore } from "react";
import type { JobKind, JobMode, Site } from "@shared/types";

// Composer draft lives outside the Studio component so cards, library and lightbox can prefill it.

export interface RefView {
  id: string;
  url: string;
  name: string;
  width: number;
  height: number;
  mime?: string;
  durationMs?: number | null;
  /** Build 2.0 R82 — chat attachments may be documents (CSV/TXT/MD/JSON/PDF). */
  kind?: "image" | "video" | "document";
  bytes?: number;
  filename?: string | null;
}

/** R85 — the conversation a chat continues (an app handle; the account is the one that owns it). */
export interface DraftConversation {
  id: string;
  accountId: string;
  alias: string | null;
}

export interface Draft {
  prompt: string;
  kind: JobKind;
  mode: JobMode;
  referenceMedia?: "image" | "video";
  /** R10 — 0–REF_MAX_PER_JOB reference images, in the order they were added. */
  references: RefView[];
  repeat: number;
  accountPref: string;
  /** rev 6 — Nơi tạo (only for video). */
  site: Site;
  /** Build 2.0 — Hỏi đáp: attachments (kept apart from image/video references) and the conversation to continue. */
  chatFiles: RefView[];
  conversation: DraftConversation | null;
  focusTick: number;
}

let draft: Draft = { prompt: "", kind: "image", mode: "text", references: [], repeat: 1, accountPref: "auto", site: "muse", chatFiles: [], conversation: null, focusTick: 0 };
const subs = new Set<() => void>();

export function getDraft(): Draft {
  return draft;
}
export function setDraft(patch: Partial<Draft>): void {
  draft = { ...draft, ...patch };
  if (draft.kind !== "chat") draft.conversation = null; // a conversation belongs to Hỏi đáp only
  if (draft.kind !== "video" || draft.site !== "muse") {
    draft.references = draft.references.filter((r) => !r.mime?.startsWith("video/"));
    draft.referenceMedia = "image";
  }
  for (const s of subs) s();
}
export function focusComposer(): void {
  setDraft({ focusTick: draft.focusTick + 1 });
}
export function useDraft(): Draft {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => draft,
  );
}
