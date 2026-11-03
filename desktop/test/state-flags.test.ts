import { describe, it, expect } from "vitest";
import { STATE_FN } from "../src/main/adapter/muse/driver";
import { TEXT } from "../src/main/adapter/muse/selectors";

// Minimal page: chat column shows "Delivery not confirmed", a side panel's long task list ends the body text.
function fakePage(texts: string[], bodyText: string) {
  const g = globalThis as Record<string, unknown>;
  g.NodeFilter = { SHOW_TEXT: 4 };
  g.location = { pathname: "/thread/new" };
  g.document = {
    body: { innerText: bodyText },
    querySelectorAll: () => [],
    querySelector: (s: string) => (s === "TA" ? {} : null),
    createTreeWalker: () => { let i = 0; return { nextNode: () => (i < texts.length ? { nodeValue: texts[i++] } : null) }; },
  };
}

describe("Muse page state: delivery flag behind a side panel", () => {
  it("reports 'Delivery not confirmed' even when it is not in the last 1500 chars of the page", () => {
    const panel = "Generate coffee mug photo\n".repeat(200);
    fakePage(["Edit the attached video", "Delivery not confirmed", ...panel.split("\n")], "Delivery not confirmed\n" + panel);
    const fn = eval(STATE_FN) as (sel: unknown, att: unknown, src: string) => { tail: string };
    const s = fn({ agentBubble: "B", textarea: "TA", stop: "S", loginInput: "L" }, () => [], TEXT.deliveryFailed.source);
    expect(TEXT.deliveryFailed.test(s.tail)).toBe(true);
  });
  it("does not flag a normal page", () => {
    fakePage(["Got it — I'll turn your toy car scene snowy"], "Got it");
    const fn = eval(STATE_FN) as (sel: unknown, att: unknown, src: string) => { tail: string };
    const s = fn({ agentBubble: "B", textarea: "TA", stop: "S", loginInput: "L" }, () => [], TEXT.deliveryFailed.source);
    expect(TEXT.deliveryFailed.test(s.tail)).toBe(false);
  });
});

import { VIDEO_EDIT_TIMEOUT_MS, VIDEO_TIMEOUT_MS } from "../src/shared/constants";
describe("video edit wait", () => {
  it("waits 25 minutes for an uploaded-video edit, 12 for a normal video", () => {
    expect(VIDEO_EDIT_TIMEOUT_MS).toBe(25 * 60_000);
    expect(VIDEO_TIMEOUT_MS).toBe(12 * 60_000);
  });
});
