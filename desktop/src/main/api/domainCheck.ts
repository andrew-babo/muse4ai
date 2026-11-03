import dns from "node:dns";
import {
  DNS_SERVERS,
  DNS_TIMEOUT_MS,
  DOMAIN_FAST_INTERVAL_MS,
  DOMAIN_FAST_WINDOW_MS,
  DOMAIN_PROBE_TIMEOUT_MS,
  DOMAIN_SLOW_INTERVAL_MS,
  PUBLIC_FAIL_THRESHOLD,
  PUBLIC_IP_CACHE_MS,
  PUBLIC_IP_URLS,
  selfCheckHeaders,
} from "../../shared/api/constants";
import {
  DOMAIN_MSG,
  dnsVerdict,
  emptySteps,
  evaluateDomain,
  hhmm,
  nextCheckDelay,
  type DnsAnswer,
  type PortCheck,
  type ProbeOutcome,
} from "../../shared/api/domain";
import { isNonPublicIp } from "../../shared/api/netPolicy";
import type { ApiDomainProxy, DomainStep, DomainStepKey } from "../../shared/types";

// R36 — layered check of the domain from this machine (DNS → port → certificate → our instance), on a timer.
// Online needs our instance id; an online domain only leaves "online" after 3 failed rounds in a row.

export interface DomainMonitorDeps {
  instanceId: string;
  apiPort: () => number;
  /** Managed proxy: the app's port check and the last Let's Encrypt error from Caddy's log. */
  caddyInfo: () => { port: PortCheck | null; certError: string | null; running: boolean };
  onChange: () => void;
  log: (level: "info" | "warn", msg: string, data?: Record<string, unknown>) => void;
  resolve?: (host: string) => Promise<DnsAnswer>;
  publicIp?: () => Promise<string | null>;
  probe?: (host: string) => Promise<ProbeOutcome>;
  now?: () => number;
  intervals?: { fast: number; slow: number; fastWindow: number };
  failThreshold?: number;
}

export interface DomainSnapshot {
  rounds: number;
  online: boolean;
  steps: Record<DomainStepKey, DomainStep>;
  notes: string[];
  publicIp: string | null;
  dnsIps: string[];
  checkedAt: number | null;
  lastOnlineAt: number | null;
  /** Rounds that actually called https://{host} (tests: 0 when DNS points inside). */
  probes: number;
}

// ---------------------------------------------------------------- defaults (real network)
export async function resolveDomain(host: string): Promise<DnsAnswer> {
  const r = new dns.promises.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  r.setServers(DNS_SERVERS);
  const [a, aaaa] = await Promise.allSettled([r.resolve4(host), r.resolve6(host)]);
  const ips = [
    ...(a.status === "fulfilled" ? a.value : []),
    ...(aaaa.status === "fulfilled" ? aaaa.value : []),
  ];
  const answered = (x: PromiseSettledResult<string[]>) =>
    x.status === "fulfilled" ||
    ["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes((x.reason as NodeJS.ErrnoException)?.code ?? "");
  if (answered(a) && answered(aaaa)) return { ips };
  // Public resolvers unreachable (blocked outbound DNS) → the machine's own resolver.
  try {
    const all = await dns.promises.lookup(host, { all: true, verbatim: true });
    return { ips: all.map((x) => x.address) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOTFOUND" || code === "ENODATA") return { ips: [] };
    return { error: code || "dns" };
  }
}

export function makePublicIpLookup(
  fetchFn: typeof fetch,
  now: () => number = Date.now,
): () => Promise<string | null> {
  let cache: { ip: string | null; at: number } | null = null;
  return async () => {
    if (cache && now() - cache.at < PUBLIC_IP_CACHE_MS) return cache.ip;
    let ip: string | null = null;
    for (const url of PUBLIC_IP_URLS) {
      try {
        const r = await fetchFn(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
        if (!r.ok) continue;
        const t = (await r.text()).trim();
        const m = url.includes("/cdn-cgi/trace") ? /^ip=(.+)$/m.exec(t)?.[1]?.trim() : t;
        if (m && /^\d{1,3}(\.\d{1,3}){3}$/.test(m) && !isNonPublicIp(m)) {
          ip = m;
          break;
        }
      } catch {
        /* next */
      }
    }
    cache = { ip, at: now() };
    return ip;
  };
}

export function makeHttpsProbe(fetchFn: typeof fetch, selfCheckToken?: string): (host: string) => Promise<ProbeOutcome> {
  return async (host) => {
    try {
      // No API key, no redirects, normal certificate verification (R36).
      const r = await fetchFn(`https://${host}/v1/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOMAIN_PROBE_TIMEOUT_MS),
        headers: selfCheckHeaders(selfCheckToken),
      });
      let j: { service?: unknown; instance?: unknown } = {};
      if (r.status === 200) {
        try {
          j = (await r.json()) as typeof j;
        } catch {
          j = {};
        }
      } else {
        await r.body?.cancel().catch(() => undefined);
      }
      return {
        kind: "http",
        status: r.status,
        service: typeof j.service === "string" ? j.service : undefined,
        instance: typeof j.instance === "string" ? j.instance : undefined,
      };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      return {
        kind: "error",
        code: err.cause?.code ?? err.name ?? "error",
        message: (err.cause?.message ?? err.message ?? "").slice(0, 160),
      };
    }
  };
}

// ---------------------------------------------------------------- monitor
export class DomainMonitor {
  private cfg: { host: string; proxy: ApiDomainProxy } | null = null;
  private gen = 0;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private startedAt = 0;
  private snap: DomainSnapshot = DomainMonitor.blank("managed");
  private failStreak = 0;

  constructor(private d: DomainMonitorDeps) {}

  private static blank(proxy: ApiDomainProxy): DomainSnapshot {
    return {
      rounds: 0,
      online: false,
      steps: emptySteps(proxy),
      notes: [],
      publicIp: null,
      dnsIps: [],
      checkedAt: null,
      lastOnlineAt: null,
      probes: 0,
    };
  }
  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  get active(): boolean {
    return this.cfg !== null;
  }

  snapshot(): DomainSnapshot {
    return {
      ...this.snap,
      steps: { ...this.snap.steps },
      notes: [...this.snap.notes],
      dnsIps: [...this.snap.dnsIps],
    };
  }

  start(cfg: { host: string; proxy: ApiDomainProxy }): void {
    if (this.cfg && this.cfg.host === cfg.host && this.cfg.proxy === cfg.proxy) return;
    this.stop();
    this.cfg = cfg;
    this.startedAt = this.now();
    this.snap = DomainMonitor.blank(cfg.proxy);
    this.failStreak = 0;
    this.schedule(0);
  }

  stop(): void {
    this.gen++;
    this.cfg = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inflight = null;
  }

  /** "Kiểm lại ngay" and Caddy events. Resolves when the round is done. */
  checkNow(): Promise<void> {
    if (!this.cfg) return Promise.resolve();
    if (this.inflight) return this.inflight;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.round(this.gen);
  }

  /** Check again soon (after a Caddy event), without waiting for the regular timer. */
  soon(ms = 1500): void {
    if (!this.cfg || this.inflight) return;
    this.schedule(ms);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    const gen = this.gen;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (gen === this.gen) void this.round(gen);
    }, ms);
    this.timer.unref?.();
  }

  private round(gen: number): Promise<void> {
    const p = this.doRound(gen)
      .catch((e) =>
        this.d.log("warn", "domain check failed", { error: String((e as Error)?.message ?? e) }),
      )
      .finally(() => {
        if (this.inflight === p) this.inflight = null;
        if (gen !== this.gen || !this.cfg) return;
        const iv = this.d.intervals ?? {
          fast: DOMAIN_FAST_INTERVAL_MS,
          slow: DOMAIN_SLOW_INTERVAL_MS,
          fastWindow: DOMAIN_FAST_WINDOW_MS,
        };
        this.schedule(
          nextCheckDelay({
            online: this.snap.online,
            sinceStartMs: this.now() - this.startedAt,
            ...iv,
          }),
        );
      });
    this.inflight = p;
    return p;
  }

  private async doRound(gen: number): Promise<void> {
    const cfg = this.cfg;
    if (!cfg) return;
    const resolve = this.d.resolve ?? resolveDomain;
    let dnsAnswer: DnsAnswer;
    try {
      dnsAnswer = await resolve(cfg.host);
    } catch (e) {
      dnsAnswer = { error: String((e as Error).message ?? e) };
    }
    if (gen !== this.gen) return;
    const publicIp = this.d.publicIp ? await this.d.publicIp().catch(() => null) : null;
    if (gen !== this.gen) return;
    const pre = dnsVerdict(dnsAnswer, cfg.host, publicIp);
    let probe: ProbeOutcome | null = null;
    // The app's Caddy not serving yet → nothing to call (Caddy "started" triggers the next round).
    const caddyUp = cfg.proxy === "external" || this.d.caddyInfo().running;
    if (pre.probeAllowed && caddyUp && this.d.probe) {
      try {
        probe = await this.d.probe(cfg.host);
      } catch (e) {
        probe = {
          kind: "error",
          code: (e as NodeJS.ErrnoException).code ?? "error",
          message: String((e as Error).message ?? e).slice(0, 160),
        };
      }
      this.snap.probes++;
    }
    if (gen !== this.gen) return;
    const caddy =
      cfg.proxy === "managed"
        ? this.d.caddyInfo()
        : { port: null, certError: null, running: false };
    const r = evaluateDomain({
      host: cfg.host,
      proxy: cfg.proxy,
      apiPort: this.d.apiPort(),
      instanceId: this.d.instanceId,
      dns: dnsAnswer,
      publicIp,
      port: caddy.port,
      certError: caddy.certError,
      probe,
    });
    const now = this.now();
    const s = this.snap;
    s.rounds++;
    s.checkedAt = now;
    s.publicIp = publicIp;
    s.dnsIps = "ips" in dnsAnswer ? [...new Set(dnsAnswer.ips)] : [];
    const threshold = this.d.failThreshold ?? PUBLIC_FAIL_THRESHOLD;
    if (r.online) {
      if (!s.online) this.d.log("info", "domain online", {});
      s.online = true;
      s.lastOnlineAt = now;
      this.failStreak = 0;
      s.steps = r.steps;
      s.notes = r.notes;
    } else if (s.online) {
      this.failStreak++;
      if (this.failStreak >= threshold) {
        s.online = false;
        s.steps = r.steps;
        s.notes = [
          ...r.notes,
          ...(s.lastOnlineAt ? [DOMAIN_MSG.lastOnline(hhmm(s.lastOnlineAt))] : []),
        ];
        this.d.log("warn", "domain left online after failed checks", { fails: this.failStreak });
      }
    } else {
      s.steps = r.steps;
      s.notes = [
        ...r.notes,
        ...(s.lastOnlineAt ? [DOMAIN_MSG.lastOnline(hhmm(s.lastOnlineAt))] : []),
      ];
    }
    this.d.onChange();
  }
}
