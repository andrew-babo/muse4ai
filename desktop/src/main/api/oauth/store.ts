import { OAUTH_CONSENT_TRIES_MAX } from "../../../shared/api/oauth";
import type { Database } from "../../db";

// OAuth rows (spec rev 8 R131–R141) in the same SQLite store as everything else; main process is the only writer.
// Codes and refresh tokens are stored as SHA-256 digests only, like API keys (R24), so a copied store cannot be replayed.

type Row = Record<string, unknown>;
const N = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const S = (v: unknown, d = "") => (v === null || v === undefined ? d : String(v));
const json = <T>(v: unknown, d: T): T => {
  try {
    return JSON.parse(S(v)) as T;
  } catch {
    return d;
  }
};

export interface OAuthClientRow {
  id: string;
  name: string;
  redirectUris: string[];
  scope: string[];
  grantTypes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface OAuthCodeRow {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  codeSha256: string;
  challenge: string;
  method: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface OAuthTokenRow {
  id: string;
  clientId: string;
  family: string;
  scope: string[];
  refreshSha256: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  replacedAt: number | null;
}

export interface OAuthConsentRow {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string[];
  challenge: string;
  method: string;
  state: string | null;
  pairing: string;
  tries: number;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  decision: string | null;
}

const mapClient = (r: Row): OAuthClientRow => ({
  id: S(r.id),
  name: S(r.name),
  redirectUris: json<string[]>(r.redirect_uris, []),
  scope: json<string[]>(r.scope, []),
  grantTypes: json<string[]>(r.grant_types, ["authorization_code", "refresh_token"]),
  createdAt: Number(r.created_at),
  lastUsedAt: N(r.last_used_at),
  revokedAt: N(r.revoked_at),
});

const mapCode = (r: Row): OAuthCodeRow => ({
  id: S(r.id),
  clientId: S(r.client_id),
  redirectUri: S(r.redirect_uri),
  scope: json<string[]>(r.scope, []),
  codeSha256: S(r.code_sha256),
  challenge: S(r.challenge),
  method: S(r.method),
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  usedAt: N(r.used_at),
});

const mapToken = (r: Row): OAuthTokenRow => ({
  id: S(r.id),
  clientId: S(r.client_id),
  family: S(r.family),
  scope: json<string[]>(r.scope, []),
  refreshSha256: S(r.refresh_sha256),
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  lastUsedAt: N(r.last_used_at),
  revokedAt: N(r.revoked_at),
  replacedAt: N(r.replaced_at),
});

const mapConsent = (r: Row): OAuthConsentRow => ({
  id: S(r.id),
  clientId: S(r.client_id),
  clientName: S(r.client_name),
  redirectUri: S(r.redirect_uri),
  scope: json<string[]>(r.scope, []),
  challenge: S(r.challenge),
  method: S(r.method),
  state: r.state === null || r.state === undefined ? null : S(r.state),
  pairing: S(r.pairing),
  tries: Number(r.tries ?? 0),
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  decidedAt: N(r.decided_at),
  decision: r.decision === null || r.decision === undefined ? null : S(r.decision),
});

export class OAuthStore {
  constructor(private db: Database) {}

  // ---------------------------------------------------------------- clients (RFC 7591)
  insertClient(c: { id: string; name: string; redirectUris: string[]; scope: string[]; grantTypes: string[]; now: number }): OAuthClientRow {
    this.db
      .prepare("INSERT INTO oauth_clients(id,name,redirect_uris,scope,grant_types,created_at) VALUES(?,?,?,?,?,?)")
      .run(c.id, c.name, JSON.stringify(c.redirectUris), JSON.stringify(c.scope), JSON.stringify(c.grantTypes), c.now);
    return this.getClient(c.id)!;
  }
  getClient(id: string): OAuthClientRow | null {
    const r = this.db.prepare("SELECT * FROM oauth_clients WHERE id=?").get(id) as Row | undefined;
    return r ? mapClient(r) : null;
  }
  listClients(): OAuthClientRow[] {
    return (this.db.prepare("SELECT * FROM oauth_clients ORDER BY created_at DESC").all() as Row[]).map(mapClient);
  }
  activeClientCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients WHERE revoked_at IS NULL").get() as Row).n);
  }
  touchClient(id: string, now: number): void {
    this.db.prepare("UPDATE oauth_clients SET last_used_at=? WHERE id=?").run(now, id);
  }
  revokeClient(id: string, now: number): boolean {
    return Number(this.db.prepare("UPDATE oauth_clients SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now, id).changes) > 0;
  }

  // ---------------------------------------------------------------- authorization codes (single use)
  insertCode(c: { id: string; clientId: string; redirectUri: string; scope: string[]; codeSha256: string; challenge: string; method: string; now: number; expiresAt: number }): void {
    this.db
      .prepare("INSERT INTO oauth_codes(id,client_id,redirect_uri,scope,code_sha256,challenge,method,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(c.id, c.clientId, c.redirectUri, JSON.stringify(c.scope), c.codeSha256, c.challenge, c.method, c.now, c.expiresAt);
  }
  /** Marks the code used and returns it, or null when it is unknown, already used or past its minute. */
  consumeCode(codeSha256: string, now: number): OAuthCodeRow | null {
    const r = this.db.prepare("SELECT * FROM oauth_codes WHERE code_sha256=?").get(codeSha256) as Row | undefined;
    if (!r) return null;
    const row = mapCode(r);
    if (row.usedAt !== null || row.expiresAt <= now) return null;
    this.db.prepare("UPDATE oauth_codes SET used_at=? WHERE id=? AND used_at IS NULL").run(now, row.id);
    return row;
  }

  // ---------------------------------------------------------------- refresh tokens (rotating, one family per approval)
  insertToken(t: { id: string; clientId: string; family: string; scope: string[]; refreshSha256: string; now: number; expiresAt: number }): void {
    this.db
      .prepare("INSERT INTO oauth_tokens(id,client_id,family,scope,refresh_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?)")
      .run(t.id, t.clientId, t.family, JSON.stringify(t.scope), t.refreshSha256, t.now, t.expiresAt);
  }
  tokenByRefresh(refreshSha256: string): OAuthTokenRow | null {
    const r = this.db.prepare("SELECT * FROM oauth_tokens WHERE refresh_sha256=?").get(refreshSha256) as Row | undefined;
    return r ? mapToken(r) : null;
  }
  tokenById(id: string): OAuthTokenRow | null {
    const r = this.db.prepare("SELECT * FROM oauth_tokens WHERE id=?").get(id) as Row | undefined;
    return r ? mapToken(r) : null;
  }
  /** A rotated token stays usable for OAUTH_REFRESH_GRACE_S so a client that retried is not locked out. */
  markReplaced(id: string, now: number): void {
    this.db.prepare("UPDATE oauth_tokens SET replaced_at=? WHERE id=? AND replaced_at IS NULL").run(now, id);
  }
  touchToken(id: string, now: number): void {
    this.db.prepare("UPDATE oauth_tokens SET last_used_at=? WHERE id=?").run(now, id);
  }
  revokeToken(id: string, now: number): boolean {
    return Number(this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now, id).changes) > 0;
  }
  /** Reuse of an old refresh token means the family is compromised: every token of that approval dies. */
  revokeFamily(family: string, now: number): number {
    return Number(this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE family=? AND revoked_at IS NULL").run(now, family).changes);
  }
  revokeClientTokens(clientId: string, now: number): number {
    return Number(this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL").run(now, clientId).changes);
  }
  activeTokensForClient(clientId: string): OAuthTokenRow[] {
    return (this.db.prepare("SELECT * FROM oauth_tokens WHERE client_id=? AND revoked_at IS NULL ORDER BY created_at DESC").all(clientId) as Row[]).map(mapToken);
  }

  // ---------------------------------------------------------------- pending approvals (the pairing code gate)
  insertConsent(c: {
    id: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    scope: string[];
    challenge: string;
    method: string;
    state: string | null;
    pairing: string;
    now: number;
    expiresAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO oauth_consents(id,client_id,client_name,redirect_uri,scope,challenge,method,state,pairing,created_at,expires_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(c.id, c.clientId, c.clientName, c.redirectUri, JSON.stringify(c.scope), c.challenge, c.method, c.state, c.pairing, c.now, c.expiresAt);
  }
  getConsent(id: string): OAuthConsentRow | null {
    const r = this.db.prepare("SELECT * FROM oauth_consents WHERE id=?").get(id) as Row | undefined;
    return r ? mapConsent(r) : null;
  }
  /** Approvals still waiting, newest first — this is what the app window shows. */
  pendingConsents(now: number): OAuthConsentRow[] {
    return (this.db
      .prepare("SELECT * FROM oauth_consents WHERE decided_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 5")
      .all(now) as Row[]).map(mapConsent);
  }
  bumpConsentTries(id: string): number {
    this.db.prepare("UPDATE oauth_consents SET tries=tries+1 WHERE id=?").run(id);
    const r = this.db.prepare("SELECT tries FROM oauth_consents WHERE id=?").get(id) as Row | undefined;
    return r ? Number(r.tries ?? 0) : OAUTH_CONSENT_TRIES_MAX;
  }
  decideConsent(id: string, decision: "approve" | "deny", now: number): boolean {
    return Number(this.db.prepare("UPDATE oauth_consents SET decided_at=?, decision=? WHERE id=? AND decided_at IS NULL").run(now, decision, id).changes) > 0;
  }

  // ---------------------------------------------------------------- housekeeping
  /** Codes live minutes; expired approvals and stale tokens are dropped so the store does not grow forever. */
  prune(now: number): number {
    let n = Number(this.db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now).changes);
    n += Number(this.db.prepare("DELETE FROM oauth_consents WHERE decided_at IS NOT NULL OR expires_at < ?").run(now).changes);
    n += Number(this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now).changes);
    return n;
  }
}
