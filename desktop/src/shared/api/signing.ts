import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// R32 — signed, expiring download links: sig = HMAC-SHA256(secret, "v1\n{assetId}\n{keyId}\n{exp}") in base64url.

export function downloadSignature(secret: Buffer, assetId: string, keyId: string, exp: number): string {
  return createHmac("sha256", secret).update(`v1\n${assetId}\n${keyId}\n${exp}`, "utf8").digest("base64url");
}

export function verifyDownloadSignature(secret: Buffer, assetId: string, keyId: string, exp: number, sig: string, nowS: number, maxTtlS: number): boolean {
  if (!Number.isSafeInteger(exp) || exp < nowS || exp > nowS + maxTtlS + 5) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const want = Buffer.from(downloadSignature(secret, assetId, keyId, exp), "base64url");
  const got = Buffer.from(sig, "base64url");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Stable JSON (sorted keys) → SHA-256, for R27 request fingerprints. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}
