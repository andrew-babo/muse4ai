import { BATCH_MAX_JOBS, REPEAT_MAX, REPEAT_MIN } from "./constants";
import { formatNumber } from "./format";
import { capKey } from "./scheduler";
import type { BatchRow, CapabilityKey, JobKind, JobMode } from "./types";
import { validatePrompt } from "./validate";

// R11 — .txt: one prompt per line, blank skipped, '#' comments. .csv: header prompt,kind,mode,reference,repeat.

export interface ParseOptions {
  defaults: { kind: JobKind; mode: JobMode; repeat: number };
  fileExists: (p: string) => boolean;
  capabilities: Record<CapabilityKey, boolean>;
}

export interface ParseResult {
  rows: BatchRow[];
  validCount: number;
  errorCount: number;
  totalJobs: number; // valid rows × repeat
  batchError: string | null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function looksLikeCsv(text: string, fileName?: string): boolean {
  if (fileName) return fileName.toLowerCase().endsWith(".csv");
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return /^"?prompt"?\s*(,|$)/.test(first);
}

function validateRow(row: BatchRow, opts: ParseOptions): BatchRow {
  const p = validatePrompt(row.prompt);
  let error: string | null = null;
  if (!row.prompt.trim()) error = "Thiếu prompt";
  else if (!p.ok) error = p.reason;
  else if (row.repeat < REPEAT_MIN || row.repeat > REPEAT_MAX || !Number.isInteger(row.repeat)) error = `Số lần lặp phải từ ${REPEAT_MIN} đến ${REPEAT_MAX}`;
  else if (row.mode === "reference" && !row.reference) error = "Chế độ “Từ ảnh” cần đường dẫn ảnh tham chiếu";
  else if (row.reference && !opts.fileExists(row.reference)) error = "Không tìm thấy ảnh tham chiếu";
  else if (!opts.capabilities[capKey(row.kind, row.mode)]) error = "Chế độ chưa hỗ trợ trên phiên bản Muse hiện tại";
  return { ...row, prompt: p.ok ? p.value : row.prompt.trim(), error };
}

export function parseBatchText(text: string, opts: ParseOptions, fileName?: string): ParseResult {
  const rows: BatchRow[] = [];
  if (looksLikeCsv(text, fileName)) {
    const table = parseCsv(text);
    const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
    const idx = (n: string) => header.indexOf(n);
    if (idx("prompt") < 0) {
      return { rows: [], validCount: 0, errorCount: 0, totalJobs: 0, batchError: "Tệp CSV cần cột “prompt” ở dòng tiêu đề" };
    }
    table.forEach((cells, i) => {
      const get = (n: string) => (idx(n) >= 0 ? (cells[idx(n)] ?? "").trim() : "");
      const kindRaw = get("kind").toLowerCase();
      const modeRaw = get("mode").toLowerCase();
      const repeatRaw = get("repeat");
      const kind: JobKind = kindRaw === "video" ? "video" : kindRaw === "image" || !kindRaw ? (kindRaw ? "image" : opts.defaults.kind) : opts.defaults.kind;
      const ref = get("reference") || null;
      const mode: JobMode = modeRaw === "reference" ? "reference" : modeRaw === "text" ? "text" : ref ? "reference" : opts.defaults.mode;
      let row: BatchRow = {
        line: i + 2,
        prompt: get("prompt"),
        kind,
        mode,
        reference: ref,
        repeat: repeatRaw ? Number(repeatRaw) : opts.defaults.repeat,
        error: null,
      };
      if (kindRaw && kindRaw !== "image" && kindRaw !== "video") row = { ...row, error: "Cột kind chỉ nhận image hoặc video" };
      else if (modeRaw && modeRaw !== "text" && modeRaw !== "reference") row = { ...row, error: "Cột mode chỉ nhận text hoặc reference" };
      else row = validateRow(row, opts);
      rows.push(row);
    });
  } else {
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        rows.push(validateRow({ line: i + 1, prompt: line, kind: opts.defaults.kind, mode: opts.defaults.mode, reference: null, repeat: opts.defaults.repeat, error: null }, opts));
      });
  }
  return summarize(rows);
}

export function summarize(rows: BatchRow[]): ParseResult {
  const valid = rows.filter((r) => !r.error);
  const totalJobs = valid.reduce((s, r) => s + r.repeat, 0);
  const batchError = totalJobs > BATCH_MAX_JOBS ? `Tối đa ${formatNumber(BATCH_MAX_JOBS)} lượt/lô (đang là ${formatNumber(totalJobs)})` : null;
  return { rows, validCount: valid.length, errorCount: rows.length - valid.length, totalJobs, batchError };
}

export const CSV_SAMPLE = 'prompt,kind,mode,reference,repeat\n"Một tách cà phê trên bàn gỗ, ánh sáng buổi sáng",image,text,,2\n"Làm cho chiếc cốc màu xanh lá nhạt",image,reference,C:\\Anh\\coc.jpg,1\n"Hơi nước bốc lên chậm, máy quay đứng yên",video,reference,C:\\Anh\\coc.jpg,1\n';
