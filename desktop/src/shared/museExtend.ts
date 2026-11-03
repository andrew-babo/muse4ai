import type { ExecMode } from "./execution";
import { anyPathSupports, jobNeeds } from "./pathCapability";
import type { Account, Asset, ChainPlan, ExtendInfo } from "./types";
import { nextChainStep, validateExtend, type ChainDecision } from "./vibes";

/** Spec rev7 R55/R58: these are app guardrails, not provider quotas. */
export const MUSE_EXTEND_MAX_STEPS = 6;
/** R55: a Muse continuation defaults to one step. */
export const MUSE_EXTEND_DEFAULT_STEPS = 1;
export const MUSE_EXTEND_TIMEOUT_MS = 600_000;
export const MUSE_EXTEND_TEMPLATE_VERSION = "muse-extend-v1";

export function validateMuseExtend(input: { mode: "auto" | "directive"; directive?: string | null; plan: ChainPlan }, maxSteps: number, sourceMs: number | null): string | null {
  const error = validateExtend(input, Math.min(MUSE_EXTEND_MAX_STEPS, Math.max(1, maxSteps)));
  if (error) return error;
  if (input.plan.type === "target") {
    if (input.plan.value > 60) return "Đến khoảng trên Muse tối đa 60 giây";
    if (sourceMs === null || input.plan.value * 1_000 <= sourceMs) return "Mục tiêu phải dài hơn video nguồn";
  }
  return null;
}

export function museWaitReason(owner: Pick<Account, "alias" | "state">): string | null {
  if (owner.state === "ready" || owner.state === "busy") return null;
  return `${owner.alias}: ${owner.state === "needs_login" || owner.state === "new" || owner.state === "logging_in" ? "cần đăng nhập lại Muse" : owner.state === "checkpoint" ? "cần xác minh Muse" : owner.state === "limit_reached" ? "hết hạn mức Muse" : owner.state === "proxy_error" ? "proxy đang lỗi" : owner.state === "takeover" ? "anh đang điều khiển" : "đang tạm nghỉ"}`;
}

/**
 * Each extend step runs on the path that made its source (pathCapability extendSource): the reason it cannot, or null.
 * `httpOn` = this build has the direct channel and it is switched on; without it every account works as UI.
 */
export function museExtendPathReason(via: "http" | "ui", ownerMode: ExecMode, httpOn: boolean): string | null {
  const needs = jobNeeds({ kind: "video", mode: "text", operation: "extend", extendSource: via });
  void ownerMode; // the source fixes the path; the account mode never blocks an extend (choosePath isSourcePinned)
  if (anyPathSupports(needs, ["auto"], httpOn)) return null;
  return "Video này tạo qua đường HTTP nhưng kênh trực tiếp đang tắt trong Cài đặt — bật lại để kéo dài";
}

/** `paths` (renderer, API views) adds the path rule above so the button says why before anything is queued. */
export function museExtendEligibility(
  asset: Pick<Asset, "kind" | "site" | "sourceStatus" | "trashedAt" | "missing"> & { sourceVia?: "http" | "ui" | null },
  owner: (Pick<Account, "alias" | "state"> & { execMode?: ExecMode }) | null,
  verified: boolean,
  paths?: { httpOn: boolean },
): ExtendInfo | null {
  if (asset.kind !== "video") return null;
  const blocked = (reason: string): ExtendInfo => ({ ok: false, reason, waitNote: null });
  if (asset.trashedAt) return blocked("Video này đang trong Thùng rác");
  if (asset.missing) return blocked("Không tìm thấy video nguồn");
  if (asset.site !== "muse" || !asset.sourceStatus) return blocked("Video này chưa có nguồn hội thoại Muse — video tạo trước bản này hoặc một lượt Muse trả nhiều video; tạo video mới để kéo dài");
  if (asset.sourceStatus === "owner_removed" || !owner) return blocked("Tài khoản tạo video này đã bị xoá");
  if (asset.sourceStatus === "identity_changed") return blocked("Phiên Muse đã đổi tài khoản");
  if (!verified) return blocked("Kéo dài chưa được kiểm trên phiên bản này");
  if (paths && asset.sourceVia && owner.execMode) {
    const why = museExtendPathReason(asset.sourceVia, paths.httpOn ? owner.execMode : "ui", paths.httpOn);
    if (why) return blocked(why);
  }
  const reason = museWaitReason(owner);
  return { ok: true, reason: null, waitNote: reason ? `${reason} — chuỗi sẽ chờ` : null };
}

export function nextMuseChainStep(input: Parameters<typeof nextChainStep>[0]): ChainDecision {
  if (input.sourceMs === null || input.outputMs === null || input.outputMs - input.sourceMs < 1_000) return { action: "stop", reason: "Muse không kéo dài thêm" };
  return nextChainStep(input);
}

/**
 * The durable locator of an MP4 in the account's Muse workspace, from a direct-channel file path (`/workspace/…mp4`,
 * events.ts workspacePath) — the same `sandbox://workspace/…` form the page reads from message-bound metadata. Null for
 * anything else (other folders, traversal, encoded or control characters), so a guessed path never becomes a source.
 */
export function museSandboxLocator(workspacePath: string): string | null {
  const p = String(workspacePath ?? "");
  if (!/^\/workspace\/[^\u0000-\u001f?#\\%]+\.mp4$/i.test(p)) return null;
  if (p.slice(1).split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return `sandbox:/${p}`;
}

/** Main-only callers pass a validated locator. This renders text, never executes a command. */
export function buildMuseExtendMessage(source: string, mode: "auto" | "directive", directive?: string | null): string {
  const description = mode === "directive" ? String(directive ?? "").trim() : "";
  return `Extend the exact video ${JSON.stringify(source)} above by about 10 seconds. Use your available workspace tools (ffmpeg if available) to extract its actual last frame. Use that frame as the first frame of the continuation. Preserve the subject, scene, camera angle, motion and audio; no scene cut. Keep the entire original video unchanged, concatenate the continuation in your workspace and return one cumulative MP4, not only the new segment.${description ? ` Next scene instruction: ${description}` : ""}`;
}

export interface MuseTurnSnapshot {
  conversation: string;
  users: { id: string; text: string }[];
  agents: { id: string; outputs: string[] }[];
}

export interface MuseCheckpoint {
  conversation: string;
  sourceTurn: string;
  sourceOutput: string;
  baselineUsers: string[];
  baselineAgents: string[];
  /** Every validated file locator already in the conversation before the send (a quoted old video is never “new”). */
  baselineOutputs?: string[];
  message: string;
  templateVersion: string;
  acceptedUser: string | null;
}

/** Whitespace-insensitive; drops a leading speaker label (Muse's screen-reader “You:”, VPS 28/10/2026) if one slips in. */
const norm = (s: string) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:You|Bạn|你|您)\s*[:：]\s*/i, "");

/** Existing conversation URL alone never acknowledges a continuation. */
export function findMuseAcceptedTurn(checkpoint: MuseCheckpoint, snapshot: MuseTurnSnapshot): string | null {
  if (snapshot.conversation !== checkpoint.conversation) return null;
  const want = norm(checkpoint.message);
  const candidates = snapshot.users.filter((u) => !!u.id && !checkpoint.baselineUsers.includes(u.id) && norm(u.text) === want);
  return candidates.length === 1 ? candidates[0].id : null;
}

// ------------------------------------------------------------------ ordered attribution (R58, rev 7.1)
export interface MuseItemMedia {
  output: string;
  src: string;
  width: number;
  height: number;
}

/** One message of the conversation in document order (user, then the assistant messages of its reply group …). */
export interface MuseItem {
  role: "user" | "assistant" | "other";
  id: string | null;
  turn: string | null;
  text: string;
  media: MuseItemMedia[];
}

export interface MuseSnapshot {
  conversation: string;
  items: MuseItem[];
  stop: boolean;
}

export function toTurnSnapshot(s: MuseSnapshot): MuseTurnSnapshot {
  return {
    conversation: s.conversation,
    users: s.items.filter((i) => i.role === "user").map((i) => ({ id: i.id ?? "", text: i.text })),
    agents: s.items.filter((i) => i.role === "assistant").map((i) => ({ id: i.id ?? "", outputs: i.media.map((m) => m.output).filter(Boolean) })),
  };
}

export function snapshotOutputs(s: MuseSnapshot): string[] {
  return [...new Set(s.items.flatMap((i) => i.media.map((m) => m.output).filter(Boolean)))];
}

/**
 * A reopened thread shows the composer seconds before its history (empty list ≈ 5 s on the reference VPS,
 * 28/10/2026). Every conversation the app continues starts with a user message, so a read without one is still
 * loading — never evidence that the source or our message is gone.
 */
export function museHistoryShown(s: Pick<MuseSnapshot, "items">): boolean {
  return s.items.some((i) => i.role === "user" && !!i.id);
}

/** Identity of a read for “two identical reads” (ids, groups, file locators; playback URLs excluded — they change). */
export function museSnapshotKey(s: Pick<MuseSnapshot, "items" | "stop">): string {
  return JSON.stringify([s.stop, s.items.map((i) => [i.role, i.id, i.turn, i.media.map((m) => m.output)])]);
}

/** The source clip's playback element is mounted: the page has finished streaming the file (heavy work done). */
export function museSourcePlayable(s: Pick<MuseSnapshot, "items">, source: { turn: string; output: string }): boolean {
  return s.items.some((i) => i.role === "assistant" && i.id === source.turn && i.media.some((m) => m.output === source.output && !!m.src));
}

/**
 * Pre-send read of a reopened thread (pure). `ready` = history shown, two identical reads, no reply in progress,
 * source is the head and playable. `judge` = stop waiting and decide on this read (history shown and stable, but the
 * source is missing/not the head — or the deadline passed). `wait` = keep reading; nothing has been sent.
 */
export function museThreadReadiness(
  reads: { snapshot: MuseSnapshot; key: string }[],
  source: { conversation: string; turn: string; output: string },
  deadlinePassed: boolean,
): "ready" | "judge" | "wait" | "loading" {
  const last = reads[reads.length - 1];
  if (!last || !museHistoryShown(last.snapshot)) return deadlinePassed ? "loading" : "wait";
  const prev = reads[reads.length - 2];
  const stable = !!prev && prev.key === last.key;
  const tip = museSourceIsTip(last.snapshot, source);
  if (stable && !last.snapshot.stop && !tip && museSourcePlayable(last.snapshot, source)) return "ready";
  return deadlinePassed ? "judge" : "wait";
}

/**
 * The source video is the head of the branch: the newest video of the conversation. Messages after it may only be
 * text (its own reply group, or an earlier continuation that Muse answered without a file — a refusal or technical
 * failure leaves the head unchanged). Any later video, even one without validated metadata, means the conversation
 * moved on. A reply still in progress is handled by the caller. Missing ids fail closed.
 * `ui` = the page lacks the markers this check needs (a Muse UI change), otherwise the conversation itself moved on.
 */
export function museSourceIsTip(s: MuseSnapshot, source: { conversation: string; turn: string; output: string }): { reason: string; ui: boolean } | null {
  if (s.conversation !== source.conversation) return { reason: "Hội thoại Muse không khớp", ui: false };
  if (s.items.some((i) => (i.role === "user" || i.role === "assistant") && !i.id)) return { reason: "Muse chưa cung cấp dấu hội thoại bền vững", ui: true };
  const at = s.items.findIndex((i) => i.role === "assistant" && i.id === source.turn && i.media.some((m) => m.output === source.output));
  if (at < 0) return { reason: "Không còn thấy video nguồn trong hội thoại Muse", ui: false };
  if (!s.items[at].turn) return { reason: "Muse chưa cung cấp nhóm trả lời", ui: true };
  const after = s.items.slice(at + 1);
  if (after.some((i) => i.media.some((m) => m.output !== source.output))) return { reason: "Video nguồn không còn là đầu nhánh trong hội thoại Muse", ui: false };
  return null;
}

export type MuseAttribution =
  | { kind: "not_accepted" }
  | { kind: "ambiguous"; reason: string }
  | { kind: "waiting"; acceptedUser: string; answerText: string; answered: boolean }
  | { kind: "video"; acceptedUser: string; answerId: string; media: MuseItemMedia; answerText: string };

/**
 * Attribute the reply to exactly our continuation message (pure). Conservative: another new user message, a new
 * assistant message before ours, more than one reply group, or more than one new file → ambiguous (needs review).
 */
export function attributeMuseExtend(checkpoint: MuseCheckpoint, s: MuseSnapshot): MuseAttribution {
  if (s.conversation !== checkpoint.conversation) return { kind: "ambiguous", reason: "Hội thoại Muse đã thay đổi" };
  // R68: our message is the new user message with exactly our text (page extras such as the “You:” label and
  // Muse's 👍 reaction are removed by the page script), or — once accepted — the one still carrying the id we
  // recorded. Muse swaps the temporary id of a just-sent message for its stored id once (VPS 28/10/2026), so a
  // recorded id that is gone is re-found by exact text; the new id is then followed (returned as acceptedUser).
  const id = checkpoint.acceptedUser;
  const byId = !!id && !checkpoint.baselineUsers.includes(id) && s.items.some((i) => i.role === "user" && i.id === id);
  const accepted = byId ? id : findMuseAcceptedTurn(checkpoint, toTurnSnapshot(s));
  if (!accepted) return id ? { kind: "ambiguous", reason: "Không còn thấy lời nhắn kéo dài trên Muse" } : { kind: "not_accepted" };
  const at = s.items.findIndex((i) => i.role === "user" && i.id === accepted);
  const before = s.items.slice(0, at);
  const after = s.items.slice(at + 1);
  const isNew = (i: MuseItem) => !!i.id && !(i.role === "user" ? checkpoint.baselineUsers : checkpoint.baselineAgents).includes(i.id);
  if (s.items.some((i) => i.role === "user" && i.id !== accepted && isNew(i))) return { kind: "ambiguous", reason: "Hội thoại có lời nhắn khác — cần anh xem" };
  if (before.some((i) => i.role === "assistant" && isNew(i))) return { kind: "ambiguous", reason: "Hội thoại có câu trả lời ngoài lượt này — cần anh xem" };
  if (after.some((i) => i.role !== "assistant")) return { kind: "ambiguous", reason: "Hội thoại có nội dung lạ sau lời nhắn — cần anh xem" };
  if (after.some((i) => !isNew(i))) return { kind: "ambiguous", reason: "Câu trả lời cũ nằm sau lời nhắn mới — cần anh xem" };
  const groups = new Set(after.map((i) => i.turn ?? ""));
  if (groups.has("") && after.length) return { kind: "ambiguous", reason: "Muse chưa cung cấp nhóm trả lời" };
  if (groups.size > 1) return { kind: "ambiguous", reason: "Muse trả lời thành nhiều nhóm — cần anh xem" };
  const answerText = after.map((i) => i.text).filter(Boolean).join("\n").trim();
  const old = new Set([...(checkpoint.baselineOutputs ?? []), checkpoint.sourceOutput]);
  const fresh = new Map<string, { item: MuseItem; media: MuseItemMedia }>();
  for (const item of after) for (const m of item.media) if (m.output && !old.has(m.output) && !fresh.has(m.output)) fresh.set(m.output, { item, media: m });
  if (fresh.size > 1) return { kind: "ambiguous", reason: "Muse trả nhiều video — chưa xác định bản tích luỹ" };
  const only = [...fresh.values()][0];
  if (only && only.item.id && only.media.src && only.media.width > 0 && only.media.height > 0) {
    return { kind: "video", acceptedUser: accepted, answerId: only.item.id, media: only.media, answerText };
  }
  return { kind: "waiting", acceptedUser: accepted, answerText, answered: after.length > 0 };
}