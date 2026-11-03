import { createHash, createPublicKey, createVerify, generateKeyPairSync, sign as ecdsaSign, verify as ecdsaVerify } from "node:crypto";

// ES256 signing keys for the app's own access tokens (spec rev 8 R134). One pair per install, kept in the vault
// (DPAPI on Windows) exactly like the URL signing secret, so a copied SQLite file cannot mint tokens.

/** The encrypted store this install keeps its secrets in — only these two calls are needed (the app's Vault satisfies it). */
export interface SecretStore {
  set(key: string, value: string): void;
  get(key: string): string | null;
}

export const VAULT_OAUTH_KEYS = "oauth-es256";

export interface Jwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  alg: "ES256";
  use: "sig";
  kid: string;
}

export interface KeyPair {
  kid: string;
  /** PKCS#8 PEM, for signing. Never sent out of the process. */
  privatePem: string;
  jwk: Jwk;
  sign(payload: string): string;
  verify(payload: string, signature: string): boolean;
}

const b64u = (b: Buffer) => b.toString("base64url");

/** `ieee-p1363` gives the fixed 64-byte R||S a JWS needs (a DER signature would not be a valid ES256 JWS). */
function makeKeyPair(privatePem: string, jwk: Jwk): KeyPair {
  return {
    kid: jwk.kid,
    privatePem,
    jwk,
    sign(payload: string): string {
      return b64u(Buffer.from(ecdsaSign("sha256", Buffer.from(payload, "utf8"), { key: privatePem, dsaEncoding: "ieee-p1363" })));
    },
    verify(payload: string, signature: string): boolean {
      const sig = Buffer.from(signature, "base64url");
      if (sig.length !== 64) return false;
      try {
        return ecdsaVerify("sha256", Buffer.from(payload, "utf8"), { key: privatePem, dsaEncoding: "ieee-p1363" }, sig);
      } catch {
        return false;
      }
    },
  };
}

/** RFC 7638-style thumbprint of the public key, so a rotated pair is visibly a different key. */
export function jwkThumbprint(jwk: Pick<Jwk, "crv" | "kty" | "x" | "y">): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64u(Buffer.from(createHash("sha256").update(canonical, "utf8").digest())).slice(0, 16);
}

/** Loads the install's key pair from the vault, creating and storing one on first use. */
export function loadOrCreateKeyPair(vault: SecretStore): KeyPair {
  const stored = vault.get(VAULT_OAUTH_KEYS);
  if (stored) {
    try {
      const p = JSON.parse(stored) as { privatePem?: string; jwk?: Jwk };
      if (p.privatePem && p.jwk?.kid && p.jwk.x && p.jwk.y) return makeKeyPair(p.privatePem, p.jwk);
    } catch {
      /* unreadable entry: make a new pair (tokens signed with the old one simply stop verifying) */
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pub = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  const jwk: Jwk = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y, alg: "ES256", use: "sig", kid: "" };
  jwk.kid = jwkThumbprint(jwk);
  vault.set(VAULT_OAUTH_KEYS, JSON.stringify({ privatePem, jwk }));
  return makeKeyPair(privatePem, jwk);
}

/** Verifies a token against a public JWK only — used when this process did not sign it (tests, other installs). */
export function verifyWithJwk(payload: string, signature: string, jwk: Jwk): boolean {
  const sig = Buffer.from(signature, "base64url");
  if (sig.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { ...jwk, alg: "ES256" }, format: "jwk" });
    return ecdsaVerify("sha256", Buffer.from(payload, "utf8"), { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch {
    return false;
  }
}

/** Verifies against a PEM public key (same contract, different input form). */
export function verifyWithPem(publicPem: string, payload: string, signature: string): boolean {
  const sig = Buffer.from(signature, "base64url");
  if (sig.length !== 64) return false;
  try {
    return createVerify("sha256").update(Buffer.from(payload, "utf8")).verify({ key: publicPem, dsaEncoding: "ieee-p1363" }, sig);
  } catch {
    return false;
  }
}
