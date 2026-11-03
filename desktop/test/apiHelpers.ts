import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ApiController, type ApiControllerDeps } from "../src/main/api/controller";
import { freePort } from "../src/main/api/tunnel";
import type { JobRow } from "../src/main/repo";
import { Services } from "../src/main/services";
import type { ApiAccess } from "../src/shared/types";
import type { Harness } from "./helpers";

export const FIXTURES = path.join(__dirname, "fixtures", "media");

/** Fake Muse media that is realistic enough for Range requests (> 100 bytes). */
export function fixtureMedia(kind: "image" | "video", seed: number): Uint8Array {
  const imgs = ["coffee.jpg", "flowers.jpg", "mountains.jpg", "waves.jpg"];
  const vids = ["mountains.mp4", "waves.mp4"];
  const list = kind === "image" ? imgs : vids;
  return Uint8Array.from(fs.readFileSync(path.join(FIXTURES, list[seed % list.length])));
}

export interface ApiRig {
  api: ApiController;
  services: Services;
  port: number;
  base: string;
  gen: string;
  read: string;
  apiEvents: { type: string; payload: unknown }[];
  req: (method: string, p: string, o?: ReqOpts) => Promise<Res>;
  close: () => Promise<void>;
}

export interface ReqOpts {
  token?: string | null;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
  host?: string;
}

export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  ms: number;
}

export function rawRequest(port: number, method: string, p: string, o: ReqOpts = {}, host = "127.0.0.1"): Promise<Res> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let data: Buffer | undefined;
  if (o.json !== undefined) {
    data = Buffer.from(JSON.stringify(o.json));
    headers["content-type"] ??= "application/json";
  } else if (o.body !== undefined) data = Buffer.isBuffer(o.body) ? o.body : Buffer.from(o.body);
  if (data) headers["content-length"] = String(data.length);
  headers.host ??= o.host ?? `127.0.0.1:${port}`;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const r = http.request({ host, port, method, path: p, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        let json: unknown = null;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json, ms: Date.now() - t0 });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

export async function makeApi(h: Harness, opts: { enabled?: boolean; access?: ApiAccess; keys?: boolean; failDelayMs?: number; deps?: Partial<ApiControllerDeps>; beforeInit?: () => void } = {}): Promise<ApiRig> {
  const services = new Services({
    repo: h.repo,
    coord: h.coord,
    media: h.media,
    os: { trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => "", copyFileToClipboard: () => undefined },
    emit: () => undefined,
    logFiles: () => [],
    appInfo: () => ({}),
    now: () => h.clock.t,
  });
  const port = await freePort();
  h.coord.setSetting("apiPort", port);
  if (opts.access) h.coord.setSetting("apiAccess", opts.access);
  if (opts.enabled !== false) h.coord.setSetting("apiEnabled", true);
  const apiEvents: { type: string; payload: unknown }[] = [];
  const api = new ApiController({
    repo: h.repo,
    coord: h.coord,
    services,
    vault: { set: (k, v) => void h.vault.set(k, v), get: (k) => h.vault.get(k) ?? null, delete: (k) => void h.vault.delete(k) },
    emit: (type, payload) => apiEvents.push({ type, payload }),
    log: (level, scope, msg, data) => h.logs.push(`${level} ${scope} ${msg} ${JSON.stringify(data ?? {})}`),
    subscribeJobs: (fn) => {
      const l = (type: string, payload: unknown) => {
        if (type === "job" && payload) fn(payload as JobRow);
      };
      h.listeners.add(l);
      return () => void h.listeners.delete(l);
    },
    version: "test",
    binDir: path.join(h.dir, "bin"),
    now: () => h.clock.t,
    failDelayMs: opts.failDelayMs ?? 5,
    ...opts.deps,
  });
  opts.beforeInit?.();
  await api.init();
  const gen = opts.keys === false ? "" : api.createKey("Agent n8n", "generate").token;
  const read = opts.keys === false ? "" : api.createKey("Chỉ xem", "read").token;
  return {
    api,
    services,
    port,
    base: `http://127.0.0.1:${port}`,
    gen,
    read,
    apiEvents,
    req: (method, p, o = {}) => rawRequest(port, method, p, o),
    close: () => api.shutdown(),
  };
}

/** Raw MCP POST with JSON body. */
export function mcpPost(rig: ApiRig, body: unknown, o: { token?: string | null; headers?: Record<string, string> } = {}): Promise<Res> {
  return rig.req("POST", "/mcp", { token: o.token === undefined ? rig.gen : o.token, json: body, headers: { accept: "application/json, text/event-stream", ...(o.headers ?? {}) } });
}

export function modernMeta(version = "2026-07-28") {
  return {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}
