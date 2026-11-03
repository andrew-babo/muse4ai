import { describe, expect, it } from "vitest";
import { API_BUCKETS } from "../src/shared/api/constants";
import { apiStatus, isSettled, statesFor } from "../src/shared/api/jobView";
import { API_KEY_RE, bearerToken, hashToken, keyIdOf, newApiKey, tokenMatches } from "../src/shared/api/keys";
import { decodeHeaderValue, looksModern, supportsStructured, toolsFor } from "../src/shared/api/mcpProtocol";
import { checkHost, isPrivateSource, maskIp, parseHost } from "../src/shared/api/netPolicy";
import { RateLimiter } from "../src/shared/api/rateLimit";
import { checkIdempotencyKey, createJobSchema, intParam, normaliseCreate, parseOrThrow } from "../src/shared/api/schemas";
import { downloadSignature, fingerprint, verifyDownloadSignature } from "../src/shared/api/signing";

describe("API keys (R24)", () => {
  it("format msk_{8}_{43}, 32 random bytes, only the SHA-256 is comparable", () => {
    const k = newApiKey();
    expect(k.token).toMatch(API_KEY_RE);
    expect(k.token).toHaveLength(4 + 8 + 1 + 43);
    expect(Buffer.from(k.token.slice(13), "base64url")).toHaveLength(32);
    expect(k.hash).toBe(hashToken(k.token));
    expect(k.hash).not.toContain(k.token.slice(13));
    expect(keyIdOf(k.token)).toBe(k.id);
    expect(tokenMatches(k.token, k.hash)).toBe(true);
    expect(tokenMatches(k.token.slice(0, -1) + (k.token.endsWith("A") ? "B" : "A"), k.hash)).toBe(false);
    expect(keyIdOf("msk_short_x")).toBeNull();
  });

  it("two keys never share an id or secret", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newApiKey().id));
    expect(ids.size).toBe(200);
  });

  it("only the Authorization header carries the key", () => {
    expect(bearerToken("Bearer msk_abc")).toBe("msk_abc");
    expect(bearerToken("bearer   msk_abc ")).toBe("msk_abc");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("rate limits (R28, AC-API-12 rule)", () => {
  it("create bucket (Build 2.0 R109): 30 back-to-back pass, the 31st waits ≥ 1 s; tokens come back at 120/min", () => {
    expect(API_BUCKETS.create).toEqual({ capacity: 30, perMinute: 120 });
    expect(API_BUCKETS.upload.perMinute).toBe(60);
    const l = new RateLimiter(API_BUCKETS);
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(l.take("k", "create", t).ok).toBe(true);
    const r = l.take("k", "create", t);
    expect(r.ok).toBe(false);
    expect(r.retryAfterS).toBe(1); // 120/min → one token every 0.5 s, rounded up to whole seconds
    expect(l.take("k", "create", t + 500).ok).toBe(true);
    expect(l.take("other", "create", t).ok).toBe(true); // per key
  });

  it("read bucket allows 60 at once and 240/min", () => {
    const l = new RateLimiter(API_BUCKETS);
    for (let i = 0; i < 60; i++) expect(l.take("k", "read", 0).ok).toBe(true);
    expect(l.take("k", "read", 0).ok).toBe(false);
    expect(l.take("k", "read", 250).ok).toBe(true);
  });
});

describe("network policy (R29, R33)", () => {
  it("AC-API-19: LAN mode sources", () => {
    expect(isPrivateSource("203.0.113.5")).toBe(false);
    expect(isPrivateSource("192.168.1.20")).toBe(true);
    expect(isPrivateSource("100.101.2.3")).toBe(true);
    expect(isPrivateSource("127.0.0.1")).toBe(true);
    expect(isPrivateSource("::ffff:192.168.1.20")).toBe(true);
    expect(isPrivateSource("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateSource("::1")).toBe(true);
    expect(isPrivateSource("fd7a:115c:a1e0::1")).toBe(true);
    expect(isPrivateSource("fe80::1%eth0")).toBe(true);
    expect(isPrivateSource("2001:db8::1")).toBe(false);
    expect(isPrivateSource("172.32.0.1")).toBe(false);
    expect(isPrivateSource("100.128.0.1")).toBe(false);
  });

  it("Host must be ours (AC-API-13 rule)", () => {
    const p = { port: 47821, local: ["127.0.0.1", "localhost", "::1"], public: ["quiet-river.trycloudflare.com"] };
    expect(checkHost("127.0.0.1:47821", p)).toEqual({ ok: true, via: "local" });
    expect(checkHost("[::1]:47821", p)).toEqual({ ok: true, via: "local" });
    expect(checkHost("localhost:47821", p)).toEqual({ ok: true, via: "local" });
    expect(checkHost("quiet-river.trycloudflare.com", p)).toEqual({ ok: true, via: "public" });
    expect(checkHost("evil.example", p).ok).toBe(false);
    expect(checkHost("127.0.0.1:8080", p).ok).toBe(false);
    expect(checkHost("127.0.0.1", p).ok).toBe(false);
    expect(checkHost(undefined, p).ok).toBe(false);
    expect(checkHost("a@b", p).ok).toBe(false);
    expect(checkHost("VPS-01.tail1234.ts.net:47821", { ...p, machineName: "vps-01" }).ok).toBe(true);
    expect(parseHost("[::1]")).toEqual({ name: "::1", port: null });
  });

  it("masks IPs for the request log", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.•••.•5");
    expect(maskIp("::ffff:10.1.2.3")).toBe("10.1.•••.•3");
    expect(maskIp("2001:db8::1")).toBe("2001:db8:•••");
  });
});

describe("signed links (R32)", () => {
  const secret = Buffer.alloc(32, 7);
  it("valid until expiry, bound to asset and key", () => {
    const exp = 2_000_000_000;
    const sig = downloadSignature(secret, "asset-1", "keyA0001", exp);
    expect(verifyDownloadSignature(secret, "asset-1", "keyA0001", exp, sig, exp - 100, 3600)).toBe(true);
    expect(verifyDownloadSignature(secret, "asset-2", "keyA0001", exp, sig, exp - 100, 3600)).toBe(false);
    expect(verifyDownloadSignature(secret, "asset-1", "keyB0001", exp, sig, exp - 100, 3600)).toBe(false);
    expect(verifyDownloadSignature(secret, "asset-1", "keyA0001", exp, sig, exp + 1, 3600)).toBe(false);
    expect(verifyDownloadSignature(secret, "asset-1", "keyA0001", exp, sig, exp - 7200, 3600)).toBe(false); // exp too far ahead
  });
});

describe("request normalisation (R27, R11)", () => {
  it("equal requests have equal fingerprints regardless of key order and defaults", () => {
    const a = normaliseCreate(parseOrThrow(createJobSchema, { kind: "image", prompt: "x" }));
    const b = normaliseCreate(parseOrThrow(createJobSchema, { prompt: "x", repeat: 1, account: "auto", kind: "image" }));
    expect(fingerprint(a)).toBe(fingerprint(b));
    const c = normaliseCreate(parseOrThrow(createJobSchema, { kind: "image", prompt: "y" }));
    expect(fingerprint(c)).not.toBe(fingerprint(a));
  });

  it("AC-API-07 rules: repeat 5 and unknown fields are invalid_request", () => {
    expect(() => normaliseCreate(parseOrThrow(createJobSchema, { kind: "image", prompt: "x", repeat: 5 }))).toThrow(/Số lần lặp/);
    expect(() => parseOrThrow(createJobSchema, { kind: "image", prompt: "x", ratio: "1:1" })).toThrow(/ratio/);
    expect(() => parseOrThrow(createJobSchema, { kind: "gif", prompt: "x" })).toThrow(/kind/);
    expect(normaliseCreate(parseOrThrow(createJobSchema, { kind: "video", prompt: "x", reference_id: "r1" })).mode).toBe("reference");
  });

  it("Idempotency-Key: 1–100 printable characters", () => {
    expect(checkIdempotencyKey("k-001")).toBe("k-001");
    expect(checkIdempotencyKey(undefined)).toBeNull();
    expect(checkIdempotencyKey("request 123")).toBe("request 123"); // space is printable (R27)
    expect(() => checkIdempotencyKey("a\tb")).toThrow();
    expect(() => checkIdempotencyKey("khoá-1")).toThrow();
    expect(() => checkIdempotencyKey("x".repeat(101))).toThrow();
    expect(() => intParam("51", "wait", 0, 50, 0)).toThrow();
    expect(intParam(null, "wait", 0, 50, 0)).toBe(0);
  });
});

describe("job status for agents (§4.8)", () => {
  it("maps internal states to six statuses", () => {
    expect(apiStatus("held")).toBe("queued");
    expect(apiStatus("download_retry")).toBe("running");
    expect(apiStatus("completed")).toBe("succeeded");
    expect(statesFor("running")).toEqual(["submitting", "submitted", "generating", "downloading", "download_retry"]);
    expect(isSettled("needs_review")).toBe(true);
    expect(isSettled("generating")).toBe(false);
  });
});

describe("MCP protocol helpers", () => {
  it("read-only keys see 4 read tools (Build 2.0: 8 with write, muse_chat is write-only); structured fields only from 2025-06-18", () => {
    expect(toolsFor("2025-11-25", true).map((t) => t.name)).toEqual(["muse_status", "muse_generate", "muse_chat", "muse_get_job", "muse_list_jobs", "muse_cancel_job", "muse_extend_video", "muse_get_extend"]);
    expect(toolsFor("2025-11-25", false).map((t) => t.name)).toEqual(["muse_status", "muse_get_job", "muse_list_jobs", "muse_get_extend"]);
    expect(toolsFor("2025-03-26", true)[0]).not.toHaveProperty("outputSchema");
    expect(toolsFor("2025-06-18", true)[0]).toHaveProperty("title");
    expect(supportsStructured("2026-07-28")).toBe(true);
  });

  it("decodes base64 header sentinels and recognises the modern era", () => {
    expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界");
    expect(decodeHeaderValue("tools/call")).toBe("tools/call");
    expect(looksModern("2026-07-28")).toBe(true);
    expect(looksModern("2099-01-01")).toBe(true);
    expect(looksModern("2025-06-18")).toBe(false);
  });
});
