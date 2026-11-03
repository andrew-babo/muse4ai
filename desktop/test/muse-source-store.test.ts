import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, readSchemaVersion, SCHEMA_VERSION } from "../src/main/db";
import { Repo } from "../src/main/repo";
import { publicJob } from "../src/shared/jobMachine";
import { sqlite } from "./helpers";

describe("Muse durable private source store", () => {
  it("AC-MEX-02: v3 upgrade keeps old Muse unbound and preserves hashes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-source-"));
    const file = path.join(dir, "store.sqlite");
    const backups = path.join(dir, "backups");
    const old = openDatabase(sqlite, file, backups, { targetVersion: 3 });
    old.db.prepare("INSERT INTO assets(id,job_id,path,sha256,kind,mime,bytes,created_at,rev) VALUES('a','j','x.mp4','unchanged','video','video/mp4',10,1,1)").run();
    old.db.close();
    const current = openDatabase(sqlite, file, backups);
    expect(readSchemaVersion(current.db)).toBe(SCHEMA_VERSION);
    expect(current.backupPath && fs.existsSync(current.backupPath)).toBe(true);
    expect(new Repo(current.db).getAsset("a")).toMatchObject({ sha256: "unchanged", sourceStatus: null });
    current.db.close();
  });
  it("AC-MEX-07/13: reservation cannot be stolen or released while unresolved", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    // Use production migration, not a hand-written parallel schema.
    db.close();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-lock-"));
    const opened = openDatabase(sqlite, path.join(dir, "store.sqlite"), path.join(dir, "backups"));
    const repo = new Repo(opened.db);
    repo.setMuseTip("owner", "/thread/t1", "asset1");
    expect(repo.reserveMuseConversation("owner", "/thread/t1", "chain1")).toBe(true);
    expect(repo.reserveMuseConversation("owner", "/thread/t1", "chain2")).toBe(false);
    repo.markMuseUnresolved("owner", "/thread/t1", "job1");
    repo.releaseMuseConversation("chain1");
    expect(repo.museConversation("owner", "/thread/t1")).toMatchObject({ chain: "chain1", unresolved: "job1" });
    repo.setMuseTip("owner", "/thread/t1", "asset2");
    repo.releaseMuseConversation("chain1");
    expect(repo.reserveMuseConversation("owner", "/thread/t1", "chain2")).toBe(true);
    opened.db.close();
  });
  it("AC-MEX-14: public jobs never expose the conversation locator", () => {
    expect(publicJob({ site: "muse", remoteRef: "/thread/CANARY-THREAD" }).remoteRef).toBe("muse");
    expect(publicJob({ site: "vibes", remoteRef: "CANARY-BATCH" }).remoteRef).toBe("vibes");
  });
});