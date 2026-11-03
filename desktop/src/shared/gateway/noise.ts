import { concat, utf8Encoder } from "./proto";

// Noise_XX_25519_AESGCM_SHA256 primitives over WebCrypto (Chromium page and Node 22 both provide X25519). Pure.
// Ported from the PoC client (research.md §7.4); interoperates with Muse's gateway responder.

const subtle = (): SubtleCrypto => {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new Error("WebCrypto unavailable");
  return s;
};

export const PROTOCOL_NAME = "Noise_XX_25519_AESGCM_SHA256";
const EMPTY = new Uint8Array(0);
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

export async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", ab(b)));
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", ab(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", k, ab(data)));
}

export async function hkdf(chainingKey: Uint8Array, ikm: Uint8Array, n: 2 | 3): Promise<Uint8Array[]> {
  const temp = await hmac(chainingKey, ikm);
  const out: Uint8Array[] = [];
  let prev: Uint8Array = EMPTY;
  for (let i = 1; i <= n; i++) {
    prev = await hmac(temp, concat(prev, Uint8Array.of(i)));
    out.push(prev);
  }
  return out;
}

export class CipherState {
  private k: Uint8Array | null = null;
  private n = 0n;
  private key: CryptoKey | null = null;
  init(k: Uint8Array | null): void {
    this.k = k;
    this.n = 0n;
    this.key = null;
  }
  hasKey(): boolean {
    return this.k !== null;
  }
  private iv(): Uint8Array {
    const b = new Uint8Array(12);
    new DataView(b.buffer).setBigUint64(4, this.n, false);
    return b;
  }
  private async aes(): Promise<CryptoKey> {
    this.key ??= await subtle().importKey("raw", ab(this.k!), "AES-GCM", false, ["encrypt", "decrypt"]);
    return this.key;
  }
  async encrypt(ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.k) return plaintext;
    const c = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: ab(this.iv()), additionalData: ab(ad) }, await this.aes(), ab(plaintext)));
    this.n++;
    return c;
  }
  async decrypt(ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.k) return ciphertext;
    const p = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: ab(this.iv()), additionalData: ab(ad) }, await this.aes(), ab(ciphertext)));
    this.n++;
    return p;
  }
}

export class SymmetricState {
  h: Uint8Array;
  ck: Uint8Array;
  readonly cs = new CipherState();
  constructor() {
    const name = new Uint8Array(32);
    name.set(utf8Encoder.encode(PROTOCOL_NAME));
    this.h = name;
    this.ck = name;
  }
  async mixHash(data: Uint8Array): Promise<void> {
    this.h = await sha256(concat(this.h, data));
  }
  async mixKey(ikm: Uint8Array): Promise<void> {
    const [ck, k] = await hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cs.init(k.subarray(0, 32));
  }
  async encryptAndHash(pt: Uint8Array): Promise<Uint8Array> {
    const ct = await this.cs.encrypt(this.h, pt);
    await this.mixHash(ct);
    return ct;
  }
  async decryptAndHash(ct: Uint8Array): Promise<Uint8Array> {
    const pt = await this.cs.decrypt(this.h, ct);
    await this.mixHash(ct);
    return pt;
  }
  async split(): Promise<[CipherState, CipherState]> {
    const [k1, k2] = await hkdf(this.ck, EMPTY, 2);
    const a = new CipherState();
    const b = new CipherState();
    a.init(k1.subarray(0, 32));
    b.init(k2.subarray(0, 32));
    return [a, b];
  }
}

export interface KeyPair {
  pair: CryptoKeyPair;
  pub: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { pair, pub: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)) };
}

export async function dh(k: KeyPair, publicRaw: Uint8Array): Promise<Uint8Array> {
  const pub = await subtle().importKey("raw", ab(publicRaw), { name: "X25519" }, false, []);
  return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: pub } as unknown as AlgorithmIdentifier, k.pair.privateKey, 256));
}

/** Transport ciphers after the handshake: `send` encrypts what we send, `recv` decrypts what we receive. */
export interface Transport {
  send: CipherState;
  recv: CipherState;
}

export class HandshakeError extends Error {
  constructor(
    message: string,
    readonly step: "message2" | "challenge" | "crypto",
  ) {
    super(message);
  }
}

/**
 * XX initiator. `exchange(msg1)` sends message 1 and resolves with message 2; `deliver(msg3)` sends message 3.
 * `payload1` is the initiator's first payload; `isChallenge(payload2)` lets the caller refuse a server challenge.
 */
export async function initiatorHandshake(io: {
  exchange: (msg1: Uint8Array) => Promise<Uint8Array>;
  deliver: (msg3: Uint8Array) => void;
  payload1: Uint8Array;
  isChallenge?: (payload2: Uint8Array) => boolean;
}): Promise<Transport> {
  const ss = new SymmetricState();
  await ss.mixHash(EMPTY); // empty prologue
  const s = await generateKeyPair();
  const e = await generateKeyPair();
  await ss.mixHash(e.pub);
  const msg1 = concat(e.pub, await ss.encryptAndHash(io.payload1));
  const m2 = await io.exchange(msg1);
  if (m2.length < 80) throw new HandshakeError("handshake message 2 too short", "message2");
  const re = m2.subarray(0, 32);
  await ss.mixHash(re);
  await ss.mixKey(await dh(e, re));
  let rs: Uint8Array;
  let payload2: Uint8Array;
  try {
    rs = await ss.decryptAndHash(m2.subarray(32, 80));
    await ss.mixKey(await dh(e, rs));
    payload2 = await ss.decryptAndHash(m2.subarray(80));
  } catch (err) {
    throw new HandshakeError(`handshake decrypt failed: ${String(err).slice(0, 80)}`, "crypto");
  }
  if (io.isChallenge?.(payload2)) throw new HandshakeError("gateway asked for a challenge", "challenge");
  const out3 = await ss.encryptAndHash(s.pub);
  await ss.mixKey(await dh(s, re));
  const tail = await ss.encryptAndHash(EMPTY);
  io.deliver(concat(out3, tail));
  const [send, recv] = await ss.split();
  return { send, recv };
}

/** XX responder (tests only: a fake gateway that speaks the same protocol). */
export async function responderHandshake(io: {
  receive: () => Promise<Uint8Array>;
  send: (m: Uint8Array) => void;
  payload2: Uint8Array;
}): Promise<{ transport: Transport; payload1: Uint8Array }> {
  const ss = new SymmetricState();
  await ss.mixHash(EMPTY);
  const s = await generateKeyPair();
  const e = await generateKeyPair();
  const m1 = await io.receive();
  const re = m1.subarray(0, 32);
  await ss.mixHash(re);
  const payload1 = await ss.decryptAndHash(m1.subarray(32));
  await ss.mixHash(e.pub);
  await ss.mixKey(await dh(e, re));
  const encS = await ss.encryptAndHash(s.pub);
  await ss.mixKey(await dh(s, re));
  const encP = await ss.encryptAndHash(io.payload2);
  io.send(concat(e.pub, encS, encP));
  const m3 = await io.receive();
  const rs = await ss.decryptAndHash(m3.subarray(0, 48));
  await ss.mixKey(await dh(e, rs));
  await ss.decryptAndHash(m3.subarray(48));
  const [c1, c2] = await ss.split();
  return { transport: { send: c2, recv: c1 }, payload1 };
}
