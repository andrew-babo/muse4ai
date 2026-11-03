import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { API_KEY_PREFIX } from "./constants";

// R24 — API key format `msk_{8 base62}_{43 base64url}` (32 random bytes). Only the SHA-256 of the whole token is stored.

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const API_KEY_RE = /^msk_([0-9A-Za-z]{8})_([A-Za-z0-9_-]{43})$/;

/** Unbiased base62 (rejection sampling). */
export function base62(len: number, rand: (n: number) => Buffer = randomBytes): string {
  let out = "";
  while (out.length < len) {
    for (const b of rand(len * 2)) {
      if (b >= 248) continue; // 248 = 62 * 4
      out += B62[b % 62];
      if (out.length === len) break;
    }
  }
  return out;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface NewKey {
  id: string;
  token: string;
  hash: string;
}

export function newApiKey(rand: (n: number) => Buffer = randomBytes): NewKey {
  const id = base62(8, rand);
  const secret = rand(32).toString("base64url");
  const token = `${API_KEY_PREFIX}${id}_${secret}`;
  return { id, token, hash: hashToken(token) };
}

/** Returns the public key id if the string has the key shape (no secret checks here). */
export function keyIdOf(token: string): string | null {
  const m = API_KEY_RE.exec(token);
  return m ? m[1] : null;
}

/** Constant-time comparison of the token's digest with the stored digest. */
export function tokenMatches(token: string, storedHashHex: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHashHex, "hex");
  if (a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

/** A digest that matches nothing, compared when the key id is unknown so both paths cost the same. */
export const DUMMY_HASH = "0".repeat(64);

/** `Authorization: Bearer msk_…` → token, or null. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}

/** First 12 characters for display (`msk_7Hq2xKfa`), never the secret part. */
export function keyPrefix(id: string): string {
  return `${API_KEY_PREFIX}${id}`;
}
