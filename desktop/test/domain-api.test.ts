import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiControllerDeps } from "../src/main/api/controller";
import { DOMAIN_MSG, type DnsAnswer, type ProbeOutcome } from "../src/shared/api/domain";
import { fixtureMedia, makeApi, rawRequest, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Integration (I-dom): real API server + coordinator + SQLite + fake Muse, with fake Caddy/cloudflared processes and a
// probe that really calls the API through the domain Host the way Caddy forwards it (spec rev 5 R33–R38).

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  if (h) {
    await Promise.race([h.coord.idle(), new Promise((r) => setTimeout(r, 3000))]);
    await h.coord.stop();
    h.close();
  }
});

const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
const DOMAIN = "muse.example.com";
const TUNNEL = "quiet-river-abc.trycloudflare.com";
const PROMPT = "Một tách cà phê trên bàn gỗ";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = 0;
  constructor(public pid: number) {
    super();
  }
  kill(): boolean {
    this.killed++;
    if (this.exitCode === null) {
      this.exitCode = 1;
      setImmediate(() => this.emit("exit", 1, null));
    }
    return true;
  }
}

interface World {
  caddy: FakeChild[];
  tunnel: FakeChild[];
  dns: { value: DnsAnswer };
  ref: { id: string; port: number; marker: () => string | null };
  probes: string[];
}

function alive(list: FakeChild[]): FakeChild[] {
  return list.filter((c) => c.exitCode === null);
}

/** Controller deps with fake helper programs. The domain probe goes through the real API with Caddy's marker. */
function world(): { deps: Partial<ApiControllerDeps>; w: World } {
  const binDir = path.join(h.dir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const caddyExe = Buffer.from("fake caddy");
  const tunExe = Buffer.from("fake cloudflared");
  fs.writeFileSync(path.join(binDir, "caddy-fake.exe"), caddyExe);
  fs.writeFileSync(path.join(binDir, "cloudflared-fake.exe"), tunExe);
  const w: World = { caddy: [], tunnel: [], dns: { value: { ips: ["203.0.113.7"] } }, ref: { id: "", port: 0, marker: () => null }, probes: [] };
  let pid = 7000;
  const deps: Partial<ApiControllerDeps> = {
    caddy: {
      binary: { url: "https://example.invalid/caddy.zip", archiveSha256: "0".repeat(64), archiveBytes: 1, entry: "caddy.exe", sha256: sha(caddyExe), file: "caddy-fake.exe" },
      spawn: (() => {
        const c = new FakeChild(++pid);
        w.caddy.push(c);
        setTimeout(() => c.stderr.write('{"level":"info","msg":"serving initial configuration"}\n'), 5);
        return c;
      }) as never,
      portFree: async () => true,
      processPath: async () => null,
      delaysS: [0.05, 0.05, 0.05, 0.05, 0.05],
    },
    tunnel: {
      binary: { url: "https://example.invalid/cf.exe", sha256: sha(tunExe), bytes: tunExe.length, file: "cloudflared-fake.exe" },
      spawn: (() => {
        const c = new FakeChild(++pid);
        w.tunnel.push(c);
        return c;
      }) as never,
      fetch: (async (u: string | URL) => {
        const url = String(u);
        if (url.endsWith("/quicktunnel")) return Response.json({ hostname: TUNNEL });
        if (url.endsWith("/v1/health")) {
          const r = await rawRequest(w.ref.port, "GET", "/v1/health", { host: TUNNEL });
          return new Response(new Uint8Array(r.body), { status: r.status, headers: { "content-type": "application/json" } });
        }
        return new Response("no", { status: 404 });
      }) as typeof fetch,
      processPath: async () => null,
      onlineTimeoutMs: 3000,
      probeIntervalMs: 20,
      delaysS: [0.05, 0.05, 0.05, 0.05, 0.05],
    },
    monitor: {
      resolve: async () => w.dns.value,
      publicIp: async () => "203.0.113.7",
      probe: async (host): Promise<ProbeOutcome> => {
        w.probes.push(host);
        const m = w.ref.marker();
        const r = await rawRequest(w.ref.port, "GET", "/v1/health", { host, headers: m ? { "x-muse-ingress": m } : {} });
        return { kind: "http", status: r.status, service: r.json?.service, instance: r.json?.instance };
      },
      intervals: { fast: 50, slow: 50, fastWindow: 10_000 },
    },
  };
  return { deps, w };
}

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function up(opts: { access?: "local" | "cloudflare_quick"; media?: boolean } = {}) {
  h = opts.media ? makeHarness({ cfg: () => ({ media: fixtureMedia, generateDelayMs: 0, submitDelayMs: 0 }) }) : makeHarness();
  const { deps, w } = world();
  rig = await makeApi(h, { access: opts.access, deps });
  w.ref.id = rig.api.instanceId;
  w.ref.port = rig.port;
  w.ref.marker = () => rig!.api.caddy.marker();
  return w;
}

async function domainOn(proxy: "managed" | "external" = "managed") {
  await rig!.api.setDomain({ enabled: true, host: DOMAIN, proxy, confirmInternet: true });
}

const viaDomain = (p: string, o: Parameters<ApiRig["req"]>[2] = {}, marker?: string | null) =>
  rawRequest(rig!.port, o.json ? "POST" : "GET", p, { ...o, host: DOMAIN, headers: { ...(o.headers ?? {}), ...(marker ? { "x-muse-ingress": marker } : {}) } });

describe("upgrade from beta.15 (AC-DOM-01)", () => {
  it("domain stays off, the quick tunnel comes back as before, no Caddy", async () => {
    const w = await up({ access: "cloudflare_quick" });
    await until(() => rig!.api.status().tunnel.state === "online");
    const st = rig!.api.status();
    expect(st.domain).toMatchObject({ enabled: false, state: "off", host: "", proxy: "managed" });
    expect(st.access).toBe("cloudflare_quick");
    expect(w.caddy).toHaveLength(0);
    expect(alive(w.tunnel)).toHaveLength(1);
    expect(st.urls.map((u) => u.via)).toEqual(["tunnel", "local"]);
  });
});

describe("setDomain (AC-DOM-02, AC-DOM-03)", () => {
  it("refuses bad input and missing confirmation before saving anything; confirmed → saved and started", async () => {
    const w = await up();
    await expect(rig!.api.setDomain({ enabled: true, host: "203.0.113.7", confirmInternet: true })).rejects.toThrow(DOMAIN_MSG.ip);
    await expect(rig!.api.setDomain({ enabled: false, host: "abc-def.trycloudflare.com" })).rejects.toThrow(DOMAIN_MSG.quick);
    expect(h.coord.settings()).toMatchObject({ apiDomainEnabled: false, apiDomainHost: "" });
    const e = await rig!.api.setDomain({ enabled: true, host: "https://Muse.Example.com/v1/" }).catch((x) => x);
    expect(e.code).toBe("confirm");
    expect(h.coord.settings()).toMatchObject({ apiDomainEnabled: false, apiDomainHost: "" });
    expect(w.caddy).toHaveLength(0);
    await rig!.api.setDomain({ enabled: true, host: "https://Muse.Example.com/v1/", confirmInternet: true });
    expect(h.coord.settings()).toMatchObject({ apiDomainEnabled: true, apiDomainHost: DOMAIN, apiDomainProxy: "managed" });
    await until(() => rig!.api.status().domain.state === "online");
    expect(alive(w.caddy)).toHaveLength(1);
  });

  it("needs the API on; the named tunnel and the domain cannot share a hostname", async () => {
    await up();
    await rig!.api.setEnabled(false);
    await expect(rig!.api.setDomain({ enabled: true, host: DOMAIN, confirmInternet: true })).rejects.toThrow(DOMAIN_MSG.needApi);
    await rig!.api.setEnabled(true);
    await rig!.api.setNamedTunnel({ hostname: "tunnel.example.com" });
    await expect(rig!.api.setDomain({ enabled: true, host: "tunnel.example.com", confirmInternet: true })).rejects.toThrow(DOMAIN_MSG.named);
    await domainOn();
    await expect(rig!.api.setNamedTunnel({ hostname: DOMAIN })).rejects.toThrow(DOMAIN_MSG.sameAsDomain);
  });

  it("an empty name is refused when turning on, and forgets the saved name when turning off", async () => {
    const w = await up();
    await domainOn();
    await expect(rig!.api.setDomain({ enabled: true, host: "  ", confirmInternet: true })).rejects.toThrow(DOMAIN_MSG.empty);
    expect(h.coord.settings()).toMatchObject({ apiDomainEnabled: true, apiDomainHost: DOMAIN });
    await rig!.api.setDomain({ enabled: false, host: "" });
    expect(h.coord.settings()).toMatchObject({ apiDomainEnabled: false, apiDomainHost: "" });
    await until(() => alive(w.caddy).length === 0);
    expect(rig!.api.status().domain.state).toBe("off");
  });
});

describe("Host + ingress marker (AC-DOM-10)", () => {
  it("managed: no marker 421, wrong marker 421, marker + Origin 403, marker 200 via domain; no CORS headers", async () => {
    await up();
    await domainOn();
    await until(() => !!rig!.api.caddy.marker());
    const m = rig!.api.caddy.marker()!;
    const none = await viaDomain("/v1/status", { token: rig!.gen });
    const wrong = await viaDomain("/v1/status", { token: rig!.gen }, "f".repeat(32));
    const origin = await viaDomain("/v1/status", { token: rig!.gen, headers: { origin: "https://evil.example" } }, m);
    const ok = await viaDomain("/v1/status", { token: rig!.gen, headers: { "x-forwarded-for": "198.51.100.23" } }, m);
    expect([none.status, wrong.status, origin.status, ok.status]).toEqual([421, 421, 403, 200]);
    expect(none.json.code ?? none.json.type).toBeDefined();
    for (const r of [none, wrong, origin, ok]) expect(Object.keys(r.headers).some((k) => k.startsWith("access-control-"))).toBe(false);
    const log = rig!.api.requestLog(10);
    expect(log[0]).toMatchObject({ via: "domain", status: 200, ipMasked: "198.51.•••.•3" });
  });

  it("external proxy: the domain Host is accepted from loopback without a marker", async () => {
    const w = await up();
    await domainOn("external");
    const r = await viaDomain("/v1/status", { token: rig!.gen });
    expect(r.status).toBe(200);
    expect(rig!.api.requestLog(1)[0].via).toBe("domain");
    expect(w.caddy).toHaveLength(0);
  });

  it("domain off → its Host is refused again", async () => {
    await up();
    await domainOn();
    await until(() => !!rig!.api.caddy.marker());
    const m = rig!.api.caddy.marker()!;
    await rig!.api.setDomain({ enabled: false });
    expect((await viaDomain("/v1/status", { token: rig!.gen }, m)).status).toBe(421);
  });
});

describe("two ways in at once (AC-DOM-07, AC-DOM-08)", () => {
  it("same job through domain and tunnel; links follow the address called; one queue, one idempotency", async () => {
    const w = await up({ access: "cloudflare_quick", media: true });
    const [A] = await seedAccounts(h, ["Mây"]);
    h.repo.updateAccount(A, { state: "needs_login" });
    await domainOn();
    await until(() => rig!.api.status().tunnel.state === "online" && rig!.api.status().domain.state === "online");
    const m = rig!.api.caddy.marker()!;
    const st = rig!.api.status();
    expect(st.urls.filter((u) => u.online && u.internet).map((u) => u.url)).toEqual([`https://${DOMAIN}`, `https://${TUNNEL}`]);

    const body = { kind: "image", prompt: PROMPT };
    const r1 = await viaDomain("/v1/jobs", { token: rig!.gen, json: body, headers: { "idempotency-key": "k-dual" } }, m);
    expect(r1.status).toBe(202);
    const r2 = await rawRequest(rig!.port, "POST", "/v1/jobs", { token: rig!.gen, json: body, host: TUNNEL, headers: { "idempotency-key": "k-dual", "cf-connecting-ip": "203.0.113.50" } });
    expect(r2.status).toBe(202);
    expect(r2.headers["idempotent-replayed"]).toBe("true");
    expect(r2.body.equals(r1.body)).toBe(true);
    const r3 = await rawRequest(rig!.port, "POST", "/v1/jobs", { token: rig!.gen, json: { ...body, prompt: "Khác" }, host: TUNNEL, headers: { "idempotency-key": "k-dual" } });
    expect(r3.status).toBe(422);
    expect(r3.json.code).toBe("idempotency_conflict");
    const id = r1.json.jobs[0].id;
    expect(h.repo.db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toMatchObject({ n: 1 });

    h.repo.updateAccount(A, { state: "ready" });
    h.coord.requestSchedule();
    await settle(h);
    const viaT = await rawRequest(rig!.port, "GET", `/v1/jobs/${id}`, { token: rig!.gen, host: TUNNEL });
    const viaD = await viaDomain(`/v1/jobs/${id}`, { token: rig!.gen }, m);
    expect(viaT.json.status).toBe("succeeded");
    expect(new URL(viaT.json.outputs[0].download_url).origin).toBe(`https://${TUNNEL}`);
    expect(new URL(viaD.json.outputs[0].download_url).origin).toBe(`https://${DOMAIN}`);
    // The signature is not bound to the host: a domain link opens through the tunnel while valid (R32).
    const u = new URL(viaD.json.outputs[0].download_url);
    const file = await rawRequest(rig!.port, "GET", u.pathname + u.search, { host: TUNNEL });
    expect(file.status).toBe(200);
    expect(sha(file.body)).toBe(h.repo.getAsset(viaD.json.outputs[0].asset_id)!.sha256);
    const vias = new Set(rig!.api.requestLog(50).map((l) => l.via));
    expect(vias.has("domain")).toBe(true);
    expect(vias.has("tunnel")).toBe(true);
    expect(w.probes.length).toBeGreaterThan(0);
  });
});

describe("independence (AC-DOM-09) and stop (AC-DOM-11a/b)", () => {
  it("domain waiting/turned off does not touch the tunnel; tunnel off does not touch Caddy", async () => {
    const w = await up({ access: "cloudflare_quick" });
    await until(() => rig!.api.status().tunnel.state === "online");
    const tunPid = alive(w.tunnel)[0].pid;
    w.dns.value = { ips: [] };
    await domainOn();
    await until(() => rig!.api.status().domain.steps.dns.detail === DOMAIN_MSG.dnsNone(DOMAIN));
    expect(rig!.api.status().tunnel.state).toBe("online");
    expect(alive(w.tunnel).map((c) => c.pid)).toEqual([tunPid]);
    expect((await rawRequest(rig!.port, "GET", "/v1/status", { token: rig!.gen, host: TUNNEL })).status).toBe(200);
    await rig!.api.setDomain({ enabled: false });
    expect(alive(w.caddy)).toHaveLength(0);
    expect(alive(w.tunnel).map((c) => c.pid)).toEqual([tunPid]);
    expect(rig!.api.status().tunnel.state).toBe("online");

    w.dns.value = { ips: ["203.0.113.7"] };
    await domainOn();
    await until(() => rig!.api.status().domain.state === "online");
    const caddyPid = alive(w.caddy)[0].pid;
    await rig!.api.setAccess("local", false);
    expect(alive(w.tunnel)).toHaveLength(0);
    expect(alive(w.caddy).map((c) => c.pid)).toEqual([caddyPid]);
    await new Promise((r) => setTimeout(r, 150));
    expect(rig!.api.status().domain.state).toBe("online");
  });

  it("API off → Caddy and cloudflared stopped within 3 s, port closed; quit → same", async () => {
    const w = await up({ access: "cloudflare_quick" });
    await domainOn();
    await until(() => rig!.api.status().tunnel.state === "online" && rig!.api.status().domain.state === "online");
    const t0 = Date.now();
    await rig!.api.setEnabled(false);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(alive(w.caddy)).toHaveLength(0);
    expect(alive(w.tunnel)).toHaveLength(0);
    expect(rig!.api.status().domain.state).toBe("off");
    expect(h.coord.settings().apiDomainEnabled).toBe(true); // comes back with the API (R23)
    await rig!.api.setEnabled(true);
    await until(() => rig!.api.status().domain.state === "online" && rig!.api.status().tunnel.state === "online");
    await rig!.api.shutdown();
    expect(alive(w.caddy)).toHaveLength(0);
    expect(alive(w.tunnel)).toHaveLength(0);
  });
});

describe("external proxy (AC-DOM-19)", () => {
  it("no Caddy, no port step, three checks run", async () => {
    const w = await up();
    await domainOn("external");
    await until(() => rig!.api.status().domain.state === "online");
    const d = rig!.api.status().domain;
    expect(w.caddy).toHaveLength(0);
    expect(d.steps.port.state).toBe("skip");
    expect([d.steps.dns.state, d.steps.cert.state, d.steps.app.state]).toEqual(["ok", "ok", "ok"]);
    await rig!.api.setEnabled(false);
    expect(rig!.api.status().domain).toMatchObject({ enabled: true, proxy: "external", state: "off" });
  });
});

describe("no secrets in logs/diagnostics (AC-DOM-18)", () => {
  it("key, ingress marker never logged; diagnostics mask the domain and public IP", async () => {
    await up();
    const { token } = rig!.api.createKey("CANARY-KEY-agent", "generate");
    await domainOn();
    await until(() => rig!.api.status().domain.state === "online");
    const m = rig!.api.caddy.marker()!;
    await viaDomain("/v1/status", { token }, m);
    await viaDomain("/v1/jobs", { token, json: { kind: "image", prompt: PROMPT } }, m);
    const everything = JSON.stringify([h.logs, rig!.api.requestLog(200), rig!.api.diagnostics()]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(m);
    const diag = rig!.api.diagnostics() as { domain: { host: string; publicIp: string | null } };
    expect(diag.domain.host).toBe("•••.com");
    expect(diag.domain.publicIp).toBe("•••");
    expect(JSON.stringify(diag)).not.toContain(DOMAIN);
    expect(JSON.stringify(diag)).not.toContain("203.0.113.7");
  });
});
