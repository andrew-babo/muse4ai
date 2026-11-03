import { describe, expect, it } from "vitest";
import {
  activePath,
  ageHttpHealth,
  clampInt,
  effectiveUiMax,
  EXEC_DEFAULTS,
  HTTP_PROBE_EVERY_MS,
  httpUsable,
  incompatibleAppWide,
  initialHealth,
  inRange,
  MAX_CONCURRENT_RANGE,
  manualProbeAllowed,
  probeDue,
  recordHttpFailure,
  recordHttpSuccess,
  stateLabel,
  submitGap,
  UI_MAX_RANGE,
} from "../src/shared/execution";
import { choosePath, jobNeeds, pathSupports, anyPathSupports, PATH_CAPABILITIES, HTTP_ATTACH_PROVEN_BYTES } from "../src/shared/pathCapability";

const MIN = 60_000;

describe("Build 2.0 R86/R98/R99 — execution defaults and ranges", () => {
  it("new and upgraded accounts default to auto / 10 / 2; app total 40; 8 UI pages", () => {
    expect(EXEC_DEFAULTS).toMatchObject({ mode: "auto", maxConcurrent: 10, uiMaxConcurrent: 2, globalConcurrency: 40, uiPages: 8 });
  });
  it("max per account is 1–20 and UI max 1–5; 21 and 0 are rejected", () => {
    expect(inRange(20, MAX_CONCURRENT_RANGE)).toBe(true);
    expect(inRange(21, MAX_CONCURRENT_RANGE)).toBe(false);
    expect(inRange(0, MAX_CONCURRENT_RANGE)).toBe(false);
    expect(inRange(5, UI_MAX_RANGE)).toBe(true);
    expect(inRange(6, UI_MAX_RANGE)).toBe(false);
    expect(inRange(2.5, UI_MAX_RANGE)).toBe(false);
    expect(clampInt("30", MAX_CONCURRENT_RANGE, 10)).toBe(20);
    expect(clampInt("x", MAX_CONCURRENT_RANGE, 10)).toBe(10);
  });
  it("effective UI cap = min(UI max, account max)", () => {
    expect(effectiveUiMax(10, 2)).toBe(2);
    expect(effectiveUiMax(1, 5)).toBe(1);
  });
});

describe("Build 2.0 R89 — HTTP health", () => {
  it("1–2 technical failures in 10 minutes → degraded; the 3rd → down with a probe 15 minutes later", () => {
    let h = initialHealth();
    const t0 = 1_000_000;
    h = recordHttpFailure(h, "stream_lost", t0).health;
    expect(h.state).toBe("degraded");
    h = recordHttpFailure(h, "stream_lost", t0 + MIN).health;
    expect(h.state).toBe("degraded");
    const r = recordHttpFailure(h, "fetch_failed", t0 + 2 * MIN);
    expect(r.wentDown).toBe(true);
    expect(r.health.state).toBe("down");
    expect(r.health.since).toBe(t0 + 2 * MIN);
    expect(r.health.nextProbeAt).toBe(t0 + 2 * MIN + HTTP_PROBE_EVERY_MS);
    expect(httpUsable(r.health)).toBe(false);
  });
  it("AC-PATH-03: failures at 0, 3, 8 min → degraded, degraded, down at 8; at 0, 11, 22 min never down; a success clears the count → healthy", () => {
    let h = initialHealth();
    const seen: string[] = [];
    for (const m of [0, 3, 8]) {
      h = recordHttpFailure(h, "stream_lost", m * MIN).health;
      seen.push(h.state);
    }
    expect(seen).toEqual(["degraded", "degraded", "down"]);
    expect(h.since).toBe(8 * MIN);
    let g = initialHealth();
    for (const m of [0, 11, 22]) {
      g = recordHttpFailure(g, "stream_lost", m * MIN).health;
      expect(g.state).not.toBe("down");
    }
    let k = recordHttpFailure(initialHealth(), "connect_failed", 0).health;
    k = recordHttpFailure(k, "connect_failed", MIN).health;
    k = recordHttpSuccess(k, 2 * MIN);
    expect(k.state).toBe("healthy");
    expect(k.failTimes).toHaveLength(0);
    // After the success the count starts again: one more failure is degraded, not down.
    expect(recordHttpFailure(k, "connect_failed", 3 * MIN).health.state).toBe("degraded");
  });
  it("failures 10+ minutes apart never add up to down", () => {
    let h = initialHealth();
    for (let i = 0; i < 5; i++) h = recordHttpFailure(h, "connect_failed", i * 11 * MIN).health;
    expect(h.state).toBe("degraded");
    expect(h.failTimes).toHaveLength(1);
  });
  it("one success clears the window; ageing turns degraded back to healthy", () => {
    let h = recordHttpFailure(recordHttpSuccess(initialHealth(), 0), "stream_lost", 10).health;
    expect(h.state).toBe("degraded");
    expect(recordHttpSuccess(h, 20).state).toBe("healthy");
    h = ageHttpHealth(h, 10 + 10 * MIN);
    expect(h.state).toBe("healthy");
  });
  it("a successful probe ends down; off (app-wide) is never lifted by an account success", () => {
    let h = initialHealth();
    for (let i = 0; i < 3; i++) h = recordHttpFailure(h, "connect_failed", i).health;
    expect(probeDue(h, HTTP_PROBE_EVERY_MS + 2)).toBe(true);
    expect(recordHttpSuccess(h, HTTP_PROBE_EVERY_MS + 3).state).toBe("healthy");
    const off = { ...initialHealth(), state: "off" as const, reason: "incompatible" as const };
    expect(recordHttpSuccess(off, 1).state).toBe("off");
  });
  it("while down, only a failed probe moves the next probe; a late error of an older job does not", () => {
    let h = initialHealth();
    for (let i = 0; i < 3; i++) h = recordHttpFailure(h, "connect_failed", i).health;
    const next = h.nextProbeAt;
    expect(recordHttpFailure(h, "stream_lost", 5 * MIN).health.nextProbeAt).toBe(next);
    expect(recordHttpFailure(h, "connect_failed", 16 * MIN, { probe: true }).health.nextProbeAt).toBe(16 * MIN + HTTP_PROBE_EVERY_MS);
  });
  it("a manual probe repeated within 30 s is ignored", () => {
    const h = { ...initialHealth(), lastManualProbeAt: 1_000 };
    expect(manualProbeAllowed(h, 30_999)).toBe(false);
    expect(manualProbeAllowed(h, 31_000)).toBe(true);
  });
  it("protocol mismatch on 2 accounts within 10 minutes turns HTTP off app-wide; 1 account or older ones do not", () => {
    const now = 100 * MIN;
    expect(incompatibleAppWide(new Map([["a", now - MIN]]), now)).toBe(false);
    expect(incompatibleAppWide(new Map([["a", now - MIN], ["b", now - 2 * MIN]]), now)).toBe(true);
    expect(incompatibleAppWide(new Map([["a", now - MIN], ["b", now - 11 * MIN]]), now)).toBe(false);
  });
});

describe("Build 2.0 R88 — path in use", () => {
  it("auto uses HTTP while usable, UI otherwise; http never falls back; ui never uses HTTP", () => {
    expect(activePath("auto", true)).toBe("http");
    expect(activePath("auto", false)).toBe("ui");
    expect(activePath("http", false)).toBe("none");
    expect(activePath("ui", true)).toBe("ui");
  });
  it("labels the state in plain words", () => {
    const fmt = () => "14:05";
    expect(stateLabel({ mode: "auto", activePath: "ui", httpState: "down", reason: "stream_lost", failCount: 3, since: 1, nextProbeAt: 2 }, fmt)).toBe("Đang dùng Giao diện · HTTP lỗi lúc 14:05 · thử lại 14:05");
    expect(stateLabel({ mode: "http", activePath: "none", httpState: "down", reason: "connect_failed", failCount: 3, since: 1, nextProbeAt: 2 }, fmt)).toBe("HTTP lỗi lúc 14:05 · thử lại 14:05");
    expect(stateLabel({ mode: "auto", activePath: "http", httpState: "degraded", reason: "stream_lost", failCount: 2, since: null, nextProbeAt: null }, fmt)).toBe("HTTP chập chờn (2 lỗi)");
    expect(stateLabel({ mode: "ui", activePath: "ui", httpState: "off", reason: "mode_ui", failCount: 0, since: null, nextProbeAt: null }, fmt)).toBe("Đang dùng Giao diện");
  });
  it("R101 — the pacing gap between two sends is 400–1200 ms", () => {
    expect(submitGap(() => 0)).toBe(400);
    expect(submitGap(() => 1)).toBe(1200);
    for (let i = 0; i < 50; i++) {
      const g = submitGap();
      expect(g).toBeGreaterThanOrEqual(400);
      expect(g).toBeLessThanOrEqual(1200);
    }
  });
});

describe("Build 2.0 §4.2 — path capability table", () => {
  it("cells waiting for PoC stay off (chat on the UI path, extend on HTTP); P0-2 cells proven live 01/11 are on", () => {
    expect(PATH_CAPABILITIES.ui["chat.text"]).toBe(false);
    expect(PATH_CAPABILITIES.http["muse.extend"]).toBe(false);
    expect(PATH_CAPABILITIES.http["vibes"]).toBe(false);
    expect(PATH_CAPABILITIES.http["chat.attach.image"]).toBe(true);
    expect(PATH_CAPABILITIES.http["chat.attach.mp4"]).toBe(true);
    expect(PATH_CAPABILITIES.http["image.reference"]).toBe(true);
    expect(PATH_CAPABILITIES.http["video.reference"]).toBe(true);
  });
  it("HTTP size caps: images up to 2 MiB (always inline), documents and MP4 up to 20 MiB (workspace upload)", () => {
    const MiB = 1024 * 1024;
    const ok = (kind: "image" | "video", mode: "reference", bytes: number, k: "image" | "video" | "document") => pathSupports("http", jobNeeds({ kind, mode, attachments: [{ kind: k, bytes }] }));
    expect(ok("image", "reference", 2 * MiB, "image")).toBe(true);
    expect(ok("image", "reference", 2 * MiB + 1, "image")).toBe(false);
    expect(ok("video", "reference", 2 * MiB, "image")).toBe(true);
    expect(ok("video", "reference", 20 * MiB, "video")).toBe(true);
    expect(ok("video", "reference", 20 * MiB + 1, "video")).toBe(false);
    const chatImg = (bytes: number) => pathSupports("http", jobNeeds({ kind: "chat", mode: "text", attachments: [{ kind: "image", bytes }] }));
    expect(chatImg(2 * MiB)).toBe(true);
    expect(chatImg(2 * MiB + 1)).toBe(false);
  });
  it("a text chat runs on HTTP; a chat with a document above the proven HTTP size runs nowhere yet", () => {
    const small = jobNeeds({ kind: "chat", mode: "text", attachments: [{ kind: "document", bytes: 1_000 }] });
    expect(pathSupports("http", small)).toBe(true);
    const big = jobNeeds({ kind: "chat", mode: "text", attachments: [{ kind: "document", bytes: HTTP_ATTACH_PROVEN_BYTES.document + 1 }] });
    expect(pathSupports("http", big)).toBe(false);
    expect(anyPathSupports(big, ["auto", "http", "ui"], true)).toBe(false);
    // Live 01/11: documents up to 20 MiB (the app's upload limit) are proven over HTTP via the workspace upload.
    expect(pathSupports("http", jobNeeds({ kind: "chat", mode: "text", attachments: [{ kind: "document", bytes: 20 * 1024 * 1024 }] }))).toBe(true);
  });
  it("auto: HTTP first; a job only the UI path supports (reference image above 2 MiB) goes to UI without counting as an HTTP failure", () => {
    const text = jobNeeds({ kind: "image", mode: "text" });
    const ref = jobNeeds({ kind: "image", mode: "reference", attachments: [{ kind: "image", bytes: 5_000 }] });
    const bigRef = jobNeeds({ kind: "image", mode: "reference", attachments: [{ kind: "image", bytes: 3 * 1024 * 1024 }] });
    expect(choosePath({ mode: "auto", httpUsable: true, uiSlotFree: true, needs: text })).toBe("http");
    expect(choosePath({ mode: "auto", httpUsable: true, uiSlotFree: true, needs: ref })).toBe("http");
    expect(choosePath({ mode: "auto", httpUsable: true, uiSlotFree: true, needs: bigRef })).toBe("ui");
    expect(choosePath({ mode: "auto", httpUsable: false, uiSlotFree: true, needs: text })).toBe("ui");
    expect(choosePath({ mode: "auto", httpUsable: false, uiSlotFree: false, needs: text })).toBe(null);
  });
  it("http mode never opens the UI path; ui mode never sends over HTTP; UI_CHANGED pauses only the UI path", () => {
    const text = jobNeeds({ kind: "video", mode: "text" });
    expect(choosePath({ mode: "http", httpUsable: false, uiSlotFree: true, needs: text })).toBe(null);
    expect(choosePath({ mode: "ui", httpUsable: true, uiSlotFree: true, needs: text })).toBe("ui");
    expect(choosePath({ mode: "ui", httpUsable: true, uiSlotFree: true, needs: text, uiDisabled: true })).toBe(null);
    expect(choosePath({ mode: "auto", httpUsable: true, uiSlotFree: true, needs: text, uiDisabled: true })).toBe("http");
  });
  it("Vibes and Muse extend need the UI path", () => {
    expect(jobNeeds({ kind: "video", mode: "text", site: "vibes" })).toEqual([{ cap: "vibes" }]);
    expect(choosePath({ mode: "auto", httpUsable: true, uiSlotFree: true, needs: jobNeeds({ kind: "video", mode: "text", operation: "extend" }) })).toBe("ui");
  });
});
