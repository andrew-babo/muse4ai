import type { Chapter } from "./types";

/** Guide chapters, same order in the app and on the website (screens §5). */
export const CHAPTERS: Chapter[] = [
  { id: "start", order: 1, title: { en: "Start here", vi: "Bắt đầu" }, summary: { en: "What Muse4AI is, how to install it and what you see the first time.", vi: "Muse4AI là gì, cách cài và những gì bạn thấy lần đầu." } },
  { id: "account", order: 2, title: { en: "Add your Muse account", vi: "Thêm tài khoản Muse" }, summary: { en: "Sign in to Muse inside Muse4AI so it can create for you.", vi: "Đăng nhập Muse ngay trong Muse4AI để app tạo thay bạn." } },
  { id: "studio", order: 3, title: { en: "Create in Studio", vi: "Tạo trong Studio" }, summary: { en: "Make images and short videos, ask questions and use reference pictures.", vi: "Tạo ảnh, video ngắn, hỏi đáp và dùng ảnh tham chiếu." } },
  { id: "queue", order: 4, title: { en: "Queue", vi: "Hàng chờ" }, summary: { en: "Follow every job and open the result.", vi: "Theo dõi từng việc và mở kết quả." } },
  { id: "batch", order: 5, title: { en: "Batches", vi: "Hàng loạt" }, summary: { en: "Create many items from one list.", vi: "Tạo nhiều tác phẩm từ một danh sách." } },
  { id: "library", order: 6, title: { en: "Library", vi: "Thư viện" }, summary: { en: "Find, preview and reuse what you made.", vi: "Tìm, xem và dùng lại những gì đã tạo." } },
  { id: "accounts", order: 7, title: { en: "Accounts & usage limits", vi: "Tài khoản & hạn mức" }, summary: { en: "Several Muse accounts, how jobs are shared and how much each can still make.", vi: "Nhiều tài khoản Muse, cách chia việc và lượng còn tạo được." } },
  { id: "agents", order: 8, title: { en: "Connect AI agents", vi: "Kết nối AI agent" }, summary: { en: "Let Claude, Codex, Cursor and others use Muse through Muse4AI.", vi: "Cho Claude, Codex, Cursor và các agent khác dùng Muse qua Muse4AI." } },
  { id: "settings", order: 9, title: { en: "Settings & remote access", vi: "Cài đặt & truy cập từ xa" }, summary: { en: "Language, notifications, sharing a public link, updates and backups.", vi: "Ngôn ngữ, thông báo, chia sẻ link công khai, cập nhật và sao lưu." } },
  { id: "help", order: 10, title: { en: "Troubleshooting", vi: "Khắc phục sự cố" }, summary: { en: "Fix common problems and look up words.", vi: "Sửa lỗi hay gặp và tra từ." } },
  { id: "credits", order: 11, title: { en: "Open source & credits", vi: "Mã mở & ghi nguồn" }, summary: { en: "The projects Muse4AI learned from and is built with.", vi: "Các dự án Muse4AI tham khảo và được xây dựng cùng." } },
];
