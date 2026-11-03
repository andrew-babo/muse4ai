import { API_LOG_MAX_ROWS, API_LOG_RETENTION_DAYS } from "../../shared/api/constants";
import { keyPrefix } from "../../shared/api/keys";
import { TERMINAL } from "../../shared/jobMachine";
import type { ApiKeyView, ApiRequestLog, ApiScope, JobState } from "../../shared/types";
import type { Database } from "../db";

// Storage for API keys (SHA-256 only, R24) and the request log (no secrets, R31). Same SQLite store, main process only.

export interface ApiKeyRow {
  id: string;
  name: string;
  scope: ApiScope;
  tokenSha256: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

type Row = Record<string, unknown>;
const N = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const mapKey = (r: Row): ApiKeyRow => ({
  id: String(r.id),
  name: String(r.name),
  scope: r.scope === "generate" ? "generate" : "read",
  tokenSha256: String(r.token_sha256),
  createdAt: Number(r.created_at),
  lastUsedAt: N(r.last_used_at),
  revokedAt: N(r.revoked_at),
});

export const keyView = (k: ApiKeyRow): ApiKeyView => ({
  id: k.id,
  name: k.name,
  scope: k.scope,
  prefix: keyPrefix(k.id),
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
});

export interface RequestRecord {
  ts: number;
  keyId: string | null;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  code: string | null;
  ipMasked: string | null;
  via: "local" | "lan" | "tunnel" | "domain";
}

const TERMINAL_LIST = [...TERMINAL];

export class ApiStore {
  constructor(private db: Database) {}

  // ---------------------------------------------------------------- keys
  listKeys(): ApiKeyRow[] {
    return (this.db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as Row[]).map(mapKey);
  }
  getKey(id: string): ApiKeyRow | null {
    const r = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(id) as Row | undefined;
    return r ? mapKey(r) : null;
  }
  activeKeys(): ApiKeyRow[] {
    return this.listKeys().filter((k) => k.revokedAt === null);
  }
  activeNameTaken(name: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM api_keys WHERE name_key=? AND revoked_at IS NULL").get(name.trim().toLocaleLowerCase("vi"));
  }
  insertKey(k: { id: string; name: string; scope: ApiScope; tokenSha256: string; now: number }): ApiKeyRow {
    this.db
      .prepare("INSERT INTO api_keys(id,name,name_key,scope,token_sha256,created_at) VALUES(?,?,?,?,?,?)")
      .run(k.id, k.name, k.name.trim().toLocaleLowerCase("vi"), k.scope, k.tokenSha256, k.now);
    return this.getKey(k.id)!;
  }
  revokeKey(id: string, now: number): boolean {
    return Number(this.db.prepare("UPDATE api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now, id).changes) > 0;
  }
  touchKey(id: string, now: number): void {
    this.db.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?").run(now, id);
  }

  // ---------------------------------------------------------------- request log (R31)
  insertRequest(r: RequestRecord): void {
    this.db
      .prepare("INSERT INTO api_requests(ts,key_id,method,route,status,duration_ms,code,ip_masked,via) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(r.ts, r.keyId, r.method, r.route, r.status, Math.round(r.durationMs), r.code, r.ipMasked, r.via);
  }
  recentRequests(limit = 50): ApiRequestLog[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, k.name AS key_name FROM api_requests r LEFT JOIN api_keys k ON k.id = r.key_id ORDER BY r.seq DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      ts: Number(r.ts),
      keyName: (r.key_name as string) ?? null,
      method: String(r.method),
      route: String(r.route),
      status: Number(r.status),
      durationMs: Number(r.duration_ms),
      code: (r.code as string) ?? null,
      ipMasked: (r.ip_masked as string) ?? null,
      via: (r.via as ApiRequestLog["via"]) ?? "local",
    }));
  }
  countRequests(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM api_requests").get() as Row).n);
  }
  /** Drops rows older than 14 days, then keeps the newest 20 000 (R31). Returns rows removed. */
  pruneRequests(now: number): number {
    const cutoff = now - API_LOG_RETENTION_DAYS * 86_400_000;
    let removed = Number(this.db.prepare("DELETE FROM api_requests WHERE ts < ?").run(cutoff).changes);
    const extra = this.countRequests() - API_LOG_MAX_ROWS;
    if (extra > 0) removed += Number(this.db.prepare("DELETE FROM api_requests WHERE seq IN (SELECT seq FROM api_requests ORDER BY seq ASC LIMIT ?)").run(extra).changes);
    return removed;
  }

  // ---------------------------------------------------------------- idempotent replies (R27)
  /** First response body for an Idempotency-Key / request_id, replayed unchanged while its jobs exist. */
  saveReply(clientRequestId: string, body: string, now: number): void {
    this.db.prepare("INSERT OR IGNORE INTO api_replies(client_request_id, body, created_at) VALUES(?,?,?)").run(clientRequestId, body, now);
  }
  getReply(clientRequestId: string): string | null {
    const r = this.db.prepare("SELECT body FROM api_replies WHERE client_request_id=?").get(clientRequestId) as Row | undefined;
    return r ? String(r.body) : null;
  }

  // ---------------------------------------------------------------- jobs owned by a key (R26)
  countUnfinished(keyId: string): number {
    const ph = TERMINAL_LIST.map(() => "?").join(",");
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE api_key_id=? AND state NOT IN (${ph})`).get(keyId, ...TERMINAL_LIST) as Row).n);
  }
  jobOwner(jobId: string): string | null {
    const r = this.db.prepare("SELECT api_key_id FROM jobs WHERE id=?").get(jobId) as Row | undefined;
    return r ? ((r.api_key_id as string) ?? null) : null;
  }
  assetOwner(assetId: string): string | null {
    const r = this.db.prepare("SELECT j.api_key_id AS k FROM assets a JOIN jobs j ON j.id = a.job_id WHERE a.id=?").get(assetId) as Row | undefined;
    return r ? ((r.k as string) ?? null) : null;
  }
  /** Newest first; cursor = seq of the last item of the previous page. */
  jobIdsPage(keyId: string, states: JobState[] | null, cursor: number | null, limit: number): { ids: string[]; nextCursor: number | null } {
    const args: (string | number)[] = [keyId];
    let where = "api_key_id=?";
    if (states?.length) {
      where += ` AND state IN (${states.map(() => "?").join(",")})`;
      args.push(...states);
    }
    if (cursor !== null) {
      where += " AND seq < ?";
      args.push(cursor);
    }
    const rows = this.db.prepare(`SELECT id, seq FROM jobs WHERE ${where} ORDER BY seq DESC LIMIT ?`).all(...args, limit + 1) as Row[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { ids: page.map((r) => String(r.id)), nextCursor: more ? Number(page[page.length - 1].seq) : null };
  }
}
