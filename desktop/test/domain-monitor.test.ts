import { afterEach, describe, expect, it } from "vitest";
import { DomainMonitor, makePublicIpLookup } from "../src/main/api/domainCheck";
import { DOMAIN_MSG, type DnsAnswer, type ProbeOutcome } from "../src/shared/api/domain";

// R36 monitor: what is called when, hysteresis while online (AC-DOM-06, AC-DOM-13b).

const monitors: DomainMonitor[] = [];
afterEach(() => {
  for (const m of monitors) m.stop();
  monitors.length = 0;
});

function mk(o: { dns: () => DnsAnswer; probe: () => ProbeOutcome; publicIp?: string | null; proxy?: "managed" | "external"; running?: boolean }) {
  const probes: string[] = [];
  const m = new DomainMonitor({
    instanceId: "inst-1",
    apiPort: () => 47822,
    caddyInfo: () => ({ port: { state: "ok", detail: DOMAIN_MSG.portOk }, certError: null, running: o.running ?? true }),
    onChange: () => undefined,
    log: () => undefined,
    resolve: async () => o.dns(),
    publicIp: async () => o.publicIp ?? "203.0.113.7",
    probe: async (h) => {
      probes.push(h);
      return o.probe();
    },
    intervals: { fast: 60_000, slow: 60_000, fastWindow: 1 },
  });
  m.start({ host: "muse.example.com", proxy: o.proxy ?? "managed" });
  monitors.push(m);
  return { m, probes };
}

const OK: ProbeOutcome = { kind: "http", status: 200, service: "muse4ai", instance: "inst-1" };
const REFUSED: ProbeOutcome = { kind: "error", code: "ECONNREFUSED" };

describe("DomainMonitor", () => {
  it("DNS pointing inside → error and zero HTTPS calls (AC-DOM-06)", async () => {
    const { m, probes } = mk({ dns: () => ({ ips: ["10.1.2.3"] }), probe: () => OK });
    await m.checkNow();
    await m.checkNow();
    expect(probes).toEqual([]);
    expect(m.snapshot().steps.dns.state).toBe("fail");
    expect(m.snapshot().online).toBe(false);
  });

  it("the app's Caddy not serving yet → no HTTPS call", async () => {
    const { m, probes } = mk({ dns: () => ({ ips: ["203.0.113.7"] }), probe: () => OK, running: false });
    await m.checkNow();
    expect(probes).toEqual([]);
    expect(m.snapshot().rounds).toBe(1);
  });

  it("our instance → online; external proxy probes without Caddy", async () => {
    const a = mk({ dns: () => ({ ips: ["203.0.113.7"] }), probe: () => OK });
    await a.m.checkNow();
    expect(a.m.snapshot().online).toBe(true);
    expect(a.m.snapshot().steps.app.state).toBe("ok");
    const b = mk({ dns: () => ({ ips: ["203.0.113.7"] }), probe: () => OK, proxy: "external", running: false });
    await b.m.checkNow();
    expect(b.probes).toEqual(["muse.example.com"]);
    expect(b.m.snapshot().steps.port.state).toBe("skip");
    expect(b.m.snapshot().online).toBe(true);
  });

  it("AC-DOM-13b: online survives 2 failed checks, leaves on the 3rd with “Trực tuyến lần cuối lúc …”, comes back", async () => {
    let probe: ProbeOutcome = OK;
    const { m } = mk({ dns: () => ({ ips: ["203.0.113.7"] }), probe: () => probe });
    await m.checkNow();
    expect(m.snapshot().online).toBe(true);
    probe = REFUSED;
    await m.checkNow();
    expect(m.snapshot().online).toBe(true);
    await m.checkNow();
    expect(m.snapshot().online).toBe(true);
    await m.checkNow();
    const s = m.snapshot();
    expect(s.online).toBe(false);
    expect(s.steps.cert.detail).toBe(DOMAIN_MSG.unreachable);
    expect(s.notes.some((n) => n.startsWith("Trực tuyến lần cuối lúc "))).toBe(true);
    probe = OK;
    await m.checkNow();
    expect(m.snapshot().online).toBe(true);
  });

  it("stop() ends the rounds; a new host starts from scratch", async () => {
    const { m, probes } = mk({ dns: () => ({ ips: ["203.0.113.7"] }), probe: () => OK });
    await m.checkNow();
    m.stop();
    await m.checkNow();
    expect(probes).toHaveLength(1);
    m.start({ host: "api.example.com", proxy: "managed" });
    expect(m.snapshot().rounds).toBe(0);
    await m.checkNow();
    expect(probes).toEqual(["muse.example.com", "api.example.com"]);
  });
});

describe("public IP lookup", () => {
  it("uses ipify, falls back to the Cloudflare trace, caches 10 min, ignores private answers", async () => {
    let t = 0;
    const calls: string[] = [];
    const f = (async (u: string | URL) => {
      calls.push(String(u));
      if (String(u).includes("ipify")) return new Response("oops", { status: 500 });
      return new Response("fl=1\nip=203.0.113.7\nts=1\n", { status: 200 });
    }) as typeof fetch;
    const look = makePublicIpLookup(f, () => t);
    expect(await look()).toBe("203.0.113.7");
    expect(await look()).toBe("203.0.113.7");
    expect(calls).toHaveLength(2);
    t = 11 * 60_000;
    await look();
    expect(calls).toHaveLength(4);
    const priv = makePublicIpLookup((async () => new Response("10.0.0.5")) as typeof fetch);
    expect(await priv()).toBeNull();
  });
});
