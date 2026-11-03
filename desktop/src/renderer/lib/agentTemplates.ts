// Ready-to-paste connection snippets for common agents (screens §10 card 4, S09e). Pure: base URL + key in, text out.
import type { AgentUrl } from "@shared/types";
import { t } from "@shared/i18n";
import { BRAND } from "@shared/brand";

export interface AgentTemplate {
  id: string;
  label: string;
  /** Short Vietnamese note shown above the snippet. */
  note: string;
  code: string;
  /** Needs a public (Internet) address to work from another machine/cloud service. */
  needsPublic?: boolean;
}

export const KEY_PLACEHOLDER = "{API_KEY}";

export function agentTemplates(base: string, key: string = KEY_PLACEHOLDER): AgentTemplate[] {
  const mcp = `${base}/mcp`;
  return [
    {
      id: "oauth",
      label: t("Không cần khoá (OAuth)"),
      note: t("Dán địa chỉ này vào app là xong. Khi app hỏi cách đăng nhập, chọn OAuth rồi gõ mã 6 số đang hiện trong cửa sổ Muse4AI — không phải đưa khoá API cho ai."),
      code: [
        mcp,
        "",
        t("# Claude Code"),
        `claude mcp add --transport http muse4ai ${mcp}`,
        "",
        t("# Codex CLI (mở Codex rồi chạy: codex mcp login muse4ai)"),
        `codex mcp add muse4ai --url ${mcp}`,
        "",
        t("# Cursor, VS Code, Claude Desktop, ChatGPT: dán đúng địa chỉ này, không kèm dòng khoá nào"),
      ].join("\n"),
    },
    {
      id: "claude-code",
      label: "Claude Code",
      note: t("Chạy lệnh này trong terminal của máy có Claude Code."),
      code: `claude mcp add --transport http muse4ai ${mcp} --header "Authorization: Bearer ${key}"`,
    },
    {
      id: "cursor",
      label: "Cursor",
      note: t("Dán vào ~/.cursor/mcp.json (hoặc .cursor/mcp.json trong dự án)."),
      code: JSON.stringify({ mcpServers: { [BRAND.id]: { url: mcp, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
    {
      id: "vscode",
      label: "VS Code",
      note: t("Dán vào .vscode/mcp.json rồi bấm Start trên dòng muse4ai."),
      code: JSON.stringify({ servers: { [BRAND.id]: { type: "http", url: mcp, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      note: t("Dán vào claude_desktop_config.json (cần Node.js; dùng cầu nối mcp-remote), rồi khởi động lại Claude Desktop."),
      code: JSON.stringify(
        { mcpServers: { [BRAND.id]: { command: "npx", args: ["-y", "mcp-remote", mcp, "--header", "Authorization:${MUSE_AUTH}"], env: { MUSE_AUTH: `Bearer ${key}` } } } },
        null,
        2,
      ),
    },
    {
      id: "codex",
      label: "Codex CLI",
      note: t("Chạy lệnh dưới (hoặc dán khối TOML vào ~/.codex/config.toml). Codex đọc khoá từ biến môi trường MUSE_API_KEY — đặt biến này trước khi mở Codex."),
      code: [
        `codex mcp add muse4ai --url ${mcp} --bearer-token-env-var MUSE_API_KEY`,
        "",
        t("# hoặc trong ~/.codex/config.toml"),
        "[mcp_servers.muse4ai]",
        `url = "${mcp}"`,
        'bearer_token_env_var = "MUSE_API_KEY"',
        "",
        t("# PowerShell (một lần):"),
        `setx MUSE_API_KEY "${key}"`,
      ].join("\n"),
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      note: t("Chạy lệnh dưới, hoặc dán vào ~/.gemini/settings.json rồi mở lại Gemini CLI (gõ /mcp để kiểm)."),
      code: [
        `gemini mcp add --transport http --header "Authorization: Bearer ${key}" muse4ai ${mcp}`,
        "",
        JSON.stringify({ mcpServers: { [BRAND.id]: { httpUrl: mcp, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
      ].join("\n"),
    },
    {
      id: "python",
      label: "Python",
      note: t("Chỉ dùng thư viện có sẵn của Python 3. Lỗi mạng giữa chừng thì chạy lại cùng IDEM — app trả đúng lượt cũ, không tạo lượt trùng."),
      code: [
        "import json, time, urllib.request, uuid",
        "",
        `BASE = "${base}"`,
        `KEY = "${key}"`,
        t("IDEM = str(uuid.uuid4())  # giữ nguyên khi gửi lại"),
        "",
        "def call(method, path, body=None, headers=None):",
        "    data = json.dumps(body).encode() if body is not None else None",
        "    req = urllib.request.Request(BASE + path, data=data, method=method)",
        '    req.add_header("Authorization", "Bearer " + KEY)',
        "    if data is not None:",
        '        req.add_header("Content-Type", "application/json")',
        "    for k, v in (headers or {}).items():",
        "        req.add_header(k, v)",
        "    with urllib.request.urlopen(req, timeout=70) as r:",
        "        return json.load(r)",
        "",
        t("job = call(\"POST\", \"/v1/jobs\", {\"kind\": \"image\", \"prompt\": \"Một tách cà phê trên bàn gỗ\"},"),
        '           {"Idempotency-Key": IDEM})["jobs"][0]',
        'while job["status"] in ("queued", "running"):',
        '    job = call("GET", "/v1/jobs/%s?wait=50" % job["id"])',
        'print(job["status"], [o["download_url"] for o in job.get("outputs", [])])',
      ].join("\n"),
    },
    {
      id: "openai",
      label: "OpenAI",
      note: t("OpenAI gọi từ máy chủ của họ nên cần địa chỉ Internet (tên miền hoặc đường hầm). Đổi model theo tài khoản của anh."),
      needsPublic: true,
      code: [
        "from openai import OpenAI",
        "",
        "client = OpenAI()",
        "resp = client.responses.create(",
        '    model="gpt-5",',
        "    tools=[{",
        '        "type": "mcp",',
        '        "server_label": "muse_studio",',
        `        "server_url": "${mcp}",`,
        `        "headers": {"Authorization": "Bearer ${key}"},`,
        '        "require_approval": "never",',
        "    }],",
        t("    input=\"Tạo ảnh một tách cà phê trên bàn gỗ bằng Muse, chờ xong rồi đưa link tải.\","),
        ")",
        "print(resp.output_text)",
      ].join("\n"),
    },
    {
      id: "n8n",
      label: "n8n",
      note: t("Cách 1: nút MCP Client Tool (Streamable HTTP, Bearer). Cách 2: nút HTTP Request như dưới, rồi một nút nữa gọi GET /v1/jobs/{id}?wait=50 cho tới khi status là succeeded."),
      code: [
        "MCP Client Tool",
        `  Endpoint:        ${mcp}`,
        "  Server Transport: HTTP Streamable",
        `  Authentication:  Bearer Auth → ${key}`,
        "",
        "HTTP Request",
        "  Method:  POST",
        `  URL:     ${base}/v1/jobs`,
        `  Headers: Authorization = Bearer ${key}`,
        "           Idempotency-Key = {{ $execution.id }}",
        t("  Body (JSON): { \"kind\": \"image\", \"prompt\": \"Một tách cà phê trên bàn gỗ\" }"),
      ].join("\n"),
    },
    {
      id: "curl",
      label: "curl",
      note: t("Gửi lượt rồi chờ kết quả. Trên PowerShell dùng curl.exe thay cho curl."),
      code: [
        `curl -X POST ${base}/v1/jobs \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "Idempotency-Key: lan-goi-1" \\',
        t("  -d '{\"kind\":\"image\",\"prompt\":\"Một tách cà phê trên bàn gỗ\"}'"),
        "",
        t("# thay JOB_ID bằng jobs[0].id ở trên; gọi lại tới khi status là succeeded"),
        `curl "${base}/v1/jobs/JOB_ID?wait=50" -H "Authorization: Bearer ${key}"`,
      ].join("\n"),
    },
  ];
}

/**
 * R38 — the address the snippets use: the one the user picked if it is still listed, else the default
 * (domain → tunnel → LAN → this machine among usable ones; an Internet address that is not online is never the default).
 */
export function pickAgentUrl(urls: AgentUrl[], chosen: string | null, port: number): AgentUrl {
  const c = chosen ? urls.find((u) => u.url === chosen) : undefined;
  return c ?? urls.find((u) => u.online) ?? { via: "local", url: `http://127.0.0.1:${port}`, online: false, internet: false };
}
