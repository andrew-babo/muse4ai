import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { isInside } from "./paths";
export { isInside };

// app://bundle/... serves the built renderer; muse-media://... serves library/thumb/reference files read-only (§5: no media bytes over IPC).

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    // codeCache: V8 keeps the compiled renderer bundle between starts (start-up log showed ~0.7 s from navigation to
    // the bundle running on the reference VPS, mostly compile).
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } },
    { scheme: "muse-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
  ]);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: muse-media:; media-src 'self' muse-media: blob:; font-src 'self' data:; connect-src 'self' muse-media:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function fileResponse(file: string, req: Request, extraHeaders: Record<string, string> = {}): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache", ...extraHeaders };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
        return new Response(body, { status: 206, headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${stat.size}` } });
      }
    }
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, "Content-Length": String(stat.size) } });
}

export interface MediaResolver {
  asset(id: string): Promise<string | null>;
  thumb(id: string): Promise<string | null>;
  ref(id: string): string | null;
  allowLocal(file: string): boolean;
}

export function handleProtocols(rendererDir: string, media: MediaResolver): void {
  protocol.handle("app", (req) => {
    const u = new URL(req.url);
    if (u.host !== "bundle") return new Response("Not found", { status: 404 });
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.join(rendererDir, rel);
    if (!isInside(file, [rendererDir])) return new Response("Forbidden", { status: 403 });
    return fileResponse(file, req, rel.endsWith(".html") ? { "Content-Security-Policy": CSP } : {});
  });

  protocol.handle("muse-media", async (req) => {
    const u = new URL(req.url);
    const id = decodeURIComponent(u.pathname.replace(/^\//, ""));
    let file: string | null = null;
    if (u.host === "asset") file = await media.asset(id);
    else if (u.host === "thumb") file = await media.thumb(id);
    else if (u.host === "ref") file = media.ref(id);
    else if (u.host === "local") {
      try {
        file = Buffer.from(id, "base64url").toString("utf8");
      } catch {
        file = null;
      }
      if (file && !media.allowLocal(file)) return new Response("Forbidden", { status: 403 });
    }
    if (!file) return new Response("Not found", { status: 404 });
    return fileResponse(file, req);
  });
}

export const localMediaUrl = (file: string) => `muse-media://local/${Buffer.from(file, "utf8").toString("base64url")}`;
