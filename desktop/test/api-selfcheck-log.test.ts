import { afterEach, describe, expect, it } from "vitest";
import { SELFCHECK_HEADER } from "../src/shared/api/constants";
import { makeHttpsProbe } from "../src/main/api/domainCheck";
import { makeApi, type ApiRig } from "./apiHelpers";
import { makeHarness, type Harness } from "./helpers";

// The app checks its own tunnel/domain every minute through /v1/health. Those checks must not fill the
// "Nhật ký gọi API" (50 rows) and push real agent calls out of view — found on the VPS (Phase 9f).

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  if (h) {
    await h.coord.stop();
    h.close();
  }
});

const tokenOf = (r: ApiRig) => (r.api as unknown as { selfCheckToken: string }).selfCheckToken;
const healthRows = (r: ApiRig) => r.api.requestLog(50).filter((x) => x.route === "/v1/health").length;

describe("self-check health calls stay out of the request log", () => {
  it("a health call carrying this run's self-check token is answered but not logged", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const token = tokenOf(rig);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const r = await rig.req("GET", "/v1/health", { headers: { [SELFCHECK_HEADER]: token } });
    expect(r.status).toBe(200);
    expect(r.json.service).toBe("muse4ai");
    expect(healthRows(rig)).toBe(0);
  });

  it("a health call without the token, or with a wrong one, is logged as usual", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    await rig.req("GET", "/v1/health");
    await rig.req("GET", "/v1/health", { headers: { [SELFCHECK_HEADER]: "0".repeat(32) } });
    expect(healthRows(rig)).toBe(2);
  });

  it("the token only exempts /v1/health — any other route is still logged", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const r = await rig.req("GET", "/v1/status", { token: null, headers: { [SELFCHECK_HEADER]: tokenOf(rig) } });
    expect(r.status).toBe(401);
    expect(rig.api.requestLog(50).some((x) => x.route === "/v1/status" && x.status === 401)).toBe(true);
  });

  it("each run has its own token", async () => {
    h = makeHarness();
    rig = await makeApi(h);
    const first = tokenOf(rig);
    await rig.close();
    rig = await makeApi(h, { keys: false });
    expect(tokenOf(rig)).not.toBe(first);
  });

  it("the domain HTTPS probe sends the token", async () => {
    let sent: Record<string, string> = {};
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      sent = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ ok: true, service: "muse4ai", instance: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    await makeHttpsProbe(fakeFetch, "a".repeat(32))("api.example.com");
    expect(sent[SELFCHECK_HEADER]).toBe("a".repeat(32));
  });
});
