// R13 — {Library}\{yyyy-MM}\{batch name or "Lẻ"}\{yyyyMMdd-HHmmss}_{anh|video}_{6 chars id}_{n}.{ext}

const pad = (n: number) => String(n).padStart(2, "0");

export function sanitizeFolderName(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (s.length > 60) s = s.slice(0, 60).trim();
  return s || "Lô";
}

/** Path parts under the library: folders…, file name last. */
export function libraryRelParts(opts: {
  at: number;
  batchName: string | null;
  kind: "image" | "video";
  jobId: string;
  n: number;
  ext: string;
  /** R49 — extend steps: {month}\Kéo dài\{6 chars chain}\…_video_{6 chars job}_lan{k}.mp4 */
  chain?: { id: string; step: number } | null;
}): string[] {
  const d = new Date(opts.at);
  const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const short = opts.jobId.replace(/-/g, "").slice(0, 6);
  if (opts.chain) {
    const chainShort = opts.chain.id.replace(/-/g, "").slice(0, 6);
    const suffix = opts.n > 1 ? `_${opts.n}` : "";
    return [month, "Kéo dài", chainShort, `${stamp}_video_${short}_lan${opts.chain.step}${suffix}.${opts.ext}`];
  }
  const folder = opts.batchName ? sanitizeFolderName(opts.batchName) : "Lẻ";
  const file = `${stamp}_${opts.kind === "image" ? "anh" : "video"}_${short}_${opts.n}.${opts.ext}`;
  return [month, folder, file];
}

/** Build 2.0 R84 — {Library}\{yyyy-MM}\Hỏi đáp\{yyyyMMdd-HHmmss}_{6 chars id}_{n}_{sanitized name}. */
export function chatRelParts(opts: { at: number; jobId: string; n: number; filename: string }): string[] {
  const d = new Date(opts.at);
  const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const short = opts.jobId.replace(/-/g, "").slice(0, 6);
  return [month, "Hỏi đáp", `${stamp}_${short}_${opts.n}_${opts.filename}`];
}
