import { choosePath, jobNeeds } from "../src/shared/pathCapability";
import { describe, expect, it } from "vitest";
import { buildMuseExtendMessage, findMuseAcceptedTurn, MUSE_EXTEND_TIMEOUT_MS, museExtendEligibility, museExtendPathReason, nextMuseChainStep, validateMuseExtend, type MuseCheckpoint } from "../src/shared/museExtend";

describe("Muse Extend guardrails (Spec rev7)", () => {
  it("AC-MEX-05: max6, target≤60 and target strictly larger than source", () => {
    const input = (value: number, type: "steps" | "target" = "steps") => ({ mode: "auto" as const, plan: { type, value } });
    expect(validateMuseExtend(input(7), 6, 10_000)).not.toBeNull();
    expect(validateMuseExtend(input(0), 6, 10_000)).not.toBeNull();
    expect(validateMuseExtend(input(65, "target"), 6, 10_000)).not.toBeNull();
    expect(validateMuseExtend(input(10, "target"), 6, 10_000)).not.toBeNull();
    expect(validateMuseExtend(input(30, "target"), 6, 30_000)).not.toBeNull();
    expect(validateMuseExtend(input(60, "target"), 6, 10_000)).toBeNull();
    expect(validateMuseExtend(input(1), 6, 60_000)).toBeNull();
  });
  it("AC-MEX-06: Auto never carries a previous directive", () => {
    expect(buildMuseExtendMessage("output-1", "auto", "old directive")).not.toContain("old directive");
    expect(buildMuseExtendMessage("output-1", "directive", "pan slowly")).toContain("pan slowly");
  });
  it("AC-MEX-12: no growth is checked before reaching the step count", () => {
    expect(nextMuseChainStep({ plan: { type: "steps", value: 1 }, maxSteps: 6, stepsDone: 1, sourceMs: 30_000, outputMs: 30_400 }).action).toBe("stop");
    expect(nextMuseChainStep({ plan: { type: "steps", value: 1 }, maxSteps: 6, stepsDone: 1, sourceMs: 30_000, outputMs: 40_000 }).action).toBe("complete");
  });
  it("AC-MEX-03/04: Muse eligibility ignores Vibes and waits for the owner", () => {
    const asset = { kind: "video" as const, site: "muse" as const, sourceStatus: "ok" as const, trashedAt: null, missing: false };
    expect(museExtendEligibility(asset, { alias: "A", state: "needs_login" }, true)).toMatchObject({ ok: true });
    expect(museExtendEligibility({ ...asset, missing: true }, { alias: "A", state: "ready" }, true)?.ok).toBe(false);
    expect(museExtendEligibility({ ...asset, sourceStatus: null }, { alias: "A", state: "ready" }, true)?.ok).toBe(false);
    expect(museExtendEligibility(asset, null, true)?.ok).toBe(false);
  });
  it("AC-MEX-29: the account's HTTP/UI choice never blocks an extend; only a switched-off direct channel blocks an HTTP video", () => {
    const asset = { kind: "video" as const, site: "muse" as const, sourceStatus: "ok" as const, trashedAt: null, missing: false };
    const http = { ...asset, sourceVia: "http" as const };
    const page = { ...asset, sourceVia: "ui" as const };
    const owner = (execMode: "auto" | "http" | "ui") => ({ alias: "A", state: "ready" as const, execMode });
    for (const m of ["auto", "http", "ui"] as const) {
      expect(museExtendEligibility(http, owner(m), true, { httpOn: true })?.ok).toBe(true);
      expect(museExtendEligibility(page, owner(m), true, { httpOn: true })?.ok).toBe(true);
      expect(museExtendEligibility(page, owner(m), true, { httpOn: false })?.ok).toBe(true);
      expect(museExtendEligibility(http, owner(m), true, { httpOn: false })).toMatchObject({ ok: false, reason: expect.stringContaining("kênh trực tiếp đang tắt") });
    }
    expect(museExtendPathReason("ui", "http", true)).toBeNull();
  });
  it("AC-MEX-29: the scheduler runs an extend on its source's path whatever the account mode", () => {
    const http = jobNeeds({ kind: "video", mode: "text", operation: "extend", extendSource: "http" });
    const ui = jobNeeds({ kind: "video", mode: "text", operation: "extend", extendSource: "ui" });
    expect(choosePath({ mode: "ui", httpUsable: true, uiSlotFree: true, needs: http })).toBe("http");
    expect(choosePath({ mode: "http", httpUsable: true, uiSlotFree: true, needs: ui })).toBe("ui");
    expect(choosePath({ mode: "ui", httpUsable: false, uiSlotFree: true, needs: http })).toBeNull();
    // ordinary jobs still follow the account mode
    expect(choosePath({ mode: "ui", httpUsable: true, uiSlotFree: true, needs: jobNeeds({ kind: "video", mode: "text" }) })).toBe("ui");
  });
  it("AC-MEX-08/10: exact new turn needed; duplicate matches remain ambiguous; timeout600s", () => {
    const checkpoint: MuseCheckpoint = { conversation: "/thread/t1", sourceTurn: "a1", sourceOutput: "o1", baselineUsers: ["u1"], baselineAgents: ["a1"], message: "extend", templateVersion: "v1", acceptedUser: null };
    const snapshot = { conversation: "/thread/t1", users: [{ id: "u1", text: "extend" }], agents: [] };
    expect(findMuseAcceptedTurn(checkpoint, snapshot)).toBeNull();
    expect(findMuseAcceptedTurn(checkpoint, { ...snapshot, users: [...snapshot.users, { id: "u2", text: "extend" }] })).toBe("u2");
    expect(findMuseAcceptedTurn(checkpoint, { ...snapshot, users: [{ id: "u2", text: "extend" }, { id: "u3", text: "extend" }] })).toBeNull();
    expect(findMuseAcceptedTurn(checkpoint, { ...snapshot, conversation: "/thread/other" })).toBeNull();
    expect(MUSE_EXTEND_TIMEOUT_MS).toBe(600_000);
  });
});