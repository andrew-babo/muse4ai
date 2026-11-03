import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTION_PRAGMAS, CorruptStoreError, dailyBackup, latestGoodBackup, MigrationError, openDatabase, readSchemaVersion, restoreFromBackup, SCHEMA_VERSION } from "../src/main/db";
import { Repo } from "../src/main/repo";
import { sqlite } from "./helpers";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "muse-dur-"));

function seedV1(dir: string, jobs = 3) {
  const file = path.join(dir, "data", "muse.sqlite");
  const backups = path.join(dir, "backups");
  const { db } = openDatabase(sqlite, file, backups);
  const repo = new Repo(db);
  const ids = Array.from({ length: jobs }, (_, i) => repo.insertJob({ batchId: null, kind: "image", mode: "text", prompt: `p${i}`, referenceIds: [], accountPref: "auto", state: "queued", priority: 0, clientRequestId: null, now: 1000 + i }).id);
  db.close();
  return { file, backups, ids };
}

describe("corrupt store — screens S00 error state", () => {
  it("a garbage store is reported as corrupt; the newest good backup restores the rows; the bad file is kept", () => {
    const dir = tmp();
    const { file, backups, ids } = seedV1(dir, 4);
    const { db } = openDatabase(sqlite, file, backups);
    expect(dailyBackup(db, backups, new Date(2026, 9, 25, 9).getTime())).not.toBeNull();
    db.close();
    // An older backup that is itself broken must be skipped, and a newer broken one too.
    fs.writeFileSync(path.join(backups, "daily-20261020.sqlite"), "not sqlite");
    const newerBroken = path.join(backups, "daily-20261026.sqlite");
    fs.writeFileSync(newerBroken, "also not sqlite");
    fs.utimesSync(newerBroken, new Date(), new Date(Date.now() + 60_000));
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
    fs.writeFileSync(file, Buffer.alloc(8192, 0x41));
    expect(() => openDatabase(sqlite, file, backups)).toThrow(CorruptStoreError);
    const good = latestGoodBackup(sqlite, backups);
    expect(good && path.basename(good.path)).toBe("daily-20261025.sqlite");
    const kept = restoreFromBackup(file, good!.path, 42);
    expect(kept.endsWith(".corrupt-42")).toBe(true);
    expect(fs.readFileSync(kept).subarray(0, 4).toString()).toBe("AAAA");
    const reopened = openDatabase(sqlite, file, backups);
    expect((reopened.db.prepare("SELECT id FROM jobs ORDER BY seq").all() as { id: string }[]).map((r) => r.id)).toEqual(ids);
    reopened.db.close();
  });

  it("no usable backup → null (the app shows the error instead of a restore offer)", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "b"));
    fs.writeFileSync(path.join(dir, "b", "daily-20261020.sqlite"), "x");
    expect(latestGoodBackup(sqlite, path.join(dir, "b"))).toBeNull();
    expect(latestGoodBackup(sqlite, path.join(dir, "missing"))).toBeNull();
  });
});

describe("schema upgrade — AC-REL-04", () => {
  it("a failing upgrade restores the backup: data, version and columns are exactly as before", () => {
    const dir = tmp();
    const { file, backups, ids } = seedV1(dir);
    let err: unknown;
    try {
      openDatabase(sqlite, file, backups, { targetVersion: SCHEMA_VERSION + 1, migrations: { [SCHEMA_VERSION + 1]: "ALTER TABLE jobs ADD COLUMN extra INTEGER; SELECT * FROM table_that_does_not_exist;" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationError);
    const restoredFrom = (err as MigrationError).restoredFrom;
    expect(restoredFrom).not.toBeNull();
    expect(fs.existsSync(restoredFrom!)).toBe(true);
    const { db } = openDatabase(sqlite, file, backups);
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    const cols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("extra");
    expect((db.prepare("SELECT id FROM jobs ORDER BY seq").all() as { id: string }[]).map((r) => r.id)).toEqual(ids);
    db.close();
  });

  it("a successful upgrade writes a backup first and keeps every row", () => {
    const dir = tmp();
    const { file, backups, ids } = seedV1(dir);
    const r = openDatabase(sqlite, file, backups, { targetVersion: SCHEMA_VERSION + 1, migrations: { [SCHEMA_VERSION + 1]: "ALTER TABLE jobs ADD COLUMN extra INTEGER;" } });
    expect(r.migratedFrom).toBe(SCHEMA_VERSION);
    expect(r.backupPath && fs.existsSync(r.backupPath)).toBe(true);
    expect(readSchemaVersion(r.db)).toBe(SCHEMA_VERSION + 1);
    expect((r.db.prepare("SELECT id FROM jobs ORDER BY seq").all() as { id: string }[]).map((x) => x.id)).toEqual(ids);
    r.db.close();
  });

  it("data written by a newer app is refused (rolled-back app never touches it)", () => {
    const dir = tmp();
    const { file, backups } = seedV1(dir);
    const raw = new sqlite.DatabaseSync(file);
    raw.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(String(SCHEMA_VERSION + 4));
    raw.close();
    const before = fs.readFileSync(file);
    expect(() => openDatabase(sqlite, file, backups)).toThrow(/mới hơn/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});

describe("hard stop — AC-JOB-04", () => {
  it("100 confirmed jobs survive the writer process being killed (SIGKILL) mid-write", async () => {
    const dir = tmp();
    const { file, backups } = seedV1(dir, 0);
    // A separate process writes with the app's own connection settings and reports each confirmed insert;
    // it keeps writing after 100 so the kill lands in the middle of a write.
    const child = spawn(process.execPath, ["-e", `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1]);
      db.exec(process.argv[2]);
      const ins = db.prepare("INSERT INTO jobs(id,kind,mode,prompt,state,created_at,updated_at,rev) VALUES(?,?,?,?,?,?,?,?)");
      for (let i = 0; ; i++) {
        const id = "job-" + i;
        ins.run(id, "image", "text", "prompt " + i, "queued", i, i, i + 1);
        process.stdout.write("ok " + id + "\\n");
      }
    `, file, CONNECTION_PRAGMAS], { stdio: ["ignore", "pipe", "pipe"] });
    const confirmed: string[] = [];
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.startsWith("ok ")) confirmed.push(l.slice(3));
        if (confirmed.length >= 100 && !child.killed) {
          child.kill("SIGKILL");
          resolve();
        }
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      setTimeout(() => reject(new Error("writer did not confirm 100 jobs")), 20_000);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(confirmed.length).toBeGreaterThanOrEqual(100);
    const { db } = openDatabase(sqlite, file, backups);
    const rows = db.prepare("SELECT id, state FROM jobs").all() as { id: string; state: string }[];
    const have = new Map(rows.map((r) => [r.id, r.state]));
    const missing = confirmed.filter((id) => have.get(id) !== "queued");
    expect(missing).toEqual([]);
    db.close();
  });
});
