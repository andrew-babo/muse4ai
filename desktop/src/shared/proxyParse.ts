import type { ProxyScheme } from "./types";

// Spec §6 accepted formats: host:port, host:port:user:pass, user:pass@host:port, scheme://user:pass@host:port.

export interface ParsedProxy {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export interface ProxyLineResult {
  line: number;
  /** 1-based position on the line, set only when the line holds several entries. */
  item?: number;
  ok: boolean;
  /** Same host:port already in the store or earlier in the input — skipped, not an error. */
  duplicate?: boolean;
  value?: ParsedProxy;
  error?: string;
  display: string; // safe display: scheme://host:port (never the password)
}

/** What an import reports back: duplicates are counted as skipped, malformed entries listed as errors. */
export interface ProxyImportResult {
  added: number;
  skipped: number;
  errors: { line: number; item?: number; error: string }[];
}

/** "Dòng 3" or "Dòng 1, mục 4" for entries pasted several to a line. */
export function proxyEntryWhere(r: { line: number; item?: number }): string {
  return r.item ? `Dòng ${r.line}, mục ${r.item}` : `Dòng ${r.line}`;
}

const HOST_RE = /^[A-Za-z0-9.-]+$|^\[[0-9a-fA-F:]+\]$/;

function mkErr(line: number, error: string, display = ""): ProxyLineResult {
  return { line, ok: false, error, display };
}

export function parseProxyLine(raw: string, line: number): ProxyLineResult | null {
  const s = raw.trim();
  if (!s || s.startsWith("#")) return null;
  let scheme: ProxyScheme = "http";
  let rest = s;
  const m = /^([a-z0-9]+):\/\/(.*)$/i.exec(s);
  if (m) {
    const sc = m[1].toLowerCase();
    if (sc === "socks5h") scheme = "socks5";
    else if (sc === "http" || sc === "https" || sc === "socks5") scheme = sc;
    else return mkErr(line, `Giao thức “${sc}” không hỗ trợ (dùng http, https hoặc socks5)`);
    rest = m[2].replace(/\/+$/, "");
  }
  let host = "";
  let portStr = "";
  let username: string | null = null;
  let password: string | null = null;
  if (rest.includes("@")) {
    const at = rest.lastIndexOf("@");
    const cred = rest.slice(0, at);
    const hp = rest.slice(at + 1);
    const ci = cred.indexOf(":");
    if (ci <= 0) return mkErr(line, "Thiếu mật khẩu hoặc tên đăng nhập proxy");
    username = cred.slice(0, ci);
    password = cred.slice(ci + 1);
    const parts = hp.split(":");
    if (parts.length !== 2) return mkErr(line, "Sai định dạng máy chủ:cổng");
    [host, portStr] = parts;
  } else {
    const parts = rest.split(":");
    if (parts.length === 2) [host, portStr] = parts;
    else if (parts.length >= 4) {
      host = parts[0];
      portStr = parts[1];
      username = parts[2];
      password = parts.slice(3).join(":");
    } else return mkErr(line, "Sai định dạng (cần máy chủ:cổng hoặc máy chủ:cổng:tên:mật khẩu)");
  }
  host = host.trim();
  if (!host || !HOST_RE.test(host)) return mkErr(line, "Tên máy chủ proxy không hợp lệ");
  if (!/^\d+$/.test(portStr)) return mkErr(line, "Cổng proxy phải là số", `${scheme}://${host}`);
  const port = Number(portStr);
  if (port < 1 || port > 65535) return mkErr(line, "Cổng proxy phải từ 1 đến 65535", `${scheme}://${host}`);
  if (username !== null && (!username || !password)) return mkErr(line, "Thiếu mật khẩu hoặc tên đăng nhập proxy", `${scheme}://${host}:${port}`);
  return { line, ok: true, value: { scheme, host, port, username, password }, display: `${scheme}://${host}:${port}` };
}

/**
 * Parses pasted text; a host:port already in the store or earlier in the input is returned as `duplicate`
 * (reported as skipped, never silently merged into an existing record).
 * Entries may be one per line or separated by spaces, commas or semicolons on a line (providers often copy them that way).
 */
export function parseProxyList(text: string, existingKeys: string[] = []): ProxyLineResult[] {
  const seen = new Set(existingKeys.map((k) => k.toLowerCase()));
  const out: ProxyLineResult[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    if (rawLine.trim().startsWith("#")) return;
    const tokens = rawLine.split(/[\s,;]+/).filter(Boolean);
    tokens.forEach((raw, t) => {
      const parsed = parseProxyLine(raw, i + 1);
      if (!parsed) return;
      const r: ProxyLineResult = tokens.length > 1 ? { ...parsed, item: t + 1 } : parsed;
      if (r.ok && r.value) {
        const key = `${r.value.host}:${r.value.port}`.toLowerCase();
        if (seen.has(key)) {
          out.push({ line: r.line, item: r.item, ok: false, duplicate: true, error: `${r.display} đã có trong danh sách`, display: r.display });
          return;
        }
        seen.add(key);
      }
      out.push(r);
    });
  });
  return out;
}

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const p = ip.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.•••.•${p[3].slice(-1)}`;
  if (ip.includes(":")) return ip.split(":").slice(0, 2).join(":") + ":•••";
  return "•••";
}
