import { describe, expect, it } from "vitest";
import { nextBusyConversations, safeHttpUrl, splitAnswer, splitLinks } from "../src/shared/chat";
import { bridgeCheckLine } from "../src/shared/execution";

// Build 2.0 AC-VIEW-04 / R85 — the pure rules behind the Hỏi đáp answer view and the “Hỏi tiếp” state.
describe("AC-VIEW-04 answer rendering rules", () => {
  it("keeps HTML as text and fenced code as one monospace part", () => {
    const text = 'Xem <img src=x onerror=alert(1)> rồi chạy:\n```python\nprint("hi")\nx = 1\n```\nXong.';
    const parts = splitAnswer(text);
    expect(parts).toEqual([
      { kind: "text", text: "Xem <img src=x onerror=alert(1)> rồi chạy:\n" },
      { kind: "code", text: 'print("hi")\nx = 1', lang: "python" },
      { kind: "text", text: "\nXong." },
    ]);
  });

  it("leaves an unclosed fence as plain text", () => {
    expect(splitAnswer("```js\nconst a = 1")).toEqual([{ kind: "text", text: "```js\nconst a = 1" }]);
  });

  it("turns only http(s) URLs into links, without trailing punctuation", () => {
    const parts = splitLinks("Nguồn: https://about.fb.com/news/x?a=1). Và javascript:alert(1), file:///C:/a.txt, http://a.b.");
    expect(parts.filter((p) => p.kind === "link").map((p) => p.url)).toEqual(["https://about.fb.com/news/x?a=1", "http://a.b"]);
    expect(parts.map((p) => p.text).join("")).toBe("Nguồn: https://about.fb.com/news/x?a=1). Và javascript:alert(1), file:///C:/a.txt, http://a.b.");
  });

  it("refuses non-http and over-long URLs for app.openUrl", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe(true);
    expect(safeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(safeHttpUrl("file:///C:/Windows")).toBe(false);
    expect(safeHttpUrl(`https://e.com/${"a".repeat(2050)}`)).toBe(false);
  });
});

describe("R85 conversation busy state for “Hỏi tiếp”", () => {
  it("marks a conversation busy while its continuing job is unfinished, incl. needs_review", () => {
    let busy: Record<string, string> | undefined = {};
    busy = nextBusyConversations(busy, { id: "j2", conversationId: "mc_1", state: "queued" });
    expect(busy).toEqual({ mc_1: "j2" });
    busy = nextBusyConversations(busy, { id: "j2", conversationId: "mc_1", state: "needs_review" });
    expect(busy).toEqual({ mc_1: "j2" });
    busy = nextBusyConversations(busy, { id: "j2", conversationId: "mc_1", state: "completed" });
    expect(busy).toEqual({});
  });

  it("an older finished turn of the same conversation does not clear the newer busy turn", () => {
    const busy = nextBusyConversations({ mc_1: "j2" }, { id: "j1", conversationId: "mc_1", state: "completed" });
    expect(busy).toEqual({ mc_1: "j2" });
  });

  it("a new chat that gets its handle only at completion is never busy", () => {
    expect(nextBusyConversations({}, { id: "j3", conversationId: "mc_9", state: "completed" })).toEqual({});
    expect(nextBusyConversations({}, { id: "j4", conversationId: null, state: "generating" })).toEqual({});
  });
});

describe("S09g check line (R97)", () => {
  const fmt = (ms: number) => `t${ms}`;
  it("no self-check yet while HTTP sends succeed → “not needed”, not “never checked”", () => {
    expect(bridgeCheckLine({ lastCheckAt: null, lastCheckOk: null }, true, fmt)).toBe("Chưa cần tự kiểm · HTTP đang chạy tốt");
  });
  it("no self-check and no healthy account → “never checked”", () => {
    expect(bridgeCheckLine({ lastCheckAt: null, lastCheckOk: null }, false, fmt)).toBe("Chưa tự kiểm lần nào");
    expect(bridgeCheckLine(null, false, fmt)).toBe("Chưa tự kiểm lần nào");
  });
  it("a check ran → its time and result win", () => {
    expect(bridgeCheckLine({ lastCheckAt: 5, lastCheckOk: false }, true, fmt)).toBe("Tự kiểm gần nhất t5 · có lỗi");
    expect(bridgeCheckLine({ lastCheckAt: 7, lastCheckOk: true }, false, fmt)).toBe("Tự kiểm gần nhất t7 · đạt");
  });
});
