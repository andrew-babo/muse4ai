import { afterEach, describe, expect, it } from "vitest";
import { namesSummary, proxyChoices, proxyUsers, suggestProxy, usedProxyCount } from "../src/shared/proxyShare";
import { makeHarness, seedAccounts, settle, textJob, type Harness } from "./helpers";

// Build 3.2 spec R142–R147 — a proxy may serve several accounts; everyone can see who uses it.

const px = (id: string, latencyMs: number | null, health = "healthy") => ({ id, label: id, health, latencyMs });
const acc = (id: string, alias: string, proxyId: string | null, createdAt: number) => ({ id, alias, proxyId, createdAt });

describe("proxy choices and labels — AC-PRXS-08", () => {
  const proxies = [px("P01", 50), px("P02", 200), px("P03", 300), px("P04", 90)];
  const accounts = [acc("a1", "Mây", "P01", 1), acc("a2", "Gió", "P01", 2), acc("a3", "Nắng", "P02", 3)];

  it("lists unused proxies first (lowest latency first), then fewer users first", () => {
    const order = proxyChoices(proxies, accounts).map((c) => [c.proxy.id, c.users.map((u) => u.alias)]);
    expect(order).toEqual([
      ["P04", []],
      ["P03", []],
      ["P02", ["Nắng"]],
      ["P01", ["Mây", "Gió"]],
    ]);
  });

  it("names at most two users, then +N", () => {
    expect(namesSummary(["Nắng"])).toBe("Nắng");
    expect(namesSummary(["Mây", "Gió"])).toBe("Mây, Gió");
    expect(namesSummary(["Mây", "Gió", "Nắng"])).toBe("Mây, Gió +1");
    expect(namesSummary(["Mây", "Gió", "Nắng", "Mưa", "Trăng"])).toBe("Mây, Gió +3");
  });

  it("leaves the edited account out of its own proxy's users and keeps users oldest first", () => {
    expect(proxyUsers("P01", accounts, "a1").map((a) => a.alias)).toEqual(["Gió"]);
    const forGio = proxyChoices(proxies, accounts, { forAccountId: "a2" });
    expect(forGio.find((c) => c.proxy.id === "P01")!.users.map((u) => u.alias)).toEqual(["Mây"]);
  });

  it("healthyOnly drops failed/untested proxies (add-account rule); the used count counts proxies with ≥ 1 account", () => {
    const withBad = [...proxies, px("P05", 10, "failed"), px("P06", null, "untested")];
    expect(proxyChoices(withBad, accounts, { healthyOnly: true }).map((c) => c.proxy.id)).toEqual(["P04", "P03", "P02", "P01"]);
    expect(usedProxyCount(withBad, accounts)).toBe(2);
  });

  it("never suggests a shared proxy (AC-PRXS-03, pure part)", () => {
    expect(suggestProxy(proxies, accounts)?.id).toBe("P04");
    const all = [...accounts, acc("a4", "Mưa", "P03", 4), acc("a5", "Trăng", "P04", 5)];
    expect(suggestProxy(proxies, all)).toBeNull();
  });
});

describe("coordinator with shared proxies", () => {
  let h: Harness;
  afterEach(() => h?.close());

  it("AC-PRXS-01: a new account may use a proxy another account already uses", async () => {
    h = makeHarness();
    const [may] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(may)!.proxyId!;
    const gio = h.coord.addAccount({ alias: "Gió", avatar: 1, proxyId: p01 });
    expect(gio.proxyId).toBe(p01);
    expect(h.repo.accountsOnProxy(p01).map((a) => a.alias).sort()).toEqual(["Gió", "Mây"]);
  });

  it("AC-PRXS-03: without a choice the app picks the fastest unused proxy, and refuses rather than share", async () => {
    h = makeHarness();
    h.coord.importProxies(["10.0.1.1:8080", "10.0.1.2:8080", "10.0.1.3:8080"].join("\n"));
    const [p1, p2, p3] = h.repo.listProxies();
    for (const [p, ms] of [[p1, 50], [p2, 300], [p3, 120]] as const) h.repo.updateProxy(p.id, { health: "healthy", latencyMs: ms });
    const may = h.coord.addAccount({ alias: "Mây", avatar: 0, proxyId: p1.id });
    expect(may.proxyId).toBe(p1.id);
    expect(h.coord.addAccount({ alias: "Gió", avatar: 0 }).proxyId).toBe(p3.id);
    expect(h.coord.addAccount({ alias: "Nắng", avatar: 0 }).proxyId).toBe(p2.id);
    expect(() => h.coord.addAccount({ alias: "Mưa", avatar: 0 })).toThrow("Chưa có proxy khoẻ nào trống — nhập proxy trước");
    expect(h.repo.listAccounts().map((a) => a.alias)).toEqual(["Mây", "Gió", "Nắng"]);
  });

  it("a shared proxy still has to be healthy to start a new account", async () => {
    h = makeHarness();
    const [may] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(may)!.proxyId!;
    h.repo.updateProxy(p01, { health: "failed" });
    expect(() => h.coord.addAccount({ alias: "Gió", avatar: 0, proxyId: p01 })).toThrow("Proxy chưa được kiểm hoặc đang lỗi");
  });

  it("AC-PRXS-02: moving B onto A's proxy frees B's old proxy and leaves A alone", async () => {
    h = makeHarness();
    const [A, B] = await seedAccounts(h, ["Mây", "Gió"]);
    const pA = h.repo.getAccount(A)!.proxyId!;
    const pB = h.repo.getAccount(B)!.proxyId!;
    expect((await h.coord.setAccountProxy(B, pA)).changed).toBe(true);
    expect(h.repo.getAccount(A)!.proxyId).toBe(pA);
    expect(h.repo.getAccount(B)!.proxyId).toBe(pA);
    expect(h.repo.accountsOnProxy(pB)).toEqual([]);
  });

  it("AC-PRXS-05: a successful re-test brings back every account stopped on that proxy", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(A)!.proxyId!;
    const B = h.coord.addAccount({ alias: "Gió", avatar: 0, proxyId: p01 }).id;
    for (const id of [A, B]) h.repo.updateAccount(id, { state: "proxy_error", stateNote: "Proxy không kết nối được" });
    await h.coord.testProxy(p01);
    await settle(h, 3);
    expect([h.repo.getAccount(A)!.state, h.repo.getAccount(B)!.state].every((s) => s !== "proxy_error")).toBe(true);
    expect(h.repo.getAccount(B)!.stateNote).toBeNull();
  });

  it("AC-PRXS-06: unassign takes the proxy off every account, or off none while one works", async () => {
    h = makeHarness({ cfg: () => ({ generateDelayMs: 3000 }) });
    const [A] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(A)!.proxyId!;
    const B = h.coord.addAccount({ alias: "Gió", avatar: 0, proxyId: p01 }).id;
    h.repo.updateAccount(B, { state: "ready" });
    h.repo.updateAccount(A, { state: "paused" });
    h.coord.createJobs(textJob("đang chạy", { accountPref: B }));
    for (let i = 0; i < 20 && h.repo.getAccount(B)!.state !== "busy"; i++) {
      h.coord.runScheduler();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(() => h.coord.unassignProxy(p01)).toThrow("Tài khoản đang làm việc");
    expect(h.repo.accountsOnProxy(p01).map((a) => a.alias).sort()).toEqual(["Gió", "Mây"]);
    expect(() => h.coord.removeProxy(p01)).toThrow("Proxy đang dùng cho Gió khi tài khoản đang chạy");
  });

  it("AC-PRXS-06: unassign on an idle shared proxy clears both accounts; delete then works", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(A)!.proxyId!;
    const B = h.coord.addAccount({ alias: "Gió", avatar: 0, proxyId: p01 }).id;
    h.coord.unassignProxy(p01);
    expect([h.repo.getAccount(A)!.proxyId, h.repo.getAccount(B)!.proxyId]).toEqual([null, null]);
    h.coord.removeProxy(p01);
    expect(h.repo.getProxy(p01)).toBeNull();
  });

  it("AC-PRXS-07: removing one account keeps the other on the shared proxy", async () => {
    h = makeHarness();
    const [A] = await seedAccounts(h, ["Mây"]);
    const p01 = h.repo.getAccount(A)!.proxyId!;
    const B = h.coord.addAccount({ alias: "Gió", avatar: 0, proxyId: p01 }).id;
    h.repo.updateAccount(A, { state: "paused" });
    expect((await h.coord.removeAccount(A)).removed).toBe(true);
    expect(h.repo.getAccount(B)!.proxyId).toBe(p01);
    expect(h.repo.accountsOnProxy(p01).map((a) => a.alias)).toEqual(["Gió"]);
  });
});
