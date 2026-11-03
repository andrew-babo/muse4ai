import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REF_MAX_PER_JOB } from "../src/shared/constants";
import { normaliseCreate } from "../src/shared/api/schemas";
import { COMMANDS } from "../src/shared/ipc";
import type { ReferenceFile as Ref } from "../src/shared/types";
import { job, makeHarness, seedAccounts, type Harness } from "./helpers";

// R10 delta (verified 2026-10-31): one video may be built from several reference pictures.

const FIX = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", "media", n));

async function addRef(h: Harness, file: string): Promise<Ref> {
  const imported = await h.media.importReference(FIX(file));
  const existing = h.repo.findRefBySha(imported.sha256);
  return (
    existing ??
    h.repo.insertRef({ sha256: imported.sha256, path: imported.path, mime: imported.mime, width: imported.width, height: imported.height, bytes: imported.bytes, now: Date.now() })
  );
}

const jobInput = (referenceIds: string[], n: number) => ({
  kind: "video" as const,
  mode: "reference" as const,
  prompt: "Ghép hai bức ảnh thành một đoạn video",
  referenceIds,
  accountPref: "auto",
  repeat: 1,
  clientRequestId: `multi-ref-${n}`,
});

describe("R10 — nhiều ảnh tham chiếu trong một lượt", () => {
  let h: Harness;
  let refs: Ref[];

  beforeEach(async () => {
    h = makeHarness();
    await seedAccounts(h, ["A"]);
    refs = await Promise.all([addRef(h, "coffee.jpg"), addRef(h, "flowers.jpg"), addRef(h, "mountains.jpg"), addRef(h, "waves.jpg")]);
  });

  afterEach(() => h.close());

  it("keeps every reference of a two-picture job, in the order added", () => {
    const [id] = h.coord.createJobs(jobInput([refs[0].id, refs[1].id], 1));
    expect(job(h, id).referenceIds).toEqual([refs[0].id, refs[1].id]);
  });

  it("refuses one more reference than the limit", () => {
    const base = refs[0];
    const ids = Array.from({ length: REF_MAX_PER_JOB + 1 }, (_, i) =>
      h.repo.insertRef({ sha256: `${"f".repeat(60)}${String(i).padStart(4, "0")}`, path: base.path, mime: base.mime, width: base.width, height: base.height, bytes: base.bytes, now: Date.now() }).id,
    );
    expect(() => h.coord.createJobs(jobInput(ids.slice(0, REF_MAX_PER_JOB), 6))).not.toThrowError();
    expect(() => h.coord.createJobs(jobInput(ids, 2))).toThrowError(new RegExp(`1–${REF_MAX_PER_JOB}`));
  });

  it("counts the same picture only once", () => {
    const [id] = h.coord.createJobs(jobInput([refs[0].id, refs[0].id, refs[1].id], 3));
    expect(job(h, id).referenceIds).toEqual([refs[0].id, refs[1].id]);
  });

  it("the agent API accepts an array of references and refuses one too many", () => {
    const ok = normaliseCreate({ kind: "video", prompt: "x", reference_ids: [refs[0].id, refs[1].id, refs[2].id] });
    expect(ok.mode).toBe("reference");
    expect(ok.reference_ids).toEqual([refs[0].id, refs[1].id, refs[2].id]);
    const tooMany = Array.from({ length: REF_MAX_PER_JOB + 1 }, (_, i) => `ref-${i}`);
    expect(() => normaliseCreate({ kind: "video", prompt: "x", reference_ids: tooMany })).toThrowError();
    // a single reference still normalises to exactly the fields it had before (R27 fingerprints)
    const one = normaliseCreate({ kind: "video", prompt: "x", reference_id: refs[0].id });
    expect(one).not.toHaveProperty("reference_ids");
    expect(one.reference_id).toBe(refs[0].id);
  });

  it("R10 limit is 50 (what Muse's own picker accepted live)", () => {
    expect(REF_MAX_PER_JOB).toBe(50);
  });

  it("the desktop composer may send up to the limit and no more", () => {
    const schema = COMMANDS["job.create"];
    expect(() => schema.parse({ ...jobInput([refs[0].id, refs[1].id], 4), site: undefined })).not.toThrowError();
    const fake = (n: number) => Array.from({ length: n }, (_, i) => `ref-${i}`);
    expect(() => schema.parse({ ...jobInput(fake(REF_MAX_PER_JOB), 7), site: undefined })).not.toThrowError();
    expect(() => schema.parse({ ...jobInput(fake(REF_MAX_PER_JOB + 1), 5), site: undefined })).toThrowError();
  });
});
