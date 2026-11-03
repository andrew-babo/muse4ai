import { BRAND } from "../brand";
import { REF_MAX_PER_JOB } from "../constants";
import { API_BUCKETS, API_CHAT_JSON_MAX_BYTES, API_JSON_MAX_BYTES, API_LIST_MAX, API_UNFINISHED_PER_KEY, API_UPLOAD_MAX_BYTES, API_WAIT_MAX_S } from "./constants";

// OpenAPI 3.1 description of the REST API (spec §4.8). Served at GET /v1/openapi.json without a key.

const problem = { $ref: "#/components/schemas/Problem" };
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { description: STATUS_TEXT[c] ?? "Error", content: { "application/problem+json": { schema: problem } } }]));
const STATUS_TEXT: Record<number, string> = {
  400: "Invalid request (code invalid_request / capability_unavailable)",
  401: "Missing, wrong or revoked API key (invalid_api_key)",
  403: "Insufficient scope / browser origin / network / bad signed link",
  404: "Not found (or not created by this key)",
  409: "Job / chain cannot be cancelled, the video cannot be extended (source_not_extendable), or its conversation is busy (conversation_busy)",
  410: "File deleted or moved on the PC",
  413: "Body too large",
  415: "Unsupported media type",
  416: "Range not satisfiable",
  421: "Unknown Host header",
  422: "Idempotency-Key reused with different content",
  429: "Rate limited / queue full / too many waits (see Retry-After)",
};

export function openApiDocument(version: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: `${BRAND.name} agent API`,
      version,
      description:
        BRAND.tagline + ". Queue Meta Muse image/video generations on the user's Windows PC. Jobs are asynchronous: POST /v1/jobs returns 202 with job ids; poll GET /v1/jobs/{id}?wait=… until status is final, then download outputs[].download_url. Longer videos: check GET /v1/status → capabilities (muse.video.extend), then POST /v1/assets/{id}/extend with a video output of this key — or, for a Muse video, POST /v1/conversations/{conversation_id}/extend with outputs[].conversation_id, which continues that Muse conversation's latest video — and wait with GET /v1/extend-chains/{id}?wait=…. Muse continues the video inside its own conversation and returns one cumulative MP4 per step (≤ 6 steps, target ≤ 60 s). The length gained per step is not guaranteed and every step uses one generation of the owner account. A failed job with error.code PROVIDER_ERROR means Muse reported a technical failure (nothing was made): retry once later, not in a loop. Generic bridge (Hỏi đáp): POST /v1/jobs with {kind:\"chat\", prompt, attachments?, conversation_id?} sends the prompt to Muse verbatim and returns exactly what Muse returns — result.text, every attached file in outputs[], conversation_id and the path used (http/ui). Muse4AI does not verify content. All jobs on one Muse account share that account's Muse memory and history; to keep agents apart use separate accounts and turn Muse memory off manually. All errors use RFC 9457 problem+json with a stable `code`. MCP is available at POST /mcp (muse_chat for the generic bridge).",
    },
    servers: [{ url: "/" }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key msk_… created in Muse4AI › Settings › API & agents" } },
      schemas: {
        Problem: {
          type: "object",
          required: ["type", "title", "status", "detail", "code", "request_id"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string", description: "Human-readable, same wording as the app: English or Vietnamese per the Accept-Language request header (vi/en), else the app language" },
            code: { type: "string" },
            request_id: { type: "string" },
            retry_after: { type: "integer" },
            errors: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } },
          },
        },
        CreateChat: {
          type: "object",
          required: ["kind", "prompt"],
          additionalProperties: false,
          description: "Chat (Hỏi đáp in the Vietnamese app): the prompt goes to Muse verbatim. Muse4AI does not verify the answer. Jobs on one account share its Muse memory (use separate accounts to keep agents apart).",
          properties: {
            kind: { type: "string", const: "chat" },
            prompt: { type: "string", minLength: 1, maxLength: 32000 },
            attachments: { type: "array", maxItems: 10, items: { type: "string" }, description: "reference_id values from POST /v1/references (documents CSV/TXT/MD/JSON/PDF, images, MP4; ≤ 20 MiB each, ≤ 50 MiB total)" },
            conversation_id: { type: "string", description: "Continue this conversation (conversation_id of an earlier chat result of this key); runs on its owner account, one unfinished turn at a time" },
            account: { type: "string", default: "auto" },
          },
        },
        Execution: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["auto", "http", "ui"] },
            active_path: { type: "string", enum: ["http", "ui", "none"] },
            http_state: { type: "string", enum: ["unknown", "healthy", "degraded", "down", "off"] },
            reason: { type: ["string", "null"] },
            since: { type: ["string", "null"], format: "date-time" },
            next_probe_at: { type: ["string", "null"], format: "date-time" },
            running_http: { type: "integer" },
            running_ui: { type: "integer" },
            max_concurrent: { type: "integer" },
            ui_max_concurrent: { type: "integer" },
          },
        },
        CreateJob: {
          type: "object",
          required: ["kind", "prompt"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["image", "video"] },
            prompt: { type: "string", minLength: 1, maxLength: 4000 },
            mode: { type: "string", enum: ["text", "reference"], description: "Defaults to reference when a reference is given" },
            reference_id: { type: "string", description: "From POST /v1/references" },
            reference_asset_id: { type: "string", description: "An image or MP4 output of this key's jobs. MP4 requires kind=video, site=muse and edits in a new conversation (not Extend)." },
            reference_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: REF_MAX_PER_JOB,
              description: `1–${REF_MAX_PER_JOB} references from POST /v1/references, composed together (video from image). Not combined with reference_id / reference_asset_id`,
            },
            repeat: { type: "integer", minimum: 1, maximum: 4, default: 1 },
            account: { type: "string", default: "auto", description: "Account alias (case-insensitive) or auto" },
            site: { type: "string", enum: ["muse"], default: "muse", description: "Muse only; legacy Vibes requests are rejected with capability_unavailable" },
          },
        },
        Extend: {
          type: "object",
          additionalProperties: false,
          description: "Send {} for one automatic step. Give times OR target_seconds, not both.",
          properties: {
            mode: { type: "string", enum: ["auto", "directive"], default: "auto" },
            directive: { type: "string", maxLength: 1000, description: "Required for mode directive; used for every step of this chain" },
            times: { type: "integer", minimum: 1, maximum: 6, default: 1, description: "Muse: at most 6" },
            target_seconds: { type: "integer", minimum: 15, maximum: 60, multipleOf: 5, description: "Stop once the output is at least this long (Muse: at most 60; length per step is not guaranteed)" },
          },
        },
        ChainStep: {
          type: "object",
          properties: {
            step: { type: "integer" },
            job_id: { type: "string" },
            status: { type: "string", enum: ["queued", "running", "needs_review", "succeeded", "failed", "cancelled"] },
            state: { type: "string" },
            duration_ms: { type: ["integer", "null"] },
            output: { oneOf: [{ $ref: "#/components/schemas/Output" }, { type: "null" }] },
          },
        },
        ExtendChain: {
          type: "object",
          properties: {
            id: { type: "string" },
            site: { type: "string", enum: ["muse", "vibes"] },
            conversation_id: { type: ["string", "null"], description: "Muse chains: the conversation handle (continue later with POST /v1/conversations/{id}/extend)" },
            status: { type: "string", enum: ["running", "waiting", "completed", "stopped", "cancelled", "needs_review"] },
            stop_reason: { type: ["string", "null"], description: "Vietnamese, same wording as the app" },
            mode: { type: "string", enum: ["auto", "directive"] },
            directive: { type: ["string", "null"] },
            plan: { type: "object", description: "{times} or {target_seconds}" },
            max_steps: { type: "integer" },
            steps_done: { type: "integer" },
            account: { type: ["string", "null"] },
            source_asset_id: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            version: { type: "integer" },
            steps: { type: "array", items: { $ref: "#/components/schemas/ChainStep" } },
            latest_output: { oneOf: [{ $ref: "#/components/schemas/Output" }, { type: "null" }], description: "Longest finished video of the chain" },
          },
        },
        Output: {
          type: "object",
          properties: {
            asset_id: { type: "string" },
            kind: { type: "string", enum: ["image", "video", "file"] },
            mime: { type: "string" },
            filename: { type: ["string", "null"], description: "Stored file name (chat files keep Muse's name, sanitized)" },
            width: { type: "integer" },
            height: { type: "integer" },
            duration_ms: { type: ["integer", "null"] },
            bytes: { type: "integer" },
            sha256: { type: "string" },
            download_url: { type: ["string", "null"], description: "Signed link, valid 60 minutes, no key needed" },
            download_expires_at: { type: ["string", "null"], format: "date-time" },
            available: { type: "boolean" },
            conversation_id: { type: ["string", "null"], description: "Muse videos: app-issued handle of the Muse conversation (opaque, mc_…). Keep it to continue the conversation's latest video later" },
          },
        },
        Conversation: {
          type: "object",
          properties: {
            conversation_id: { type: "string" },
            site: { type: "string", enum: ["muse"] },
            status: { type: "string", enum: ["ready", "busy", "needs_review"] },
            can_extend: { type: "boolean" },
            reason: { type: ["string", "null"], description: "Why it cannot be extended now, or a waiting note (Vietnamese)" },
            active_chain_id: { type: ["string", "null"], description: "The running chain in this conversation, when it is yours" },
            latest_output: { $ref: "#/components/schemas/Output" },
          },
        },
        Job: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["image", "video", "chat"] },
            mode: { type: "string", enum: ["text", "reference"] },
            prompt: { type: "string" },
            path: { type: ["string", "null"], enum: ["http", "ui", null], description: "How the send went to Muse (direct channel or the Muse web page)" },
            conversation_id: { type: ["string", "null"], description: "App handle of the Muse conversation (opaque, mc_…)" },
            result: { type: ["object", "null"], properties: { text: { type: "string" }, text_truncated: { type: "boolean" } }, description: "Chat only, when succeeded: Muse's answer verbatim (≤ 1 MiB; the full text is a .md output when cut). Not verified by the app" },
            warnings: { type: "array", items: { type: "string", enum: ["outputs_truncated"] } },
            status: { type: "string", enum: ["queued", "running", "needs_review", "succeeded", "failed", "cancelled"] },
            state: { type: "string", description: "Internal state (queued, preparing, submitting, generating, downloading, …)" },
            label: { type: "string", description: "Status label as the app shows it, in the caller's language (Accept-Language vi/en, else the app language); use `status` in code" },
            account: { type: ["string", "null"] },
            error: { type: ["object", "null"], properties: { code: { type: "string" }, message: { type: "string" } } },
            note: { type: ["string", "null"] },
            needs_human: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            completed_at: { type: ["string", "null"], format: "date-time" },
            version: { type: "integer", description: "Increases on every change; pass as after_version when waiting" },
            site: { type: "string", enum: ["muse", "vibes"] },
            operation: { type: "string", enum: ["generate", "extend"] },
            source_asset_id: { type: ["string", "null"], description: "Extend steps: the video this step continues" },
            chain_id: { type: ["string", "null"] },
            step: { type: ["integer", "null"] },
            outputs: { type: "array", items: { $ref: "#/components/schemas/Output" } },
          },
        },
      },
    },
    paths: {
      "/v1/health": { get: { security: [], summary: "Liveness and instance id", responses: { "200": { description: "OK" } } } },
      "/v1/openapi.json": { get: { security: [], summary: "This document", responses: { "200": { description: "OK" } } } },
      "/v1/status": {
        get: {
          summary: "Capabilities, account groups and per-account Muse quota, this key's unfinished jobs and limits",
          description:
            "Each item also has execution (mode auto/http/ui, active_path, http_state, reason, since, next_probe_at, running_http, running_ui, max_concurrent, ui_max_concurrent) and the document has bridge {http_enabled, http_compat, last_check_at, last_check_ok}. accounts.items[] lists each account by alias (the value `account` accepts in POST /v1/jobs) with its group, waiting_until and quota: plan, weekly_used_percent, weekly_resets_label/weekly_resets_at, additional_remaining_label/additional_used_percent/additional_expiry_label, observed_at, stale and tier (ok, low, additional, weekly_full, exhausted, unknown). These are the numbers Muse shows in its Usage panel as last read by the app between jobs — not exact token counts; calling this endpoint never triggers a read. \"auto\" allocation already prefers accounts with quota left and never sends to an account whose quota is known to be used up.",
          responses: { "200": { description: "OK" }, ...errors(401, 429) },
        },
      },
      "/v1/jobs": {
        post: {
          summary: "Queue generation job(s)",
          description: `Rate limit: ${API_BUCKETS.create.perMinute}/min (burst ${API_BUCKETS.create.capacity}); at most ${API_UNFINISHED_PER_KEY} unfinished jobs per key. JSON body ≤ ${API_JSON_MAX_BYTES} bytes (chat ≤ ${API_CHAT_JSON_MAX_BYTES}). Chat errors: 400 attachment_limit, 404 not_found (conversation), 409 conversation_busy, 422 conversation_account_mismatch, 422 capability_unavailable.`,
          parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 100 }, description: "Same key + same body returns the same jobs" }],
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/CreateJob" }, { $ref: "#/components/schemas/CreateChat" }] } } } },
          responses: {
            "202": { description: "Accepted", content: { "application/json": { schema: { type: "object", properties: { jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } } } } } } },
            ...errors(400, 401, 403, 410, 413, 415, 422, 429),
          },
        },
        get: {
          summary: "List this key's jobs (newest first)",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["queued", "running", "needs_review", "succeeded", "failed", "cancelled"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: API_LIST_MAX, default: 20 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, ...errors(400, 401, 429) },
        },
      },
      "/v1/jobs/{id}": {
        get: {
          summary: "Get a job; optionally wait for a change",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "wait", in: "query", schema: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0 }, description: "Return as soon as the state changes, or after this many seconds" },
            { name: "after_version", in: "query", schema: { type: "integer" }, description: "Return as soon as version > after_version" },
          ],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } }, ...errors(400, 401, 404, 429) },
        },
      },
      "/v1/jobs/{id}/cancel": {
        post: { summary: "Cancel an unfinished job", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Cancelled" }, ...errors(401, 403, 404, 409, 429) } },
      },
      "/v1/references": {
        post: {
          summary: "Upload a reference image, MP4 or chat document (raw bytes)",
          description: `PNG/JPEG/WEBP/MP4 ≤ ${API_UPLOAD_MAX_BYTES} bytes. Images ≤ 8192 px per edge. MP4 must decode with positive duration; no claimed Muse duration limit. Use kind=video/site=muse to edit uploaded video; edit fidelity is not guaranteed. One turn takes at most 1 MP4 plus images in reference_ids (e.g. objects to add; 1 MP4 + 3 images verified); edits can take up to 25 min. Chat attachments may also be CSV/TXT/MD/JSON/PDF; send the original name in X-File-Name (UTF-8, percent-encoded) — Muse sees it. The bytes decide the type: a file named .csv/.txt/.md/.json/.pdf that is not a valid one → 415 unsupported_attachment; any other unknown type → 415 unsupported_media_type. ${API_BUCKETS.upload.perMinute}/min.`,
          parameters: [{ name: "X-File-Name", in: "header", required: false, schema: { type: "string" }, description: "Original file name, UTF-8 percent-encoded (sanitized before use)" }],
          requestBody: { required: true, content: { "image/png": {}, "image/jpeg": {}, "image/webp": {}, "video/mp4": {}, "text/csv": {}, "text/plain": {}, "text/markdown": {}, "application/json": {}, "application/pdf": {} } },
          responses: { "201": { description: "Created: {reference_id, kind: image|video|document, mime, filename, bytes, sha256, width?, height?, duration_ms?}" }, ...errors(400, 401, 403, 413, 415, 429) },
        },
      },
      "/v1/assets/{id}/content": {
        get: {
          summary: "Download an output file (bearer key, or signed link parameters)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "exp", in: "query", schema: { type: "integer" } },
            { name: "kid", in: "query", schema: { type: "string" } },
            { name: "sig", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "File" }, "206": { description: "Partial content" }, ...errors(401, 403, 404, 410, 416, 429) },
        },
      },
      "/v1/assets/{id}/extend": {
        post: {
          summary: "Extend a video (starts an extend chain)",
          description: `The asset must be a video output of a job (or extend step) created by THIS key. Muse videos are continued in their own Muse conversation and must still be its confirmed latest video. Length per step is not guaranteed; each step uses one generation of the owner account and runs only on that account. 409 source_not_extendable (no Muse conversation source, capability off, not the latest video) or conversation_busy. Rate limit: ${API_BUCKETS.create.perMinute}/min like POST /v1/jobs. Wait with GET /v1/extend-chains/{id}?wait=…`,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 100 }, description: "Same key + same body returns the same chain" },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Extend" } } } },
          responses: {
            "202": { description: "Accepted (Location: /v1/extend-chains/{id})", content: { "application/json": { schema: { type: "object", properties: { chain: { $ref: "#/components/schemas/ExtendChain" }, jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } } } } } } },
            ...errors(400, 401, 403, 404, 409, 413, 415, 422, 429),
          },
        },
      },
      "/v1/conversations/{id}": {
        get: {
          summary: "Get one of your Muse conversations: chat turns, or a video conversation's latest video and whether it can be extended",
          description: "Chat conversations: {conversation_id, account, kind: \"chat\", busy, turns: [{job_id, operation (generate|chat|extend), status, created_at}], video} (only this key's turns). `busy` is true while a turn, an extend chain or an unresolved step holds the conversation. A conversation started by an HTTP video also lists its extend steps, and `video` is {status, can_extend, reason, active_chain_id, latest_output} for its newest video when THIS key made it (null otherwise). Page-made video conversations: {conversation_id, site, status, can_extend, reason, active_chain_id, latest_output}, visible only when THIS key created the video. Anything else is 404.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Conversation" } } } }, ...errors(401, 404, 429) },
        },
      },
      "/v1/conversations/{id}/extend": {
        post: {
          summary: "Continue the latest video of one of your Muse conversations (starts an extend chain)",
          description: `Use outputs[].conversation_id (or chain.conversation_id) from an earlier result — no asset id needed. The conversation's CURRENT latest video is continued, so this key must own that video; unknown, other keys' and Studio-made conversations are 404. 409 conversation_busy while another chain or an unresolved step is open; 409 source_not_extendable when Muse Extend is off or the source cannot be used. Same body, idempotency and rate limit as POST /v1/assets/{id}/extend (Muse: ≤ 6 steps, target ≤ 60 s).`,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 100 }, description: "Same key + same body returns the same chain, even after the conversation moved on" },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Extend" } } } },
          responses: {
            "202": { description: "Accepted (Location: /v1/extend-chains/{id})", content: { "application/json": { schema: { type: "object", properties: { chain: { $ref: "#/components/schemas/ExtendChain" }, jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } } } } } } },
            ...errors(400, 401, 403, 404, 409, 413, 415, 422, 429),
          },
        },
      },
      "/v1/extend-chains/{id}": {
        get: {
          summary: "Get an extend chain; optionally wait for a change",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "wait", in: "query", schema: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0 }, description: "Return as soon as the chain's status or finished steps change, or after this many seconds" },
          ],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ExtendChain" } } } }, ...errors(400, 401, 404, 429) },
        },
      },
      "/v1/extend-chains/{id}/cancel": {
        post: { summary: "Stop a chain (the running step follows the job cancel rules; no further step is created)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Stopped" }, ...errors(401, 403, 404, 409, 429) } },
      },
      "/mcp": { post: { summary: "MCP Streamable HTTP (JSON responses; protocol 2026-07-28 and 2025-11-25/06-18/03-26)", responses: { "200": { description: "JSON-RPC response" }, "202": { description: "Notification accepted" } } } },
    },
  };
}
