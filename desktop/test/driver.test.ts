import { describe, expect, it } from "vitest";
import { MuseDriver, pickSource, type PageCtl } from "../src/main/adapter/muse/driver";
import { AdapterError } from "../src/main/adapter/types";

// Scripted fake page: answers each in-page script by recognising what it asks for.
interface Scene {
  session?: { status: number; body: Record<string, unknown> | null };
  ready?: boolean;
  login?: boolean;
  send?: "ready" | "disabled" | "no-button";
  /** Page states returned to successive STATE reads after the send click. */
  states?: Partial<State>[];
  dialog?: string;
  /** The page dies on this STATE read (eval fails, page comes back blank) — renderer crash/recycle. */
  crashAtState?: number;
  /** The Settings menu item only shows up after the menu was opened this many times (seen on the VPS: 1 in 10 reads). */
  menuAfterOpens?: number;
}
interface State {
  media: { tid: string; hasVideo: boolean; src: string; vSrc: string; iSrc: string; w: number; h: number }[];
  stop: boolean;
  agentCount: number;
  agentText: string;
  path: string;
  login: boolean;
  tail: string;
}
const BASE: State = { media: [], stop: false, agentCount: 0, agentText: "", path: "/thread/new", login: false, tail: "" };

function fakePage(scene: Scene) {
  let value = "";
  let clicked = 0;
  let opens = 0;
  let stateIdx = 0;
  let cur = "https://muse.ai/thread/new";
  const log: string[] = [];
  const page: PageCtl = {
    url: () => cur,
    load: async (u) => {
      log.push("load " + u);
      cur = u;
    },
    clickAt: async () => void log.push("clickAt"),
    setFiles: async () => true,
    insertText: async () => undefined,
    pressEscape: async () => void log.push("esc"),
    click: async (sel) => {
      log.push("click " + sel);
      if (sel.includes("muse4ai-send")) clicked++;
      return true;
    },
    eval: async <T,>(code: string): Promise<T> => {
      const r = (v: unknown) => v as T;
      if (code.includes("/api/session")) return r(scene.session ?? { status: 200, body: { status: "assigned", vm_state: "RUNNING" } });
      if (code.includes("data-hatch-shell-hydration-state") && code.includes("hasTextarea")) return r({ ready: scene.ready ?? true, login: !!scene.login, loginText: "", hasBody: true, hasTextarea: true });
      if (code.includes("data-muse4ai-send")) return r(scene.send ?? "ready");
      if (code.includes("HTMLTextAreaElement.prototype")) {
        value = JSON.parse(code.slice(code.lastIndexOf(",") + 1, -1));
        return r(true);
      }
      if (code.includes(".value || \"\"")) return r(value);
      if (code.includes("overflowY")) return r(1);
      if (code.includes("agentCount")) {
        if (!clicked) return r({ ...BASE });
        if (scene.crashAtState !== undefined && stateIdx === scene.crashAtState) {
          stateIdx++;
          cur = "about:blank";
          throw new Error("page closed");
        }
        const list = scene.states ?? [];
        const s = list[Math.min(stateIdx, list.length - 1)] ?? {};
        stateIdx++;
        if (s.path) cur = "https://muse.ai" + s.path;
        return r({ ...BASE, ...s });
      }
      if (code.includes("querySelectorAll(sel.dialog)")) return r(scene.dialog ?? "");
      if (code.includes("querySelectorAll(sel.settingsDock)")) {
        opens++;
        return r({ x: 10, y: 10 });
      }
      if (code.includes("[role=menu] button")) return r(opens >= (scene.menuAfterOpens ?? 1) ? { x: 10, y: 10 } : null);
      return r(null);
    },
  };
  return { page, log, clicks: () => clicked };
}

let clock = 0;
const mk = (scene: Scene) => {
  const f = fakePage(scene);
  const d = new MuseDriver({
    page: () => f.page,
    exitIp: async () => ({ ip: "1.1.1.1", country: "US" }),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { d, ...f };
};
const spec = { jobId: "j1", kind: "image" as const, mode: "text" as const, prompt: "a cat", referencePaths: [] };
const hooks = () => ({ signal: new AbortController().signal, onBeforeSend: () => undefined });

describe("pickSource — strict per-kind matching (muse2api)", () => {
  const cover = { tid: "hatch-chat-attachment-presentation-video", hasVideo: false, src: "blob:cover", vSrc: "", iSrc: "blob:cover", w: 1280, h: 720 };
  it("never accepts a video cover image as the video", () => {
    expect(pickSource(cover, "video")).toBe("");
  });
  it("accepts a real video source", () => {
    expect(pickSource({ ...cover, hasVideo: true, vSrc: "blob:v", src: "blob:v" }, "video")).toBe("blob:v");
  });
  it("does not deliver a video for an image job", () => {
    expect(pickSource({ ...cover, hasVideo: true, vSrc: "blob:v", src: "blob:v" }, "image")).toBe("");
    expect(pickSource({ ...cover, tid: "hatch-chat-attachment-presentation-image", iSrc: "blob:i", src: "blob:i" }, "image")).toBe("blob:i");
  });
});

describe("MuseDriver.checkSession", () => {
  it("401 means the login expired", async () => {
    await expect(mk({ session: { status: 401, body: null } }).d.checkSession()).rejects.toMatchObject({ cls: "SESSION_EXPIRED" });
  });
  it("403 means checkpoint / access restricted", async () => {
    await expect(mk({ session: { status: 403, body: null } }).d.checkSession()).rejects.toMatchObject({ cls: "CHECKPOINT" });
  });
  it("an unexpected answer without login proof is transient, not a logout", async () => {
    await expect(mk({ session: { status: 200, body: { status: "pending" } } }).d.checkSession()).rejects.toMatchObject({ cls: "PRE_SUBMIT_TRANSIENT" });
  });
});

describe("MuseDriver.submit", () => {
  it("sends exactly once and returns the new thread as remote ref", async () => {
    const m = mk({ states: [{ path: "/thread/5f0c2a7e-1b2c-4d5e-8f90-1234567890ab", stop: true }] });
    const r = await m.d.submit(spec, hooks());
    expect(r.remoteRef).toBe("/thread/5f0c2a7e-1b2c-4d5e-8f90-1234567890ab");
    expect(m.clicks()).toBe(1);
  });
  it("a missing send button is a UI change and nothing is sent", async () => {
    const m = mk({ send: "no-button" });
    await expect(m.d.submit(spec, hooks())).rejects.toMatchObject({ cls: "UI_CHANGED" });
    expect(m.clicks()).toBe(0);
  });
  it("no confirmation after the click is ambiguous and marked as sent (never resent)", async () => {
    const m = mk({ states: [{}] });
    const e = await m.d.submit(spec, hooks()).catch((x) => x);
    expect(e).toBeInstanceOf(AdapterError);
    expect(e.cls).toBe("AMBIGUOUS_SUBMIT");
    expect(e.detail.afterSend).toBe(true);
    expect(m.clicks()).toBe(1);
  });
});

describe("MuseDriver.observe", () => {
  const ref = "/thread/5f0c2a7e-1b2c-4d5e-8f90-1234567890ab";
  const img = { tid: "hatch-chat-attachment-presentation-image", hasVideo: false, src: "blob:img", vSrc: "", iSrc: "blob:img", w: 1920, h: 1280 };
  const obs = async (scene: Scene, kind: "image" | "video" = "image", timeoutMs = 600_000) => {
    const m = mk({ ...scene, states: [{ path: ref, stop: true }, ...(scene.states ?? [])] });
    await m.d.submit({ ...spec, kind }, hooks());
    return m.d.observe(ref, kind, { signal: new AbortController().signal, timeoutMs });
  };
  it("returns the sized image once the agent finished", async () => {
    const r = await obs({ states: [{ path: ref, agentCount: 1, media: [img] }] });
    expect(r.media).toEqual([{ src: "blob:img", kind: "image", width: 1920, height: 1280 }]);
  });
  it("a text-only reply that stays the same becomes CONTENT_REFUSED with Muse's words, after one fresh look at the thread", async () => {
    const m = mk({ states: [{ path: ref, stop: true }, { path: ref, agentCount: 1, agentText: "I can't help with that." }] });
    await m.d.submit(spec, hooks());
    await expect(m.d.observe(ref, "image", { signal: new AbortController().signal, timeoutMs: 600_000 })).rejects.toMatchObject({ cls: "CONTENT_REFUSED" });
    expect(m.log.filter((l) => l === "load https://muse.ai" + ref)).toHaveLength(1);
  });
  it("reply in but the attachment only shows after re-opening the thread → result collected, not a refusal (VPS 27/10)", async () => {
    const offer = { path: ref, agentCount: 1, agentText: "Want me to animate this one next?\n\nAnimate it with gentle steam rising" };
    const m = mk({ states: [{ path: ref, stop: true }, ...Array.from({ length: 14 }, () => offer), { ...offer, media: [img] }] });
    await m.d.submit(spec, hooks());
    const r = await m.d.observe(ref, "image", { signal: new AbortController().signal, timeoutMs: 600_000 });
    expect(r.media).toEqual([{ src: "blob:img", kind: "image", width: 1920, height: 1280 }]);
    expect(m.log.filter((l) => l === "load https://muse.ai" + ref)).toHaveLength(1);
  });
  it("Muse's follow-up offer without any attachment is never a refusal (keeps waiting → ambiguous at the timeout)", async () => {
    for (const t of ["Want me to animate this one next?", "Want me to bring it to life next?\n\nTurn this into a short video"]) {
      await expect(obs({ states: [{ path: ref, agentCount: 1, agentText: t }] }, "image", 120_000)).rejects.toMatchObject({ cls: "AMBIGUOUS_SUBMIT" });
    }
  });
  it("a reply that reports a produced file is not a refusal (keeps waiting)", async () => {
    await expect(obs({ states: [{ path: ref, agentCount: 1, agentText: "Saved as output.webp" }] }, "image", 60_000)).rejects.toMatchObject({ cls: "AMBIGUOUS_SUBMIT" });
  });
  it("quota text in the finished reply becomes QUOTA_LIMIT", async () => {
    await expect(obs({ states: [{ path: ref, agentCount: 1, agentText: "You've reached your weekly limit reached." }] })).rejects.toMatchObject({ cls: "QUOTA_LIMIT" });
  });
  it("video: 'Still sending' for 2 minutes is not judged undelivered yet (waits until timeout instead)", async () => {
    await expect(obs({ states: [{ path: ref, stop: true, tail: "Still sending…" }] }, "video", 120_000)).rejects.not.toMatchObject({ message: expect.stringContaining("Still sending") });
  });
  it("video: 'Delivery not confirmed' after 4 minutes with no reply is undelivered", async () => {
    await expect(obs({ states: [{ path: ref, stop: true, tail: "Delivery not confirmed" }] }, "video", 600_000)).rejects.toMatchObject({ cls: "AMBIGUOUS_SUBMIT", message: expect.stringContaining("Still sending") });
  });
  it("'Still sending' with no agent reply after 30 s is ambiguous", async () => {
    await expect(obs({ states: [{ path: ref, stop: true, tail: "Still sending…" }] })).rejects.toMatchObject({ cls: "AMBIGUOUS_SUBMIT" });
  });
  it("account page rebuilt mid-wait (crash) → reopens this job's thread and still collects the result", async () => {
    const m = mk({ crashAtState: 2, states: [{ path: ref, stop: true }, { path: ref, stop: true }, { path: ref, stop: true }, { path: ref, agentCount: 1, media: [img] }] });
    await m.d.submit(spec, hooks());
    const r = await m.d.observe(ref, "image", { signal: new AbortController().signal, timeoutMs: 600_000 });
    expect(r.media[0].src).toBe("blob:img");
    expect(m.log.filter((l) => l === "load https://muse.ai" + ref)).toHaveLength(1);
  });
  it("login page while waiting → session expired, after send", async () => {
    await expect(obs({ states: [{ path: ref, login: true }] })).rejects.toMatchObject({ cls: "SESSION_EXPIRED", detail: { afterSend: true } });
  });
});

describe("MuseDriver.readQuota", () => {
  it("reads the Usage panel and closes menus afterwards", async () => {
    const m = mk({ dialog: "Account\nUsage\nFree plan\nWeekly limit resets on Nov 2\n5% used\nLanguage\nEnglish" });
    const q = await m.d.readQuota();
    expect(q).toMatchObject({ plan: "Free plan", resetsOn: "Nov 2", usedPercent: 5 });
    expect(m.log.filter((l) => l === "esc").length).toBeGreaterThanOrEqual(4);
  });
  it("Settings item missing on the first open → menus closed, opened once more, read succeeds; still missing → UI_CHANGED", async () => {
    const dialog = "Usage\nFree plan\nWeekly limit resets on Nov 2\n51% used\nAdditional tokens\nNever expires\n0% used (5B tokens left)\nLanguage";
    const m = mk({ dialog, menuAfterOpens: 2 });
    await expect(m.d.readQuota()).resolves.toMatchObject({ usedPercent: 51, additional: { remainingLabel: "5B tokens left" } });
    await expect(mk({ dialog, menuAfterOpens: 3 }).d.readQuota()).rejects.toMatchObject({ cls: "UI_CHANGED", message: "Không thấy mục Settings của Muse" });
  });
  it("a panel without a valid percentage is not a successful read", async () => {
    await expect(mk({ dialog: "Usage\nFree plan\n140% used" }).d.readQuota()).rejects.toMatchObject({ cls: "UI_CHANGED" });
  });
});
