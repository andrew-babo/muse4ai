// R29 / R33 — which callers and Host headers the API answers. Pure functions.

/** `::ffff:192.168.1.2` → `192.168.1.2`; strips IPv6 zone ids. */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return "";
  let s = ip.trim().toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (s.startsWith("::ffff:") && /^\d+\.\d+\.\d+\.\d+$/.test(s.slice(7))) s = s.slice(7);
  return s;
}

function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** Expands an IPv6 literal into 8 hextets, or null. */
function v6(ip: string): number[] | null {
  if (!ip.includes(":")) return null;
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

export function isLoopback(ipRaw: string): boolean {
  const ip = normalizeIp(ipRaw);
  const a = v4(ip);
  if (a) return a[0] === 127;
  const b = v6(ip);
  return !!b && b.slice(0, 7).every((x) => x === 0) && b[7] === 1;
}

/** Loopback, RFC 1918, CGNAT/Tailscale 100.64/10, IPv6 ULA fc00::/7 and link-local fe80::/10 (spec R29). */
export function isPrivateSource(ipRaw: string): boolean {
  const ip = normalizeIp(ipRaw);
  if (isLoopback(ip)) return true;
  const a = v4(ip);
  if (a) {
    if (a[0] === 10) return true;
    if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
    if (a[0] === 192 && a[1] === 168) return true;
    if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true;
    return false;
  }
  const b = v6(ip);
  if (!b) return false;
  if ((b[0] & 0xfe00) === 0xfc00) return true;
  if ((b[0] & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * R36 — addresses a machine on the Internet can never reach: private sources plus link-local 169.254/16,
 * "this network" 0/8, multicast/reserved 224/3 and the IPv6 unspecified/multicast ranges.
 */
export function isNonPublicIp(ipRaw: string): boolean {
  const ip = normalizeIp(ipRaw);
  if (isPrivateSource(ip)) return true;
  const a = v4(ip);
  if (a) return a[0] === 0 || (a[0] === 169 && a[1] === 254) || a[0] >= 224;
  const b = v6(ip);
  if (!b) return true;
  if (b.every((x) => x === 0)) return true;
  if ((b[0] & 0xff00) === 0xff00) return true;
  return false;
}

export function isIpLiteral(s: string): boolean {
  const ip = normalizeIp(s.replace(/^\[|\]$/g, ""));
  return v4(ip) !== null || v6(ip) !== null;
}

/** Masks for the request log: 203.0.•••.•5 / 2001:db8:•••. */
export function maskIp(ipRaw: string): string {
  const ip = normalizeIp(ipRaw);
  const a = v4(ip);
  if (a) return `${a[0]}.${a[1]}.•••.•${String(a[3]).slice(-1)}`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:•••`;
  return ip ? "•••" : "";
}

export interface HostName {
  name: string;
  port: number | null;
}

/** Parses a Host header (`127.0.0.1:47821`, `[::1]:47821`, `abc.trycloudflare.com`). */
export function parseHost(raw: string | undefined): HostName | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || /[\s/@?#]/.test(s)) return null;
  let name: string;
  let port: string | undefined;
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end < 0) return null;
    name = s.slice(1, end);
    const rest = s.slice(end + 1);
    if (rest && !rest.startsWith(":")) return null;
    port = rest ? rest.slice(1) : undefined;
  } else {
    const parts = s.split(":");
    if (parts.length > 2) return null;
    name = parts[0];
    port = parts[1];
  }
  if (!name) return null;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return null;
  return { name, port: port === undefined ? null : Number(port) };
}

export interface HostPolicy {
  port: number;
  /** Names that must carry the API port (loopback names, LAN addresses, machine name). */
  local: string[];
  /** Public tunnel hostnames (default HTTPS port, so no port or 443). */
  public: string[];
  /** R34 — the domain pointing at this machine (default HTTPS port), while it is enabled. */
  domain?: string[];
  /** Machine host name: in LAN mode `name` and `name.<anything>` are accepted with the port. */
  machineName?: string | null;
}

export type HostVerdict = { ok: true; via: "local" | "public" | "domain" } | { ok: false };

export function checkHost(raw: string | undefined, p: HostPolicy): HostVerdict {
  const h = parseHost(raw);
  if (!h) return { ok: false };
  if (p.public.some((n) => n.toLowerCase() === h.name) && (h.port === null || h.port === 443)) return { ok: true, via: "public" };
  if (p.domain?.some((n) => n.toLowerCase() === h.name) && (h.port === null || h.port === 443)) return { ok: true, via: "domain" };
  if (h.port !== p.port) return { ok: false };
  if (p.local.some((n) => n.toLowerCase() === h.name)) return { ok: true, via: "local" };
  const m = p.machineName?.toLowerCase();
  if (m && (h.name === m || h.name.startsWith(`${m}.`))) return { ok: true, via: "local" };
  return { ok: false };
}

export const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "::1"];
