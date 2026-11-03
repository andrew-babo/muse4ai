import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fixtureMedia, makeApi, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Real Cloudflare Quick Tunnel from this machine (developer E2E, needs Internet; skipped unless MUSE_REAL_TUNNEL=1).
// Downloads the pinned cloudflared for this platform, verifies its SHA-256, and calls the API through the public URL.

const RUN = process.env.MUSE_REAL_TUNNEL === "1";
let h: Harness;
let rig: ApiRig | null = null;
afterAll(async () => {
  await rig?.close();
  if (h) {
    await h.coord.stop();
    h.close();
  }
});

describe.skipIf(!RUN)("real quick tunnel", () => {
  it(
    "goes online, serves REST and MCP over https, and stops when the API is turned off",
    async () => {
      h = makeHarness({ cfg: () => ({ media: fixtureMedia, submitDelayMs: 0, generateDelayMs: 0 }) });
      h.clock.t = Date.now();
      await seedAccounts(h, ["Mây"]);
      rig = await makeApi(h, { access: "cloudflare_quick" });
      const t0 = Date.now();
      while (rig.api.status().tunnel.state !== "online" && Date.now() - t0 < 180_000) await new Promise((r) => setTimeout(r, 500));
      const st = rig.api.status();
      console.log("tunnel", st.tunnel.state, st.tunnel.url, `${Date.now() - t0} ms`, st.tunnel.error);
      expect(st.tunnel.state).toBe("online");
      const base = st.tunnel.url!;
      expect(base).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);

      const health = await (await fetch(`${base}/v1/health`)).json();
      expect(health.instance).toBe(rig.api.instanceId);
      const unauth = await fetch(`${base}/v1/status`);
      expect(unauth.status).toBe(401);
      const created = await fetch(`${base}/v1/jobs`, { method: "POST", headers: { authorization: `Bearer ${rig.gen}`, "content-type": "application/json", "idempotency-key": "real-1" }, body: JSON.stringify({ kind: "image", prompt: "tunnel smoke" }) });
      expect(created.status).toBe(202);
      const id = (await created.json()).jobs[0].id;
      await settle(h);
      const job = await (await fetch(`${base}/v1/jobs/${id}`, { headers: { authorization: `Bearer ${rig.gen}` } })).json();
      expect(job.status).toBe("succeeded");
      expect(job.outputs[0].download_url.startsWith(`${base}/v1/assets/`)).toBe(true);
      const file = Buffer.from(await (await fetch(job.outputs[0].download_url)).arrayBuffer());
      expect(createHash("sha256").update(file).digest("hex")).toBe(job.outputs[0].sha256);

      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${rig.gen}` } } });
      const client = new Client({ name: "real-tunnel-test", version: "1.0.0" });
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(5);
      const r = await client.callTool({ name: "muse_get_job", arguments: { job_id: id } });
      expect((r.structuredContent as { job: { id: string } }).job.id).toBe(id);
      await client.close();

      const log = rig.api.requestLog(50);
      expect(log.some((l) => l.via === "tunnel" && l.route === "/v1/jobs" && l.status === 202)).toBe(true);
      const pid = rig.api.tunnel.childPid();
      expect(pid).toBeTruthy();
      const off0 = Date.now();
      await rig.api.setEnabled(false);
      expect(Date.now() - off0).toBeLessThan(3000);
      let alive = true;
      try {
        process.kill(pid!, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    },
    300_000,
  );
});
