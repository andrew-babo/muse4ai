import { describe, expect, it } from "vitest";
import {
  canOpenFile,
  canPreviewText,
  CHAT_OUTPUT_FILE_MAX_BYTES,
  CHAT_PROMPT_MAX,
  CHAT_TEXT_MAX_BYTES,
  checkDocument,
  leafName,
  limitOutputs,
  outputExt,
  samePrompt,
  sanitizeFilename,
  truncateUtf8,
  validateChatPrompt,
} from "../src/shared/chat";

const enc = (s: string) => new TextEncoder().encode(s);

describe("Build 2.0 R81 — chat prompt", () => {
  it("accepts 1–32 000 characters after trimming; 32 001 is refused with the count", () => {
    expect(CHAT_PROMPT_MAX).toBe(32_000);
    expect(validateChatPrompt("a".repeat(32_000))).toEqual({ ok: true, value: "a".repeat(32_000) });
    const r = validateChatPrompt("a".repeat(32_001));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("32.001");
    expect(validateChatPrompt("   ").ok).toBe(false);
    expect(validateChatPrompt(42).ok).toBe(false);
  });
  it("counts characters, not UTF-16 units (an emoji is one character)", () => {
    expect(validateChatPrompt("😀".repeat(32_000)).ok).toBe(true);
  });
  it("keeps the inner text verbatim", () => {
    expect(validateChatPrompt("  dòng 1\n\n  dòng 2  ")).toEqual({ ok: true, value: "dòng 1\n\n  dòng 2" });
  });
});

describe("Build 2.0 R82 — documents are decided by their bytes", () => {
  it("PDF needs %PDF- and %%EOF", () => {
    expect(checkDocument(enc("%PDF-1.7\n...\n%%EOF\n"), "a.pdf")).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkDocument(enc("%PDF-1.7\n... cut"), "a.pdf").ok).toBe(false);
    expect(checkDocument(enc("hello"), "fake.pdf").ok).toBe(false);
  });
  it("CSV/TXT/MD must be UTF-8 without NUL; the extension picks the text type", () => {
    expect(checkDocument(enc("a,b\n1,2\n"), "data.csv")).toEqual({ ok: true, mime: "text/csv" });
    expect(checkDocument(enc("# Tiêu đề"), "note.md")).toEqual({ ok: true, mime: "text/markdown" });
    expect(checkDocument(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc("có BOM")]), "a.txt")).toEqual({ ok: true, mime: "text/plain" });
    expect(checkDocument(Uint8Array.from([0x61, 0x00, 0x62]), "a.txt").ok).toBe(false);
    expect(checkDocument(Uint8Array.from([0xc3, 0x28]), "a.csv").ok).toBe(false);
  });
  it("JSON must parse; an unknown extension is refused; empty files are refused", () => {
    expect(checkDocument(enc('{"a":1}'), "x.json")).toEqual({ ok: true, mime: "application/json" });
    expect(checkDocument(enc("{a:1}"), "x.json").ok).toBe(false);
    expect(checkDocument(enc("MZ..."), "run.exe")).toEqual({ ok: false, error: "Không nhận tệp .exe" });
    expect(checkDocument(new Uint8Array(0), "a.txt").ok).toBe(false);
  });
});

describe("Build 2.0 R82/R84 — file names", () => {
  it("drops folders and reserved characters, keeps the extension, ≤ 120 characters", () => {
    expect(sanitizeFilename("..\\..\\Windows\\evil<>.csv", "csv")).toBe("evil.csv");
    expect(sanitizeFilename("CON.txt", "txt")).toBe("CON-.txt");
    expect(sanitizeFilename("", "pdf", 3)).toBe("tep-3.pdf");
    const long = sanitizeFilename("ả".repeat(300) + ".md", "md");
    expect([...long].length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".md")).toBe(true);
  });
  it("only safe types open from the app; risky ones only show the folder", () => {
    expect(canOpenFile("bao-cao.pdf")).toBe(true);
    expect(canOpenFile("a.exe")).toBe(false);
    expect(canOpenFile("a.html")).toBe(false);
    expect(canOpenFile("a.ps1")).toBe(false);
    expect(canPreviewText("a.csv", 2 * 1024 * 1024)).toBe(true);
    expect(canPreviewText("a.csv", 2 * 1024 * 1024 + 1)).toBe(false);
  });
  it("output extension prefers the sniffed type, then the declared name/MIME", () => {
    expect(outputExt("png", "x.jpg", null)).toBe("png");
    expect(outputExt(null, "/workspace/out/report.csv", null)).toBe("csv");
    expect(outputExt(null, null, "application/json")).toBe("json");
    expect(outputExt(null, null, "application/x-whatever")).toBe("bin");
    expect(leafName("/workspace/out/b%C3%A1o%20c%C3%A1o.csv?x=1")).toBe("báo cáo.csv");
  });
});

describe("Build 2.0 R83 — answer and output limits", () => {
  it("text above 1 MiB is cut at a character boundary", () => {
    const t = "ệ".repeat(CHAT_TEXT_MAX_BYTES); // 3 bytes each
    const r = truncateUtf8(t);
    expect(r.truncated).toBe(true);
    expect(enc(r.text).length).toBeLessThanOrEqual(CHAT_TEXT_MAX_BYTES);
    expect(r.text.endsWith("ệ")).toBe(true);
    expect(truncateUtf8("ngắn")).toEqual({ text: "ngắn", truncated: false });
  });
  it("keeps 20 files in Muse's order, skips duplicates and files above 1 GiB, and reports truncation", () => {
    const files = Array.from({ length: 22 }, (_, i) => ({ path: `/w/${i}.png`, mime: "image/png", byteLen: 10 }));
    const r = limitOutputs([files[0], ...files]);
    expect(r.kept).toHaveLength(20);
    expect(r.kept[0].path).toBe("/w/0.png");
    expect(r.truncated).toBe(true);
    const big = limitOutputs([{ path: "/w/big.mp4", mime: "video/mp4", byteLen: CHAT_OUTPUT_FILE_MAX_BYTES + 1 }, { path: "/w/a.csv", mime: "text/csv", byteLen: 5 }]);
    expect(big.kept.map((f) => f.path)).toEqual(["/w/a.csv"]);
    expect(big.truncated).toBe(true);
  });
  it("prompt match for reconciliation ignores Muse's prefixes and outer whitespace only", () => {
    expect(samePrompt("Xin chào  ", "  Xin chào")).toBe(true);
    expect(samePrompt("Xin chào", "User message: Xin chào")).toBe(true);
    expect(samePrompt("Xin chào", "Xin chào!")).toBe(false);
  });
});
