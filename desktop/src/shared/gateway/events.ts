import type { RawEvent } from "./client";

// Normalised views of Muse gateway data (Build 2.0 R83, R93, R94). Pure: used by the page bundle to shrink what it
// hands to the main process, and by tests. Field names Muse uses live here and in the adapter protocol module only.

export interface GwFile {
  path: string;
  mime: string | null;
  byteLen: number | null;
  name: string | null;
}

export interface GwEvent {
  sess: string | null;
  seq: number | null;
  /** status = task.status; files = presentation with files; user = message.user; done = message_done; error = error frame. */
  kind: "status" | "files" | "user" | "done" | "error" | "other";
  status?: string;
  files?: GwFile[];
  error?: { code: string | null; message: string | null };
  at: number;
}

const MEDIA_KEYS = ["images", "videos", "files", "audio"] as const;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max = 2_000): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Workspace path of a Muse file reference (`sandbox://…`, `/fs/raw/…`, `/media/raw/…` → `/workspace/…`). */
export function workspacePath(p: string): string {
  let x = String(p ?? "").split("sandbox://").pop() ?? "";
  const m = /\/(?:media|fs)\/raw\/(.+)$/.exec(x);
  if (m) x = m[1];
  x = x.split("?")[0];
  return x.startsWith("/") ? x : `/${x}`;
}

function fileOf(v: Record<string, unknown>): GwFile | null {
  const p = s(v.path, 4_000);
  if (!p) return null;
  if (!(p.includes("/workspace") || p.startsWith("sandbox://") || p.includes("/raw/"))) return null;
  return { path: workspacePath(p), mime: s(v.mime ?? v.mime_type, 200), byteLen: n(v.byte_len ?? v.byteLen ?? v.size), name: s(v.name ?? v.filename ?? v.file_name, 400) };
}

/** Every file reference inside a value (depth-limited), in document order, without duplicates. */
export function findFiles(v: unknown, out: GwFile[] = [], seen = new Set<string>(), depth = 0): GwFile[] {
  if (depth > 10 || v === null || v === undefined) return out;
  if (Array.isArray(v)) {
    for (const x of v) findFiles(x, out, seen, depth + 1);
    return out;
  }
  if (!isObj(v)) return out;
  const f = fileOf(v);
  if (f && !seen.has(f.path)) {
    seen.add(f.path);
    out.push(f);
  }
  for (const x of Object.values(v)) if (x && typeof x === "object") findFiles(x, out, seen, depth + 1);
  return out;
}

export function normaliseEvent(e: RawEvent): GwEvent {
  const r = e.rec;
  const p = isObj(r.payload) ? r.payload : {};
  const sess = s(p.session_id ?? r.session_id, 100);
  const seq = n(r.seq);
  const ev = s(r.event ?? r.type, 100) ?? "";
  const base = { sess, seq, at: e.at };
  if (ev === "task.status") return { ...base, kind: "status", status: s(p.status, 50) ?? "" };
  if (ev === "message.user") return { ...base, kind: "user" };
  if (ev === "delta.message_done") return { ...base, kind: "done" };
  if (ev === "delta.presentation") {
    const files: GwFile[] = [];
    const data = isObj(p.data) ? p.data : {};
    for (const k of MEDIA_KEYS) {
      const list = data[k];
      if (Array.isArray(list)) for (const m of list) if (isObj(m)) {
        const f = fileOf(m);
        if (f && !files.some((x) => x.path === f.path)) files.push(f);
      }
    }
    return { ...base, kind: "files", files };
  }
  if (ev === "error" || r.error) {
    const err = isObj(r.error) ? r.error : isObj(p.error) ? p.error : {};
    return { ...base, kind: "error", error: { code: s(err.code ?? err.type, 100), message: s(err.message ?? err.msg ?? r.error, 300) } };
  }
  return { ...base, kind: "other" };
}

/** Ack of `/chat/stream` (its final record): the session Muse used and whether it made a new thread. */
export interface GwAck {
  sessionId: string | null;
  isThread: boolean | null;
  ok: boolean | null;
  error: { code: string | null; message: string | null } | null;
}

export function normaliseAck(last: Record<string, unknown> | null): GwAck | null {
  if (!last) return null;
  const err = last.error;
  return {
    sessionId: s(last.session_id, 100),
    isThread: typeof last.is_thread === "boolean" ? last.is_thread : null,
    ok: typeof last.ok === "boolean" ? last.ok : null,
    error: err ? (isObj(err) ? { code: s(err.code ?? err.type, 100), message: s(err.message, 300) } : { code: null, message: s(err, 300) }) : null,
  };
}

export const TEXT_MAX_FROM_PAGE = 8 * 1024 * 1024;

/** One user turn of a conversation and what followed it until the next user message. */
export interface GwTurn {
  /** `text` is Muse's copy as stored; `prompt` is it without the leading attachment marker lines (stripAttachmentMarkers). */
  user: { text: string; prompt: string; atMs: number | null };
  /**
   * The answer: Muse's non-commentary assistant messages in order. `ready` = Muse's display_text_ready (true even while
   * the text still streams); `final` = the newest answer message carries a terminal status (live 01/11). Commentary
   * preambles ("I'll write…") never count as the answer while an answer message exists, and never finish a turn.
   */
  assistant: { text: string; ready: boolean; final: boolean; updatedAtMs: number | null } | null;
  /** Latest task status seen in the turn (if history carries one). */
  status: string | null;
  files: GwFile[];
}

export interface GwHistory {
  turns: GwTurn[];
  /** Number of user messages in the conversation. */
  userMsgs: number;
  /** A text-carrying event the app did not expect (version drift signal). */
  unknownShape: boolean;
}

const RUNNING = new Set(["running", "in_progress", "queued", "pending", "started", "working"]);
export const TERMINAL_STATUS = new Set(["completed", "failed", "cancelled", "canceled", "error"]);

const ATTACHMENT_MARKER = /^\[[a-z][a-z_-]{0,20}:[^\]\n]{1,1000}\]$/;

/**
 * Muse stores a user message with attachments as one marker line per attachment before the text, e.g.
 * `[image:image/png workspace/user/media_library/image/x.png]` or `[file:text/csv workspace/user/files/a.csv]` (live
 * 01/11). Returns the text after those leading lines; text without markers is returned unchanged.
 */
export function stripAttachmentMarkers(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length - 1 && ATTACHMENT_MARKER.test(lines[i])) i++;
  return i ? lines.slice(i).join("\n") : text;
}

/** `/chat/history` → turns. Returns null when the shape is not the one the app knows (R89(c)). */
export function normaliseHistory(data: unknown): GwHistory | null {
  if (!isObj(data)) return null;
  const result = isObj(data.result) ? data.result : null;
  const events = result && Array.isArray(result.chat_events) ? result.chat_events : null;
  if (!events) return null;
  const turns: GwTurn[] = [];
  let cur: GwTurn | null = null;
  let unknownShape = false;
  const commentary = new Map<GwTurn, string>();
  const answered = new Set<GwTurn>();
  for (const raw of events) {
    if (!isObj(raw)) continue;
    const name = s(raw.event_name ?? raw.event, 100) ?? "";
    if (name === "message.user") {
      const text = s(raw.display_text, 40_000) ?? "";
      cur = { user: { text, prompt: stripAttachmentMarkers(text), atMs: n(raw.created_at_ms ?? raw.display_text_updated_at_ms) }, assistant: null, status: null, files: [] };
      turns.push(cur);
      continue;
    }
    if (!cur) continue;
    if (name === "message.assistant") {
      const text = typeof raw.display_text === "string" ? raw.display_text.slice(0, TEXT_MAX_FROM_PAGE) : "";
      const updated = n(raw.display_text_updated_at_ms);
      const ready = raw.display_text_ready === true;
      const payload = isObj(raw.payload) ? raw.payload : {};
      const meta = isObj(payload.metadata) ? payload.metadata : isObj(raw.metadata) ? raw.metadata : {};
      const status = s(payload.status ?? raw.status, 50);
      const newest = Math.max(cur.assistant?.updatedAtMs ?? 0, updated ?? 0) || null;
      if (s(meta.message_kind, 50) === "commentary") {
        // A preamble ("I'll write it and count the words…"): shown only when the turn has no answer message.
        const c = commentary.get(cur) ?? "";
        commentary.set(cur, text ? (c ? `${c}\n\n${text}` : text) : c);
        cur.assistant = answered.has(cur) ? { ...cur.assistant!, updatedAtMs: newest } : { text: commentary.get(cur)!, ready: false, final: false, updatedAtMs: newest };
      } else {
        // Answer messages in order; the newest one decides readiness. Muse marks display text ready while it still
        // streams, so only a terminal message status makes it final (live 01/11).
        const prev = answered.has(cur) ? cur.assistant!.text : "";
        answered.add(cur);
        cur.assistant = { text: text ? (prev ? `${prev}\n\n${text}` : text) : prev, ready, final: ready && !!status && TERMINAL_STATUS.has(status), updatedAtMs: newest };
      }
    } else if (name === "task.status") {
      const st = s((isObj(raw.payload) ? raw.payload.status : raw.status) ?? null, 50);
      if (st) cur.status = st;
    } else if (!name && typeof raw.display_text === "string") unknownShape = true;
    findFiles(raw, cur.files, new Set(cur.files.map((f) => f.path)));
  }
  return { turns, userMsgs: turns.length, unknownShape };
}

/** One conversation's state in `/api/session/list` (live 01/11: "running" while Muse works, "completed" after). */
export interface GwSessionState {
  status: string | null;
  /** Seconds precision at Muse (…000). */
  updatedAtMs: number | null;
}

/** `/api/session/list` → id + state only (titles and snippets never leave the page). Null for an unknown shape. */
export function normaliseSessionList(data: unknown): ({ id: string } & GwSessionState)[] | null {
  if (!isObj(data)) return null;
  const result = isObj(data.result) ? data.result : null;
  const list = result && Array.isArray(result.sessions) ? result.sessions : null;
  if (!list) return null;
  const out: ({ id: string } & GwSessionState)[] = [];
  for (const raw of list.slice(0, 200)) {
    if (!isObj(raw)) continue;
    const id = s(raw.session_id, 100);
    if (id) out.push({ id, status: s(raw.status, 50), updatedAtMs: n(raw.updated_at_ms) });
  }
  return out;
}

/**
 * R94 — a reply with no final answer message (live 01/11: Muse answered "make run.bat" with only a file widget; the
 * history then has no answer message and no task status, so the turn never "looks done"). Its conversation's state is
 * the done signal: terminal and updated at or after the user's message (Muse stores seconds). "completed" also needs
 * some output — a conversation that has not started our turn yet still shows the previous turn's "completed".
 */
export function sessionSaysDone(st: GwSessionState | null, t: GwTurn, files: number): boolean {
  if (!st || !st.status || !TERMINAL_STATUS.has(st.status) || st.updatedAtMs === null) return false;
  if (t.user.atMs !== null && st.updatedAtMs < Math.floor(t.user.atMs / 1000) * 1000) return false;
  if (st.status !== "completed") return true;
  return files > 0 || !!t.assistant?.text;
}

/** R94 — the turn looks finished in history: its newest answer message is ready with a terminal status (or the task status is terminal). */
export function turnLooksDone(t: GwTurn): boolean {
  if (t.status && RUNNING.has(t.status)) return false;
  if (t.status && TERMINAL_STATUS.has(t.status)) return true;
  return !!t.assistant && t.assistant.ready && t.assistant.final;
}
