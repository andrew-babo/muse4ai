import { describe, expect, it } from "vitest";
import { parseQuota } from "../src/main/adapter/muse/driver";
import {
  additionalState,
  failQuotaRead,
  mergeQuotaRead,
  parseTokenAmount,
  quotaBlock,
  quotaPanelText,
  quotaRank,
  quotaReadReason,
  quotaView,
  quotaWantsStartupRead,
  resetLabelToTime,
} from "../src/shared/quota";
import { VERIFIED_CAPABILITIES } from "../src/shared/capabilities";
import { schedule, type SchedAccount } from "../src/shared/scheduler";
import type { Quota } from "../src/shared/types";

// Spec rev 8 §13 — R69–R74 pure rules (AC-QTA-01, 03, 04, 05, 06, 07, 08).

const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();
const NOW = local(2026, 10, 28, 14, 0); // 28/10/2026 14:00 local
const MIN = 60_000;

/** Exact Usage text read from both test accounts on 28/10/2026 (evidence/usage-limit-poc-2026-10-28/observations.json). */
const REAL_USAGE = "Free plan\nWeekly limit resets on Nov 2\n51% used\nAdditional tokens\nNever expires\n0% used (5B tokens left)\nUpgrade";

const snap = (used: number, extra: Partial<Quota> = {}): Quota => ({
  plan: "Free plan",
  usedPercent: used,
  resetsOn: "Nov 2",
  resetAt: local(2026, 11, 2),
  additional: { usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5e9, expiryLabel: "Never expires" },
  readAt: NOW,
  ...extra,
});

describe("AC-QTA-01: Usage panel → weekly + additional parts", () => {
  it("reads the real 28/10 panel: weekly 51 %, reset 02/11 00:00 local, additional 0 % · 5B left · Never expires", () => {
    const q = parseQuota(REAL_USAGE, NOW);
    expect(q.plan).toBe("Free plan");
    expect(q.usedPercent).toBe(51);
    expect(q.resetsOn).toBe("Nov 2");
    expect(q.resetAt).toBe(local(2026, 11, 2));
    expect(q.additional).toEqual({ usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5_000_000_000, expiryLabel: "Never expires" });
  });
  it("the additional part's 0 % is never taken as the weekly %", () => {
    const q = parseQuota("Free plan\nWeekly limit resets on Nov 2\nAdditional tokens\nNever expires\n0% used (5B tokens left)", NOW);
    expect(q.usedPercent).toBeUndefined(); // weekly % missing → not a successful read
    expect(q.additional).toBeUndefined();
  });
  it("single-line layout and Chinese labels give the weekly %", () => {
    expect(parseQuota("Usage\nFree plan · Weekly limit resets on Nov 2 · 51% used · Additional tokens · Never expires · 0% used (5B tokens left)", NOW)).toMatchObject({
      usedPercent: 51,
      additional: { remainingApprox: 5e9, expiryLabel: "Never expires" },
    });
    const zh = parseQuota("用量\n免费计划\n每周额度将于 11月2日 重置\n已用 51%\n语言", NOW);
    expect(zh.usedPercent).toBe(51);
    expect(zh.resetAt).toBe(local(2026, 11, 2));
  });
  it("no additional part → additional = none; “100% used (0 tokens left)” → 0 left; “1.2M tokens left” → 1.2e6", () => {
    expect(parseQuota("Free plan\nWeekly limit resets on Nov 2\n100% used\nUpgrade", NOW).additional).toBeNull();
    expect(parseQuota("Free plan\nWeekly limit resets on Nov 2\n100% used\nAdditional tokens\n100% used (0 tokens left)", NOW).additional).toMatchObject({ usedPercent: 100, remainingApprox: 0 });
    expect(parseQuota("Free plan\nWeekly limit resets on Nov 2\n10% used\nAdditional tokens\n3% used (1.2M tokens left)", NOW).additional?.remainingApprox).toBe(1_200_000);
  });
  it("reset labels → earliest local time; a date that cannot be a weekly reset stays label-only", () => {
    expect(resetLabelToTime("Nov 2", NOW)).toBe(local(2026, 11, 2));
    expect(resetLabelToTime("November 2", NOW)).toBe(local(2026, 11, 2));
    expect(resetLabelToTime("2 Nov", NOW)).toBe(local(2026, 11, 2));
    expect(resetLabelToTime("Nov 2, 2026", NOW)).toBe(local(2026, 11, 2));
    expect(resetLabelToTime("Jan 3", local(2026, 12, 30))).toBe(local(2027, 1, 3)); // across the new year
    expect(resetLabelToTime("Oct 27", NOW)).toBe(local(2026, 10, 27)); // read a day late (time zone) → still that day
    expect(resetLabelToTime("Mar 3", NOW)).toBeNull();
    expect(resetLabelToTime("Feb 30", local(2026, 2, 27))).toBeNull();
    expect(resetLabelToTime("soon", NOW)).toBeNull();
  });
  it("token amounts as displayed", () => {
    expect(parseTokenAmount("5B tokens left")).toBe(5e9);
    expect(parseTokenAmount("800K tokens left")).toBe(8e5);
    expect(parseTokenAmount("12,345 tokens left")).toBe(12345);
    expect(parseTokenAmount("0 tokens left")).toBe(0);
    expect(parseTokenAmount(null)).toBeNull();
  });
});

describe("AC-QTA-02: failed reads keep the previous numbers", () => {
  it("keeps 51 % · 13:10, records the failure, never zeroes a field", () => {
    const prev = snap(51, { readAt: local(2026, 10, 28, 13, 10) });
    const f = failQuotaRead(prev, "Không đọc được hạn mức trong Cài đặt của Muse", local(2026, 10, 28, 14, 40));
    expect(f.usedPercent).toBe(51);
    expect(f.readAt).toBe(local(2026, 10, 28, 13, 10));
    expect(f.checkedAt).toBe(local(2026, 10, 28, 14, 40));
    expect(f.failures).toBe(1);
    expect(f.additional).toEqual(prev.additional);
    expect(quotaView(f, local(2026, 10, 28, 14, 41))).toMatchObject({ known: true, failed: true, weeklyUsed: 51 });
    const ok = mergeQuotaRead({ ...f, limitFrom: "usage" }, snap(60), local(2026, 10, 28, 15, 0));
    expect(ok).toMatchObject({ usedPercent: 60, failures: 0, error: null, limitFrom: "usage" });
  });
  it("never read → unknown, no tier penalty", () => {
    const f = failQuotaRead(null, "x", NOW);
    expect(f.readAt).toBe(0);
    expect(quotaView(f, NOW)).toMatchObject({ known: false, tier: "unknown" });
    expect(quotaRank(quotaView(f, NOW).tier)).toBe(0);
  });
});

describe("R70 freshness", () => {
  it("stale after 6 h; expired once the reset time passed since the read", () => {
    expect(quotaView(snap(51), NOW + 6 * 60 * MIN - 1).stale).toBe(false);
    expect(quotaView(snap(51), NOW + 6 * 60 * MIN + 1).stale).toBe(true);
    const v = quotaView(snap(100, { additional: null }), local(2026, 11, 2, 0, 1));
    expect(v).toMatchObject({ expired: true, tier: "unknown" });
  });
});

describe("AC-QTA-03/04: when an automatic read is due (R71)", () => {
  const base = { now: NOW, pending: false, hasWork: false };
  it("40 %: after the 5th sent job, not after the 4th; 85 %: after every job (read ≥ 10 min ago, R103)", () => {
    const later = { ...base, now: NOW + 10 * MIN };
    expect(quotaReadReason({ ...later, q: snap(40), sentSinceRead: 4 })).toBeNull();
    expect(quotaReadReason({ ...later, q: snap(40), sentSinceRead: 5 })).toBe("count");
    expect(quotaReadReason({ ...later, q: snap(85), sentSinceRead: 1 })).toBe("count");
    expect(quotaReadReason({ ...later, q: snap(100), sentSinceRead: 1 })).toBe("count"); // using additional tokens
  });
  it("R103 / AC-CC-09: reasons (b)(c) at most once per 10 minutes per account; one-off reads (d)(e)(f) are never held back", () => {
    expect(quotaReadReason({ ...base, q: snap(40), sentSinceRead: 20, now: NOW + 10 * MIN - 1 })).toBeNull();
    expect(quotaReadReason({ ...base, q: snap(40), sentSinceRead: 20, now: NOW + 10 * MIN })).toBe("count");
    expect(quotaReadReason({ ...base, q: snap(85), sentSinceRead: 1, now: NOW + 9 * MIN })).toBeNull();
    expect(quotaReadReason({ ...base, q: snap(40), sentSinceRead: 20, now: NOW + 1, pending: true })).toBe("pending");
  });
  it("read 13:00, one job sent at 13:10 → due at 13:30, not 13:29", () => {
    const q = snap(40, { readAt: local(2026, 10, 28, 13, 0) });
    expect(quotaReadReason({ ...base, q, sentSinceRead: 1, now: local(2026, 10, 28, 13, 29) })).toBeNull();
    expect(quotaReadReason({ ...base, q, sentSinceRead: 1, now: local(2026, 10, 28, 13, 31) })).toBe("age");
  });
  it("never read: only when there is work for the account; idle and nothing new → never", () => {
    expect(quotaReadReason({ ...base, q: null, sentSinceRead: 0 })).toBeNull();
    expect(quotaReadReason({ ...base, q: null, sentSinceRead: 0, hasWork: true })).toBe("unknown");
    expect(quotaReadReason({ ...base, q: snap(40, { readAt: NOW - 3 * 60 * MIN }), sentSinceRead: 0 })).toBeNull();
  });
  it("expired snapshot: read before the next work only", () => {
    const q = snap(100, { additional: null });
    const after = local(2026, 11, 2, 9, 0);
    expect(quotaReadReason({ ...base, q, sentSinceRead: 0, now: after })).toBeNull();
    expect(quotaReadReason({ ...base, q, sentSinceRead: 0, now: after, hasWork: true })).toBe("expired");
  });
  it("AC-QTA-04: failed at 10:00 → nothing before 10:10; failed again 10:10 → nothing before 10:40; pending reads still run", () => {
    const t10 = local(2026, 10, 28, 10, 0);
    const q1 = failQuotaRead(snap(40, { readAt: t10 - 60 * MIN }), "x", t10);
    expect(quotaReadReason({ ...base, q: q1, sentSinceRead: 9, now: t10 + 9 * MIN })).toBeNull();
    expect(quotaReadReason({ ...base, q: q1, sentSinceRead: 9, now: t10 + 10 * MIN })).toBe("count");
    const q2 = failQuotaRead(q1, "x", t10 + 10 * MIN);
    expect(quotaReadReason({ ...base, q: q2, sentSinceRead: 9, now: t10 + 39 * MIN })).toBeNull();
    expect(quotaReadReason({ ...base, q: q2, sentSinceRead: 9, now: t10 + 40 * MIN })).toBe("count");
    expect(quotaReadReason({ ...base, q: q2, sentSinceRead: 0, now: t10 + 11 * MIN, pending: true })).toBe("pending");
  });
  it("start-up read only when missing or older than 30 minutes", () => {
    expect(quotaWantsStartupRead(null, NOW)).toBe(true);
    expect(quotaWantsStartupRead(snap(40, { readAt: NOW - 29 * MIN }), NOW)).toBe(false);
    expect(quotaWantsStartupRead(snap(40, { readAt: NOW - 31 * MIN }), NOW)).toBe(true);
  });
});

describe("AC-QTA-06/07/08: block before sending (R73/R74)", () => {
  it("weekly 100 % and no additional part / 0 left / 100 % used → blocked until 02/11 00:00", () => {
    for (const additional of [null, { usedPercent: 100, remainingLabel: "0 tokens left", remainingApprox: 0, expiryLabel: null }, { usedPercent: 100, remainingLabel: null, remainingApprox: null, expiryLabel: null }]) {
      const b = quotaBlock(snap(100, { additional }), NOW);
      expect(b?.until).toBe(local(2026, 11, 2));
      expect(b?.reason).toBe("Hết hạn mức tuần (Muse báo 100 %) · đặt lại 02/11");
    }
  });
  it("no reset time → 60 minutes; a reset day already passed → 60 minutes and says so; unparsed label kept", () => {
    expect(quotaBlock(snap(100, { additional: null, resetAt: null, resetsOn: undefined }), NOW)?.until).toBe(NOW + 60 * MIN);
    const passed = quotaBlock(snap(100, { additional: null, resetAt: NOW - MIN, readAt: NOW }), NOW);
    expect(passed).toEqual({ until: NOW + 60 * MIN, reason: "Hết hạn mức tuần (Muse báo 100 %) · đọc lại sau 60 phút" });
    expect(quotaBlock(snap(100, { additional: null, resetAt: null, resetsOn: "Monday" }), NOW)?.reason).toBe("Hết hạn mức tuần (Muse báo 100 %) · đặt lại Monday");
  });
  it("AC-QTA-07: weekly 100 % with 5B left → not blocked, group 2; additional unreadable → not blocked", () => {
    expect(quotaBlock(snap(100), NOW)).toBeNull();
    expect(quotaView(snap(100), NOW).tier).toBe("additional");
    const unreadable = snap(100, { additional: { usedPercent: null, remainingLabel: null, remainingApprox: null, expiryLabel: "Never expires" } });
    expect(quotaBlock(unreadable, NOW)).toBeNull();
    expect(quotaView(unreadable, NOW).tier).toBe("weekly_full");
    expect(quotaBlock({ plan: "Free plan", usedPercent: 100, resetsOn: "Nov 2", readAt: NOW }, NOW)).toBeNull(); // beta.35 snapshot: additional unknown
  });
  it("AC-QTA-08: reset label already passed but still 100 % → re-check in 60 minutes, never a hot loop", () => {
    const at = local(2026, 11, 2, 10, 0);
    const q = snap(100, { additional: null, readAt: at }); // read after the reset time, Muse still says 100 %
    expect(quotaBlock(q, at)?.until).toBe(at + 60 * MIN);
    expect(quotaBlock(q, local(2026, 11, 2, 0, 0) - 1)).not.toBeNull();
  });
  it("additional states", () => {
    expect(additionalState({ readAt: NOW })).toBe("unknown");
    expect(additionalState(snap(1, { additional: null }))).toBe("none");
    expect(additionalState(snap(1))).toBe("available");
  });
});

describe("AC-QTA-05: “Tự động” order (R72)", () => {
  const caps = { ...VERIFIED_CAPABILITIES };
  const acc = (id: string, last: number, used: number | null, extra: Partial<SchedAccount> = {}): SchedAccount => ({
    id,
    state: "ready",
    proxyHealthy: true,
    running: 0,
    lastActiveAt: last,
    capabilities: {},
    quotaRank: quotaRank(quotaView(used === null ? null : used >= 100 ? snap(used) : snap(used), NOW).tier),
    ...extra,
  });
  const job = (n: number, extra = {}) => ({ id: `j${n}`, kind: "image" as const, mode: "text" as const, accountPref: "auto", priority: 1, seq: n, ...extra });
  const A = acc("A", 9, 30);
  const B = acc("B", 8, 85);
  const C = acc("C", 7, 100); // weekly full, 5B additional left
  const D = acc("D", 9.5, null); // never read
  it("1 job → A (group 0, idle longer than D)", () => {
    expect(schedule({ queued: [job(1)], accounts: [A, B, C, D], perAccount: 1, globalCap: 8, totalRunning: 0, verified: caps }).map((x) => x.accountId)).toEqual(["A"]);
  });
  it("4 jobs → A, D, B, C", () => {
    const out = schedule({ queued: [1, 2, 3, 4].map((n) => job(n)), accounts: [A, B, C, D], perAccount: 1, globalCap: 8, totalRunning: 0, verified: caps });
    expect(out.map((x) => x.accountId)).toEqual(["A", "D", "B", "C"]);
  });
  it("same group stays round-robin: A 20 % idle since 5 vs E 60 % idle since 1 → E", () => {
    const out = schedule({ queued: [job(1)], accounts: [acc("A", 5, 20), acc("E", 1, 60)], perAccount: 1, globalCap: 8, totalRunning: 0, verified: caps });
    expect(out[0].accountId).toBe("E");
  });
  it("a job picked for B still runs on B; Vibes jobs ignore the Muse group", () => {
    expect(schedule({ queued: [job(1, { accountPref: "B" })], accounts: [A, B], perAccount: 1, globalCap: 8, totalRunning: 0, verified: caps })[0].accountId).toBe("B");
    const vib = (id: string, last: number, rank: number): SchedAccount => ({ id, state: "ready", proxyHealthy: true, running: 0, lastActiveAt: last, capabilities: {}, quotaRank: rank, vibes: { enabled: true, status: "ready" } });
    const out = schedule({
      queued: [{ ...job(1), kind: "video" as const, site: "vibes" as const }],
      accounts: [vib("A", 9, 0), vib("C", 1, 3)],
      perAccount: 1,
      globalCap: 8,
      totalRunning: 0,
      verified: { ...caps, "vibes.video.text": true },
    });
    expect(out[0].accountId).toBe("C");
  });
});

describe("AC-QTA-11 (R75): text of the quota block", () => {
  const now = new Date(2026, 9, 28, 14, 40).getTime();
  const readAt = new Date(2026, 9, 28, 14, 32).getTime();
  const base: Quota = {
    plan: "Free plan",
    usedPercent: 51,
    resetsOn: "Nov 2",
    resetAt: new Date(2026, 10, 2).getTime(),
    additional: { usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5e9, expiryLabel: "Never expires" },
    readAt,
  };
  it("51 % with 5B left", () => {
    expect(quotaPanelText(base, now)).toEqual({
      weekly: "đã dùng 51 % · đặt lại 02/11",
      additional: "5B token còn lại · không hết hạn · đã dùng 0 %",
      readAt: "Đọc lúc 14:32",
      error: null,
    });
  });
  it("no additional part / used up / old snapshot / reset day kept as Muse wrote it", () => {
    expect(quotaPanelText({ ...base, additional: null }, now).additional).toBe("Không có");
    expect(quotaPanelText({ ...base, additional: { usedPercent: 100, remainingLabel: "0 tokens left", remainingApprox: 0, expiryLabel: null } }, now).additional).toBe("Đã dùng hết");
    const { additional: _drop, ...old } = base;
    expect(quotaPanelText(old as Quota, now).additional).toBe("Chưa đọc được");
    expect(quotaPanelText({ ...base, resetAt: null, resetsOn: "Monday" }, now).weekly).toBe("đã dùng 51 % · đặt lại Monday");
  });
  it("failed read keeps the old numbers and says when; never read → no numbers", () => {
    const t = quotaPanelText({ ...base, readAt: new Date(2026, 9, 28, 13, 10).getTime(), checkedAt: now, failures: 1, error: "x" }, now);
    expect(t.weekly).toBe("đã dùng 51 % · đặt lại 02/11");
    expect(t.error).toBe("Không đọc được lúc 14:40 — đang hiện số đọc lúc 13:10");
    expect(quotaPanelText(null, now)).toEqual({ weekly: null, additional: null, readAt: null, error: null });
    expect(quotaPanelText({ readAt: 0, checkedAt: now, failures: 1, error: "x" }, now).error).toBe("Không đọc được lúc 14:40");
    expect(quotaPanelText({ ...base, readAt: new Date(2026, 9, 27, 9, 5).getTime() }, now).readAt).toBe("Đọc lúc 09:05 · 27/10");
  });
});

describe("AC-QTA-16 (lab): one scheduler pass, 1.000 queued × 10 accounts", () => {
  it("median ≤ 5 ms over 30 passes (lab timing, not INP)", () => {
    const accounts: SchedAccount[] = Array.from({ length: 10 }, (_, i) => ({ id: `A${i}`, state: "ready", proxyHealthy: true, running: 0, lastActiveAt: i, capabilities: {}, quotaRank: i % 4 }));
    const queued = Array.from({ length: 1000 }, (_, n) => ({ id: `j${n}`, kind: (n % 3 ? "image" : "video") as "image" | "video", mode: "text" as const, accountPref: n % 7 ? "auto" : `A${n % 10}`, priority: n % 2, seq: n }));
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const out = schedule({ queued, accounts, perAccount: 1, globalCap: 8, totalRunning: 0, verified: VERIFIED_CAPABILITIES });
      times.push(performance.now() - t0);
      expect(out.length).toBe(8);
    }
    times.sort((a, b) => a - b);
    const median = times[15];
    console.info(`[AC-QTA-16] schedule() 1000×10: median ${median.toFixed(2)} ms, p95 ${times[28].toFixed(2)} ms`);
    expect(median).toBeLessThanOrEqual(5);
  });
});
