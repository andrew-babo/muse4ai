import { afterEach, describe, expect, it } from "vitest";
import { setLocale, tl } from "../src/shared/i18n";
import { JOB_LABEL } from "../src/shared/jobMachine";
import type { JobState } from "../src/shared/types";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";
import { makeHarness, seedAccounts, type Harness } from "./helpers";

// Build 2.0 R122 / AC-I18N-06 — `detail` of REST and MCP errors follows Accept-Language (vi/en), else the app language;
// `code`, HTTP status and title never change.

let h: Harness;
let rig: ApiRig | null = null;
afterEach(async () => {
  setLocale("vi");
  await rig?.close();
  rig = null;
  if (h) {
    await h.coord.stop();
    h.close();
  }
});

const VI_MARKS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

describe("AC-I18N-06 REST problem detail language", () => {
  it("Accept-Language en / vi / absent (app Vietnamese, then app English)", async () => {
    h = makeHarness();
    rig = await makeApi(h, { failDelayMs: 0 });
    const wrong = rig.gen.slice(0, -2) + "zz";
    const en = await rig.req("GET", "/v1/status", { token: wrong, headers: { "accept-language": "en-US,en;q=0.9" } });
    const vi = await rig.req("GET", "/v1/status", { token: wrong, headers: { "accept-language": "vi-VN" } });
    const none = await rig.req("GET", "/v1/status", { token: wrong });
    expect(en.json.detail).toBe("Invalid or revoked API key");
    expect(vi.json.detail).toBe("Khoá API sai hoặc đã bị thu hồi");
    expect(none.json.detail).toBe("Khoá API sai hoặc đã bị thu hồi");
    for (const r of [en, vi, none]) expect(r.json).toMatchObject({ status: 401, code: "invalid_api_key", title: "Invalid API key" });
    setLocale("en");
    const appEn = await rig.req("GET", "/v1/status", { token: wrong });
    expect(appEn.json.detail).toBe("Invalid or revoked API key");
    const forcedVi = await rig.req("GET", "/v1/status", { token: wrong, headers: { "accept-language": "fr, vi;q=0.5" } });
    expect(forcedVi.json.detail).toBe("Khoá API sai hoặc đã bị thu hồi");
  });

  it("validation messages inside `errors[]` follow the same language", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const r = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image" }, headers: { "accept-language": "en" } });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("invalid_request");
    expect(r.json.detail).not.toMatch(VI_MARKS);
    for (const e of r.json.errors ?? []) expect(e.message).not.toMatch(VI_MARKS);
  });
});

describe("AC-I18N-06 MCP tool error language", () => {
  it("isError text and structured detail follow Accept-Language; code unchanged", async () => {
    h = makeHarness();
    await seedAccounts(h, ["Mây"]);
    rig = await makeApi(h);
    const call = (lang?: string) =>
      mcpPost(rig!, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "muse_generate", arguments: { kind: "image", prompt: "x" } } }, { token: rig!.read, headers: lang ? { "accept-language": lang } : {} });
    const en = (await call("en")).json.result;
    const vi = (await call("vi")).json.result;
    expect(en.isError).toBe(true);
    expect(vi.isError).toBe(true);
    const enText = (en.content as { text: string }[])[0].text;
    const viText = (vi.content as { text: string }[])[0].text;
    expect(enText).toMatch(/^insufficient_scope: /);
    expect(viText).toMatch(/^insufficient_scope: /);
    expect(enText).not.toMatch(VI_MARKS);
    expect(viText).toMatch(VI_MARKS);
    expect(enText).not.toBe(viText);
  });
});

describe("R122 job views follow the caller's language", () => {
  // The fake scheduler moves the job on while the test reads it, so every label is checked against the state in the
  // same response: English for `en`, Vietnamese for `vi` and for no header (app Vietnamese).
  const EN: Record<string, string> = { "Đang chờ": "Waiting", Xong: "Done" };
  it("label/note in REST job JSON and MCP text: Accept-Language en → English, vi/absent (app Vietnamese) → Vietnamese; status unchanged", async () => {
    h = makeHarness();
    rig = await makeApi(h, { failDelayMs: 0 });
    await seedAccounts(h, ["A"]);
    const made = await rig.req("POST", "/v1/jobs", { token: rig.gen, json: { kind: "image", prompt: "Một chiếc thuyền giấy" } });
    expect(made.status).toBe(202);
    const id = made.json.jobs[0].id as string;
    const get = (lang?: string) => rig!.req("GET", `/v1/jobs/${id}`, { token: rig!.gen, headers: lang ? { "accept-language": lang } : {} });
    for (const r of [await get("en"), await get("en-US,en;q=0.9")]) {
      expect(r.json.label).toBe(tl("en", JOB_LABEL[r.json.state as JobState]));
      expect(r.json.label).not.toMatch(VI_MARKS);
    }
    for (const r of [await get("vi"), await get()]) expect(r.json.label).toBe(JOB_LABEL[r.json.state as JobState]);
    // Concrete values the agent sees for the two states this job passes through.
    expect(tl("en", JOB_LABEL.queued)).toBe(EN["Đang chờ"]);
    expect(tl("en", JOB_LABEL.completed)).toBe(EN.Xong);
    const list = await rig.req("GET", "/v1/jobs?limit=5", { token: rig.gen, headers: { "accept-language": "en-US" } });
    const row = list.json.jobs.find((j: { id: string }) => j.id === id);
    expect(row.label).toBe(tl("en", JOB_LABEL[row.state as JobState]));
    for (const lang of ["en", "vi"] as const) {
      const res = await mcpPost(rig, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "muse_get_job", arguments: { job_id: id } } }, { headers: { "accept-language": lang } });
      const text = (res.json.result.content as { text: string }[])[0].text;
      const state = /"state":"(\w+)"/.exec(text)![1] as JobState;
      const want = lang === "en" ? tl("en", JOB_LABEL[state]) : JOB_LABEL[state];
      expect(text.split("\n")[0]).toContain(`(${want})`);
    }
  });
});
