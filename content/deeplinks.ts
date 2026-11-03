import type { Agent } from "./types";

/**
 * One-click install links in each vendor's documented format (R3-AG.7,
 * AC-WEB-AG-06). The server entry is taken from the agent's own config text so
 * the link and the copy-paste snippet can never differ. Always a placeholder key.
 */

function b64(text: string): string {
  // Config text is ASCII (URLs, header names, msk_YOUR_KEY).
  return btoa(text);
}

/** The "muse4ai" server object inside the agent's JSON config. */
export function serverEntry(agent: Agent): Record<string, unknown> | undefined {
  if (!agent.config) return undefined;
  if (agent.config.format !== "json-mcpServers" && agent.config.format !== "json-vscode") return undefined;
  const parsed = JSON.parse(agent.config.text) as Record<string, Record<string, Record<string, unknown>>>;
  const group = agent.config.format === "json-vscode" ? parsed["servers"] : parsed["mcpServers"];
  return group?.["muse4ai"];
}

export function deeplink(agent: Agent): string | undefined {
  const entry = serverEntry(agent);
  if (!entry || !agent.deeplink) return undefined;
  const json = JSON.stringify(entry);
  switch (agent.deeplink) {
    case "cursor":
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=muse4ai&config=${encodeURIComponent(b64(json))}`;
    case "lmstudio":
      return `lmstudio://add_mcp?name=muse4ai&config=${encodeURIComponent(b64(json))}`;
    case "vscode":
      return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "muse4ai", ...entry }))}`;
  }
}

/** Reverses deeplink() for tests. */
export function decodeDeeplink(link: string): Record<string, unknown> {
  if (link.startsWith("vscode:mcp/install?")) {
    const obj = JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length))) as Record<string, unknown>;
    const { name: _name, ...rest } = obj;
    return rest;
  }
  const config = new URL(link.replace(/^[a-z]+:\/\//, "https://x/")).searchParams.get("config") ?? "";
  return JSON.parse(atob(config)) as Record<string, unknown>;
}
