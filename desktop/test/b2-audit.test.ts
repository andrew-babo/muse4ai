import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { fakePng } from "../src/main/adapter/fake";
import type { FakeGwConfig, FakeGwStep } from "../src/main/adapter/fakeGateway";
import { queuedWaitLabel } from "../src/shared/execution";
import { makeApi, type ApiRig } from "./apiHelpers";
import { job, makeHarness, seedAccounts, textJob, type Harness } from "./helpers";

// Build 2.0 P10 audit, wave 2 — acceptance criteria that had no test bound to their ID yet
// (AC-CHAT-06, AC-GW-04, AC-PATH-04/05/08, AC-CC-03/06/08/09). Coordinator + SQLite + fake Muse channel/page.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

const MIN = 60_000;
const LONG = { timeoutMs: { chat: 20_000, image: 20_000, video: 20_000 } };
const LIVE_STATES = new Set(["preparing", "submitting", "submitted", "generating", "downloading", "download_retry"]);
const chat = (prompt: string, extra: Record<string, unknown> = {}) => ({ prompt, referenceIds: [] as string[], accountPref: "auto", clientRequestId: `req-${Math.random()}`, ...extra });
const settled = (id: string) => ["completed", "failed", "needs_review", "cancelled"].includes(job(h, id).state);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const failConnects = (n: number, error: "connect_failed" | "protocol_mismatch" = "connect_failed"): FakeGwStep[] => Array.from({ length: n }, () => ({ phase: "connect" as const, error }));
const exec = (id: string) => h.coord.snapshot().accounts.find((a) => a.id === id)!.execution!;

async function until(cond: () => boolean, ms = 6_000, each?: () => void): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    h.coord.runScheduler();
    each?.();
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("AC-CHAT-06 — empty answers and refusals (R83)", () => {
  it("no text and no file → failed EMPTY_RESPONSE; a chat answered “I can’t help with that” → completed with exactly that text; an image Muse refuses → CONTENT_REFUSED like Build 1.0; each sent once", async () => {
    const refusal = "I can’t help with that.";
    h = makeHarness({
      gw: () => ({
        reply: (prompt) =>
          prompt.includes("TRỐNG") ? { text: "" } : prompt.startsWith("Generate an image") ? { text: "I can't create that image because it violates our content policy." } : { text: refusal },
      }),
    });
    const [a] = await seedAccounts(h, ["Mây"]);
    const empty = h.coord.createChatJob(chat("TRỐNG"));
    const refused = h.coord.createChatJob(chat("Một câu Muse không trả lời"));
    const [img] = h.coord.createJobs(textJob("ảnh bị từ chối"));
    await until(() => [empty, refused, img].every(settled));
    expect(job(h, empty)).toMatchObject({ state: "failed", errorClass: "EMPTY_RESPONSE" });
    expect(job(h, refused)).toMatchObject({ state: "completed", resultText: refusal, errorClass: null });
    expect(job(h, img)).toMatchObject({ state: "failed", errorClass: "CONTENT_REFUSED", execPath: "http" });
    expect(h.repo.assetsForJob(img)).toHaveLength(0);
    // Nothing is resent, nothing moves to the UI path or another account.
    expect(h.gwCfg(a).sent).toHaveLength(3);
    expect(h.adapters.get(a)?.calls.submit ?? 0).toBe(0);
  });
});

describe("AC-GW-04 — following turns (R94)", () => {
  it("a turn finished before the app subscribes (only its status replays) → the text comes from history, byte for byte", async () => {
    const exact = "Dòng 1 — “ngoặc kép” 🍵\n\tthụt lề  hai dấu cách\r\n<b>không phải HTML</b> & ký tự đặc biệt ✓";
    h = makeHarness({ gw: () => ({ completeMs: 0, ackDelayMs: 60, reply: () => ({ text: exact }) }) });
    const [a] = await seedAccounts(h, ["Mây"]);
    const id = h.coord.createChatJob(chat("Trả lời đúng nguyên văn"));
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    expect(Buffer.from(job(h, id).resultText!, "utf8").equals(Buffer.from(exact, "utf8"))).toBe(true);
    expect(h.gwCfg(a).sent).toHaveLength(1);
  });

  it("an image turn without a “done” event completes from two equal history reads (stable gap scaled: 5 s in production)", async () => {
    h = makeHarness({ gw: () => ({ emitCompleted: false }) });
    await seedAccounts(h, ["Mây"]);
    const [img] = h.coord.createJobs(textJob("ảnh không có sự kiện xong"));
    await until(() => settled(img));
    expect(job(h, img)).toMatchObject({ state: "completed", execPath: "http" });
    expect(h.repo.assetsForJob(img)).toHaveLength(1);
    const { DEFAULT_TIMINGS } = await import("../src/main/execution");
    expect(DEFAULT_TIMINGS.stableGapMs).toBe(5_000);
  });

  it("20 turns on one account whose events interleave → every job gets only its own text or file (0 mix-ups), each sent once", async () => {
    h = makeHarness({
      gw: () => {
        const cfg: FakeGwConfig = {
          reply: (prompt) => {
            cfg.completeMs = 5 + Math.floor(Math.random() * 150); // this turn's own finish time → events interleave
            const n = Number(/T(\d+)-/.exec(prompt)?.[1] ?? -1);
            return prompt.startsWith("Generate an image") ? { text: `ảnh T${n}-`, files: [{ name: `t${n}.png`, mime: "image/png", bytes: fakePng(n + 1) }] } : { text: `trả lời T${n}- xong` };
          },
        };
        return cfg;
      },
    });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.coord.setExecution(a, { mode: "auto", maxConcurrent: 20, uiMaxConcurrent: 2 });
    const chats = Array.from({ length: 14 }, (_, n) => ({ n, id: h.coord.createChatJob(chat(`T${n}- câu hỏi`)) }));
    const images = Array.from({ length: 6 }, (_, i) => ({ n: 14 + i, id: h.coord.createJobs(textJob(`T${14 + i}- ảnh`))[0] }));
    await until(() => [...chats, ...images].every((x) => settled(x.id)), 10_000);
    for (const c of chats) expect(job(h, c.id)).toMatchObject({ state: "completed", resultText: `trả lời T${c.n}- xong` });
    for (const im of images) {
      expect(job(h, im.id).state).toBe("completed");
      const assets = h.repo.assetsForJob(im.id);
      expect(assets).toHaveLength(1);
      expect(assets[0].sha256).toBe(sha(fakePng(im.n + 1)));
    }
    expect(h.gwCfg(a).sent).toHaveLength(20);
  });
});

describe("AC-PATH-04/05/08 — switching paths (R88, R91, R96)", () => {
  it("AC-PATH-04: auto account, HTTP goes down with 4 accepted HTTP turns; UI cap 2; 5 new jobs → never more than 2 UI turns at once, one notice, the 4 finish over HTTP after reconnecting, nothing resent", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 300 }), httpTimings: LONG, uiPagesPerAccount: 2 });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(a).generateDelayMs = 60;
    const cfg = h.gwCfg(a);
    const old = Array.from({ length: 4 }, (_, i) => h.coord.createJobs(textJob(`HTTP cũ ${i}`))[0]);
    await until(() => (cfg.sent?.length ?? 0) === 4);
    // Muse drops the socket and every reconnect fails → HTTP down.
    cfg.script = failConnects(100_000);
    cfg.serverDrop = true;
    const fresh = Array.from({ length: 5 }, (_, i) => h.coord.createJobs(textJob(`Mới ${i}`))[0]);
    let peakUi = 0;
    await until(
      () => fresh.every(settled),
      10_000,
      () => (peakUi = Math.max(peakUi, exec(a).runningUi)),
    );
    for (const id of fresh) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "ui" });
    expect(peakUi).toBeGreaterThan(0);
    expect(peakUi).toBeLessThanOrEqual(2);
    expect(old.some(settled)).toBe(false); // still waiting for HTTP, not resent elsewhere
    // The channel comes back: the 4 accepted turns are followed to the end over HTTP.
    cfg.script = [];
    await until(() => old.every(settled), 10_000);
    for (const id of old) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    expect(h.notices.filter((n) => n.title.includes("chuyển sang chạy giao diện"))).toHaveLength(1);
    expect(cfg.sent).toHaveLength(4);
    expect(h.adapters.get(a)!.calls.submit).toBe(5);
  });

  it("AC-PATH-05: an http-only account whose HTTP is down opens no UI page; Tự động jobs go to another account; its pinned job waits “Chờ HTTP của {tên}”; /v1/status shows down / none", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.gwCfg(A).script = failConnects(100_000);
    h.coord.setExecution(A, { mode: "http", maxConcurrent: 10, uiMaxConcurrent: 2 });
    const [pinned] = h.coord.createJobs(textJob("Chỉ Mây", { accountPref: A }));
    await until(() => exec(A).httpState === "down");
    const auto = [1, 2, 3].map((i) => h.coord.createJobs(textJob(`Tự động ${i}`))[0]);
    await until(() => auto.every(settled));
    for (const id of auto) expect(job(h, id)).toMatchObject({ state: "completed", accountId: B, execPath: "http" });
    expect(job(h, pinned).state).toBe("queued");
    expect(h.adapters.get(A)?.calls.submit ?? 0).toBe(0);
    expect(h.adapters.get(A)?.calls.observe ?? 0).toBe(0);
    const accA = h.coord.snapshot().accounts.find((x) => x.id === A)!;
    expect(queuedWaitLabel(job(h, pinned), accA)).toBe("Chờ HTTP của Mây");
    expect(queuedWaitLabel({ accountPref: "auto" }, accA)).toBe("Đang chờ tài khoản");
    rig = await makeApi(h);
    const st = await rig.req("GET", "/v1/status", { token: rig.read });
    const item = (st.json.accounts.items as { alias: string; execution: Record<string, unknown> }[]).find((x) => x.alias === "Mây")!;
    expect(item.execution).toMatchObject({ mode: "http", http_state: "down", active_path: "none" });
  });

  it("AC-PATH-08: protocol mismatch on A then B within 10 minutes → app-wide “không tương thích”: one notice, bridge incompatible, auto accounts run on the UI path, an http-only account takes nothing", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [A, B, C] = await seedAccounts(h, ["Mây", "Sương", "Mưa"]);
    h.coord.setExecution(C, { mode: "http", maxConcurrent: 10, uiMaxConcurrent: 2 });
    h.gwCfg(A).script = failConnects(3, "protocol_mismatch");
    h.gwCfg(B).script = failConnects(3, "protocol_mismatch");
    const first = [h.coord.createJobs(textJob("A", { accountPref: A }))[0], h.coord.createJobs(textJob("B", { accountPref: B }))[0]];
    const mark = h.events.length;
    await until(() => h.coord.engineStatus().bridge?.compat === "incompatible");
    expect(h.notices.filter((n) => n.title === "Kênh trực tiếp Muse không tương thích")).toHaveLength(1);
    // AC-VIEW-01 state 7: every open account card is told at once (C never touched HTTP, yet its card must change).
    const lastCard = (id: string) => h.events.slice(mark).filter((e) => e.type === "account" && (e.payload as { id: string }).id === id).at(-1)?.payload as { execution?: { httpState: string; reason: string } } | undefined;
    for (const x of [A, B, C]) expect(lastCard(x)?.execution).toMatchObject({ httpState: "off", reason: "incompatible" });
    const auto = [1, 2, 3].map((i) => h.coord.createJobs(textJob(`Sau khi không tương thích ${i}`))[0]);
    await until(() => [...first, ...auto].every(settled), 8_000);
    for (const id of [...first, ...auto]) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "ui" });
    for (const id of auto) expect([A, B]).toContain(job(h, id).accountId);
    expect(exec(C)).toMatchObject({ httpState: "off", reason: "incompatible", activePath: "none" });
    expect(exec(A)).toMatchObject({ httpState: "off", reason: "incompatible", activePath: "ui" });
    for (const x of [A, B, C]) expect(h.gwCfg(x).sent ?? []).toHaveLength(0);
  });

  it("AC-PATH-08: turning the direct channel off app-wide with 3 HTTP turns running → the 3 finish over HTTP (follow only), a new job goes to the UI path", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 300 }), httpTimings: LONG });
    const [a] = await seedAccounts(h, ["Mây"]);
    const running = [0, 1, 2].map((i) => h.coord.createJobs(textJob(`Đang chạy ${i}`))[0]);
    await until(() => (h.gwCfg(a).sent?.length ?? 0) === 3);
    h.coord.setSetting("bridgeHttpEnabled", false);
    const [after] = h.coord.createJobs(textJob("Sau khi tắt"));
    await until(() => [...running, after].every(settled), 8_000);
    for (const id of running) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    expect(job(h, after)).toMatchObject({ state: "completed", execPath: "ui" });
    expect(h.gwCfg(a).sent).toHaveLength(3);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
    expect(exec(a)).toMatchObject({ httpState: "off", reason: "global_off" });
  });
});

describe("AC-GW-08 (I) — a DIRECT proxy never carries the direct channel (R95)", () => {
  it("the channel page resolves DIRECT → nothing is sent, the account goes proxy_error, the HTTP failure count stays 0, the job then runs on the healthy account", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [A, B] = await seedAccounts(h, ["Mây", "Sương"]);
    h.coord.pauseAccount(B); // only A can take the job first
    h.gwCfg(A).script = [{ phase: "connect", error: "proxy" }];
    const [id] = h.coord.createJobs(textJob("Qua proxy"));
    await until(() => h.repo.getAccount(A)!.state === "proxy_error");
    expect(h.gwCfg(A).connects).toBeGreaterThanOrEqual(1);
    expect(h.gwCfg(A).sent ?? []).toHaveLength(0);
    expect(exec(A).failCount).toBe(0);
    expect(exec(A).httpState).not.toBe("down");
    expect(h.adapters.get(A)?.calls.submit ?? 0).toBe(0); // no fallback to A's UI page either
    expect(job(h, id).state).toBe("queued");
    h.coord.resumeAccount(B);
    await until(() => settled(id));
    expect(job(h, id)).toMatchObject({ state: "completed", accountId: B, execPath: "http" });
  });

  it("pinned to the DIRECT account: proxy_error, 0 sends, 0 HTTP failures; the job waits instead of failing over to the UI page", async () => {
    h = makeHarness({ gw: () => ({}) });
    const [A] = await seedAccounts(h, ["Mây"]);
    h.gwCfg(A).script = [{ phase: "connect", error: "proxy" }];
    const [id] = h.coord.createJobs(textJob("Chỉ Mây", { accountPref: A }));
    await until(() => h.repo.getAccount(A)!.state === "proxy_error");
    expect(h.gwCfg(A).sent ?? []).toHaveLength(0);
    expect(exec(A).failCount).toBe(0);
    expect(exec(A).httpState).not.toBe("down");
    expect(h.adapters.get(A)?.calls.submit ?? 0).toBe(0);
    expect(["queued", "failed"]).toContain(job(h, id).state);
    expect(job(h, id).state === "failed" ? job(h, id).errorClass : "PROXY_FAILED").toBe("PROXY_FAILED");
  });
});

describe("AC-CC-03/06 — app-wide caps and one send per job (R99, R100)", () => {
  it("AC-CC-03: 3 accounts × max 20, app total 40, 100 jobs → never more than 40 live turns; every job done, each sent once", async () => {
    h = makeHarness({
      gw: () => {
        const cfg: FakeGwConfig = {
          reply: (prompt) => {
            cfg.completeMs = 30 + Math.floor(Math.random() * 120);
            return { text: `ok ${prompt}` };
          },
        };
        return cfg;
      },
      httpTimings: LONG,
    });
    const accs = await seedAccounts(h, ["Một", "Hai", "Ba"]);
    for (const a of accs) h.coord.setExecution(a, { mode: "auto", maxConcurrent: 20, uiMaxConcurrent: 2 });
    h.coord.setSetting("globalConcurrency", 40);
    const ids = Array.from({ length: 100 }, (_, i) => h.coord.createChatJob(chat(`Câu ${i}`)));
    let peak = 0;
    await until(
      () => ids.every(settled),
      30_000,
      () => (peak = Math.max(peak, ids.filter((id) => LIVE_STATES.has(job(h, id).state)).length)),
    );
    expect(peak).toBeGreaterThan(20); // more than one account's worth ran at once
    expect(peak).toBeLessThanOrEqual(40);
    for (const id of ids) expect(job(h, id).state).toBe("completed");
    expect(accs.reduce((n, a) => n + (h.gwCfg(a).sent?.length ?? 0), 0)).toBe(100);
  }, 40_000);

  it("AC-CC-06: 50 rounds of 30 jobs on 3 accounts over both paths, the scheduler re-entered while async steps wait → every job is sent exactly once in total", async () => {
    for (let round = 0; round < 50; round++) {
      h = makeHarness({
        gw: () => {
          const cfg: FakeGwConfig = {
            ackDelayMs: Math.floor(Math.random() * 20),
            reply: (prompt) => {
              cfg.completeMs = Math.floor(Math.random() * 40);
              return { text: "ok", files: [{ name: "a.png", mime: "image/png", bytes: fakePng(prompt.length + round) }] };
            },
          };
          return cfg;
        },
        cfg: () => ({ submitDelayMs: Math.floor(Math.random() * 10), identityDelayMs: Math.floor(Math.random() * 10), generateDelayMs: Math.floor(Math.random() * 15) }),
      });
      const [A, B, C] = await seedAccounts(h, ["Tự động", "Giao diện", "HTTP"]);
      h.coord.setExecution(B, { mode: "ui", maxConcurrent: 10, uiMaxConcurrent: 2 });
      h.coord.setExecution(C, { mode: "http", maxConcurrent: 10, uiMaxConcurrent: 2 });
      const ids = Array.from({ length: 30 }, (_, i) => h.coord.createJobs(textJob(`R${round}J${i}#`))[0]);
      await until(
        () => ids.every(settled),
        10_000,
        () => {
          // Extra passes while sends, acks and identity reads are still pending.
          h.coord.runScheduler();
          void Promise.resolve().then(() => h.coord.runScheduler());
        },
      );
      const sentPrompts = [
        ...[A, B, C].flatMap((x) => (h.gwCfg(x).sent ?? []).map((s) => s.prompt)),
        ...[A, B, C].flatMap((x) => h.adapters.get(x)?.sentPrompts ?? []),
      ];
      expect(sentPrompts).toHaveLength(30);
      for (let i = 0; i < 30; i++) expect(sentPrompts.filter((p) => p.includes(`R${round}J${i}#`))).toHaveLength(1);
      for (const id of ids) expect(job(h, id).state).toBe("completed");
      h.close();
    }
  }, 120_000);
});

describe("AC-CC-04 (I) — memory gate for an extra UI page (R99)", () => {
  it("1.4 GB free → a second UI turn on the same account waits queued without error; 1.6 GB → it opens and runs (two pages simulated: production keeps one page per account, P5)", async () => {
    let free = 1.4 * 1024 ** 3;
    h = makeHarness({ gw: () => ({}), uiPagesPerAccount: 2, freeMemBytes: () => free });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(a).generateDelayMs = 300;
    h.coord.setExecution(a, { mode: "ui", maxConcurrent: 2, uiMaxConcurrent: 2 });
    const [one, two] = [h.coord.createJobs(textJob("Một"))[0], h.coord.createJobs(textJob("Hai"))[0]];
    await until(() => ["submitted", "generating"].includes(job(h, one).state));
    for (let i = 0; i < 5; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(job(h, two)).toMatchObject({ state: "queued", errorClass: null });
    free = 1.6 * 1024 ** 3;
    await until(() => ["submitted", "generating"].includes(job(h, two).state));
    expect(job(h, one).state).not.toBe("completed"); // both on the account at once
    await until(() => [one, two].every(settled));
  });
});

describe("AC-CC-08 — exclusive operations while HTTP and UI turns run (R102)", () => {
  /** One account with a long UI turn (started in `ui` mode) and then 6 HTTP turns accepted by Muse. */
  async function sixHttpOneUi() {
    h = makeHarness({ gw: () => ({ completeMs: 500 }), httpTimings: LONG });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(a).generateDelayMs = 700;
    h.coord.setExecution(a, { mode: "ui", maxConcurrent: 10, uiMaxConcurrent: 2 });
    const [ui] = h.coord.createJobs(textJob("Lượt giao diện"));
    await until(() => ["submitted", "generating"].includes(job(h, ui).state));
    h.coord.setExecution(a, { mode: "auto", maxConcurrent: 10, uiMaxConcurrent: 2 });
    const http = Array.from({ length: 6 }, (_, i) => h.coord.createJobs(textJob(`HTTP ${i}`))[0]);
    await until(() => (h.gwCfg(a).sent?.length ?? 0) === 6);
    return { a, ui, http };
  }

  it("takeover now: no new send on any path; the 6 HTTP turns finish by following; the UI turn follows the Build 1.0 takeover rule", async () => {
    const { a, ui, http } = await sixHttpOneUi();
    h.coord.takeoverStart(a, "now");
    const [later] = h.coord.createJobs(textJob("Gửi sau khi điều khiển", { accountPref: a }));
    await until(() => http.every(settled), 8_000);
    for (const id of http) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    expect(job(h, ui)).toMatchObject({ state: "needs_review", errorClass: "AMBIGUOUS_SUBMIT" });
    expect(job(h, later).state).toBe("queued");
    expect(h.gwCfg(a).sent).toHaveLength(6);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
    await h.coord.takeoverEnd(a);
    await until(() => settled(later));
    expect(job(h, later).state).toBe("completed");
  });

  it("proxy change: waits for the live turns (60 s, scaled), sends nothing meanwhile, then asks; “Dừng chờ” → sent turns need review and the proxy changes; closing the question keeps the old proxy", async () => {
    const { a, ui, http } = await sixHttpOneUi();
    h.coord.importProxies("10.0.0.99:8080:u9:p9\n10.0.0.98:8080:u8:p8");
    for (const p of h.repo.listProxies()) if (p.health !== "healthy") await h.coord.testProxy(p.id);
    const [p99, p98] = ["10.0.0.99", "10.0.0.98"].map((host) => h.repo.listProxies().find((p) => p.host === host)!.id);
    const before = h.repo.getAccount(a)!.proxyId;
    const [later] = h.coord.createJobs(textJob("Chờ đổi proxy", { accountPref: a }));
    const ask = await h.coord.setAccountProxy(a, p99, false, 80);
    expect(ask).toMatchObject({ changed: false, needsForce: true });
    expect(h.repo.getAccount(a)!.proxyId).toBe(before);
    // While the question is open the account stays locked: still no new send.
    for (let i = 0; i < 5; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(job(h, later).state).toBe("queued");
    const done = await h.coord.setAccountProxy(a, p99, true, 80);
    expect(done.changed).toBe(true);
    expect(h.repo.getAccount(a)!.proxyId).toBe(p99);
    for (const id of [ui, ...http]) expect(job(h, id).state).toBe("needs_review");
    expect(h.gwCfg(a).sent).toHaveLength(6);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
    // The new proxy carries the waiting job afterwards.
    await until(() => settled(later));
    expect(job(h, later).state).toBe("completed");
    // A second change asked and then closed: the proxy stays and the lock is gone.
    const [busy] = h.coord.createJobs(textJob("Đang chạy khi đổi lần hai", { accountPref: a }));
    await until(() => (h.gwCfg(a).sent?.length ?? 0) === 8);
    const ask2 = await h.coord.setAccountProxy(a, p98, false, 20);
    expect(ask2.needsForce).toBe(true);
    h.coord.cancelProxyChange(a);
    expect(h.repo.getAccount(a)!.proxyId).toBe(p99);
    await until(() => settled(busy));
    expect(job(h, busy).state).toBe("completed");
  });

  it("an unanswered “Dừng chờ” question stops holding the account after 2 minutes", async () => {
    const { a } = await sixHttpOneUi();
    h.coord.importProxies("10.0.0.99:8080:u9:p9");
    for (const p of h.repo.listProxies()) if (p.health !== "healthy") await h.coord.testProxy(p.id);
    const p99 = h.repo.listProxies().find((p) => p.host === "10.0.0.99")!.id;
    expect((await h.coord.setAccountProxy(a, p99, false, 20)).needsForce).toBe(true);
    await expect(h.coord.checkSession(a)).resolves.toBeTruthy();
    h.clock.t += 2 * MIN;
    await h.coord.tick();
    const [later] = h.coord.createJobs(textJob("Sau khi hết giữ", { accountPref: a }));
    await until(() => settled(later), 8_000);
    expect(job(h, later).state).toBe("completed");
  });

  it("removal: R16 on every turn of both paths — waits, then asks to force; forcing marks the 7 sent turns for review and removes the account", async () => {
    const { a, ui, http } = await sixHttpOneUi();
    const ask = await h.coord.removeAccount(a, false, 60);
    expect(ask).toEqual({ removed: false, needsForce: true });
    const r = await h.coord.removeAccount(a, true);
    expect(r.removed).toBe(true);
    for (const id of [ui, ...http]) expect(job(h, id)).toMatchObject({ state: "needs_review", errorClass: "AMBIGUOUS_SUBMIT" });
    expect(h.repo.getAccount(a)).toBeFalsy();
    expect(h.gwCfg(a).sent).toHaveLength(6);
  });
});

describe("AC-CC-09 — Usage reads with concurrent turns (R103)", () => {
  const ADD_NONE = "";
  const usage = (weekly: number, extra = "\nAdditional tokens\nNever expires\n0% used (5B tokens left)") => `Free plan\nWeekly limit resets on Nov 2\n${weekly}% used${extra}\nUpgrade`;
  const snap = (used: number, readAt: number) => ({
    plan: "Free plan",
    usedPercent: used,
    resetsOn: "Nov 2",
    resetAt: new Date(2026, 10, 2).getTime(),
    additional: { usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5e9, expiryLabel: "Never expires" },
    readAt,
  });

  it("a read runs while only HTTP turns are live; never while a UI turn holds the main page; Usage read as used up → no new send on either path while running turns finish", async () => {
    h = makeHarness({ gw: () => ({ completeMs: 600 }), httpTimings: LONG });
    const [a] = await seedAccounts(h, ["Mây"]);
    h.fakeCfg(a).now = () => h.clock.t;
    h.fakeCfg(a).quota = usage(40);
    h.repo.updateAccount(a, { quota: snap(40, h.clock.t - 11 * MIN) });
    // 1) A UI turn on the main page: 5 sent since the read (reason b) but no read while it runs.
    h.fakeCfg(a).generateDelayMs = 400;
    h.coord.setExecution(a, { mode: "ui", maxConcurrent: 10, uiMaxConcurrent: 2 });
    h.clock.t += 1000;
    const [ui] = h.coord.createJobs(textJob("Lượt giao diện"));
    await until(() => ["submitted", "generating"].includes(job(h, ui).state));
    h.coord.setExecution(a, { mode: "auto", maxConcurrent: 10, uiMaxConcurrent: 2 });
    h.clock.t += 1000;
    const http = Array.from({ length: 4 }, (_, i) => h.coord.createJobs(textJob(`HTTP ${i}`))[0]);
    await until(() => (h.gwCfg(a).sent?.length ?? 0) === 4);
    expect(job(h, ui).state).not.toBe("completed");
    expect(h.fakeCfg(a).quotaReads ?? 0).toBe(0);
    // 2) The UI turn ends; the HTTP turns are still live → the read goes ahead now.
    h.fakeCfg(a).quota = usage(100, ADD_NONE); // Muse now shows nothing left
    await until(() => (h.fakeCfg(a).quotaReads ?? 0) === 1, 8_000);
    expect(http.some((id) => !settled(id))).toBe(true);
    // 3) Used up: the account stops taking new sends on both paths; the running HTTP turns finish.
    await until(() => h.repo.getAccount(a)!.state === "limit_reached");
    const [blocked] = h.coord.createJobs(textJob("Sau khi hết hạn mức", { accountPref: a }));
    const blockedChat = h.coord.createChatJob(chat("Hỏi sau khi hết hạn mức", { accountPref: a }));
    await until(() => http.every(settled), 8_000);
    for (const id of http) expect(job(h, id)).toMatchObject({ state: "completed", execPath: "http" });
    expect(job(h, blocked).state).toBe("queued");
    expect(job(h, blockedChat).state).toBe("queued");
    expect(h.gwCfg(a).sent).toHaveLength(4);
    expect(h.adapters.get(a)!.calls.submit).toBe(1);
  });
});
