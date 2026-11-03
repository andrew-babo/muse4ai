import { b64url, unb64url } from "../../../shared/api/oauth";
import type { KeyPair } from "./keys";

// Access tokens are ES256 JWTs signed by this install (spec rev 8 R134–R136): no state on the request path,
// and a token from another install or another origin fails before any data is read.

export interface AccessClaims {
  /** issuer — the public origin that signed it. */
  iss: string;
  /** subject — the connection (client) the token was issued to. */
  sub: string;
  /** audience — the resource the token is for (this app's origin). */
  aud: string;
  iat: number;
  exp: number;
  /** token id, so one token can be revoked without touching its family. */
  jti: string;
  client_id: string;
  scope: string;
}

export type VerifyResult = { ok: true; claims: AccessClaims; jti: string } | { ok: false; error: "invalid_request" | "invalid_token" };

const encode = (o: unknown): string => b64url(Buffer.from(JSON.stringify(o), "utf8"));

/** Signs a token. `typ` is omitted from the header — clients only read `alg` and `kid`. */
export function signAccessToken(keys: KeyPair, claims: AccessClaims): string {
  const header = encode({ alg: "ES256", kid: keys.kid, typ: "JWT" });
  const payload = encode(claims);
  const body = `${header}.${payload}`;
  return `${body}.${keys.sign(body)}`;
}

/** Splits a JWS into its three parts; null for anything that is not a well-formed JWT. */
export function splitJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; body: string; signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  try {
    const header = JSON.parse(unb64url(parts[0]).toString("utf8")) as Record<string, unknown>;
    const payload = JSON.parse(unb64url(parts[1]).toString("utf8")) as Record<string, unknown>;
    return { header, payload, body: `${parts[0]}.${parts[1]}`, signature: parts[2] };
  } catch {
    return null;
  }
}

/**
 * Verifies signature, algorithm, issuer, audience and lifetime.
 * The digest of the token is compared against `revokedDigest` when given, so a revoked token fails here too.
 */
export function verifyAccessToken(
  token: string,
  keys: KeyPair,
  expect: { iss: string; aud: string; now: number; revokedDigest?: (claims: AccessClaims) => boolean },
): VerifyResult {
  const jws = splitJwt(token);
  if (!jws) return { ok: false, error: "invalid_token" };
  if (jws.header.alg !== "ES256") return { ok: false, error: "invalid_token" };
  if (!keys.verify(jws.body, jws.signature)) return { ok: false, error: "invalid_token" };
  const c = jws.payload as Partial<AccessClaims>;
  if (typeof c.iss !== "string" || typeof c.aud !== "string" || typeof c.sub !== "string" || typeof c.jti !== "string") return { ok: false, error: "invalid_token" };
  if (c.iss !== expect.iss || c.aud !== expect.aud) return { ok: false, error: "invalid_token" };
  // exp/iat are seconds (RFC 7519); the app's clock is in milliseconds.
  if (typeof c.exp !== "number" || c.exp * 1000 <= expect.now) return { ok: false, error: "invalid_token" };
  if (typeof c.iat === "number" && c.iat * 1000 > expect.now + 60_000) return { ok: false, error: "invalid_token" };
  const claims = c as AccessClaims;
  if (expect.revokedDigest?.(claims)) return { ok: false, error: "invalid_token" };
  return { ok: true, claims, jti: claims.jti };
}

/** The id a token carries (`jti`) is the row the app can revoke, so no token string is ever stored. */
export function claimsOf(result: VerifyResult): AccessClaims | null {
  return result.ok ? result.claims : null;
}

