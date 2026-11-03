import { describe, expect, it } from "vitest";
import { FsResult, SendItem } from "../src/shared/gateway/bridge";
import { fsBodyAllowed, INLINE_DOC_MAX_BYTES, isUploadPath, normaliseFsReply, UPLOAD_CHUNK_BYTES, uploadTarget, uploadToWorkspace, type FsOp, type FsReply } from "../src/shared/gateway/upload";

// Build 2.0 — workspace upload for attachments bigger than one gateway request (live PoC 01/11).

function memFs(opts: { failWriteAt?: number; failStatus?: number | null; wrongSize?: boolean } = {}) {
  const files = new Map<string, Buffer>();
  const calls: { op: FsOp; body: Record<string, unknown> }[] = [];
  let writes = 0;
  const fs = async (op: FsOp, body: Record<string, unknown>): Promise<FsReply> => {
    calls.push({ op, body: { ...body, data_base64: body.data_base64 === undefined ? undefined : `${String(body.data_base64).length} chars` } });
    const ok = (extra: Partial<FsReply> = {}): FsReply => ({ status: 200, ok: true, size: null, kind: null, error: null, ...extra });
    if (op === "write") {
      if (opts.failWriteAt === writes++) return { status: opts.failStatus ?? null, ok: false, size: null, kind: null, error: "x" };
      const piece = Buffer.from(String(body.data_base64), "base64");
      files.set(String(body.path), body.append ? Buffer.concat([files.get(String(body.path)) ?? Buffer.alloc(0), piece]) : piece);
      return ok();
    }
    if (op === "stat") {
      const f = files.get(String(body.path));
      return f ? ok({ kind: "file", size: f.length + (opts.wrongSize ? 1 : 0) }) : { status: 404, ok: false, size: null, kind: null, error: "not_found" };
    }
    if (op === "rename") {
      files.set(String(body.destination), files.get(String(body.source))!);
      files.delete(String(body.source));
      return ok();
    }
    files.delete(String(body.path));
    return ok();
  };
  return { fs, files, calls };
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const target = uploadTarget("Báo cáo Q3 (final).csv", 7, "ab12", "0f9e8d7c-1111-2222-3333-444455556666");

describe("workspace upload (gateway/upload.ts)", () => {
  it("names files the way Muse's web app does, inside workspace/user/files/ only", () => {
    expect(target.final).toBe("workspace/user/files/B_o_c_o_Q3__final__7_ab12.csv");
    expect(target.part).toBe("workspace/user/files/.upload-0f9e8d7c-1111-2222-3333-444455556666.part");
    expect(isUploadPath(target.final)).toBe(true);
    expect(isUploadPath("/workspace/user/files/a.csv")).toBe(false); // Muse refuses absolute paths
    expect(isUploadPath("workspace/user/files/../secret")).toBe(false);
    expect(isUploadPath("workspace/user/files/sub/a.csv")).toBe(false);
    expect(isUploadPath("workspace/other/a.csv")).toBe(false);
    expect(uploadTarget("..", 0, "zz", "u").final).toMatch(/^workspace\/user\/files\/[A-Za-z0-9._-]+$/);
  });

  it("the page forwards only write/stat/rename/delete on upload paths", () => {
    expect(fsBodyAllowed("write", { path: target.part, data_base64: "" })).toBe(true);
    expect(fsBodyAllowed("rename", { source: target.part, destination: target.final })).toBe(true);
    expect(fsBodyAllowed("rename", { source: target.part, destination: "workspace/user/x.csv" })).toBe(false);
    expect(fsBodyAllowed("read", { path: target.part })).toBe(false);
    expect(fsBodyAllowed("delete", { path: "workspace/user/files/../../etc" })).toBe(false);
    expect(fsBodyAllowed("stat", null)).toBe(false);
  });

  it("5 MiB → 10 pieces of 512 KiB (first overwrites, the rest append), size check, rename; bytes identical", async () => {
    const data = new Uint8Array(5 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const m = memFs();
    const progress: number[] = [];
    const out = await uploadToWorkspace({ fs: m.fs, toBase64: b64, onProgress: (n) => progress.push(n) }, data, target);
    expect(out).toBe(target.final);
    const writes = m.calls.filter((c) => c.op === "write");
    expect(writes).toHaveLength(10);
    expect(writes.map((w) => [w.body.overwrite, w.body.append, w.body.create_parent])).toEqual([[true, false, true], ...Array(9).fill([false, true, false])]);
    expect(writes.every((w) => w.body.path === target.part)).toBe(true);
    expect(m.calls.map((c) => c.op).slice(-2)).toEqual(["stat", "rename"]);
    expect(Buffer.compare(m.files.get(target.final)!, Buffer.from(data))).toBe(0);
    expect(m.files.has(target.part)).toBe(false);
    expect(progress.at(-1)).toBe(data.length);
    expect(UPLOAD_CHUNK_BYTES).toBe(524288);
  });

  it("a refused piece or a size mismatch deletes the part file and throws; nothing is renamed", async () => {
    const data = new Uint8Array(3 * 1024 * 1024);
    const m1 = memFs({ failWriteAt: 2, failStatus: 413 });
    await expect(uploadToWorkspace({ fs: m1.fs, toBase64: b64 }, data, target)).rejects.toMatchObject({ step: "write", status: 413 });
    expect(m1.calls.map((c) => c.op)).toEqual(["write", "write", "write", "delete"]);
    expect(m1.files.size).toBe(0);
    const m2 = memFs({ wrongSize: true });
    await expect(uploadToWorkspace({ fs: m2.fs, toBase64: b64 }, data, target)).rejects.toMatchObject({ step: "size" });
    expect(m2.calls.some((c) => c.op === "rename")).toBe(false);
    expect(m2.files.size).toBe(0);
  });

  it("an aborted upload stops between pieces and cleans up", async () => {
    const ctl = new AbortController();
    const m = memFs();
    const fs = async (op: FsOp, body: Record<string, unknown>) => {
      const r = await m.fs(op, body);
      if (op === "write") ctl.abort();
      return r;
    };
    await expect(uploadToWorkspace({ fs, toBase64: b64, signal: ctl.signal }, new Uint8Array(2 * UPLOAD_CHUNK_BYTES + 1), target)).rejects.toThrow(/huỷ/);
    expect(m.calls.map((c) => c.op)).toEqual(["write", "delete"]);
  });

  it("bridge: file_ref items must point into the upload folder; inline files stay at most 2 MiB; fs replies carry no contents", () => {
    expect(SendItem.safeParse({ type: "file_ref", mime_type: "text/csv", path: target.final, filename: "a.csv" }).success).toBe(true);
    expect(SendItem.safeParse({ type: "file_ref", mime_type: "text/csv", path: "/etc/passwd", filename: "a.csv" }).success).toBe(false);
    const max = Math.ceil(INLINE_DOC_MAX_BYTES / 3) * 4;
    expect(SendItem.safeParse({ type: "file", mime_type: "text/csv", data_base64: "A".repeat(max), filename: "a.csv" }).success).toBe(true);
    expect(SendItem.safeParse({ type: "file", mime_type: "text/csv", data_base64: "A".repeat(max + 8), filename: "a.csv" }).success).toBe(false);
    expect(FsResult.safeParse(normaliseFsReply(200, { ok: true, result: { path: "/workspace/user/files/x", kind: "file", size: 11 } }))).toMatchObject({ success: true, data: { ok: true, size: 11, kind: "file" } });
    expect(normaliseFsReply(400, { ok: false, error: { code: "invalid_params", message: "absolute paths are not allowed" } })).toMatchObject({ ok: false, error: "invalid_params absolute paths are not allowed" });
    expect(normaliseFsReply(null, null)).toMatchObject({ ok: false, error: "timeout" });
  });
});

import { normaliseHistory, stripAttachmentMarkers } from "../src/shared/gateway/events";
import { attachmentName, matchTurn } from "../src/main/httpRunner";

describe("live 01/11 — Muse's copy of a message with attachments", () => {
  // Shapes captured from /chat/history on the VPS (paths shortened, no personal data).
  const imgText = "[image:image/png workspace/user/media_library/image/ref-2efc2054cc43.png]\nEdit the attached image: đổi hình tròn";
  const csvText = "[file:text/csv workspace/user/files/in-5m_0_e200.csv]\nTệp CSV đính kèm có cột id,amount.";
  const twoText = "[image:image/png workspace/user/media_library/image/a.png]\n[file:video/mp4 workspace/user/media_library/video/db/b.mp4]\nSửa video";

  it("strips the leading marker lines only", () => {
    expect(stripAttachmentMarkers(imgText)).toBe("Edit the attached image: đổi hình tròn");
    expect(stripAttachmentMarkers(csvText)).toBe("Tệp CSV đính kèm có cột id,amount.");
    expect(stripAttachmentMarkers(twoText)).toBe("Sửa video");
    expect(stripAttachmentMarkers("Không có tệp")).toBe("Không có tệp");
    // A marker-looking line in the middle, or a message that is only a marker, stays as is.
    expect(stripAttachmentMarkers("Hỏi\n[file:text/csv x.csv]")).toBe("Hỏi\n[file:text/csv x.csv]");
    expect(stripAttachmentMarkers("[file:text/csv x.csv]")).toBe("[file:text/csv x.csv]");
  });

  it("the sent prompt matches the turn that carries attachment markers (it did not in beta.2 → jobs hung until timeout)", () => {
    const h = normaliseHistory({ result: { chat_events: [
      { event_name: "message.user", display_text: imgText, display_text_ready: true },
      { event_name: "message.assistant", display_text: "Đã đổi", display_text_ready: true },
    ] } })!;
    expect(h.turns[0].user.prompt).toBe("Edit the attached image: đổi hình tròn");
    expect(matchTurn(h, "Edit the attached image: đổi hình tròn", null)).toMatchObject({ kind: "found" });
    expect(matchTurn(h, "Edit the attached image: đổi hình tròn", 0)).toMatchObject({ kind: "found" });
    expect(matchTurn(h, "Edit the attached image: khác", null)).toEqual({ kind: "ambiguous" });
  });

  it("a prompt that itself starts with a marker-like line still matches exactly", () => {
    const own = "[note:đây là dòng của agent]\nCâu hỏi";
    const h = normaliseHistory({ result: { chat_events: [{ event_name: "message.user", display_text: own }] } })!;
    expect(matchTurn(h, own, null)).toMatchObject({ kind: "found" });
  });

  it("attachment names never carry the local Windows path", () => {
    const sha = "2efc2054cc43617a47e0c3fbcca083a4591f4211960f13a05f5fca3e17f0eb52";
    expect(attachmentName({ filename: null, sha256: sha, mime: "image/png" })).toBe("ref-2efc2054cc43.png");
    expect(attachmentName({ filename: "bao cao.csv", sha256: sha, mime: "text/csv" })).toBe("bao cao.csv");
    expect(attachmentName({ filename: "C:\\Users\\Administrator\\x.png", sha256: sha, mime: "image/png" })).not.toMatch(/[\\/]/);
    expect(attachmentName({ filename: "  ", sha256: sha, mime: "video/mp4" })).toBe("ref-2efc2054cc43.mp4");
  });
});
