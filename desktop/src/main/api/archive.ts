import fs from "node:fs";
import { promisify } from "node:util";
import zlib from "node:zlib";

// Extracts one file from a release archive (ZIP on Windows, tar.gz on Linux) with node:zlib only —
// no PowerShell Expand-Archive (slow, silently empty on Server 2016) and no extra dependency (B27).

const inflateRaw = promisify(zlib.inflateRaw);
const gunzip = promisify(zlib.gunzip);

const matches = (name: string, entry: string) => name === entry || name.endsWith(`/${entry}`);

export async function extractZipEntry(buf: Buffer, entry: string): Promise<Buffer> {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!matches(name, entry)) continue;
    if (compSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error("zip64 not supported");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("corrupt zip local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    const out = method === 0 ? Buffer.from(data) : method === 8 ? await inflateRaw(data) : null;
    if (!out) throw new Error(`unsupported zip method ${method}`);
    if (out.length !== size) throw new Error("zip entry size mismatch");
    return out;
  }
  throw new Error(`${entry} not found in archive`);
}

export async function extractTarGzEntry(buf: Buffer, entry: string): Promise<Buffer> {
  const tar = await gunzip(buf);
  const cstr = (o: number, n: number) => {
    const s = tar.subarray(o, o + n);
    const z = s.indexOf(0);
    return s.toString("utf8", 0, z < 0 ? n : z);
  };
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = cstr(off, 100);
    const size = parseInt(cstr(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = cstr(off + 257, 6).startsWith("ustar") ? cstr(off + 345, 155) : "";
    const full = prefix ? `${prefix}/${name}` : name;
    if (!Number.isFinite(size) || size < 0) throw new Error("corrupt tar header");
    if ((type === "0" || type === "\0") && matches(full, entry)) return Buffer.from(tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${entry} not found in archive`);
}

/** Writes `entry` from `archive` to `dest`. */
export async function extractEntry(archive: string, entry: string, dest: string): Promise<void> {
  const buf = await fs.promises.readFile(archive);
  const data = /\.zip$/i.test(archive) ? await extractZipEntry(buf, entry) : await extractTarGzEntry(buf, entry);
  await fs.promises.writeFile(dest, data);
}
