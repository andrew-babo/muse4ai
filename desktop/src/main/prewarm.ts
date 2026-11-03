import fs from "node:fs";

/**
 * Reads files once, asynchronously, so the OS has them cached before a synchronous open (node:sqlite) reads them.
 * The main process serves the renderer bundle on its own thread; on a cold start this keeps that thread free while
 * the disk (and the antivirus scan on first open) does the slow part. Never throws: a missing file is skipped.
 */
export async function prewarmFiles(files: string[], opts: { maxBytes: number; maxMs: number; chunk?: number }): Promise<{ bytes: number; timedOut: boolean }> {
  const deadline = Date.now() + opts.maxMs;
  const chunk = opts.chunk ?? 1024 * 1024;
  const buf = Buffer.allocUnsafe(chunk);
  let bytes = 0;
  let timedOut = false;
  for (const file of files) {
    let fh: fs.promises.FileHandle | null = null;
    try {
      fh = await fs.promises.open(file, "r");
      for (;;) {
        if (bytes >= opts.maxBytes) return { bytes, timedOut };
        if (Date.now() > deadline) {
          timedOut = true;
          return { bytes, timedOut };
        }
        const { bytesRead } = await fh.read(buf, 0, Math.min(chunk, opts.maxBytes - bytes), null);
        if (bytesRead <= 0) break;
        bytes += bytesRead;
      }
    } catch {
      /* missing or unreadable: the real open reports it */
    } finally {
      await fh?.close().catch(() => undefined);
    }
  }
  return { bytes, timedOut };
}
