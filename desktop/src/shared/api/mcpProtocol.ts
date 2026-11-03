import { BRAND } from "../brand";
import { REF_MAX_PER_JOB } from "../constants";
import { API_LIST_MAX, API_WAIT_MAX_S, MCP_LEGACY_VERSIONS, MCP_MODERN_VERSIONS } from "./constants";

// MCP Streamable HTTP, two eras (spec §4.8, research-api §3):
//  - modern (2026-07-28): stateless, `_meta` + MCP-Protocol-Version/Mcp-Method/Mcp-Name headers on every request, `server/discover`;
//  - legacy (2025-11-25 / 2025-06-18 / 2025-03-26): `initialize` handshake, optional MCP-Protocol-Version header afterwards.
// Pure helpers; the HTTP handler lives in main/api/mcp.ts.

export const JSONRPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_VERSION: -32022,
} as const;

export const META_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const ALL_VERSIONS: string[] = [...MCP_MODERN_VERSIONS, ...MCP_LEGACY_VERSIONS];

export const isModernVersion = (v: string | null | undefined) => !!v && (MCP_MODERN_VERSIONS as readonly string[]).includes(v);
export const isLegacyVersion = (v: string | null | undefined) => !!v && (MCP_LEGACY_VERSIONS as readonly string[]).includes(v);

/** A dated version newer than every legacy revision is treated as the modern era (even if we do not support it). */
export function looksModern(v: string | null | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > MCP_LEGACY_VERSIONS[0];
}

/** `=?base64?…?=` header sentinel → decoded UTF-8; plain values unchanged. */
export function decodeHeaderValue(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try {
    return Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    return v;
  }
}

/** 2025-06-18 added structuredContent, outputSchema, resource_link and tool titles. */
export function supportsStructured(version: string): boolean {
  return version >= "2025-06-18";
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean; title?: string };
  write: boolean;
}

const jobOutput = {
  type: "object",
  properties: {
    jobs: { type: "array", items: { type: "object" } },
    job: { type: "object" },
  },
};

export const TOOLS: ToolDef[] = [
  {
    name: "muse_status",
    title: "Muse4AI status",
    description:
      "Read Muse4AI's current state: which generation kinds are enabled (image from text, image edit, video from text, video from image), how many Muse accounts are ready/busy/need the user, each account's Muse quota as Muse shows it (weekly % used and reset day, additional tokens left — not exact token counts; the app reads it between jobs, calling this never triggers a read), and this API key's unfinished jobs and limits. Call this first if a generation fails with capability_unavailable, and before a large batch: accounts with tier exhausted are waiting, and \"auto\" already prefers accounts with quota left. Each account also shows how it sends now (execution: mode auto/http/ui, active_path, http_state, running counts and limits) and bridge shows whether the direct channel is on.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    write: false,
  },
  {
    name: "muse_generate",
    title: "Generate image or video with Muse",
    description:
      "Queue an image or video generation on the user's Meta Muse accounts (runs on their Windows PC; uses their Muse quota). Returns job ids immediately; generation takes ~30–90 s for images and several minutes for video. Then call muse_get_job with wait_seconds to wait for the result. For image editing / video-from-image pass a reference: reference_asset_id (an output of an earlier job of yours), reference_id (from POST /v1/references) or reference_image_base64 (PNG/JPEG/WEBP ≤ 8 MB). Always pass request_id (any unique string) so a retry after a network error never creates duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["image", "video"], description: "What to generate." },
        prompt: { type: "string", minLength: 1, maxLength: 4000, description: "Description of the image/video, any language." },
        reference_asset_id: { type: "string", description: "Use your own image or MP4 output. MP4 edits require kind=video and site=muse, use a new conversation, and do not overwrite the source; fidelity is not guaranteed." },
        reference_id: { type: "string", description: "Image or MP4 uploaded via POST /v1/references (raw bytes ≤20 MiB). For video editing use kind=video, site=muse and an editing prompt. reference_ids may combine 1 MP4 with images (objects/style to add); never 2 MP4s in one turn. Edits can take up to 25 minutes." },
        reference_image_base64: { type: "string", description: "Reference image bytes (PNG/JPEG/WEBP, ≤ 8 MB) in base64." },
        reference_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: REF_MAX_PER_JOB,
          description: `1–${REF_MAX_PER_JOB} references from POST /v1/references used together in one generation (e.g. two pictures composed into one video). Not combined with the other reference fields.`,
        },
        repeat: { type: "integer", minimum: 1, maximum: 4, default: 1, description: "Number of separate jobs with the same prompt." },
        account: { type: "string", description: "Muse account alias to use, or 'auto' (default)." },
        site: {
          type: "string",
          enum: ["muse"],
          default: "muse",
          description: "Muse only. Legacy Vibes requests are rejected; never treated as Muse.",
        },
        request_id: { type: "string", maxLength: 100, description: "Idempotency key: same request_id + same input returns the same jobs." },
        wait_seconds: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0, description: "Optionally wait up to this many seconds for the first job to finish." },
      },
      required: ["kind", "prompt"],
      additionalProperties: false,
    },
    outputSchema: jobOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    write: true,
  },
  {
    name: "muse_chat",
    title: "Ask Muse (prompt in, answer + files out)",
    description:
      "Send any prompt to Meta Muse on the user's own accounts and get back exactly what Muse returns: its answer text, every file it attached (CSV, documents, images, videos — with download links valid 60 minutes), the conversation_id and status. Generic: research, analysis, writing, data files, code — you decide the prompt and you verify the content; Muse4AI does NOT check or rewrite what Muse says. Pass conversation_id (from an earlier result) to continue the same Muse conversation; it runs on the account that owns it, one unfinished turn at a time (conversation_busy → wait). Without conversation_id a new conversation starts. attachments: reference ids from POST /v1/references, or inline {filename, mime, data_base64} (≤ 4 inline files, ≤ 8 MiB total; CSV/TXT/MD/JSON/PDF, PNG/JPEG/WEBP, MP4 — what each account can send is in muse_status). All jobs on one Muse account share that account's Muse memory and history: use a separate account (and turn Muse memory off yourself) to keep agents apart. Always pass request_id so a retry never sends twice. With wait_seconds (≤ 50) the call returns the final answer when it is ready in time; otherwise call muse_get_job.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 32000, description: "Sent to Muse verbatim (no template added)." },
        attachments: {
          type: "array",
          maxItems: 10,
          items: {
            oneOf: [
              { type: "object", properties: { reference_id: { type: "string" } }, required: ["reference_id"], additionalProperties: false },
              { type: "object", properties: { filename: { type: "string" }, mime: { type: "string" }, data_base64: { type: "string" } }, required: ["filename", "data_base64"], additionalProperties: false },
            ],
          },
        },
        conversation_id: { type: "string", description: "Continue this conversation (conversation_id of an earlier muse_chat result)." },
        account: { type: "string", description: "Muse account alias, or 'auto' (default). Ignored rules: a conversation always runs on its own account." },
        request_id: { type: "string", maxLength: 100, description: "Idempotency key: same request_id + same input returns the same job." },
        wait_seconds: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    outputSchema: jobOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    write: true,
  },
  {
    name: "muse_get_job",
    title: "Get a Muse job",
    description:
      "Get one of your jobs: status (queued, running, needs_review, succeeded, failed, cancelled), error, and outputs with download links (valid 60 minutes) plus an image preview. With wait_seconds (≤ 50) the call returns as soon as the job finishes, or after that many seconds with the current status — call again until status is final. needs_review means a person must check it in Muse4AI; do not resubmit in that case.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        wait_seconds: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    outputSchema: jobOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    write: false,
  },
  {
    name: "muse_list_jobs",
    title: "List my Muse jobs",
    description: "List jobs created with this API key, newest first. Optional status filter and cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["queued", "running", "needs_review", "succeeded", "failed", "cancelled"] },
        limit: { type: "integer", minimum: 1, maximum: API_LIST_MAX, default: 20 },
        cursor: { type: "string", description: "next_cursor from the previous page." },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { jobs: { type: "array", items: { type: "object" } }, next_cursor: { type: ["string", "null"] } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    write: false,
  },
  {
    name: "muse_cancel_job",
    title: "Cancel a Muse job",
    description:
      "Cancel one of your unfinished jobs. If Muse already started generating, the PC only stops waiting — Muse may still generate it and count quota. Finished jobs cannot be cancelled.",
    inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false },
    outputSchema: jobOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    write: true,
  },
  {
    name: "muse_extend_video",
    title: "Extend a Muse video",
    description:
      "Make a video longer, step by step; each step continues the previous output and takes minutes. Pass exactly ONE source: asset_id (a video output of one of YOUR jobs or extend steps) or conversation_id (outputs[].conversation_id of one of your Muse videos — continues that conversation's latest video, even if you no longer have its asset_id). Muse videos are continued inside their own Muse conversation (Muse is asked to take the real last frame and return one cumulative MP4; up to 6 steps, target_seconds up to 60). The length gained per step is decided by the provider and is NOT guaranteed; every step uses one generation of the owner account and runs only on that account. Pass times (default 1) or target_seconds (step 5), not both. mode \"auto\" (default) continues on its own; mode \"directive\" needs a short directive describing what happens next (applies to every step). conversation_busy means another chain or an unresolved step is still open in that conversation — wait for it, do not retry in a loop. Returns the chain id; wait with wait_seconds (≤ 50) or call muse_get_extend. Always pass request_id so a retry never starts a second chain.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Video output (asset_id) of one of your jobs or extend steps (Muse)." },
        conversation_id: { type: "string", description: "Muse only: outputs[].conversation_id (or chain.conversation_id) from one of your earlier results; the conversation's current latest video is continued." },
        mode: { type: "string", enum: ["auto", "directive"], default: "auto" },
        directive: { type: "string", maxLength: 1000, description: "Only for mode=directive: what should happen in the extension." },
        times: { type: "integer", minimum: 1, maximum: 6, description: "Number of extend steps (default 1; at most 6)." },
        target_seconds: { type: "integer", minimum: 15, maximum: 60, multipleOf: 5, description: "Stop once the video is about this long (Muse at most 60) or at the maximum number of steps." },
        request_id: { type: "string", maxLength: 100, description: "Idempotency key: same request_id + same input returns the same chain." },
        wait_seconds: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0, description: "Optionally wait up to this many seconds for the chain to stop." },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { chain: { type: "object" }, jobs: { type: "array", items: { type: "object" } } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    write: true,
  },
  {
    name: "muse_get_extend",
    title: "Get an extend chain",
    description:
      "Get one of your extend chains: status (running, waiting, completed, stopped, cancelled, needs_review), stop_reason, every step with its video length (duration_ms) and download link, and latest_output (the longest finished video). With wait_seconds (≤ 50) the call returns as soon as the chain stops. needs_review means a person must check a step in Muse4AI; do not start the chain again in that case.",
    inputSchema: {
      type: "object",
      properties: { chain_id: { type: "string" }, wait_seconds: { type: "integer", minimum: 0, maximum: API_WAIT_MAX_S, default: 0 } },
      required: ["chain_id"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { chain: { type: "object" } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    write: false,
  },
];

/** Tool list as sent to a client of `version` (older revisions do not know title/outputSchema). */
export function toolsFor(version: string, canWrite: boolean): Record<string, unknown>[] {
  const structured = supportsStructured(version);
  return TOOLS.filter((t) => canWrite || !t.write).map((t) => {
    const o: Record<string, unknown> = { name: t.name, description: t.description, inputSchema: t.inputSchema };
    if (structured) {
      o.title = t.title;
      if (t.outputSchema) o.outputSchema = t.outputSchema;
      o.annotations = { ...t.annotations, title: t.title };
    } else {
      const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } = t.annotations;
      o.annotations = { readOnlyHint, destructiveHint, idempotentHint, openWorldHint };
    }
    return o;
  });
}

/**
 * Build 3.0 R3-SKILL.8 / AC-MCP-01: the first sentence stands on its own (≤ 200 characters, names Muse4AI and what it
 * makes); the whole text stays ≤ 2,000 characters. The full how-to lives in the `muse4ai://guide` resource.
 */
export const SERVER_INSTRUCTIONS = [
  `${BRAND.name} (${BRAND.tagline}) creates images, short videos and answers with Meta Muse on the user's own Windows PC and Muse accounts.`,
  "Call muse_status first. Then muse_generate with a unique request_id, and muse_get_job with wait_seconds until status is succeeded, failed, cancelled or needs_review; give the user the download_url.",
  "Never resubmit a job that is running or needs_review. Retry a failed job only if error.code is PRE_SUBMIT_TRANSIENT or PROXY_FAILED, or once after a few minutes for PROVIDER_ERROR.",
  "Longer video: check the muse.video.extend capability in muse_status, call muse_extend_video with the video's asset_id or its Muse conversation_id (keep outputs[].conversation_id), then muse_get_extend until the chain stops; length per step is not guaranteed.",
  "Questions, research and files: muse_chat returns Muse's answer verbatim plus any files and a conversation_id to continue; the app does not verify content, and jobs on one account share its Muse memory.",
  "Every generation uses the user's Muse usage limit, so do not loop generations. Full guide: resource muse4ai://guide.",
].join(" ");

export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

export function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function isValidId(id: unknown): id is string | number {
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}
