import { describe, expect, it } from "vitest";
import { parseMarkdown, plainText } from "../src/shared/markdown";

describe("Muse answer Markdown", () => {
  it("bold markers never show as ** in a heading-like line", () => {
    const b = parseMarkdown("**1. Tin hot toàn cầu**\n- **Anthropic:** nghiên cứu");
    expect(b[0]).toEqual({ t: "p", c: [{ t: "strong", c: [{ t: "text", v: "1. Tin hot toàn cầu" }] }] });
    expect(b[1].t).toBe("ul");
  });
  it("widget token becomes a widget block, not raw text", () => {
    const b = parseMarkdown("Xin chào\n\n[[hatch_widget:widget-e0bf7453-b16e]]");
    expect(b.map((x) => x.t)).toEqual(["p", "widget"]);
  });
  it("HTML stays literal text", () => {
    const b = parseMarkdown("<img src=x onerror=alert(1)>");
    expect(b).toEqual([{ t: "p", c: [{ t: "text", v: "<img src=x onerror=alert(1)>" }] }]);
  });
  it("bold-only line followed by text splits into title + paragraph", () => {
    expect(parseMarkdown("**3. Viral**\nThí nghiệm").map((x) => x.t)).toEqual(["p", "p"]);
  });
  it("tables and ordered lists parse", () => {
    const b = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n3. x\n4. y");
    expect(b[0]).toMatchObject({ t: "table", rows: [[[{ v: "1" }], [{ v: "2" }]]] });
    expect(b[1]).toMatchObject({ t: "ol", start: 3 });
  });
  it("copy text drops markers", () => {
    expect(plainText("**A** và *b*\n[[hatch_widget:w-1]]")).toBe("A và b");
  });
});
