import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  apiScopeOf,
  authorizationServerMetadata,
  bearerChallenge,
  cleanClientName,
  digest,
  digestMatches,
  looksLikeJwt,
  numericCode,
  opaque,
  parseForm,
  parseScopes,
  pkceMatches,
  protectedResourceMetadata,
  redirectAllowed,
  scopeText,
  validRedirectUri,
  pkceChallenge,
} from "../src/shared/api/oauth";
import { loadOrCreateKeyPair } from "../src/main/api/oauth/keys";
import { signAccessToken, verifyAccessToken, type AccessClaims } from "../src/main/api/oauth/jwt";
import { openDatabase } from "../src/main/db";
import { makeApi, mcpPost, type ApiRig } from "./apiHelpers";
import { makeHarness, sqlite } from "./helpers";

// Build 3.1 — the app's own OAuth 2.1 server (spec rev 8 R131–R141, spec rev 9 AC-OAS-*).
// Each install signs its own tokens, there are no client secrets, and nothing is granted until the six-digit
// code the app window shows is typed into the consent page in the browser.

describe("AC-OAS-01 — redirect URIs, PKCE and scopes are decided before anything is shown", () => {
  it("accepts https and loopback http, refuses everything else", () => {
    expect(validRedirectUri("https://chatgpt.com/connector/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:8765/callback")).toBe(true);
    expect(validRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(validRedirectUri("http://evil.test/cb")).toBe(false);
    expect(validRedirectUri("https://app.test/cb#frag")).toBe(false);
    expect(validRedirectUri("not a url")).toBe(false);
  });

  it("matches a registered redirect URI exactly — no prefix tricks", () => {
    const uris = ["https://app.example.com/cb"];
    expect(redirectAllowed(uris, "https://app.example.com/cb")).toBe(true);
    expect(redirectAllowed(uris, "https://app.example.com/cb?x=1")).toBe(false);
    expect(redirectAllowed(uris, "https://app.example.com.evil.test/cb")).toBe(false);
    expect(redirectAllowed(uris, "http://app.example.com/cb")).toBe(false);
    expect(redirectAllowed([], "https://app.example.com/cb")).toBe(false);
  });

  it("S256 only: the verifier must hash to the challenge the request carried", () => {
    const v = opaque(32);
    const c = pkceChallenge(v, "S256")!;
    expect(pkceMatches(v, c, "S256")).toBe(true);
    expect(pkceMatches("x" + v, c, "S256")).toBe(false);
    expect(pkceMatches(v, c, "plain")).toBe(false);
    expect(pkceMatches("", c, "S256")).toBe(false);
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(pkceChallenge(v, "plain")).toBeNull();
  });

  it("unknown scope words grant nothing, and read/generate map onto the app's own scope names", () => {
    expect(parseScopes("read generate delete")).toEqual(["read", "generate"]);
    expect(parseScopes(null)).toEqual([]);
    expect(scopeText(["generate", "read"]).split(" ").sort()).toEqual(["generate", "read"]);
    expect(apiScopeOf(["generate"])).toBe("generate");
    expect(apiScopeOf(["read"])).toBe("read");
    expect(apiScopeOf([])).toBe("read");
  });

  it("a client name is one clean line, and a missing one gets a neutral label", () => {
    expect(cleanClientName("  My\n Agent <b>  ")).toBe("My Agent b");
    expect(cleanClientName("")).toBe("Ứng dụng agent");
    expect(cleanClientName("x".repeat(200))).toHaveLength(60);
  });

  it("code digests decide equality, and a pairing code is always six digits", () => {
    expect(digestMatches("123456", digest("123456"))).toBe(true);
    expect(digestMatches("123456", digest("654321"))).toBe(false);
    for (let i = 0; i < 200; i++) expect(numericCode(6)).toMatch(/^[0-9]{6}$/);
    expect(looksLikeJwt("a.b.c")).toBe(true);
    expect(looksLikeJwt("msk_abcdef")).toBe(false);
    expect(parseForm("a=1&b=x%2Fy").b).toBe("x/y");
  });

  it("discovery only advertises what this server actually does", () => {
    const as = authorizationServerMetadata("https://muse.example");
    expect(as.issuer).toBe("https://muse.example");
    expect(as.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as).not.toHaveProperty("device_authorization_endpoint");
    expect(as).not.toHaveProperty("introspection_endpoint");
    expect(Object.keys(as).sort()).toEqual(
      [
        "authorization_endpoint", "code_challenge_methods_supported", "grant_types_supported", "issuer", "jwks_uri",
        "registration_endpoint", "response_types_supported", "revocation_endpoint", "scopes_supported",
        "service_documentation", "token_endpoint", "token_endpoint_auth_methods_supported",
        "token_endpoint_auth_signing_alg_values_supported",
      ].sort(),
    );
    const pr = protectedResourceMetadata("https://muse.example");
    expect(pr.resource).toBe("https://muse.example/mcp"); // RFC 9728: the resource is the MCP endpoint itself
    expect(pr.authorization_servers).toEqual(["https://muse.example"]);
    expect(bearerChallenge("https://muse.example", "invalid_token")).toContain(
      'error="invalid_token", resource_metadata="https://muse.example/.well-known/oauth-protected-resource"',
    );
  });
});

describe("AC-OAS-02 — every install signs its own tokens", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      set: (k: string, v: string) => void m.set(k, v),
      get: (k: string) => m.get(k) ?? null,
      delete: (k: string) => void m.delete(k),
    };
  };

  it("the same key pair comes back after a restart, and a foreign key pair cannot verify its token", () => {
    const vault = store();
    const k1 = loadOrCreateKeyPair(vault);
    expect(loadOrCreateKeyPair(vault).kid).toBe(k1.kid);
    expect(vault.get("oauth-es256")).toBeTruthy();
    const other = loadOrCreateKeyPair(store());
    expect(other.kid).not.toBe(k1.kid);

    const claims: AccessClaims = {
      iss: "https://muse.example", aud: "https://muse.example", sub: "oc_1", client_id: "oc_1",
      scope: "read generate", iat: 1_000, exp: 2_000, jti: "tok_1",
    };
    const token = signAccessToken(k1, claims);
    const expect_ = { iss: "https://muse.example", aud: "https://muse.example" };
    expect(verifyAccessToken(token, k1, { ...expect_, now: 1_500_000 }).ok).toBe(true);
    expect(verifyAccessToken(token, other, { ...expect_, now: 1_500_000 })).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyAccessToken(token, k1, { iss: "https://other.example", aud: "https://other.example", now: 1_500_000 }).ok).toBe(false);
    expect(verifyAccessToken(token, k1, { ...expect_, now: 2_100_000 }).ok).toBe(false);
    expect(verifyAccessToken(token + "x", k1, { ...expect_, now: 1_500_000 }).ok).toBe(false);
    expect(verifyAccessToken(token, k1, { ...expect_, now: 1_500_000, revokedDigest: () => true }).ok).toBe(false);
  });

  it("publishes the public key as a JWK a client can verify with (thumbprint = kid)", () => {
    const k = loadOrCreateKeyPair(store());
    expect(k.jwk.kid).toBe(k.kid);
    expect(k.jwk.kty).toBe("EC");
    expect(k.jwk.crv).toBe("P-256");
    expect(k.jwk.x.length).toBeGreaterThan(10);
    expect(k.jwk.y.length).toBeGreaterThan(10);
  });
});

describe("AC-OAS-03 — the connection flow over HTTP", () => {
  const cb = "https://connector.test/cb";
  const form = (rig: ApiRig, route: string, body: Record<string, string>) =>
    rig.req("POST", route, {
      body: new URLSearchParams(body).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: rig.base, "accept-language": "en" },
    });

  async function start(rig: ApiRig, scope = "read generate") {
    const reg = await rig.req("POST", "/oauth/register", { json: { client_name: "Test Agent", redirect_uris: [cb], scope } });
    expect(reg.status).toBe(201);
    expect(reg.json.token_endpoint_auth_method).toBe("none");
    const clientId = reg.json.client_id as string;
    expect(clientId).toMatch(/^oc_/);
    const v = opaque(32);
    const q = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: cb, scope, state: "st-7",
      code_challenge: pkceChallenge(v, "S256")!, code_challenge_method: "S256",
    });
    const page = await rig.req("GET", `/oauth/authorize?${q}`, { headers: { "accept-language": "en" } });
    expect(page.status).toBe(200);
    const html = page.body.toString();
    expect(html).toContain('name="pairing"');
    const pending = rig.api.oauth.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].pairing).toMatch(/^[0-9]{6}$/);
    expect(pending[0].clientName).toBe("Test Agent");
    return { clientId, verifier: v, consentId: pending[0].id, pairing: pending[0].pairing, html };
  }

  async function approve(rig: ApiRig, s: Awaited<ReturnType<typeof start>>) {
    const out = await form(rig, "/oauth/authorize", { authorization_id: s.consentId, decision: "approve", pairing: s.pairing });
    expect(out.status).toBe(302);
    const loc = new URL(out.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(cb);
    expect(loc.searchParams.get("state")).toBe("st-7");
    return loc.searchParams.get("code")!;
  }

  it("shows no consent page for an unknown app, a missing PKCE challenge or an unregistered redirect", async () => {
    const rig = await makeApi(await makeHarness());
    const unknown = await rig.req("GET", `/oauth/authorize?response_type=code&client_id=oc_nope&redirect_uri=${encodeURIComponent(cb)}`, {
      headers: { "accept-language": "en" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.toString()).toContain("Unknown app");

    const reg = await rig.req("POST", "/oauth/register", { json: { client_name: "Test Agent", redirect_uris: [cb] } });
    const id = reg.json.client_id as string;
    const noPkce = await rig.req("GET", `/oauth/authorize?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent(cb)}`, {
      headers: { "accept-language": "en" },
    });
    expect(noPkce.status).toBe(400);
    expect(noPkce.body.toString()).toContain("PKCE is required");

    const badRedirect = await rig.req(
      "GET",
      `/oauth/authorize?response_type=code&client_id=${id}&redirect_uri=${encodeURIComponent("https://elsewhere.test/cb")}&code_challenge=abc&code_challenge_method=S256`,
      { headers: { "accept-language": "en" } },
    );
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.body.toString()).toContain("redirect_uri does not match");
    expect(rig.api.oauth.pending()).toHaveLength(0);
    await rig.close();
  });

  it("a wrong code keeps the page open with one try fewer; the right code issues a single-use code", async () => {
    const rig = await makeApi(await makeHarness());
    const s = await start(rig);
    expect(s.html).not.toContain(s.pairing); // the page never carries the code — only the app window shows it

    const wrong = await form(rig, "/oauth/authorize", { authorization_id: s.consentId, decision: "approve", pairing: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.toString()).toContain("That code is not right");
    expect(rig.api.oauth.pending()[0].triesLeft).toBe(4);

    const code = await approve(rig, s);
    expect(code).toHaveLength(43); // opaque(32) base64url
    expect(rig.api.oauth.pending()).toHaveLength(0);

    const tok = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    expect(tok.status).toBe(200);
    expect(tok.json.token_type).toBe("Bearer");
    expect(tok.json.expires_in).toBe(3600);
    expect(tok.json.scope).toBe("read generate");
    expect(looksLikeJwt(tok.json.access_token as string)).toBe(true);

    const spent = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    expect(spent.status).toBe(400);
    expect(spent.json.error).toBe("invalid_grant");
    await rig.close();
  });

  it("the token opens MCP, a failed PKCE check burns the code, and a bare call gets the discovery challenge", async () => {
    const rig = await makeApi(await makeHarness());
    const s = await start(rig);
    const code = await approve(rig, s);

    const liar = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: "x".repeat(64) });
    expect(liar.status).toBe(400);
    expect(liar.json.error).toBe("invalid_grant");
    // a client that failed the PKCE check gets no second try with the same code
    const retry = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    expect(retry.status).toBe(400);
    expect(retry.json.error).toBe("invalid_grant");

    const again = await start(rig);
    const code2 = await approve(rig, again);
    const tok = await form(rig, "/oauth/token", { grant_type: "authorization_code", code: code2, redirect_uri: cb, code_verifier: again.verifier });
    const access = tok.json.access_token as string;
    expect(rig.api.oauth.context(access, rig.base)).toMatchObject({ name: "Test Agent", scope: "generate", oauth: true });

    const ok = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: access });
    expect(ok.status).toBe(200);
    expect(ok.body.toString()).toContain("muse_");

    const anon = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: null });
    expect(anon.status).toBe(401);
    expect(String(anon.headers["www-authenticate"])).toContain(`${rig.base}/.well-known/oauth-protected-resource`);
    await rig.close();
  });

  it("a read-only connection cannot pass the app's generate check", async () => {
    const rig = await makeApi(await makeHarness());
    const s = await start(rig, "read");
    const code = await approve(rig, s);
    const tok = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    expect(rig.api.oauth.context(tok.json.access_token as string, rig.base)).toMatchObject({ scope: "read" });
    await rig.close();
  });

  it("refresh rotates the token, and reusing a rotated one past its grace closes the whole family", async () => {
    const h = await makeHarness();
    const rig = await makeApi(h);
    const s = await start(rig);
    const code = await approve(rig, s);
    const tok = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    const access = tok.json.access_token as string;
    const r1 = tok.json.refresh_token as string;

    const r2 = (await form(rig, "/oauth/token", { grant_type: "refresh_token", refresh_token: r1 })).json.refresh_token as string;
    expect(r2).toBeTruthy();
    expect(r2).not.toBe(r1);
    // inside the 60 s grace a client that retried with the old token is still served
    const r3 = (await form(rig, "/oauth/token", { grant_type: "refresh_token", refresh_token: r1 })).json.refresh_token as string;
    expect(r3).toBeTruthy();
    expect(rig.api.oauth.context(access, rig.base)).not.toBeNull();

    // past the grace window, one reused token means the family leaked: everything in it dies (R138)
    h.clock.t += 61_000;
    const reuse = await form(rig, "/oauth/token", { grant_type: "refresh_token", refresh_token: r1 });
    expect(reuse.status).toBe(400);
    expect(reuse.json.error).toBe("invalid_grant");
    const alsoDead = await form(rig, "/oauth/token", { grant_type: "refresh_token", refresh_token: r2 });
    expect(alsoDead.status).toBe(400);
    expect(rig.api.oauth.context(access, rig.base)).toBeNull();
    await rig.close();
  });

  it("removing the app in the window blocks its tokens at the next call", async () => {
    const rig = await makeApi(await makeHarness());
    const s = await start(rig);
    const code = await approve(rig, s);
    const tok = await form(rig, "/oauth/token", { grant_type: "authorization_code", code, redirect_uri: cb, code_verifier: s.verifier });
    const access = tok.json.access_token as string;
    expect(rig.api.oauth.context(access, rig.base)).not.toBeNull();
    expect(rig.api.oauth.clients().map((c) => c.name)).toEqual(["Test Agent"]);

    rig.api.revokeClient(s.clientId);
    expect(rig.api.oauth.context(access, rig.base)).toBeNull();
    expect(rig.api.oauth.clients()).toHaveLength(0);
    const blocked = await mcpPost(rig, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { token: access });
    expect(blocked.status).toBe(401);
    await rig.close();
  });

  it("the app window lists what is waiting and what is connected", async () => {
    const rig = await makeApi(await makeHarness());
    const s = await start(rig);
    const st = rig.api.status();
    expect(st.oauth?.pending[0]).toMatchObject({ clientName: "Test Agent", pairing: s.pairing, triesLeft: 5 });
    expect(st.oauth?.pending[0].redirectHost).toBe("https://connector.test");
    expect(st.oauth?.clients[0]).toMatchObject({ name: "Test Agent", scope: ["read", "generate"], activeTokens: 0 });

    const dismissed = rig.api.dismissConsent(s.consentId);
    expect(dismissed.oauth?.pending).toHaveLength(0);
    await rig.close();
  });
});

describe("AC-OAS-04 — migration 6 creates the OAuth tables", () => {
  it("a store opened from schema 5 gains the four OAuth tables and keeps its rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-oauth-"));
    const file = path.join(dir, "data", "muse.sqlite");
    const backups = path.join(dir, "backups");
    const v5 = openDatabase(sqlite, file, backups, { targetVersion: 5 });
    v5.db.prepare("INSERT INTO accounts(id,alias,alias_key,state,capabilities,created_at,rev) VALUES('a1','Mây','mây','ready','{}',1,1)").run();
    v5.db.close();

    const v6 = openDatabase(sqlite, file, backups);
    expect(v6.migratedFrom).toBe(5);
    const tables = (v6.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'oauth_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["oauth_clients", "oauth_codes", "oauth_consents", "oauth_tokens"]);
    expect((v6.db.prepare("SELECT alias FROM accounts WHERE id='a1'").get() as { alias: string }).alias).toBe("Mây");
    v6.db.close();
  });

  it("a fresh store already has them, empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-oauth2-"));
    const r = openDatabase(sqlite, path.join(dir, "muse.sqlite"), path.join(dir, "b"));
    for (const t of ["oauth_clients", "oauth_codes", "oauth_tokens", "oauth_consents"]) {
      expect((r.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c).toBe(0);
    }
    r.db.close();
  });
});
