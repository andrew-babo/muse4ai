import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, SCHEMA_VERSION } from "../src/main/db";
import { Repo } from "../src/main/repo";
import { sqlite } from "./helpers";

// Build 3.2 R142 / AC-PRXS-04 — store v6 → v7: one proxy may serve several accounts; every existing row survives.

function v6Store(seed: (db: import("node:sqlite").DatabaseSync) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-v6-"));
  const file = path.join(dir, "data", "muse.sqlite");
  const backups = path.join(dir, "backups");
  const v6 = openDatabase(sqlite, file, backups, { targetVersion: 6 });
  seed(v6.db);
  v6.db.close();
  return { file, backups };
}

const ACCOUNT_COLS = "id,alias,alias_key,avatar,state,state_until,state_note,proxy_id,capabilities,today_count,today_date,quota,last_active_at,fail_times,created_at,rev,exec_mode,max_concurrent,ui_max_concurrent";
const PROXY_COLS = "id,label,scheme,host,port,secret_ref,has_auth,health,exit_ip_masked,country,latency_ms,last_tested_at,last_error,created_at,rev";

describe("store schema 6 → 7 (AC-PRXS-04)", () => {
  it("backs up first, keeps every account/proxy value, then lets two accounts share a proxy", () => {
    expect(SCHEMA_VERSION).toBe(7);
    const { file, backups } = v6Store((db) => {
      db.prepare(`INSERT INTO proxies(id,label,scheme,host,port,secret_ref,has_auth,health,exit_ip_masked,country,latency_ms,last_tested_at,last_error,account_id,created_at,rev) VALUES
        ('p1','P01','http','10.0.0.1',8080,'vault:p1',1,'healthy','10.0.x.x','VN',120,1000,NULL,'a1',1,1),
        ('p2','P02','socks5','10.0.0.2',1080,NULL,0,'failed',NULL,NULL,NULL,1001,'Không kết nối được','a2',2,2),
        ('p3','P03','https','10.0.0.3',443,NULL,0,'untested',NULL,NULL,NULL,NULL,NULL,NULL,3,3)`).run();
      db.prepare(`INSERT INTO accounts(${ACCOUNT_COLS}) VALUES
        ('a1','Mây','mây',2,'ready',NULL,NULL,'p1','{"muse.image":true}',4,'2026-11-04','{"weekly":1}',1700,'[1,2]',10,20,'http',7,3),
        ('a2','Gió','gió',5,'proxy_error',99,'Proxy lỗi',NULL,'{}',0,'',NULL,NULL,'[]',11,21,'auto',10,2),
        ('a3','Nắng','nắng',1,'paused',NULL,NULL,'gone','{}',0,'',NULL,NULL,'[]',12,22,'ui',1,1)`).run();
    });
    const before = (() => {
      const raw = new sqlite.DatabaseSync(file);
      const rows = raw.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts ORDER BY id`).all();
      const prox = raw.prepare(`SELECT ${PROXY_COLS} FROM proxies ORDER BY id`).all();
      raw.close();
      return { rows, prox };
    })();

    const v7 = openDatabase(sqlite, file, backups);
    expect(v7.migratedFrom).toBe(6);
    expect(path.basename(v7.backupPath!)).toMatch(/^before-v7-from-v6-\d+\.sqlite$/);
    expect(fs.existsSync(v7.backupPath!)).toBe(true);
    expect((v7.db.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check).toBe("ok");

    const after = v7.db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts ORDER BY id`).all() as Record<string, unknown>[];
    const expected = (before.rows as Record<string, unknown>[]).map((r) =>
      // Gió lost its pointer but P02 still named it → restored; Nắng pointed at a proxy that no longer exists → cleared.
      r.id === "a2" ? { ...r, proxy_id: "p2" } : r.id === "a3" ? { ...r, proxy_id: null } : r,
    );
    expect(after).toEqual(expected);
    expect(v7.db.prepare(`SELECT ${PROXY_COLS} FROM proxies ORDER BY id`).all()).toEqual(before.prox);
    const cols = (v7.db.prepare("PRAGMA table_info(proxies)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("account_id");

    const repo = new Repo(v7.db);
    expect(repo.getAccount("a1")!.proxyId).toBe("p1");
    // The UNIQUE constraint is gone: a third account on P01 is stored, and both are found by proxy.
    repo.updateAccount("a3", { proxyId: "p1" });
    expect(repo.accountsOnProxy("p1").map((a) => a.alias)).toEqual(["Mây", "Nắng"]);
    // alias stays unique, and (host, port) of proxies stays unique.
    expect(() => v7.db.prepare("INSERT INTO accounts(id,alias,alias_key,state,created_at,rev) VALUES('a9','mây','mây','new',1,1)").run()).toThrow(/UNIQUE/);
    expect(() => v7.db.prepare("INSERT INTO proxies(id,label,scheme,host,port,created_at,rev) VALUES('p9','X','http','10.0.0.1',8080,1,1)").run()).toThrow(/UNIQUE/);
    v7.db.close();

    const again = openDatabase(sqlite, file, backups);
    expect(again.migratedFrom).toBeNull();
    again.db.close();
  });
});
