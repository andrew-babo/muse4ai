import { createHash } from "node:crypto";
import { BRAND } from "../../shared/brand";
import type { IncomingHttpHeaders } from "node:http";
import { API_MCP_REF_MAX_BYTES, MCP_DEFAULT_LEGACY, MCP_LATEST_LEGACY, type ApiBucket } from "../../shared/api/constants";
import type { ApiChain, ApiJob } from "../../shared/api/jobView";
import {
  ALL_VERSIONS,
  decodeHeaderValue,
  isLegacyVersion,
  isModernVersion,
  isValidId,
  JSONRPC,
  looksModern,
  META_CLIENT_CAPS,
  META_SERVER_INFO,
  META_VERSION,
  rpcError,
  rpcResult,
  SERVER_INSTRUCTIONS,
  supportsStructured,
  toolsFor,
  TOOLS,
  type RpcRequest,
} from "../../shared/api/mcpProtocol";
import { ApiError, problemDetail } from "../../shared/api/problem";
import { GUIDE_RESOURCE, skillBody } from "@content/skill";
import { getLocale, localeFromAcceptLanguage, type Locale } from "../../shared/i18n";

const headerText = (h: string | string[] | undefined): string | undefined => (Array.isArray(h) ? h.join(",") : h);

/** MCP "Resource not found" error code. */
const RESOURCE_NOT_FOUND = -32002;

/** Build 3.0 AC-MCP-02: the Agent Skill body as a read-only resource; the tool list is unchanged. */
function guideResource() {
  return { ...GUIDE_RESOURCE };
}

function readResource(params: Record<string, unknown> | undefined): { result: Record<string, unknown> } | { error: string } {
  const uri = params?.uri;
  if (uri !== GUIDE_RESOURCE.uri) return { error: `Unknown resource: ${typeof uri === "string" ? uri.slice(0, 200) : String(uri)}` };
  return { result: { contents: [{ uri: GUIDE_RESOURCE.uri, mimeType: GUIDE_RESOURCE.mimeType, text: skillBody() }] } };
}
import { sniffImageMime } from "../../shared/validate";
import { mcpCancelSchema, mcpChatSchema, mcpExtendSchema, mcpGenerateSchema, mcpGetExtendSchema, mcpGetJobSchema, mcpListSchema, mcpStatusSchema, parseOrThrow } from "../../shared/api/schemas";
import { MCP_INLINE_FILES_MAX, MCP_INLINE_TOTAL_MAX } from "../../shared/chat";
import type { ApiService, KeyCtx } from "./service";

// MCP Streamable HTTP endpoint (spec §4.8): JSON responses only (no SSE), stateless, two protocol eras.

export interface McpHttpRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  ctx: KeyCtx;
  base: string;
  signal: AbortSignal;
}

export interface McpHttpResponse {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  /** Error code for the request log (R31): JSON-RPC error name or the tool's API error code. */
  logCode?: string;
}

const RPC_LOG_CODE: Record<number, string> = {
  [-32700]: "parse_error",
  [-32600]: "invalid_request",
  [-32601]: "method_not_found",
  [-32602]: "invalid_params",
  [-32603]: "internal_error",
  [-32020]: "header_mismatch",
  [-32022]: "unsupported_protocol_version",
};

/** JSON-RPC error response, tagged for the request log. */
function rpcFail(status: number, id: unknown, code: number, message: string, data?: unknown, headers?: Record<string, string>): McpHttpResponse {
  return { status, headers, json: rpcError(id as never, code, message, data), logCode: RPC_LOG_CODE[code] ?? `rpc_${code}` };
}

const h1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export class McpHandler {
  constructor(
    private d: {
      service: ApiService;
      version: string;
      /** Throws ApiError(429) when the key's bucket is empty. */
      take: (ctx: KeyCtx, bucket: ApiBucket) => void;
    },
  ) {}

  private serverInfo() {
    return { name: BRAND.id, title: BRAND.name, version: this.d.version };
  }

  async handle(req: McpHttpRequest): Promise<McpHttpResponse> {
    if (req.method !== "POST") return rpcFail(405, null, JSONRPC.INVALID_REQUEST, "Method not allowed: this server does not offer an SSE stream or sessions (use POST)", undefined, { Allow: "POST" });
    const ct = (h1(req.headers["content-type"]) ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) return rpcFail(415, null, JSONRPC.INVALID_REQUEST, "Content-Type must be application/json");
    const accept = (h1(req.headers.accept) ?? "").toLowerCase();
    if (accept && !accept.includes("application/json") && !accept.includes("*/*")) return rpcFail(406, null, JSONRPC.INVALID_REQUEST, "Accept must include application/json (this server answers with JSON, not SSE)");

    let msg: unknown;
    try {
      msg = JSON.parse(req.body.toString("utf8"));
    } catch {
      return rpcFail(400, null, JSONRPC.PARSE_ERROR, "Parse error");
    }
    const headerVersion = h1(req.headers["mcp-protocol-version"]);
    if (Array.isArray(msg)) {
      // JSON-RPC batches exist only in 2025-03-26 (no MCP-Protocol-Version header back then); later revisions removed them.
      if (headerVersion !== undefined && headerVersion !== "2025-03-26") return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "Batch requests are not supported in this protocol version");
      if (msg.length === 0 || msg.length > 32) return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "A batch must hold 1–32 messages");
      if (msg.some((x) => x && typeof x === "object" && (x as RpcRequest).method === "initialize")) return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "initialize must not be part of a batch");
      const replies: unknown[] = [];
      const codes: string[] = [];
      for (const item of msg) {
        const r = await this.message(req, item, headerVersion);
        if (r.json !== undefined) replies.push(r.json);
        if (r.logCode) codes.push(r.logCode);
      }
      return replies.length ? { status: 200, json: replies, logCode: codes[0] } : { status: 202, logCode: codes[0] };
    }
    return this.message(req, msg, headerVersion);
  }

  /** One JSON-RPC message (a whole POST body, or one element of a 2025-03-26 batch). */
  private async message(req: McpHttpRequest, msg: unknown, headerVersion: string | undefined): Promise<McpHttpResponse> {
    if (!msg || typeof msg !== "object" || (msg as RpcRequest).jsonrpc !== "2.0") return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "Invalid JSON-RPC message");
    const m = msg as RpcRequest & { result?: unknown; error?: unknown };

    // A JSON-RPC response sent by the client (we never send server→client requests, so there is nothing to match it to).
    if (m.method === undefined) {
      const wellFormed = isValidId(m.id) && ("result" in m) !== ("error" in m);
      if (!wellFormed) return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "Invalid JSON-RPC message: needs a method, or an id with exactly one of result/error");
      if (looksModern(headerVersion)) return rpcFail(400, m.id, JSONRPC.INVALID_REQUEST, "Clients must not send JSON-RPC responses in this protocol version");
      return { status: 202 };
    }
    if (typeof m.method !== "string") return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "Invalid method");
    if (m.id !== undefined && !isValidId(m.id)) return rpcFail(400, null, JSONRPC.INVALID_REQUEST, "Invalid id");
    if (m.params !== undefined && (typeof m.params !== "object" || m.params === null || Array.isArray(m.params))) {
      return rpcFail(400, m.id ?? null, JSONRPC.INVALID_PARAMS, "params must be an object");
    }
    const meta = (m.params?._meta ?? undefined) as Record<string, unknown> | undefined;
    const metaVersion = meta && typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : undefined;
    const modern = metaVersion !== undefined || looksModern(headerVersion);

    // Notification: nothing to answer, but a modern message must still carry matching headers (HTTP 400 + -32020 otherwise).
    if (m.id === undefined) {
      if (modern) {
        const bad = this.modernHeaderError(req, m, headerVersion, metaVersion);
        if (bad) return rpcFail(400, null, bad.code, bad.message, bad.data);
      }
      return { status: 202 };
    }
    // R28: one read token per MCP request; tools/call is charged by its own tool bucket instead (never both).
    if (m.method !== "tools/call") this.d.take(req.ctx, "read");
    return modern ? this.modern(req, m, headerVersion, metaVersion, meta) : this.legacy(req, m, headerVersion);
  }

  /** Header checks shared by modern requests and notifications. */
  private modernHeaderError(req: McpHttpRequest, m: RpcRequest, headerVersion: string | undefined, metaVersion: string | undefined): { code: number; message: string; data?: unknown } | null {
    if (!headerVersion) return { code: JSONRPC.HEADER_MISMATCH, message: "Missing MCP-Protocol-Version header" };
    if (metaVersion === undefined) return { code: JSONRPC.INVALID_PARAMS, message: `Missing params._meta["${META_VERSION}"]` };
    if (headerVersion !== metaVersion) return { code: JSONRPC.HEADER_MISMATCH, message: "MCP-Protocol-Version header does not match params._meta protocolVersion" };
    if (!isModernVersion(metaVersion)) return { code: JSONRPC.UNSUPPORTED_VERSION, message: "Unsupported protocol version", data: { supported: ALL_VERSIONS, requested: metaVersion } };
    const methodHeader = decodeHeaderValue(h1(req.headers["mcp-method"]));
    if (methodHeader !== m.method) return { code: JSONRPC.HEADER_MISMATCH, message: "Mcp-Method header does not match the request body" };
    if (m.method === "tools/call") {
      const nameHeader = decodeHeaderValue(h1(req.headers["mcp-name"]));
      if (nameHeader === undefined || nameHeader !== (m.params as { name?: unknown } | undefined)?.name) return { code: JSONRPC.HEADER_MISMATCH, message: "Mcp-Name header does not match params.name" };
    }
    return null;
  }

  // ---------------------------------------------------------------- 2026-07-28
  private async modern(req: McpHttpRequest, m: RpcRequest, headerVersion: string | undefined, metaVersion: string | undefined, meta: Record<string, unknown> | undefined): Promise<McpHttpResponse> {
    const bad = (code: number, message: string, data?: unknown) => rpcFail(400, m.id, code, message, data);
    const headerErr = this.modernHeaderError(req, m, headerVersion, metaVersion);
    if (headerErr) return bad(headerErr.code, headerErr.message, headerErr.data);
    if (!meta || typeof meta[META_CLIENT_CAPS] !== "object" || meta[META_CLIENT_CAPS] === null) return bad(JSONRPC.INVALID_PARAMS, `Missing params._meta["${META_CLIENT_CAPS}"]`);
    const version = metaVersion as string;
    const done = (result: Record<string, unknown>) => ({ status: 200, json: rpcResult(m.id, { resultType: "complete", ...result }) });
    switch (m.method) {
      case "server/discover":
        return done({
          supportedVersions: ALL_VERSIONS,
          capabilities: { tools: {}, resources: {} },
          _meta: { [META_SERVER_INFO]: this.serverInfo() },
          instructions: SERVER_INSTRUCTIONS,
          ttlMs: 3_600_000,
          cacheScope: "public",
        });
      case "ping":
        return done({});
      case "tools/list":
        return done({ tools: toolsFor(version, req.ctx.scope === "generate") });
      case "resources/list":
        return done({ resources: [guideResource()] });
      case "resources/read": {
        const r = readResource(m.params);
        return "error" in r ? bad(RESOURCE_NOT_FOUND, r.error) : done(r.result);
      }
      case "tools/call": {
        const r = await this.callTool(req, m, version);
        return "error" in r ? rpcFail(r.status, m.id, r.error.code, r.error.message) : { ...done(r.result), logCode: r.logCode };
      }
      default:
        return rpcFail(404, m.id, JSONRPC.METHOD_NOT_FOUND, `Method not found: ${m.method}`);
    }
  }

  // ---------------------------------------------------------------- 2025-11-25 / 2025-06-18 / 2025-03-26
  private async legacy(req: McpHttpRequest, m: RpcRequest, headerVersion: string | undefined): Promise<McpHttpResponse> {
    const ok = (result: unknown) => ({ status: 200, json: rpcResult(m.id, result) });
    if (m.method === "initialize") {
      const requested = (m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const version = typeof requested === "string" && isLegacyVersion(requested) ? requested : MCP_LATEST_LEGACY;
      return ok({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: supportsStructured(version) ? this.serverInfo() : { name: BRAND.id, version: this.d.version },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    if (headerVersion !== undefined && !isLegacyVersion(headerVersion)) {
      return rpcFail(400, m.id, JSONRPC.INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${headerVersion}`, { supported: ALL_VERSIONS });
    }
    const version = headerVersion ?? MCP_DEFAULT_LEGACY;
    switch (m.method) {
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: toolsFor(version, req.ctx.scope === "generate") });
      case "resources/list":
        return ok({ resources: [guideResource()] });
      case "resources/read": {
        const r = readResource(m.params);
        return "error" in r ? rpcFail(200, m.id, RESOURCE_NOT_FOUND, r.error) : ok(r.result);
      }
      case "tools/call": {
        const r = await this.callTool(req, m, version);
        return "error" in r ? rpcFail(200, m.id, r.error.code, r.error.message) : { ...ok(r.result), logCode: r.logCode };
      }
      default:
        return rpcFail(200, m.id, JSONRPC.METHOD_NOT_FOUND, `Method not found: ${m.method}`);
    }
  }

  // ---------------------------------------------------------------- tools
  private async callTool(
    req: McpHttpRequest,
    m: RpcRequest,
    version: string,
  ): Promise<{ result: Record<string, unknown>; logCode?: string } | { status: number; error: { code: number; message: string } }> {
    const p = (m.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof p.name !== "string") return { status: 400, error: { code: JSONRPC.INVALID_PARAMS, message: "params.name is required" } };
    const tool = TOOLS.find((t) => t.name === p.name);
    if (!tool) return { status: 200, error: { code: JSONRPC.INVALID_PARAMS, message: `Unknown tool: ${p.name}` } };
    const args = p.arguments ?? {};
    const structured = supportsStructured(version);
    try {
      // Over the limit → isError tool result with retry_after, so the model reads why and when to retry.
      this.d.take(req.ctx, tool.name === "muse_generate" || tool.name === "muse_extend_video" || tool.name === "muse_chat" ? "create" : "read");
      const out = await this.runTool(tool.name, args, req);
      return { result: await this.toolResult(out, structured) };
    } catch (e) {
      if (e instanceof ApiError) return { result: errorResult(e, structured, localeFromAcceptLanguage(headerText(req.headers["accept-language"])) ?? getLocale()), logCode: e.code };
      throw e;
    }
  }

  private async runTool(name: string, args: unknown, req: McpHttpRequest): Promise<{ text: string; data: Record<string, unknown>; jobs: ApiJob[] }> {
    const s = this.d.service;
    const ctx = req.ctx;
    switch (name) {
      case "muse_status": {
        parseOrThrow(mcpStatusSchema, args);
        const st = s.status(ctx);
        return { text: statusText(st), data: st as unknown as Record<string, unknown>, jobs: [] };
      }
      case "muse_generate": {
        s.requireScope(ctx, "generate");
        const a = parseOrThrow(mcpGenerateSchema, args);
        const refIds = a.reference_ids ?? [];
        if (refIds.length && (a.reference_id || a.reference_asset_id || a.reference_image_base64))
          throw new ApiError(400, "invalid_request", "`reference_ids` không dùng kèm các trường ảnh tham chiếu khác");
        let referenceId = a.reference_id;
        if (a.reference_image_base64) {
          if (referenceId || a.reference_asset_id) throw new ApiError(400, "invalid_request", "Chỉ gửi một loại ảnh tham chiếu");
          const bytes = decodeBase64(a.reference_image_base64);
          if (!["image/png", "image/jpeg", "image/webp"].includes(sniffImageMime(bytes) ?? "")) throw new ApiError(415, "unsupported_media_type", "reference_image_base64 chỉ nhận ảnh — tải MP4 qua POST /v1/references");
          if (bytes.length > API_MCP_REF_MAX_BYTES) throw new ApiError(413, "upload_too_large", "Ảnh base64 qua MCP tối đa 8 MB — ảnh lớn hơn tải lên qua POST /v1/references");
          // Same picture as before (e.g. a retry with the same request_id) → same reference id, no second upload (R27).
          referenceId = s.referenceIdBySha(createHash("sha256").update(bytes).digest("hex")) ?? undefined;
          if (!referenceId) {
            this.d.take(ctx, "upload");
            referenceId = (await s.uploadReference(ctx, bytes)).reference_id;
          }
        }
        const body: Record<string, unknown> = { kind: a.kind, prompt: a.prompt };
        // One id goes through the old field so an idempotent retry fingerprints the same (R27).
        if (refIds.length > 1) body.reference_ids = refIds;
        else if (refIds.length === 1) body.reference_id = refIds[0];
        if (referenceId) body.reference_id = referenceId;
        if (a.reference_asset_id) body.reference_asset_id = a.reference_asset_id;
        if (a.repeat !== undefined) body.repeat = a.repeat;
        if (a.account !== undefined) body.account = a.account;
        if (a.site !== undefined) body.site = a.site;
        const r = await s.createJobs(ctx, body, a.request_id ?? null, req.base);
        let jobs = r.jobs;
        if (a.wait_seconds && jobs.length) {
          const first = await s.getJob(ctx, jobs[0].id, { waitS: a.wait_seconds, afterVersion: null, base: req.base, until: "settled", signal: req.signal });
          jobs = [first, ...jobs.slice(1)];
        }
        const head = r.replayed ? "Same request_id as before — returning the existing jobs (nothing new was queued)." : `Queued ${jobs.length} job(s).`;
        return { text: `${head}\n${jobs.map(jobLine).join("\n")}`, data: { jobs, replayed: r.replayed }, jobs };
      }
      case "muse_chat": {
        s.requireScope(ctx, "generate");
        const a = parseOrThrow(mcpChatSchema, args);
        const inline = (a.attachments ?? []).filter((x): x is { filename: string; mime?: string; data_base64: string } => "data_base64" in x);
        if (inline.length > MCP_INLINE_FILES_MAX) throw new ApiError(400, "invalid_request", `Tối đa ${MCP_INLINE_FILES_MAX} tệp gửi kèm trực tiếp — tệp khác tải qua POST /v1/references`);
        const decoded = inline.map((x) => ({ name: x.filename, bytes: decodeBase64(x.data_base64, "data_base64") }));
        if (decoded.reduce((n, x) => n + x.bytes.length, 0) > MCP_INLINE_TOTAL_MAX) throw new ApiError(400, "invalid_request", "Tổng tệp gửi kèm trực tiếp qua MCP tối đa 8 MiB — tệp lớn hơn tải qua POST /v1/references");
        const ids: string[] = [];
        let k = 0;
        for (const x of a.attachments ?? []) {
          if ("reference_id" in x) {
            ids.push(x.reference_id);
            continue;
          }
          const d = decoded[k++];
          // Same bytes as before (a retry with the same request_id) → same reference, no second upload (R27).
          let id = s.referenceIdBySha(createHash("sha256").update(d.bytes).digest("hex"));
          if (!id) {
            this.d.take(ctx, "upload");
            id = (await s.uploadReference(ctx, d.bytes, d.name)).reference_id;
          }
          ids.push(id);
        }
        const body: Record<string, unknown> = { kind: "chat", prompt: a.prompt };
        if (ids.length) body.attachments = ids;
        if (a.conversation_id !== undefined) body.conversation_id = a.conversation_id;
        if (a.account !== undefined) body.account = a.account;
        const r = await s.createJobs(ctx, body, a.request_id ?? null, req.base);
        let job = r.jobs[0];
        if (a.wait_seconds) job = await s.getJob(ctx, job.id, { waitS: a.wait_seconds, afterVersion: null, base: req.base, until: "settled", signal: req.signal });
        const head = r.replayed ? "Same request_id as before — returning the existing job (nothing new was sent)." : "Sent to Muse.";
        return { text: `${head}\n${jobLine(job)}`, data: { job, replayed: r.replayed }, jobs: [job] };
      }
      case "muse_get_job": {
        const a = parseOrThrow(mcpGetJobSchema, args);
        const job = await s.getJob(ctx, a.job_id, { waitS: a.wait_seconds ?? 0, afterVersion: null, base: req.base, until: "settled", signal: req.signal });
        return { text: jobLine(job), data: { job }, jobs: [job] };
      }
      case "muse_list_jobs": {
        const a = parseOrThrow(mcpListSchema, args);
        const page = s.listJobs(ctx, { status: a.status ?? null, limit: a.limit ?? null, cursor: a.cursor ?? null, base: req.base });
        const text = page.jobs.length ? page.jobs.map(jobLine).join("\n") + (page.next_cursor ? `\nMore: cursor=${page.next_cursor}` : "") : "No jobs.";
        return { text, data: page as unknown as Record<string, unknown>, jobs: [] };
      }
      case "muse_cancel_job": {
        const a = parseOrThrow(mcpCancelSchema, args);
        const job = s.cancel(ctx, a.job_id, req.base);
        return { text: jobLine(job), data: { job }, jobs: [job] };
      }
      case "muse_extend_video": {
        s.requireScope(ctx, "generate");
        const a = parseOrThrow(mcpExtendSchema, args);
        const body: Record<string, unknown> = {};
        for (const k of ["mode", "directive", "times", "target_seconds"] as const) if (a[k] !== undefined) body[k] = a[k];
        // rev 7.1 R65: exactly one source selector — an output you own, or a conversation whose head you own.
        const r = a.conversation_id ? s.extendConversation(ctx, a.conversation_id, body, a.request_id ?? null, req.base) : s.extend(ctx, a.asset_id!, body, a.request_id ?? null, req.base);
        let chain = r.chain;
        if (a.wait_seconds) chain = await s.getChain(ctx, chain.id, { waitS: a.wait_seconds, base: req.base, until: "settled", signal: req.signal });
        const head = r.replayed ? "Same request_id as before — returning the existing chain (nothing new was queued)." : "Extend chain started.";
        return { text: `${head}\n${chainLine(chain)}`, data: { chain, jobs: r.jobs, replayed: r.replayed }, jobs: [] };
      }
      case "muse_get_extend": {
        const a = parseOrThrow(mcpGetExtendSchema, args);
        const chain = await s.getChain(ctx, a.chain_id, { waitS: a.wait_seconds ?? 0, base: req.base, until: "settled", signal: req.signal });
        return { text: chainLine(chain), data: { chain }, jobs: [] };
      }
    }
    throw new ApiError(404, "not_found", `Unknown tool ${name}`);
  }

  private async toolResult(out: { text: string; data: Record<string, unknown>; jobs: ApiJob[] }, structured: boolean): Promise<Record<string, unknown>> {
    const content: Record<string, unknown>[] = [{ type: "text", text: `${out.text}\n\n${JSON.stringify(out.data)}` }];
    for (const job of out.jobs) {
      for (const o of job.outputs) {
        if (!o.available) continue;
        if (o.kind === "image" && content.length < 6) {
          const thumb = await this.d.service.thumbnail(o.asset_id);
          if (thumb) content.push({ type: "image", data: thumb.toString("base64"), mimeType: "image/jpeg" });
        }
        if (structured && o.download_url) content.push({ type: "resource_link", uri: o.download_url, name: o.kind === "file" && o.filename ? o.filename : `${job.id}-${o.asset_id}`, mimeType: o.mime, size: o.bytes, description: o.kind === "file" ? `file ${o.filename ?? ""}`.trim() : `${o.kind} ${o.width}×${o.height}` });
      }
    }
    const result: Record<string, unknown> = { content, isError: false };
    if (structured) result.structuredContent = out.data;
    return result;
  }
}

function errorResult(e: ApiError, structured: boolean, locale: Locale): Record<string, unknown> {
  const detail = problemDetail(e, locale);
  const retry = e.extra.retryAfterS ? ` Retry after ${e.extra.retryAfterS} s.` : "";
  const r: Record<string, unknown> = { content: [{ type: "text", text: `${e.code}: ${detail}${retry}` }], isError: true };
  if (structured) r.structuredContent = { error: { code: e.code, detail, status: e.status, retry_after: e.extra.retryAfterS ?? null } };
  return r;
}

function decodeBase64(s: string, field = "reference_image_base64"): Buffer {
  const clean = s.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new ApiError(400, "invalid_request", `${field} không phải base64 hợp lệ`);
  return Buffer.from(clean, "base64");
}

function jobLine(j: ApiJob): string {
  const out = j.outputs
    .filter((o) => o.download_url)
    .map((o) => (o.kind === "file" ? `\n  file ${o.filename ?? o.asset_id} (${o.bytes} bytes): ${o.download_url}` : `\n  ${o.kind} ${o.width}×${o.height}: ${o.download_url}`))
    .join("");
  const err = j.error ? ` — ${j.error.code}: ${j.error.message}` : j.note ? ` — ${j.note}` : "";
  const conv = j.kind === "chat" && j.conversation_id ? ` conversation_id=${j.conversation_id}` : "";
  const answer = j.result ? `\nMuse answered${j.result.text_truncated ? " (cut at 1 MiB — full text is the .md output)" : ""}:\n${j.result.text.slice(0, 20_000)}${j.result.text.length > 20_000 ? "\n[…see structured result.text]" : ""}` : "";
  return `job ${j.id}: ${j.status} (${j.label})${conv}${err}${answer}${out}`;
}

function chainLine(c: ApiChain): string {
  const plan = "times" in c.plan ? `${c.plan.times} step(s)` : `about ${c.plan.target_seconds} s`;
  const steps = c.steps.map((st) => `\n  step ${st.step}: ${st.status}${st.duration_ms !== null ? ` · ${(st.duration_ms / 1000).toFixed(1)} s` : ""}${st.output?.download_url ? ` · ${st.output.download_url}` : ""}`).join("");
  const reason = c.stop_reason ? ` — ${c.stop_reason}` : "";
  return `chain ${c.id}: ${c.status}${reason} (${plan}, ${c.steps_done}/${c.max_steps} max)${steps}`;
}

function statusText(st: ReturnType<ApiService["status"]>): string {
  const caps = Object.entries(st.capabilities)
    .map(([k, v]) => `${k}=${v ? "on" : "off"}`)
    .join(", ");
  const quota = st.accounts.items
    .map((a) => {
      const q = a.quota;
      const weekly = q.weekly_used_percent === null ? "quota not read yet" : `weekly ${q.weekly_used_percent}% used${q.weekly_resets_label ? ` (resets ${q.weekly_resets_label})` : ""}`;
      const extra = q.additional_remaining_label ? `, additional ${q.additional_remaining_label}` : "";
      const wait = a.waiting_until ? `, waiting until ${a.waiting_until}` : "";
      return `${a.alias}: ${a.group}${wait}, ${weekly}${extra}${q.stale ? " [stale]" : ""}`;
    })
    .join("; ");
  return `Muse4AI ${st.version}. Capabilities: ${caps}. Accounts: ${st.accounts.ready} ready, ${st.accounts.busy} busy, ${st.accounts.waiting} waiting, ${st.accounts.needs_user} need the user, ${st.accounts.paused} paused.${quota ? ` Quota as Muse shows it (not exact token counts): ${quota}.` : ""} This key (${st.key.name}, ${st.key.scope}): ${st.key.unfinished_jobs} unfinished job(s).`;
}
