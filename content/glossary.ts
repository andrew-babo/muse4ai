import type { GlossaryTerm } from "./types";

/**
 * Plain-language glossary (R3-CNT.2). The first time a term appears in an
 * article it links here (AC-CNT-06).
 */
export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "agent",
    term: { en: "AI agent", vi: "AI agent (trợ lý AI)" },
    match: { en: ["AI agent", "AI agents"], vi: ["AI agent", "trợ lý AI"] },
    definition: {
      en: "An AI assistant that can use tools for you — for example Claude Code, Codex or Cursor. Muse4AI is one of those tools.",
      vi: "Trợ lý AI biết dùng công cụ thay bạn — ví dụ Claude Code, Codex hay Cursor. Muse4AI là một công cụ như vậy.",
    },
  },
  {
    id: "mcp",
    term: { en: "MCP", vi: "MCP" },
    match: { en: ["MCP"], vi: ["MCP"] },
    definition: {
      en: "Model Context Protocol: a common plug that lets an AI agent use outside tools. Muse4AI offers one at the address ending in /mcp.",
      vi: "Model Context Protocol: một kiểu \"ổ cắm\" chung để AI agent dùng công cụ bên ngoài. Muse4AI có một ổ như vậy ở địa chỉ kết thúc bằng /mcp.",
    },
  },
  {
    id: "api",
    term: { en: "API", vi: "API" },
    match: { en: ["API", "REST API"], vi: ["API", "REST API"] },
    definition: {
      en: "A way for programs to talk to each other. Muse4AI's API lets scripts and agents send jobs and fetch results.",
      vi: "Cách để các chương trình nói chuyện với nhau. API của Muse4AI cho script và agent gửi việc và lấy kết quả.",
    },
  },
  {
    id: "api-key",
    term: { en: "API key", vi: "Khoá API" },
    match: { en: ["API key", "API keys"], vi: ["khoá API", "khóa API"] },
    definition: {
      en: "A long password (it starts with msk_) that an agent sends with each request. You create, copy and delete keys in Settings › API & agent.",
      vi: "Một mật khẩu dài (bắt đầu bằng msk_) mà agent gửi kèm mỗi yêu cầu. Bạn tạo, sao chép và xoá khoá trong Cài đặt › API & agent.",
    },
  },
  {
    id: "tunnel",
    term: { en: "Tunnel", vi: "Tunnel (đường hầm)" },
    match: { en: ["tunnel", "tunnels", "Quick tunnel"], vi: ["tunnel", "đường hầm"] },
    definition: {
      en: "A safe public web address that leads to Muse4AI on your PC, so cloud apps like Claude or Lovable can reach it. Your API key is still required.",
      vi: "Một địa chỉ web công khai, an toàn, dẫn tới Muse4AI trên máy bạn để các app trên mây như Claude hay Lovable kết nối được. Vẫn cần khoá API.",
    },
  },
  {
    id: "proxy",
    term: { en: "Proxy", vi: "Proxy" },
    match: { en: ["proxy", "proxies"], vi: ["proxy"] },
    definition: {
      en: "A separate internet connection given to one Muse account so each account keeps its own connection. It is not a way around Muse's rules or limits.",
      vi: "Một đường kết nối Internet riêng gán cho một tài khoản Muse để mỗi tài khoản giữ kết nối của mình. Đây không phải cách lách luật hay hạn mức của Muse.",
    },
  },
  {
    id: "quota",
    term: { en: "Usage limit", vi: "Hạn mức" },
    match: { en: ["usage limit", "usage limits", "quota"], vi: ["hạn mức"] },
    definition: {
      en: "How much your Muse account can still create. It belongs to your Muse account; Muse4AI only reads and shows it.",
      vi: "Lượng tài khoản Muse của bạn còn tạo được. Hạn mức thuộc tài khoản Muse; Muse4AI chỉ đọc và hiển thị.",
    },
  },
  {
    id: "skill",
    term: { en: "Agent Skill", vi: "Agent Skill" },
    match: { en: ["Agent Skill", "skill file", "SKILL.md"], vi: ["Agent Skill", "SKILL.md"] },
    definition: {
      en: "A small folder of instructions (SKILL.md) that teaches an AI agent how to use a tool well.",
      vi: "Một thư mục hướng dẫn nhỏ (SKILL.md) dạy AI agent cách dùng tốt một công cụ.",
    },
  },
  {
    id: "queue",
    term: { en: "Queue", vi: "Hàng chờ" },
    match: { en: ["Queue"], vi: ["Hàng chờ"] },
    definition: {
      en: "The list of every job — waiting, running, done or failed — with a picture and the prompt.",
      vi: "Danh sách mọi việc — đang chờ, đang chạy, xong hoặc lỗi — kèm hình và prompt.",
    },
  },
];
