import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixtures } from "../src/main/fixtures";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fx-"));

describe("test-mode fixtures (documentation lab)", () => {
  it("returns the file pinned to the exact prompt, and nothing for another prompt", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "lamp.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46, 1]));
    fs.writeFileSync(path.join(d, "coffee.mp4"), Buffer.from([0, 0, 0, 0x18, 2]));
    fs.writeFileSync(path.join(d, "prompts.json"), JSON.stringify({ "lamp.webp": "A white desk lamp", "coffee.mp4": " Phin coffee dripping ", "../x.webp": "escape", "missing.webp": "gone" }));
    const f = loadFixtures(d)!;
    const lamp = f.forPrompt("A white desk lamp")!;
    expect(lamp.kind).toBe("image");
    expect(lamp.name).toBe("lamp.webp");
    expect(Array.from(lamp.bytes)).toEqual([0x52, 0x49, 0x46, 0x46, 1]);
    expect(f.forPrompt("Phin coffee dripping")!.kind).toBe("video");
    expect(f.forPrompt("A white desk lamp, brighter")).toBeNull();
    // The message the app sends to Muse wraps the prompt in an instruction.
    expect(f.forPrompt("Generate an image: A white desk lamp")!.name).toBe("lamp.webp");
    expect(f.forPrompt("Generate a short video: Phin coffee dripping")!.name).toBe("coffee.mp4");
    expect(f.forPrompt("Generate an image: A white desk lamp at night")).toBeNull();
    expect(f.forPrompt("escape")).toBeNull();
    expect(f.forPrompt("gone")).toBeNull();
  });

  it("without a manifest keeps the old seeded pick with unique trailing bytes", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "a.png"), Buffer.from([0x89, 1, 2]));
    const f = loadFixtures(d)!;
    expect(f.forPrompt("anything")).toBeNull();
    const a = f.pick("image", 1), b = f.pick("image", 2);
    expect(a.length).toBe(7);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(f.pick("video", 1).length).toBe(0);
  });

  it("is off when the folder is missing", () => {
    expect(loadFixtures(undefined)).toBeNull();
    expect(loadFixtures(path.join(os.tmpdir(), "no-such-fixtures-dir-xyz"))).toBeNull();
  });
});

describe("fake UI adapter with pinned fixtures", () => {
  it("downloads the output pinned to the job's own prompt, else the seeded fallback", async () => {
    const { FakeAdapter } = await import("../src/main/adapter/fake");
    const pinned = new Uint8Array([9, 9, 9]);
    const fallback = new Uint8Array([1]);
    const a = new FakeAdapter("acc", {
      submitDelayMs: 0,
      generateDelayMs: 0,
      history: new Map(),
      media: () => fallback,
      mediaForPrompt: (p, kind) => (p === "Phin coffee" && kind === "image" ? pinned : null),
    });
    const hooks = { signal: new AbortController().signal, onBeforeSend: () => undefined } as never;
    const s1 = await a.submit({ prompt: "Phin coffee", kind: "image" } as never, hooks);
    const s2 = await a.submit({ prompt: "Something else", kind: "image" } as never, hooks);
    const sig = new AbortController().signal;
    expect(Array.from(await a.download({ src: `${s1.remoteRef}#0`, kind: "image" } as never, sig))).toEqual([9, 9, 9]);
    expect(Array.from(await a.download({ src: `${s2.remoteRef}#0`, kind: "image" } as never, sig))).toEqual([1]);
  });
});
