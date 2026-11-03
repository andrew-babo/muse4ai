// Minimal protobuf wire helpers for Muse's gateway frames (Build 2.0 §6, B44). Pure, no DOM/Node APIs.

const te = new TextEncoder();
const td = new TextDecoder();

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function varint(value: number | bigint): Uint8Array {
  let n = BigInt(value);
  if (n < 0n) n &= (1n << 64n) - 1n;
  const out: number[] = [];
  for (;;) {
    const b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) out.push(b | 0x80);
    else {
      out.push(b);
      return Uint8Array.from(out);
    }
  }
}

export const fieldVarint = (f: number, v: number | bigint): Uint8Array => concat(varint(f << 3), varint(v));
export const fieldBytes = (f: number, b: Uint8Array): Uint8Array => concat(varint((f << 3) | 2), varint(b.length), b);
export const fieldString = (f: number, s: string): Uint8Array => fieldBytes(f, te.encode(s));

export class ProtoError extends Error {}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let shift = 0n;
  let val = 0n;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new ProtoError("truncated varint");
    const b = buf[pos++];
    val |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [val, pos];
    shift += 7n;
  }
  throw new ProtoError("varint too long");
}

export type FieldValue = number | Uint8Array;
export type Fields = Record<number, FieldValue[]>;

/** Decodes one message level. Unknown wire types or overruns throw ProtoError (→ protocol mismatch, R89(c)). */
export function decodeFields(buf: Uint8Array): Fields {
  const out: Fields = {};
  let pos = 0;
  while (pos < buf.length) {
    let key: bigint;
    [key, pos] = readVarint(buf, pos);
    const f = Number(key >> 3n);
    const wt = Number(key & 7n);
    let v: FieldValue;
    if (wt === 0) {
      let x: bigint;
      [x, pos] = readVarint(buf, pos);
      v = Number(x);
    } else if (wt === 2) {
      let ln: bigint;
      [ln, pos] = readVarint(buf, pos);
      const len = Number(ln);
      if (pos + len > buf.length) throw new ProtoError("length overrun");
      v = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wt === 5) {
      if (pos + 4 > buf.length) throw new ProtoError("fixed32 overrun");
      v = buf.subarray(pos, pos + 4);
      pos += 4;
    } else if (wt === 1) {
      if (pos + 8 > buf.length) throw new ProtoError("fixed64 overrun");
      v = buf.subarray(pos, pos + 8);
      pos += 8;
    } else throw new ProtoError(`wire type ${wt}`);
    (out[f] ??= []).push(v);
  }
  return out;
}

export function num(f: Fields, k: number, d = 0): number {
  const v = f[k]?.[0];
  return typeof v === "number" ? v : d;
}
export function bytes(f: Fields, k: number): Uint8Array | null {
  const v = f[k]?.[0];
  return v instanceof Uint8Array ? v : null;
}
export function str(f: Fields, k: number): string {
  const b = bytes(f, k);
  return b ? td.decode(b) : "";
}
export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export { te as utf8Encoder, td as utf8Decoder };
