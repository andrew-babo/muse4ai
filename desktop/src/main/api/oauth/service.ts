import {
  OAUTH_ACCESS_TTL_S,
  OAUTH_CLIENT_MAX,
  OAUTH_CODE_TTL_S,
  OAUTH_CONSENT_TTL_S,
  OAUTH_CONSENT_TRIES_MAX,
  OAUTH_REFRESH_GRACE_S,
  OAUTH_REFRESH_TTL_S,
  apiScopeOf,
  cleanClientName,
  digest,
  digestMatches,
  numericCode,
  opaque,
  originOf,
  parseScopes,
  pkceMatches,
  redirectAllowed,
  scopeText,
  validRedirectUri,
  type OAuthScope,
} from "../../../shared/api/oauth";
import { tl, type Locale } from "../../../shared/i18n";
import type { KeyCtx } from "../service";
import { signAccessToken, verifyAccessToken, type AccessClaims } from "./jwt";
import type { KeyPair } from "./keys";
import type { OAuthClientRow, OAuthConsentRow, OAuthStore } from "./store";

// The authorization server (spec rev 8 R131–R141): dynamic registration, authorization code + PKCE, rotating
// refresh tokens, and one gate that is ours — an approval only happens when the six-digit code shown in the
// Muse4AI window is typed into the consent page, so nobody who merely finds the URL can connect an app.
// Error texts are Vietnamese source strings (R120–R122); `oauthProblem` translates them per request.

export class OAuthError extends Error {
  /** True when the same consent page can be shown again (a wrong code), instead of the request being dead. */
  retryable = false;
  constructor(
    public status: number,
    public code: string,
    public description: string,
    public headers?: Record<string, string>,
  ) {
    super(description);
  }
}

function bad(status: number, code: string, description: string): never {
  throw new OAuthError(status, code, description);
}

/** `{"error":"invalid_grant","error_description":"…"}` — the shape OAuth clients parse, in the caller's language. */
export function oauthProblem(e: OAuthError, locale: Locale): Record<string, unknown> {
  return { error: e.code, error_description: tl(locale, e.description) };
}

export interface TokenResult {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface ConsentView {
  id: string;
  clientName: string;
  redirectHost: string;
  scopes: OAuthScope[];
  pairing: string;
  expiresAt: number;
  triesLeft: number;
}

export interface ClientView {
  id: string;
  name: string;
  scope: string[];
  createdAt: number;
  lastUsedAt: number | null;
  activeTokens: number;
}

const GRANTS_ALLOWED = new Set(["authorization_code", "refresh_token"]);

export class OAuthService {
  constructor(
    private d: {
      store: OAuthStore;
      keys: KeyPair;
      now: () => number;
      log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
      /** Tells the app window a request is waiting, so the user sees the code without opening Settings. */
      notify?: (view: ConsentView) => void;
    },
  ) {}

  // ---------------------------------------------------------------- discovery
  jwks(): { keys: Record<string, unknown>[] } {
    const j = this.d.keys.jwk;
    return { keys: [{ kty: j.kty, crv: j.crv, x: j.x, y: j.y, alg: j.alg, use: j.use, kid: j.kid }] };
  }

  // ---------------------------------------------------------------- registration (RFC 7591)
  register(body: unknown): Record<string, unknown> {
    const o = (body ?? {}) as Record<string, unknown>;
    if (this.d.store.activeClientCount() >= OAUTH_CLIENT_MAX) bad(400, "invalid_client_metadata", `Muse4AI này đã đủ ${OAUTH_CLIENT_MAX} ứng dụng — ngắt kết nối một ứng dụng trong Cài đặt › API & agent`);
    const raw = Array.isArray(o.redirect_uris) ? o.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (raw.length === 0) bad(400, "invalid_redirect_uri", "redirect_uris phải là mảng không rỗng gồm URL https hoặc http trên máy này");
    if (raw.length > 10) bad(400, "invalid_redirect_uri", "Mỗi ứng dụng tối đa 10 URL quay về");
    const uris = [...new Set(raw)];
    for (const u of uris) if (!validRedirectUri(u)) bad(400, "invalid_redirect_uri", "URL quay về không được chấp nhận (cần https, hoặc http trên máy này)");
    const grantTypes = Array.isArray(o.grant_types) && o.grant_types.length ? o.grant_types.filter((g): g is string => typeof g === "string" && GRANTS_ALLOWED.has(g)) : ["authorization_code", "refresh_token"];
    if (grantTypes.length === 0) bad(400, "invalid_client_metadata", "grant_types phải có authorization_code hoặc refresh_token");
    const id = `oc_${opaque(12)}`;
    const row = this.d.store.insertClient({
      id,
      name: cleanClientName(typeof o.client_name === "string" ? o.client_name : null),
      redirectUris: uris,
      scope: [...parseScopes(typeof o.scope === "string" ? o.scope : null)],
      grantTypes,
      now: this.d.now(),
    });
    this.d.log("info", "oauth client registered", { clientId: row.id, name: row.name, uris: row.redirectUris.length });
    return {
      client_id: row.id,
      client_id_issued_at: Math.floor(row.createdAt / 1000),
      client_name: row.name,
      redirect_uris: row.redirectUris,
      grant_types: row.grantTypes,
      scope: scopeText(row.scope),
      token_endpoint_auth_method: "none",
    };
  }

  // ---------------------------------------------------------------- authorization request (RFC 6749 §4.1.2)
  /**
   * Validates an authorization request and opens a pending approval.
   * Anything wrong with the client, the redirect URI or PKCE is refused here, before a page is shown.
   */
  authorize(params: URLSearchParams): { consent: OAuthConsentRow; client: OAuthClientRow } {
    const clientId = params.get("client_id") ?? "";
    const client = this.d.store.getClient(clientId);
    if (!client || client.revokedAt !== null) bad(400, "invalid_client", "Ứng dụng không quen: đăng ký trước bằng POST /oauth/register hoặc dùng client_id do Muse4AI này cấp");
    if ((params.get("response_type") ?? "code") !== "code") bad(400, "unsupported_response_type", "Ứng dụng này chỉ trả lời response_type=code");
    const redirectUri = params.get("redirect_uri") ?? "";
    if (!redirectAllowed(client.redirectUris, redirectUri)) bad(400, "invalid_request", "redirect_uri không khớp với URL ứng dụng đã đăng ký");
    const challenge = params.get("code_challenge") ?? "";
    const method = params.get("code_challenge_method") ?? "";
    if (!challenge || method !== "S256") bad(400, "invalid_request", "Bắt buộc PKCE: gửi code_challenge kèm code_challenge_method=S256");
    const state = params.get("state");
    if (state !== null && state.length > 512) bad(400, "invalid_request", "state quá dài");
    const now = this.d.now();
    const consent = {
      id: `cs_${opaque(12)}`,
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      scope: [...parseScopes(params.get("scope"))],
      challenge,
      method,
      state,
      pairing: numericCode(6),
      now,
      expiresAt: now + OAUTH_CONSENT_TTL_S * 1000,
    };
    this.d.store.insertConsent(consent);
    const row = this.d.store.getConsent(consent.id)!;
    this.d.notify?.(this.consentView(row));
    this.d.log("info", "oauth approval requested", { clientId: client.id, consentId: row.id, scopes: row.scope.length });
    return { consent: row, client };
  }

  /** What the app window shows while an approval waits. */
  pending(now = this.d.now()): ConsentView[] {
    return this.d.store.pendingConsents(now).map((c) => this.consentView(c));
  }

  consentView(c: OAuthConsentRow): ConsentView {
    return {
      id: c.id,
      clientName: c.clientName,
      redirectHost: originOf(c.redirectUri) ?? c.redirectUri.slice(0, 80),
      scopes: c.scope.filter((s): s is OAuthScope => (["read", "generate"] as string[]).includes(s)),
      pairing: c.pairing,
      expiresAt: c.expiresAt,
      triesLeft: Math.max(0, OAUTH_CONSENT_TRIES_MAX - c.tries),
    };
  }

  /**
   * The user's decision. Approving needs the six-digit code the app window shows (R137); five wrong tries
   * and the request dies. Returns the URL to send the browser to.
   */
  decide(
    consentId: string,
    decision: string,
    pairing: string | null,
    locale: Locale,
  ): { redirect: string; decision: "approve" | "deny" } {
    const now = this.d.now();
    const consent = this.d.store.getConsent(consentId);
    if (!consent) bad(400, "invalid_request", "Yêu cầu kết nối này không còn ở đây — hãy bắt lại từ ứng dụng agent");
    if (consent.decidedAt !== null) bad(400, "invalid_request", "Yêu cầu kết nối này đã được trả lời");
    if (consent.expiresAt <= now) bad(400, "invalid_request", "Yêu cầu kết nối này đã hết hạn — hãy bắt lại từ ứng dụng agent");
    if (decision !== "approve") {
      this.d.store.decideConsent(consent.id, "deny", now);
      this.d.log("info", "oauth approval denied", { clientId: consent.clientId, consentId: consent.id });
      return { redirect: this.failUrl(consent, "access_denied", "Người dùng đã hủy", locale), decision: "deny" };
    }
    const given = (pairing ?? "").replace(/\D/g, "");
    if (!digestMatches(given, digest(consent.pairing))) {
      const tries = this.d.store.bumpConsentTries(consent.id);
      if (tries >= OAUTH_CONSENT_TRIES_MAX) {
        this.d.store.decideConsent(consent.id, "deny", now);
        this.d.log("warn", "oauth approval blocked: wrong code too many times", { clientId: consent.clientId, consentId: consent.id });
        return { redirect: this.failUrl(consent, "access_denied", "Nhập sai mã quá nhiều lần", locale), decision: "deny" };
      }
      const left = OAUTH_CONSENT_TRIES_MAX - tries;
      const e = new OAuthError(400, "invalid_request", `Mã sai — còn ${left} lần nhập`);
      e.retryable = true;
      throw e;
    }
    if (!this.d.store.decideConsent(consent.id, "approve", now)) bad(400, "invalid_request", "Yêu cầu kết nối này đã được trả lời");
    const code = opaque(32);
    this.d.store.insertCode({
      id: `ac_${opaque(10)}`,
      clientId: consent.clientId,
      redirectUri: consent.redirectUri,
      scope: consent.scope,
      codeSha256: digest(code),
      challenge: consent.challenge,
      method: consent.method,
      now,
      expiresAt: now + OAUTH_CODE_TTL_S * 1000,
    });
    this.d.log("info", "oauth approved", { clientId: consent.clientId, consentId: consent.id, scopes: consent.scope });
    const u = new URL(consent.redirectUri);
    u.searchParams.set("code", code);
    if (consent.state) u.searchParams.set("state", consent.state);
    return { redirect: u.toString(), decision: "approve" };
  }

  /** Where the browser goes when the request itself was refused (RFC 6749 §4.1.2.1). */
  failUrl(
    consent: { redirectUri: string; state: string | null },
    error: string,
    description: string,
    locale: Locale,
  ): string {
    const u = new URL(consent.redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", tl(locale, description));
    if (consent.state) u.searchParams.set("state", consent.state);
    return u.toString();
  }

  // ---------------------------------------------------------------- token endpoint (RFC 6749 §4.1.3)
  token(form: Record<string, string>, base: string): TokenResult {
    const grant = form.grant_type ?? "";
    if (grant === "authorization_code") return this.fromCode(form, base);
    if (grant === "refresh_token") return this.fromRefresh(form, base);
    bad(400, "unsupported_grant_type", "grant_type phải là authorization_code hoặc refresh_token");
  }

  private fromCode(form: Record<string, string>, base: string): TokenResult {
    const now = this.d.now();
    const code = form.code ?? "";
    if (!code) bad(400, "invalid_request", "code là bắt buộc");
    const row = this.d.store.consumeCode(digest(code), now);
    if (!row) bad(400, "invalid_grant", "Mã này không hợp lệ, đã dùng, hoặc quá cũ");
    const client = this.d.store.getClient(row.clientId);
    if (!client || client.revokedAt !== null) bad(400, "invalid_grant", "Ứng dụng không quen");
    if (form.client_id && form.client_id !== row.clientId) bad(400, "invalid_grant", "Mã này được cấp cho ứng dụng khác");
    if (form.redirect_uri && form.redirect_uri !== row.redirectUri) bad(400, "invalid_grant", "redirect_uri không khớp với yêu cầu kết nối");
    if (!pkceMatches(form.code_verifier ?? "", row.challenge, row.method)) bad(400, "invalid_grant", "Kiểm tra PKCE thất bại: code_verifier không khớp code_challenge");
    this.d.store.touchClient(client.id, now);
    return this.issue(row.scope, client.id, undefined, base, now);
  }

  private fromRefresh(form: Record<string, string>, base: string): TokenResult {
    const now = this.d.now();
    const refresh = form.refresh_token ?? "";
    if (!refresh) bad(400, "invalid_request", "refresh_token là bắt buộc");
    const row = this.d.store.tokenByRefresh(digest(refresh));
    if (!row) bad(400, "invalid_grant", "Refresh token này không có ở đây");
    if (row.revokedAt !== null) bad(400, "invalid_grant", "Kết nối này đã bị thu hồi trong Muse4AI");
    const client = this.d.store.getClient(row.clientId);
    if (!client || client.revokedAt !== null) bad(400, "invalid_grant", "Ứng dụng không quen");
    if (form.client_id && form.client_id !== row.clientId) bad(400, "invalid_grant", "Refresh token này thuộc ứng dụng khác");
    if (row.expiresAt <= now) bad(400, "invalid_grant", "Kết nối này im lặng quá lâu — hãy kết nối lại");
    // A token already rotated and used again past its grace window means the family leaked: kill the approval.
    if (row.replacedAt !== null && now - row.replacedAt > OAUTH_REFRESH_GRACE_S * 1000) {
      this.d.store.revokeFamily(row.family, now);
      this.d.log("warn", "oauth refresh token reuse: family revoked", { clientId: row.clientId, family: row.family.slice(0, 8) });
      bad(400, "invalid_grant", "Refresh token này đã dùng hai lần — kết nối bị đóng để bảo mật, hãy kết nối lại");
    }
    this.d.store.markReplaced(row.id, now);
    this.d.store.touchClient(client.id, now);
    return this.issue(row.scope, row.clientId, row.family, base, now);
  }

  /** One approval = one family; every exchange inside it rotates the refresh token. */
  private issue(scope: string[], clientId: string, family: string | undefined, base: string, now: number): TokenResult {
    const fam = family ?? opaque(12);
    const jti = `tok_${opaque(12)}`;
    const refresh = opaque(32);
    this.d.store.insertToken({
      id: jti,
      clientId,
      family: fam,
      scope,
      refreshSha256: digest(refresh),
      now,
      expiresAt: now + OAUTH_REFRESH_TTL_S * 1000,
    });
    const claims: AccessClaims = {
      iss: base,
      aud: base,
      sub: clientId,
      client_id: clientId,
      scope: scopeText(scope),
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + OAUTH_ACCESS_TTL_S * 1000) / 1000),
      jti,
    };
    return {
      access_token: signAccessToken(this.d.keys, claims),
      token_type: "Bearer",
      expires_in: OAUTH_ACCESS_TTL_S,
      refresh_token: refresh,
      scope: scopeText(scope),
    };
  }

  // ---------------------------------------------------------------- revocation (RFC 7009)
  /** Always answers 200: a client must not be able to test whether a token exists. */
  revoke(form: Record<string, string>): void {
    const now = this.d.now();
    const token = form.token ?? "";
    if (!token) return;
    const byRefresh = this.d.store.tokenByRefresh(digest(token));
    if (byRefresh) {
      this.d.store.revokeToken(byRefresh.id, now);
      this.d.log("info", "oauth token revoked", { clientId: byRefresh.clientId, family: byRefresh.family.slice(0, 8) });
      return;
    }
    const direct = this.d.store.tokenById(token);
    if (direct) this.d.store.revokeToken(direct.id, now);
  }

  // ---------------------------------------------------------------- resource server (R136)
  /**
   * Bearer token → the caller's context, or null. The token must be signed by this install, carry this
   * origin as issuer and audience, not be expired, and belong to a live approval and a live app.
   */
  context(token: string, base: string, now = this.d.now()): KeyCtx | null {
    const v = verifyAccessToken(token, this.d.keys, { iss: base, aud: base, now });
    if (!v.ok) return null;
    const row = this.d.store.tokenById(v.claims.jti);
    if (!row || row.revokedAt !== null) return null;
    const client = this.d.store.getClient(v.claims.client_id);
    if (!client || client.revokedAt !== null) return null;
    return { id: client.id, name: client.name, scope: apiScopeOf(row.scope as OAuthScope[]), oauth: true };
  }

  /** The user closes a waiting request from the app window without answering it. */
  dismiss(consentId: string, now = this.d.now()): boolean {
    const ok = this.d.store.decideConsent(consentId, "deny", now);
    if (ok) this.d.log("info", "oauth approval dismissed", { consentId });
    return ok;
  }

  // ---------------------------------------------------------------- app-facing views
  clients(now = this.d.now()): ClientView[] {
    return this.d.store
      .listClients()
      .filter((c) => c.revokedAt === null)
      .map((c) => ({
        id: c.id,
        name: c.name,
        scope: c.scope,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        activeTokens: this.d.store.activeTokensForClient(c.id).filter((t2) => t2.revokedAt === null && t2.expiresAt > now).length,
      }));
  }

  revokeClient(id: string, now = this.d.now()): boolean {
    const ok = this.d.store.revokeClient(id, now);
    if (!ok) return false;
    this.d.store.revokeClientTokens(id, now);
    this.d.log("info", "oauth app removed", { clientId: id });
    return true;
  }

  prune(now = this.d.now()): number {
    return this.d.store.prune(now);
  }
}
