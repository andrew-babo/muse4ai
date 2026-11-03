import { describe, expect, it } from "vitest";
import { MuseDriver, type PageCtl } from "../src/main/adapter/muse/driver";
import { TIMEOUTS } from "../src/main/adapter/muse/selectors";
import {
  attributeMuseExtend,
  buildMuseExtendMessage,
  findMuseAcceptedTurn,
  museHistoryShown,
  museSnapshotKey,
  museThreadReadiness,
  type MuseCheckpoint,
  type MuseItem,
  type MuseSnapshot,
} from "../src/shared/museExtend";

// AC-MEX-27/28 (spec rev 7.2, R67/R68): a reopened Muse thread shows the composer before its history, the source
// clip streams in after that, and the user bubble carries a screen-reader “You:” label (reference VPS 28/10/2026).

const THREAD = "/thread/e4826d46-06be-406e-b588-4dd9e096d49a";
const OUT = "sandbox://workspace/imagine_media/clip-0.mp4";
const SOURCE = { conversation: THREAD, turn: "a2", output: OUT };
const user = (id: string, text: string): MuseItem => ({ role: "user", id, turn: id, text, media: [] });
const agent = (id: string, text = "", media: { output: string; src: string }[] = []): MuseItem => ({
  role: "assistant",
  id,
  turn: "g1",
  text,
  media: media.map((m) => ({ ...m, width: m.src ? 1280 : 0, height: m.src ? 720 : 0 })),
});
const ROOT = [user("u1", "Generate a short video: puppy"), agent("a1", "Here's your video"), agent("a2", "", [{ output: OUT, src: "blob:1" }])];
const snap = (items: MuseItem[], stop = false): MuseSnapshot => ({ conversation: THREAD, items, stop });
const reads = (...s: MuseSnapshot[]) => s.filter(museHistoryShown).map((x) => ({ snapshot: x, key: museSnapshotKey(x) }));

describe("R67: pre-send read of a reopened thread", () => {
  it("an empty list (history not rendered yet) is never judged — even twice in a row", () => {
    expect(museThreadReadiness(reads(snap([]), snap([])), SOURCE, false)).toBe("wait");
    expect(museThreadReadiness(reads(snap([]), snap([])), SOURCE, true)).toBe("loading");
  });
  it("ready only after two identical reads with the source as head and its playback mounted", () => {
    expect(museThreadReadiness(reads(snap(ROOT)), SOURCE, false)).toBe("wait");
    expect(museThreadReadiness(reads(snap(ROOT), snap(ROOT)), SOURCE, false)).toBe("ready");
  });
  it("file locator shown but the clip still streaming → keep waiting; at the deadline judge on the locator", () => {
    const streaming = [ROOT[0], ROOT[1], agent("a2", "", [{ output: OUT, src: "" }])];
    expect(museThreadReadiness(reads(snap(streaming), snap(streaming)), SOURCE, false)).toBe("wait");
    expect(museThreadReadiness(reads(snap(streaming), snap(streaming)), SOURCE, true)).toBe("judge");
  });
  it("a reply still in progress is not ready", () => {
    expect(museThreadReadiness(reads(snap(ROOT, true), snap(ROOT, true)), SOURCE, false)).toBe("wait");
  });
  it("history shown but the source really gone → judged only at the deadline", () => {
    const other = [user("u1", "x"), agent("a9", "", [{ output: "sandbox://workspace/other.mp4", src: "blob:9" }])];
    expect(museThreadReadiness(reads(snap(other), snap(other)), SOURCE, false)).toBe("wait");
    expect(museThreadReadiness(reads(snap(other), snap(other)), SOURCE, true)).toBe("judge");
  });
});

describe("R68: our continuation message is recognised despite the screen-reader label", () => {
  it("“You:” + exact message is accepted; any other text is not", () => {
    const message = buildMuseExtendMessage(OUT, "auto");
    const cp: MuseCheckpoint = { conversation: THREAD, sourceTurn: "a2", sourceOutput: OUT, baselineUsers: ["u1"], baselineAgents: ["a1", "a2"], message, templateVersion: "v1", acceptedUser: null };
    expect(findMuseAcceptedTurn(cp, { conversation: THREAD, users: [{ id: "u1", text: "x" }, { id: "u2", text: `You:\n\n${message}` }], agents: [] })).toBe("u2");
    expect(findMuseAcceptedTurn(cp, { conversation: THREAD, users: [{ id: "u1", text: "x" }, { id: "u2", text: `You:\n\n${message} please` }], agents: [] })).toBeNull();
  });
});

describe("R68: after acceptance our message is followed by its durable id", () => {
  const message = buildMuseExtendMessage(OUT, "auto");
  const cp = (acceptedUser: string | null): MuseCheckpoint => ({ conversation: THREAD, sourceTurn: "a2", sourceOutput: OUT, baselineUsers: ["u1"], baselineAgents: ["a1", "a2"], baselineOutputs: [OUT], message, templateVersion: "v1", acceptedUser });
  it("live 28/10 case: Muse adds 👍 to our bubble while working → still our message, keeps waiting", () => {
    const s = snap([...ROOT, user("u2", `${message} 👍`)], true);
    expect(attributeMuseExtend(cp("u2"), s).kind).toBe("waiting");
  });
  it("…and the new clip is collected once it is playable", () => {
    const s = snap([...ROOT, user("u2", `${message} 👍`), agent("a5", "Extended", [{ output: "sandbox://workspace/clip-20.mp4", src: "blob:20" }])]);
    expect(attributeMuseExtend(cp("u2"), s)).toMatchObject({ kind: "video", answerId: "a5" });
  });
  it("live 28/10 case: Muse swaps the temporary id for its stored id → re-found by exact text, new id followed", () => {
    const s = snap([...ROOT, user("u2-stored", message)], true);
    expect(attributeMuseExtend(cp("u2-temp"), s)).toMatchObject({ kind: "waiting", acceptedUser: "u2-stored" });
  });
  it("recorded id gone and no new message with exactly our text → review", () => {
    expect(attributeMuseExtend(cp("u2-temp"), snap([...ROOT, user("u2-stored", `${message} (edited)`)])).kind).toBe("ambiguous");
  });
  it("before acceptance the text must still match exactly", () => {
    expect(attributeMuseExtend(cp(null), snap([...ROOT, user("u2", `${message} please`)])).kind).toBe("not_accepted");
  });
  it("our id gone, or another new message → review, never a resend", () => {
    expect(attributeMuseExtend(cp("u2"), snap(ROOT)).kind).toBe("ambiguous");
    expect(attributeMuseExtend(cp("u2"), snap([...ROOT, user("u2", message), user("u3", "hello")])).kind).toBe("ambiguous");
    expect(attributeMuseExtend(cp("u1"), snap(ROOT)).kind).toBe("ambiguous");
  });
});

// ------------------------------------------------------------------ driver level (scripted page)
interface Script {
  /** TURNS reads before the send click, in order (the last one repeats). `null` = the page did not answer. */
  before: (MuseSnapshot | null)[];
  /** TURNS reads after the click. */
  after?: MuseSnapshot[];
  /** Page URL when the step starts (default: Muse home). */
  startAt?: string;
  /** Make loading the thread fail like a dead proxy. */
  loadFails?: boolean;
}

function scripted(script: Script) {
  let value = "";
  let clicks = 0;
  let bi = 0;
  let ai = 0;
  let cur = script.startAt ?? "https://muse.ai/";
  const loads: string[] = [];
  const turnsOf = (s: MuseSnapshot) => ({
    conversation: s.conversation,
    items: s.items,
    users: s.items.filter((i) => i.role === "user").map((i) => ({ id: i.id, text: i.text })),
    agents: s.items.filter((i) => i.role === "assistant").map((i) => ({ id: i.id, turn: i.turn, text: i.text, media: i.media })),
    stop: s.stop,
  });
  const page: PageCtl = {
    url: () => cur,
    load: async (u) => {
      loads.push(u);
      if (script.loadFails && u.includes("/thread/")) throw new Error("net::ERR_PROXY_CONNECTION_FAILED");
      cur = u;
    },
    clickAt: async () => undefined,
    setFiles: async () => true,
    insertText: async () => undefined,
    pressEscape: async () => undefined,
    click: async (sel) => {
      if (sel.includes("muse4ai-send")) clicks++;
      return true;
    },
    eval: async <T,>(code: string): Promise<T> => {
      const r = (v: unknown) => v as T;
      if (code.includes("/api/session")) return r({ status: 200, body: { status: "assigned", vm_state: "RUNNING" } });
      if (code.includes("data-hatch-shell-hydration-state") && code.includes("hasTextarea")) return r({ ready: true, login: false, loginText: "", hasBody: true, hasTextarea: true });
      if (code.includes("data-muse4ai-send")) return r("ready");
      if (code.includes("HTMLTextAreaElement.prototype")) {
        // last argument = the JSON-encoded message (it may itself contain commas)
        for (let i = code.lastIndexOf(","); i > 0; i = code.lastIndexOf(",", i - 1)) {
          try {
            const v = JSON.parse(code.slice(i + 1, -1));
            if (typeof v === "string") {
              value = v;
              break;
            }
          } catch {
            /* keep scanning left */
          }
        }
        return r(true);
      }
      if (code.includes('.value || ""')) return r(value);
      if (code.includes("overflowY")) return r(1);
      if (code.includes("data-message-item")) {
        if (!clicks) {
          const s = script.before[Math.min(bi++, script.before.length - 1)];
          if (s === null) throw new Error("page did not answer in time");
          return r(turnsOf(s));
        }
        const list = script.after ?? [];
        return r(turnsOf(list[Math.min(ai++, list.length - 1)]));
      }
      return r(null);
    },
  };
  let clock = 0;
  const d = new MuseDriver({ page: () => page, exitIp: async () => ({ ip: "1.1.1.1", country: "US" }), now: () => clock, sleep: async (ms) => void (clock += ms) });
  return { d, clicks: () => clicks, loads, elapsed: () => clock };
}

const hooks = () => ({ signal: new AbortController().signal, onBeforeSend: () => undefined, onCheckpoint: () => undefined });
const sentMessage = buildMuseExtendMessage(OUT, "auto");
const accepted = snap([...ROOT, user("u2", `You:\n\n${sentMessage}`)]);

describe("MuseDriver.submitExtend on a reopened thread", () => {
  it("live 28/10 case: empty list for 5 s, then history while the clip streams, page busy → waits, sends exactly once, recognises the message", async () => {
    const streaming = snap([ROOT[0], ROOT[1], agent("a2", "", [{ output: OUT, src: "" }])]);
    const m = scripted({ before: [snap([]), snap([]), snap([]), snap([]), snap([]), streaming, streaming, null, null, snap(ROOT), snap(ROOT)], after: [accepted] });
    const cp = await m.d.submitExtend(SOURCE, "auto", null, hooks());
    expect(m.clicks()).toBe(1);
    expect(cp.acceptedUser).toBe("u2");
    expect(cp.baselineUsers).toEqual(["u1"]);
  });
  it("history never renders → transient before sending (job retries later), nothing sent", async () => {
    const m = scripted({ before: [snap([])] });
    await expect(m.d.submitExtend(SOURCE, "auto", null, hooks())).rejects.toMatchObject({ cls: "PRE_SUBMIT_TRANSIENT" });
    expect(m.clicks()).toBe(0);
    expect(m.elapsed()).toBeGreaterThanOrEqual(TIMEOUTS.threadSettle);
  });
  it("history stable but the source is really gone → definitive stop at the deadline, nothing sent", async () => {
    const other = snap([user("u1", "x"), agent("a9", "", [{ output: "sandbox://workspace/other.mp4", src: "blob:9" }])]);
    const m = scripted({ before: [snap([]), other] });
    await expect(m.d.submitExtend(SOURCE, "auto", null, hooks())).rejects.toMatchObject({ cls: "UNKNOWN", message: "Không còn thấy video nguồn trong hội thoại Muse" });
    expect(m.clicks()).toBe(0);
  });
});

describe("MuseDriver.submitExtend — next step of a chain", () => {
  it("page already on the thread with the new head playing → no reload, sent within seconds", async () => {
    const m = scripted({ startAt: "https://muse.ai" + THREAD, before: [snap(ROOT)], after: [accepted] });
    const cp = await m.d.submitExtend(SOURCE, "auto", null, hooks());
    expect(m.loads).toEqual([]);
    expect(m.clicks()).toBe(1);
    expect(cp.acceptedUser).toBe("u2");
    expect(m.elapsed()).toBeLessThan(5_000);
  });
  it("opening the thread fails before anything is sent → a pre-send error, not “after send”", async () => {
    const m = scripted({ before: [snap(ROOT)], loadFails: true });
    const err = await m.d.submitExtend(SOURCE, "auto", null, hooks()).catch((e) => e);
    expect(err.detail?.afterSend).toBeFalsy();
    expect(m.clicks()).toBe(0);
  });
});

describe("MuseDriver.observeExtend after a reload", () => {
  it("an empty or briefly partial list right after reopening is not “message gone”; the result is collected", async () => {
    const cp: MuseCheckpoint = { conversation: THREAD, sourceTurn: "a2", sourceOutput: OUT, baselineUsers: ["u1"], baselineAgents: ["a1", "a2"], baselineOutputs: [OUT], message: sentMessage, templateVersion: "v1", acceptedUser: "u2" };
    const partial = snap([ROOT[0], ROOT[1]]);
    const done = snap([...accepted.items, agent("a5", "Extended to 20 s", [{ output: "sandbox://workspace/clip-20.mp4", src: "blob:20" }])]);
    const m = scripted({ before: [snap([]), snap([]), partial, done, done, done] });
    const r = await m.d.observeExtend(cp, { signal: new AbortController().signal, timeoutMs: 600_000, onCheckpoint: () => undefined });
    expect(r.media[0].museSource).toEqual({ conversation: THREAD, turn: "a5", output: "sandbox://workspace/clip-20.mp4" });
    expect(m.loads).toEqual(["https://muse.ai" + THREAD]);
  });
  it("id swap while observing: the stored id is recorded and the result collected", async () => {
    const cp: MuseCheckpoint = { conversation: THREAD, sourceTurn: "a2", sourceOutput: OUT, baselineUsers: ["u1"], baselineAgents: ["a1", "a2"], baselineOutputs: [OUT], message: sentMessage, templateVersion: "v1", acceptedUser: "u2-temp" };
    const stored = [...ROOT, user("u2-stored", sentMessage)];
    const done = snap([...stored, agent("a5", "Extended to 20 s", [{ output: "sandbox://workspace/clip-20.mp4", src: "blob:20" }])]);
    const m = scripted({ startAt: "https://muse.ai" + THREAD, before: [snap(stored, true), done, done, done] });
    const saved: (string | null)[] = [];
    const r = await m.d.observeExtend(cp, { signal: new AbortController().signal, timeoutMs: 600_000, onCheckpoint: (c) => saved.push(c.acceptedUser) });
    expect(saved).toEqual(["u2-stored"]);
    expect(r.media[0].museSource?.turn).toBe("a5");
  });
  it("an ambiguity that persists still goes to review (never a resend)", async () => {
    const cp: MuseCheckpoint = { conversation: THREAD, sourceTurn: "a2", sourceOutput: OUT, baselineUsers: ["u1"], baselineAgents: ["a1", "a2"], baselineOutputs: [OUT], message: sentMessage, templateVersion: "v1", acceptedUser: "u2" };
    const m = scripted({ before: [snap(ROOT)] });
    await expect(m.d.observeExtend(cp, { signal: new AbortController().signal, timeoutMs: 600_000, onCheckpoint: () => undefined })).rejects.toMatchObject({ cls: "AMBIGUOUS_SUBMIT", detail: { afterSend: true } });
  });
});
