import type { WebContents } from "electron";
import type { PageCtl } from "./adapter/muse/driver";

// PageCtl over an Electron webContents; trusted input through the DevTools protocol (works on hidden windows).

export class WebPage implements PageCtl {
  private attached = false;
  /** @param beforeLoad resolves once the account's proxy is in force; every navigation waits for it. */
  constructor(
    private wc: WebContents,
    private beforeLoad: () => Promise<void> = async () => undefined,
  ) {}

  private async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.attached) {
      try {
        this.wc.debugger.attach("1.3");
      } catch {
        /* already attached */
      }
      this.attached = true;
      await this.wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
      await this.wc.debugger.sendCommand("Page.enable").catch(() => undefined);
      await this.wc.debugger.sendCommand("Page.setWebLifecycleState", { state: "active" }).catch(() => undefined);
    }
    return this.wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  url(): string {
    return this.wc.isDestroyed() ? "" : this.wc.getURL();
  }

  async load(url: string, timeoutMs: number): Promise<void> {
    await this.beforeLoad();
    let t: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.wc.loadURL(url),
        new Promise((_, rej) => {
          t = setTimeout(() => rej(new Error("ERR_TIMED_OUT: page load timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
    await this.cdp("Page.setWebLifecycleState", { state: "active" }).catch(() => undefined);
  }

  /** executeJavaScript has no timeout of its own; a hung page must not stall the worker forever. */
  eval<T>(code: string, timeoutMs = 20_000): Promise<T> {
    if (this.wc.isDestroyed()) return Promise.reject(new Error("page closed"));
    let t: NodeJS.Timeout | undefined;
    return Promise.race([
      this.wc.executeJavaScript(code, true) as Promise<T>,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error("ERR_TIMED_OUT: page script timeout")), timeoutMs);
      }),
    ]).finally(() => t && clearTimeout(t));
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async click(selector: string): Promise<boolean> {
    const rect = await this.eval<{ x: number; y: number } | null>(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    if (!rect) return false;
    try {
      await this.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
      await this.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      await this.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      return true;
    } catch {
      return this.eval<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
    }
  }

  async setFiles(selector: string, paths: string[]): Promise<boolean> {
    const res = await this.cdp<{ result: { objectId?: string; subtype?: string } }>("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)})` });
    const objectId = res.result.objectId;
    if (!objectId || res.result.subtype === "null") return false;
    await this.cdp("DOM.setFileInputFiles", { files: paths, objectId });
    return true;
  }

  async insertText(text: string): Promise<void> {
    await this.cdp("Input.insertText", { text });
  }

  async pressEscape(): Promise<void> {
    await this.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await this.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
}
