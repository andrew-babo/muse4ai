import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { API_BUCKETS, API_KEY_MAX_ACTIVE, API_KEY_NAME_MAX, API_KEY_TOUCH_MS, API_PORT_MAX, API_PORT_MIN, CADDY_BINARIES, TUNNEL_BINARIES, type ApiBucket } from "../../shared/api/constants";
import { agentUrls, DOMAIN_MSG, domainState, emptySteps, maskHost, normalizeDomain } from "../../shared/api/domain";
import { DUMMY_HASH, keyIdOf, newApiKey, tokenMatches } from "../../shared/api/keys";
import { isPrivateSource, LOOPBACK_NAMES } from "../../shared/api/netPolicy";
import { openApiDocument } from "../../shared/api/openapi";
import { ApiError } from "../../shared/api/problem";
import { RateLimiter } from "../../shared/api/rateLimit";
import { registerSecret } from "../../shared/redact";
import type { ApiAccess, ApiDomainProxy, ApiKeyView, ApiRequestLog, ApiScope, ApiStatus, DomainStatus, Settings, TunnelStatus } from "../../shared/types";
import { CommandError, type Coordinator, type Notice } from "../coordinator";
import { t } from "../../shared/i18n";
import type { JobRow, Repo } from "../repo";
import type { Services } from "../services";
import { CaddyManager, type CaddyDeps } from "./caddy";
import { DomainMonitor, makeHttpsProbe, makePublicIpLookup, type DomainMonitorDeps } from "./domainCheck";
import { McpHandler } from "./mcp";
import { OAuthHttp } from "./oauth/http";
import { loadOrCreateKeyPair } from "./oauth/keys";
import { OAuthService } from "./oauth/service";
import { OAuthStore } from "./oauth/store";
import { ApiServer, type ServerPolicy } from "./server";
import { ApiService, type KeyCtx } from "./service";
import { ApiStore, keyView } from "./store";
import { TunnelManager, type TunnelDeps } from "./tunnel";

// Owns the agent API: settings → HTTP server + tunnel, keys, request log (spec §4.8, F12).

export interface ApiControllerDeps {
  repo: Repo;
  coord: Coordinator;
  services: Services;
  vault: { set(k: string, v: string): void; get(k: string): string | null; delete(k: string): void };
  emit: (type: string, payload: unknown) => void;
  /** Windows toast / in-app notice, so a connection request is visible without opening Settings. */
  notify?: (n: Notice) => void;
  log: (level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>) => void;
  subscribeJobs: (fn: (job: JobRow) => void) => () => void;
  version: string;
  binDir: string;
  now?: () => number;
  /** Tunnel overrides (tests); defaults to the pinned binary for this platform and the global fetch. */
  tunnel?: Partial<Omit<TunnelDeps, "onChange" | "instanceId" | "binDir" | "log">>;
  /** Folder of the app's Caddy (Caddyfile, pid, certificate store); defaults to `<binDir>/../caddy`. */
  caddyDir?: string;
  /** Caddy overrides (tests / Electron net.fetch for the download). */
  caddy?: Partial<Omit<CaddyDeps, "onChange" | "onEvent" | "binDir" | "caddyDir" | "log">>;
  /** Domain check overrides (tests: resolver, public IP, probe, intervals). */
  monitor?: Partial<Omit<DomainMonitorDeps, "instanceId" | "apiPort" | "caddyInfo" | "onChange" | "log">>;
  /** Overrides the 300 ms delay on bad keys (tests). */
  failDelayMs?: number;
  networkInterfaces?: () => ReturnType<typeof os.networkInterfaces>;
}

const VAULT_SIGNING = "api:signing";
const VAULT_TUNNEL_TOKEN = "api:tunnelToken";
const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class ApiController {
  readonly instanceId = randomBytes(12).toString("hex");
  /** Per-run secret on the app's own health checks (never stored, never shown) — keeps them out of the request log. */
  private readonly selfCheckToken = randomBytes(16).toString("hex");
  readonly store: ApiStore;
  readonly service: ApiService;
  readonly tunnel: TunnelManager;
  readonly caddy: CaddyManager;
  readonly monitor: DomainMonitor;
  /** This install's own OAuth 2.1 server: apps connect without an API key being shared (R131–R141). */
  readonly oauth: OAuthService;
  private server: ApiServer;
  private oauthHttp: OAuthHttp;
  private limiter = new RateLimiter<ApiBucket>(API_BUCKETS);
  private signing: Buffer | null = null;
  private listenError: string | null = null;
  /** A free port next to a busy one, offered as a one-click fix (the default port can be taken by another tool). */
  private suggestedPort: number | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private touched = new Map<string, number>();
  private pruneTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private d: ApiControllerDeps) {
    this.store = new ApiStore(d.repo.db);
    // One signing pair per install, kept in the same encrypted vault as the vault secret (R135).
    this.oauth = new OAuthService({
      store: new OAuthStore(d.repo.db),
      keys: loadOrCreateKeyPair(d.vault),
      now: () => this.now(),
      log: (level, msg, data) => d.log(level, "api", msg, data),
      notify: (c) =>
        d.notify?.({
          kind: "oauth",
          title: t("{client} đang xin kết nối", { client: c.clientName }),
          body: t("Mã xác nhận {code} — gõ mã này vào trang xác nhận trong trình duyệt", { code: c.pairing }),
          route: "/settings",
        }),
    });
    this.oauthHttp = new OAuthHttp({
      svc: this.oauth,
      log: (level, msg, data) => d.log(level, "api", msg, data),
    });
    this.service = new ApiService({
      coord: d.coord,
      services: d.services,
      repo: d.repo,
      store: this.store,
      now: () => this.now(),
      version: d.version,
      signingSecret: () => this.signingSecret(),
      subscribe: d.subscribeJobs,
    });
    const mcp = new McpHandler({
      service: this.service,
      version: d.version,
      take: (ctx, bucket) => this.take(ctx.id, bucket),
    });
    this.server = new ApiServer({
      service: this.service,
      mcp,
      store: this.store,
      limiter: this.limiter,
      authenticate: (t, base) => this.authenticate(t, base),
      oauth: this.oauthHttp,
      policy: () => this.policy(),
      instanceId: this.instanceId,
      selfCheckToken: this.selfCheckToken,
      now: () => this.now(),
      openapi: () => openApiDocument(d.version),
      log: (level, msg, data) => d.log(level, "api", msg, data),
      failDelayMs: d.failDelayMs,
    });
    const key = `${process.platform}-${process.arch}`;
    this.tunnel = new TunnelManager({
      binDir: d.binDir,
      binary: TUNNEL_BINARIES[key] ?? null,
      instanceId: this.instanceId,
      selfCheckToken: this.selfCheckToken,
      fetch: globalThis.fetch.bind(globalThis),
      ...d.tunnel,
      log: (level, msg, data) => d.log(level, "tunnel", msg, data),
      onChange: () => this.emitSoon(),
    });
    this.caddy = new CaddyManager({
      binDir: d.binDir,
      caddyDir: d.caddyDir ?? path.join(path.dirname(d.binDir), "caddy"),
      binary: CADDY_BINARIES[key] ?? null,
      fetch: globalThis.fetch.bind(globalThis),
      ...d.caddy,
      log: (level, msg, data) => d.log(level, "caddy", msg, data),
      onChange: () => this.emitSoon(),
      onEvent: () => this.monitor.soon(),
    });
    // The self-check uses Node's fetch (Mozilla CA bundle, no system proxy) so it sees what a remote agent sees.
    const nodeFetch = globalThis.fetch.bind(globalThis);
    this.monitor = new DomainMonitor({
      publicIp: makePublicIpLookup(nodeFetch),
      probe: makeHttpsProbe(nodeFetch, this.selfCheckToken),
      ...d.monitor,
      instanceId: this.instanceId,
      apiPort: () => this.settings().apiPort,
      caddyInfo: () => {
        const c = this.caddy.getStatus();
        return { port: c.port, certError: c.certError, running: c.phase === "running" };
      },
      onChange: () => this.emitSoon(),
      log: (level, msg, data) => d.log(level, "domain", msg, data),
    });
    const token = d.vault.get(VAULT_TUNNEL_TOKEN);
    if (token) registerSecret(token);
    this.tunnel.setHasToken(!!token);
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  private settings(): Settings {
    return this.d.coord.settings();
  }

  private signingSecret(): Buffer {
    if (this.signing) return this.signing;
    let v = this.d.vault.get(VAULT_SIGNING);
    if (!v) {
      v = randomBytes(32).toString("base64");
      this.d.vault.set(VAULT_SIGNING, v);
    }
    registerSecret(v);
    this.signing = Buffer.from(v, "base64");
    return this.signing;
  }

  private take(subject: string, bucket: ApiBucket): void {
    const r = this.limiter.take(subject, bucket, this.now());
    if (!r.ok) {
      // Same error shape as the HTTP layer; MCP turns it into an isError tool result.
      throw new ApiError(429, "rate_limited", `Gọi quá nhanh — thử lại sau ${r.retryAfterS} giây`, { retryAfterS: r.retryAfterS });
    }
  }

  // ================================================================ lifecycle
  /** App start: stop a leftover tunnel of ours, prune the request log, bring the API back as configured (AC-API-22). */
  async init(): Promise<void> {
    await this.tunnel.cleanupOrphan().catch(() => "none");
    await this.caddy.cleanupOrphan().catch(() => "none");
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), 6 * 3600_000);
    this.pruneTimer.unref?.();
    await this.apply();
  }

  private prune(): void {
    try {
      const gone = this.oauth.prune(this.now());
      if (gone) this.d.log("info", "api", "oauth rows pruned", { removed: gone });
    } catch (e) {
      this.d.log("warn", "api", "oauth prune failed", { error: String(e) });
    }
    try {
      const n = this.store.pruneRequests(this.now());
      if (n) this.d.log("info", "api", "request log pruned", { removed: n });
      this.limiter.sweep(this.now());
    } catch (e) {
      this.d.log("warn", "api", "request log prune failed", { error: String(e) });
    }
  }

  /** Graceful stop (quit): tunnel and port closed within ~3 s. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.monitor.stop();
    await Promise.all([this.tunnel.stop(), this.caddy.stop(), this.server.close()]);
  }

  /** Last-resort synchronous stop (process exiting). */
  killNow(): void {
    this.monitor.stop();
    this.tunnel.killNow();
    this.caddy.killNow();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Makes the server and tunnel match the saved settings. Serialised. */
  apply(): Promise<ApiStatus> {
    return this.serial(async () => {
      const s = this.settings();
      if (!s.apiEnabled || this.stopped) {
        this.monitor.stop();
        await Promise.all([this.tunnel.stop(), this.caddy.stop(), this.server.close()]);
        this.listenError = null;
        this.suggestedPort = null;
        this.emitNow();
        return this.status();
      }
      const wantHost = s.apiAccess === "lan" ? "::" : "127.0.0.1";
      const cur = this.server.address();
      if (!cur || cur.port !== s.apiPort || (cur.host === "127.0.0.1") !== (wantHost === "127.0.0.1")) {
        await this.tunnel.stop();
        await this.server.close();
        this.listenError = await this.listen(wantHost, s.apiPort);
      }
      if (this.server.listening && (s.apiAccess === "cloudflare_quick" || s.apiAccess === "cloudflare_named")) {
        const token = s.apiAccess === "cloudflare_named" ? (this.d.vault.get(VAULT_TUNNEL_TOKEN) ?? undefined) : undefined;
        this.tunnel.start({ mode: s.apiAccess === "cloudflare_quick" ? "quick" : "named", originPort: s.apiPort, hostname: s.apiAccess === "cloudflare_named" ? s.apiNamedHost : undefined, token });
      } else {
        await this.tunnel.stop();
      }
      await this.applyDomain(s);
      this.emitNow();
      return this.status();
    });
  }

  /** R34 — the domain is a second, independent way in: never touches the tunnel and vice versa. */
  private async applyDomain(s: Settings): Promise<void> {
    const on = s.apiDomainEnabled && !!s.apiDomainHost && this.server.listening;
    if (!on) {
      this.monitor.stop();
      await this.caddy.stop();
      return;
    }
    if (s.apiDomainProxy === "managed") this.caddy.start({ host: s.apiDomainHost, apiPort: s.apiPort });
    else await this.caddy.stop();
    this.monitor.start({ host: s.apiDomainHost, proxy: s.apiDomainProxy });
  }

  private async listen(host: string, port: number): Promise<string | null> {
    this.suggestedPort = null;
    try {
      await this.server.listen(host, port);
      this.d.log("info", "api", "listening", { host, port });
      return null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (host === "::" && (code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL")) return this.listen("0.0.0.0", port);
      this.d.log("warn", "api", "listen failed", { host, port, code });
      if (code === "EADDRINUSE" || code === "EACCES") this.suggestedPort = await findFreePort(host, port);
      const hint = this.suggestedPort ? `dùng cổng trống ${this.suggestedPort}` : "đổi cổng khác";
      if (code === "EADDRINUSE") return `Cổng ${port} đang bị chương trình khác dùng — ${hint}`;
      if (code === "EACCES") return `Windows không cho mở cổng ${port} (cổng bị giữ chỗ) — ${hint}`;
      return `Không mở được cổng ${port} (${code ?? "lỗi"})`;
    }
  }

  // ================================================================ commands (IPC)
  async setEnabled(on: boolean): Promise<ApiStatus> {
    this.d.coord.setSetting("apiEnabled", on);
    return this.apply();
  }

  async setPort(port: number): Promise<ApiStatus> {
    if (!Number.isInteger(port) || port < API_PORT_MIN || port > API_PORT_MAX) throw new CommandError(`Cổng phải từ ${API_PORT_MIN} đến ${API_PORT_MAX}`);
    this.d.coord.setSetting("apiPort", port);
    return this.apply();
  }

  /** R29 — switching to an Internet mode needs an explicit confirmation from the UI. */
  async setAccess(access: ApiAccess, confirmInternet: boolean): Promise<ApiStatus> {
    const internet = access === "cloudflare_quick" || access === "cloudflare_named";
    if (internet && !confirmInternet) throw new CommandError("Cần xác nhận trước khi mở ra Internet", "confirm");
    this.d.coord.setSetting("apiAccess", access);
    return this.apply();
  }

  async setNamedTunnel(input: { hostname: string; token?: string | null }): Promise<ApiStatus> {
    const host = input.hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!HOST_RE.test(host)) throw new CommandError("Tên miền không hợp lệ (ví dụ: muse.tenmiencuaanh.com)");
    const domainHost = this.settings().apiDomainHost;
    if (domainHost && domainHost === host) throw new CommandError(DOMAIN_MSG.sameAsDomain);
    if (input.token !== undefined && input.token !== null) {
      const t = input.token.trim();
      if (t.length < 20 || t.length > 4096 || /\s/.test(t)) throw new CommandError("Token đường hầm không hợp lệ — dán nguyên chuỗi token từ Cloudflare");
      registerSecret(t);
      this.d.vault.set(VAULT_TUNNEL_TOKEN, t);
      this.tunnel.setHasToken(true);
    }
    this.d.coord.setSetting("apiNamedHost", host);
    return this.apply();
  }

  async clearTunnelToken(): Promise<ApiStatus> {
    this.d.vault.delete(VAULT_TUNNEL_TOKEN);
    this.tunnel.setHasToken(false);
    return this.apply();
  }

  retryTunnel(): ApiStatus {
    this.tunnel.retry();
    return this.status();
  }

  /**
   * R34 — save/enable/disable the domain. Enabling (or changing host/kind while enabled) needs the Internet
   * confirmation; every refusal happens before anything is saved.
   */
  async setDomain(input: { enabled: boolean; host?: string; proxy?: ApiDomainProxy; confirmInternet?: boolean }): Promise<ApiStatus> {
    const s = this.settings();
    let host = s.apiDomainHost;
    let proxy = s.apiDomainProxy;
    if (input.host !== undefined && input.host.trim() === "" && !input.enabled) {
      // Turning the domain off with an empty field forgets the saved name (nothing left to expose).
      host = "";
    } else if (input.host !== undefined) {
      const n = normalizeDomain(input.host, { namedHost: s.apiNamedHost });
      if (!n.ok) throw new CommandError(n.error);
      host = n.host;
    }
    if (input.proxy !== undefined) {
      if (input.proxy !== "managed" && input.proxy !== "external") throw new CommandError("Kiểu proxy không hợp lệ");
      proxy = input.proxy;
    }
    if (input.enabled) {
      if (!host) throw new CommandError(DOMAIN_MSG.empty);
      if (!s.apiEnabled) throw new CommandError(DOMAIN_MSG.needApi);
      const exposes = !s.apiDomainEnabled || host !== s.apiDomainHost || proxy !== s.apiDomainProxy;
      if (exposes && !input.confirmInternet) throw new CommandError("Cần xác nhận trước khi mở ra Internet", "confirm");
    }
    if (host !== s.apiDomainHost) this.d.coord.setSetting("apiDomainHost", host);
    if (proxy !== s.apiDomainProxy) this.d.coord.setSetting("apiDomainProxy", proxy);
    if (input.enabled !== s.apiDomainEnabled) this.d.coord.setSetting("apiDomainEnabled", input.enabled);
    this.d.log("info", "api", "domain settings", { enabled: input.enabled, proxy });
    return this.apply();
  }

  /** "Thử lại" after a Caddy error (hash, port, gave up) — also checks again right away. */
  domainRetry(): ApiStatus {
    this.caddy.retry();
    void this.monitor.checkNow();
    return this.status();
  }

  /** "Kiểm lại ngay". */
  async domainCheck(): Promise<ApiStatus> {
    await this.monitor.checkNow();
    return this.status();
  }

  createKey(nameRaw: string, scope: ApiScope): { key: ApiKeyView; token: string } {
    const name = nameRaw.trim().replace(/\s+/g, " ");
    if (!name) throw new CommandError("Đặt tên cho khoá (ví dụ “Agent n8n”)");
    if ([...name].length > API_KEY_NAME_MAX) throw new CommandError(`Tên khoá tối đa ${API_KEY_NAME_MAX} ký tự`);
    if (scope !== "generate" && scope !== "read") throw new CommandError("Quyền không hợp lệ");
    if (this.store.activeKeys().length >= API_KEY_MAX_ACTIVE) throw new CommandError(`Tối đa ${API_KEY_MAX_ACTIVE} khoá còn hiệu lực — thu hồi bớt khoá cũ`);
    if (this.store.activeNameTaken(name)) throw new CommandError("Đã có khoá cùng tên");
    let k = newApiKey();
    while (this.store.getKey(k.id)) k = newApiKey();
    const row = this.store.insertKey({ id: k.id, name, scope, tokenSha256: k.hash, now: this.now() });
    this.d.log("info", "api", "key created", { keyId: row.id, scope });
    this.emitNow();
    return { key: keyView(row), token: k.token };
  }

  revokeKey(id: string): ApiStatus {
    if (!this.store.revokeKey(id, this.now())) throw new CommandError("Khoá không còn hoặc đã thu hồi");
    this.limiter.forget(id);
    this.d.log("info", "api", "key revoked", { keyId: id });
    this.emitNow();
    return this.status();
  }

  /** Cuts an app off: its own entry and every token it holds (R139). */
  revokeClient(id: string): ApiStatus {
    this.oauth.revokeClient(id);
    return this.status();
  }

  /** Closes a waiting connection request straight from the app window. */
  dismissConsent(id: string): ApiStatus {
    this.oauth.dismiss(id);
    return this.status();
  }

  requestLog(limit = 50): ApiRequestLog[] {
    return this.store.recentRequests(Math.max(1, Math.min(200, limit)));
  }

  // ================================================================ auth & policy
  authenticate(token: string, base?: string): KeyCtx | null {
    const id = keyIdOf(token);
    const key = id ? this.store.getKey(id) : null;
    const ok = tokenMatches(token, key?.tokenSha256 ?? DUMMY_HASH);
    // Not a key this app issued: it may still be an OAuth access token from this install (R136).
    if (!ok || !key || key.revokedAt !== null) return base ? this.oauth.context(token, base) : null;
    const now = this.now();
    if (now - (this.touched.get(key.id) ?? 0) > API_KEY_TOUCH_MS) {
      this.touched.set(key.id, now);
      this.store.touchKey(key.id, now);
      this.emitSoon();
    }
    return { id: key.id, name: key.name, scope: key.scope };
  }

  private lanAddresses(): string[] {
    const out: string[] = [];
    const ifs = (this.d.networkInterfaces ?? os.networkInterfaces)();
    for (const list of Object.values(ifs)) {
      for (const a of list ?? []) {
        if (a.internal) continue;
        out.push(a.address.split("%")[0].toLowerCase());
      }
    }
    return out;
  }

  private policy(): ServerPolicy {
    const s = this.settings();
    const lan = s.apiAccess === "lan";
    const publicHosts = s.apiAccess === "cloudflare_quick" || s.apiAccess === "cloudflare_named" ? this.tunnel.publicHosts() : [];
    const domainHosts = s.apiDomainEnabled && s.apiDomainHost ? [s.apiDomainHost] : [];
    return {
      access: s.apiAccess,
      port: s.apiPort,
      localNames: lan ? [...LOOPBACK_NAMES, ...this.lanAddresses()] : LOOPBACK_NAMES,
      machineName: lan ? os.hostname() : null,
      publicHosts,
      domainHosts,
      domainProxy: s.apiDomainProxy,
      domainMarker: s.apiDomainProxy === "managed" ? this.caddy.marker() : null,
    };
  }

  private domainStatus(s: Settings, listening: boolean): DomainStatus {
    const c = this.caddy.getStatus();
    const m = this.monitor.snapshot();
    const proxy = s.apiDomainProxy;
    const managed = proxy === "managed";
    const state = domainState({ enabled: s.apiDomainEnabled && !!s.apiDomainHost, apiListening: listening, proxy, caddy: c.phase, rounds: m.rounds, online: m.online });
    const steps = state === "off" ? emptySteps(proxy) : { ...m.steps };
    const notes = state === "off" ? [] : [...m.notes];
    if (state !== "off" && managed) {
      steps.port = c.port ? { state: c.port.state, detail: c.port.detail } : { state: "running", detail: DOMAIN_MSG.portChecking };
      if (c.port?.state === "warn" && !notes.includes(DOMAIN_MSG.port80)) notes.push(DOMAIN_MSG.port80);
      if (c.phase !== "running") {
        steps.cert = { state: "pending", detail: null };
        steps.app = { state: "pending", detail: null };
      } else if (steps.cert.state === "pending" && c.certObtaining && m.steps.dns.state !== "fail") steps.cert = { state: "running", detail: DOMAIN_MSG.certWaiting };
    }
    return {
      enabled: s.apiDomainEnabled,
      host: s.apiDomainHost,
      proxy,
      state,
      progress: managed && c.phase === "downloading" ? c.progress : null,
      url: state === "online" ? `https://${s.apiDomainHost}` : null,
      error: managed && state !== "off" && (c.phase === "error" || c.phase === "retrying") ? c.error : null,
      steps,
      notes,
      publicIp: m.publicIp,
      dnsIps: m.dnsIps,
      checkedAt: state === "off" ? null : m.checkedAt,
      lastOnlineAt: m.lastOnlineAt,
      attempt: managed ? c.attempt : 0,
      caddyPath: this.caddy.exePath,
    };
  }

  status(): ApiStatus {
    const s = this.settings();
    const addr = this.server.address();
    const tunnel: TunnelStatus = this.tunnel.getStatus();
    const lanUrls =
      addr && s.apiAccess === "lan"
        ? this.lanAddresses()
            .filter((ip) => !ip.includes(":") && isPrivateSource(ip))
            .map((ip) => `http://${ip}:${addr.port}`)
        : [];
    const localUrl = addr ? `http://127.0.0.1:${addr.port}` : null;
    const domain = this.domainStatus(s, !!addr);
    return {
      enabled: s.apiEnabled,
      port: s.apiPort,
      access: s.apiAccess,
      listening: !!addr,
      localUrl,
      lanUrls,
      error: s.apiEnabled ? this.listenError : null,
      suggestedPort: s.apiEnabled && this.listenError ? this.suggestedPort : null,
      namedHost: s.apiNamedHost,
      tunnel,
      domain,
      urls: agentUrls({ domain: domain.state === "off" ? null : { enabled: true, host: domain.host, online: domain.state === "online" }, tunnel, lanUrls, localUrl }),
      keys: this.store.listKeys().map(keyView),
      oauth: { pending: this.oauth.pending(), clients: this.oauth.clients() },
    };
  }

  /** For the diagnostics bundle: no keys, no token, tunnel hostname masked. */
  diagnostics(): Record<string, unknown> {
    const st = this.status();
    return {
      enabled: st.enabled,
      access: st.access,
      port: st.port,
      listening: st.listening,
      error: st.error,
      tunnel: { state: st.tunnel.state, error: st.tunnel.error, attempt: st.tunnel.attempt, url: st.tunnel.url ? st.tunnel.url.replace(/^https:\/\/[^.]+/, "https://•••") : null, hasToken: st.tunnel.hasToken },
      // AC-DOM-18 — domain and public IP masked; step details (may contain IPs) left out.
      domain: {
        enabled: st.domain.enabled,
        proxy: st.domain.proxy,
        state: st.domain.state,
        host: st.domain.host ? maskHost(st.domain.host) : "",
        steps: Object.fromEntries(Object.entries(st.domain.steps).map(([k, v]) => [k, v.state])),
        error: st.domain.error,
        attempt: st.domain.attempt,
        publicIp: st.domain.publicIp ? "•••" : null,
      },
      keysActive: st.keys.filter((k) => !k.revokedAt).length,
      keysRevoked: st.keys.filter((k) => k.revokedAt).length,
      requestLogRows: this.store.countRequests(),
      // Counts only: names, hosts and confirmation codes stay out of the bundle.
      oauthApps: st.oauth.clients.length,
      oauthPending: st.oauth.pending.length,
      waitsInFlight: this.service.waitsInFlight(),
    };
  }

  private emitNow(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    try {
      this.d.emit("api", this.status());
    } catch (e) {
      // The store can already be closed while the app exits.
      this.d.log("warn", "api", "status event skipped", { error: String(e) });
    }
  }

  private emitSoon(): void {
    if (this.emitTimer || this.stopped) return;
    this.emitTimer = setTimeout(() => this.emitNow(), 150);
    this.emitTimer.unref?.();
  }
}

/** First port after `from` (up to 50 tries) that this machine lets us open on `host`; null when none is free. */
export async function findFreePort(host: string, from: number, tries = 50): Promise<number | null> {
  for (let p = from + 1; p <= Math.min(API_PORT_MAX, from + tries); p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen({ host, port: p, exclusive: true }, () => srv.close(() => resolve(true)));
    });
    if (free) return p;
  }
  return null;
}
