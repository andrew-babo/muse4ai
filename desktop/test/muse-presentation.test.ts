import { describe, expect, it } from "vitest";
import { MUSE_TURNS_FN, SEL } from "../src/main/adapter/muse/selectors";

// Hand-rolled DOM stand-ins for the in-page script (no jsdom in this package).
interface FakeVideo { closest: (s: string) => unknown; currentSrc: string; videoWidth: number; videoHeight: number; querySelector: () => null }

function presentation(path: string, host: string, missing = false) {
  return { presentationId: "presentation1", hostMessageId: host, presentationMessageId: host, data: { videos: [{ path, missing, mime: "video/mp4", byteLen: 1000 }] } };
}

function wrapper(meta: unknown, video: FakeVideo | null, testid = "hatch-chat-attachment-presentation-video") {
  return {
    __reactFiber_fixture: { memoizedProps: meta ? { presentation: meta } : {} },
    getAttribute: (n: string) => (n === "data-testid" ? testid : null),
    querySelector: (s: string) => (s === "video" ? video : null),
  };
}

function video(src = "blob:ephemeral", w = 1280, h = 720): FakeVideo {
  return { closest: () => null, currentSrc: src, videoWidth: w, videoHeight: h, querySelector: () => null };
}

function assistant(id: string, wrappers: ReturnType<typeof wrapper>[], looseVideos: FakeVideo[] = []) {
  const vids: FakeVideo[] = [];
  for (const w of wrappers) {
    const v = w.querySelector("video") as FakeVideo | null;
    if (v) {
      v.closest = () => w;
      vids.push(v);
    }
  }
  vids.push(...looseVideos);
  return {
    getAttribute: (name: string) => ({ "data-message-id": id, "data-message-role": "assistant", "data-message-turn-id": "group1" })[name] ?? null,
    innerText: "Done",
    querySelector: () => null,
    querySelectorAll: (s: string) => (s === SEL.attachment ? wrappers : s === "video" ? vids : []),
  };
}

function userMessage(id: string, text: string, label = "You:", reaction = "") {
  const sr = { innerText: label, textContent: label, contains: () => false };
  const chip = { innerText: reaction, textContent: reaction, contains: () => false };
  const extra = [...(label ? [sr] : []), ...(reaction ? [chip] : [])];
  const bubble = { innerText: (label ? `${label}\n\n${text}` : text) + (reaction ? `\n\n${reaction}` : ""), querySelectorAll: () => extra };
  return {
    getAttribute: (name: string) => ({ "data-message-id": id, "data-message-role": "user", "data-message-turn-id": id })[name] ?? null,
    innerText: bubble.innerText,
    querySelector: (s: string) => (s === SEL.userBubble ? bubble : null),
    querySelectorAll: () => [],
  };
}

type Turns = { items: { role: string; id: string; text: string; media: { output: string; src: string; width: number; height: number }[] }[]; users: { id: string; text: string }[] };

function run(messages: unknown[]): Turns {
  const document = { querySelectorAll: () => messages, querySelector: () => null };
  return new Function("document", "location", "sel", `return (${MUSE_TURNS_FN})(sel)`)(document, { pathname: "/thread/fixture" }, SEL);
}

function extract(path: string, host = "assistant1", missing = false, hasMetadata = true) {
  return run([assistant("assistant1", [wrapper(hasMetadata ? presentation(path, host, missing) : null, video())])]).items[0].media[0].output;
}

describe("Muse presentation provenance", () => {
  it("uses sandbox file path, not changing blob playback URLs", () => {
    expect(extract("sandbox://workspace/generated/final.mp4")).toBe("sandbox://workspace/generated/final.mp4");
  });
  it("rejects metadata belonging to a different message", () => {
    expect(extract("sandbox://workspace/generated/final.mp4", "other-message")).toBe("");
  });
  it("fails closed for missing files or unavailable presentation metadata", () => {
    expect(extract("sandbox://workspace/generated/final.mp4", "assistant1", true)).toBe("");
    expect(extract("sandbox://workspace/generated/final.mp4", "assistant1", false, false)).toBe("");
  });
  it("rejects external, traversal and encoded locators", () => {
    for (const path of ["https://example.com/final.mp4", "sandbox:///../final.mp4", "sandbox:///%2e%2e/final.mp4", "sandbox:///x?token.mp4"]) expect(extract(path)).toBe("");
  });
});

describe("Reopened thread (reference VPS 28/10/2026)", () => {
  const path = "sandbox://workspace/imagine_media/clip.mp4";
  it("reads the file locator from the attachment before its <video> has streamed in (no playback yet)", () => {
    const t = run([assistant("assistant1", [wrapper(presentation(path, "assistant1"), null)])]);
    expect(t.items[0].media).toEqual([{ output: path, src: "", width: 0, height: 0 }]);
  });
  it("one entry per attachment once playback mounts (no duplicate from the inner <video>)", () => {
    const t = run([assistant("assistant1", [wrapper(presentation(path, "assistant1"), video("blob:v"))])]);
    expect(t.items[0].media).toEqual([{ output: path, src: "blob:v", width: 1280, height: 720 }]);
  });
  it("a video outside any attachment still counts (as a file without a locator)", () => {
    const t = run([assistant("assistant1", [], [video("blob:loose")])]);
    expect(t.items[0].media).toEqual([{ output: "", src: "blob:loose", width: 1280, height: 720 }]);
  });
  it("image attachments are not video media", () => {
    const t = run([assistant("assistant1", [wrapper(presentation(path, "assistant1"), null, "hatch-chat-attachment-presentation-image")])]);
    expect(t.items[0].media).toEqual([]);
  });
  it("the user's text drops Muse's screen-reader “You:” label", () => {
    const t = run([userMessage("u1", "Extend the exact video \"x\" above by about 10 seconds.")]);
    expect(t.users).toEqual([{ id: "u1", text: "Extend the exact video \"x\" above by about 10 seconds." }]);
  });
  it("Muse's “Assistant reaction” chip (👍) added while it works is not part of the text", () => {
    const t = run([userMessage("u1", "Extend the exact video above.", "You:", "👍")]);
    expect(t.users[0].text).toBe("Extend the exact video above.");
  });
  it("a bubble without a label keeps its text as typed", () => {
    const t = run([userMessage("u1", "You: is part of my prompt", "")]);
    expect(t.users[0].text).toBe("You: is part of my prompt");
  });
});
