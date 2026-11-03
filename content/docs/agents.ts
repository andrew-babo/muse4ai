import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_AGENTS: DocArticle[] = [
  {
    slug: "oauth",
    chapter: "agents",
    order: 6,
    title: { en: "Connect without a key (OAuth)", vi: "Kết nối không cần khoá (OAuth)" },
    summary: {
      en: "Paste only the MCP address into ChatGPT, Claude, Codex or Cursor, then approve with the 6-digit code shown in Muse4AI.",
      vi: "Chỉ dán địa chỉ MCP vào ChatGPT, Claude, Codex hoặc Cursor, rồi duyệt bằng mã 6 số hiện trong Muse4AI.",
    },
    before: [
      {
        en: "Keep the app open and turn on API for agents in Settings › API & agent.",
        vi: "Giữ app mở và bật API cho agent trong Cài đặt › API & agent.",
      },
      {
        en: "For cloud apps such as ChatGPT or the Claude app, turn on Remote access first so you have a public address.",
        vi: "Với app đám mây như ChatGPT hoặc app Claude, bật Truy cập từ xa trước để có địa chỉ công khai.",
      },
    ],
    steps: [
      {
        title: { en: "Copy the MCP address", vi: "Chép địa chỉ MCP" },
        body: {
          en: "In Settings › API & agent, open the “No key (OAuth)” template and copy the address ending in /mcp. Cloud apps need the public address from [Remote access](/docs/remote-access).",
          vi: "Trong Cài đặt › API & agent, mở mẫu “Không cần khoá (OAuth)” và chép địa chỉ kết thúc bằng /mcp. App đám mây cần địa chỉ công khai từ [truy cập từ xa](/docs/remote-access).",
        },
        code: { lang: "text", text: "https://your-address.example/mcp" },
        shot: "settings-api",
      },
      {
        title: { en: "Add it in your AI app", vi: "Thêm vào app AI của bạn" },
        body: {
          en: "Add a new MCP server or connector and paste the address. When asked how to sign in, choose OAuth. Do not add any key.",
          vi: "Thêm máy chủ MCP hoặc connector mới rồi dán địa chỉ. Khi được hỏi cách đăng nhập, chọn OAuth. Không cần thêm khoá nào.",
        },
      },
      {
        title: { en: "Approve with the 6-digit code", vi: "Duyệt bằng mã 6 số" },
        body: {
          en: "A Muse4AI approval page opens showing the app’s name and what it asks for. Type the 6-digit code shown in the Muse4AI window and press Allow. There is no account or password: whoever sits at this PC decides.",
          vi: "Trang xác nhận của Muse4AI mở ra, ghi tên app và quyền nó xin. Gõ mã 6 số đang hiện trong cửa sổ Muse4AI rồi bấm Cho phép. Không có tài khoản hay mật khẩu: người ngồi trước máy này là người quyết.",
        },
      },
      {
        title: { en: "Disconnect any time", vi: "Ngắt kết nối bất cứ lúc nào" },
        body: {
          en: "Connected apps are listed in Settings › API & agent › Connected apps. Disconnect one and its next request is refused.",
          vi: "Các app đã kết nối nằm trong Cài đặt › API & agent › Ứng dụng đã kết nối. Ngắt một app thì lần gọi kế tiếp của nó bị từ chối.",
        },
      },
    ],
    success: {
      en: "The AI app shows Muse4AI as connected and can call muse_status without any API key.",
      vi: "App AI báo Muse4AI đã kết nối và gọi được muse_status mà không cần khoá API.",
    },
    troubleshoot: [
      {
        q: { en: "The app keeps asking for a key.", vi: "App cứ đòi khoá." },
        a: {
          en: "Choose OAuth (not API key or header) as the sign-in type, and make sure the address ends in /mcp.",
          vi: "Chọn kiểu đăng nhập OAuth (không phải khoá API hay header) và kiểm tra địa chỉ kết thúc bằng /mcp.",
        },
      },
      {
        q: { en: "It worked yesterday and stopped today.", vi: "Hôm qua dùng được, hôm nay hết." },
        a: {
          en: "A Quick tunnel address changes every time the app starts. Use a named tunnel or your own domain for a stable address, then reconnect.",
          vi: "Địa chỉ Quick tunnel đổi mỗi lần mở app. Dùng tunnel có tên hoặc tên miền riêng để có địa chỉ cố định, rồi kết nối lại.",
        },
      },
    ],
    related: ["connect-overview", "api-keys", "remote-access"],
    appRoute: "/settings/api",
    updated: "2026-11-03",
  },
  {
    slug: "connect-overview",
    chapter: "agents",
    order: 1,
    title: { en: "Connect your AI agent", vi: "Kết nối AI agent của bạn" },
    summary: {
      en: "Connect an agent on this PC, a cloud agent, or an advanced command bridge with the right address and a separate key.",
      vi: "Kết nối agent trên máy này, agent đám mây hoặc cầu nối lệnh nâng cao bằng đúng địa chỉ và một khoá riêng cho từng agent.",
    },
    before: [
      {
        en: "Keep the app open on your Windows PC and sign in to Muse.",
        vi: "Giữ app mở trên máy Windows và đăng nhập Muse.",
      },
      {
        en: "Find out whether the agent runs on this PC or in the cloud.",
        vi: "Xác định agent chạy trên máy này hay trên đám mây.",
      },
    ],
    steps: [
      {
        title: { en: "Enable access and create a key", vi: "Bật kết nối và tạo khoá" },
        body: {
          en: "Open Settings › API & agent. Enable API for agents and create a key named for this agent. Copy the key before closing its dialog.",
          vi: "Mở Cài đặt › API & agent. Bật API cho agent rồi tạo khoá đặt tên theo agent này. Chép khoá trước khi đóng hộp thoại.",
        },
        shot: "settings-api",
      },
      {
        title: { en: "For an agent on this PC", vi: "Với agent trên máy này" },
        body: {
          en: `Add an HTTP MCP server using ${FACTS.localMcpUrl} and your key. Use the app’s current address if you changed its port. See [Claude Code](/agents/claude-code), [Cursor](/agents/cursor), or [Codex](/agents/codex).`,
          vi: `Thêm máy chủ MCP qua HTTP bằng ${FACTS.localMcpUrl} và khoá của bạn. Nếu đã đổi cổng, dùng địa chỉ hiện tại trong app. Xem [Claude Code](/agents/claude-code), [Cursor](/agents/cursor) hoặc [Codex](/agents/codex).`,
        },
        code: {
          lang: "text",
          text: `MCP URL: ${FACTS.localMcpUrl}\nAuthorization: Bearer ${FACTS.placeholderKey}`,
        },
      },
      {
        title: { en: "For a cloud agent", vi: "Với agent đám mây" },
        body: {
          en: "A cloud agent cannot reach this PC’s local address. Set up [Remote access](/docs/remote-access), then use the public MCP address and a key. See [Claude](/agents/claude) or [Lovable](/agents/lovable).",
          vi: "Agent đám mây không gọi được địa chỉ nội bộ của máy này. Thiết lập [truy cập từ xa](/docs/remote-access), rồi dùng địa chỉ MCP công khai cùng khoá. Xem [Claude](/agents/claude) hoặc [Lovable](/agents/lovable).",
        },
      },
      {
        title: { en: "For local-command-only apps", vi: "Với app chỉ nhận lệnh cục bộ" },
        body: {
          en: "An advanced bridge runs a local command and forwards requests to the HTTP MCP server. Use the configuration in the agent’s guide rather than guessing a command. Browse [all agent guides](/agents).",
          vi: "Cầu nối nâng cao chạy một lệnh cục bộ rồi chuyển yêu cầu tới máy chủ MCP qua HTTP. Dùng cấu hình trong bài hướng dẫn của agent, không tự đoán lệnh. Xem [mọi hướng dẫn agent](/agents).",
        },
      },
      {
        title: { en: "No key at all: sign in with OAuth", vi: "Không cần khoá: đăng nhập bằng OAuth" },
        body: {
          en: "Apps such as ChatGPT, Claude, Codex or Cursor can connect with only the MCP address. See [Connect without a key (OAuth)](/docs/oauth).",
          vi: "Các app như ChatGPT, Claude, Codex hoặc Cursor có thể kết nối chỉ với địa chỉ MCP. Xem [Kết nối không cần khoá (OAuth)](/docs/oauth).",
        },
      },
      {
        title: { en: "Test before creating media", vi: "Kiểm tra trước khi tạo nội dung" },
        body: {
          en: `Ask the agent to call ${FACTS.mcpTools[0]} first. Confirm it can see the app’s status before asking it to create an image or video.`,
          vi: `Nhờ agent gọi ${FACTS.mcpTools[0]} trước. Xác nhận agent đọc được trạng thái app rồi mới yêu cầu tạo ảnh hoặc video.`,
        },
      },
    ],
    success: {
      en: "The agent can read the app’s status using its own key and the correct local or public address.",
      vi: "Agent đọc được trạng thái app bằng khoá riêng và đúng địa chỉ nội bộ hoặc công khai.",
    },
    troubleshoot: [
      {
        q: { en: "Why does the local URL fail in a cloud app?", vi: "Vì sao URL nội bộ không dùng được trong app đám mây?" },
        a: {
          en: "A local address points to the computer making the request. Give a cloud agent the public address from Remote access instead.",
          vi: "Địa chỉ nội bộ trỏ tới máy đang gửi yêu cầu. Với agent đám mây, hãy dùng địa chỉ công khai từ phần truy cập từ xa.",
        },
      },
      {
        q: { en: "Why does the agent say unauthorized?", vi: "Vì sao agent báo không được cấp quyền?" },
        a: {
          en: "Check that the key is active and sent as a Bearer authorization header. A public address does not replace the key.",
          vi: "Kiểm tra khoá còn hiệu lực và được gửi trong header Authorization kiểu Bearer. Địa chỉ công khai không thay thế khoá.",
        },
      },
    ],
    related: ["api-keys", "remote-access", "agent-skill", "mcp-tools"],
    appRoute: "/settings/api",
    updated: "2026-11-02",
  },
  {
    slug: "api-keys",
    chapter: "agents",
    order: 2,
    title: { en: "Create and replace API keys", vi: "Tạo và thay khoá API" },
    summary: {
      en: "Create one key per agent, copy it while it is visible, and replace or revoke it safely if access needs to change.",
      vi: "Tạo khoá riêng cho từng agent, chép khi khoá còn hiển thị và thay hoặc thu hồi khoá an toàn khi cần đổi quyền truy cập.",
    },
    before: [
      {
        en: "Choose a clear name for the agent that will use the key.",
        vi: "Chọn tên dễ nhận biết cho agent sẽ dùng khoá.",
      },
      {
        en: "Treat a key like a password. Do not put it in screenshots, public messages, or URLs.",
        vi: "Giữ khoá kín như mật khẩu. Không đưa khoá vào ảnh chụp màn hình, tin nhắn công khai hoặc URL.",
      },
    ],
    steps: [
      {
        title: { en: "Create a named key", vi: "Tạo khoá có tên" },
        body: {
          en: "Open Settings › API & agent and create a key. Name it after the agent. Choose Create and cancel for generation, or Status only for monitoring.",
          vi: "Mở Cài đặt › API & agent và tạo khoá. Đặt tên theo agent. Chọn Tạo và huỷ để tạo nội dung, hoặc Chỉ xem tình trạng để theo dõi.",
        },
        shot: "settings-api-key",
      },
      {
        title: { en: "Copy it once", vi: "Chép ngay khi hiển thị" },
        body: {
          en: "Copy the full key before closing the dialog; you cannot reveal it again. Paste it only into the intended agent’s protected configuration.",
          vi: "Chép toàn bộ khoá trước khi đóng hộp thoại; bạn không thể xem lại. Chỉ dán vào phần cấu hình được bảo vệ của agent cần dùng.",
        },
        code: {
          lang: "http",
          text: `Authorization: Bearer ${FACTS.placeholderKey}`,
        },
      },
      {
        title: { en: "Replace and revoke safely", vi: "Thay và thu hồi an toàn" },
        body: {
          en: "To rotate a key, create a replacement, update the agent, test access, then revoke the old key. If a key was exposed, revoke it immediately. Revoking a key stops future authenticated access with it.",
          vi: "Để đổi khoá định kỳ, tạo khoá mới, cập nhật agent, kiểm tra kết nối rồi thu hồi khoá cũ. Nếu khoá bị lộ, thu hồi ngay. Khoá đã thu hồi không dùng được cho các yêu cầu xác thực tiếp theo.",
        },
      },
    ],
    success: {
      en: "Each agent has a separately named key with the access it needs, and obsolete keys are revoked.",
      vi: "Mỗi agent có khoá mang tên riêng với quyền phù hợp; các khoá không còn dùng đã được thu hồi.",
    },
    troubleshoot: [
      {
        q: { en: "I closed the dialog without copying.", vi: "Tôi đóng hộp thoại trước khi chép." },
        a: {
          en: "Revoke that key and create another. The app does not reveal the original key again.",
          vi: "Thu hồi khoá đó và tạo khoá mới. App không hiển thị lại khoá ban đầu.",
        },
      },
      {
        q: { en: "Status works but generation fails.", vi: "Xem trạng thái được nhưng không tạo được." },
        a: {
          en: "Check the key’s scope. A Status only key cannot create or cancel jobs.",
          vi: "Kiểm tra quyền của khoá. Khoá Chỉ xem tình trạng không thể tạo hoặc huỷ việc.",
        },
      },
    ],
    related: ["connect-overview", "remote-access", "privacy-and-data"],
    appRoute: "/settings/api",
    updated: "2026-11-02",
  },
  {
    slug: "agent-skill",
    chapter: "agents",
    order: 3,
    title: { en: "Teach your agent with the Muse4AI skill", vi: "Dạy agent bằng skill Muse4AI" },
    summary: {
      en: "Give your agent the Muse4AI skill or a short instruction note so it sends requests the safe way, without duplicates.",
      vi: "Cho agent skill Muse4AI hoặc lời dặn ngắn để agent gửi yêu cầu đúng cách, an toàn và không gửi trùng.",
    },
    before: [
      {
        en: "A skill is a small folder of instructions. It teaches the agent how to use Muse4AI; it is not the connection itself.",
        vi: "Skill là một thư mục hướng dẫn nhỏ. Nó dạy agent cách dùng Muse4AI; bản thân nó không phải kết nối.",
      },
      {
        en: "Connect the agent first with [Connect your AI agent](/docs/connect-overview). The skill never contains your key.",
        vi: "Kết nối agent trước theo bài [Kết nối AI agent](/docs/connect-overview). Skill không bao giờ chứa khoá của bạn.",
      },
    ],
    steps: [
      {
        title: { en: "1. Open the agent panel", vi: "1. Mở thẻ dành cho agent" },
        body: {
          en: "In Muse4AI, open Guide and find the panel **For your AI agent**. It has three buttons: Copy instructions, Download skill, and Install for Claude Code.",
          vi: "Trong Muse4AI, mở Hướng dẫn và tìm thẻ **Cho AI agent**. Thẻ có ba nút: Sao chép lời dặn, Tải skill và Cài cho Claude Code.",
        },
        shot: "guide-agent",
      },
      {
        title: { en: "2. Claude Code: install in one click", vi: "2. Claude Code: cài bằng một lần bấm" },
        body: {
          en: "Choose **Install for Claude Code**. The app shows the exact folder below and asks before writing. If the folder already exists, choose Replace or Cancel; Cancel changes nothing. Start a new Claude Code session afterwards.",
          vi: "Chọn **Cài cho Claude Code**. App hiện đúng thư mục bên dưới và hỏi trước khi ghi. Nếu thư mục đã có, chọn Thay thế hoặc Huỷ; Huỷ không đổi gì. Sau đó mở phiên Claude Code mới.",
        },
        code: { lang: "text", text: `%USERPROFILE%\\.claude\\skills\\${FACTS.productId}` },
      },
      {
        title: { en: "3. Other agents with skills", vi: "3. Agent khác có hỗ trợ skill" },
        body: {
          en: "Choose **Download skill** to save a ZIP, or get the same file from the website: [muse4ai-skill.zip](/downloads/muse4ai-skill.zip). Unzip it into the skills folder your agent's documentation names, keeping the `muse4ai` folder intact.",
          vi: "Chọn **Tải skill** để lưu tệp ZIP, hoặc tải cùng tệp trên website: [muse4ai-skill.zip](/downloads/muse4ai-skill.zip). Giải nén vào thư mục skill mà tài liệu của agent chỉ định, giữ nguyên thư mục `muse4ai`.",
        },
      },
      {
        title: { en: "4. Agents without skills", vi: "4. Agent không hỗ trợ skill" },
        body: {
          en: "Choose **Copy instructions** and paste the note into the agent's project instructions, such as AGENTS.md for Codex. The note has your PC's MCP address and the safe-use rules, but no key.",
          vi: "Chọn **Sao chép lời dặn** rồi dán vào phần hướng dẫn dự án của agent, ví dụ AGENTS.md cho Codex. Lời dặn có địa chỉ MCP trên máy bạn và các luật dùng an toàn, nhưng không có khoá.",
        },
      },
      {
        title: { en: "5. Check what the agent learned", vi: "5. Kiểm tra agent đã hiểu" },
        body: {
          en: "Ask the agent: \"How should you create an image with Muse4AI?\" A good answer mentions checking status first, a unique request ID, and waiting for the job instead of sending again.",
          vi: "Hỏi agent: \"Bạn sẽ tạo ảnh bằng Muse4AI như thế nào?\" Câu trả lời tốt có ý: kiểm tra trạng thái trước, mỗi yêu cầu một mã riêng, và chờ việc xong thay vì gửi lại.",
        },
      },
    ],
    success: {
      en: "Your agent follows the Muse4AI rules: it checks status, sends each request once, and waits for the result.",
      vi: "Agent làm theo luật của Muse4AI: kiểm tra trạng thái, gửi mỗi yêu cầu một lần và chờ kết quả.",
    },
    troubleshoot: [
      {
        q: { en: "I installed the skill but the agent cannot reach Muse4AI.", vi: "Đã cài skill nhưng agent không gọi được Muse4AI." },
        a: {
          en: "A skill teaches behavior only. The agent still needs the MCP address and an active key from [Create and replace API keys](/docs/api-keys).",
          vi: "Skill chỉ dạy cách làm. Agent vẫn cần địa chỉ MCP và khoá còn hiệu lực theo bài [Tạo và thay khoá API](/docs/api-keys).",
        },
      },
      {
        q: { en: "Claude Code does not use the skill.", vi: "Claude Code không dùng skill." },
        a: {
          en: "Start a new session so it reloads skills, and check that the folder contains SKILL.md directly inside `muse4ai`.",
          vi: "Mở phiên mới để Claude Code nạp lại skill, và kiểm tra thư mục `muse4ai` có tệp SKILL.md nằm ngay bên trong.",
        },
      },
    ],
    related: ["connect-overview", "api-keys", "mcp-tools"],
    appRoute: "/guide",
    updated: "2026-11-02",
  },
  {
    slug: "mcp-tools",
    chapter: "agents",
    order: 4,
    title: { en: "MCP tool reference", vi: "Tra cứu công cụ MCP" },
    summary: {
      en: "Learn the MCP tools, follow a job through its states, and avoid duplicate submissions when a request is interrupted.",
      vi: "Tìm hiểu các công cụ MCP, theo dõi trạng thái công việc và tránh gửi trùng khi yêu cầu bị gián đoạn giữa chừng.",
    },
    before: [
      {
        en: "Connect an MCP client with an active API key.",
        vi: "Kết nối ứng dụng MCP bằng khoá API còn hiệu lực.",
      },
      {
        en: "Generation uses your Muse account’s usage limit. Do not loop requests to overcome a limit.",
        vi: "Tạo nội dung sử dụng hạn mức tài khoản Muse. Không lặp yêu cầu để vượt hạn mức.",
      },
    ],
    steps: [
      {
        title: { en: "Check the server and capabilities", vi: "Kiểm tra máy chủ và khả năng hỗ trợ" },
        body: {
          en: `Open Settings › API & agent, then call ${FACTS.mcpTools[0]} to read account readiness, usage, and available capabilities.`,
          vi: `Mở Cài đặt › API & agent, rồi gọi ${FACTS.mcpTools[0]} để xem tài khoản sẵn sàng, hạn mức và các khả năng được hỗ trợ.`,
        },
        shot: "settings-api",
      },
      {
        title: { en: "Choose the right tool", vi: "Chọn đúng công cụ" },
        body: {
          en: `Tool — purpose:\n- \`${FACTS.mcpTools[0]}\` — read status and capabilities.\n- \`${FACTS.mcpTools[1]}\` — queue image or video work.\n- \`${FACTS.mcpTools[2]}\` — ask Muse; receive its answer unchanged, files, and a conversation_id.\n- \`${FACTS.mcpTools[3]}\` — read or wait for one job.\n- \`${FACTS.mcpTools[4]}\` — list jobs created with this key.\n- \`${FACTS.mcpTools[5]}\` — request cancellation of your job.\n- \`${FACTS.mcpTools[6]}\` — start a supported video-extension chain.\n- \`${FACTS.mcpTools[7]}\` — inspect or wait for an extension chain.`,
          vi: `Công cụ — công dụng:\n- \`${FACTS.mcpTools[0]}\` — xem trạng thái và khả năng hỗ trợ.\n- \`${FACTS.mcpTools[1]}\` — đưa việc tạo ảnh hoặc video vào hàng chờ.\n- \`${FACTS.mcpTools[2]}\` — hỏi Muse; nhận nguyên văn câu trả lời, tệp và conversation_id.\n- \`${FACTS.mcpTools[3]}\` — xem hoặc chờ một việc.\n- \`${FACTS.mcpTools[4]}\` — liệt kê việc được tạo bằng khoá này.\n- \`${FACTS.mcpTools[5]}\` — yêu cầu huỷ việc của bạn.\n- \`${FACTS.mcpTools[6]}\` — bắt đầu chuỗi nối video khi được hỗ trợ.\n- \`${FACTS.mcpTools[7]}\` — xem hoặc chờ chuỗi nối video.`,
        },
      },
      {
        title: { en: "Submit once, then poll", vi: "Gửi một lần rồi theo dõi" },
        body: {
          en: `Call ${FACTS.mcpTools[1]} with a unique request_id for each new operation. Then call ${FACTS.mcpTools[3]} with wait_seconds until succeeded, failed, cancelled, or needs_review. On success, use download_url. Reuse the same request_id and unchanged input only when retrying the same interrupted submission.`,
          vi: `Gọi ${FACTS.mcpTools[1]} với request_id riêng cho mỗi thao tác mới. Sau đó gọi ${FACTS.mcpTools[3]} với wait_seconds đến khi succeeded, failed, cancelled hoặc needs_review. Khi thành công, dùng download_url. Chỉ dùng lại request_id cùng dữ liệu không đổi khi thử lại chính lần gửi bị gián đoạn.`,
        },
        code: {
          lang: "json",
          text: JSON.stringify(
            {
              kind: "image",
              prompt: "A ceramic cup on a wooden desk",
              request_id: `${FACTS.productId}-image-example-001`,
            },
            null,
            2,
          ),
        },
      },
      {
        title: { en: "Apply the retry rules", vi: "Tuân theo quy tắc thử lại" },
        body: {
          en: "Never resubmit running or needs_review work. Failed jobs may be retried only for PRE_SUBMIT_TRANSIENT or PROXY_FAILED, or once after a few minutes for PROVIDER_ERROR. A person must inspect needs_review work in the app.",
          vi: "Không gửi lại việc đang running hoặc needs_review. Chỉ thử lại việc thất bại với PRE_SUBMIT_TRANSIENT hoặc PROXY_FAILED, hoặc thử một lần sau vài phút với PROVIDER_ERROR. Việc needs_review cần người kiểm tra trong app.",
        },
      },
      {
        title: { en: "Handle conversations and extensions", vi: "Xử lý hội thoại và nối video" },
        body: {
          en: `Keep conversation_id to continue a chat. A conversation_busy result means wait, not resubmit in a loop. Use ${FACTS.mcpTools[6]} only when ${FACTS.mcpTools[0]} reports the extension capability, then follow it with ${FACTS.mcpTools[7]}. Extra length and seamless continuity are not guaranteed.`,
          vi: `Giữ conversation_id để tiếp tục hội thoại. Khi nhận conversation_busy, hãy chờ, không gửi lặp. Chỉ dùng ${FACTS.mcpTools[6]} khi ${FACTS.mcpTools[0]} báo có khả năng nối video, rồi theo dõi bằng ${FACTS.mcpTools[7]}. Không đảm bảo độ dài tăng thêm hoặc chuyển cảnh liền mạch.`,
        },
      },
    ],
    success: {
      en: "Your client tracks existing jobs, preserves request IDs, and stops for human review when required.",
      vi: "Ứng dụng của bạn theo dõi việc đã có, giữ request ID và dừng để người dùng kiểm tra khi cần.",
    },
    troubleshoot: [
      {
        q: { en: "The request timed out. Should I create another?", vi: "Yêu cầu hết thời gian chờ. Có nên tạo lại?" },
        a: {
          en: "Check the existing job first. If retrying an interrupted submission, keep the same request_id and input to avoid duplicates.",
          vi: "Kiểm tra việc hiện có trước. Nếu thử lại lần gửi bị gián đoạn, giữ nguyên request_id và dữ liệu để tránh tạo trùng.",
        },
      },
      {
        q: { en: "Why can I not see another agent’s jobs?", vi: "Vì sao không thấy việc của agent khác?" },
        a: {
          en: "The listing tool returns jobs created with the current API key.",
          vi: "Công cụ liệt kê trả về các việc được tạo bằng khoá API hiện tại.",
        },
      },
      {
        q: { en: "Does chat verify Muse’s answer?", vi: "Chat có kiểm chứng câu trả lời Muse không?" },
        a: {
          en: "No. The answer is returned unchanged. Check research claims and attached files yourself.",
          vi: "Không. Câu trả lời được trả nguyên văn. Bạn cần tự kiểm tra thông tin nghiên cứu và tệp đính kèm.",
        },
      },
    ],
    related: ["connect-overview", "rest-api", "queue", "accounts-and-limits"],
    appRoute: "/settings/api",
    advanced: true,
    updated: "2026-11-02",
  },
  {
    slug: "rest-api",
    chapter: "agents",
    order: 5,
    title: { en: "REST API reference", vi: "Tra cứu REST API" },
    summary: {
      en: "Use the local REST API with a Bearer key, inspect its OpenAPI document, and follow jobs without submitting duplicates.",
      vi: "Dùng REST API trên máy với khoá Bearer, xem tài liệu OpenAPI và theo dõi công việc mà không gửi lại yêu cầu trùng lặp.",
    },
    before: [
      {
        en: "Enable API for agents and create a key with the required scope.",
        vi: "Bật API cho agent và tạo khoá có quyền phù hợp.",
      },
      {
        en: `The default base URL is ${FACTS.localRestUrl}. Use the app’s current address if its port changed.`,
        vi: `URL gốc mặc định là ${FACTS.localRestUrl}. Nếu đã đổi cổng, dùng địa chỉ hiện tại trong app.`,
      },
    ],
    steps: [
      {
        title: { en: "Check server access", vi: "Kiểm tra kết nối máy chủ" },
        body: {
          en: "Open Settings › API & agent. Keep access local unless another machine needs it. Send your key in Authorization: Bearer, never in the URL.",
          vi: "Mở Cài đặt › API & agent. Giữ kết nối chỉ trên máy này nếu máy khác không cần dùng. Gửi khoá bằng Authorization: Bearer, không đặt trong URL.",
        },
        shot: "settings-api",
      },
      {
        title: { en: "Read status", vi: "Đọc trạng thái" },
        body: {
          en: "Run this in a terminal, replacing the placeholder with your own key. On Windows, curl.exe avoids a PowerShell command alias.",
          vi: "Chạy lệnh này trong cửa sổ dòng lệnh và thay khoá mẫu bằng khoá của bạn. Trên Windows, curl.exe tránh trùng tên lệnh trong PowerShell.",
        },
        code: {
          lang: "powershell",
          text: `curl.exe "${FACTS.localRestUrl}/status" -H "Authorization: Bearer ${FACTS.placeholderKey}"`,
        },
      },
      {
        title: { en: "Choose an endpoint", vi: "Chọn đường dẫn API" },
        body: {
          en: "Paths below are relative to the base URL:\n- GET /health — liveness; no key required.\n- GET /openapi.json — API schema; no key required.\n- GET /status — readiness and capabilities.\n- GET or POST /jobs — list or submit jobs.\n- GET /jobs/{id} — job details and results.\n- POST /jobs/{id}/cancel — request cancellation.\n- POST /references — upload reference bytes.\n- GET or HEAD /assets/{id}/content — fetch an output with a key or valid signature.\n- GET /conversations/{id} — read a conversation.\n- POST /assets/{id}/extend or /conversations/{id}/extend — start an extension.\n- GET /extend-chains/{id} — read an extension chain.\n- POST /extend-chains/{id}/cancel — cancel a chain.",
          vi: "Các đường dẫn sau được nối vào URL gốc:\n- GET /health — kiểm tra máy chủ; không cần khoá.\n- GET /openapi.json — cấu trúc API; không cần khoá.\n- GET /status — trạng thái và khả năng hỗ trợ.\n- GET hoặc POST /jobs — liệt kê hoặc gửi việc.\n- GET /jobs/{id} — chi tiết và kết quả công việc.\n- POST /jobs/{id}/cancel — yêu cầu huỷ.\n- POST /references — tải dữ liệu tệp tham chiếu lên.\n- GET hoặc HEAD /assets/{id}/content — lấy kết quả bằng khoá hoặc chữ ký hợp lệ.\n- GET /conversations/{id} — đọc hội thoại.\n- POST /assets/{id}/extend hoặc /conversations/{id}/extend — bắt đầu nối video.\n- GET /extend-chains/{id} — đọc chuỗi nối video.\n- POST /extend-chains/{id}/cancel — huỷ chuỗi.",
        },
      },
      {
        title: { en: "Use the live schema", vi: "Dùng tài liệu từ máy chủ" },
        body: {
          en: `The server exposes its OpenAPI document at ${FACTS.localRestUrl}/openapi.json without a key. Read it for request fields and responses. Give each new submission a unique request_id; preserve it when retrying the same interrupted request.`,
          vi: `Máy chủ cung cấp tài liệu OpenAPI tại ${FACTS.localRestUrl}/openapi.json, không cần khoá. Xem tài liệu để biết trường gửi và dữ liệu trả về. Mỗi lần gửi mới dùng request_id riêng; giữ nguyên khi thử lại chính yêu cầu bị gián đoạn.`,
        },
      },
      {
        title: { en: "Follow the existing job", vi: "Theo dõi việc đã gửi" },
        body: {
          en: "Poll the returned job ID. Never resubmit running or needs_review work. Follow the [MCP retry rules](/docs/mcp-tools), which apply to the same underlying jobs.",
          vi: "Theo dõi bằng ID công việc được trả về. Không gửi lại việc running hoặc needs_review. Tuân theo [quy tắc thử lại MCP](/docs/mcp-tools), vì hai cách kết nối dùng cùng hệ thống công việc.",
        },
      },
    ],
    success: {
      en: "An authenticated status request succeeds and your client can read the server’s schema.",
      vi: "Yêu cầu trạng thái có xác thực thành công và ứng dụng của bạn đọc được cấu trúc API.",
    },
    troubleshoot: [
      {
        q: { en: "Why does health work but status fails?", vi: "Vì sao health chạy được nhưng status lỗi?" },
        a: {
          en: "Health is public. Status requires an active key in the Bearer header.",
          vi: "Health không yêu cầu khoá. Status cần khoá còn hiệu lực trong header Bearer.",
        },
      },
      {
        q: { en: "Why do I get not found?", vi: "Vì sao nhận lỗi không tìm thấy?" },
        a: {
          en: `Check that the base includes ${FACTS.restBase}, and compare the route and method with the OpenAPI document.`,
          vi: `Kiểm tra URL gốc có ${FACTS.restBase}, rồi đối chiếu đường dẫn và phương thức với tài liệu OpenAPI.`,
        },
      },
    ],
    related: ["api-keys", "mcp-tools", "remote-access"],
    appRoute: "/settings/api",
    advanced: true,
    updated: "2026-11-02",
  },
];
