import { BrowserWindow } from "electron";
import type { MediaProbe, ProbeResult } from "./media";
import { localMediaUrl } from "./protocols";

// B10 — decode + measure + thumbnail with the app's own Chromium (hidden window). No ffmpeg in v1.

const PROBE_FN = `async (url, mime) => {
  const toThumb = (src, w, h) => { const max = 480; const s = Math.min(1, max / Math.max(w, h)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s)); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.82); };
  const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("quá thời gian giải mã")), ms));
  if (mime.startsWith("image/")) {
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
    await Promise.race([img.decode(), timeout(20000)]);
    return { width: img.naturalWidth, height: img.naturalHeight, durationMs: null, thumb: toThumb(img, img.naturalWidth, img.naturalHeight) };
  }
  const v = document.createElement("video"); v.crossOrigin = "anonymous"; v.muted = true; v.preload = "auto"; v.src = url;
  await Promise.race([new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("video lỗi giải mã")); }), timeout(20000)]);
  const d = isFinite(v.duration) ? v.duration : 0;
  v.currentTime = Math.min(0.1, d / 2);
  await Promise.race([new Promise((res) => { v.onseeked = res; }), timeout(10000)]);
  return { width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(d * 1000), thumb: toThumb(v, v.videoWidth, v.videoHeight) };
}`;

export class ProbeWindow {
  private win: BrowserWindow | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private pageUrl: string) {}

  private async ensure(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await this.win.loadURL(this.pageUrl);
    return this.win;
  }

  probe: MediaProbe = (filePath, mime) => {
    const run = async (): Promise<ProbeResult> => {
      const w = await this.ensure();
      const r = (await w.webContents.executeJavaScript(`(${PROBE_FN})(${JSON.stringify(localMediaUrl(filePath))}, ${JSON.stringify(mime)})`)) as {
        width: number;
        height: number;
        durationMs: number | null;
        thumb: string;
      };
      const thumbnail = r.thumb?.startsWith("data:image/jpeg;base64,") ? Buffer.from(r.thumb.slice(23), "base64") : null;
      return { width: r.width, height: r.height, durationMs: r.durationMs, thumbnail };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  };

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
