// Spec rev 5, R34–R38 — domain pointing at this machine, next to the tunnel. Pure functions only (unit-tested in Node).
import type { AgentUrl, ApiDomainProxy, DomainState, DomainStep, DomainStepKey, TunnelStatus } from "../types";
import { isIpLiteral, isNonPublicIp } from "./netPolicy";
import { BRAND } from "../brand";

export const DOMAIN_MSG = {
  empty: "Nhập tên miền (ví dụ api.tenmiencuaanh.com)",
  ip: "Nhập tên miền, không nhập địa chỉ IP",
  invalid: "Tên miền không hợp lệ",
  quick: "Đây là địa chỉ đường hầm tạm thời, không dùng làm tên miền",
  internalName: "Tên miền nội bộ (.local, .internal…) — máy trên Internet không tới được",
  named: "Tên miền này đang dùng cho đường hầm có tên — dùng tên khác (ví dụ api.… và tunnel.…)",
  sameAsDomain: "Tên miền này đang dùng cho Tên miền trỏ về máy — dùng tên khác (ví dụ api.… và tunnel.…)",
  needApi: "Bật API trước khi bật tên miền",
  dnsNone: (host: string) => `Chưa thấy bản ghi DNS cho ${host}`,
  dnsPrivate: "Tên miền trỏ tới địa chỉ nội bộ — máy trên Internet không tới được",
  dnsOther: "Tên miền trỏ tới IP khác IP của máy — có thể đang qua proxy Cloudflare hoặc NAT",
  dnsOk: (ips: string) => `Đã trỏ tới ${ips}`,
  dnsError: "Không hỏi được DNS — kiểm tra mạng của máy",
  portChecking: "Đang kiểm cổng 80 và 443",
  portOk: "Cổng 80 và 443 trống",
  port443: "Cổng 443 đang bị chương trình khác dùng — tắt chương trình đó hoặc chọn Proxy HTTPS có sẵn",
  port80: "Cổng 80 đang bận: chỉ dùng 443",
  certOk: "Chứng chỉ hợp lệ",
  certWaiting: "Đang chờ chứng chỉ",
  certExternal: "Chứng chỉ HTTPS chưa hợp lệ — kiểm proxy HTTPS của anh",
  unreachable: "Máy khác chưa tới được cổng 443 — kiểm tường lửa nhà cung cấp và tường lửa Windows",
  probeError: (m: string) => `Không gọi thử được: ${m}`,
  appOk: "Trả lời đúng app này",
  otherInstance: "Tên miền đang trỏ tới máy hoặc app khác",
  badGateway: (port: number) => `Proxy chạy nhưng không tới được app (API trên cổng ${port})`,
  httpOther: (status: number) => `Trả lời HTTP ${status} — không phải Muse4AI`,
  lastOnline: (hhmm: string) => `Trực tuyến lần cuối lúc ${hhmm}`,
  external502: "Proxy của anh vẫn chạy, sẽ trả lỗi 502 vì app không còn nghe",
  hashMismatch: "Tệp Caddy không khớp mã kiểm tra — đã xoá tệp, không chạy. Bấm Thử lại để tải lại",
  download: "Không tải được Caddy — kiểm tra mạng rồi bấm Thử lại",
  unsupported: "Máy này chưa hỗ trợ tự chạy HTTPS — chọn Proxy HTTPS có sẵn",
  gaveUp: "Caddy dừng 5 lần liên tiếp — bấm Thử lại",
  exited: "Caddy dừng bất thường",
} as const;

// ================================================================ R34 — input
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** 4–253 chars, a–z/0–9/hyphen labels, letter TLD 2–63 (punycode `xn--` TLDs accepted too). */
const DOMAIN_RE = new RegExp(`^(?=.{4,253}$)(?:${LABEL}\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$`);

export type DomainInput = { ok: true; host: string } | { ok: false; error: string };

/** Special-use / private suffixes no machine on the Internet can resolve (and that would push Caddy to its local CA). */
const INTERNAL_SUFFIXES = ["local", "localhost", "internal", "intranet", "lan", "home", "corp", "private", "test", "example", "invalid", "onion", "home.arpa"];

export function normalizeDomain(raw: string, opts: { namedHost?: string | null } = {}): DomainInput {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) return { ok: false, error: DOMAIN_MSG.empty };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/[/?#].*$/, "");
  if (s.includes("@")) return { ok: false, error: DOMAIN_MSG.invalid };
  if (s.startsWith("[") || isIpLiteral(s)) return { ok: false, error: DOMAIN_MSG.ip };
  const port = /:(\d{1,5})$/.exec(s);
  if (port) {
    if (port[1] !== "443") return { ok: false, error: DOMAIN_MSG.invalid };
    s = s.slice(0, -port[0].length);
  }
  s = s.replace(/\.$/, "");
  if (isIpLiteral(s)) return { ok: false, error: DOMAIN_MSG.ip };
  if (!s.includes(".") || s === "localhost" || s.endsWith(".localhost") || !DOMAIN_RE.test(s)) return { ok: false, error: DOMAIN_MSG.invalid };
  if (INTERNAL_SUFFIXES.some((x) => s === x || s.endsWith(`.${x}`))) return { ok: false, error: DOMAIN_MSG.internalName };
  if (s === "trycloudflare.com" || s.endsWith(".trycloudflare.com")) return { ok: false, error: DOMAIN_MSG.quick };
  const named = (opts.namedHost ?? "").trim().toLowerCase();
  if (named && named === s) return { ok: false, error: DOMAIN_MSG.named };
  return { ok: true, host: s };
}

export function isValidDomain(host: string): boolean {
  return DOMAIN_RE.test(host) && !isIpLiteral(host);
}

// ================================================================ R35 — Caddy configuration
export interface CaddyConfigInput {
  host: string;
  apiPort: number;
  /** Ingress marker for this Caddy run (hex). */
  marker: string;
  /** Certificate store (forward slashes are fine on Windows). */
  storageDir: string;
  /** Port 80 is taken by another program → 443 only, no redirect, TLS-ALPN challenge only. */
  httpBusy: boolean;
  /** Tests only: a local CA instead of Let's Encrypt, and high ports. */
  issuer?: "acme" | "internal";
  httpPort?: number;
  httpsPort?: number;
}

export function buildCaddyfile(i: CaddyConfigInput): string {
  if (!isValidDomain(i.host)) throw new Error("invalid domain for Caddy config");
  if (!/^[a-f0-9]{16,64}$/.test(i.marker)) throw new Error("invalid ingress marker");
  if (!Number.isInteger(i.apiPort) || i.apiPort < 1 || i.apiPort > 65535) throw new Error("invalid api port");
  const store = i.storageDir.replace(/\\/g, "/");
  if (/["\n\r{}`]/.test(store)) throw new Error("invalid storage dir");
  const g: string[] = [
    "\tadmin off",
    "\tpersist_config off",
    // Never touch the Windows/system certificate store (Caddy would otherwise install its local CA root).
    "\tskip_install_trust",
    "\tgrace_period 2s",
    `\tstorage file_system {\n\t\troot "${store}"\n\t}`,
    "\tservers {\n\t\tprotocols h1 h2\n\t}",
    "\tlog {\n\t\toutput stderr\n\t\tformat json\n\t\tlevel INFO\n\t}",
  ];
  if (i.httpBusy) g.push("\tauto_https disable_redirects");
  if (i.httpPort) g.push(`\thttp_port ${Math.trunc(i.httpPort)}`);
  if (i.httpsPort) g.push(`\thttps_port ${Math.trunc(i.httpsPort)}`);
  const tls = i.issuer === "internal" ? "\ttls internal" : i.httpBusy ? "\ttls {\n\t\tissuer acme {\n\t\t\tdisable_http_challenge\n\t\t}\n\t}" : "";
  const site = [
    `${i.host} {`,
    ...(tls ? [tls] : []),
    "\t@api path /v1/* /mcp /oauth/* /.well-known/oauth-*",
    "\thandle @api {",
    `\t\treverse_proxy 127.0.0.1:${i.apiPort} {`,
    `\t\t\theader_up X-Muse-Ingress ${i.marker}`,
    "\t\t}",
    "\t}",
    "\thandle {",
    "\t\trespond 404",
    "\t}",
    "}",
  ];
  return `# Muse4AI — generated on every start, do not edit\n{\n${g.join("\n")}\n}\n\n${site.join("\n")}\n`;
}

export type CaddyLogEvent =
  | { kind: "started" }
  | { kind: "obtaining" }
  | { kind: "obtained" }
  | { kind: "cert_error"; detail: string }
  | { kind: "bind_error" }
  | { kind: "log"; level: "info" | "warn" };

export function certErrorText(raw: string): string {
  const e = raw.toLowerCase();
  if (/ratelimit|rate limit|too many (certificates|failed authorizations|new orders)/.test(e)) return "Let's Encrypt tạm giới hạn cấp chứng chỉ cho tên miền này — app sẽ thử lại sau";
  if (/nxdomain|no valid a records|dns problem|servfail/.test(e)) return "Let's Encrypt chưa thấy bản ghi DNS của tên miền";
  if (/connection refused|timeout during connect|firewall|connection reset|i\/o timeout/.test(e)) return "Let's Encrypt chưa tới được máy qua cổng 80/443 — kiểm tường lửa";
  if (/unauthorized|invalid response|incorrect validation|caa/.test(e)) return "Let's Encrypt gọi tới máy khác — kiểm bản ghi DNS";
  return "Let's Encrypt chưa cấp chứng chỉ — app sẽ thử lại";
}

/** Reads one line of Caddy's JSON log (stderr). */
export function parseCaddyLog(line: string): CaddyLogEvent {
  let j: { level?: string; msg?: string; error?: string; logger?: string } | null = null;
  try {
    j = JSON.parse(line);
  } catch {
    return { kind: "log", level: /error|panic|fatal/i.test(line) ? "warn" : "info" };
  }
  if (!j || typeof j !== "object") return { kind: "log", level: "info" };
  const msg = String(j.msg ?? "");
  const err = String(j.error ?? "");
  if (/address already in use|only one usage of each socket address|bind: /i.test(`${msg} ${err}`)) return { kind: "bind_error" };
  if (msg === "serving initial configuration") return { kind: "started" };
  if (msg === "obtaining certificate") return { kind: "obtaining" };
  if (msg === "certificate obtained successfully") return { kind: "obtained" };
  if (/could not get certificate from issuer|job failed|obtain/i.test(msg) && (j.level === "error" || j.level === "warn") && err) return { kind: "cert_error", detail: certErrorText(err) };
  return { kind: "log", level: j.level === "error" || j.level === "fatal" || j.level === "panic" ? "warn" : "info" };
}

// ================================================================ R36 — layered check
export type ProbeOutcome = { kind: "http"; status: number; service?: string; instance?: string } | { kind: "error"; code: string; message?: string };
export type ProbeClass = "online" | "other_instance" | "bad_gateway" | "http_other" | "tls" | "unreachable" | "dns" | "error";

const TLS_CODES = /^(ERR_SSL|ERR_TLS|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|EPROTO|ERR_CERT|HOSTNAME_MISMATCH)/;
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "AbortError", "TimeoutError"]);

export function classifyProbe(o: ProbeOutcome, instanceId: string): ProbeClass {
  if (o.kind === "http") {
    if (o.status === 200 && o.service === BRAND.id) return o.instance === instanceId ? "online" : "other_instance";
    if (o.status === 200) return "other_instance";
    if (o.status === 502 || o.status === 503 || o.status === 504) return "bad_gateway";
    return "http_other";
  }
  const m = o.message ?? "";
  if (TLS_CODES.test(o.code) || /certificate|ssl|tls alert|self.signed|net::ERR_CERT|net::ERR_SSL/i.test(m)) return "tls";
  if (UNREACHABLE_CODES.has(o.code) || /net::ERR_(CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED)|TIMED_OUT|ADDRESS_UNREACHABLE|NETWORK_UNREACHABLE)/.test(m)) return "unreachable";
  if (o.code === "ENOTFOUND" || o.code === "EAI_AGAIN" || /net::ERR_NAME_NOT_RESOLVED/.test(m)) return "dns";
  return "error";
}

export type DnsAnswer = { ips: string[] } | { error: string };
export type PortCheck = { state: "running" | "ok" | "warn" | "fail"; detail: string };

export interface DomainRoundInput {
  host: string;
  proxy: ApiDomainProxy;
  apiPort: number;
  instanceId: string;
  dns: DnsAnswer;
  publicIp: string | null;
  /** Managed only: result of the app's port check (null → not checked yet). */
  port: PortCheck | null;
  /** Managed only: last explicit Let's Encrypt error seen in Caddy's log. */
  certError: string | null;
  /** null → the HTTPS check was not run (DNS unusable). */
  probe: ProbeOutcome | null;
}

export interface DomainRound {
  steps: Record<DomainStepKey, DomainStep>;
  online: boolean;
  /** HTTPS check should run (DNS has a public answer). */
  probeAllowed: boolean;
  notes: string[];
}

export function dnsVerdict(dns: DnsAnswer, host: string, publicIp: string | null): { step: DomainStep; probeAllowed: boolean; note: string | null } {
  if ("error" in dns) return { step: { state: "fail", detail: DOMAIN_MSG.dnsError }, probeAllowed: false, note: null };
  const ips = [...new Set(dns.ips)];
  if (!ips.length) return { step: { state: "running", detail: DOMAIN_MSG.dnsNone(host) }, probeAllowed: false, note: null };
  if (ips.some((ip) => isNonPublicIp(ip))) return { step: { state: "fail", detail: DOMAIN_MSG.dnsPrivate }, probeAllowed: false, note: null };
  const list = ips.slice(0, 3).join(", ");
  if (publicIp && !ips.includes(publicIp)) return { step: { state: "warn", detail: `${DOMAIN_MSG.dnsOk(list)} — ${DOMAIN_MSG.dnsOther}` }, probeAllowed: true, note: DOMAIN_MSG.dnsOther };
  return { step: { state: "ok", detail: DOMAIN_MSG.dnsOk(list) }, probeAllowed: true, note: null };
}

export function evaluateDomain(i: DomainRoundInput): DomainRound {
  const notes: string[] = [];
  const dns = dnsVerdict(i.dns, i.host, i.publicIp);
  if (dns.note) notes.push(dns.note);
  const port: DomainStep = i.proxy === "external" ? { state: "skip", detail: null } : i.port ? { state: i.port.state, detail: i.port.detail } : { state: "running", detail: DOMAIN_MSG.portChecking };
  if (i.proxy === "managed" && i.port?.state === "warn") notes.push(DOMAIN_MSG.port80);
  let cert: DomainStep = { state: "pending", detail: null };
  let app: DomainStep = { state: "pending", detail: null };
  if (dns.probeAllowed && i.probe) {
    const c = classifyProbe(i.probe, i.instanceId);
    if (c === "online" || c === "other_instance" || c === "bad_gateway" || c === "http_other") {
      cert = { state: "ok", detail: DOMAIN_MSG.certOk };
      if (c === "online") app = { state: "ok", detail: DOMAIN_MSG.appOk };
      else if (c === "other_instance") app = { state: "fail", detail: DOMAIN_MSG.otherInstance };
      else if (c === "bad_gateway") app = { state: "fail", detail: DOMAIN_MSG.badGateway(i.apiPort) };
      else app = { state: "fail", detail: DOMAIN_MSG.httpOther(i.probe.kind === "http" ? i.probe.status : 0) };
    } else if (c === "tls") {
      if (i.proxy === "external") cert = { state: "fail", detail: DOMAIN_MSG.certExternal };
      else cert = i.certError ? { state: "fail", detail: i.certError } : { state: "running", detail: DOMAIN_MSG.certWaiting };
    } else if (c === "unreachable") {
      cert = { state: "fail", detail: DOMAIN_MSG.unreachable };
    } else if (c === "dns") {
      cert = { state: "fail", detail: DOMAIN_MSG.dnsError };
    } else {
      cert = { state: "fail", detail: DOMAIN_MSG.probeError(i.probe.kind === "error" ? i.probe.message || i.probe.code : "?") };
    }
  }
  return { steps: { dns: dns.step, port, cert, app }, online: app.state === "ok", probeAllowed: dns.probeAllowed, notes };
}

export function emptySteps(proxy: ApiDomainProxy): Record<DomainStepKey, DomainStep> {
  return {
    dns: { state: "pending", detail: null },
    port: proxy === "external" ? { state: "skip", detail: null } : { state: "pending", detail: null },
    cert: { state: "pending", detail: null },
    app: { state: "pending", detail: null },
  };
}

export type CaddyPhase = "off" | "downloading" | "starting" | "running" | "retrying" | "error";

/** Overall domain state from the settings, the app's Caddy and the monitor (R34–R36). */
export function domainState(i: { enabled: boolean; apiListening: boolean; proxy: ApiDomainProxy; caddy: CaddyPhase; rounds: number; online: boolean }): DomainState {
  if (!i.enabled || !i.apiListening) return "off";
  if (i.proxy === "managed") {
    if (i.caddy === "error") return "error";
    if (i.caddy === "downloading" || (i.caddy === "starting" && !i.online) || (i.caddy === "off" && !i.online)) return "preparing";
  }
  if (i.online) return "online";
  if (i.rounds === 0) return "checking";
  return "pending";
}

/** Next check delay (R36): 15 s during the first 10 min while not online, then 60 s; online → 60 s. */
export function nextCheckDelay(i: { online: boolean; sinceStartMs: number; fast: number; slow: number; fastWindow: number }): number {
  if (i.online) return i.slow;
  return i.sinceStartMs < i.fastWindow ? i.fast : i.slow;
}

// ================================================================ R38 — addresses for agents
export function agentUrls(i: {
  domain: { enabled: boolean; host: string; online: boolean } | null;
  tunnel: Pick<TunnelStatus, "state" | "url"> | null;
  lanUrls: string[];
  localUrl: string | null;
}): AgentUrl[] {
  const out: AgentUrl[] = [];
  if (!i.localUrl) return out;
  if (i.domain?.enabled && i.domain.host) out.push({ via: "domain", url: `https://${i.domain.host}`, online: i.domain.online, internet: true });
  if (i.tunnel && i.tunnel.state !== "off" && i.tunnel.url) out.push({ via: "tunnel", url: i.tunnel.url, online: i.tunnel.state === "online", internet: true });
  for (const u of i.lanUrls) out.push({ via: "lan", url: u, online: true, internet: false });
  out.push({ via: "local", url: i.localUrl, online: true, internet: false });
  return out;
}

/** Default: domain → tunnel → LAN → this machine, among usable ones; an Internet address that is not online is never the default. */
export function defaultAgentUrl(urls: AgentUrl[]): AgentUrl | null {
  return urls.find((u) => u.online) ?? null;
}

export const AGENT_VIA_LABEL: Record<AgentUrl["via"], string> = {
  domain: "Tên miền",
  tunnel: "Đường hầm",
  lan: "Mạng riêng",
  local: "Máy này",
};

/** "hh:mm" in local time for "online last at". */
export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Masks a hostname for diagnostics (AC-DOM-18): only the top-level label stays — `api.example.com` → `•••.com`. */
export function maskHost(host: string): string {
  if (!host) return "";
  const parts = host.split(".");
  return `•••.${parts[parts.length - 1] ?? ""}`;
}
