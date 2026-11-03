import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "../src/main/api/childProc";
import { CADDY_BINARIES } from "../src/shared/api/constants";
import type { ProbeOutcome } from "../src/shared/api/domain";
import { makeApi, rawRequest, type ApiRig } from "./apiHelpers";
import { makeHarness, type Harness } from "./helpers";

// I-caddy: the real pinned Caddy 2.11.7 (linux-x64 build of the same release) in front of the real API server.
// Local CA + high ports instead of Let's Encrypt + 80/443; everything else is the production code path.
// Skipped when the pinned binary is not available in this sandbox (MUSE_CADDY_BIN or /tmp/caddy/caddy).

const SRC = process.env.MUSE_CADDY_BIN ?? "/tmp/caddy/caddy";
const PIN = CADDY_BINARIES["linux-x64"];
const available = process.platform === "linux" && process.arch === "x64" && fs.existsSync(SRC);
const DOMAIN = "muse.example.com";

let h: Harness;
let rig: ApiRig | null = null;
const extra: number[] = [];
afterEach(async () => {
  await rig?.close();
  rig = null;
  for (const pid of extra.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  if (h) {
    await h.coord.stop();
    h.close();
  }
});

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return fs.existsSync(`/proc/${pid}`) && !fs.readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ");
  } catch {
    return false;
  }
};

async function until(fn: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** HTTPS to 127.0.0.1:{port} as if DNS pointed {DOMAIN} here, trusting only Caddy's local CA. */
function viaCaddy(port: number, caPath: string, method: string, p: string, o: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; json: any; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port, servername: DOMAIN, method, path: p, ca: fs.readFileSync(caPath), headers: { host: DOMAIN, ...(o.headers ?? {}) }, agent: false, timeout: 8000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const t = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = JSON.parse(t);
          } catch {
            json = t;
          }
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

describe.skipIf(!available)("real Caddy 2.11.7 in front of the API (I-caddy)", () => {
  it("serves only /v1 + /mcp, overwrites a spoofed marker, logs via domain, stops ≤ 3 s, leftovers handled by PID + path", async () => {
    h = makeHarness();
    const binDir = path.join(h.dir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(SRC, path.join(binDir, PIN.file));
    fs.chmodSync(path.join(binDir, PIN.file), 0o755);
    const httpPort = await freePort();
    const httpsPort = await freePort();
    let ca = "";
    rig = await makeApi(h, {
      deps: {
        caddy: { binary: PIN, config: { issuer: "internal", httpPort, httpsPort } },
        monitor: {
          resolve: async () => ({ ips: ["203.0.113.7"] }),
          publicIp: async () => "203.0.113.7",
          probe: async (): Promise<ProbeOutcome> => {
            try {
              if (!fs.existsSync(ca)) return { kind: "error", code: "ERR_TLS_CERT_ALTNAME_INVALID" };
              const r = await viaCaddy(httpsPort, ca, "GET", "/v1/health");
              return { kind: "http", status: r.status, service: r.json?.service, instance: r.json?.instance };
            } catch (e) {
              return { kind: "error", code: (e as NodeJS.ErrnoException).code ?? "error", message: (e as Error).message };
            }
          },
          intervals: { fast: 200, slow: 200, fastWindow: 60_000 },
        },
      },
    });
    ca = path.join(h.dir, "caddy", "data", "pki", "authorities", "local", "root.crt");
    await rig.api.setDomain({ enabled: true, host: DOMAIN, proxy: "managed", confirmInternet: true });
    await until(() => rig!.api.status().domain.state === "online", 30_000);
    const pid = rig.api.caddy.childPid()!;
    expect(running(pid)).toBe(true);
    expect(fs.readlinkSync(`/proc/${pid}/exe`)).toBe(rig.api.caddy.exePath);

    // Only the API, the MCP endpoint and the OAuth protocol reach the app; the rest is Caddy's 404.
    const health = await viaCaddy(httpsPort, ca, "GET", "/v1/health");
    expect(health.json).toMatchObject({ service: "muse4ai", instance: rig.api.instanceId });
    expect((await viaCaddy(httpsPort, ca, "GET", "/")).status).toBe(404);
    expect((await viaCaddy(httpsPort, ca, "GET", "/admin")).status).toBe(404);
    // An agent pointed at the domain discovers OAuth the same way it does on the tunnel (R131–R141).
    const prm = await viaCaddy(httpsPort, ca, "GET", "/.well-known/oauth-protected-resource");
    expect(prm.status).toBe(200);
    expect(prm.json).toMatchObject({ resource: `https://${DOMAIN}/mcp` });
    const asm = await viaCaddy(httpsPort, ca, "GET", "/.well-known/oauth-authorization-server");
    expect(asm.status).toBe(200);
    expect(asm.json).toMatchObject({ issuer: `https://${DOMAIN}`, registration_endpoint: `https://${DOMAIN}/oauth/register` });
    expect((await viaCaddy(httpsPort, ca, "GET", "/.well-known/openid-configuration")).status).toBe(404);
    const reg = await viaCaddy(httpsPort, ca, "POST", "/oauth/register", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "probe", redirect_uris: ["http://127.0.0.1:9/callback"] }),
    });
    expect(reg.status).toBe(201);
    expect(typeof reg.json?.client_id).toBe("string");
    // A client-supplied marker is overwritten by Caddy → the request is accepted and logged as the domain way in.
    const st = await viaCaddy(httpsPort, ca, "GET", "/v1/status", { headers: { authorization: `Bearer ${rig.gen}`, "x-muse-ingress": "spoofed", "x-forwarded-for": "1.2.3.4" } });
    expect(st.status).toBe(200);
    const last = rig.api.requestLog(1)[0];
    expect(last).toMatchObject({ via: "domain", route: "/v1/status", status: 200 });
    expect(last.ipMasked).toBe("127.0.•••.•1"); // Caddy replaced the client's X-Forwarded-For with the real peer
    // Browsers are refused through Caddy too (Origin is passed on, not stripped).
    expect((await viaCaddy(httpsPort, ca, "GET", "/v1/status", { headers: { authorization: `Bearer ${rig.gen}`, origin: "https://evil.example" } })).status).toBe(403);
    // Straight to the API port with the domain Host but without Caddy's marker → 421.
    expect((await rawRequest(rig.port, "GET", "/v1/status", { token: rig.gen, host: DOMAIN })).status).toBe(421);
    // HTTP port redirects to HTTPS (no port 80 conflict here).
    const plain = await rawRequest(httpPort, "GET", "/v1/health", { host: DOMAIN });
    expect(plain.status).toBe(308);
    // The generated config has the admin endpoint off.
    expect(fs.readFileSync(path.join(h.dir, "caddy", "Caddyfile"), "utf8")).toContain("admin off");
    expect(fs.existsSync(path.join(h.dir, "caddy", "xdg-config", "caddy", "autosave.json"))).toBe(false);

    // AC-DOM-11a: API off → real Caddy gone within 3 s.
    const t0 = Date.now();
    await rig.api.setEnabled(false);
    await until(() => !running(pid), 3000);
    expect(Date.now() - t0).toBeLessThan(3000);

    // AC-DOM-11c: a leftover of *our* executable is stopped; a caddy from another path keeps running.
    const cfg = path.join(h.dir, "orphan.Caddyfile");
    const p1 = await freePort();
    const p2 = await freePort();
    fs.writeFileSync(cfg, `{\n\tadmin off\n\tpersist_config off\n}\n:${p1} {\n\trespond "x"\n}\n`);
    const ours = spawn(rig.api.caddy.exePath!, ["run", "--config", cfg, "--adapter", "caddyfile"], { stdio: "ignore", detached: true });
    extra.push(ours.pid!);
    const otherExe = path.join(h.dir, "other-caddy");
    fs.copyFileSync(SRC, otherExe);
    fs.chmodSync(otherExe, 0o755);
    const cfg2 = path.join(h.dir, "other.Caddyfile");
    fs.writeFileSync(cfg2, `{\n\tadmin off\n\tpersist_config off\n}\n:${p2} {\n\trespond "y"\n}\n`);
    const other = spawn(otherExe, ["run", "--config", cfg2, "--adapter", "caddyfile"], { stdio: "ignore", detached: true });
    extra.push(other.pid!);
    await until(() => running(ours.pid!) && running(other.pid!));
    const pidFile = path.join(h.dir, "caddy", "caddy.pid");
    fs.writeFileSync(pidFile, JSON.stringify({ pid: ours.pid, exe: rig.api.caddy.exePath }));
    expect(await rig.api.caddy.cleanupOrphan()).toBe("killed");
    await until(() => !running(ours.pid!), 3000);
    fs.writeFileSync(pidFile, JSON.stringify({ pid: other.pid, exe: rig.api.caddy.exePath }));
    expect(await rig.api.caddy.cleanupOrphan()).toBe("kept");
    await new Promise((r) => setTimeout(r, 300));
    expect(running(other.pid!)).toBe(true);
  }, 60_000);
});

const ZIP = "/tmp/caddy/caddy_2.11.7_windows_amd64.zip";
const TGZ = "/tmp/caddy/caddy_2.11.7_linux_amd64.tar.gz";
describe.skipIf(!fs.existsSync(ZIP) || !fs.existsSync(TGZ))("real release archives (B27)", () => {
  it("our extractor gets exactly the pinned executables out of the official ZIP and tar.gz", async () => {
    const { createHash } = await import("node:crypto");
    const { extractTarGzEntry, extractZipEntry } = await import("../src/main/api/archive");
    const z = fs.readFileSync(ZIP);
    const t = fs.readFileSync(TGZ);
    const h256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(h256(z)).toBe(CADDY_BINARIES["win32-x64"].archiveSha256);
    expect(h256(t)).toBe(CADDY_BINARIES["linux-x64"].archiveSha256);
    expect(h256(await extractZipEntry(z, "caddy.exe"))).toBe(CADDY_BINARIES["win32-x64"].sha256);
    expect(h256(await extractTarGzEntry(t, "caddy"))).toBe(CADDY_BINARIES["linux-x64"].sha256);
  });
});
