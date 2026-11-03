import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, SCHEMA_VERSION } from "../src/main/db";
import { defaultSettings, Repo } from "../src/main/repo";
import { publicJob } from "../src/shared/jobMachine";
import { sqlite } from "./helpers";

function v4Store(seed: (db: import("node:sqlite").DatabaseSync) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v4-"));
  const file = path.join(dir, "data", "muse.sqlite");
  const backups = path.join(dir, "backups");
  const v4 = openDatabase(sqlite, file, backups, { targetVersion: 4 });
  seed(v4.db);
  v4.db.close();
  return { file, backups };
}

describe("Build 2.0 R112 — store schema 4 → 5 (AC-PATH-01, AC-OPS-01)", () => {
  it("backs up first, keeps every row, and applies the Build 2.0 defaults (auto/10/2, total 40, UI pages = old total)", () => {
    expect(SCHEMA_VERSION).toBe(6);
    const { file, backups } = v4Store((db) => {
      db.prepare("INSERT INTO accounts(id,alias,alias_key,state,capabilities,created_at,rev) VALUES('a1','Mây','mây','ready','{}',1,1),('a2','Sương','sương','needs_login','{}',1,2),('a3','Gió','gió','paused','{}',1,3)").run();
      const ins = db.prepare("INSERT INTO jobs(id,kind,mode,prompt,state,created_at,updated_at,rev) VALUES(?,?,?,?,?,?,?,?)");
      for (let i = 0; i < 1000; i++) ins.run(`j${i}`, i % 2 ? "video" : "image", "text", `p${i}`, "completed", i, i, 10 + i);
      const asset = db.prepare("INSERT INTO assets(id,job_id,path,sha256,kind,mime,bytes,created_at,rev) VALUES(?,?,?,?,?,?,?,?,?)");
      for (let i = 0; i < 300; i++) asset.run(`as${i}`, `j${i}`, `x${i}`, `s${i}`, "image", "image/png", 1, i, 2000 + i);
      db.prepare("INSERT INTO refs(id,sha256,path,mime,width,height,bytes,created_at) VALUES('r1','h1','r1.png','image/png',1,1,1,1),('r2','h2','r2.mp4','video/mp4',1,1,1,1)").run();
      db.prepare("INSERT INTO muse_conversations(id,account_id,conversation) VALUES('mc_00000000-0000-0000-0000-000000000001','a1','/thread/x')").run();
      db.prepare("INSERT INTO settings(key,value) VALUES('globalConcurrency','6')").run();
    });
    const v5 = openDatabase(sqlite, file, backups);
    expect(v5.migratedFrom).toBe(4);
    expect(fs.existsSync(v5.backupPath!)).toBe(true);
    expect((v5.db.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check).toBe("ok");
    const repo = new Repo(v5.db);
    const accs = repo.listAccounts();
    expect(accs.map((a) => [a.alias, a.execMode, a.maxConcurrent, a.uiMaxConcurrent])).toEqual([
      ["Mây", "auto", 10, 2],
      ["Sương", "auto", 10, 2],
      ["Gió", "auto", 10, 2],
    ]);
    expect((v5.db.prepare("SELECT COUNT(*) c FROM jobs").get() as { c: number }).c).toBe(1000);
    expect((v5.db.prepare("SELECT COUNT(*) c FROM assets").get() as { c: number }).c).toBe(300);
    const s = repo.getSettings(defaultSettings("/lib"));
    expect([s.globalConcurrency, s.concurrencyUiPages, s.bridgeHttpEnabled]).toEqual([40, 6, true]);
    expect([repo.getRef("r1")!.kind, repo.getRef("r2")!.kind]).toEqual(["image", "video"]);
    expect(repo.getJob("j1")).toMatchObject({ execPath: null, resultText: null, conversationId: null, outputsTruncated: false });
    expect(repo.museConversationById("mc_00000000-0000-0000-0000-000000000001")).not.toBeNull();
    v5.db.close();
    // Second open: nothing runs again, no new backup.
    const again = openDatabase(sqlite, file, backups);
    expect(again.migratedFrom).toBeNull();
    expect(new Repo(again.db).getSettings(defaultSettings("/lib")).concurrencyUiPages).toBe(6);
    again.db.close();
  });

  it("an upgrade that never saved the old total takes the old default (4) as UI pages", () => {
    const { file, backups } = v4Store((db) => db.prepare("INSERT INTO accounts(id,alias,alias_key,state,capabilities,created_at,rev) VALUES('a1','Mây','mây','ready','{}',1,1)").run());
    const v5 = openDatabase(sqlite, file, backups);
    const s = new Repo(v5.db).getSettings(defaultSettings("/lib"));
    expect([s.globalConcurrency, s.concurrencyUiPages]).toEqual([40, 4]);
    v5.db.close();
  });

  it("a fresh store keeps the code defaults: 8 UI pages, total 40", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v5-"));
    const r = openDatabase(sqlite, path.join(dir, "muse.sqlite"), path.join(dir, "b"));
    const s = new Repo(r.db).getSettings(defaultSettings("/lib"));
    expect([s.globalConcurrency, s.concurrencyUiPages, s.bridgeHttpEnabled]).toEqual([40, 8, true]);
    r.db.close();
  });

  it("R96 — the Muse conversation id of an HTTP job never leaves the main process", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v5-"));
    const r = openDatabase(sqlite, path.join(dir, "muse.sqlite"), path.join(dir, "b"));
    const repo = new Repo(r.db);
    const j = repo.insertJob({ batchId: null, kind: "chat", mode: "text", prompt: "hi", referenceIds: [], accountPref: "auto", state: "queued", priority: 0, clientRequestId: null, now: 1 });
    const row = repo.updateJob(j.id, { remoteSessionId: "2f1c0a7e-0000-4000-8000-000000000000", baselineUserMsgs: 0, execPath: "http" }, 2);
    expect(row.remoteSessionId).toBe("2f1c0a7e-0000-4000-8000-000000000000");
    const pub = publicJob(row);
    expect(JSON.stringify(pub)).not.toContain("2f1c0a7e");
    expect(pub).not.toHaveProperty("baselineUserMsgs");
    expect(pub.execPath).toBe("http");
    r.db.close();
  });
});
