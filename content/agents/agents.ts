import type { Agent, AgentConfig, CodeLang, L, Step } from "../types";
import { FACTS } from "../facts";

/**
 * Connection guides per AI agent (R3-AG). Every entry is based on the vendor's
 * own documentation (docsUrl); status "verified" is reserved for agents with a
 * recorded end-to-end check (Evidence). Keys are always the placeholder.
 */

const localUrl = FACTS.localMcpUrl;
const publicUrl = "https://your-tunnel.trycloudflare.com/mcp";
const key = FACTS.placeholderKey;
const headers = { Authorization: `Bearer ${key}` };

const l = (en: string, vi: string): L => ({ en, vi });

const untested = l(
  "Based on vendor documentation; this connection has not been tested with Muse4AI.",
  "Hướng dẫn dựa trên tài liệu của hãng; kết nối này chưa được thử với Muse4AI.",
);

const tunnelNote = l(
  "Quick tunnel addresses change whenever Muse4AI starts. Update the connector URL, or use a named tunnel or your own domain.",
  "Địa chỉ Quick tunnel đổi mỗi lần Muse4AI khởi động. Bạn cần cập nhật URL hoặc dùng named tunnel hay tên miền riêng.",
);

const samePc = l(
  "The local address works only when the agent runs on the same Windows PC as Muse4AI. WSL, containers, and remote workspaces may use a different network.",
  "Địa chỉ cục bộ chỉ dùng được khi agent chạy trên cùng PC Windows với Muse4AI. WSL, container và môi trường từ xa có thể dùng mạng khác.",
);

const createKey: Step = {
  title: l("Create a Muse4AI key", "Tạo khoá Muse4AI"),
  body: l(
    "Open **Muse4AI › Settings › API & agent**. Turn on the server and create an API key. Copy it now: the full key is shown only once. Keep Muse4AI running.",
    "Bạn mở **Muse4AI › Cài đặt › API & agent**, bật máy chủ rồi tạo khoá API. Sao chép ngay vì khoá đầy đủ chỉ hiện một lần. Giữ Muse4AI đang chạy.",
  ),
  shot: "settings-api-key",
};

const remoteAccess: Step = {
  title: l("Turn on remote access", "Bật truy cập từ xa"),
  body: l(
    `In **Muse4AI › Settings › API & agent**, enable remote access and start **Quick tunnel**, or use your configured domain. Copy the HTTPS MCP URL. The example \`${publicUrl}\` must be replaced with your current address.`,
    `Trong **Muse4AI › Cài đặt › API & agent**, bạn bật truy cập từ xa rồi mở **Quick tunnel** hoặc dùng tên miền đã cấu hình. Sao chép URL MCP dùng HTTPS. Thay \`${publicUrl}\` bằng địa chỉ hiện tại của bạn.`,
  ),
  shot: "settings-remote",
};

const check: Step = {
  title: l("Check the connection", "Kiểm tra kết nối"),
  body: l(
    'Ask the agent: "Use Muse4AI to check status". Allow the `muse_status` tool call if prompted. Check that the reply reports Muse4AI status, rather than guessing.',
    'Bạn nhắn agent: "Use Muse4AI to check status". Nếu được hỏi, cho phép gọi công cụ `muse_status`. Kiểm tra câu trả lời có trạng thái từ Muse4AI, không chỉ là suy đoán.',
  ),
};

function jsonConfig(format: AgentConfig["format"], where: L, value: object): AgentConfig {
  return { format, where, text: JSON.stringify(value, null, 2) };
}

function mcpConfig(where: L, urlKey: "url" | "serverUrl" | "httpUrl" = "url"): AgentConfig {
  return jsonConfig("json-mcpServers", where, { mcpServers: { muse4ai: { [urlKey]: localUrl, headers } } });
}

function langOf(config: AgentConfig): CodeLang {
  switch (config.format) {
    case "cli":
      return "bash";
    case "toml-codex":
      return "toml";
    case "yaml-hermes":
      return "yaml";
    case "form":
      return "text";
    default:
      return "json";
  }
}

function setupSteps(config: AgentConfig, instruction: L, remote = false): Step[] {
  return [
    createKey,
    ...(remote ? [remoteAccess] : []),
    {
      title: l("Add Muse4AI to the agent", "Thêm Muse4AI vào agent"),
      body: instruction,
      code: { lang: langOf(config), text: config.text, caption: config.where },
    },
    check,
  ];
}

function editFile(path: string): L {
  return l(
    `Open \`${path}\`. Merge the example into any existing configuration instead of replacing other servers. Replace \`${key}\` with your key, save, and reload the agent's MCP tools.`,
    `Bạn mở \`${path}\`, ghép ví dụ vào cấu hình hiện có thay vì xoá các máy chủ khác. Thay \`${key}\` bằng khoá của bạn, lưu rồi tải lại công cụ MCP của agent.`,
  );
}

const claudeCodeConfig: AgentConfig = {
  format: "cli",
  where: l("Claude Code terminal", "Terminal chạy Claude Code"),
  text: `claude mcp add --transport http muse4ai ${localUrl} --header "Authorization: Bearer ${key}"`,
};

const claudeConfig: AgentConfig = {
  format: "form",
  where: l("Customize › Connectors › Add custom connector", "Customize › Connectors › Add custom connector"),
  text: ["Name: Muse4AI", `URL: ${publicUrl}`, `Request headers: Authorization: Bearer ${key}`].join("\n"),
};

const cursorConfig = mcpConfig(l("~/.cursor/mcp.json", "~/.cursor/mcp.json"));

const codexConfig: AgentConfig = {
  format: "toml-codex",
  where: l("~/.codex/config.toml", "~/.codex/config.toml"),
  text: ["[mcp_servers.muse4ai]", `url = "${localUrl}"`, "", "[mcp_servers.muse4ai.http_headers]", `Authorization = "Bearer ${key}"`].join("\n"),
};

const vscodeConfig = jsonConfig("json-vscode", l(".vscode/mcp.json", ".vscode/mcp.json"), {
  servers: { muse4ai: { type: "http", url: localUrl, headers } },
});

const antigravityConfig = jsonConfig("json-antigravity", l("Antigravity mcp_config.json", "mcp_config.json của Antigravity"), {
  mcpServers: { muse4ai: { serverUrl: localUrl, headers } },
});

const lovableConfig: AgentConfig = {
  format: "form",
  where: l("Connectors › Add custom › MCP server", "Connectors › Add custom › MCP server"),
  text: ["Name: Muse4AI", `URL: ${publicUrl}`, `Bearer token: ${key}`].join("\n"),
};

const hermesConfig: AgentConfig = {
  format: "yaml-hermes",
  where: l("~/.hermes/config.yaml", "~/.hermes/config.yaml"),
  text: ["mcp_servers:", "  muse4ai:", `    url: "${localUrl}"`, "    headers:", `      Authorization: "Bearer ${key}"`].join("\n"),
};

// The exact OpenClaw Control UI breadcrumb is not confirmed; these are
// connection values, not an invented OpenClaw file schema.
const openclawConfig: AgentConfig = {
  format: "form",
  where: l("OpenClaw MCP server connection", "Kết nối máy chủ MCP của OpenClaw"),
  text: ["Name: Muse4AI", `URL: ${localUrl}`, `Authorization: Bearer ${key}`].join("\n"),
};

const opencodeConfig = jsonConfig("json-opencode", l("opencode.json", "opencode.json"), {
  mcp: { muse4ai: { type: "remote", url: localUrl, headers } },
});

const lmstudioConfig = mcpConfig(l("mcp.json", "mcp.json"));

const n8nConfig: AgentConfig = {
  format: "form",
  where: l("MCP Client Tool node", "Node MCP Client Tool"),
  text: [`MCP endpoint: ${localUrl}`, "Authentication: Bearer", `Bearer token: ${key}`].join("\n"),
};

const clineConfig = mcpConfig(
  l("Cline › MCP Servers › Configure › Configure MCP Servers", "Cline › MCP Servers › Configure › Configure MCP Servers"),
);

const warpConfig = mcpConfig(l("Settings › Agents › MCP servers › Add", "Settings › Agents › MCP servers › Add"));

const geminiConfig = mcpConfig(l("~/.gemini/settings.json", "~/.gemini/settings.json"), "httpUrl");

const grokConfig: AgentConfig = {
  format: "cli",
  where: l("Grok CLI terminal", "Terminal chạy Grok CLI"),
  text: `grok mcp add --transport http muse4ai ${localUrl} --header "Authorization: Bearer ${key}"`,
};

const manusConfig: AgentConfig = {
  format: "form",
  where: l("Settings › Integrations › Custom MCP Servers › Add Server", "Settings › Integrations › Custom MCP Servers › Add Server"),
  text: ["Name: Muse4AI", `Server URL: ${publicUrl}`, "Authentication: Bearer token", `Token: ${key}`].join("\n"),
};

const windsurfConfig = mcpConfig(
  l("mcp_config.json opened from Cascade's MCP menu", "mcp_config.json mở từ menu MCP của Cascade"),
  "serverUrl",
);

/**
 * skills=false means this guide does not confirm SKILL.md support; it does not
 * assert that the product cannot support skills.
 */
export const AGENT_LIST: Agent[] = [
  {
    slug: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    brand: "anthropic",
    rank: 1,
    site: "https://code.claude.com/",
    docsUrl: "https://code.claude.com/docs/en/mcp",
    connection: ["local"],
    status: "documented",
    skills: true,
    summary: l(
      "Connect Claude Code on your Windows PC to Muse4AI with one terminal command, then ask it to check your Muse tools.",
      "Bạn kết nối Claude Code trên PC Windows với Muse4AI bằng một lệnh, rồi nhờ agent kiểm tra các công cụ Muse.",
    ),
    config: claudeCodeConfig,
    steps: setupSteps(
      claudeCodeConfig,
      l(
        `Run the command in a terminal where Claude Code is installed. Replace ${key} with your key, then reopen Claude Code if its tools have not refreshed.`,
        `Bạn chạy lệnh trong terminal đã cài Claude Code. Thay ${key} bằng khoá của bạn; mở lại Claude Code nếu danh sách công cụ chưa cập nhật.`,
      ),
    ),
    notes: [untested, samePc],
  },
  {
    slug: "claude",
    name: "Claude (desktop, web & mobile)",
    vendor: "Anthropic",
    brand: "anthropic",
    rank: 2,
    site: "https://claude.ai/",
    docsUrl: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    connection: ["public"],
    status: "documented",
    skills: true,
    summary: l(
      "Give Claude on desktop, web, or mobile access to Muse4AI through a public HTTPS connector with your own API key.",
      "Bạn cho Claude trên máy tính, web hoặc điện thoại dùng Muse4AI qua kết nối HTTPS công khai và khoá API của bạn.",
    ),
    config: claudeConfig,
    steps: setupSteps(
      claudeConfig,
      l(
        `Open Customize › Connectors › Add custom connector. Enter your current public MCP URL and add the Authorization request header shown below. Replace ${key} with your key, then save and enable the connector.`,
        `Bạn mở Customize › Connectors › Add custom connector. Điền URL MCP công khai hiện tại và thêm request header Authorization như bên dưới. Thay ${key} bằng khoá của bạn, lưu rồi bật connector.`,
      ),
      true,
    ),
    notes: [
      untested,
      l(
        "The Free plan allows one custom connector. Even Claude Desktop connects through Anthropic's cloud, so a local PC address will not work here.",
        "Gói Free cho phép một custom connector. Ngay cả Claude Desktop cũng kết nối từ đám mây Anthropic, nên bạn không dùng địa chỉ cục bộ ở đây.",
      ),
      tunnelNote,
    ],
  },
  {
    slug: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    brand: "anysphere",
    rank: 3,
    site: "https://cursor.com/",
    docsUrl: "https://cursor.com/help/customization/mcp",
    connection: ["local"],
    status: "documented",
    deeplink: "cursor",
    skills: true,
    summary: l(
      "Add Muse4AI to Cursor's MCP configuration so your coding agent can check Muse status and request media from your PC.",
      "Bạn thêm Muse4AI vào cấu hình MCP của Cursor để agent kiểm tra trạng thái Muse và yêu cầu tạo nội dung từ PC.",
    ),
    config: cursorConfig,
    steps: setupSteps(cursorConfig, editFile("~/.cursor/mcp.json")),
    notes: [untested, samePc],
  },
  {
    slug: "codex",
    name: "Codex",
    vendor: "OpenAI",
    brand: "openai",
    rank: 4,
    site: "https://developers.openai.com/codex/",
    docsUrl: "https://developers.openai.com/codex/mcp",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Connect a local Codex session to Muse4AI through its TOML settings and keep your Muse instructions in AGENTS.md.",
      "Bạn kết nối Codex chạy cục bộ với Muse4AI qua tệp TOML, rồi đặt hướng dẫn dùng Muse cho agent trong AGENTS.md.",
    ),
    config: codexConfig,
    steps: setupSteps(codexConfig, editFile("~/.codex/config.toml")),
    notes: [
      untested,
      l(
        "This guide covers local Codex sessions, not Codex Cloud. Paste the Muse4AI agent prompt into your project's AGENTS.md.",
        "Hướng dẫn này dành cho Codex chạy cục bộ, không bao gồm Codex Cloud. Bạn dán prompt hướng dẫn Muse4AI vào AGENTS.md của dự án.",
      ),
      samePc,
    ],
  },
  {
    slug: "vscode-copilot",
    name: "GitHub Copilot in VS Code",
    vendor: "Microsoft/GitHub",
    brand: "microsoft",
    rank: 5,
    site: "https://code.visualstudio.com/",
    docsUrl: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
    connection: ["local"],
    status: "documented",
    deeplink: "vscode",
    skills: true,
    summary: l(
      "Add Muse4AI to your VS Code workspace so GitHub Copilot can call Muse tools while helping you work on a project.",
      "Bạn thêm Muse4AI vào workspace VS Code để GitHub Copilot gọi công cụ Muse trong lúc hỗ trợ bạn làm dự án.",
    ),
    config: vscodeConfig,
    steps: setupSteps(
      vscodeConfig,
      l(
        `Merge the example into .vscode/mcp.json, replacing ${key}. Save, start the muse4ai server entry, and accept the trust prompt only if you recognize this configuration. Use Copilot's agent mode.`,
        `Bạn ghép ví dụ vào .vscode/mcp.json và thay ${key}. Lưu, bấm Start ở mục muse4ai và chỉ chấp nhận yêu cầu tin cậy nếu nhận ra cấu hình này. Dùng chế độ agent của Copilot.`,
      ),
    ),
    notes: [untested, samePc],
  },
  {
    slug: "antigravity",
    name: "Google Antigravity",
    vendor: "Google",
    brand: "google",
    rank: 6,
    site: "https://antigravity.google/",
    docsUrl: "https://antigravity.google/docs/mcp/",
    connection: ["local"],
    status: "documented",
    skills: true,
    summary: l(
      "Connect Google Antigravity to Muse4AI using its serverUrl configuration, then make a small status check before creating media.",
      "Bạn kết nối Google Antigravity với Muse4AI bằng cấu hình serverUrl, rồi kiểm tra trạng thái trước khi tạo ảnh hoặc video.",
    ),
    config: antigravityConfig,
    steps: setupSteps(antigravityConfig, editFile("Antigravity's mcp_config.json")),
    notes: [
      untested,
      l(
        "Use the HTTP MCP endpoint in this example, not a legacy SSE endpoint.",
        "Bạn dùng địa chỉ MCP qua HTTP trong ví dụ, không dùng địa chỉ SSE kiểu cũ.",
      ),
      samePc,
    ],
  },
  {
    slug: "lovable",
    name: "Lovable",
    vendor: "Lovable",
    brand: "lovable",
    rank: 7,
    site: "https://lovable.dev/",
    docsUrl: "https://docs.lovable.dev/integrations/custom-mcp",
    connection: ["public"],
    status: "documented",
    skills: false,
    summary: l(
      "Let the Lovable building agent use Muse4AI through a public connector when you need images or other Muse outputs for a project.",
      "Bạn cho agent làm app của Lovable dùng Muse4AI qua kết nối công khai khi cần ảnh hoặc nội dung Muse cho dự án.",
    ),
    config: lovableConfig,
    steps: setupSteps(
      lovableConfig,
      l(
        `Open Connectors › Add custom › MCP server. Enter your current public MCP URL. Choose Bearer authentication and paste your key in place of ${key}; do not add the word Bearer to a token-only field.`,
        `Bạn mở Connectors › Add custom › MCP server và điền URL MCP công khai hiện tại. Chọn xác thực Bearer, dán khoá thay ${key}; không thêm chữ Bearer vào ô chỉ nhận token.`,
      ),
      true,
    ),
    notes: [
      untested,
      l(
        "The connector gives tools to the Lovable agent while building. It does not automatically connect your published app to Muse4AI.",
        "Connector cấp công cụ cho agent Lovable khi làm app. Nó không tự kết nối app đã xuất bản của bạn với Muse4AI.",
      ),
      tunnelNote,
    ],
  },
  {
    slug: "hermes-agent",
    name: "Hermes Agent",
    vendor: "Nous Research",
    brand: "nous",
    rank: 8,
    site: "https://hermes-agent.nousresearch.com/",
    docsUrl: "https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference",
    connection: ["local"],
    status: "documented",
    skills: true,
    summary: l(
      "Add Muse4AI to Hermes Agent's YAML settings so your local assistant can inspect Muse status and use the available tools.",
      "Bạn thêm Muse4AI vào cấu hình YAML của Hermes Agent để trợ lý cục bộ kiểm tra trạng thái Muse và dùng các công cụ sẵn có.",
    ),
    config: hermesConfig,
    steps: setupSteps(hermesConfig, editFile("~/.hermes/config.yaml")),
    notes: [untested, samePc],
  },
  {
    slug: "openclaw",
    name: "OpenClaw",
    vendor: "OpenClaw project",
    brand: "openclaw",
    rank: 9,
    site: "https://openclaw.ai/",
    docsUrl: "https://docs.openclaw.ai/tools/mcp",
    connection: ["local", "public"],
    status: "documented",
    skills: false,
    summary: l(
      "Connect OpenClaw's Gateway to Muse4AI using an address the Gateway can reach, whether it runs on your PC or elsewhere.",
      "Bạn kết nối Gateway của OpenClaw với Muse4AI bằng địa chỉ Gateway truy cập được, dù chạy trên PC hay ở nơi khác.",
    ),
    config: openclawConfig,
    steps: [
      createKey,
      {
        ...remoteAccess,
        body: l(
          "If the Gateway runs outside your PC, enable Muse4AI remote access and copy its public HTTPS MCP URL. Skip this step when the Gateway runs on the same PC and can reach the local endpoint.",
          "Nếu Gateway chạy ngoài PC, bạn bật truy cập từ xa của Muse4AI rồi sao chép URL MCP HTTPS công khai. Bỏ qua bước này nếu Gateway chạy trên cùng PC và truy cập được địa chỉ cục bộ.",
        ),
      },
      {
        title: l("Configure the Gateway connection", "Cấu hình kết nối Gateway"),
        body: l(
          `Follow the linked OpenClaw MCP documentation to add Muse4AI with the URL and Authorization header below. If the Gateway runs elsewhere, replace the local URL with your public URL. Replace ${key} with your key. The exact Control UI menu path is not confirmed here.`,
          `Bạn làm theo tài liệu MCP OpenClaw được liên kết để thêm Muse4AI với URL và header Authorization bên dưới. Nếu Gateway chạy ở nơi khác, thay URL cục bộ bằng URL công khai. Thay ${key} bằng khoá của bạn. Hướng dẫn này chưa xác nhận đường dẫn menu Control UI.`,
        ),
        code: { lang: "text", text: openclawConfig.text, caption: openclawConfig.where },
      },
      check,
    ],
    notes: [
      untested,
      l(
        "The Gateway, not just your browser, must be able to reach Muse4AI. The exact Control UI › Settings › MCP › Add server path has not been confirmed.",
        "Gateway phải truy cập được Muse4AI, không chỉ trình duyệt của bạn. Đường dẫn Control UI › Settings › MCP › Add server chưa được xác nhận.",
      ),
      tunnelNote,
    ],
  },
  {
    slug: "opencode",
    name: "OpenCode",
    vendor: "OpenCode project",
    brand: "opencode",
    rank: 10,
    site: "https://opencode.ai/",
    docsUrl: "https://opencode.ai/docs/mcp-servers/",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Configure Muse4AI as a remote-type MCP server in OpenCode while keeping requests on the same PC as your Windows app.",
      "Bạn khai báo Muse4AI là máy chủ MCP kiểu remote trong OpenCode, nhưng vẫn gửi yêu cầu trên cùng PC Windows của bạn.",
    ),
    config: opencodeConfig,
    steps: setupSteps(opencodeConfig, editFile("opencode.json")),
    notes: [
      untested,
      l(
        'OpenCode uses the configuration label "remote" for HTTP MCP servers, even when the URL points to your own PC.',
        'OpenCode dùng nhãn cấu hình "remote" cho máy chủ MCP qua HTTP, kể cả khi URL trỏ về chính PC của bạn.',
      ),
      samePc,
    ],
  },
  {
    slug: "lm-studio",
    name: "LM Studio",
    vendor: "LM Studio",
    brand: "lmstudio",
    rank: 11,
    site: "https://lmstudio.ai/",
    docsUrl: "https://lmstudio.ai/docs/app/mcp",
    connection: ["local"],
    status: "documented",
    deeplink: "lmstudio",
    skills: false,
    summary: l(
      "Use Muse4AI from LM Studio by adding an MCP server and choosing a local model that can reliably call external tools.",
      "Bạn dùng Muse4AI từ LM Studio bằng cách thêm máy chủ MCP và chọn model cục bộ có khả năng gọi công cụ bên ngoài.",
    ),
    config: lmstudioConfig,
    steps: setupSteps(
      lmstudioConfig,
      l(
        `Open LM Studio's MCP configuration file, mcp.json, and merge the example. Replace ${key}, save, and enable Muse4AI for your chat. Load a model that supports tool calling.`,
        `Bạn mở tệp cấu hình MCP mcp.json của LM Studio rồi ghép ví dụ vào. Thay ${key}, lưu và bật Muse4AI cho cuộc trò chuyện. Tải model có hỗ trợ gọi công cụ.`,
      ),
    ),
    notes: [
      untested,
      l(
        "A successful server connection does not guarantee the model can use it. Choose a model with tool-calling support.",
        "Kết nối máy chủ thành công không có nghĩa model biết dùng công cụ. Bạn cần chọn model hỗ trợ gọi công cụ.",
      ),
      samePc,
    ],
  },
  {
    slug: "n8n",
    name: "n8n",
    vendor: "n8n",
    brand: "n8n",
    rank: 12,
    site: "https://n8n.io/",
    docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpclient",
    connection: ["local", "public"],
    status: "documented",
    skills: false,
    summary: l(
      "Connect an n8n AI Agent to Muse4AI with the MCP Client Tool node, choosing an endpoint reachable from your n8n instance.",
      "Bạn nối AI Agent của n8n với Muse4AI qua node MCP Client Tool, dùng địa chỉ mà môi trường chạy n8n truy cập được.",
    ),
    config: n8nConfig,
    steps: [
      createKey,
      {
        ...remoteAccess,
        body: l(
          "For n8n Cloud or a remote n8n host, enable remote access and copy the public HTTPS MCP URL. A native n8n process on the same PC can use the local URL.",
          "Nếu dùng n8n Cloud hoặc máy chủ n8n ở xa, bạn bật truy cập từ xa rồi sao chép URL MCP HTTPS công khai. n8n chạy trực tiếp trên cùng PC có thể dùng URL cục bộ.",
        ),
      },
      {
        title: l("Add the MCP Client Tool", "Thêm MCP Client Tool"),
        body: l(
          `Attach an MCP Client Tool node to an AI Agent node. Enter the reachable MCP endpoint, choose Bearer authentication, and create a credential containing your key instead of ${key}. Use Streamable HTTP when the node offers a transport choice.`,
          `Bạn gắn node MCP Client Tool vào node AI Agent. Điền địa chỉ MCP truy cập được, chọn xác thực Bearer và tạo credential chứa khoá của bạn thay ${key}. Chọn Streamable HTTP nếu node có mục chọn kiểu kết nối.`,
        ),
        code: { lang: "text", text: n8nConfig.text, caption: n8nConfig.where },
      },
      check,
    ],
    notes: [
      untested,
      l(
        "Docker has its own localhost. A container's local address is not your Windows PC; use a reachable host address or public HTTPS endpoint.",
        "Docker có localhost riêng. Địa chỉ cục bộ trong container không phải PC Windows của bạn; hãy dùng địa chỉ máy chủ truy cập được hoặc URL HTTPS công khai.",
      ),
      tunnelNote,
    ],
  },
  {
    slug: "cline",
    name: "Cline",
    vendor: "Cline",
    brand: "cline",
    rank: 13,
    site: "https://cline.bot/",
    docsUrl: "https://docs.cline.bot/mcp/mcp-overview",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Add Muse4AI to Cline's MCP settings and let your coding assistant check the available Muse tools before requesting outputs.",
      "Bạn thêm Muse4AI vào cấu hình MCP của Cline để trợ lý lập trình kiểm tra công cụ Muse trước khi yêu cầu tạo nội dung.",
    ),
    config: clineConfig,
    steps: setupSteps(
      clineConfig,
      l(
        `In Cline, open MCP Servers › Configure › Configure MCP Servers. Merge the example under mcpServers, replace ${key}, save, and check that Muse4AI is enabled.`,
        `Trong Cline, bạn mở MCP Servers › Configure › Configure MCP Servers. Ghép ví dụ vào mục mcpServers, thay ${key}, lưu rồi kiểm tra Muse4AI đã được bật.`,
      ),
    ),
    notes: [untested, samePc],
  },
  {
    slug: "warp",
    name: "Warp",
    vendor: "Warp",
    brand: "warp",
    rank: 14,
    site: "https://www.warp.dev/",
    docsUrl: "https://docs.warp.dev/knowledge-and-collaboration/mcp",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Add Muse4AI in Warp's agent settings so a local terminal agent can check Muse status and use your connected account's tools.",
      "Bạn thêm Muse4AI trong cài đặt agent của Warp để agent terminal cục bộ kiểm tra trạng thái Muse và dùng công cụ tài khoản.",
    ),
    config: warpConfig,
    steps: setupSteps(
      warpConfig,
      l(
        `Open Settings › Agents › MCP servers › Add. Paste the JSON configuration, replace ${key} with your key, and save. Enable the server for your local agent.`,
        `Bạn mở Settings › Agents › MCP servers › Add. Dán cấu hình JSON, thay ${key} bằng khoá của bạn rồi lưu. Bật máy chủ cho agent chạy cục bộ.`,
      ),
    ),
    notes: [
      untested,
      l(
        "This guide covers Warp's local agent, not Warp cloud agents.",
        "Hướng dẫn này dành cho agent Warp chạy cục bộ, không phải agent chạy trên đám mây.",
      ),
      samePc,
    ],
  },
  {
    slug: "gemini-cli",
    name: "Gemini CLI",
    vendor: "Google",
    brand: "google",
    rank: 15,
    site: "https://geminicli.com/",
    docsUrl: "https://geminicli.com/docs/tools/mcp-server/",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Configure Gemini CLI's HTTP MCP connection to Muse4AI, and check your account's CLI eligibility before following this setup.",
      "Bạn cấu hình kết nối MCP qua HTTP từ Gemini CLI tới Muse4AI và kiểm tra tài khoản còn dùng được CLI trước khi bắt đầu.",
    ),
    config: geminiConfig,
    steps: setupSteps(geminiConfig, editFile("~/.gemini/settings.json")),
    notes: [
      untested,
      l(
        "Google's documentation says Gemini CLI was replaced by Antigravity CLI for unpaid-tier and Google One users on 2026-06-18. Check which CLI your account can use.",
        "Tài liệu Google cho biết Antigravity CLI thay Gemini CLI cho người dùng gói không trả phí và Google One từ 2026-06-18. Bạn kiểm tra tài khoản dùng được CLI nào.",
      ),
      samePc,
    ],
  },
  {
    slug: "grok-cli",
    name: "Grok CLI",
    vendor: "xAI",
    brand: "xai",
    rank: 16,
    site: "https://x.ai/",
    docsUrl: "https://docs.x.ai/build/features/mcp-servers",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Connect Grok CLI to Muse4AI with an HTTP MCP command and your API key; this guide does not cover the Grok chat app.",
      "Bạn kết nối Grok CLI với Muse4AI bằng lệnh MCP qua HTTP và khoá API; hướng dẫn này không dành cho ứng dụng chat Grok.",
    ),
    config: grokConfig,
    steps: setupSteps(
      grokConfig,
      l(
        `Run the command in the terminal for the Grok CLI version described by the linked xAI documentation. Replace ${key} with your key, then reload the CLI's MCP tools.`,
        `Bạn chạy lệnh trong terminal của phiên bản Grok CLI được mô tả trong tài liệu xAI liên kết. Thay ${key} bằng khoá của bạn rồi tải lại công cụ MCP của CLI.`,
      ),
    ),
    notes: [
      untested,
      l(
        "This entry is for Grok CLI. Custom MCP connector support in the regular Grok chat app has not been confirmed.",
        "Mục này dành cho Grok CLI. Khả năng thêm connector MCP tuỳ chỉnh trong ứng dụng chat Grok thông thường chưa được xác nhận.",
      ),
      samePc,
    ],
  },
  {
    slug: "manus",
    name: "Manus",
    vendor: "Manus",
    brand: "manus",
    rank: 17,
    site: "https://manus.im/",
    docsUrl: "https://manus.im/docs/integrations/custom-mcp",
    connection: ["public"],
    status: "documented",
    skills: false,
    summary: l(
      "Give Manus access to Muse4AI through a custom MCP server with a public HTTPS address and a separate Bearer API key.",
      "Bạn cho Manus truy cập Muse4AI qua máy chủ MCP tuỳ chỉnh, dùng địa chỉ HTTPS công khai cùng khoá API Bearer riêng.",
    ),
    config: manusConfig,
    steps: setupSteps(
      manusConfig,
      l(
        `Open Settings › Integrations › Custom MCP Servers › Add Server. Enter your public MCP URL, select Bearer token authentication, and replace ${key} with your key. Run the connection test and enable the integration.`,
        `Bạn mở Settings › Integrations › Custom MCP Servers › Add Server. Điền URL MCP công khai, chọn xác thực Bearer token và thay ${key} bằng khoá của bạn. Chạy kiểm tra kết nối rồi bật tích hợp.`,
      ),
      true,
    ),
    notes: [untested, tunnelNote],
  },
  {
    slug: "windsurf",
    name: "Windsurf (Cascade)",
    vendor: "Windsurf",
    brand: "windsurf",
    rank: 18,
    site: "https://windsurf.com/",
    docsUrl: "https://docs.windsurf.com/plugins/cascade/mcp",
    connection: ["local"],
    status: "documented",
    skills: false,
    summary: l(
      "Add Muse4AI to Cascade's MCP configuration with serverUrl and an Authorization header, then refresh the available tools.",
      "Bạn thêm Muse4AI vào cấu hình MCP của Cascade bằng serverUrl và header Authorization, rồi làm mới danh sách công cụ.",
    ),
    config: windsurfConfig,
    steps: setupSteps(
      windsurfConfig,
      l(
        `Open Cascade's MCP menu and use its action to open the raw mcp_config.json file. Merge the example, replace ${key}, save, and refresh the MCP servers. Use the file opened by your installed version rather than guessing its folder.`,
        `Bạn mở menu MCP của Cascade và dùng mục mở cấu hình thô mcp_config.json. Ghép ví dụ, thay ${key}, lưu rồi làm mới máy chủ MCP. Dùng tệp mà phiên bản đang cài mở ra, không tự đoán thư mục.`,
      ),
    ),
    notes: [
      untested,
      l(
        "Team or enterprise administrators may need to allow MCP access or approve this server.",
        "Quản trị viên nhóm hoặc doanh nghiệp có thể cần cho phép truy cập MCP hoặc duyệt máy chủ này cho bạn.",
      ),
      samePc,
    ],
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    vendor: "OpenAI",
    brand: "openai",
    rank: 19,
    site: "https://chatgpt.com/",
    docsUrl: "https://developers.openai.com/api/docs/guides/custom-mcp-server",
    connection: ["public"],
    status: "later",
    skills: false,
    summary: l(
      "ChatGPT cannot yet accept Muse4AI's Bearer key in its custom connector flow, so this connection is listed for later.",
      "ChatGPT hiện chưa cho nhập khoá Bearer của Muse4AI trong luồng connector tuỳ chỉnh, nên kết nối này được để lại cho sau.",
    ),
    laterReason: l(
      "Custom connectors offer OAuth or no sign-in, without a field for Muse4AI's static Authorization header. Muse4AI's API key cannot be entered in that flow yet.",
      "Connector tuỳ chỉnh cho chọn OAuth hoặc không đăng nhập, nhưng chưa có ô nhập header Authorization cố định của Muse4AI. Bạn chưa thể nhập khoá API theo cách này.",
    ),
    steps: [
      {
        title: l("Why this connection is not available", "Vì sao chưa kết nối được"),
        body: l(
          "Muse4AI requires an API key on every request. ChatGPT's documented connector flow cannot enter that key as a static Bearer header. No working configuration is provided here.",
          "Muse4AI yêu cầu khoá API cho mọi yêu cầu. Luồng connector được mô tả của ChatGPT chưa cho nhập khoá này dưới dạng header Bearer cố định. Vì vậy, hướng dẫn không đưa cấu hình kết nối.",
        ),
      },
    ],
    notes: [
      l(
        "Do not remove Muse4AI authentication or put your key in a URL to try to make this connector work.",
        "Bạn không nên tắt xác thực Muse4AI hoặc đặt khoá trong URL để cố dùng connector này.",
      ),
    ],
  },
];
