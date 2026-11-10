import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { BRAND } from "../../shared/brand";
import { originOf } from "../../shared/api/oauth";
import { isOAuthPath, type OAuthHttp } from "./oauth/http";
import { API_CHAT_JSON_MAX_BYTES,
  API_AUTH_FAIL_DELAY_MS,
  API_HEADERS_TIMEOUT_MS,
  API_JSON_MAX_BYTES,
  API_KEEPALIVE_TIMEOUT_MS,
  API_MAX_CONNECTIONS,
  API_MAX_HEADER_BYTES,
  API_MCP_MAX_BYTES,
  API_REQUEST_TIMEOUT_MS,
  API_UPLOAD_MAX_BYTES,
  INGRESS_HEADER,
  SELFCHECK_HEADER,
  type ApiBucket,
} from "../../shared/api/constants";
import { API_STATUSES, type ApiJobStatus } from "../../shared/api/jobView";
import { bearerToken } from "../../shared/api/keys";
import { checkHost, isLoopback, isPrivateSource, maskIp, type HostPolicy } from "../../shared/api/netPolicy";
import { ApiError, toProblem } from "../../shared/api/problem";
import { getLocale, localeFromAcceptLanguage, type Locale } from "../../shared/i18n";
import { runWithApiLocale } from "./requestLocale";

const headerText = (h: string | string[] | undefined): string | undefined => (Array.isArray(h) ? h.join(",") : h);
import type { RateLimiter } from "../../shared/api/rateLimit";
import { bodyRequestId, checkIdempotencyKey, limitParam, waitParam } from "../../shared/api/schemas";
import type { ApiAccess, ApiDomainProxy } from "../../shared/types";
import type { McpHandler } from "./mcp";
import type { ApiService, KeyCtx } from "./service";
import type { ApiStore, RequestRecord } from "./store";

// The agent API HTTP server (spec §4.8, R23–R33). node:http only — no framework, no CORS, JSON or file bodies.

export interface ServerPolicy {
  access: ApiAccess;
  port: number;
  /** Names accepted with the port: loopback names plus (LAN mode) this machine's addresses. */
  localNames: string[];
  machineName: string | null;
  /** Current tunnel hostnames (accepted without port). */
  publicHosts: string[];
  /** R34 — the domain pointing at this machine (accepted without port) while it is enabled. */
  domainHosts?: string[];
  domainProxy?: ApiDomainProxy;
  /** Managed Caddy: ingress marker of the running Caddy (null while none runs → domain requests refused). */
  domainMarker?: string | null;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface ApiServerDeps {
  service: ApiService;
  mcp: McpHandler;
  store: ApiStore;
  limiter: RateLimiter<ApiBucket>;
  authenticate: (token: string, base: string) => KeyCtx | null;
  /** The app's own OAuth 2.1 server (R131–R141); absent while the API is off. */
  oauth?: OAuthHttp;
  policy: () => ServerPolicy;
  instanceId: string;
  /** Per-run secret sent by the app's own health checks (tunnel, domain); such checks are not logged. */
  selfCheckToken?: string;
  now: () => number;
  openapi: () => unknown;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
  failDelayMs?: number;
}

interface Route {
  template: string;
  methods: string[];
  auth: "none" | "key" | "key-or-signature";
  match: RegExp;
}

const ROUTES: Route[] = [
  { template: "/v1/health", methods: ["GET", "HEAD"], auth: "none", match: /^\/v1\/health$/ },
  { template: "/v1/openapi.json", methods: ["GET"], auth: "none", match: /^\/v1\/openapi\.json$/ },
  { template: "/v1/status", methods: ["GET"], auth: "key", match: /^\/v1\/status$/ },
  { template: "/v1/jobs", methods: ["GET", "POST"], auth: "key", match: /^\/v1\/jobs$/ },
  { template: "/v1/jobs/{id}", methods: ["GET"], auth: "key", match: /^\/v1\/jobs\/([^/]+)$/ },
  { template: "/v1/jobs/{id}/cancel", methods: ["POST"], auth: "key", match: /^\/v1\/jobs\/([^/]+)\/cancel$/ },
  { template: "/v1/references", methods: ["POST"], auth: "key", match: /^\/v1\/references$/ },
  { template: "/v1/assets/{id}/content", methods: ["GET", "HEAD"], auth: "key-or-signature", match: /^\/v1\/assets\/([^/]+)\/content$/ },
  { template: "/v1/assets/{id}/extend", methods: ["POST"], auth: "key", match: /^\/v1\/assets\/([^/]+)\/extend$/ },
  { template: "/v1/conversations/{id}", methods: ["GET"], auth: "key", match: /^\/v1\/conversations\/([^/]+)$/ },
  { template: "/v1/conversations/{id}/extend", methods: ["POST"], auth: "key", match: /^\/v1\/conversations\/([^/]+)\/extend$/ },
  { template: "/v1/extend-chains/{id}", methods: ["GET"], auth: "key", match: /^\/v1\/extend-chains\/([^/]+)$/ },
  { template: "/v1/extend-chains/{id}/cancel", methods: ["POST"], auth: "key", match: /^\/v1\/extend-chains\/([^/]+)\/cancel$/ },
  { template: "/mcp", methods: ["POST", "GET", "DELETE"], auth: "key", match: /^\/mcp$/ },
];

const COMMON_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

interface Ctx {
  requestId: string;
  started: number;
  keyId: string | null;
  code: string | null;
  route: string;
  via: RequestRecord["via"];
  ip: string;
  /** R122: language of `detail` in problems — the caller's Accept-Language, else the app language. */
  locale: Locale;
  /** Set when a 401 should carry a richer `WWW-Authenticate` — the OAuth discovery pointer (RFC 9728 §5.1). */
  challenge?: string;
}

export class ApiServer {
  private server: http.Server | null = null;
  private sockets = new Set<Socket>();
  private boundHost: string | null = null;
  private boundPort: number | null = null;

  constructor(private d: ApiServerDeps) {}

  get listening(): boolean {
    return !!this.server?.listening;
  }

  address(): { host: string; port: number } | null {
    return this.server?.listening && this.boundHost !== null && this.boundPort !== null ? { host: this.boundHost, port: this.boundPort } : null;
  }

  /** Binds to `host:port`. Rejects with the Node error (code EADDRINUSE/EACCES) on failure. */
  listen(host: string, port: number): Promise<void> {
    if (this.server) return Promise.reject(new Error("already listening"));
    const server = http.createServer({ maxHeaderSize: API_MAX_HEADER_BYTES, requestTimeout: API_REQUEST_TIMEOUT_MS, headersTimeout: API_HEADERS_TIMEOUT_MS }, (req, res) => {
      void this.handle(req, res);
    });
    server.keepAliveTimeout = API_KEEPALIVE_TIMEOUT_MS;
    server.maxConnections = API_MAX_CONNECTIONS;
    server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    server.on("clientError", (_e, socket) => {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      else socket.destroy();
    });
    return new Promise((resolve, reject) => {
      const onError = (e: Error) => {
        server.removeListener("listening", onListening);
        reject(e);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        server.on("error", (e) => this.d.log("error", "api server error", { error: String(e) }));
        this.server = server;
        this.boundHost = host;
        this.boundPort = (server.address() as { port: number }).port;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host, port, exclusive: true, ipv6Only: false });
    });
  }

  /** Closes the port and drops every open connection (R23: off means off, ≤ 3 s). */
  close(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.boundHost = null;
    this.boundPort = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => {
      s.close(() => resolve());
      for (const sock of this.sockets) sock.destroy();
      this.sockets.clear();
      s.closeAllConnections?.();
    });
  }

  // ================================================================ request pipeline
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress ?? "";
    const c: Ctx = { requestId: randomBytes(6).toString("hex"), started: Date.now(), keyId: null, code: null, route: "(unknown)", via: isLoopback(remote) ? "local" : "lan", ip: remote, locale: localeFromAcceptLanguage(headerText(req.headers["accept-language"])) ?? getLocale() };
    res.on("finish", () => this.record(req, res, c));
    res.on("close", () => {
      if (!res.writableFinished) this.record(req, res, c);
    });
    try {
      await runWithApiLocale(c.locale, () => this.pipeline(req, res, c));
    } catch (e) {
      const err = e instanceof ApiError ? e : this.internal(e, c);
      if (!res.headersSent) this.problem(res, c, err);
      else res.destroy();
    }
  }

  private internal(e: unknown, c: Ctx): ApiError {
    this.d.log("error", "api request failed", { requestId: c.requestId, route: c.route, error: String((e as Error)?.stack ?? e) });
    return new ApiError(500, "internal_error", "Lỗi bên trong Muse4AI — xem nhật ký của app");
  }

  private async pipeline(req: IncomingMessage, res: ServerResponse, c: Ctx): Promise<void> {
    const policy = this.d.policy();
    // R29 — LAN mode accepts private sources only (the other modes bind to loopback).
    if (policy.access === "lan" && !isPrivateSource(c.ip)) throw new ApiError(403, "forbidden_network", "Chỉ nhận lời gọi từ mạng riêng (LAN, Tailscale)");
    // R33 — browsers are refused and no CORS headers are ever sent. The Origin rule itself runs
    // once `base` is known below, so only this app's own consent page can ever pass it.
    if (req.method === "OPTIONS") throw new ApiError(403, "origin_forbidden", "Không hỗ trợ CORS/OPTIONS");
    const hostPolicy: HostPolicy = { port: policy.port, local: policy.localNames, public: policy.publicHosts, domain: policy.domainHosts ?? [], machineName: policy.access === "lan" ? policy.machineName : null };
    const verdict = checkHost(req.headers.host, hostPolicy);
    if (!verdict.ok) throw new ApiError(421, "misdirected_request", "Tên máy (Host) không đúng địa chỉ của Muse4AI");
    if (verdict.via === "public") {
      c.via = "tunnel";
      const cf = req.headers["cf-connecting-ip"];
      if (typeof cf === "string" && cf) c.ip = cf; // logging only (R33)
    } else if (verdict.via === "domain") {
      // R33 rev 5 — with the app's Caddy the request must carry this run's ingress marker (Caddy overwrites what a client sends).
      if (policy.domainProxy !== "external") {
        const m = req.headers[INGRESS_HEADER];
        if (!policy.domainMarker || typeof m !== "string" || !sameSecret(m, policy.domainMarker)) throw new ApiError(421, "misdirected_request", "Tên máy (Host) không đúng địa chỉ của Muse4AI");
      }
      c.via = "domain";
      const xff = req.headers["x-forwarded-for"];
      const last = typeof xff === "string" ? xff.split(",").pop()?.trim() : undefined;
      if (last) c.ip = last; // logging only (R31/R33)
    }
    const url = new URL(req.url ?? "/", "http://placeholder");
    const base = verdict.via === "public" || verdict.via === "domain" ? `https://${req.headers.host}` : `http://${req.headers.host}`;
    // R33 holds: a page from another site is still refused — only this app's own origin (the consent
    // page it serves itself) may carry an Origin header.
    if (req.headers.origin !== undefined && originOf(req.headers.origin) !== originOf(base))
      throw new ApiError(403, "origin_forbidden", "Không nhận lời gọi từ trình duyệt (có header Origin)");
    // The app's own OAuth 2.1 server answers its protocol routes before any API-key check (R131–R141).
    if (this.d.oauth && isOAuthPath(url.pathname)) {
      c.route = `oauth ${url.pathname}`;
      if (await this.d.oauth.handle(req, res, url, base, c.locale, (r, s, max) => this.readBody(r, s, max, "body_too_large", "Thân yêu cầu quá lớn"))) return;
    }
    const route = ROUTES.find((r) => r.match.test(url.pathname));
    let key: KeyCtx | null = null;
    if (route) c.route = route.template;

    if (!route || route.auth !== "none") {
      // Signed download links work without a key (R32); everything else needs the bearer key (R24).
      const isSigned = route?.auth === "key-or-signature" && req.headers.authorization === undefined && url.searchParams.has("sig");
      if (!isSigned) {
        key = await this.auth(req, c, base);
        c.keyId = key.id;
      }
    }
    if (!route) throw new ApiError(404, "not_found", "Không có đường dẫn này — xem /v1/openapi.json");
    const method = req.method ?? "GET";
    if (!route.methods.includes(method)) {
      res.setHeader("Allow", route.methods.join(", "));
      throw new ApiError(405, "method_not_allowed", `Đường dẫn này chỉ nhận ${route.methods.join(", ")}`);
    }
    const id = decodeURIComponent(route.match.exec(url.pathname)?.[1] ?? "");

    switch (route.template) {
      case "/v1/health": {
        // The app's own tunnel/domain checks run every minute — not agent calls, so they stay out of the log.
        const self = req.headers[SELFCHECK_HEADER];
        if (this.d.selfCheckToken && typeof self === "string" && sameSecret(self, this.d.selfCheckToken)) (c as Ctx & { logged?: boolean }).logged = true;
        return this.json(res, 200, { ok: true, service: BRAND.id, instance: this.d.instanceId }, method === "HEAD");
      }
      case "/v1/openapi.json":
        return this.json(res, 200, this.d.openapi());
      case "/v1/status":
        this.take(key!, "read");
        return this.json(res, 200, this.d.service.status(key!));
      case "/v1/jobs":
        if (method === "POST") {
          this.take(key!, "create");
          const idem = checkIdempotencyKey(req.headers["idempotency-key"]);
          // R109: a chat body may be up to 256 KB; image/video bodies keep the 64 KB limit.
          const { value: body, bytes } = await this.readJsonSized(req, API_CHAT_JSON_MAX_BYTES, "Thân JSON lớn hơn 256 KB");
          if (bytes > API_JSON_MAX_BYTES && (body as { kind?: unknown } | null)?.kind !== "chat") throw new ApiError(413, "body_too_large", "Thân JSON lớn hơn 64 KB");
          const { body: rest, idem: key2 } = bodyRequestId(body, idem);
          const r = await this.d.service.createJobs(key!, rest, key2, base);
          res.setHeader("Location", `/v1/jobs/${r.jobs[0].id}`);
          if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
          return this.json(res, 202, { jobs: r.jobs });
        } else {
          this.take(key!, "read");
          const status = url.searchParams.get("status");
          if (status !== null && !API_STATUSES.includes(status as ApiJobStatus)) throw new ApiError(400, "invalid_request", `\`status\` chỉ nhận ${API_STATUSES.join(", ")}`);
          const page = this.d.service.listJobs(key!, { status: (status as ApiJobStatus) ?? null, limit: limitParam(url.searchParams.get("limit"), 20), cursor: url.searchParams.get("cursor"), base });
          return this.json(res, 200, page);
        }
      case "/v1/jobs/{id}": {
        this.take(key!, "read");
        const waitS = waitParam(url.searchParams.get("wait"));
        const av = url.searchParams.get("after_version");
        if (av !== null && !/^\d{1,15}$/.test(av)) throw new ApiError(400, "invalid_request", "`after_version` phải là số nguyên");
        const gone = disconnectSignal(res);
        try {
          const job = await this.d.service.getJob(key!, id, { waitS, afterVersion: av === null ? null : Number(av), base, signal: gone.signal });
          if (res.destroyed) return;
          return this.json(res, 200, job);
        } finally {
          gone.dispose();
        }
      }
      case "/v1/jobs/{id}/cancel":
        this.take(key!, "read");
        await this.drain(req, API_JSON_MAX_BYTES);
        return this.json(res, 200, this.d.service.cancel(key!, id, base));
      case "/v1/references": {
        this.take(key!, "upload");
        const ct = String(req.headers["content-type"] ?? "").toLowerCase();
        if (ct && !/^(image\/(png|jpeg|webp)|video\/mp4|application\/octet-stream|text\/(csv|plain|markdown)|application\/(json|pdf))\b/.test(ct)) {
          throw new ApiError(415, "unsupported_media_type", "Chỉ nhận PNG, JPEG, WEBP, MP4 hoặc tài liệu CSV, TXT, MD, JSON, PDF (gửi byte tệp làm thân yêu cầu)");
        }
        // Build 2.0 R109 — optional X-File-Name (UTF-8, percent-encoded); it is sanitized like R82 before use.
        let fileName: string | null = null;
        const xf = req.headers["x-file-name"];
        if (typeof xf === "string" && xf) {
          try {
            fileName = decodeURIComponent(xf).slice(0, 300);
          } catch {
            throw new ApiError(400, "invalid_request", "X-File-Name phải là UTF-8 mã hoá phần trăm");
          }
        }
        const bytes = await this.readBody(req, res, API_UPLOAD_MAX_BYTES, "upload_too_large", "Tệp tham chiếu lớn hơn 20 MB");
        if (!bytes.length) throw new ApiError(400, "invalid_request", "Thân yêu cầu rỗng — gửi byte tệp");
        const out = await this.d.service.uploadReference(key!, bytes, fileName);
        return this.json(res, 201, out);
      }
      case "/v1/assets/{id}/content": {
        let asset;
        if (key) {
          this.take(key, "read");
          asset = this.d.service.assetForKey(key, id);
        } else {
          const r = this.d.service.assetForSignature(id, { exp: url.searchParams.get("exp"), kid: url.searchParams.get("kid"), sig: url.searchParams.get("sig") });
          c.keyId = r.keyId;
          this.takeSubject(r.keyId, "read");
          asset = r.asset;
        }
        return this.sendFile(req, res, asset.path, asset.mime, asset.sha256, method === "HEAD");
      }
      case "/v1/assets/{id}/extend": {
        // R53 (5): one “create” token per call, like POST /v1/jobs.
        this.take(key!, "create");
        const idem = checkIdempotencyKey(req.headers["idempotency-key"]);
        const body = await this.readJson(req);
        const r = this.d.service.extend(key!, id, body, idem, base);
        res.setHeader("Location", `/v1/extend-chains/${r.chain.id}`);
        if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
        return this.json(res, 202, { chain: r.chain, jobs: r.jobs });
      }
      case "/v1/conversations/{id}":
        this.take(key!, "read");
        return this.json(res, 200, this.d.service.conversation(key!, id, base));
      case "/v1/conversations/{id}/extend": {
        // rev 7.1 R65: same “create” token and idempotency as POST /v1/assets/{id}/extend.
        this.take(key!, "create");
        const idem = checkIdempotencyKey(req.headers["idempotency-key"]);
        const body = await this.readJson(req);
        const r = this.d.service.extendConversation(key!, id, body, idem, base);
        res.setHeader("Location", `/v1/extend-chains/${r.chain.id}`);
        if (r.replayed) res.setHeader("Idempotent-Replayed", "true");
        return this.json(res, 202, { chain: r.chain, jobs: r.jobs });
      }
      case "/v1/extend-chains/{id}": {
        this.take(key!, "read");
        const waitS = waitParam(url.searchParams.get("wait"));
        const gone = disconnectSignal(res);
        try {
          const chain = await this.d.service.getChain(key!, id, { waitS, base, signal: gone.signal });
          if (res.destroyed) return;
          return this.json(res, 200, chain);
        } finally {
          gone.dispose();
        }
      }
      case "/v1/extend-chains/{id}/cancel":
        this.take(key!, "read");
        await this.drain(req, API_JSON_MAX_BYTES);
        return this.json(res, 200, this.d.service.cancelChain(key!, id, base));
      case "/mcp": {
        // Rate limits are charged inside the MCP handler, once per request (read) or per tool bucket (R28).
        const gone = disconnectSignal(res);
        const body = method === "POST" ? await this.readBody(req, res, API_MCP_MAX_BYTES, "body_too_large", "Yêu cầu MCP quá lớn") : Buffer.alloc(0);
        try {
          const r = await this.d.mcp.handle({ method, headers: req.headers, body, ctx: key!, base, signal: gone.signal });
          if (r.logCode) c.code = r.logCode;
          if (res.destroyed) return;
          for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
          if (r.json === undefined) {
            this.common(res);
            res.writeHead(r.status);
            res.end();
            return;
          }
          return this.json(res, r.status, r.json);
        } finally {
          gone.dispose();
        }
      }
    }
    throw new ApiError(404, "not_found", "Không có đường dẫn này");
  }

  // ================================================================ helpers
  private async auth(req: IncomingMessage, c: Ctx, base: string): Promise<KeyCtx> {
    const token = bearerToken(req.headers.authorization);
    const key = token ? this.d.authenticate(token, base) : null;
    if (key) return key;
    await new Promise((r) => setTimeout(r, this.d.failDelayMs ?? API_AUTH_FAIL_DELAY_MS));
    c.code = "invalid_api_key";
    // A client with no usable token is pointed at the metadata document so it can start OAuth (RFC 9728 §5.1).
    if (this.d.oauth && c.route === "/mcp") c.challenge = this.d.oauth.challenge(base, token ? "invalid_token" : "missing_token");
    throw new ApiError(401, "invalid_api_key", token ? "Khoá API sai hoặc đã bị thu hồi" : "Thiếu khoá API — gửi header Authorization: Bearer msk_…");
  }

  private take(key: KeyCtx, bucket: ApiBucket): void {
    this.takeSubject(key.id, bucket);
  }

  private takeSubject(subject: string, bucket: ApiBucket): void {
    const r = this.d.limiter.take(subject, bucket, this.d.now());
    if (!r.ok) throw new ApiError(429, "rate_limited", `Gọi quá nhanh — thử lại sau ${r.retryAfterS} giây`, { retryAfterS: r.retryAfterS });
  }

  private async readJsonSized(req: IncomingMessage, max: number, detail: string): Promise<{ value: unknown; bytes: number }> {
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", "Content-Type phải là application/json");
    const buf = await this.readBody(req, null, max, "body_too_large", detail);
    if (!buf.length) throw new ApiError(400, "invalid_request", "Thân yêu cầu rỗng");
    try {
      return { value: JSON.parse(buf.toString("utf8")), bytes: buf.length };
    } catch {
      throw new ApiError(400, "invalid_request", "Thân yêu cầu không phải JSON hợp lệ");
    }
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", "Content-Type phải là application/json");
    const buf = await this.readBody(req, null, API_JSON_MAX_BYTES, "body_too_large", "Thân JSON lớn hơn 64 KB");
    if (!buf.length) throw new ApiError(400, "invalid_request", "Thân yêu cầu rỗng");
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      throw new ApiError(400, "invalid_request", "Thân yêu cầu không phải JSON hợp lệ");
    }
  }

  private readBody(req: IncomingMessage, res: ServerResponse | null, max: number, code: "upload_too_large" | "body_too_large", detail: string): Promise<Buffer> {
    const tooBig = () => new ApiError(413, code, detail);
    // A body somewhat over the limit is read to the end and discarded before the 413, so the client is not cut off
    // mid-upload (EPIPE / connection reset instead of a readable error); far larger bodies are refused at once.
    const drainCap = max * 2;
    const declared = Number(req.headers["content-length"] ?? NaN);
    if (Number.isFinite(declared) && declared > drainCap) {
      res?.setHeader("Connection", "close");
      req.resume();
      return Promise.reject(tooBig());
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(e);
      };
      req.on("data", (ch: Buffer) => {
        if (settled) return;
        size += ch.length;
        if (size > drainCap) {
          res?.setHeader("Connection", "close");
          req.pause();
          fail(tooBig());
          return;
        }
        if (size <= max) chunks.push(ch);
        else chunks.length = 0; // over the limit: keep draining, keep nothing
      });
      req.on("end", () => {
        if (settled) return;
        if (size > max) return fail(tooBig());
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      req.on("error", (e) => fail(e));
    });
  }

  private async drain(req: IncomingMessage, max: number): Promise<void> {
    await this.readBody(req, null, max, "body_too_large", "Thân yêu cầu quá lớn");
  }

  private common(res: ServerResponse): void {
    for (const [k, v] of Object.entries(COMMON_HEADERS)) res.setHeader(k, v);
  }

  private json(res: ServerResponse, status: number, body: unknown, headOnly = false): void {
    const data = Buffer.from(JSON.stringify(body), "utf8");
    this.common(res);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(data.length) });
    res.end(headOnly ? undefined : data);
  }

  private problem(res: ServerResponse, c: Ctx, e: ApiError): void {
    c.code = e.code;
    if (e.status === 401) res.setHeader("WWW-Authenticate", c.challenge ?? `Bearer realm="${BRAND.id}"`);
    if (e.extra.retryAfterS) res.setHeader("Retry-After", String(e.extra.retryAfterS));
    const data = Buffer.from(JSON.stringify(toProblem(e, c.requestId, c.locale)), "utf8");
    this.common(res);
    res.setHeader("X-Request-Id", c.requestId);
    res.writeHead(e.status, { "Content-Type": "application/problem+json; charset=utf-8", "Content-Length": String(data.length) });
    res.end(data);
  }

  /** ETag = sha256; single `Range` → 206/416 (AC-API-09). */
  private sendFile(req: IncomingMessage, res: ServerResponse, file: string, mime: string, sha256: string, headOnly: boolean): void {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      throw new ApiError(410, "asset_gone", "Tệp đã bị xoá hoặc di chuyển trên máy");
    }
    const etag = `"${sha256}"`;
    this.common(res);
    res.setHeader("ETag", etag);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mime);
    const base = path.basename(file);
    const ascii = base.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const size = st.size;
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = req.headers.range;
    if (typeof range === "string" && range.startsWith("bytes=") && !range.includes(",")) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === "" && m[2] === "")) {
        res.setHeader("Content-Range", `bytes */${size}`);
        res.writeHead(416);
        res.end();
        return;
      }
      if (m[1] === "") {
        const n = Number(m[2]);
        start = Math.max(0, size - n);
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || start > end) {
        res.setHeader("Content-Range", `bytes */${size}`);
        res.writeHead(416);
        res.end();
        return;
      }
      status = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.writeHead(status, { "Content-Length": String(end - start + 1) });
    if (headOnly) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  private record(req: IncomingMessage, res: ServerResponse, c: Ctx): void {
    if ((c as Ctx & { logged?: boolean }).logged) return;
    (c as Ctx & { logged?: boolean }).logged = true;
    try {
      this.d.store.insertRequest({
        ts: this.d.now(),
        keyId: c.keyId,
        method: req.method ?? "?",
        route: c.route,
        status: res.writableFinished ? res.statusCode : 499,
        durationMs: Date.now() - c.started,
        code: c.code,
        ipMasked: maskIp(c.ip) || null,
        via: c.via,
      });
    } catch (e) {
      this.d.log("warn", "api request log write failed", { error: String(e) });
    }
  }
}

/**
 * Aborts when the client goes away before we answered. `res` "close" (not `req` "close", which only means the request
 * body was read) fires on disconnect or after the response finished — only the first case counts.
 */
export function disconnectSignal(res: ServerResponse): { signal: AbortSignal; dispose: () => void } {
  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) ac.abort();
  };
  if (res.destroyed || res.socket?.destroyed) ac.abort();
  else res.on("close", onClose);
  return { signal: ac.signal, dispose: () => res.off("close", onClose) };
}
