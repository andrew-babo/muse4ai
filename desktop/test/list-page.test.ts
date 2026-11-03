import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/main/db";
import { Repo } from "../src/main/repo";
import { seedDataset } from "../src/main/testSeed";
import { mergePage, type JobItem } from "../src/renderer/lib/jobs";
import { sqlite } from "./helpers";

// R119 — list pages (Queue/Studio/Batch) load their files with one query and merge pages without duplicates.

function seeded(jobs: number, assets: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-list-"));
  const { db } = openDatabase(sqlite, path.join(dir, "data", "muse.sqlite"), path.join(dir, "backups"));
  const repo = new Repo(db);
  seedDataset(repo, path.join(dir, "lib"), { jobs, assets, now: new Date("2026-11-02T08:00:00Z").getTime() });
  return repo;
}

describe("R119 list page files", () => {
  it("assetsForJobs returns, per job, exactly the rows and order of assetsForJob", () => {
    const repo = seeded(60, 90);
    const page = repo.queryJobs({ order: "desc", limit: 50 });
    expect(page.items).toHaveLength(50);
    const ids = page.items.map((j) => j.id);
    const batched = repo.assetsForJobs(ids);
    expect([...batched.keys()]).toEqual(ids);
    let withFiles = 0;
    for (const id of ids) {
      expect(batched.get(id)).toEqual(repo.assetsForJob(id));
      if (batched.get(id)!.length) withFiles++;
    }
    // The seed spreads 90 files over 60 jobs, so the check covers jobs with 1 and 2 files and none.
    expect(withFiles).toBeGreaterThan(0);
    expect(ids.some((id) => batched.get(id)!.length > 1)).toBe(true);
  });

  it("assetsForJobs handles an empty page and unknown ids", () => {
    const repo = seeded(3, 3);
    expect(repo.assetsForJobs([]).size).toBe(0);
    expect(repo.assetsForJobs(["nope"]).get("nope")).toEqual([]);
  });
});

describe("R119 page merge", () => {
  const item = (id: string) => ({ id }) as unknown as JobItem;
  it("appends only rows that are not loaded yet, keeping the loaded order", () => {
    const prev = [item("c"), item("b")];
    expect(mergePage(prev, [item("b"), item("a")]).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("returns the same array when the page brings nothing new", () => {
    const prev = [item("a")];
    expect(mergePage(prev, [item("a")])).toBe(prev);
    expect(mergePage([], [item("x")]).map((x) => x.id)).toEqual(["x"]);
  });
});
