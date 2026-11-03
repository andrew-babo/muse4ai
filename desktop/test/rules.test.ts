import { describe, expect, it } from "vitest";
import { onGenericFailure, onQuotaLimit } from "../src/shared/accountMachine";
import { parseBatchText, summarize } from "../src/shared/batchParse";
import { enabledCapabilities, VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import { formatElapsed, formatLatency, formatNumber } from "../src/shared/format";
import { allowedActions, canTransition } from "../src/shared/jobMachine";
import { libraryRelParts, sanitizeFolderName } from "../src/shared/naming";
import { maskIp, parseProxyList, proxyEntryWhere } from "../src/shared/proxyParse";
import { redact, registerSecret } from "../src/shared/redact";
import { downloadRetryDelay, preSubmitRetryDelay } from "../src/shared/retry";
import { schedule, suggestProxy, type SchedAccount } from "../src/shared/scheduler";
import { sniffMediaMime, validateAlias, validatePrompt, validateReference } from "../src/shared/validate";
import { PNG_1PX, fakeMp4 } from "../src/main/adapter/fake";

const caps = { ...VERIFIED_CAPABILITIES };
const acc = (id: string, extra: Partial<SchedAccount> = {}): SchedAccount => ({ id, state: "ready", proxyHealthy: true, running: 0, lastActiveAt: null, capabilities: {}, ...extra });

describe("R17 prompt — AC-GEN-03", () => {
  it("rejects whitespace-only and 4.001 characters", () => {
    expect(validatePrompt("   \n ").ok).toBe(false);
    const r = validatePrompt("a".repeat(4001));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("4.000");
    expect(validatePrompt("  a".padEnd(4000, "b")).ok).toBe(true);
  });
});

describe("R10 reference — AC-GEN-04", () => {
  it("rejects 25 MB and GIF", () => {
    expect(validateReference({ mime: "image/png", bytes: 25 * 1024 * 1024, width: 100, height: 100 }).ok).toBe(false);
    expect(validateReference({ mime: "image/gif", bytes: 1000, width: 100, height: 100 }).ok).toBe(false);
    expect(validateReference({ mime: "image/png", bytes: 1000, width: 8193, height: 10 }).ok).toBe(false);
    expect(validateReference({ mime: "image/webp", bytes: 1000, width: 8192, height: 8192 }).ok).toBe(true);
  });
});

describe("aliases — AC-ACC-01", () => {
  it("is unique case-insensitively", () => {
    const r = validateAlias("mây", ["Mây"]);
    expect(r.ok).toBe(false);
    expect(validateAlias("Sương", ["Mây"]).ok).toBe(true);
    expect(validateAlias("x".repeat(33), []).ok).toBe(false);
  });
});

describe("proxy suggestion — AC-ACC-03", () => {
  it("suggests the healthy unassigned proxy with lowest latency", () => {
    const p = suggestProxy([
      { id: "slow", health: "healthy", accountId: null, latencyMs: 340 },
      { id: "fast", health: "healthy", accountId: null, latencyMs: 120 },
      { id: "taken", health: "healthy", accountId: "x", latencyMs: 10 },
      { id: "bad", health: "failed", accountId: null, latencyMs: 5 },
    ]);
    expect(p?.id).toBe("fast");
    expect(suggestProxy([{ id: "bad", health: "failed", accountId: null, latencyMs: 5 }])).toBeNull();
  });
});

describe("proxy import — AC-PRX-01", () => {
  it("11 lines with 2 malformed → 9 ok, errors carry line numbers and no password", () => {
    const good = Array.from({ length: 9 }, (_, i) => `host${i}.example.com:${8000 + i}:user${i}:S3cretPass${i}`);
    const lines = [...good.slice(0, 4), "broken-line-without-port:SecretPassX", ...good.slice(4), "host9.example.com:notaport:u:SecretPassY"];
    const r = parseProxyList(lines.join("\n"));
    expect(r.filter((x) => x.ok)).toHaveLength(9);
    const errs = r.filter((x) => !x.ok);
    expect(errs.map((e) => e.line)).toEqual([5, 11]);
    for (const e of errs) {
      expect(e.error).not.toMatch(/SecretPass/);
      expect(e.display).not.toMatch(/SecretPass/);
    }
  });
  it("accepts all four formats", () => {
    const r = parseProxyList(["1.2.3.4:80", "1.2.3.5:81:u:p", "u:p@1.2.3.6:82", "socks5://u:p@1.2.3.7:83"].join("\n"));
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r[3].value?.scheme).toBe("socks5");
    expect(r[2].value?.username).toBe("u");
  });
  it("accepts 11 proxies pasted on one line separated by spaces (provider copy format)", () => {
    const r = parseProxyList(Array.from({ length: 11 }, (_, i) => `10.0.0.${i + 1}:${9000 + i}:u${i}:p${i}`).join(" "));
    expect(r.filter((x) => x.ok)).toHaveLength(11);
  });
  it("one-line paste with 2 already stored → 9 new, 2 skipped as duplicates (not errors), each entry knows its position", () => {
    const all = Array.from({ length: 11 }, (_, i) => `10.0.0.${i + 1}:${9000 + i}:u${i}:SecretPx${i}`);
    const r = parseProxyList(all.join(" "), ["10.0.0.4:9003", "10.0.0.11:9010"]);
    expect(r.filter((x) => x.ok)).toHaveLength(9);
    const dup = r.filter((x) => x.duplicate);
    expect(dup.map((d) => d.item)).toEqual([4, 11]);
    expect(dup.map((d) => proxyEntryWhere(d))).toEqual(["Dòng 1, mục 4", "Dòng 1, mục 11"]);
    for (const d of dup) expect(d.error).not.toMatch(/SecretPx/);
  });
  it("masks IPs", () => expect(maskIp("103.21.45.142")).toBe("103.21.•••.•2"));
  it("latency reads unambiguously in Vietnamese: 850 ms, 1296 ms → 1,3 s", () => {
    expect(formatLatency(850)).toBe("850 ms");
    expect(formatLatency(1296)).toBe("1,3 s");
    expect(formatLatency(null)).toBe("—");
  });
});

describe("batch import — R11", () => {
  const opts = { defaults: { kind: "image" as const, mode: "text" as const, repeat: 1 }, fileExists: (p: string) => p === "C:\\ok.jpg", capabilities: caps };
  it("AC-BAT-01: csv 5 rows, row 3 missing prompt, row 4 missing image → 3 valid, 2 errors", () => {
    const csv = 'prompt,kind,mode,reference,repeat\n"A",image,text,,1\n"B",image,text,,1\n,image,text,,1\n"D",image,reference,C:\\nope.jpg,1\n"E",video,text,,1\n';
    const r = parseBatchText(csv, opts, "lo.csv");
    expect(r.validCount).toBe(3);
    expect(r.errorCount).toBe(2);
    const errs = r.rows.filter((x) => x.error);
    expect(errs.map((e) => e.line)).toEqual([4, 5]);
    expect(errs[0].error).toBe("Thiếu prompt");
    expect(errs[1].error).toBe("Không tìm thấy ảnh tham chiếu");
  });
  it("AC-BAT-02: 600 rows × repeat 2 is blocked with the exact message", () => {
    const txt = Array.from({ length: 600 }, (_, i) => `prompt ${i}`).join("\n");
    const r = parseBatchText(txt, { ...opts, defaults: { ...opts.defaults, repeat: 2 } });
    expect(r.totalJobs).toBe(1200);
    expect(r.batchError).toBe("Tối đa 1.000 lượt/lô (đang là 1.200)");
  });
  it("txt skips blank and # lines", () => {
    const r = parseBatchText("# ghi chú\n\nmột\nhai\n", opts);
    expect(r.rows.map((x) => x.prompt)).toEqual(["một", "hai"]);
    expect(summarize(r.rows).totalJobs).toBe(2);
  });
});

describe("R4 retries — AC-JOB-01 / AC-JOB-05", () => {
  it("30 s → 120 s → failed", () => {
    expect(preSubmitRetryDelay(1)).toBe(30_000);
    expect(preSubmitRetryDelay(2)).toBe(120_000);
    expect(preSubmitRetryDelay(3)).toBeNull();
  });
  it("download retries are separate, max 3", () => {
    expect(downloadRetryDelay(1)).not.toBeNull();
    expect(downloadRetryDelay(3)).not.toBeNull();
    expect(downloadRetryDelay(4)).toBeNull();
  });
});

describe("R8 account failures — AC-ACC-09", () => {
  it("cooling_down 120 s twice, paused on the 3rd within 15 min", () => {
    const t0 = 1_000_000;
    const a = onGenericFailure([], t0);
    expect(a.state).toBe("cooling_down");
    expect(a.stateUntil).toBe(t0 + 120_000);
    const b = onGenericFailure(a.failTimes, t0 + 60_000);
    expect(b.state).toBe("cooling_down");
    const c = onGenericFailure(b.failTimes, t0 + 120_000);
    expect(c.state).toBe("paused");
    const d = onGenericFailure(b.failTimes, t0 + 16 * 60_000);
    expect(d.state).toBe("cooling_down");
  });
});

describe("R5 quota — AC-JOB-09", () => {
  it("uses Muse reset time 15:40, otherwise 60 minutes", () => {
    const now = new Date("2026-10-26T14:00:00").getTime();
    const reset = new Date("2026-10-26T15:40:00").getTime();
    expect(onQuotaLimit(now, reset).stateUntil).toBe(reset);
    expect(onQuotaLimit(now, null).stateUntil).toBe(now + 60 * 60_000);
  });
});

describe("scheduler — R3/R18/R19", () => {
  it("AC-JOB-10: standalone job runs before waiting batch jobs", () => {
    const queued = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 0, seq: i + 1 })),
      { id: "solo", kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: 100 },
    ];
    const out = schedule({ queued, accounts: [acc("A")], perAccount: 1, globalCap: 4, totalRunning: 0, verified: caps });
    expect(out).toEqual([{ jobId: "solo", accountId: "A", path: "ui" }]);
  });
  it("AC-GEN-06: 3 repeats spread over ready accounts, least busy first", () => {
    const queued = ["j1", "j2", "j3"].map((id, i) => ({ id, kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: i }));
    const out = schedule({ queued, accounts: [acc("A", { lastActiveAt: 5 }), acc("B", { lastActiveAt: 1 }), acc("C", { running: 1 })], perAccount: 1, globalCap: 8, totalRunning: 1, verified: caps });
    expect(out.map((a) => a.accountId)).toEqual(["B", "A"]);
  });
  it("does not hold a global slot for a busy pinned account", () => {
    const queued = [
      { id: "pinned", kind: "image" as const, mode: "text" as const, accountPref: "A", priority: 1, seq: 1 },
      { id: "auto", kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: 2 },
    ];
    const out = schedule({ queued, accounts: [acc("A", { running: 1 }), acc("B")], perAccount: 1, globalCap: 2, totalRunning: 1, verified: caps });
    expect(out).toEqual([{ jobId: "auto", accountId: "B", path: "ui" }]);
  });
  it("skips accounts without healthy proxy (R1) and non-working states", () => {
    const queued = [{ id: "j", kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: 1 }];
    const out = schedule({ queued, accounts: [acc("A", { proxyHealthy: false }), acc("B", { state: "cooling_down" }), acc("C", { state: "needs_login" })], perAccount: 1, globalCap: 4, totalRunning: 0, verified: caps });
    expect(out).toEqual([]);
  });
  it("respects the global cap", () => {
    const queued = ["a", "b", "c"].map((id, i) => ({ id, kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: i }));
    const out = schedule({ queued, accounts: [acc("A"), acc("B"), acc("C")], perAccount: 1, globalCap: 2, totalRunning: 0, verified: caps });
    expect(out).toHaveLength(2);
  });
});

describe("capability gating — AC-GEN-07", () => {
  it("locks a mode the app version has not verified", () => {
    const r = enabledCapabilities([{ state: "ready", capabilities: {} }], { ...caps, "video.reference": false });
    expect(r["video.reference"]).toBe(false);
    expect(r["image.text"]).toBe(true);
  });
});

describe("job machine — §4.1", () => {
  it("never allows retry of content refusals and no cancel while submitting", () => {
    expect(allowedActions("failed", { errorClass: "CONTENT_REFUSED" })).not.toContain("retry");
    expect(allowedActions("failed", { errorClass: "PRE_SUBMIT_TRANSIENT" })).toContain("retry");
    expect(allowedActions("submitting")).toEqual([]);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("submitting", "needs_review")).toBe(true);
  });
});

describe("naming — R13", () => {
  it("builds the library path", () => {
    const at = new Date(2026, 10, 3, 9, 5, 7).getTime();
    expect(libraryRelParts({ at, batchName: null, kind: "image", jobId: "a1b2c3d4-0000", n: 1, ext: "webp" })).toEqual(["2026-11", "Lẻ", "20261103-090507_anh_a1b2c3_1.webp"]);
    expect(libraryRelParts({ at, batchName: "Quảng cáo T11", kind: "video", jobId: "ffeedd", n: 2, ext: "mp4" })[1]).toBe("Quảng cáo T11");
    expect(sanitizeFolderName('a<b>:c"/d\\e|f?g*. ')).toBe("a b c d e f g");
  });
});

describe("media sniffing — AC-JOB-07", () => {
  it("HTML named .mp4 is not media", () => {
    expect(sniffMediaMime(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
    expect(sniffMediaMime(fakeMp4())).toBe("video/mp4");
    expect(sniffMediaMime(PNG_1PX)).toBe("image/png");
  });
});

describe("redaction — B11", () => {
  it("removes registered secrets, credentials in URLs, emails and full IPs", () => {
    registerSecret("CANARY-PX-7731");
    const s = redact("proxy http://bob:CANARY-PX-7731@1.2.3.4:80 failed for bob@example.com password=hunter2");
    expect(s).not.toContain("CANARY-PX-7731");
    expect(s).not.toContain("bob@example.com");
    expect(s).not.toContain("1.2.3.4");
    expect(s).not.toContain("hunter2");
  });
});

describe("format — §8", () => {
  it("vi-VN numbers and elapsed", () => {
    expect(formatNumber(1200)).toBe("1.200");
    expect(formatElapsed(59_000)).toBe("59 s");
    expect(formatElapsed(72_000)).toBe("1:12");
  });
});
