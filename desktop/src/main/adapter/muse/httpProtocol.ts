// Build 2.0 — the one adapter module for Muse's direct channel: hosts, paths, node id and the text/code patterns that
// classify what Muse reports (R90). A Muse change to any of these is fixed here only (desktop/AGENTS.md).

/** Light same-origin page the channel client runs in (no Muse UI, no page scripts). Research §7.4. */
export const GW_PAGE_URL = "https://muse.ai/robots.txt";
/** The gateway host the channel connects to: its proxy resolution must never be DIRECT (R96). */
export const GW_PROXY_CHECK_URL = "https://hatch.metaaivm.com/";
/** Node id sent with each chat turn (the web app sends its own; any stable value is accepted). */
export const GW_NODE_ID = "muse4ai";
/** History read size: enough user turns for a long conversation. */
export const GW_HISTORY_LIMIT = 200;
/** Newest conversations read for a turn's done state (running jobs are the most recently updated). */
export const GW_SESSION_LIST_LIMIT = 50;
/** Wait for one history/session-list reply. */
export const GW_JSON_TIMEOUT_MS = 30_000;
/** One page connect(): a 90 s machine wake plus socket and handshake, retried once after a socket failure. */
export const GW_CONNECT_TIMEOUT_MS = 240_000;
/** One file download over the tunnel (large videos included). */
export const GW_FETCH_TIMEOUT_MS = 5 * 60_000;
/**
 * Output files one channel page downloads at once. Downloads are streamed (the page keeps only what arrived since the
 * last pull), but whole-file buffering pushed a page to 174 MB for one 14.6 MB video on 01/11 (target ≤ 150 MB).
 */
export const GW_FETCH_PARALLEL = 2;
/** Wait for a download's response head. */
export const GW_FILE_HEAD_TIMEOUT_MS = 60_000;
/** One pull waits this long for the next bytes before asking again (the overall cap is GW_FETCH_TIMEOUT_MS). */
export const GW_FILE_PIECE_WAIT_MS = 20_000;
/** Main ↔ page polling cadence while turns are tracked. */
export const GW_POLL_MS = 1_000;
/** History fallback read while waiting for a completion event (R94). */
export const GW_HISTORY_FALLBACK_MS = 20_000;

export type GatewaySignal = "anomaly" | "checkpoint" | "needs_login" | "quota";

const ANOMALY = /unusual (activity|traffic|behaviou?r)|suspicious|temporarily (blocked|restricted|locked|limited|suspended)|account (has been |is |was )?(restricted|locked|suspended|disabled|banned)|automated (behaviou?r|requests|activity|queries)|we(?:'|’)ve (restricted|limited|blocked)|hoạt động bất thường|bị hạn chế/i;
const CHECKPOINT = /checkpoint|verify (your|that it(?:'|’)?s you)|confirm (your|it(?:'|’)s) (identity|you)|security check|xác minh/i;
const LOGIN = /log ?in again|sign ?in again|session (has )?expired|not (logged|signed) in|unauthori[sz]ed|authentication required|đăng nhập lại/i;
const QUOTA = /rate.?limit|too many requests|usage limit|limit (has been )?reached|out of (credits|quota)|quota exceeded|hết hạn mức/i;

/**
 * R90 — what a Muse error means. HTTP 429 → quota; 401/403 → login (the caller requires two in a row); text patterns
 * for anomaly/checkpoint win over status codes. `null` = not a Muse signal (a technical error, R89).
 */
export function classifyGatewaySignal(status: number | null, code: string | null, message: string | null): GatewaySignal | null {
  const text = `${code ?? ""} ${message ?? ""}`;
  if (ANOMALY.test(text)) return "anomaly";
  if (CHECKPOINT.test(text)) return "checkpoint";
  if (status === 429 || QUOTA.test(text)) return "quota";
  if (status === 401 || status === 403 || LOGIN.test(text)) return "needs_login";
  return null;
}

/** Proxy resolution string from Chromium (“PROXY h:p”, “SOCKS5 h:p”, “DIRECT”): DIRECT anywhere means traffic could leave unproxied. */
export function isDirect(resolved: string): boolean {
  return resolved
    .split(";")
    .map((s) => s.trim().toUpperCase())
    .some((s) => s === "DIRECT" || s === "");
}
