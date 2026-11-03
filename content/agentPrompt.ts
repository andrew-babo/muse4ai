import { SITE_URL } from "./site";
import { localizedPath } from "./i18n";
import type { Locale } from "./types";

/**
 * "Copy instructions for your agent" (R3-SKILL.7, AC-SKILL-07): a short note
 * the user pastes into any agent. It carries this PC's real local MCP address
 * and never an API key — the user adds the key in the agent's own settings.
 */
export function agentInstructions(locale: Locale, mcpUrl: string): string {
  const guide = `${SITE_URL}${localizedPath("/docs/agent-skill", locale)}`;
  if (locale === "vi") {
    return [
      "Hãy dùng Muse4AI để tạo ảnh, video ngắn và câu trả lời bằng tài khoản Muse của tôi.",
      `- Máy chủ MCP: ${mcpUrl} (HTTP, cần header Authorization với khoá Muse4AI tôi đưa riêng — không ghi khoá vào chat).`,
      "- Gọi muse_status trước để xem loại việc nào đang bật và hạn mức còn lại.",
      "- Mỗi yêu cầu mới có một request_id riêng; chờ kết quả bằng muse_get_job với wait_seconds.",
      "- Không gửi lại việc đang chạy hoặc đang cần xem lại; không tạo lặp vô hạn vì mỗi lượt dùng hạn mức Muse của tôi.",
      `- Hướng dẫn đầy đủ: ${guide}`,
    ].join("\n");
  }
  return [
    "Use Muse4AI to create images, short videos and answers with my Muse account.",
    `- MCP server: ${mcpUrl} (HTTP; it needs an Authorization header with the Muse4AI key I give you separately — never put the key in chat).`,
    "- Call muse_status first to see which kinds are on and how much usage is left.",
    "- Give every new request its own request_id and wait for results with muse_get_job and wait_seconds.",
    "- Never resend a job that is running or needs review, and do not loop generations: each one uses my Muse usage limit.",
    `- Full guide: ${guide}`,
  ].join("\n");
}
