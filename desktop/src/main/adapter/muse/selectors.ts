import type { JobKind, JobMode } from "../../../shared/types";
export { buildMuseExtendMessage, MUSE_EXTEND_TEMPLATE_VERSION } from "../../../shared/museExtend";

// The ONLY place that knows Muse's web URLs, selectors, texts and prompt templates (AGENTS.md).
// Verified against muse.ai on 26/10/2026 (docs/build-1.0/evidence/phase-0-1.md).
//
// Selector sets, text patterns and the in-page scripts below are ported from muse2api
// (MIT — "Copyright (c) 2026 MUSE2API Authors", engine.py; and "Copyright (c) 2026 www222fff",
// drivers/browser). Full notices: desktop/LICENSES/muse2api.txt.

export const MUSE = {
  origin: "https://muse.ai",
  home: "https://muse.ai/",
  newThread: "https://muse.ai/thread/new",
  sessionApi: "/api/session",
  identityApi: "/api/auth/check",
  wakeApi: "/api/hatch/vm/wake",
  ipCheck: "https://ipinfo.io/json",
} as const;

export const THREAD_PATH_RE = /^\/thread\/([0-9a-f][0-9a-f-]{7,})$/i;

export const SEL = {
  textarea: "textarea",
  hydration: "[data-hatch-shell-hydration-state]",
  composerOverlay: '[data-testid="hatch-composer-placeholder-overlay"]',
  fileInput: 'input[type="file"]',
  stop: '[data-testid="hatch-composer-stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"]',
  attachment: '[data-testid^="hatch-chat-attachment-presentation-"]',
  agentMedia: 'div[class*="hatch-agent-bubble-bg"] img, div[class*="hatch-agent-bubble-bg"] video',
  agentBubble: 'div[class*="hatch-agent-bubble-bg"]',
  userBubble: '[class*=chat-user-bubble], [class*="group/msg"]',
  userBubbleExclude: 'form, [class*=chat-user-bubble], [class*="group/msg"]',
  settingsDock: '[data-testid="hatch-dock-more"]',
  menuItem: "[role=menuitem]",
  dialog: "[role=dialog],[aria-modal=true]",
  chatSwitcher: '[data-testid="hatch-chat-switcher-trigger"]',
  threadLink: 'a[href^="/thread/"]',
  loginInput: 'input[aria-label="Mobile number or email"]',
  uploadMark: "data-muse4ai-upload",
} as const;

export const TEXT = {
  login: /log in or create an account|\blog in\b|\bsign in\b|create an account|use another account|登录|登入/i,
  connecting: "Connecting...",
  quota: /out of credits|usage limit|limit reached|token limit|weekly limit (?:reached|hit)|you've reached your|额度不足|积分不足|达到上限/i,
  deliveryFailed: /Still sending|Delivery not confirmed|正在发送|未确认送达/i,
  removeAttachment: /remove\s*attachment|移除附件|删除附件/i,
  send: /发送|send/i,
  /** Agent text that reports a produced media file — never treat as a text-only refusal. */
  mediaReport: /\.(?:webp|png|jpe?g|mp4|webm)\b|imagine_media|deliverable|generated\s+.*image|verified\s+generated|artifact/i,
  /** Follow-up offers Muse appends under a finished result (seen 27/10/2026: “Want me to animate this one next?”,
   *  “Want me to bring it to life next? Turn this into a short video”) — a result exists, never a refusal. */
  mediaOffer: /want me to (?:animate|bring (?:it|this) to life|turn (?:it|this) into)|\banimate (?:it|this)\b|turn (?:it|this) into a (?:short )?video/i,
  /**
   * Muse's own reply says a tool/service failed. Seen 27/10/2026: “video service returned upstream 502 … INTERNAL”,
   * “the video service is overloaded”, “I hit an unexpected (internal) error … didn't get a finished clip back”.
   * A technical failure, not a content refusal — the user may try again later (spec rev 7.1 R64).
   */
  providerError:
    /\bupstream\b|\bINTERNAL\b|bad gateway|gateway time-?out|service (?:is |was )?(?:temporarily |currently )?(?:unavailable|down|overloaded)|\boverloaded\b|temporarily unavailable|internal (?:server )?error|\bserver error\b|technical (?:issue|error|problem|difficult)|unexpected (?:error|issue|problem|glitch)|(?:hit|ran into|encountered) (?:an? )?(?:unexpected |internal |technical )?(?:error|glitch|issue|problem)|something went wrong|didn(?:'|’)?t (?:generate|render|finish rendering)|(?:didn(?:'|’)?t|did not) get (?:a |the )?finished (?:clip|video|image|file)|(?:generation|render(?:ing)?) (?:failed|errored|timed out)|(?:error|status|http|code|returned|got)\D{0,20}\b5\d\d\b|\b5\d\d\b\D{0,12}(?:error|bad gateway|service|upstream|internal)|(?:video|image|media|generation|generator) (?:service|tool|backend|api) (?:failed|errored|returned an error|is down|timed out)|服务(?:暂时)?不可用|内部错误|服務(?:暫時)?無法使用|(?:tạo|dựng|xuất) (?:ảnh|hình|video|clip)[^.!?\n]{0,40}(?:không thành công|thất bại|bị lỗi|gặp lỗi)|không (?:tạo|dựng|xuất) được (?:ảnh|hình|video|clip)|lỗi kỹ thuật|sự cố kỹ thuật|máy chủ (?:đang )?(?:quá tải|bận|lỗi)/i,
  /** Words that only a content/policy refusal uses — they win over technical words in the same reply. */
  policyRefusal: /\bpolic(?:y|ies)\b|guideline|\bviolat|inappropriate|harmful|sexually|explicit content|against (?:the|our|meta)|not (?:able|allowed|permitted) to (?:create|generate|make|depict)|can(?:'|’)?t (?:create|generate|make|depict) (?:that|this|images? of|videos? of|content)|违反|不当内容|政策/i,
  settingsLabels: ["Settings", "設定", "设置"],
  usageHeaders: ["usage", "用量", "使用量"],
  languageHeaders: ["language", "语言", "語言"],
  quotaPlan: /^.{1,60}?(?:\s+plan|計劃|计划|方案)$/i,
  quotaReset: /Weekly limit resets? on ([^\n·•|]+)/i,
  quotaResetZh: /(?:每(?:週|周|星期)|週|周)(?:上限|限額|限额|額度|额度)(?:會|会|將|将)?(?:於|于|在)\s*([^\n]+?)\s*(?:重設|重置)/,
  quotaExtra: /^(?:(?:Additional|Extra)\s+tokens|(?:額外|额外)(?:的)?(?:符元|符記|代幣|代币|令牌|憑證|凭证|tokens))/i,
  quotaPercent: /(\d+(?:\.\d+)?)\s*%\s*(?:used\b|已(?:使)?用)/i,
  quotaPercentZh: /已(?:使)?用\s*(\d+(?:\.\d+)?)\s*%/,
  /** Additional tokens (seen 28/10/2026: “0% used (5B tokens left)”, “Never expires”) — spec rev 8 R69. */
  quotaTokensLeft: /(\d[\d.,]*\s*[KMBT]?\s+tokens?\s+left)/i,
  quotaExpiry: /(never\s+expires?|expires?\s+on\s+[^\n·•|()]+|永不(?:過|过)期|(?:於|于)\s*[^\n]+?(?:到期|過期|过期))/i,
  /** Lines after the additional part that are buttons/links, not data. */
  quotaStop: /^(?:upgrade|manage subscription|buy (?:more|additional) tokens?|升級|升级|購買|购买)\b/i,
} as const;

export type MuseReplyClass = "quota" | "refused" | "provider_error" | "media_pending" | "unknown";

/**
 * What a finished Muse reply WITHOUT the requested file means (pure; R6/R64). Order matters: quota first, then
 * policy words (a refusal that mentions an error is still a refusal), then technical failure, then “a file is coming”.
 */
export function classifyMuseReply(text: string): MuseReplyClass {
  const t = String(text ?? "");
  if (TEXT.quota.test(t)) return "quota";
  if (TEXT.policyRefusal.test(t)) return "refused";
  if (TEXT.providerError.test(t)) return "provider_error";
  if (TEXT.mediaReport.test(t) || TEXT.mediaOffer.test(t)) return "media_pending";
  return "unknown";
}

/** Muse picks the mode from the message itself (no mode buttons). */
export function buildMessage(kind: JobKind, mode: JobMode, prompt: string, referenceMedia?: "image" | "video"): string {
  if (kind === "video" && mode === "reference" && referenceMedia === "video") return `Edit the attached video according to this request and return the edited MP4 video, not a still image. Use the uploaded video as the source, not a newly imagined scene: ${prompt}`;
  if (kind === "image" && mode === "text") return `Generate an image: ${prompt}`;
  if (kind === "image" && mode === "reference") return `Edit the attached image: ${prompt}`;
  if (kind === "video" && mode === "text") return `Generate a short video: ${prompt}`;
  return `Animate the attached image into a short video, using it as the first frame: ${prompt}`;
}

export const CHROME_UA = (chromeVersion: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion.split(".")[0]}.0.0.0 Safari/537.36`;

export const VIDEO_EXT_RE = /\.(?:mp4|webm|mov)(?:$|[?#])/i;

export const TIMEOUTS = {
  pageLoad: 45_000,
  ready: 45_000,
  upload: 15_000,
  videoUpload: 120_000,
  sendButton: 6_000,
  accept: 25_000,
  sessionFetch: 12_000,
  wakeFetch: 10_000,
  wakePoll: 20_000,
  evalDefault: 20_000,
  download: 180_000,
  downloadTries: 4,
  quotaClick: 8_000,
  quotaRead: 12_000,
  /** Second look at the Usage panel after the first successful read (R69). */
  quotaSettle: 600,
  /** Muse may show "Still sending" briefly; only judge delivery after this long without an agent reply. */
  deliveryJudge: 30_000,
  /** Video turns (uploaded MP4 + images): Muse can show "Still sending" for minutes while it ingests the files, then deliver. */
  deliveryJudgeVideo: 240_000,
  stablePolls: 2,
  /** Extra polls to accept media while the stop button is still shown (agent still writing its reply). */
  stopGracePolls: 4,
  refusalPolls: 8,
  /** After the agent goes quiet without media: how long to keep waiting for a late attachment. */
  refusalGrace: { image: 8_000, video: 90_000 } as Record<JobKind, number>,
  pollMs: 2_000,
  /**
   * Before a continuation: how long a reopened thread may take to show its history and finish streaming the
   * source video (history ≈ 5 s after the composer, playback ≈ 50 s for 13 MB through a proxy — VPS 28/10/2026).
   */
  threadSettle: 150_000,
  /** Consecutive ambiguous reads before a continuation goes to review (a reload can show a partial list). */
  ambiguousPolls: 3,
} as const;

// ------------------------------------------------------------------ in-page scripts (strings)

/** Scroll the inner chat scroller to the bottom — Muse virtualises the list (muse2api `_scroll_bottom`). */
export const SCROLL_BOTTOM_JS = `(() => {
  const els = Array.from(document.querySelectorAll("*")).filter((e) => { const s = getComputedStyle(e); return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 100; });
  els.sort((a, b) => b.scrollHeight - a.scrollHeight);
  if (els[0]) els[0].scrollTop = els[0].scrollHeight;
  const s = document.scrollingElement || document.body; if (s) s.scrollTop = s.scrollHeight;
  return 1;
})()`;

/** Result media in agent bubbles, de-duplicated (muse2api `_ATT_JS`). Video src only from a real <video>. */
export const ATTACHMENTS_FN = `(sel) => {
  const list = []; const seen = new Set();
  const add = (el, tid) => {
    if (!el || seen.has(el)) return; seen.add(el);
    if (el.closest(sel.userBubbleExclude)) return;
    const v = el.tagName === "VIDEO" ? el : el.querySelector("video");
    const img = el.tagName === "IMG" ? el : el.querySelector("img");
    const vSrc = v ? (v.currentSrc || v.src || ((v.querySelector("source") || {}).src) || "") : "";
    const iSrc = img ? (img.currentSrc || img.src || "") : "";
    const isVid = (tid || "").includes("video") || !!v;
    const src = isVid ? (vSrc || iSrc) : (iSrc || vSrc);
    if (!src || seen.has(src)) return; seen.add(src);
    list.push({ tid: tid || (isVid ? "video" : "image"), hasVideo: !!v, src, vSrc, iSrc,
      w: v && vSrc ? (v.videoWidth || 0) : (img ? img.naturalWidth || 0 : 0),
      h: v && vSrc ? (v.videoHeight || 0) : (img ? img.naturalHeight || 0 : 0) });
  };
  document.querySelectorAll(sel.attachment).forEach((a) => add(a, a.getAttribute("data-testid") || ""));
  document.querySelectorAll(sel.agentMedia).forEach((m) => { const s = m.currentSrc || m.src || ""; if (s && !/avatar|emoji/i.test(s)) add(m.parentElement || m, "agent-media"); });
  return list;
}`;

/**
 * Durable DOM identifiers only. Never use array positions or signed URL strings as turn ids.
 * `items` keeps document order (user → assistant group → …) so a reply is attributed to the message before it;
 * `users` / `agents` are the same records split by role.
 *
 * Video media come from the attachment wrapper, not only from <video>: on a reopened thread the wrapper and its
 * presentation metadata (the durable file locator) render with the history, while the <video> playback element
 * only mounts after the file has streamed in through the account's proxy (≈ 50 s for a 13 MB clip on the reference
 * VPS, 28/10/2026). `src`/size stay empty until then, so a result is still only collected once it can be downloaded.
 * The user bubble starts with a screen-reader label (`<span class="sr-only" data-copy-exclude>You:</span>`) and, once
 * Muse starts working, ends with a reaction chip (`<span role="img" aria-label="Assistant reaction: 👍">`) — seen
 * 28/10/2026; neither is part of what was typed, both are removed from the text.
 */
export const MUSE_TURNS_FN = `(sel) => {
  const nodes = Array.from(document.querySelectorAll('[data-message-item="true"][data-message-id]'));
  const presentationOf = (element) => {
    let fiber = element && element[Object.keys(element).find(k => k.startsWith("__reactFiber"))];
    for (let i = 0; fiber && i < 8; i++, fiber = fiber.return) {
      if (fiber.memoizedProps && fiber.memoizedProps.presentation) return fiber.memoizedProps.presentation;
    }
    return null;
  };
  // Observed on Muse 27/10, stable across reload: presentation identity + host + sandbox file.
  // React internals are version-sensitive. Missing/mismatched metadata fails closed.
  const outputOf = (presentation, messageId) => {
    const videos = presentation && presentation.data && presentation.data.videos;
    const file = Array.isArray(videos) && videos.length === 1 ? videos[0] : null;
    const path = file && file.path;
    const validPath = typeof path === "string" && path.startsWith("sandbox://") && !/[\\\\?#\\u0000-\\u001f]/.test(path) && !path.slice(10).split("/").some(s => s === "." || s === ".." || s.includes("%")) && path.endsWith(".mp4");
    const bound = presentation && typeof presentation.presentationId === "string" && presentation.presentationId.length > 0 && presentation.hostMessageId === messageId && presentation.presentationMessageId === messageId;
    return bound && validPath && file.missing === false && file.mime === "video/mp4" && Number.isFinite(file.byteLen) && file.byteLen > 0 ? path : "";
  };
  const mediaOf = (e) => {
    const messageId = e.getAttribute("data-message-id");
    const wrappers = Array.from(e.querySelectorAll(sel.attachment)).filter(a => /video/i.test(a.getAttribute("data-testid") || ""));
    const pairs = wrappers.map(w => [w, w.querySelector("video")]);
    for (const v of Array.from(e.querySelectorAll("video"))) {
      const w = v.closest(sel.attachment);
      if (!w || !wrappers.includes(w)) pairs.push([w, v]);
    }
    return pairs.map(([w, v]) => ({
      output: outputOf(presentationOf(w), messageId) || "",
      src: v ? (v.currentSrc || v.src || ((v.querySelector("source") || {}).src) || "") : "",
      width: v ? v.videoWidth || 0 : 0,
      height: v ? v.videoHeight || 0 : 0,
    }));
  };
  // Parts of the user bubble that are not what was typed: the screen-reader speaker label (start) and Muse's
  // “Assistant reaction” chip (end, added while it works). Outermost matches only.
  const EXTRA = '[data-copy-exclude="true"], .sr-only, [role="img"], [aria-label*="reaction" i]';
  const userText = (bubble) => {
    let t = String(bubble.innerText || "").trim();
    const extra = bubble.querySelectorAll ? Array.from(bubble.querySelectorAll(EXTRA)) : [];
    for (const x of extra.filter(x => !extra.some(y => y !== x && y.contains(x)))) {
      const label = String(x.innerText || x.textContent || "").trim();
      if (!label) continue;
      if (t.startsWith(label)) t = t.slice(label.length).trim();
      else if (t.endsWith(label)) t = t.slice(0, t.length - label.length).trim();
    }
    return t;
  };
  const items = nodes.map(e => {
    const role = e.getAttribute("data-message-role") === "user" ? "user" : e.getAttribute("data-message-role") === "assistant" ? "assistant" : "other";
    const bubble = role === "user" && e.querySelector ? e.querySelector(sel.userBubble) : null;
    return { role, id: e.getAttribute("data-message-id"), turn: e.getAttribute("data-message-turn-id"), text: role === "user" ? userText(bubble || e) : String(e.innerText || "").trim(), media: role === "assistant" ? mediaOf(e) : [] };
  });
  const users = items.filter(i => i.role === "user").map(i => ({ id: i.id, text: i.text }));
  const agents = items.filter(i => i.role === "assistant").map(i => ({ id: i.id, turn: i.turn, text: i.text, media: i.media }));
  return { conversation: location.pathname, items, users, agents, stop: !!document.querySelector(sel.stop) };
}`;

/** Visible-element helpers shared by the Settings/Usage scripts (muse2api `_QUOTA_*_JS`). */
const VISIBLE = `const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";`;

export const QUOTA_SETTINGS_POINT_FN = `(sel, labels) => { ${VISIBLE}
  const b = Array.from(document.querySelectorAll(sel.settingsDock)).find(visible)
    || Array.from(document.querySelectorAll("button,[role=button]")).find((e) => visible(e) && labels.includes((e.getAttribute("aria-label") || "").trim()));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}`;

export const QUOTA_MENU_POINT_FN = `(sel, labels) => { ${VISIBLE}
  const exact = (e) => labels.includes((e.textContent || "").trim());
  const b = Array.from(document.querySelectorAll(sel.menuItem)).find((e) => visible(e) && (exact(e) || Array.from(e.querySelectorAll("span,div")).some(exact)))
    || Array.from(document.querySelectorAll("[role=menu] button,[role=menu] span,[role=menu] div")).find((e) => visible(e) && exact(e));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}`;

export const QUOTA_DIALOG_TEXT_FN = `(sel) => { ${VISIBLE}
  const d = Array.from(document.querySelectorAll(sel.dialog)).find(visible); return d ? (d.innerText || "") : "";
}`;

/**
 * Visible enabled send button (muse2api `_send`), searched outward from the message box first so a
 * "Send" elsewhere on the page can't win; marked so the trusted click hits exactly that element.
 */
export const SEND_BUTTON_FN = `(sel, re) => {
  const rx = new RegExp(re, "i");
  document.querySelectorAll("[data-muse4ai-send]").forEach((e) => e.removeAttribute("data-muse4ai-send"));
  const isSend = (x) => x.offsetParent !== null && (rx.test(x.getAttribute("aria-label") || "") || rx.test(x.getAttribute("data-testid") || "") || /^\\s*send\\s*$/i.test(x.innerText || ""));
  let b = null;
  for (let e = document.querySelector(sel.textarea), i = 0; e && i < 8 && !b; i++, e = e.parentElement) b = Array.from(e.querySelectorAll("button,[role=button]")).find(isSend) || null;
  if (!b) b = Array.from(document.querySelectorAll("button,[role=button]")).find(isSend) || null;
  if (!b) return "no-button";
  if (b.disabled || b.getAttribute("aria-disabled") === "true") return "disabled";
  b.setAttribute("data-muse4ai-send", "1"); return "ready";
}`;
export const SEND_MARK = '[data-muse4ai-send="1"]';

/** The composer's own file input — nearest to the message box, never one inside a history bubble (muse2api `_attach_image`). */
export const MARK_UPLOAD_INPUT_FN = `(sel) => {
  document.querySelectorAll("[" + sel.uploadMark + "]").forEach((e) => e.removeAttribute(sel.uploadMark));
  const inputs = Array.from(document.querySelectorAll(sel.fileInput));
  if (!inputs.length) return false;
  let input = null;
  const start = document.querySelector(sel.composerOverlay) || document.querySelector(sel.textarea);
  for (let e = start, i = 0; e && i < 8 && !input; i++, e = e.parentElement) input = inputs.find((x) => e.contains(x)) || null;
  if (!input) input = inputs.length === 1 ? inputs[0] : inputs.find((x) => !x.closest(sel.userBubble)) || null;
  if (!input) return false;
  input.setAttribute(sel.uploadMark, "1"); return true;
}`;

/** Upload confirmed by a "Remove attachment" button or a thumbnail inside the composer box — history images don't count. */
export const UPLOAD_CONFIRMED_FN = `(sel, re) => {
  const rx = new RegExp(re, "i");
  if (Array.from(document.querySelectorAll("button[aria-label]")).some((b) => rx.test(b.getAttribute("aria-label") || ""))) return true;
  // The composer box is a few levels above the textarea; look for a new thumbnail there only.
  let e = document.querySelector(sel.textarea);
  for (let i = 0; e && i < 4; i++) {
    e = e.parentElement;
    if (e && e.querySelector("img, video")) return true;
  }
  return false;
}`;
