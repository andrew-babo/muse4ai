import { afterEach, describe, expect, it } from "vitest";
import type { Quota } from "../src/shared/types";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, settle, type Harness } from "./helpers";

// Spec rev 8 R76 — per-account quota through GET /v1/status and muse_status (AC-QTA-12).

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
  h?.close();
});

const nov2 = () => new Date(2026, 10, 2).getTime();
// R76 fields + Build 2.0 R109 `execution` (how the account sends now).
const ITEM_KEYS = ["alias", "execution", "group", "quota", "waiting_until"];
const QUOTA_KEYS = [
  "additional_expiry_label",
  "additional_remaining_label",
  "additional_used_percent",
  "observed_at",
  "plan",
  "stale",
  "tier",
  "weekly_resets_at",
  "weekly_resets_label",
  "weekly_used_percent",
];

async function setup() {
  h = makeHarness();
  const [A, B, C] = await seedAccounts(h, ["Mây", "Sương", "Gió"]);
  const snapA: Quota = {
    plan: "Free plan",
    usedPercent: 51,
    resetsOn: "Nov 2",
    resetAt: nov2(),
    additional: { usedPercent: 0, remainingLabel: "5B tokens left", remainingApprox: 5e9, expiryLabel: "Never expires" },
    readAt: h.clock.t - 60_000,
    error: "Không đọc được — CANARY-QUOTA-ERR",
    failures: 0,
  };
  h.repo.updateAccount(A, { quota: snapA });
  h.repo.updateAccount(C, { state: "limit_reached", stateUntil: nov2(), quota: { ...snapA, usedPercent: 100, additional: null, limitFrom: "usage" } });
  rig = await makeApi(h);
  return { A, B, C };
}

describe("AC-QTA-12: quota in status (REST + MCP)", () => {
  it("3 items with the R76 fields only; never triggers a Usage read; MCP text summarises it; no key → 401", async () => {
    const { A, B, C } = await setup();
    await settle(h, 3);
    const before = [A, B, C].map((id) => h.fakeCfg(id).quotaReads ?? 0);
    for (const token of [rig!.read, rig!.gen]) {
      const st = await rig!.req("GET", "/v1/status", { token });
      expect(st.status).toBe(200);
      const items = st.json.accounts.items as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(items.map((i) => i.alias)).toEqual(["Mây", "Sương", "Gió"]);
      for (const i of items) {
        expect(Object.keys(i).sort()).toEqual(ITEM_KEYS);
        expect(Object.keys(i.quota).sort()).toEqual(QUOTA_KEYS);
      }
      // This harness has no direct channel, so every account shows the UI path.
      expect(items[0].execution).toMatchObject({ mode: "ui", active_path: "ui", running_http: 0, running_ui: 0, max_concurrent: 10, ui_max_concurrent: 2 });
      const { execution: _e, ...first } = items[0];
      expect(first).toEqual({
        alias: "Mây",
        group: "ready",
        waiting_until: null,
        quota: {
          plan: "Free plan",
          weekly_used_percent: 51,
          weekly_resets_label: "Nov 2",
          weekly_resets_at: new Date(nov2()).toISOString(),
          additional_remaining_label: "5B tokens left",
          additional_used_percent: 0,
          additional_expiry_label: "Never expires",
          observed_at: new Date(h.clock.t - 60_000).toISOString(),
          stale: false,
          tier: "ok",
        },
      });
      expect(items[1].quota).toMatchObject({ tier: "unknown", weekly_used_percent: null, plan: null, observed_at: null, additional_remaining_label: null });
      expect(items[2]).toMatchObject({ group: "waiting", waiting_until: new Date(nov2()).toISOString(), quota: { tier: "exhausted", weekly_used_percent: 100, additional_remaining_label: null } });
      expect(st.body.toString()).not.toContain("CANARY-QUOTA-ERR");
      expect(st.body.toString()).not.toMatch(/proxy|10\.0\.0\.|user0|pass0|limitFrom|failures/i);
    }
    const mcp = await mcpPost(rig!, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_status", arguments: {} } }, { headers: { "mcp-protocol-version": "2025-11-25" } });
    const text = mcp.json.result.content[0].text as string;
    expect(text).toContain("Mây: ready, weekly 51% used (resets Nov 2), additional 5B tokens left");
    expect(text).toContain("Sương: ready, quota not read yet");
    expect(text).toContain("not exact token counts");
    expect(mcp.json.result.structuredContent.accounts.items).toHaveLength(3);
    const after = [A, B, C].map((id) => h.fakeCfg(id).quotaReads ?? 0);
    expect(after).toEqual(before);
    const doc = await rig!.req("GET", "/v1/openapi.json", { token: null });
    expect(doc.json.paths["/v1/status"].get.description).toContain("weekly_used_percent");
    const none = await rig!.req("GET", "/v1/status", { token: null });
    expect(none.status).toBe(401);
  });
});
