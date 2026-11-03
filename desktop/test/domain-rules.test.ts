import { describe, expect, it } from "vitest";
import { CADDY_BINARIES } from "../src/shared/api/constants";
import {
  agentUrls,
  buildCaddyfile,
  certErrorText,
  classifyProbe,
  defaultAgentUrl,
  DOMAIN_MSG,
  domainState,
  evaluateDomain,
  maskHost,
  nextCheckDelay,
  normalizeDomain,
  parseCaddyLog,
  type DomainRoundInput,
} from "../src/shared/api/domain";
import { checkHost, isNonPublicIp } from "../src/shared/api/netPolicy";
import { agentTemplates, pickAgentUrl } from "../src/renderer/lib/agentTemplates";

// Spec rev 5 R34–R38 pure rules, with the values written in the spec.

describe("R34 — domain input (AC-DOM-02)", () => {
  it("normalises a pasted URL to the bare lowercase host", () => {
    expect(normalizeDomain("https://Muse.Example.com/v1/")).toEqual({ ok: true, host: "muse.example.com" });
    expect(normalizeDomain("  api.tenmiencuaanh.com.  ")).toEqual({ ok: true, host: "api.tenmiencuaanh.com" });
    expect(normalizeDomain("muse.example.com:443")).toEqual({ ok: true, host: "muse.example.com" });
  });

  it("refuses an IP address with the spec message", () => {
    expect(normalizeDomain("203.0.113.7")).toEqual({ ok: false, error: "Nhập tên miền, không nhập địa chỉ IP" });
    expect(normalizeDomain("http://203.0.113.7:443/")).toEqual({ ok: false, error: DOMAIN_MSG.ip });
    expect(normalizeDomain("[2001:db8::1]")).toEqual({ ok: false, error: DOMAIN_MSG.ip });
  });

  it("refuses localhost and names without a dot", () => {
    expect(normalizeDomain("localhost")).toEqual({ ok: false, error: "Tên miền không hợp lệ" });
    expect(normalizeDomain("muse")).toEqual({ ok: false, error: DOMAIN_MSG.invalid });
    expect(normalizeDomain("muse.example.com:8443")).toEqual({ ok: false, error: DOMAIN_MSG.invalid });
    expect(normalizeDomain("bad_label.example.com")).toEqual({ ok: false, error: DOMAIN_MSG.invalid });
    expect(normalizeDomain("muse.example.123")).toEqual({ ok: false, error: DOMAIN_MSG.invalid });
  });

  it("refuses internal names nobody on the Internet can resolve (rev 5.1)", () => {
    for (const n of ["muse.local", "api.muse.internal", "muse.home.arpa", "api.test", "muse.lan"]) expect(normalizeDomain(n)).toEqual({ ok: false, error: "Tên miền nội bộ (.local, .internal…) — máy trên Internet không tới được" });
    expect(normalizeDomain("api.localhost.com")).toEqual({ ok: true, host: "api.localhost.com" });
  });

  it("refuses a quick-tunnel address", () => {
    expect(normalizeDomain("abc-def.trycloudflare.com")).toEqual({ ok: false, error: "Đây là địa chỉ đường hầm tạm thời, không dùng làm tên miền" });
  });

  it("refuses the hostname of the saved named tunnel", () => {
    expect(normalizeDomain("tunnel.example.com", { namedHost: "tunnel.example.com" })).toEqual({ ok: false, error: "Tên miền này đang dùng cho đường hầm có tên — dùng tên khác (ví dụ api.… và tunnel.…)" });
    expect(normalizeDomain("api.example.com", { namedHost: "tunnel.example.com" })).toEqual({ ok: true, host: "api.example.com" });
  });
});

describe("R33 — Host for the domain way in", () => {
  const p = { port: 47821, local: ["127.0.0.1", "localhost", "::1"], public: ["quiet-river.trycloudflare.com"], domain: ["muse.example.com"] };
  it("accepts the domain without port or with :443 and labels it domain", () => {
    expect(checkHost("muse.example.com", p)).toEqual({ ok: true, via: "domain" });
    expect(checkHost("MUSE.example.com:443", p)).toEqual({ ok: true, via: "domain" });
    expect(checkHost("quiet-river.trycloudflare.com", p)).toEqual({ ok: true, via: "public" });
  });
  it("refuses the domain on another port and other hosts", () => {
    expect(checkHost("muse.example.com:47821", p).ok).toBe(false);
    expect(checkHost("other.example.com", p).ok).toBe(false);
    expect(checkHost("muse.example.com", { ...p, domain: [] }).ok).toBe(false);
  });
});

describe("R35 — pinned Caddy 2.11.7 and generated configuration (AC-DOM-04c)", () => {
  it("pins the Windows ZIP and caddy.exe by SHA-256", () => {
    expect(CADDY_BINARIES["win32-x64"]).toMatchObject({
      archiveSha256: "0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06",
      sha256: "5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a",
      entry: "caddy.exe",
    });
    expect(CADDY_BINARIES["win32-x64"].url).toBe("https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_windows_amd64.zip");
  });

  const cfg = buildCaddyfile({ host: "muse.example.com", apiPort: 47822, marker: "a".repeat(32), storageDir: "C:\\Users\\Anh\\AppData\\Local\\MuseStudio\\caddy\\data", httpBusy: false });
  it("admin off, no persisted config, h1/h2 only, 2 s grace, store inside the app folder", () => {
    expect(cfg).toContain("\tadmin off");
    expect(cfg).toContain("\tpersist_config off");
    expect(cfg).toContain("\tskip_install_trust");
    expect(cfg).toContain("protocols h1 h2");
    expect(cfg).toContain("grace_period 2s");
    expect(cfg).toContain('root "C:/Users/Anh/AppData/Local/MuseStudio/caddy/data"');
  });
  it("forwards /v1/*, /mcp and the OAuth paths to loopback with the marker, everything else 404, no CORS", () => {
    expect(cfg).toContain("muse.example.com {");
    expect(cfg).toContain("@api path /v1/* /mcp /oauth/* /.well-known/oauth-*");
    expect(cfg).toContain("reverse_proxy 127.0.0.1:47822");
    expect(cfg).toContain(`header_up X-Muse-Ingress ${"a".repeat(32)}`);
    expect(cfg).toContain("respond 404");
    expect(cfg).not.toMatch(/Access-Control|header_down|Origin/i);
    expect(cfg).not.toContain("auto_https disable_redirects");
    expect(cfg).not.toContain("tls internal");
  });
  it("port 80 busy → 443 only: no redirect, TLS-ALPN challenge only (AC-DOM-05b)", () => {
    const busy = buildCaddyfile({ host: "muse.example.com", apiPort: 47822, marker: "b".repeat(32), storageDir: "/tmp/x", httpBusy: true });
    expect(busy).toContain("auto_https disable_redirects");
    expect(busy).toContain("disable_http_challenge");
  });
  it("cannot be tricked into extra Caddy directives", () => {
    expect(() => buildCaddyfile({ host: "muse.example.com {\n admin :2019", apiPort: 1, marker: "a".repeat(32), storageDir: "/tmp", httpBusy: false })).toThrow();
    expect(() => buildCaddyfile({ host: "muse.example.com", apiPort: 1, marker: "not-hex", storageDir: "/tmp", httpBusy: false })).toThrow();
    expect(() => buildCaddyfile({ host: "muse.example.com", apiPort: 1, marker: "a".repeat(32), storageDir: '/tmp"}', httpBusy: false })).toThrow();
  });
});

describe("Caddy log lines", () => {
  it("recognises start, obtaining, obtained, bind errors and Let's Encrypt errors", () => {
    expect(parseCaddyLog('{"level":"info","msg":"serving initial configuration"}')).toEqual({ kind: "started" });
    expect(parseCaddyLog('{"level":"info","logger":"tls.obtain","msg":"obtaining certificate","identifier":"x"}')).toEqual({ kind: "obtaining" });
    expect(parseCaddyLog('{"level":"info","logger":"tls.obtain","msg":"certificate obtained successfully"}')).toEqual({ kind: "obtained" });
    expect(parseCaddyLog('{"level":"error","msg":"run: loading initial config: listen tcp :443: bind: address already in use"}')).toEqual({ kind: "bind_error" });
    expect(parseCaddyLog('{"level":"error","logger":"tls.obtain","msg":"could not get certificate from issuer","error":"HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates"}')).toEqual({
      kind: "cert_error",
      detail: "Let's Encrypt tạm giới hạn cấp chứng chỉ cho tên miền này — app sẽ thử lại sau",
    });
    expect(certErrorText("Timeout during connect (likely firewall problem)")).toBe("Let's Encrypt chưa tới được máy qua cổng 80/443 — kiểm tường lửa");
  });
});

describe("R36 — layered check (AC-DOM-06)", () => {
  const base: DomainRoundInput = { host: "muse.example.com", proxy: "managed", apiPort: 47822, instanceId: "inst-1", dns: { ips: ["203.0.113.7"] }, publicIp: "203.0.113.7", port: { state: "ok", detail: DOMAIN_MSG.portOk }, certError: null, probe: null };
  it("no DNS record → waiting, no HTTPS call allowed", () => {
    const r = evaluateDomain({ ...base, dns: { ips: [] } });
    expect(r.steps.dns).toEqual({ state: "running", detail: "Chưa thấy bản ghi DNS cho muse.example.com" });
    expect(r.probeAllowed).toBe(false);
    expect(r.online).toBe(false);
  });
  it("DNS pointing inside (10.1.2.3) → error and no HTTPS call", () => {
    const r = evaluateDomain({ ...base, dns: { ips: ["10.1.2.3"] } });
    expect(r.steps.dns).toEqual({ state: "fail", detail: "Tên miền trỏ tới địa chỉ nội bộ — máy trên Internet không tới được" });
    expect(r.probeAllowed).toBe(false);
  });
  it("DNS pointing to another IP → warning, still checked", () => {
    const r = evaluateDomain({ ...base, dns: { ips: ["198.51.100.9"] }, probe: { kind: "http", status: 200, service: "muse4ai", instance: "inst-1" } });
    expect(r.steps.dns.state).toBe("warn");
    expect(r.notes).toContain(DOMAIN_MSG.dnsOther);
    expect(r.probeAllowed).toBe(true);
    expect(r.online).toBe(true);
  });
  it("refused → port 443 not reachable from outside", () => {
    expect(evaluateDomain({ ...base, probe: { kind: "error", code: "ECONNREFUSED" } }).steps.cert).toEqual({ state: "fail", detail: "Máy khác chưa tới được cổng 443 — kiểm tường lửa nhà cung cấp và tường lửa Windows" });
  });
  it("TLS error → waiting for the certificate (or the explicit Let's Encrypt error)", () => {
    expect(evaluateDomain({ ...base, probe: { kind: "error", code: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR" } }).steps.cert).toEqual({ state: "running", detail: "Đang chờ chứng chỉ" });
    expect(evaluateDomain({ ...base, certError: "Let's Encrypt chưa thấy bản ghi DNS của tên miền", probe: { kind: "error", code: "CERT_HAS_EXPIRED" } }).steps.cert.state).toBe("fail");
  });
  it("other instance / 502 / our instance", () => {
    expect(evaluateDomain({ ...base, probe: { kind: "http", status: 200, service: "muse4ai", instance: "other" } }).steps.app).toEqual({ state: "fail", detail: "Tên miền đang trỏ tới máy hoặc app khác" });
    expect(evaluateDomain({ ...base, probe: { kind: "http", status: 502 } }).steps.app).toEqual({ state: "fail", detail: "Proxy chạy nhưng không tới được app (API trên cổng 47822)" });
    const ok = evaluateDomain({ ...base, probe: { kind: "http", status: 200, service: "muse4ai", instance: "inst-1" } });
    expect(ok.online).toBe(true);
    expect(ok.steps.cert.state).toBe("ok");
    expect(ok.steps.app.state).toBe("ok");
  });
  it("external proxy: the port step is skipped", () => {
    expect(evaluateDomain({ ...base, proxy: "external", port: null }).steps.port.state).toBe("skip");
  });
  it("classifies Electron-style network errors too", () => {
    expect(classifyProbe({ kind: "error", code: "Error", message: "net::ERR_CERT_AUTHORITY_INVALID" }, "x")).toBe("tls");
    expect(classifyProbe({ kind: "error", code: "Error", message: "net::ERR_CONNECTION_REFUSED" }, "x")).toBe("unreachable");
    expect(classifyProbe({ kind: "error", code: "TimeoutError" }, "x")).toBe("unreachable");
  });
  it("internal ranges listed in R36 are never public", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "169.254.1.1", "0.1.2.3", "::1", "fc00::1", "fe80::1"]) expect(isNonPublicIp(ip)).toBe(true);
    for (const ip of ["203.0.113.7", "198.51.100.9", "2001:4860::8888"]) expect(isNonPublicIp(ip)).toBe(false);
  });
  it("check rhythm: 15 s for the first 10 min while not online, then 60 s; online → 60 s", () => {
    const iv = { fast: 15_000, slow: 60_000, fastWindow: 600_000 };
    expect(nextCheckDelay({ online: false, sinceStartMs: 0, ...iv })).toBe(15_000);
    expect(nextCheckDelay({ online: false, sinceStartMs: 600_001, ...iv })).toBe(60_000);
    expect(nextCheckDelay({ online: true, sinceStartMs: 0, ...iv })).toBe(60_000);
  });
});

describe("overall domain state", () => {
  const s = { enabled: true, apiListening: true, proxy: "managed" as const, caddy: "running" as const, rounds: 1, online: false };
  it("off / preparing / checking / pending / online / error", () => {
    expect(domainState({ ...s, enabled: false })).toBe("off");
    expect(domainState({ ...s, apiListening: false })).toBe("off");
    expect(domainState({ ...s, caddy: "downloading" })).toBe("preparing");
    expect(domainState({ ...s, rounds: 0 })).toBe("checking");
    expect(domainState(s)).toBe("pending");
    expect(domainState({ ...s, online: true })).toBe("online");
    expect(domainState({ ...s, caddy: "error" })).toBe("error");
    expect(domainState({ ...s, proxy: "external", caddy: "off", online: true })).toBe("online");
  });
});

describe("R38 — addresses for agents (AC-DOM-17)", () => {
  const urls = agentUrls({
    domain: { enabled: true, host: "muse.example.com", online: false },
    tunnel: { state: "online", url: "https://quiet-river.trycloudflare.com" },
    lanUrls: [],
    localUrl: "http://127.0.0.1:47822",
  });
  it("lists domain, tunnel, this machine in that order", () => {
    expect(urls.map((u) => u.via)).toEqual(["domain", "tunnel", "local"]);
    expect(urls[0]).toEqual({ via: "domain", url: "https://muse.example.com", online: false, internet: true });
  });
  it("default skips the domain that is not online → tunnel", () => {
    expect(defaultAgentUrl(urls)?.url).toBe("https://quiet-river.trycloudflare.com");
    expect(pickAgentUrl(urls, null, 47822).url).toBe("https://quiet-river.trycloudflare.com");
  });
  it("domain online → domain is the default", () => {
    const u2 = agentUrls({ domain: { enabled: true, host: "muse.example.com", online: true }, tunnel: { state: "online", url: "https://quiet-river.trycloudflare.com" }, lanUrls: [], localUrl: "http://127.0.0.1:47822" });
    expect(defaultAgentUrl(u2)?.url).toBe("https://muse.example.com");
  });
  it("picking the domain keeps it even if not online; templates include Python, Codex CLI, Gemini CLI with that address", () => {
    const cur = pickAgentUrl(urls, "https://muse.example.com", 47822);
    expect(cur.url).toBe("https://muse.example.com");
    const list = agentTemplates(cur.url, "msk_test");
    const labels = list.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(["Python", "Codex CLI", "Gemini CLI", "Claude Code", "Cursor", "VS Code", "Claude Desktop", "OpenAI", "n8n", "curl"]));
    for (const id of ["python", "codex", "gemini"]) expect(list.find((t) => t.id === id)!.code).toContain("https://muse.example.com");
    expect(list.find((t) => t.id === "codex")!.code).toContain("--bearer-token-env-var MUSE_API_KEY");
    expect(list.find((t) => t.id === "gemini")!.code).toContain('"httpUrl": "https://muse.example.com/mcp"');
  });
  it("API off → no address at all", () => {
    expect(agentUrls({ domain: null, tunnel: null, lanUrls: [], localUrl: null })).toEqual([]);
  });
});

describe("diagnostics masking (AC-DOM-18)", () => {
  it("keeps only the top-level label", () => {
    expect(maskHost("api.tenmiencuaanh.com")).toBe("•••.com");
    expect(maskHost("203-0-113-7.sslip.io")).toBe("•••.io");
  });
});
