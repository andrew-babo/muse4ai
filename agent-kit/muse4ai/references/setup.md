# Connect to Muse4AI

Muse4AI runs on the user's Windows PC. It offers:

- an MCP server at `http://127.0.0.1:47821/mcp` (default port; the user can change it in Settings › API & agent);
- a REST API at `http://127.0.0.1:47821/v1`.

Every request needs the header `Authorization: Bearer msk_YOUR_KEY`. The user creates the key in Muse4AI › Settings › API & agent and sees it only once. Never ask the user to paste the key into chat if their client has a secure place for it; never put it in a URL.

## Agent on the same PC

Use the local address. Examples (replace `msk_YOUR_KEY`):

Claude Code:

```bash
claude mcp add --transport http muse4ai http://127.0.0.1:47821/mcp --header "Authorization: Bearer msk_YOUR_KEY"
```

Cursor, LM Studio, Cline (`mcp.json`):

```json
{ "mcpServers": { "muse4ai": { "url": "http://127.0.0.1:47821/mcp", "headers": { "Authorization": "Bearer msk_YOUR_KEY" } } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.muse4ai]
url = "http://127.0.0.1:47821/mcp"
http_headers = { Authorization = "Bearer msk_YOUR_KEY" }
```

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "muse4ai": { "type": "http", "url": "http://127.0.0.1:47821/mcp", "headers": { "Authorization": "Bearer msk_YOUR_KEY" } } } }
```

## Agent in the cloud (Claude app, Lovable, Manus, n8n cloud)

These connect from the vendor's servers, so `127.0.0.1` does not work. The user turns on remote access in Muse4AI (Quick tunnel, a named tunnel or their own domain) and gives you the public address, for example `https://your-tunnel.trycloudflare.com/mcp`. A Quick tunnel address changes every time the app starts. The key is still required.

## OAuth (no key)

Muse4AI is its own OAuth 2.1 server (discovery, dynamic client registration, PKCE S256). Clients that support MCP OAuth — ChatGPT connectors, the Claude app, Claude Code, Codex (`codex mcp login muse4ai`), Cursor, VS Code — need only the `/mcp` address. The user approves on a Muse4AI consent page by typing the 6-digit code shown in the Muse4AI window; there is no account or password. Access tokens last 1 hour with rotating refresh tokens; the user can disconnect an app in Settings › API & agent › Connected apps.

## Check the connection

Call `muse_status`. Unauthorized means the key is missing or wrong; a connection error means Muse4AI is closed, the API server is off in Settings › API & agent, or the port differs.
