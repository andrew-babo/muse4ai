import type { ExecMode, ExecPath } from "./execution";
import type { JobKind, JobMode, JobOperation, Site } from "./types";

// Build 2.0 §4.2 — what each execution path can run. A job runs only on a path that supports everything it needs.
// Cells marked “Chờ PoC” in the spec stay false here until Phase 0 evidence exists (rules B50); flipping one is a code
// change that names its evidence file next to the cell.

export type PathCapKey =
  | "chat.text"
  | "chat.files_out"
  | "chat.attach.doc"
  | "chat.attach.image"
  | "chat.attach.mp4"
  | "chat.continue"
  | "image.text"
  | "video.text"
  | "image.reference"
  | "video.reference"
  | "muse.extend"
  | "muse.extend.http"
  | "vibes";

export const PATH_CAPABILITIES: Record<ExecPath, Record<PathCapKey, boolean>> = {
  http: {
    "chat.text": true, // research.md §7.4: 20/20 text
    "chat.files_out": true, // §7.4: images 10/10, videos 5/5, CSV 2/2
    "chat.attach.doc": true, // §7.4 + phase-9/attachments: CSV inline ≤ 2 MiB and workspace upload answered exactly (cap below)
    "chat.attach.image": true, // phase-9/attachments: 3/3 images read exactly (2 accounts), 1.36 MiB inline read
    "chat.attach.mp4": true, // phase-9/attachments: MP4 inline (10 KB) and workspace upload (3.7 MB) read exactly
    "chat.continue": true, // §7.4: two-turn continuation
    "image.text": true, // §7.4: 10/10
    "video.text": true, // §7.4: 5/5
    "image.reference": true, // phase-9/attachments: image edit used the attached image (visual check)
    "video.reference": true, // phase-9/attachments: animate-from-image (frame 1 identical) and MP4 edit (same video, recoloured)
    "muse.extend": false, // a UI-made conversation is not addressable over the channel (only gw: sessions are)
    "muse.extend.http": true, // build-3.0/evidence/extend-http-poc-2026-11-03: HTTP video → extend message into the same gw: session → one cumulative MP4
    "vibes": false,
  },
  ui: {
    "chat.text": false, // Chờ PoC P0-10
    "chat.files_out": false, // Chờ PoC P0-10
    "chat.attach.doc": false, // Chờ PoC P0-10
    "chat.attach.image": false, // Chờ PoC P0-10 (chat on the UI path at all)
    "chat.attach.mp4": false,
    "chat.continue": false, // Chờ PoC P0-3
    "image.text": true,
    "video.text": true,
    "image.reference": true,
    "video.reference": true,
    "muse.extend": true,
    "muse.extend.http": false, // a page cannot open an HTTP conversation (CROSS_READ.ui, P0-3 not run)
    "vibes": true,
  },
};

/**
 * Largest attachment the HTTP path has been proven with (bytes, per file). Bigger files need the UI path. Documents and
 * videos up to 2 MiB go inline, bigger ones through the workspace upload (gateway/upload.ts; 20 MiB CSV proven, the
 * upload does not depend on the content type). Images always go inline like Muse's web app, so they stay within one
 * request (2.5 MiB inline proven). Live 01/11 evidence: docs/build-2.0/evidence/phase-9/attachments-2026-11-01.md.
 */
export const HTTP_ATTACH_PROVEN_BYTES = { document: 20 * 1024 * 1024, image: 2 * 1024 * 1024, video: 20 * 1024 * 1024 } as const;

/** Read-only result pickup across paths (R91): a UI page reading an HTTP conversation, HTTP reading a UI one. */
export const CROSS_READ: Record<ExecPath, boolean> = {
  /** HTTP history of a conversation the UI path created: same id space seen in the video L20 reconciliation (§7.4). */
  http: true,
  /** UI page opening /thread/{session} of an HTTP conversation: Chờ PoC P0-3. */
  ui: false,
};

export interface AttachmentNeed {
  kind: "image" | "video" | "document";
  bytes: number;
}

export interface JobNeedsInput {
  kind: JobKind;
  mode: JobMode;
  site?: Site;
  operation?: JobOperation;
  attachments?: AttachmentNeed[];
  /** A chat turn into an existing conversation. */
  continues?: boolean;
  /**
   * Extend steps run on the path that made their source video: a `gw:` (HTTP) conversation only on the channel, a
   * UI conversation only on a page, because neither path can address the other's conversation.
   */
  extendSource?: ExecPath;
}

export interface Need {
  cap: PathCapKey;
  attachment?: AttachmentNeed;
}

export function jobNeeds(j: JobNeedsInput): Need[] {
  if ((j.site ?? "muse") === "vibes") return [{ cap: "vibes" }];
  if ((j.operation ?? "generate") === "extend") return [{ cap: j.extendSource === "http" ? "muse.extend.http" : "muse.extend" }];
  const atts = j.attachments ?? [];
  if (j.kind === "chat") {
    const out: Need[] = [{ cap: "chat.text" }, { cap: "chat.files_out" }];
    if (j.continues) out.push({ cap: "chat.continue" });
    for (const a of atts) out.push({ cap: a.kind === "document" ? "chat.attach.doc" : a.kind === "image" ? "chat.attach.image" : "chat.attach.mp4", attachment: a });
    return out;
  }
  if (j.mode === "reference" || atts.length) {
    const cap: PathCapKey = j.kind === "video" ? "video.reference" : "image.reference";
    // Each reference carries its size, so the HTTP size cap applies to it (images go inline, videos may be uploaded).
    return atts.length ? atts.map((attachment) => ({ cap, attachment })) : [{ cap }];
  }
  return [{ cap: j.kind === "video" ? "video.text" : "image.text" }];
}

/** Does `path` support every need (and, on HTTP, every inline attachment size)? */
export function pathSupports(path: ExecPath, needs: Need[], caps: Record<ExecPath, Record<PathCapKey, boolean>> = PATH_CAPABILITIES): boolean {
  for (const n of needs) {
    if (!caps[path][n.cap]) return false;
    if (path === "http" && n.attachment && n.attachment.bytes > HTTP_ATTACH_PROVEN_BYTES[n.attachment.kind]) return false;
  }
  return true;
}

/** R87 — some path of some mode can run it at all (otherwise `capability_unavailable`). */
export function anyPathSupports(needs: Need[], modes: ExecMode[], httpEnabled: boolean, caps = PATH_CAPABILITIES): boolean {
  const http = httpEnabled && pathSupports("http", needs, caps);
  const ui = pathSupports("ui", needs, caps);
  return modes.some((m) => (m === "ui" ? ui : m === "http" ? http : http || ui));
}

export interface PathChoiceInput {
  mode: ExecMode;
  /** HTTP state allows new sends and the app-wide switch is on (R88, R97). */
  httpUsable: boolean;
  /** A UI slot is free for this account (account cap, UI cap, app UI pages, memory for an extra page). */
  uiSlotFree: boolean;
  needs: Need[];
  /** UI_CHANGED pauses this kind on the UI path only (§4.2). */
  uiDisabled?: boolean;
  caps?: Record<ExecPath, Record<PathCapKey, boolean>>;
}

/** Needs whose path is dictated by an existing conversation (extend steps), not by the account mode. */
export function isSourcePinned(needs: Need[]): boolean {
  return needs.some((n) => n.cap === "muse.extend" || n.cap === "muse.extend.http");
}

/** R88 — the path a new send of this job would take on this account now, or null (account not eligible for it). */
export function choosePath(p: PathChoiceInput): ExecPath | null {
  const caps = p.caps ?? PATH_CAPABILITIES;
  // An extend step's path is fixed by its source video (only that path can address the conversation), so the account's
  // HTTP/UI preference does not apply: an agent never has to switch modes to extend its own video.
  const mode: ExecMode = isSourcePinned(p.needs) ? "auto" : p.mode;
  const httpOk = mode !== "ui" && p.httpUsable && pathSupports("http", p.needs, caps);
  if (httpOk) return "http";
  const uiOk = mode !== "http" && !p.uiDisabled && p.uiSlotFree && pathSupports("ui", p.needs, caps);
  return uiOk ? "ui" : null;
}
