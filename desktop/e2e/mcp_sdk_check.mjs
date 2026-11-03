// AC-MCP-02/03 (V): the official MCP TypeScript SDK talks to a running Muse4AI over Streamable HTTP with a Bearer key.
// Usage (from desktop/): node e2e/mcp_sdk_check.mjs <label> <baseUrl> <keyFile> <skillMdPath>
// Prints PASS/FAIL lines only; never prints the key.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [label, base, keyFile, skillPath] = process.argv.slice(2);
const key = readFileSync(keyFile, "utf8").trim();
const skill = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
const body = skill.replace(/^---\n[\s\S]*?\n---\n+/, "");
let fails = 0;
const check = (id, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${id} [${label}] ${detail}`); };

async function connect(token) {
  const client = new Client({ name: "muse4ai-lab-check", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", base), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return client;
}

try {
  const t0 = Date.now();
  const c = await connect(key);
  const tools = await c.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const res = await c.listResources();
  const guide = res.resources.find((r) => r.uri === "muse4ai://guide");
  const read = await c.readResource({ uri: "muse4ai://guide" });
  const text = read.contents?.[0]?.text ?? "";
  check("AC-MCP-02", !!guide && guide.mimeType === "text/markdown" && text === body && names.length > 0, `tools=${names.length} (${names.slice(0, 6).join(",")}…) guide=${guide?.mimeType} body match=${text === body} (${text.length} chars)`);
  const st = await c.callTool({ name: "muse_status", arguments: {} });
  const out = st.content?.find((x) => x.type === "text")?.text ?? "";
  check("AC-MCP-03 muse_status", !st.isError && out.length > 0, `isError=${!!st.isError} ${Date.now() - t0} ms, ${out.length} chars`);
  await c.close();
} catch (e) {
  check("AC-MCP-02/03 connect", false, String(e).slice(0, 200));
}
try {
  const r = await fetch(new URL("/mcp", base), { method: "POST", headers: { Authorization: "Bearer msk_wrongwrongwrongwrongwrong", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  let sdkRefused = false;
  try { await connect("msk_wrongwrongwrongwrongwrong"); } catch (e) { sdkRefused = /401|nauthorized/i.test(String(e)); }
  check("AC-MCP-03 wrong key", r.status === 401 && sdkRefused, `HTTP ${r.status}; SDK refused with 401: ${sdkRefused}`);
} catch (e) {
  check("AC-MCP-03 wrong key", false, String(e).slice(0, 200));
}
process.exit(fails ? 1 : 0);
