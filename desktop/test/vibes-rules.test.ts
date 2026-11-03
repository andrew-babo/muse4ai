import { describe, expect, it } from "vitest";
import { buildExtendRequest, buildGenerateRequest, classifyBatchError, classifyHttpError, extendBatchId, generateBatchId, isLoginPopupAllowed, isVibesHost, parseBatch, pickProjectId, uuidV7 } from "../src/main/adapter/vibes/protocol";
import type { VibesRemote } from "../src/main/adapter/types";
import { capKey, schedule, type SchedAccount } from "../src/shared/scheduler";
import { DEFAULT_VIBES, classifyAuthMe, extendEligibility, loginPlan, looksLikeSegment, maskName, maskRemote, nextChainStep, remainingSteps, validateExtend, vibesWaitReason } from "../src/shared/vibes";
import { enabledCapabilities, VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import type { Account, Asset, CapabilityKey, VibesSite } from "../src/shared/types";

const fmt = (t: number) => new Date(t).toISOString().slice(11, 16);
const vibes = (p: Partial<VibesSite> = {}): VibesSite => ({ ...DEFAULT_VIBES, ...p });
const ALL_ON = { ...VERIFIED_CAPABILITIES, "vibes.video.text": true, "vibes.video.reference": true, "vibes.video.extend": true } as Record<CapabilityKey, boolean>;

describe("R42 session classification (AC-VIB-05)", () => {
  it("200 with a user id is ready; the masked name keeps at most 4 characters", () => {
    const r = classifyAuthMe({ status: 200, body: { user: { id: "u-77", username: "may.vn" } } }, false);
    expect(r).toEqual({ kind: "ready", userId: "u-77", username: "may.vn" });
    expect(maskName("may.vn")).toBe("ma•••vn");
    expect(maskName("abc")).toBe("a•••");
    expect(maskName("")).toBeNull();
  });
  it("401 NoToken: logged_out without identity, needs_login with identity", () => {
    expect(classifyAuthMe({ status: 401, body: { error: "NoToken" } }, false)).toMatchObject({ kind: "state", status: "logged_out" });
    expect(classifyAuthMe({ status: 401, body: { error: { type: "SessionExpired" } } }, true)).toMatchObject({ kind: "state", status: "needs_login" });
  });
  it("AccountPending / VibesAgeRestricted → restricted; 403 checkpoint → checkpoint", () => {
    expect(classifyAuthMe({ status: 403, body: { error: "AccountPending" } }, true)).toMatchObject({ status: "restricted" });
    expect(classifyAuthMe({ status: 401, body: { error: { code: "VibesAgeRestricted" } } }, false)).toMatchObject({ status: "restricted" });
    expect(classifyAuthMe({ status: 403, body: { error: "checkpoint_required" } }, true)).toMatchObject({ status: "checkpoint" });
  });
  it("network error, 5xx and 429 never change the state (transient)", () => {
    for (const status of [0, 500, 502, 429]) expect(classifyAuthMe({ status, body: null }, true).kind).toBe("transient");
  });
  it("remote ids are masked to their last 4 characters in logs (R52)", () => {
    expect(maskRemote("CANARY-SRC-7719")).toBe("••••7719");
    expect(maskRemote("ab")).toBe("••••");
  });
});

describe("R41 login plan (AC-VIB-03)", () => {
  it("new account: Muse then Vibes; Muse ready + Vibes needs_login: only Vibes", () => {
    expect(loginPlan("new", vibes())).toEqual(["muse", "vibes"]);
    expect(loginPlan("ready", vibes({ status: "needs_login" }))).toEqual(["vibes"]);
  });
  it("Muse needs_login + Vibes ready: only Muse; Vibes off or restricted is never planned", () => {
    expect(loginPlan("needs_login", vibes({ status: "ready" }))).toEqual(["muse"]);
    expect(loginPlan("needs_login", vibes({ enabled: false }))).toEqual(["muse"]);
    expect(loginPlan("needs_login", vibes({ status: "restricted" }))).toEqual(["muse"]);
    expect(loginPlan("ready", vibes({ enabled: false }), "vibes")).toEqual([]);
  });
});

describe("R45 extend eligibility (AC-EXT-03)", () => {
  const owner = (v: Partial<VibesSite> = {}, state: Account["state"] = "ready") => ({ alias: "A", state, stateUntil: null, vibes: vibes({ status: "ready", ...v }) });
  const asset = (p: Partial<Asset> = {}) => ({ kind: "video" as const, site: "vibes" as const, sourceStatus: "ok" as const, sourceOwnerId: "a", trashedAt: null, missing: false, ...p });
  it("(a) a Muse video is not extendable with the exact reason; (b) images have no button", () => {
    expect(extendEligibility(asset({ site: "muse", sourceStatus: null }), owner(), true, fmt)).toEqual({ ok: false, reason: "Video tạo trên Muse chưa kéo dài được — tạo video trên Vibes để dùng Kéo dài", waitNote: null });
    expect(extendEligibility(asset({ kind: "image" }), owner(), true, fmt)).toBeNull();
  });
  it("(c) owner needs Vibes login: allowed with the amber wait note", () => {
    expect(extendEligibility(asset(), owner({ status: "needs_login" }), true, fmt)).toEqual({ ok: true, reason: null, waitNote: "A cần đăng nhập lại Vibes — chuỗi sẽ chờ" });
  });
  it("(d) owner removed, (e) identity changed, unverified, trashed", () => {
    expect(extendEligibility(asset({ sourceStatus: "owner_removed" }), null, true, fmt)?.reason).toBe("Tài khoản tạo video này đã bị xoá");
    expect(extendEligibility(asset({ sourceStatus: "identity_changed" }), owner(), true, fmt)?.reason).toBe("Phiên Vibes của A đã đổi tài khoản");
    expect(extendEligibility(asset(), owner(), false, fmt)?.reason).toBe("Kéo dài chưa được kiểm trên phiên bản này");
    expect(extendEligibility(asset({ trashedAt: 1 }), owner(), true, fmt)?.reason).toBe("Video này đang trong Thùng rác");
  });
});

describe("R46 options (AC-EXT-04)", () => {
  it("Theo mô tả needs text after trimming and at most 1,000 characters", () => {
    const plan = { type: "steps" as const, value: 1 };
    expect(validateExtend({ mode: "directive", directive: "   ", plan }, 20)).toBe("Nhập mô tả cho Theo mô tả");
    expect(validateExtend({ mode: "directive", directive: "x".repeat(1001), plan }, 20)).toBe("Mô tả tối đa 1.000 ký tự");
    expect(validateExtend({ mode: "directive", directive: "x".repeat(1000), plan }, 20)).toBeNull();
  });
  it("number of steps 1..max; target 15..300 step 5 (AC-EXT-08 second half)", () => {
    expect(validateExtend({ mode: "auto", plan: { type: "steps", value: 21 } }, 20)).toBe("Tối đa 20 lần mỗi chuỗi (chỉnh trong Cài đặt)");
    expect(validateExtend({ mode: "auto", plan: { type: "steps", value: 0 } }, 20)).toBe("Số lần phải từ 1");
    expect(validateExtend({ mode: "auto", plan: { type: "target", value: 10 } }, 20)).toMatch(/từ 15 đến 300/);
    expect(validateExtend({ mode: "auto", plan: { type: "target", value: 32 } }, 20)).toMatch(/bước 5/);
    expect(validateExtend({ mode: "auto", plan: { type: "target", value: 300 } }, 20)).toBeNull();
  });

  const source: VibesRemote = {
    projectId: "p1",
    batchId: "batch-old",
    contentId: "c-1",
    entityId: "ent-1",
    handle: "hdl-1",
    videoUrl: "https://cdn.example.invalid/v.mp4",
    originalPrompt: "biển lúc bình minh",
    config: { aspectRatio: "9:16", extendDirective: "lệnh cũ", videoModel: "midjen-short" },
  };
  it("Tự động sends no directive anywhere, even when the source carried one", () => {
    const r = buildExtendRequest({ batchId: "extend-1-aa", projectId: "p1", now: 1, source, directive: null });
    const json = JSON.stringify(r);
    expect(json).not.toContain("extendDirective");
    expect(json).not.toContain("lệnh cũ");
    const input = (r.trigger.inputs as Record<string, unknown>[])[0];
    expect(input).toMatchObject({ type: "extend", mediaEntId: "ent-1", videoUrl: source.videoUrl, prompt: "biển lúc bình minh" });
    expect(r.trigger.config).toMatchObject({ videoModel: "midjen-extend", generationType: "extend", sourceVideoHandle: "hdl-1", sourceContentItemIds: [{ id: "c-1", source: "extend_video" }] });
  });
  it("Theo mô tả puts the directive on the input and in its config, for this step only", () => {
    const r = buildExtendRequest({ batchId: "extend-1-aa", projectId: "p1", now: 1, source, directive: "máy quay lùi xa dần" });
    const input = (r.trigger.inputs as Record<string, unknown>[])[0];
    expect(input.extendDirective).toBe("máy quay lùi xa dần");
    expect((input.config as Record<string, unknown>).extendDirective).toBe("máy quay lùi xa dần");
    expect(JSON.stringify(r)).not.toContain("lệnh cũ");
  });
  it("generate: one variation; ids have the web app's shapes", () => {
    const g = buildGenerateRequest({ batchId: generateBatchId(1_700_000_000_000, new Uint8Array(16)), prompt: "mèo", projectId: "p", now: 1 });
    expect((g.trigger.inputs as unknown[]).length).toBe(1);
    expect(g.batchId).toMatch(/^batch-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(extendBatchId(1234, Uint8Array.from([1, 2, 3, 4]))).toBe("extend-1234-01020304");
    expect(uuidV7(0, new Uint8Array(16)).slice(0, 13)).toBe("00000000-0000");
  });
});

describe("R48 batch parsing never takes another batch's items", () => {
  it("only items of this batch with a finished video are returned", () => {
    const body = { batch: { id: "b1", isComplete: true, prompt: "p", content: [{ id: "c1", type: "video", videoUrl: "u1", videoHandle: "h1", data: JSON.stringify({ videoGenEntId: "e1" }) }, { id: "c2", type: "video", isLoading: true }] } };
    const p = parseBatch(body, "b1", "proj");
    expect(p.complete).toBe(true);
    expect(p.videos).toEqual([{ projectId: "proj", batchId: "b1", contentId: "c1", entityId: "e1", handle: "h1", videoUrl: "u1", originalPrompt: "p", config: {} }]);
    expect(parseBatch({ batch: { ...body.batch, id: "other" } }, "b1", null).found).toBe(false);
  });
  it("error texts map to refused / quota / generic without echoing the body", () => {
    expect(classifyBatchError("Content violates our policy")).toMatchObject({ cls: "CONTENT_REFUSED", definitive: true });
    expect(classifyBatchError("Daily limit exceeded")).toMatchObject({ cls: "QUOTA_LIMIT" });
    expect(classifyHttpError(500, { secret: "x" }, true)).toMatchObject({ cls: "AMBIGUOUS_SUBMIT" });
    expect(classifyHttpError(500, { secret: "x" }, true).message).not.toContain("secret");
    expect(classifyHttpError(429, null, true).cls).toBe("QUOTA_LIMIT");
    expect(classifyHttpError(401, null, true).cls).toBe("SESSION_EXPIRED");
    expect(pickProjectId({ projects: [{ id: "x", name: "Khác" }, { id: "y", name: "Muse4AI" }] })).toBe("y");
  });
  it("hosts blocked while Vibes is off, login popups allowed only on Meta origins", () => {
    expect(isVibesHost("https://vibes.ai/api/auth/me")).toBe(true);
    expect(isVibesHost("https://auth.meta.com/x")).toBe(true);
    expect(isVibesHost("https://www.muse.ai/")).toBe(false);
    expect(isLoginPopupAllowed("https://www.facebook.com/login")).toBe(true);
    expect(isLoginPopupAllowed("https://evil.example.com/")).toBe(false);
  });
});

describe("R47 chain decisions (AC-EXT-05..08)", () => {
  const steps = (n: number) => ({ type: "steps" as const, value: n });
  it("checks in order: steps reached, target reached, no growth, maximum", () => {
    expect(nextChainStep({ plan: steps(3), maxSteps: 20, stepsDone: 3, sourceMs: 15_000, outputMs: 20_000 })).toEqual({ action: "complete", reason: "Đã kéo dài 3 lần" });
    expect(nextChainStep({ plan: { type: "target", value: 30 }, maxSteps: 20, stepsDone: 5, sourceMs: 25_000, outputMs: 30_000 })).toEqual({ action: "complete", reason: "Đã đạt khoảng 30 giây" });
    expect(nextChainStep({ plan: steps(5), maxSteps: 20, stepsDone: 2, sourceMs: 15_000, outputMs: 15_400 })).toEqual({ action: "stop", reason: "Vibes không kéo dài thêm" });
    expect(nextChainStep({ plan: { type: "target", value: 300 }, maxSteps: 20, stepsDone: 20, sourceMs: 100_000, outputMs: 105_000 })).toEqual({ action: "stop", reason: "Đã đủ 20 lần" });
    expect(nextChainStep({ plan: steps(3), maxSteps: 20, stepsDone: 1, sourceMs: 5_000, outputMs: 10_000 })).toEqual({ action: "continue" });
  });
  it("a shorter output is a segment (R49); remaining steps after Tiếp tục", () => {
    expect(looksLikeSegment(15_000, 5_000)).toBe(true);
    expect(looksLikeSegment(15_000, 20_000)).toBe(false);
    expect(remainingSteps(steps(5), 2, 20)).toBe(3);
    expect(remainingSteps({ type: "target", value: 60 }, 18, 20)).toBe(2);
  });
});

describe("R40/R43/R45 scheduling across sites (AC-VIB-06, AC-VIB-07)", () => {
  const acc = (id: string, p: Partial<SchedAccount> = {}): SchedAccount => ({
    id,
    state: "ready",
    proxyHealthy: true,
    running: 0,
    lastActiveAt: null,
    capabilities: {},
    vibes: vibes({ status: "ready" }),
    vibesReadyAt: -Infinity,
    ...p,
  });
  const q = (id: string, p: Record<string, unknown> = {}) => ({ id, kind: "video" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: Number(id.replace(/\D/g, "")) || 0, site: "muse" as const, operation: "generate" as const, boundAccountId: null, ...p });
  it("A Muse ready + Vibes needs_login, B both ready: Muse pinned A → A; Vibes auto → B; extend bound A waits", () => {
    const out = schedule({
      queued: [q("j1", { accountPref: "A" }), q("j2", { site: "vibes" }), q("j3", { site: "vibes", operation: "extend", boundAccountId: "A" })],
      accounts: [acc("A", { vibes: vibes({ status: "needs_login" }) }), acc("B")],
      perAccount: 1,
      globalCap: 8,
      totalRunning: 0,
      verified: ALL_ON,
      now: 0,
    });
    expect(out).toEqual([
      { jobId: "j1", accountId: "A", path: "ui" },
      { jobId: "j2", accountId: "B", path: "ui" },
    ]);
  });
  it("AC-VIB-07: Muse limit_reached but Vibes ready → Vibes job runs on A; Muse job waits", () => {
    const out = schedule({
      queued: [q("j1"), q("j2", { site: "vibes" })],
      accounts: [acc("A", { state: "limit_reached" })],
      perAccount: 1,
      globalCap: 8,
      totalRunning: 0,
      verified: ALL_ON,
      now: 0,
    });
    expect(out).toEqual([{ jobId: "j2", accountId: "A", path: "ui" }]);
  });
  it("R43: two Vibes submits on one account are at least 5 seconds apart; unverified Vibes never scheduled", () => {
    const base = { queued: [q("j1", { site: "vibes" })], perAccount: 1, globalCap: 8, totalRunning: 0 };
    expect(schedule({ ...base, accounts: [acc("A", { vibesReadyAt: 10_000 })], verified: ALL_ON, now: 9_999 })).toEqual([]);
    expect(schedule({ ...base, accounts: [acc("A", { vibesReadyAt: 10_000 })], verified: ALL_ON, now: 10_000 })).toHaveLength(1);
    expect(schedule({ ...base, accounts: [acc("A")], verified: VERIFIED_CAPABILITIES, now: 0 })).toEqual([]);
  });
  it("capability keys and enabled map (Vibes only by verification)", () => {
    expect(capKey("video", "text", "vibes")).toBe("vibes.video.text");
    expect(capKey("image", "reference")).toBe("image.reference");
    expect(enabledCapabilities([], VERIFIED_CAPABILITIES)["vibes.video.extend"]).toBe(false);
    expect(enabledCapabilities([], ALL_ON)["vibes.video.extend"]).toBe(true);
  });
  it("waiting reasons are in the user's words (R47)", () => {
    expect(vibesWaitReason({ alias: "A", state: "ready", stateUntil: null, vibes: vibes({ status: "limit_reached", statusUntil: Date.UTC(2026, 9, 27, 15, 40) }) }, fmt)).toBe("A hết giới hạn Vibes đến 15:40");
    expect(vibesWaitReason({ alias: "A", state: "paused", stateUntil: null, vibes: vibes({ status: "ready" }) }, fmt)).toBe("A đang tạm dừng");
    expect(vibesWaitReason({ alias: "A", state: "ready", stateUntil: null, vibes: vibes({ enabled: false }) }, fmt)).toBe("bật Vibes cho A");
  });
});
