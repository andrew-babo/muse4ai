import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { job, makeHarness, seedAccounts, sqlite, type Harness } from "./helpers";
import { fixtureMedia, makeApi, mcpPost, type ApiRig } from "./apiHelpers";

// AC-GW-07 (fake part, P8): after 20 jobs over the direct channel, no Muse thread id or Muse workspace file path
// leaves the store's internal columns — not in renderer events, logs, API/MCP responses or the diagnostics bundle.
// The live part (VPS logs and evidence) is scanned in P9.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

const CSV = new TextEncoder().encode("n,square\n1,1\n2,4\n3,9\n");

/** Waits on the store (not the API, which is rate limited) until the job is final. */
async function untilFinal(id: string): Promise<void> {
  const end = Date.now() + 8_000;
  while (!["completed", "failed", "needs_review", "cancelled"].includes(job(h, id).state)) {
    if (Date.now() > end) throw new Error(`job ${id} stuck in ${job(h, id).state}`);
    h.coord.runScheduler();
    await new Promise((res) => setTimeout(res, 10));
  }
}

/** API read; on 429 the fake clock moves one minute so the key's bucket refills (the limiter is not under test). */
async function read(method: string, p: string, o: Parameters<ApiRig["req"]>[2] = {}) {
  for (let i = 0; i < 3; i++) {
    const r = await rig!.req(method, p, { token: rig!.gen, ...o });
    if (r.status !== 429) return r;
    h.clock.t += 61_000;
  }
  throw new Error(`still rate limited: ${p}`);
}

/** Columns that are allowed to hold Muse-side identifiers (internal only, never projected out). */
// remote_sources.muse_source: an HTTP video's gw: source (session id + workspace path), main-only like the UI path's.
const INTERNAL = new Set(["jobs.remote_session_id", "muse_conversations.conversation", "remote_sources.muse_source"]);

describe("AC-GW-07 — Muse ids and workspace paths stay inside the store", () => {
  it("20 HTTP jobs (chat with files, follow-ups, images, videos): 0 leaks in events, logs, REST, MCP or diagnostics", async () => {
    h = makeHarness({
      gw: () => ({
        reply: (prompt) => {
          if (/^Generate an image/.test(prompt)) return { text: "Here is your image", files: [{ name: "image.jpg", mime: "image/jpeg", bytes: fixtureMedia("image", prompt.length) }] };
          if (/^Generate a short video/.test(prompt)) return { text: "Here is your video", files: [{ name: "video.mp4", mime: "video/mp4", bytes: fixtureMedia("video", prompt.length) }] };
          if (prompt.includes("CSV")) return { text: "Bảng đây", files: [{ name: "bang.csv", mime: "text/csv", bytes: CSV }] };
          return { text: `Trả lời: ${prompt.slice(0, 80)}` };
        },
      }),
    });
    await seedAccounts(h, ["Mây", "Sương"]);
    rig = await makeApi(h);

    const ids: string[] = [];
    const post = async (json: Record<string, unknown>) => {
      const r = await read("POST", "/v1/jobs", { json });
      expect(r.status).toBe(202);
      return r.json.jobs[0].id as string;
    };
    // 8 chats (4 with a CSV answer), each followed by one follow-up in the same conversation → 16 chat jobs.
    for (let i = 0; i < 8; i++) {
      const first = await post({ kind: "chat", prompt: i % 2 ? `Câu ${i}: tạo CSV bình phương` : `Câu ${i}: tóm tắt cà phê` });
      await untilFinal(first);
      expect(job(h, first).state).toBe("completed");
      ids.push(first);
      const next = await post({ kind: "chat", prompt: `Hỏi tiếp ${i}`, conversation_id: job(h, first).conversationId });
      await untilFinal(next);
      expect(job(h, next).state).toBe("completed");
      ids.push(next);
    }
    for (let i = 0; i < 2; i++) ids.push(await post({ kind: "image", prompt: `Con mèo số ${i} trên mái nhà` }));
    for (let i = 0; i < 2; i++) ids.push(await post({ kind: "video", prompt: `Sóng biển số ${i}` }));
    for (const id of ids) await untilFinal(id);
    expect(ids).toHaveLength(20);
    expect(ids.filter((id) => job(h, id).state === "completed")).toHaveLength(20);

    // Every job ran over HTTP and has a Muse thread id stored internally.
    const db = new sqlite.DatabaseSync(h.dbFile);
    const sessions = (db.prepare("SELECT DISTINCT remote_session_id AS s FROM jobs WHERE remote_session_id IS NOT NULL").all() as { s: string }[]).map((r) => r.s);
    const httpJobs = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE exec_path = 'http'").get() as { n: number };
    expect(httpJobs.n).toBe(20);
    expect(sessions.length).toBeGreaterThanOrEqual(12); // 8 chat threads + 4 media threads
    const needles = [...sessions, "/workspace/"];
    const leaks = (where: string, text: string) => needles.filter((n) => text.includes(n)).map((n) => `${where}: ${n.slice(0, 12)}`);

    // Renderer events and logs.
    const found: string[] = [];
    found.push(...leaks("events", JSON.stringify(h.events)));
    found.push(...leaks("logs", h.logs.join("\n")));

    // REST: every job, the job list, every conversation, status.
    const finals: Record<string, unknown>[] = [];
    for (const id of ids) {
      const r = await read("GET", `/v1/jobs/${id}`);
      expect(r.status).toBe(200);
      finals.push(r.json);
      found.push(...leaks(`GET /v1/jobs/${id}`, r.body.toString("utf8")));
    }
    found.push(...leaks("GET /v1/jobs", (await read("GET", "/v1/jobs?limit=100")).body.toString("utf8")));
    const convs = new Set(finals.map((r) => r.conversation_id).filter(Boolean) as string[]);
    expect(convs.size).toBeGreaterThanOrEqual(8);
    for (const c of convs) {
      const r = await read("GET", `/v1/conversations/${c}`);
      expect(r.status).toBe(200);
      found.push(...leaks(`GET /v1/conversations/${c}`, r.body.toString("utf8")));
    }
    found.push(...leaks("GET /v1/status", (await read("GET", "/v1/status")).body.toString("utf8")));

    // MCP: status and one job.
    const mcp = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_status", arguments: {} } }, { headers: { "mcp-protocol-version": "2025-11-25" } });
    expect(mcp.status).toBe(200);
    found.push(...leaks("MCP muse_status", mcp.body.toString("utf8")));
    const mj = await mcpPost(rig, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "muse_get_job", arguments: { job_id: ids[1] } } }, { headers: { "mcp-protocol-version": "2025-11-25" } });
    expect(mj.body.toString("utf8")).toContain(ids[1]);
    found.push(...leaks("MCP muse_get_job", mj.body.toString("utf8")));

    // Diagnostics bundle (logs written as the real logger would, then bundled).
    const logFile = path.join(h.dir, "app-test.log");
    fs.writeFileSync(logFile, h.logs.join("\n"));
    const zip = diagnosticsWith(rig, logFile);
    found.push(...leaks("diagnostics.zip", zip.toString("utf8")));

    // Store: Muse ids only in internal columns.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of tables) {
      const rows = db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];
      for (const row of rows)
        for (const [col, v] of Object.entries(row)) {
          if (typeof v !== "string" || INTERNAL.has(`${t}.${col}`)) continue;
          found.push(...leaks(`store ${t}.${col}`, v));
        }
    }
    db.close();
    expect([...new Set(found)]).toEqual([]);
  });
});

function diagnosticsWith(r: ApiRig, logFile: string): Buffer {
  // Services takes its log list at construction; read through the same code path with a one-off list.
  const s = r.services as unknown as { d: { logFiles: () => string[] }; diagnosticsZip: () => Buffer };
  const prev = s.d.logFiles;
  s.d.logFiles = () => [logFile];
  try {
    return s.diagnosticsZip();
  } finally {
    s.d.logFiles = prev;
  }
}
