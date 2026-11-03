import type { JsonLdKind, L } from "./types";

export interface StaticPage {
  id: string;
  path: string;
  title: L;
  description: L;
  jsonLd: JsonLdKind[];
  ogImage: boolean;
  /** Shown in the footer "Product"/"Project" columns and breadcrumbs. */
  label: L;
}

/** Fixed pages of the website (screens §3). Titles ≤ 60, descriptions 70–160 characters (AC-WEB-SEO-01). */
export const STATIC_PAGES: StaticPage[] = [
  {
    id: "home",
    path: "/",
    label: { en: "Home", vi: "Trang chủ" },
    title: { en: "Muse4AI — Muse for AI Agents on Windows", vi: "Muse4AI — Muse cho AI Agent trên Windows" },
    description: {
      en: "Free Windows app that lets Claude Code, Codex, Cursor and other AI agents create images, short videos and answers with your own Muse account, over MCP or REST.",
      vi: "Ứng dụng Windows miễn phí giúp Claude Code, Codex, Cursor và AI agent khác tạo ảnh, video ngắn, câu trả lời bằng tài khoản Muse của bạn qua MCP hoặc REST.",
    },
    jsonLd: ["WebSite", "SoftwareApplication"],
    ogImage: true,
  },
  {
    id: "features",
    path: "/features",
    label: { en: "Features", vi: "Tính năng" },
    title: { en: "Features — Studio, Queue, Batches and Agents | Muse4AI", vi: "Tính năng — Studio, Hàng chờ, Hàng loạt, Agent | Muse4AI" },
    description: {
      en: "Everything Muse4AI does on your PC: Studio for images and videos, a visual Queue, Batches, a Library, several Muse accounts, and MCP plus REST for agents.",
      vi: "Mọi thứ Muse4AI làm trên máy bạn: Studio tạo ảnh và video, Hàng chờ có hình, Hàng loạt, Thư viện, nhiều tài khoản Muse, cùng MCP và REST cho agent.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: true,
  },
  {
    id: "how-it-works",
    path: "/how-it-works",
    label: { en: "How it works", vi: "Cách hoạt động" },
    title: { en: "How Muse4AI Works — Agent, Your PC, Your Muse", vi: "Muse4AI hoạt động thế nào — Agent, máy bạn, Muse" },
    description: {
      en: "A plain-language picture of the bridge: your AI agent sends a request, Muse4AI on your Windows PC runs it in your Muse account, and the file comes back to you.",
      vi: "Giải thích dễ hiểu về cầu nối: AI agent gửi yêu cầu, Muse4AI trên máy Windows của bạn chạy bằng tài khoản Muse của bạn, rồi trả tệp kết quả về.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: true,
  },
  {
    id: "agents",
    path: "/agents",
    label: { en: "AI agents", vi: "AI agent" },
    title: { en: "Connect Your AI Agent to Muse — MCP Guides | Muse4AI", vi: "Kết nối AI agent với Muse — Hướng dẫn MCP | Muse4AI" },
    description: {
      en: "Step-by-step MCP setup for Claude Code, Claude, Cursor, Codex, VS Code, Antigravity, Lovable and more, with what was tested and what still needs work.",
      vi: "Hướng dẫn kết nối MCP từng bước cho Claude Code, Claude, Cursor, Codex, VS Code, Antigravity, Lovable và nhiều agent khác, ghi rõ phần đã kiểm.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: true,
  },
  {
    id: "use-cases",
    path: "/use-cases",
    label: { en: "Use cases", vi: "Tình huống" },
    title: { en: "Use Cases — Videos and Images with Muse via AI Agents", vi: "Tình huống — Tạo video, ảnh bằng Muse qua AI agent" },
    description: {
      en: "Affiliate and sales videos, lesson clips for teachers, short ads, storyboards, Remotion B-roll and data-report videos — workflows with honest limits.",
      vi: "Video affiliate và bán hàng, clip bài giảng cho giáo viên, quảng cáo ngắn, storyboard, B-roll cho Remotion, video báo cáo số liệu — kèm giới hạn rõ ràng.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: true,
  },
  {
    id: "docs",
    path: "/docs",
    label: { en: "Docs", vi: "Tài liệu" },
    title: { en: "Muse4AI Guide — From Install to Connecting Agents", vi: "Hướng dẫn Muse4AI — Từ cài đặt tới kết nối agent" },
    description: {
      en: "The complete Muse4AI guide in plain language, with real screenshots: install, add a Muse account, create in Studio, Queue, Batches, Library and AI agents.",
      vi: "Hướng dẫn Muse4AI đầy đủ, dễ hiểu, có ảnh chụp thật: cài đặt, thêm tài khoản Muse, tạo trong Studio, Hàng chờ, Hàng loạt, Thư viện và AI agent.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: true,
  },
  {
    id: "download",
    path: "/download",
    label: { en: "Download", vi: "Tải về" },
    title: { en: "Download Muse4AI for Windows", vi: "Tải Muse4AI cho Windows" },
    description: {
      en: "Current Muse4AI version, Windows requirements, file checksum, and how to install, update and remove the app while keeping your data safe.",
      vi: "Phiên bản Muse4AI hiện tại, yêu cầu Windows, mã kiểm tra tệp, cách cài, cập nhật và gỡ ứng dụng mà vẫn giữ an toàn dữ liệu của bạn.",
    },
    jsonLd: ["SoftwareApplication", "BreadcrumbList"],
    ogImage: false,
  },
  {
    id: "open-source",
    path: "/open-source",
    label: { en: "Open source", vi: "Mã mở" },
    title: { en: "Open Source & Credits — Projects Behind Muse4AI", vi: "Mã mở & ghi nguồn — Các dự án phía sau Muse4AI" },
    description: {
      en: "Thank-you list: the muse2api projects Muse4AI learned from, the libraries, fonts and tools it is built with, and their licenses.",
      vi: "Lời cảm ơn: các dự án muse2api mà Muse4AI tham khảo, cùng thư viện, font và công cụ được dùng để xây dựng, kèm giấy phép của từng dự án.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: false,
  },
  {
    id: "about",
    path: "/about",
    label: { en: "Andrew Babo", vi: "Andrew Babo" },
    title: { en: "About Andrew Babo — Maker of Muse4AI", vi: "Về Andrew Babo — Người làm Muse4AI" },
    description: {
      en: "Muse4AI is a free, non-commercial portfolio project designed and built by Andrew Babo. Why it exists and how it is made.",
      vi: "Muse4AI là dự án portfolio miễn phí, phi thương mại do Andrew Babo thiết kế và xây dựng. Vì sao có dự án này và nó được làm thế nào.",
    },
    jsonLd: ["Person", "BreadcrumbList"],
    ogImage: false,
  },
  {
    id: "disclaimer",
    path: "/legal/disclaimer",
    label: { en: "Disclaimer & trademarks", vi: "Miễn trừ & nhãn hiệu" },
    title: { en: "Disclaimer & Trademarks | Muse4AI", vi: "Miễn trừ trách nhiệm & nhãn hiệu | Muse4AI" },
    description: {
      en: "Muse4AI is an independent app, not affiliated with or endorsed by Meta or any AI agent maker. What that means for you and your Muse account.",
      vi: "Muse4AI là ứng dụng độc lập, không liên kết và không được Meta hay hãng AI agent nào chứng thực. Điều đó có nghĩa gì với bạn và tài khoản Muse.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: false,
  },
  {
    id: "privacy",
    path: "/legal/privacy",
    label: { en: "Privacy", vi: "Quyền riêng tư" },
    title: { en: "Privacy — Your Data Stays on Your PC | Muse4AI", vi: "Quyền riêng tư — Dữ liệu ở trên máy bạn | Muse4AI" },
    description: {
      en: "This website sets no cookies and loads no trackers. The Muse4AI app keeps your jobs, files and keys on your own Windows PC.",
      vi: "Website này không đặt cookie, không tải công cụ theo dõi. Ứng dụng Muse4AI giữ việc, tệp và khoá của bạn ngay trên máy Windows của bạn.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: false,
  },
  {
    id: "changelog",
    path: "/changelog",
    label: { en: "What's new", vi: "Có gì mới" },
    title: { en: "What's New in Muse4AI — Release Notes", vi: "Có gì mới trong Muse4AI — Ghi chú phát hành" },
    description: {
      en: "Release notes for every Muse4AI version in plain words: new features, fixes and anything you should know before you update.",
      vi: "Ghi chú từng phiên bản Muse4AI bằng lời dễ hiểu: tính năng mới, lỗi đã sửa và những điều nên biết trước khi cập nhật.",
    },
    jsonLd: ["BreadcrumbList"],
    ogImage: false,
  },
];

export function staticPage(id: string): StaticPage {
  const page = STATIC_PAGES.find((p) => p.id === id);
  if (!page) throw new Error(`Unknown static page ${id}`);
  return page;
}
