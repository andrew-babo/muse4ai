import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { crc32 } from "./zip";
import type { Repo } from "./repo";

// Test mode only (AC-PERF-01 / AC-LIB-01): a reproducible dataset of N jobs and M real image files.
// Every image is a distinct small PNG so thumbnails and hashes behave like real results.

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A w×h RGB PNG: a soft two-colour gradient seeded by `n`, so each file is visually and byte-wise distinct. */
export function makePng(n: number, w = 192, h = 128): Buffer {
  const hue = (n * 47) % 360;
  const c1 = hsl(hue, 0.45, 0.78);
  const c2 = hsl((hue + 40) % 360, 0.5, 0.6);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const o = row + 1 + x * 3;
      raw[o] = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      raw[o + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      raw[o + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * t) ^ (n & 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const PROMPTS = ["Bình minh trên đồi chè", "Chiếc thuyền giấy trên hồ", "Phố cổ về đêm", "Ấm trà gốm bên cửa sổ", "Cánh đồng lúa chín", "Mèo ngủ trên bậu cửa", "Sóng vỗ bờ cát lúc hoàng hôn", "Quả táo đỏ trên khăn lanh"];

export function seedDataset(repo: Repo, libraryDir: string, opts: { jobs: number; assets: number; now?: number }): { jobs: number; assets: number } {
  const now = opts.now ?? Date.now();
  const dir = path.join(libraryDir, "seed");
  fs.mkdirSync(dir, { recursive: true });
  let made = 0;
  // A second call continues the numbering, so every file and hash stays distinct.
  const base = Number((repo.db.prepare("SELECT COUNT(*) AS c FROM assets").get() as { c: number }).c);
  repo.db.exec("BEGIN");
  try {
    for (let j = 0; j < opts.jobs; j++) {
      const t = now - (opts.jobs - j) * 60_000;
      const prompt = `${PROMPTS[j % PROMPTS.length]} — mẫu ${j + 1}`;
      const job = repo.insertJob({ batchId: null, kind: "image", mode: "text", prompt, referenceIds: [], accountPref: "auto", state: "queued", priority: 0, clientRequestId: null, now: t });
      repo.updateJob(job.id, { state: "completed", completedAt: t + 30_000, startedAt: t }, t + 30_000);
      // Files are spread evenly over the jobs (newest included), so list screens show thumbnails at any scroll position.
      const target = opts.jobs ? Math.floor(((j + 1) * opts.assets) / opts.jobs) : 0;
      for (; made < target && made < opts.assets; made++) {
        const png = makePng(base + made);
        const file = path.join(dir, `seed-${String(base + made).padStart(5, "0")}.png`);
        fs.writeFileSync(file, png);
        repo.insertAsset({ jobId: job.id, batchId: null, path: file, sha256: createHash("sha256").update(png).digest("hex"), kind: "image", mime: "image/png", width: 192, height: 128, durationMs: null, bytes: png.length, accountAlias: j % 2 ? "Thử B" : "Thử A", prompt, createdAt: t + 30_000 });
      }
    }
    repo.db.exec("COMMIT");
  } catch (e) {
    repo.db.exec("ROLLBACK");
    throw e;
  }
  return { jobs: opts.jobs, assets: made };
}
