import { afterEach, describe, expect, it } from "vitest";
import { IpcDispatcher } from "../src/main/ipcHandlers";
import { Services } from "../src/main/services";
import type { Asset } from "../src/shared/types";
import { job, makeHarness, seedAccounts, textJob, type Harness } from "./helpers";

// Build 2.0 UI-facing rules: Hàng chờ “Hỏi đáp” count, chat files kept out of the Library grid, and R84 — the app
// never opens a returned file Windows could run (only “Mở thư mục”).

let h: Harness;
afterEach(() => h?.close());

const chat = (prompt: string) => ({ prompt, referenceIds: [] as string[], accountPref: "auto", clientRequestId: `req-${Math.random()}` });
const enc = (s: string) => new TextEncoder().encode(s);

async function until(cond: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    h.coord.runScheduler();
    await new Promise((r) => setTimeout(r, 10));
  }
}

function dispatcher(opened: string[]) {
  const shell = { openPath: async (p: string) => (opened.push(p), ""), showItemInFolder: (p: string) => void opened.push(`reveal:${p}`) };
  const services = new Services({
    repo: h.repo,
    coord: h.coord,
    media: h.media,
    os: { trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => "", copyFileToClipboard: () => undefined },
    emit: () => undefined,
    logFiles: () => [],
    appInfo: () => ({}),
    now: () => h.clock.t,
  } as never);
  return new IpcDispatcher(h.coord, services, shell as never, { testMode: false, log: () => undefined });
}

describe("Hàng chờ › Hỏi đáp count", () => {
  it("counts chat jobs apart from image/video, inside the same totals", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 60_000 }) });
    await seedAccounts(h, ["Mây"]);
    h.coord.createJobs(textJob("Ảnh mèo"));
    h.coord.createChatJob(chat("Câu hỏi 1"));
    h.coord.createChatJob(chat("Câu hỏi 2"));
    const c = h.repo.stateCounts();
    expect(c.chat).toBe(2);
    expect(c.all).toBe(3);
    expect(h.repo.queryJobs({ kind: "chat", limit: 50 }).items.map((j) => j.prompt).sort()).toEqual(["Câu hỏi 1", "Câu hỏi 2"]);
  });
});

describe("chat output files and the Library (R84)", () => {
  it("keeps chat files out of the default Library list but returns them when asked by kind", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 20, reply: () => ({ text: "Bảng đây", files: [{ name: "bang.csv", mime: "text/csv", bytes: enc("a,b\n1,2\n") }] }) }) });
    await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Xuất CSV"));
    await until(() => job(h, id).state === "completed");
    const files = h.repo.assetsForJob(id);
    expect(files.map((a) => a.kind)).toEqual(["file"]);
    expect(h.repo.queryAssets({ limit: 50 }).total).toBe(0);
    expect(h.repo.queryAssets({ kind: "file", limit: 50 }).total).toBe(1);
  });

  it("opens a returned CSV but refuses to open a returned .bat (folder only)", async () => {
    h = makeHarness({
      gw: () => ({
        completeMs: 20,
        reply: () => ({ text: "Hai tệp", files: [{ name: "ket-qua.csv", mime: "text/csv", bytes: enc("x\n1\n") }, { name: "chay.bat", mime: "application/octet-stream", bytes: enc("@echo off\r\n") }] }),
      }),
    });
    await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Hai tệp"));
    await until(() => job(h, id).state === "completed");
    const files = h.repo.assetsForJob(id);
    const byExt = (ext: string) => files.find((a: Asset) => (a.filename ?? a.path).endsWith(ext))!;
    expect(files).toHaveLength(2);
    const opened: string[] = [];
    const d = dispatcher(opened);
    const r = await d.dispatch("library.open", { assetId: byExt(".csv").id });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await d.dispatch("library.open", { assetId: byExt(".bat").id })).toMatchObject({ ok: false, code: "unsupported_file" });
    expect(await d.dispatch("library.reveal", { assetId: byExt(".bat").id })).toMatchObject({ ok: true });
    expect(opened).toEqual([byExt(".csv").path, `reveal:${byExt(".bat").path}`]);
  });
});
