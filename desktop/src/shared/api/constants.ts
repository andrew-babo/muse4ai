import { REF_MAX_BYTES } from "../constants";

// Numbers from spec rev 4 §4.8 (R23–R33). Defaults are proposals (spec A7) — change here only.

export const API_DEFAULT_PORT = 47821; // R23
export const API_PORT_MIN = 1024;
export const API_PORT_MAX = 65535;

export const API_KEY_PREFIX = "msk_"; // R24
export const API_KEY_MAX_ACTIVE = 20;
export const API_KEY_NAME_MAX = 40;
export const API_AUTH_FAIL_DELAY_MS = 300;
/** last_used_at is written at most this often per key (keeps the request path cheap). */
export const API_KEY_TOUCH_MS = 60_000;

export const API_JSON_MAX_BYTES = 64 * 1024; // R28
/** Build 2.0 R109 — a chat body may carry a 32 000-character prompt; image/video bodies keep 64 KB. */
export const API_CHAT_JSON_MAX_BYTES = 256 * 1024;
export const API_UPLOAD_MAX_BYTES = REF_MAX_BYTES; // R10
/** MCP carries a reference image inline as base64 (≤ 8 MB raw); bigger images go through POST /v1/references. */
export const API_MCP_REF_MAX_BYTES = 8 * 1024 * 1024;
export const API_MCP_MAX_BYTES = 12 * 1024 * 1024;
export const API_WAIT_MAX_S = 50;
export const API_WAITS_PER_KEY = 8;
export const API_WAITS_TOTAL = 32;
export const API_UNFINISHED_PER_KEY = 400; // Build 2.0 R109 (was 200)
export const API_LIST_DEFAULT = 20;
export const API_LIST_MAX = 100;
export const API_IDEMPOTENCY_MAX = 100;

/** Token buckets per key: `capacity` back-to-back requests, refilled at `perMinute`. */
/** Build 2.0 R109 — create 120/min (burst 30), upload 60/min; read unchanged from R28. */
export const API_BUCKETS = {
  create: { capacity: 30, perMinute: 120 },
  read: { capacity: 60, perMinute: 240 },
  upload: { capacity: 10, perMinute: 60 },
} as const;
export type ApiBucket = keyof typeof API_BUCKETS;

export const API_SIGNED_URL_TTL_S = 3600; // R32

export const API_LOG_RETENTION_DAYS = 14; // R31
export const API_LOG_MAX_ROWS = 20_000;

export const API_HEADERS_TIMEOUT_MS = 10_000; // R28
export const API_REQUEST_TIMEOUT_MS = 120_000;
export const API_KEEPALIVE_TIMEOUT_MS = 5_000;
export const API_MAX_CONNECTIONS = 128;
export const API_MAX_HEADER_BYTES = 16 * 1024;

// ---------------------------------------------------------------- tunnel (R30)
export const TUNNEL_VERSION = "2026.10.4";
export interface TunnelBinary {
  url: string;
  sha256: string;
  bytes: number;
  file: string;
}
/** Pinned cloudflared builds. Windows is the product; linux-x64 exists only for the developer E2E sandbox. */
export const TUNNEL_BINARIES: Record<string, TunnelBinary> = {
  "win32-x64": {
    url: `https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_VERSION}/cloudflared-windows-amd64.exe`,
    sha256: "411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8",
    bytes: 55_344_848,
    file: `cloudflared-${TUNNEL_VERSION}.exe`,
  },
  "linux-x64": {
    url: `https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_VERSION}/cloudflared-linux-amd64`,
    sha256: "ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42",
    bytes: 40_247_428,
    file: `cloudflared-${TUNNEL_VERSION}`,
  },
};
export const TUNNEL_RESTART_DELAYS_S = [2, 5, 15, 30, 60];
export const TUNNEL_STOP_TIMEOUT_MS = 3_000;
/** From process start until the public address answers with our instance id. */
export const TUNNEL_ONLINE_TIMEOUT_MS = 90_000;
/** Online this long → the restart back-off starts over. */
export const TUNNEL_STABLE_MS = 5 * 60_000;
export const TUNNEL_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

// ---------------------------------------------------------------- MCP (spec §4.8)
export const MCP_MODERN_VERSIONS = ["2026-07-28"] as const;
export const MCP_LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const MCP_LATEST_LEGACY = "2025-11-25";
/** A legacy request without MCP-Protocol-Version is treated as this revision (spec 2025-11-25 transports). */
export const MCP_DEFAULT_LEGACY = "2025-03-26";

// ---------------------------------------------------------------- domain → this machine (spec rev 5, R34–R38)
export const CADDY_VERSION = "2.11.7";
export interface CaddyBinary {
  /** Release archive (ZIP on Windows, tar.gz on Linux) and its pinned SHA-256. */
  url: string;
  archiveSha256: string;
  archiveBytes: number;
  /** Entry inside the archive and the pinned SHA-256 of the extracted executable (re-checked before every start). */
  entry: string;
  sha256: string;
  file: string;
}
/** Pinned Caddy builds (Apache-2.0). Windows is the product; linux-x64 exists only for the developer sandbox tests. */
export const CADDY_BINARIES: Record<string, CaddyBinary> = {
  "win32-x64": {
    url: `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_windows_amd64.zip`,
    archiveSha256: "0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06",
    archiveBytes: 18_479_498,
    entry: "caddy.exe",
    sha256: "5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a",
    file: `caddy-${CADDY_VERSION}.exe`,
  },
  "linux-x64": {
    url: `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz`,
    archiveSha256: "727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b",
    archiveBytes: 18_113_754,
    entry: "caddy",
    sha256: "678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9",
    file: `caddy-${CADDY_VERSION}`,
  },
};
export const CADDY_RESTART_DELAYS_S = [2, 5, 15, 30, 60];
export const CADDY_STOP_TIMEOUT_MS = 3_000;
/** Running this long → the restart back-off starts over. */
export const CADDY_STABLE_MS = 5 * 60_000;
export const CADDY_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** Header Caddy overwrites on every request it forwards; its value changes on every Caddy start (R33). */
export const INGRESS_HEADER = "x-muse-ingress";
/** Per-run secret on the app's own tunnel/domain health checks, so they stay out of the agent request log. */
export const SELFCHECK_HEADER = "x-muse-selfcheck";
export function selfCheckHeaders(token?: string): Record<string, string> {
  return token ? { "User-Agent": "Muse4AI-selfcheck", [SELFCHECK_HEADER]: token } : { "User-Agent": "Muse4AI-selfcheck" };
}

export const DOMAIN_PROBE_TIMEOUT_MS = 8_000; // R36
export const DOMAIN_FAST_INTERVAL_MS = 15_000;
export const DOMAIN_FAST_WINDOW_MS = 10 * 60_000;
export const DOMAIN_SLOW_INTERVAL_MS = 60_000;
/** Consecutive failed public checks before an online address (domain or tunnel) leaves "online". */
export const PUBLIC_FAIL_THRESHOLD = 3;
export const TUNNEL_HEALTH_INTERVAL_MS = 60_000; // R30 rev 5
export const DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
export const DNS_TIMEOUT_MS = 3_000;
export const PUBLIC_IP_URLS = ["https://api.ipify.org", "https://1.1.1.1/cdn-cgi/trace"];
export const PUBLIC_IP_CACHE_MS = 10 * 60_000;
