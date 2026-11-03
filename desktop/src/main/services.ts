import fs from "node:fs";
import path from "node:path";
import { parseBatchText } from "../shared/batchParse";
import { CHAT_ATTACH_FILE_MAX, canPreviewText, extOf } from "../shared/chat";
import { enabledCapabilities } from "../shared/capabilities";
import { formatDateTime } from "../shared/format";
import { JOB_LABEL } from "../shared/jobMachine";
import { redact } from "../shared/redact";
import type { Asset, Batch, BatchRow, JobKind, JobMode, ReferenceFile } from "../shared/types";
import { CommandError, type Coordinator } from "./coordinator";
import { InvalidMediaError, type MediaStore } from "./media";
import type { Repo } from "./repo";
import { makeZip } from "./zip";
import { t } from "../shared/i18n";

// Library, reference, batch-file and diagnostics operations used by the IPC layer.

export interface OsOps {
  trashItem(p: string): Promise<void>;
  showItemInFolder(p: string): void;
  openPath(p: string): Promise<string>;
  copyFileToClipboard(p: string, mime: string): void;
}

const MEDIA_EXT = new Set(["png", "jpg", "jpeg", "webp", "mp4"]);

export interface RefView extends ReferenceFile {
  url: string;
  name: string;
  durationMs: number | null;
}

export class Services {
  constructor(
    private d: {
      repo: Repo;
      coord: Coordinator;
      media: MediaStore;
      os: OsOps;
      emit: (type: string, payload: unknown) => void;
      logFiles: () => string[];
      now?: () => number;
      appInfo: () => Record<string, unknown>;
      /** Agent API summary for diagnostics (no keys/tokens). */
      apiInfo?: () => Record<string, unknown>;
    },
  ) {}

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  // ---------------------------------------------------------------- references (R10)
  async addReferenceBytes(bytes: Uint8Array, name: string): Promise<RefView> {
    let imported;
    try {
      imported = await this.d.media.importReference(bytes);
    } catch (e) {
      if (e instanceof InvalidMediaError) throw new CommandError(e.message);
      throw e;
    }
    const existing = this.d.repo.findRefBySha(imported.sha256);
    const ref = existing ?? this.d.repo.insertRef({ sha256: imported.sha256, path: imported.path, mime: imported.mime, width: imported.width, height: imported.height, bytes: imported.bytes, now: this.now() });
    return { ...ref, durationMs: imported.durationMs, url: `muse-media://ref/${ref.id}`, name };
  }

  async addReferencePath(filePath: string): Promise<RefView> {
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      throw new CommandError("Không tìm thấy tệp tham chiếu");
    }
    if (!st.isFile()) throw new CommandError("Đây không phải tệp media");
    if (st.size > 20 * 1024 * 1024) throw new CommandError("Tệp tham chiếu lớn hơn 20 MB");
    return this.addReferenceBytes(fs.readFileSync(filePath), path.basename(filePath));
  }

  // ---------------------------------------------------------------- Hỏi đáp attachments (Build 2.0 R82)
  /** A chat attachment: images/MP4 go through the media checks, everything else must be a supported document. */
  async addChatAttachmentBytes(bytes: Uint8Array, name: string): Promise<RefView> {
    if (bytes.length > CHAT_ATTACH_FILE_MAX) throw new CommandError("Tệp đính kèm lớn hơn 20 MB", "attachment_limit");
    if (MEDIA_EXT.has(extOf(name))) return this.addReferenceBytes(bytes, name);
    let doc;
    try {
      doc = this.d.media.importDocument(bytes, name);
    } catch (e) {
      if (e instanceof InvalidMediaError) throw new CommandError(e.message, "unsupported_file");
      throw e;
    }
    const existing = this.d.repo.findRefBySha(doc.sha256);
    const ref = existing ?? this.d.repo.insertRef({ sha256: doc.sha256, path: doc.path, mime: doc.mime, width: 0, height: 0, bytes: doc.bytes, kind: "document", filename: doc.filename, now: this.now() });
    return { ...ref, durationMs: null, url: `muse-media://ref/${ref.id}`, name: doc.filename };
  }

  async addChatAttachmentPath(filePath: string): Promise<RefView> {
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      throw new CommandError("Không tìm thấy tệp");
    }
    if (!st.isFile()) throw new CommandError("Đây không phải tệp");
    if (st.size > CHAT_ATTACH_FILE_MAX) throw new CommandError("Tệp đính kèm lớn hơn 20 MB", "attachment_limit");
    return this.addChatAttachmentBytes(fs.readFileSync(filePath), path.basename(filePath));
  }

  /** R84 — inline preview of a text output (≤ 2 MiB, text types only). */
  readChatText(assetId: string): { text: string; filename: string } {
    const a = this.d.repo.getAsset(assetId);
    if (!a || a.trashedAt) throw new CommandError("Không còn tệp này", "not_found");
    const name = a.filename ?? path.basename(a.path);
    if (!canPreviewText(name, a.bytes)) throw new CommandError("Tệp này không xem trước được — mở bằng ứng dụng khác", "unsupported_file");
    return { text: fs.readFileSync(a.path, "utf8"), filename: name };
  }

  async referenceFromAsset(assetId: string): Promise<RefView> {
    const a = this.d.repo.getAsset(assetId);
    if (!a || a.trashedAt) throw new CommandError("Không còn tệp này");
    return this.addReferencePath(a.path);
  }

  // ---------------------------------------------------------------- batches (F4)
  parseBatch(text: string, defaults: { kind: JobKind; mode: JobMode; repeat: number }, fileName?: string, baseDir?: string) {
    const resolve = (p: string) => (path.isAbsolute(p) || !baseDir ? p : path.join(baseDir, p));
    const res = parseBatchText(text, { defaults, fileExists: (p) => fs.existsSync(resolve(p)), capabilities: enabledCapabilities(this.d.repo.listAccounts()) }, fileName);
    if (baseDir) for (const r of res.rows) if (r.reference) r.reference = resolve(r.reference);
    return res;
  }

  async startBatch(id: string): Promise<Batch> {
    const b = this.d.repo.getBatch(id);
    if (!b) throw new CommandError("Không còn lô này", "not_found");
    const refMap = new Map<string, string>();
    for (const r of b.rows) {
      if (r.error || !r.reference || refMap.has(r.reference)) continue;
      try {
        const ref = await this.addReferencePath(r.reference);
        refMap.set(r.reference, ref.id);
      } catch (e) {
        throw new CommandError(`Dòng ${r.line}: ${(e as Error).message}`);
      }
    }
    return this.d.coord.startBatch(id, refMap);
  }

  batchFromAssets(assetIds: string[]): Batch {
    const rows: BatchRow[] = [];
    let line = 1;
    for (const id of assetIds) {
      const a = this.d.repo.getAsset(id);
      if (!a || a.trashedAt || a.kind !== "image" || a.missing) continue;
      rows.push({ line: line++, prompt: a.prompt, kind: "video", mode: "reference", reference: a.path, repeat: 1, error: null });
    }
    if (!rows.length) throw new CommandError("Chọn ít nhất 1 ảnh còn trên máy");
    return this.d.coord.saveDraft({ name: t("Ảnh thành video {now}", { now: formatDateTime(this.now()) }), settings: { kind: "video", mode: "reference", accountPref: "auto", repeat: 1 }, rows });
  }

  batchCsv(id: string): { name: string; csv: string } {
    const b = this.d.repo.getBatch(id);
    if (!b) throw new CommandError("Không còn lô này", "not_found");
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [["prompt", "kind", "mode", "state", "account", "error", "files"].join(",")];
    const accounts = new Map(this.d.repo.listAccounts().map((a) => [a.id, a.alias]));
    for (const j of this.d.repo.jobsForBatch(id)) {
      const files = this.d.repo
        .assetsForJob(j.id)
        .map((a) => a.path)
        .join(" | ");
      // Column names stay the import keys; state and app-made errors follow the UI language (R120/R121).
      lines.push([q(j.prompt), j.kind, j.mode, q(t(JOB_LABEL[j.state])), q(j.accountId ? accounts.get(j.accountId) ?? "" : ""), q(t(j.errorMessage ?? "")), q(files)].join(","));
    }
    return { name: b.name, csv: "\uFEFF" + lines.join("\r\n") + "\r\n" };
  }

  batchFolder(id: string): string {
    const first = this.d.repo.jobsForBatch(id).flatMap((j) => this.d.repo.assetsForJob(j.id))[0];
    return first ? path.dirname(first.path) : this.d.coord.settings().libraryDir;
  }

  // ---------------------------------------------------------------- library (F8)
  async trash(assetIds: string[]): Promise<{ trashed: number; failed: number }> {
    let trashed = 0;
    let failed = 0;
    for (const id of assetIds) {
      const a = this.d.repo.getAsset(id);
      if (!a || a.trashedAt) continue;
      try {
        if (fs.existsSync(a.path)) await this.d.os.trashItem(a.path);
        const out = this.d.repo.updateAsset(id, { trashedAt: this.now() });
        this.d.emit("asset", out);
        trashed++;
      } catch {
        failed++;
      }
    }
    return { trashed, failed };
  }

  favorite(assetId: string, value: boolean): Asset {
    const a = this.d.repo.getAsset(assetId);
    if (!a) throw new CommandError("Không còn tệp này", "not_found");
    const out = this.d.repo.updateAsset(assetId, { favorite: value });
    this.d.emit("asset", out);
    return out;
  }

  /** Marks files moved/deleted outside the app as missing (and back), regenerates absent thumbnails. */
  async rescan(): Promise<{ missing: number; restored: number; thumbs: number }> {
    let missing = 0;
    let restored = 0;
    let thumbs = 0;
    for (const a of this.d.repo.allAssets()) {
      if (a.trashedAt) continue;
      const exists = fs.existsSync(a.path);
      if (!exists && !a.missing) {
        this.d.emit("asset", this.d.repo.updateAsset(a.id, { missing: true }));
        missing++;
      } else if (exists && a.missing) {
        this.d.emit("asset", this.d.repo.updateAsset(a.id, { missing: false }));
        restored++;
      }
      if (exists && !fs.existsSync(this.d.media.thumbPath(a.sha256))) {
        if (await this.d.media.regenerateThumb(a.path, a.mime, a.sha256).catch(() => null)) thumbs++;
      }
    }
    return { missing, restored, thumbs };
  }

  async thumbFor(assetId: string): Promise<string | null> {
    const a = this.d.repo.getAsset(assetId);
    if (!a) return null;
    const t = this.d.media.thumbPath(a.sha256);
    if (fs.existsSync(t)) return t;
    if (!fs.existsSync(a.path)) return null;
    return this.d.media.regenerateThumb(a.path, a.mime, a.sha256).catch(() => null);
  }

  assetFile(assetId: string): string | null {
    const a = this.d.repo.getAsset(assetId);
    return a && fs.existsSync(a.path) ? a.path : null;
  }

  mustAssetFile(assetId: string): Asset {
    const a = this.d.repo.getAsset(assetId);
    if (!a || a.trashedAt) throw new CommandError("Không còn tệp này", "not_found");
    if (!fs.existsSync(a.path)) {
      this.d.emit("asset", this.d.repo.updateAsset(a.id, { missing: true }));
      throw new CommandError("Tệp đã bị di chuyển hoặc xoá ngoài app", "missing");
    }
    return a;
  }

  // ---------------------------------------------------------------- diagnostics (R20, AC-SEC-05)
  diagnosticsZip(): Buffer {
    const snap = this.d.coord.snapshot();
    const summary = {
      createdAt: new Date(this.now()).toISOString(),
      app: this.d.appInfo(),
      engine: snap.engine,
      counts: snap.counts,
      capabilities: snap.capabilities,
      settings: { ...snap.settings, libraryDir: "[thư mục thư viện]" },
      accounts: snap.accounts.map((a) => ({ alias: a.alias, state: a.state, stateNote: a.stateNote, proxy: a.proxyId ? this.d.repo.getProxy(a.proxyId)?.label : null, todayCount: a.todayCount, quota: a.quota })),
      proxies: snap.proxies.map((p) => ({ label: p.label, scheme: p.scheme, health: p.health, country: p.country, latencyMs: p.latencyMs, lastError: p.lastError, exitIpMasked: p.exitIpMasked })),
      batches: snap.batches.map((b) => ({ name: b.name, state: b.state, counts: b.counts })),
      api: this.d.apiInfo?.() ?? null,
      // R113 — the last 24 h per account and path (codes and counts only).
      counters24h: this.d.repo.pathCounters(this.now() - 24 * 60 * 60_000).map(({ accountId, ...c }) => ({ account: this.d.repo.getAccount(accountId)?.alias ?? "(đã xoá)", ...c })),
    };
    const entries = [{ name: "summary.json", data: new TextEncoder().encode(redact(JSON.stringify(summary, null, 2))) }];
    for (const f of this.d.logFiles().slice(-6)) {
      try {
        entries.push({ name: `logs/${path.basename(f)}`, data: new TextEncoder().encode(redact(fs.readFileSync(f, "utf8"))) });
      } catch {
        /* skip unreadable */
      }
    }
    return makeZip(entries, new Date(this.now()));
  }
}
