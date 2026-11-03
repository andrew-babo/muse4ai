import fs from "node:fs";
import path from "node:path";
import type { JobKind } from "../shared/types";

/**
 * Test-mode media fixtures (MUSE4AI_FIXTURES): decodable images/videos the fake Muse returns so thumbnails, previews and
 * the probe behave like real output. An optional `prompts.json` ({ "<file>": "<exact prompt>" }) pins a file to the
 * prompt that produced it, so a documentation lab shows each real Muse output next to its own prompt.
 */
export interface Fixtures {
  pick: (kind: JobKind, seed: number) => Uint8Array;
  byDuration: (durationMs: number, seed: number) => Uint8Array;
  /** The pinned file for this exact prompt (whitespace-trimmed; also when the app's "<instruction>: " prefix wraps it), or null. */
  forPrompt: (prompt: string) => { kind: "image" | "video"; bytes: Uint8Array; name: string } | null;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|webm)$/i;

export function loadFixtures(dir: string | undefined): Fixtures | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).sort();
  const images = files.filter((f) => IMAGE.test(f)).map((f) => fs.readFileSync(path.join(dir, f)));
  const videoFiles = files.filter((f) => VIDEO.test(f));
  const videos = videoFiles.map((f) => fs.readFileSync(path.join(dir, f)));
  // Vibes fake: fixtures named “…-15s.mp4” stand for a 15-second output (Kéo dài grows the video step by step).
  const timed = videoFiles
    .map((f, i) => ({ ms: Number(/-(\d+)s\.(mp4|webm)$/i.exec(f)?.[1] ?? NaN) * 1000, bytes: videos[i] }))
    .filter((v) => Number.isFinite(v.ms))
    .sort((a, b) => a.ms - b.ms);
  const unique = (base: Uint8Array, seed: number) => {
    // Append a few bytes so every result has a unique hash (trailing data is ignored by decoders).
    const out = new Uint8Array(base.length + 4);
    out.set(base);
    new DataView(out.buffer).setUint32(base.length, seed >>> 0);
    return out;
  };
  const pick = (kind: JobKind, seed: number) => {
    const list = kind === "video" ? videos : images;
    if (!list.length) return new Uint8Array();
    return unique(list[seed % list.length], seed);
  };
  const pinned = new Map<string, { kind: "image" | "video"; file: string }>();
  const manifest = path.join(dir, "prompts.json");
  if (fs.existsSync(manifest)) {
    const raw = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
    for (const [file, prompt] of Object.entries(raw)) {
      if (typeof prompt !== "string" || file.includes("/") || file.includes("\\") || !files.includes(file)) continue;
      const kind = VIDEO.test(file) ? "video" : IMAGE.test(file) ? "image" : null;
      if (kind) pinned.set(prompt.trim(), { kind, file });
    }
  }
  return {
    pick,
    byDuration: (ms, seed) => {
      if (!timed.length) return pick("video", seed);
      const best = timed.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a));
      return unique(best.bytes, seed);
    },
    forPrompt: (prompt) => {
      const text = prompt.trim();
      // The app wraps the user's prompt in a short instruction before it reaches Muse ("Generate an image: …").
      let hit = pinned.get(text);
      if (!hit) for (const [p, v] of pinned) if (text.endsWith(": " + p)) { hit = v; break; }
      if (!hit) return null;
      return { kind: hit.kind, name: hit.file, bytes: new Uint8Array(fs.readFileSync(path.join(dir, hit.file))) };
    },
  };
}
