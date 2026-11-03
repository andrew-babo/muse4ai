import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { t } from "../i18n";

// OAuth 2.1 for agents (spec rev 8 R131–R141). Pure rules: formats, PKCE, redirect matching, metadata shapes.
// The authorization server runs inside this app (no external account system): each install signs its own tokens.

export const OAUTH_ACCESS_TTL_S = 3600; // 1 h access token, refreshed with the refresh token
export const OAUTH_REFRESH_TTL_S = 30 * 86_400; // 30 days of silence before a connection has to be re-approved
export const OAUTH_CODE_TTL_S = 300; // an authorization code is single-use and short-lived
export const OAUTH_CONSENT_TTL_S = 600; // a pending approval shown in the app window
export const OAUTH_CONSENT_TRIES_MAX = 5; // wrong codes before the request dies
export const OAUTH_CLIENT_MAX = 50; // registered apps (dynamic registration is open, so this is capped)
export const OAUTH_CLIENT_NAME_MAX = 60;
export const OAUTH_REFRESH_GRACE_S = 60; // a rotated refresh token still works this long (a client that retried)

/** Scopes this app understands. Unknown scopes a client asks for are shown but grant nothing. */
export const OAUTH_SCOPES = ["read", "generate"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** What an approved connection may do, in the words a consent screen shows (Vietnamese source; the catalog carries English). */
export const SCOPE_LABEL: Record<OAuthScope, string> = {
  read: "Xem thư viện, hàng chờ và trạng thái tài khoản",
  generate: "Tạo ảnh, video, trả lời và kéo dài video",
};

export const OAUTH_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export const OAUTH_RESPONSE_TYPES = ["code"] as const;

const B64URL = /^[A-Za-z0-9_-]+$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/;

/** Base64url without padding (JWS/JWK alphabet). */
export const b64url = (b: Buffer | string): string => Buffer.from(b as never).toString("base64url");
export const unb64url = (s: string): Buffer => Buffer.from(s, "base64url");

/** True for a JWS-shaped string — what an OAuth access token looks like next to an `msk_` API key. */
export function looksLikeJwt(token: string): boolean {
  return JWT_RE.test(token);
}

/** Random opaque token (verifier, code, client id, refresh token). */
export function opaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Six digits, unbiased (rejection sampling), for the pairing code shown in the app window. */
export function numericCode(len = 6, rand: (n: number) => Buffer = randomBytes): string {
  let out = "";
  while (out.length < len) {
    for (const b of rand(len * 2)) {
      if (b >= 250) continue; // 250 = 5 * 50, so every digit stays equally likely
      out += String(b % 10);
      if (out.length === len) break;
    }
  }
  return out;
}

/** Only the digest of a code/token is stored — like API keys (R24), a leaked store cannot be replayed. */
export function digest(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Constant-time digest compare; an unknown subject is compared against a digest that can never match. */
export function digestMatches(given: string, storedHex: string | null): boolean {
  const a = Buffer.from(digest(given), "hex");
  const b = Buffer.from(storedHex ?? "0".repeat(64), "hex");
  if (a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- PKCE (RFC 7636)

/** S256 only — OAuth 2.1 dropped `plain`, and no serious client needs it. */
export function pkceChallenge(verifier: string, method: string): string | null {
  if (method !== "S256") return null;
  if (!B64URL.test(verifier) || verifier.length < 43 || verifier.length > 128) return null;
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function pkceMatches(verifier: string, challenge: string, method: string): boolean {
  const expect = pkceChallenge(verifier, method);
  return expect !== null && expect === challenge;
}

// ---------------------------------------------------------------- redirect URIs (RFC 6749 §3.1.2)

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "ipv6localhost"]);

/**
 * A client may only come back to an https origin, or to a loopback http origin (desktop agents).
 * Fragments are refused: the code is appended with `#` by some clients and would be lost.
 */
export function validRedirectUri(uri: string): boolean {
  if (!uri || uri.length > 512 || uri.includes(" ") || uri.includes("\n")) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return true;
  return false;
}

/** Exact string match — the rule RFC 6749 gives, and the one that cannot be argued with. */
export function redirectAllowed(registered: string[], requested: string): boolean {
  return registered.includes(requested);
}

/** `https://host` or `http://127.0.0.1:port` — the origin a refresh token may be used from. */
export function originOf(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- scope handling

/** Splits a `scope` string and keeps only the scopes this app knows, in a stable order. */
export function parseScopes(raw: string | null | undefined): OAuthScope[] {
  const want = new Set((raw ?? "").split(/[\s,]+/).filter(Boolean));
  return OAUTH_SCOPES.filter((s) => want.has(s));
}

export function scopeText(scopes: string[]): string {
  return scopes.join(" ");
}

/** Scopes a client asked for that this app does not know — shown as "additional permission". */
export function unknownScopes(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .filter((s) => s && !OAUTH_SCOPES.includes(s as OAuthScope));
}

/** The API scope a connection gets: `generate` implies read, like an API key. */
export function apiScopeOf(scopes: OAuthScope[]): "read" | "generate" {
  return scopes.includes("generate") ? "generate" : "read";
}

// ---------------------------------------------------------------- request shapes

/** Parses an `application/x-www-form-urlencoded` body (what OAuth clients post). */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = (i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, " ");
    const v = i < 0 ? "" : pair.slice(i + 1).replace(/\+/g, " ");
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      /* a client that cannot encode: keep the raw key so the error names the field */
      out[k] = v;
    }
  }
  return out;
}

/** Client name for display and storage: one line, no markup, bounded. */
export function cleanClientName(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[\u0000-\u001f\u007f<>"]/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, OAUTH_CLIENT_NAME_MAX) || t("Ứng dụng agent");
}

// ---------------------------------------------------------------- metadata documents

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/** RFC 9728 — what a client reads first to learn who signs tokens for this MCP endpoint. */
export function protectedResourceMetadata(base: string, mcpPath = "/mcp"): ProtectedResourceMetadata {
  return {
    resource: `${base}${mcpPath}`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
    resource_name: "Muse4AI",
    resource_documentation: `${base}/docs/mcp-tools`,
  };
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  token_endpoint_auth_signing_alg_values_supported: string[];
  revocation_endpoint: string;
  service_documentation: string;
}

/** RFC 8414 — the endpoints a client may call. Clients are public (PKCE), so no secret is issued. */
export function authorizationServerMetadata(base: string): AuthorizationServerMetadata {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    jwks_uri: `${base}/oauth/jwks`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: [...OAUTH_RESPONSE_TYPES],
    grant_types_supported: [...OAUTH_GRANT_TYPES],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    token_endpoint_auth_signing_alg_values_supported: [],
    revocation_endpoint: `${base}/oauth/revoke`,
    service_documentation: `${base}/docs/mcp-tools`,
  };
}

/** `Authorization: Bearer …` answers that point a client at the metadata document (RFC 9728 §5.1). */
export function bearerChallenge(base: string, error: "missing_token" | "invalid_token"): string {
  return `Bearer realm="muse4ai", error="${error}", resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}
