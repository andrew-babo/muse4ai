import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publicJob } from "../src/shared/jobMachine";
import { defaultFakeReply, FakeHttpChannel } from "../src/main/adapter/fakeGateway";
import { job, makeHarness, seedAccounts, settle, textJob, type Harness } from "./helpers";
import { Services } from "../src/main/services";

let h: Harness;
afterEach(() => h?.close());

const chat = (prompt: string, extra: Record<string, unknown> = {}) => ({ prompt, referenceIds: [] as string[], accountPref: "auto", clientRequestId: `req-${Math.random()}`, ...extra });

async function until(cond: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 10));
  }
}
const settled = (id: string) => ["completed", "failed", "needs_review", "cancelled"].includes(job(h, id).state);

describe("Build 2.0 — chat over the direct channel (R81–R85, R93–R95)", () => {
  it("AC-CHAT-03: a chat job runs on HTTP, stores the answer verbatim, gets a conversation handle; the Muse id never leaves main", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Tóm tắt 3 ý chính về cà phê"));
    await until(() => settled(id));
    const j = job(h, id);
    expect(j.state).toBe("completed");
    expect(j.execPath).toBe("http");
    expect(j.resultText).toBe("Trả lời: Tóm tắt 3 ý chính về cà phê");
    expect(j.conversationId).toMatch(/^mc_[0-9a-f-]{36}$/);
    expect(j.remoteSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(publicJob(j))).not.toContain(j.remoteSessionId!);
    expect(JSON.stringify(h.events.filter((e) => e.type === "job"))).not.toContain(j.remoteSessionId!);
    expect(h.gwCfg(a).sent).toHaveLength(1);
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0); // the UI path was never used
    expect(h.repo.attemptsForJob(id).some((x) => x.path === "http")).toBe(true);
  });

  it("AC-CHAT-04: every file Muse attached is stored (media in the library, others as files), names sanitized, duplicates once", async () => {
    const csv = new TextEncoder().encode("n,square\n1,1\n2,4\n");
    h = makeHarness({
      gw: () => ({
        reply: () => ({
          text: "Đây là tệp",
          files: [
            { name: "../../evil<>.csv", mime: "text/csv", bytes: csv },
            { name: "anh.png", mime: "image/png", bytes: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")) },
            { name: "copy.csv", mime: "text/csv", bytes: csv },
          ],
        }),
      }),
    });
    await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Tạo bảng bình phương"));
    await until(() => settled(id));
    expect(job(h, id).state).toBe("completed");
    const assets = h.repo.assetsForJob(id);
    expect(assets.map((x) => x.kind).sort()).toEqual(["file", "image"]);
    const file = assets.find((x) => x.kind === "file")!;
    expect(file.filename).toMatch(/_1_evil\.csv$/);
    expect(file.path).toContain(`${path.sep}Hỏi đáp${path.sep}`);
    expect(fs.readFileSync(file.path, "utf8")).toBe("n,square\n1,1\n2,4\n");
  });

  it("AC-CHAT-05/R83(a): an answer above 1 MiB is cut at a character boundary and the full text is kept as a .md file", async () => {
    const long = "ệ".repeat(400_000); // 1.2 MB UTF-8
    h = makeHarness({ gw: () => ({ reply: () => ({ text: long }) }) });
    await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Viết thật dài"));
    await until(() => settled(id));
    const j = job(h, id);
    expect(j.state).toBe("completed");
    expect(j.resultTextTruncated).toBe(true);
    expect(Buffer.byteLength(j.resultText!, "utf8")).toBeLessThanOrEqual(1024 * 1024);
    const md = h.repo.assetsForJob(id).find((x) => x.filename?.endsWith(".md"))!;
    expect(fs.readFileSync(md.path, "utf8")).toBe(long);
  });

  it("AC-CHAT-05/R94 live 01/11: a reply that is only a file (run.bat, no answer message, no status) completes via the conversation list", async () => {
    const bat = new TextEncoder().encode("echo c05-abba21\r\n");
    h = makeHarness({ gw: () => ({ reply: () => ({ filesOnly: true, files: [{ name: "run.bat", mime: "application/octet-stream", bytes: bat }] }) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Tạo run.bat với một dòng echo"));
    await until(() => settled(id));
    const j = job(h, id);
    expect(j.state).toBe("completed");
    expect(j.resultText ?? "").toBe("");
    const assets = h.repo.assetsForJob(id);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: "file" });
    expect(assets[0].filename).toMatch(/run\.bat$/);
    expect(fs.readFileSync(assets[0].path)).toEqual(Buffer.from(bat));
    expect(h.gwCfg(a).sent).toHaveLength(1);
    expect(h.repo.attemptsForJob(id).filter((x) => x.phase === "generate")).toHaveLength(1);
  });

  it("R94: a files-only turn is not done while the conversation list says running; a list read failing only delays it", async () => {
    const bat = new TextEncoder().encode("echo slow\r\n");
    h = makeHarness({ gw: () => ({ completeMs: 300, script: [{ phase: "sessions", error: "stream_lost" }], reply: () => ({ filesOnly: true, files: [{ name: "run.bat", mime: "application/octet-stream", bytes: bat }] }) }) });
    await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Tạo run.bat chậm"));
    await until(() => job(h, id).state === "generating");
    await new Promise((r) => setTimeout(r, 150));
    expect(job(h, id).state).toBe("generating"); // Muse is still on it: no early end
    await until(() => settled(id));
    expect(job(h, id).state).toBe("completed");
    expect(h.repo.assetsForJob(id)).toHaveLength(1);
  });

  it("R83(e): no text and no file → failed EMPTY_RESPONSE, never resent", async () => {
    h = makeHarness({ gw: () => ({ reply: () => ({ text: "" }) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("…"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "failed", errorClass: "EMPTY_RESPONSE" });
    expect(h.gwCfg(a).sent).toHaveLength(1);
  });

  it("AC-CHAT-07/08: continuing a conversation sends into the same Muse conversation on its owner; a second unfinished turn is refused", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 80, reply: (p, _i, n) => ({ text: n === 0 ? "Nhớ: tamarind" : `Lượt ${n + 1}: ${p}` }) }) });
    const [a, b] = await seedAccounts(h, ["Mây", "Sương"]);
    const first = h.coord.createChatJob(chat("Nhớ từ bí mật tamarind", { accountPref: a }));
    await until(() => settled(first));
    const conv = job(h, first).conversationId!;
    const second = h.coord.createChatJob(chat("Từ bí mật là gì?", { conversationId: conv }));
    expect(() => h.coord.createChatJob(chat("Câu thứ ba", { conversationId: conv }))).toThrow(/chưa xong/);
    expect(() => h.coord.createChatJob(chat("Sai tài khoản", { conversationId: conv, accountPref: b }))).toThrow(/tài khoản khác/);
    await until(() => settled(second));
    const j2 = job(h, second);
    expect(j2).toMatchObject({ state: "completed", accountId: a, conversationId: conv, baselineUserMsgs: 1 });
    expect(j2.resultText).toBe("Lượt 2: Từ bí mật là gì?");
    const sent = h.gwCfg(a).sent!;
    expect(sent.map((x) => x.sessionId)).toEqual([sent[0].sessionId, sent[0].sessionId]);
    // After the turn ends the conversation accepts the next one.
    const third = h.coord.createChatJob(chat("Câu thứ ba", { conversationId: conv }));
    await until(() => settled(third));
    expect(job(h, third).state).toBe("completed");
  });

  it("R82: a small CSV is sent inline over HTTP; an image above the HTTP image cap is refused at creation (chat has no UI path)", async () => {
    h = makeHarness({ gw: () => ({ reply: (_p, items) => ({ text: `items=${items.length}` }) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const doc = h.media.importDocument(new TextEncoder().encode("qty\n2\n3\n"), "orders.csv");
    const ref = h.repo.insertRef({ sha256: doc.sha256, path: doc.path, mime: doc.mime, width: 0, height: 0, bytes: doc.bytes, kind: "document", filename: doc.filename, now: 1 });
    const id = h.coord.createChatJob(chat("Cộng cột qty", { referenceIds: [ref.id] }));
    await until(() => settled(id));
    expect(job(h, id).resultText).toBe("items=2");
    const item = h.gwCfg(a).sent![0].items[0];
    expect(item).toMatchObject({ type: "file", mime_type: "text/csv", filename: "orders.csv" });
    const img = h.repo.insertRef({ sha256: "x", path: path.join(h.dir, "x.png"), mime: "image/png", width: 1, height: 1, bytes: 3 * 1024 * 1024, kind: "image", now: 1 });
    expect(() => h.coord.createChatJob(chat("Mô tả ảnh", { referenceIds: [img.id] }))).toThrow(/Chưa tài khoản nào chạy được/);
  });

  it("without completion events a turn is taken as done after two equal history reads (chat and image)", async () => {
    h = makeHarness({ gw: () => ({ emitCompleted: false }) });
    await seedAccounts(h, ["Mây"]);
    const c = h.coord.createChatJob(chat("Không có sự kiện"));
    const [img] = h.coord.createJobs(textJob("ảnh không sự kiện"));
    await until(() => settled(c) && settled(img), 8_000);
    expect(job(h, c).state).toBe("completed");
    expect(job(h, img).state).toBe("completed");
    expect(h.repo.assetsForJob(img)).toHaveLength(1);
  });

  it("live 01/11: an image that shows up in history a moment after the turn looks done is still collected; one that never shows fails after the grace", async () => {
    h = makeHarness({ gw: () => ({ reply: (p) => ({ ...defaultFakeReply(p), filesLateMs: p.includes("never") ? 60_000 : 60 }) }) });
    await seedAccounts(h, ["Mây"]);
    const [late] = h.coord.createJobs(textJob("ảnh đến muộn"));
    await until(() => settled(late));
    expect(job(h, late)).toMatchObject({ state: "completed", execPath: "http" });
    expect(h.repo.assetsForJob(late)).toHaveLength(1);
    const [never] = h.coord.createJobs(textJob("ảnh never"));
    await until(() => settled(never), 8_000);
    expect(job(h, never).state).toBe("failed");
    expect(job(h, never).errorMessage).toMatch(/không trả về tệp/);
    expect(h.gwCfg(h.repo.listAccounts()[0].id).sent!.filter((x) => x.prompt.includes("never"))).toHaveLength(1);
  });

  it("live 01/11: a ready-but-unfinished message (commentary preamble or first streamed words) never completes a chat; the final answer does", async () => {
    // completeMs ≫ stableGapMs: the early message sits unchanged in history for many stable gaps before the answer is done.
    h = makeHarness({
      gw: () => ({
        completeMs: 600,
        emitCompleted: false,
        reply: (p) => ({ text: `Bài viết đầy đủ cho: ${p}`, early: p.includes("dẫn") ? { text: "Mình sẽ viết bài khoảng 1200 từ và kiểm tra số từ trước khi gửi." } : { text: "Lịch sử cà", fromMs: 100 } }),
      }),
    });
    const [a] = await seedAccounts(h, ["Mây"]);
    const pre = h.coord.createChatJob(chat("lời dẫn trước"));
    const stream = h.coord.createChatJob(chat("đang chạy chữ"));
    await until(() => settled(pre) && settled(stream), 8_000);
    expect(job(h, pre)).toMatchObject({ state: "completed", resultText: "Bài viết đầy đủ cho: lời dẫn trước" });
    expect(job(h, stream)).toMatchObject({ state: "completed", resultText: "Bài viết đầy đủ cho: đang chạy chữ" });
    expect(h.gwCfg(a).sent).toHaveLength(2);
  });

  it("P0-2: a chat with an image sends it inline as type image; an image edit and an MP4 edit run over HTTP with the UI templates", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const png = fs.readFileSync(path.join(__dirname, "fixtures", "media", "coffee.jpg"));
    const imgFile = path.join(h.dir, "coffee.jpg");
    fs.writeFileSync(imgFile, png);
    const img = h.repo.insertRef({ sha256: "img", path: imgFile, mime: "image/jpeg", width: 1, height: 1, bytes: png.length, kind: "image", now: 1 });
    const c = h.coord.createChatJob(chat("Ảnh có gì?", { referenceIds: [img.id] }));
    await until(() => settled(c));
    expect(job(h, c)).toMatchObject({ state: "completed", execPath: "http" });
    // No name given → a neutral name, never the local path.
    expect(h.gwCfg(a).sent![0].items[0]).toMatchObject({ type: "image", mime_type: "image/jpeg", filename: "ref-img.jpg" });
    expect(Buffer.from((h.gwCfg(a).sent![0].items[0] as { data_base64: string }).data_base64, "base64").equals(png)).toBe(true);

    const [edit] = h.coord.createJobs({ ...textJob("đổi nền sang đỏ"), kind: "image", mode: "reference", referenceIds: [img.id] });
    await until(() => settled(edit));
    expect(job(h, edit)).toMatchObject({ state: "completed", execPath: "http" });
    const sentEdit = h.gwCfg(a).sent!.at(-1)!;
    expect(sentEdit.prompt).toBe("Edit the attached image: đổi nền sang đỏ");
    expect(sentEdit.items[0]).toMatchObject({ type: "image" });
    expect(h.repo.assetsForJob(edit)[0]).toMatchObject({ kind: "image" });

    const mp4 = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const vidFile = path.join(h.dir, "clip.mp4");
    fs.writeFileSync(vidFile, mp4);
    const vid = h.repo.insertRef({ sha256: "vid", path: vidFile, mime: "video/mp4", width: 1, height: 1, bytes: mp4.length, kind: "video", now: 1 });
    const [vedit] = h.coord.createJobs({ ...textJob("làm chậm lại"), kind: "video", mode: "reference", referenceIds: [vid.id] });
    await until(() => settled(vedit), 8_000);
    const sentV = h.gwCfg(a).sent!.at(-1)!;
    expect(sentV.prompt).toMatch(/^Edit the attached video according to this request and return the edited MP4 video/);
    // 3 MiB MP4 → uploaded to the workspace, then referenced.
    expect(sentV.items[0]).toMatchObject({ type: "file_ref", mime_type: "video/mp4" });
    expect(job(h, vedit).execPath).toBe("http");
  });

  const csvOf = (bytes: number) => {
    const head = "id,amount\n";
    let body = "";
    for (let i = 1; head.length + body.length < bytes; i++) body += `${i},${(i * 7) % 999}\n`;
    return new TextEncoder().encode((head + body).slice(0, bytes));
  };
  const docRef = (bytes: Uint8Array, name: string) => {
    const doc = h.media.importDocument(bytes, name);
    return h.repo.insertRef({ sha256: doc.sha256, path: doc.path, mime: doc.mime, width: 0, height: 0, bytes: doc.bytes, kind: "document", filename: doc.filename, now: 1 });
  };

  it("a 2 MiB CSV still goes inline; a 5 MiB CSV is uploaded to the workspace in 512 KiB pieces, checked and sent as file_ref", async () => {
    h = makeHarness({ gw: () => ({ reply: (_p, items) => ({ text: items.map((i) => i.type).join("+") }) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const two = docRef(csvOf(2 * 1024 * 1024), "hai.csv");
    const id1 = h.coord.createChatJob(chat("Đếm dòng", { referenceIds: [two.id] }));
    await until(() => settled(id1), 8_000);
    expect(job(h, id1)).toMatchObject({ state: "completed", resultText: "file+text" });
    expect(h.gwCfg(a).fsCalls ?? []).toEqual([]);

    const fiveBytes = csvOf(5 * 1024 * 1024);
    const five = docRef(fiveBytes, "năm mb.csv");
    const id2 = h.coord.createChatJob(chat("Đếm dòng", { referenceIds: [five.id] }));
    await until(() => settled(id2), 8_000);
    expect(job(h, id2)).toMatchObject({ state: "completed", resultText: "file_ref+text", execPath: "http" });
    const calls = h.gwCfg(a).fsCalls!;
    expect(calls.filter((c) => c.op === "write")).toHaveLength(10); // 5 MiB / 512 KiB
    expect(calls.map((c) => c.op).slice(-2)).toEqual(["stat", "rename"]);
    expect(new Set(calls.filter((c) => c.op === "write").map((c) => c.path)).size).toBe(1);
    expect(calls[0].path).toMatch(/^workspace\/user\/files\/\.upload-[0-9a-f-]{36}\.part$/);
    const ref = h.gwCfg(a).sent!.at(-1)!.items[0];
    expect(ref).toMatchObject({ type: "file_ref", mime_type: "text/csv", filename: "năm mb.csv" });
    const refPath = (ref as { path: string }).path;
    expect(refPath).toMatch(/^workspace\/user\/files\/n_m_mb_\d+_[a-z0-9]+\.csv$/);
    // The bytes Muse holds are exactly the file's bytes.
    expect(Buffer.from(FakeHttpChannel.uploaded(a, refPath)!).equals(Buffer.from(fiveBytes))).toBe(true);
    expect(h.gwCfg(a).sent).toHaveLength(2); // one send per job
  });

  it("an upload Muse refuses (HTTP 413) fails the job without sending it; an upload that times out goes back to the queue unsent", async () => {
    h = makeHarness({ gw: () => ({ script: [{ phase: "upload", status: 413 }] }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const big = docRef(csvOf(3 * 1024 * 1024), "lon.csv");
    const id = h.coord.createChatJob(chat("Đếm dòng", { referenceIds: [big.id] }));
    await until(() => settled(id), 8_000);
    expect(job(h, id)).toMatchObject({ state: "failed", errorClass: "PROVIDER_ERROR" });
    expect(job(h, id).errorMessage).toMatch(/Muse không nhận tệp đính kèm/);
    expect(h.gwCfg(a).sent ?? []).toHaveLength(0);
    expect(job(h, id).submitIntentAt ?? null).toBeNull();
    // The part file was deleted after the refusal.
    expect(h.gwCfg(a).fsCalls!.map((c) => c.op)).toEqual(["write", "delete"]);

    h.gwCfg(a).script = [{ phase: "upload", status: null }];
    h.gwCfg(a).fsCalls = [];
    const id2 = h.coord.createChatJob(chat("Đếm dòng lần 2", { referenceIds: [big.id] }));
    await until(() => settled(id2), 8_000);
    // First try timed out before anything was sent → re-queued → second try uploaded and sent exactly once.
    expect(job(h, id2)).toMatchObject({ state: "completed" });
    expect(h.gwCfg(a).sent!.filter((x) => x.prompt.includes("lần 2"))).toHaveLength(1);
    expect(h.repo.attemptsForJob(id2).some((x) => x.outcome === "not_sent")).toBe(true);
  });
});

describe("Build 2.0 — images/videos over HTTP and path selection (R86–R92)", () => {
  it("an image job on an auto account runs over HTTP and lands in the library like a UI result", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob("Một bức ảnh mèo"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    const assets = h.repo.assetsForJob(id);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: "image", site: "muse" });
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0);
  });

  it("AC-PATH-02/05: 3 connect failures in 10 minutes → HTTP down → the job runs on the UI path; one notification", async () => {
    h = makeHarness({ gw: () => ({ script: Array.from({ length: 12 }, () => ({ phase: "connect" as const, error: "connect_failed" as const })) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob("Ảnh qua đường dự phòng"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "completed", execPath: "ui" });
    expect(publicJob(job(h, id)).execPath).toBe("ui");
    // Every attempt records its path: the HTTP tries that never sent, then the UI run and its download (live 01/11).
    const att = h.repo.attemptsForJob(id);
    expect(att.filter((x) => x.path === "http").every((x) => x.outcome === "not_sent")).toBe(true);
    expect(att.filter((x) => x.path === "ui").map((x) => x.phase)).toEqual(expect.arrayContaining(["generate", "download"]));
    expect(att.every((x) => x.path === "http" || x.path === "ui")).toBe(true);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
    const acc = h.coord.snapshot().accounts[0];
    expect(acc.execution).toMatchObject({ mode: "auto", httpState: "down", activePath: "ui" });
    expect(h.notices.filter((n) => n.title.includes("chuyển sang chạy giao diện"))).toHaveLength(1);
    expect(h.gwCfg(a).sent ?? []).toHaveLength(0);
  });

  it("AC-PATH-06: an http-only account whose HTTP is down never opens the UI path; its pinned job waits", async () => {
    h = makeHarness({ gw: () => ({ script: Array.from({ length: 30 }, () => ({ phase: "connect" as const, error: "connect_failed" as const })) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.coord.setExecution(a, { mode: "http", maxConcurrent: 10, uiMaxConcurrent: 2 });
    const [id] = h.coord.createJobs(textJob("Chỉ HTTP", { accountPref: a }));
    await settle(h, 40);
    expect(job(h, id).state).toBe("queued");
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0);
    expect(h.coord.snapshot().accounts[0].execution).toMatchObject({ httpState: "down", activePath: "none" });
  });

  it("AC-PATH-07: Muse reports unusual activity → account paused, one notification, the job is not sent elsewhere on another path", async () => {
    h = makeHarness({ gw: () => ({ script: [{ phase: "ack", ackError: { status: 403, message: "We've detected unusual activity on your account" } }] }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Xin chào", { accountPref: a }));
    await settle(h, 20);
    expect(h.repo.getAccount(a)).toMatchObject({ state: "paused", stateNote: "Muse báo hoạt động bất thường" });
    expect(h.notices.filter((n) => n.kind === "account_paused")).toHaveLength(1);
    expect(job(h, id).state).toBe("queued");
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0);
  });
});

describe("Build 2.0 R93 — never twice", () => {
  it("AC-GW-03: no ack but Muse got it → reconciled from history and followed; sent exactly once", async () => {
    h = makeHarness({ gw: () => ({ script: [{ phase: "ack", noAck: true, delivered: true }] }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Câu hỏi mất xác nhận"));
    await until(() => settled(id));
    expect(job(h, id).state).toBe("completed");
    expect(h.gwCfg(a).sent).toHaveLength(1);
    expect(h.logs.some((l) => l.includes("job.reconcile") && l.includes('"verdict":"found"'))).toBe(true);
  });

  it("AC-GW-03: no ack and Muse never got it → failed NOT_ACCEPTED after 3 reads; nothing is resent", async () => {
    h = makeHarness({ gw: () => ({ script: [{ phase: "ack", noAck: true, delivered: false }] }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Câu hỏi không tới"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "failed", errorClass: "NOT_ACCEPTED" });
    expect(h.gwCfg(a).sent ?? []).toHaveLength(0);
  });

  it("live 01/11: Muse silently dropped an idle socket the app still thought open → the next job reconnects before sending and completes, sent once", async () => {
    h = makeHarness({ gw: () => ({}), httpTimings: { idleCloseMs: 60_000, reconcileGiveUpMs: 60_000 } });
    const [a] = await seedAccounts(h, ["Mây"]);
    const first = h.coord.createChatJob(chat("Lượt mở kết nối"));
    await until(() => settled(first));
    expect(job(h, first).state).toBe("completed");
    const connects = h.gwCfg(a).connects ?? 0;
    h.gwCfg(a).serverDrop = true; // code 1006 while nothing polls; the app's last known state is still "open"
    const second = h.coord.createChatJob(chat("Lượt sau khi Muse đóng kết nối"));
    await until(() => settled(second));
    expect(job(h, second)).toMatchObject({ state: "completed", execPath: "http", resultText: "Trả lời: Lượt sau khi Muse đóng kết nối" });
    expect(h.gwCfg(a).connects).toBe(connects + 1);
    expect(h.gwCfg(a).sent).toHaveLength(2);
  });

  it("AC-GW-10: a turn still running at its time limit → needs_review “Muse chưa xong sau {n} phút”; partial text is never the answer; nothing resent", async () => {
    h = makeHarness({
      gw: () => ({ completeMs: 60_000, reply: () => ({ text: "Câu trả lời đầy đủ", early: { text: "Mình sẽ viết bài, đợi chút" } }) }),
      httpTimings: { timeoutMs: { chat: 400, image: 400, video: 400 } },
    });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Viết bài 1200 từ"));
    await until(() => settled(id));
    const j = job(h, id);
    expect(j).toMatchObject({ state: "needs_review", execPath: "http" });
    expect(j.errorMessage).toBe(`Muse chưa xong sau ${Math.round(400 / 60_000)} phút`);
    expect(j.resultText).toBeNull();
    expect(h.gwCfg(a).sent).toHaveLength(1);
  });

  it("R97/AC-PATH-11: the store remembers when an HTTP turn last succeeded (attempt path + outcome), across restarts", async () => {
    h = makeHarness({ gw: () => ({}) });
    await seedAccounts(h, ["Mây"]);
    expect(h.repo.lastHttpSuccessAt()).toBeNull();
    const id = h.coord.createChatJob(chat("Một câu hỏi"));
    await until(() => settled(id));
    const ok = h.repo.attemptsForJob(id).filter((x) => x.path === "http" && (x.outcome === "generated" || x.outcome === "downloaded"));
    expect(ok.length).toBeGreaterThan(0);
    expect(h.repo.lastHttpSuccessAt()).toBe(Math.max(...ok.map((x) => x.endedAt!)));
  });

  it("AC-GW-01: before the channel sees the send, the store already holds a UUID v4 conversation id + submit_intent_at; a restart after the intent with nothing at Muse → 3 reads over the span → failed NOT_ACCEPTED, 0 resends", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Ghi trước khi gửi", { accountPref: a }));
    h.coord.runScheduler();
    await until(() => h.channels.has(a));
    const ch = h.channels.get(a)!;
    const seen: { arg: string; stored: string | null; intent: number | null }[] = [];
    const realSend = ch.send.bind(ch);
    ch.send = async (sessionId, items) => {
      const j = job(h, id);
      seen.push({ arg: sessionId, stored: j.remoteSessionId, intent: j.submitIntentAt });
      return realSend(sessionId, items);
    };
    await until(() => settled(id));
    expect(job(h, id).state).toBe("completed");
    expect(seen).toHaveLength(1);
    expect(seen[0].stored).toBe(seen[0].arg);
    expect(seen[0].stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seen[0].intent).not.toBeNull();
    // Crash between “written” and “sent”: the restarted app finds no such conversation at Muse.
    const lost = h.coord.createChatJob(chat("Tắt app trước khi gửi", { accountPref: a }));
    const sid = "3c9d2a7e-1111-4222-9333-444455556666";
    h.repo.updateJob(lost, { state: "submitting", accountId: a, execPath: "http", remoteSessionId: sid, submitIntentAt: h.clock.t }, h.clock.t);
    let reads = 0;
    const realHistory = ch.history.bind(ch);
    ch.history = async (s) => {
      if (s === sid) reads++;
      return realHistory(s);
    };
    const sentBefore = h.gwCfg(a).sent!.length;
    const t0 = Date.now();
    h.coord.recover();
    await until(() => settled(lost));
    expect(job(h, lost)).toMatchObject({ state: "failed", errorClass: "NOT_ACCEPTED" });
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(60); // FAST_HTTP span (production: 3 reads over ≥ 120 s)
    expect(h.gwCfg(a).sent!.length).toBe(sentBefore);
  });

  it("AC-GW-02: the ack comes late (scaled 0.7 s of 15 s) → following starts only after the ack; no ack but a matching turn → followed to completed, sent once", async () => {
    h = makeHarness({ gw: () => ({ ackDelayMs: 70 }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Xác nhận chậm", { accountPref: a }));
    h.coord.runScheduler();
    await until(() => h.channels.has(a));
    const ch = h.channels.get(a)!;
    const order: string[] = [];
    const realAck = ch.ack.bind(ch);
    ch.ack = async (stream) => {
      const r = await realAck(stream);
      if (r.done) order.push("ack");
      return r;
    };
    const realSub = ch.subscribe.bind(ch);
    ch.subscribe = async (sid) => {
      order.push("subscribe");
      return realSub(sid);
    };
    await until(() => settled(id));
    expect(job(h, id).state).toBe("completed");
    expect(order[0]).toBe("ack");
    expect(order).toContain("subscribe");
    expect(h.gwCfg(a).sent).toHaveLength(1);
    // No ack at all, Muse has the turn → reconcile finds it and follows it.
    h.gwCfg(a).script = [{ phase: "ack", noAck: true, delivered: true }];
    const id2 = h.coord.createChatJob(chat("Không có xác nhận", { accountPref: a }));
    await until(() => settled(id2));
    expect(job(h, id2)).toMatchObject({ state: "completed", resultText: "Trả lời: Không có xác nhận" });
    expect(h.gwCfg(a).sent).toHaveLength(2);
  });

  it("AC-GW-05: the connection drops 3 times while 5 turns are followed → reconnect, all 5 re-subscribed, all 5 done, none resent; idle → the app closes the connection (page kept) and the next job reopens it", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 500 }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const ids = Array.from({ length: 5 }, (_, i) => h.coord.createChatJob(chat(`Theo dõi ${i}`, { accountPref: a })));
    h.coord.runScheduler();
    await until(() => h.channels.has(a));
    const ch = h.channels.get(a)!;
    const subs = new Map<string, number>();
    const realSub = ch.subscribe.bind(ch);
    ch.subscribe = async (sid) => {
      subs.set(sid, (subs.get(sid) ?? 0) + 1);
      return realSub(sid);
    };
    await until(() => subs.size === 5 || ids.every((x) => job(h, x).state === "submitted"));
    await until(() => subs.size === 5);
    const connectsBefore = h.gwCfg(a).connects ?? 0;
    h.gwCfg(a).script = [{ phase: "poll", drop: true }, { phase: "poll", drop: true }, { phase: "poll", drop: true }];
    await until(() => ids.every(settled), 8_000);
    expect(ids.map((x) => job(h, x).state)).toEqual(Array(5).fill("completed"));
    expect(h.gwCfg(a).script).toHaveLength(0);
    expect((h.gwCfg(a).connects ?? 0) - connectsBefore).toBeGreaterThanOrEqual(3);
    expect([...subs.values()].every((n) => n >= 2)).toBe(true);
    expect(h.gwCfg(a).sent).toHaveLength(5);
    expect(h.logs.filter((l) => l.includes("gw.pump")).length).toBe(0);
    // Idle (FAST_HTTP: 200 ms for the production 60 s) → the app closes the connection but keeps the page.
    const closes = ch.closedCount;
    await until(() => ch.closedCount > closes && !ch.isOpen(), 3_000);
    expect(ch.lastCloseUnloaded).toBe(false);
    const next = h.coord.createChatJob(chat("Việc sau khi rảnh", { accountPref: a }));
    await until(() => settled(next));
    expect(job(h, next).state).toBe("completed");
    expect(h.gwCfg(a).sent).toHaveLength(6);
  });

  it("AC-GW-06: the app restarts after the intent was written → the restarted app reconciles instead of sending again", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    // Muse already has the turn (sent by the previous run); the store says “submitting” with the intent written.
    const sessionId = "9b2f3c1e-0000-4000-8000-0000000000aa";
    const id = h.coord.createChatJob(chat("Trước khi tắt app"));
    h.repo.updateJob(id, { state: "submitting", accountId: a, execPath: "http", remoteSessionId: sessionId, submitIntentAt: h.clock.t }, h.clock.t);
    FakeHttpChannel.sessions.set(sessionId, { account: a, turns: [{ user: "Trước khi tắt app", items: [], at: Date.now() - 100, doneAt: Date.now() - 50, reply: { text: "Đã trả lời" }, announced: false }] });
    const open = h.repo.insertAttempt({ jobId: id, accountId: a, proxyId: null, phase: "generate", startedAt: h.clock.t, path: "http" });
    h.coord.recover();
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "completed", resultText: "Đã trả lời" });
    expect(h.gwCfg(a).sent ?? []).toHaveLength(0);
    // The step the killed run left open is closed as interrupted, not shown as still running.
    const left = h.repo.attemptsForJob(id).find((x) => x.id === open)!;
    expect(left.outcome).toBe("interrupted");
    expect(left.endedAt).not.toBeNull();
    expect(h.repo.attemptsForJob(id).filter((x) => x.endedAt === null)).toHaveLength(0);
  });
});

describe("Build 2.0 R113 — observability", () => {
  it("AC-OPS-05: a run with a reconnect, a reconcile, a switch to UI and a probe logs path.state/path.switch/path.probe/gw.reconnect/job.reconcile with codes; diagnostics carry 24 h counters and no prompt, answer or Muse id", async () => {
    h = makeHarness({ gw: () => ({ script: [{ phase: "connect", error: "connect_failed" }, { phase: "ack", noAck: true, delivered: true }] }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const secret = "OPS05-kin-dao";
    const c1 = h.coord.createChatJob(chat(`Câu hỏi ${secret}`, { accountPref: a }));
    await until(() => settled(c1));
    expect(job(h, c1)).toMatchObject({ state: "completed", execPath: "http" });
    // The socket dies and the next connects keep failing → HTTP down → the image runs on the UI path.
    const cfg = h.gwCfg(a);
    cfg.script = Array.from({ length: 12 }, () => ({ phase: "connect" as const, error: "connect_failed" as const }));
    cfg.serverDrop = true;
    const [i1] = h.coord.createJobs({ ...textJob(`Ảnh ${secret}`), accountPref: a });
    await until(() => settled(i1));
    expect(job(h, i1)).toMatchObject({ state: "completed", execPath: "ui" });
    cfg.script = [];
    await h.coord.probeHttp(a);
    expect(h.coord.snapshot().accounts[0].execution?.httpState).toBe("healthy");
    const log = h.logs.join("\n");
    expect(log).toMatch(/path gw\.reconnect \{"id":"[^"]+","attempt":1\}/);
    expect(log).toMatch(/job job\.reconcile \{[^}]*"verdict":"found"/);
    expect(log).toMatch(/path path\.state \{[^}]*"to":"down","reason":"connect_failed"/);
    expect(log).toMatch(/path path\.switch \{[^}]*"to":"ui","reason":"connect_failed"/);
    expect(log).toMatch(/path path\.probe \{[^}]*"ok":true/);
    expect(log).toMatch(/path path\.switch \{[^}]*"to":"http"/);
    // Diagnostics: the same events (from the log file) plus per-account/path counters for the last 24 h.
    const logFile = path.join(h.dir, "app.log");
    fs.writeFileSync(logFile, log);
    const services = new Services({
      repo: h.repo,
      coord: h.coord,
      media: h.media,
      os: { trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => "", copyFileToClipboard: () => undefined },
      emit: () => undefined,
      logFiles: () => [logFile],
      appInfo: () => ({}),
      now: () => h.clock.t,
    });
    const zip = services.diagnosticsZip().toString("utf8");
    const summary = JSON.parse(zip.slice(zip.indexOf("{"), zip.indexOf("\n}") + 2)) as { counters24h: { account: string; path: string; sent: number; completed: number; errors: Record<string, number>; medianMs: number | null }[] };
    expect(summary.counters24h).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "Mây", path: "http", sent: 1, completed: 1, errors: {} }),
        expect.objectContaining({ account: "Mây", path: "ui", sent: 1, completed: 1 }),
      ]),
    );
    for (const c of summary.counters24h) expect(c.medianMs).not.toBeNull();
    for (const ev of ["path.state", "path.switch", "path.probe", "gw.reconnect", "job.reconcile"]) expect(zip).toContain(ev);
    expect(zip).not.toContain(secret);
    expect(zip).not.toContain(job(h, c1).remoteSessionId!);
    expect(zip).not.toContain("Trả lời:");
  });
});

describe("Build 2.0 R98/R101 — concurrency on one account", () => {
  it("AC-CC-01: max 10 and 15 chats for one account → at most 10 run at once, all complete, each sent once", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 150 }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const ids = Array.from({ length: 15 }, (_, i) => h.coord.createChatJob(chat(`Câu ${i}`, { accountPref: a })));
    let peak = 0;
    const end = Date.now() + 8_000;
    while (!ids.every(settled) && Date.now() < end) {
      h.coord.runScheduler();
      peak = Math.max(peak, h.coord.runningCount());
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(ids.map((x) => job(h, x).state)).toEqual(Array(15).fill("completed"));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(10);
    const sent = h.gwCfg(a).sent!;
    expect(sent).toHaveLength(15);
    expect(new Set(sent.map((x) => x.sessionId)).size).toBe(15);
  });

  it("AC-CC-07: 20 jobs piled on one account (production pacing) → every gap between two consecutive sends is 0.4–1.2 s (+ ≤ 0.2 s processing)", async () => {
    // The production gap (400–1200 ms random) instead of FAST_HTTP's 1 ms.
    const { submitGap } = await import("../src/shared/execution");
    h = makeHarness({ gw: () => ({ completeMs: 50 }), httpTimings: { submitGap: () => submitGap() } });
    const [a] = await seedAccounts(h, ["Mây"]);
    const ids = Array.from({ length: 20 }, (_, i) => h.coord.createChatJob(chat(`Giãn cách ${i}`, { accountPref: a })));
    h.coord.runScheduler();
    await until(() => h.channels.has(a));
    const ch = h.channels.get(a)!;
    const at: number[] = [];
    const realSend = ch.send.bind(ch);
    ch.send = async (sid, items) => {
      at.push(performance.now());
      return realSend(sid, items);
    };
    await until(() => ids.every(settled), 30_000);
    expect(ids.map((x) => [job(h, x).state, job(h, x).errorMessage])).toEqual(Array(20).fill(["completed", null]));
    expect(at.length).toBeGreaterThanOrEqual(19); // the first send may already be under way when the hook is set
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(400 - 5);
      expect(g).toBeLessThanOrEqual(1200 + 200);
    }
  }, 40_000);

  it("AC-CC-01: max 21 is refused; changing the mode keeps running jobs on their path", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [a] = await seedAccounts(h, ["Mây"]);
    expect(() => h.coord.setExecution(a, { mode: "auto", maxConcurrent: 21, uiMaxConcurrent: 2 })).toThrow(/từ 1 đến 20/);
    expect(() => h.coord.setExecution(a, { mode: "auto", maxConcurrent: 10, uiMaxConcurrent: 6 })).toThrow(/từ 1 đến 5/);
    expect(h.coord.setExecution(a, { mode: "ui", maxConcurrent: 6, uiMaxConcurrent: 1 })).toMatchObject({ execMode: "ui", maxConcurrent: 6, uiMaxConcurrent: 1 });
  });

  it("AC-PATH-09: 8 HTTP jobs running, the account is switched to ui → the 8 finish on HTTP; a new job goes to the UI path", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 400 }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const ids = Array.from({ length: 8 }, (_, i) => h.coord.createJobs({ ...textJob(`Ảnh đang chạy ${i}`), accountPref: a })[0]);
    expect(ids).toHaveLength(8);
    await until(() => ids.every((x) => ["submitted", "generating"].includes(job(h, x).state)));
    expect(ids.every((x) => job(h, x).execPath === "http")).toBe(true);
    h.coord.setExecution(a, { mode: "ui", maxConcurrent: 10, uiMaxConcurrent: 2 });
    const [late] = h.coord.createJobs({ ...textJob("Ảnh mới sau khi đổi"), accountPref: a });
    await until(() => [...ids, late].every(settled), 8_000);
    expect(ids.map((x) => [job(h, x).state, job(h, x).execPath])).toEqual(Array(8).fill(["completed", "http"]));
    expect(job(h, late)).toMatchObject({ state: "completed", execPath: "ui" });
    expect(h.gwCfg(a).sent).toHaveLength(8);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
  });

  it("R89(d): a file that keeps failing to download → needs_review DOWNLOAD_FAILED after 4 tries, never resent", async () => {
    h = makeHarness({ gw: () => ({ script: Array.from({ length: 4 }, () => ({ phase: "fetch" as const, error: "fetch_failed" as const })) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const [id] = h.coord.createJobs(textJob("Ảnh tải lỗi"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "needs_review", errorClass: "DOWNLOAD_FAILED" });
    expect(h.gwCfg(a).sent).toHaveLength(1);
  });
});

describe("R94 — the conversation list as the done signal (pure)", () => {
  const turn = (atMs: number | null, assistant: string | null) => ({ user: { text: "x", prompt: "x", atMs }, assistant: assistant === null ? null : { text: assistant, ready: false, final: false, updatedAtMs: null }, status: null, files: [] });

  it("reads id, status and seconds-precision update time only from /api/session/list", async () => {
    const { normaliseSessionList } = await import("../src/shared/gateway/events");
    const data = { ok: true, result: { sessions: [{ session_id: "s-1", status: "running", updated_at_ms: 1793568035000, title: "secret title", snippet: "secret" }, { nope: 1 }] } };
    expect(normaliseSessionList(data)).toEqual([{ id: "s-1", status: "running", updatedAtMs: 1793568035000 }]);
    expect(normaliseSessionList({ result: {} })).toBeNull();
  });

  it("completed + updated at or after the user's message second + some output → done; otherwise not", async () => {
    const { sessionSaysDone } = await import("../src/shared/gateway/events");
    const at = 1793566660258;
    expect(sessionSaysDone({ status: "completed", updatedAtMs: 1793566686000 }, turn(at, null), 1)).toBe(true);
    expect(sessionSaysDone({ status: "completed", updatedAtMs: 1793566660000 }, turn(at, null), 1)).toBe(true); // same second
    expect(sessionSaysDone({ status: "completed", updatedAtMs: 1793566659000 }, turn(at, null), 1)).toBe(false); // the previous turn
    expect(sessionSaysDone({ status: "completed", updatedAtMs: 1793566686000 }, turn(at, null), 0)).toBe(false); // no output yet
    expect(sessionSaysDone({ status: "completed", updatedAtMs: 1793566686000 }, turn(at, "Đây là tệp"), 0)).toBe(true);
    expect(sessionSaysDone({ status: "running", updatedAtMs: 1793566686000 }, turn(at, null), 1)).toBe(false);
    expect(sessionSaysDone({ status: "failed", updatedAtMs: 1793566686000 }, turn(at, null), 0)).toBe(true);
    expect(sessionSaysDone(null, turn(at, null), 1)).toBe(false);
  });
});
