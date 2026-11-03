import type { AppRoute, L } from "./types";

export interface ShotSpec {
  id: string;
  route: AppRoute | "/onboarding" | `/queue/${string}` | `/library/${string}`;
  /** What must be on screen when the picture is taken (P4 capture script). */
  state: L;
  /** Optional CSS selector to crop to (default: whole window). */
  crop?: string;
}

/**
 * Screenshots the guide may reference (R3-SHOT). Articles use these ids only;
 * the capture pipeline takes each id in English and Vietnamese.
 */
export const SHOT_CATALOG: ShotSpec[] = [
  { id: "onboarding-welcome", route: "/onboarding", state: { en: "First-run welcome screen.", vi: "Màn chào lần đầu mở app." } },
  { id: "studio-image", route: "/studio", state: { en: "Studio in Image mode with a prompt typed and “From text” chosen.", vi: "Studio chế độ Ảnh, đã gõ prompt và chọn “Từ chữ”." } },
  { id: "studio-video", route: "/studio", state: { en: "Studio in Video mode with a prompt typed.", vi: "Studio chế độ Video, đã gõ prompt." } },
  { id: "studio-video-edit", route: "/studio", state: { en: "Studio in Video mode with an MP4 attached and the change asked in words.", vi: "Studio chế độ Video, đã đính một tệp MP4 và ghi rõ muốn sửa gì." } },
  { id: "studio-ask", route: "/studio", state: { en: "Studio in Ask mode showing a finished answer laid out as an article.", vi: "Studio chế độ Hỏi đáp, có câu trả lời dạng bài viết." } },
  { id: "studio-references", route: "/studio", state: { en: "Studio with two reference images attached.", vi: "Studio đã đính kèm hai ảnh tham chiếu." } },
  { id: "queue-list", route: "/queue", state: { en: "Queue with image and video jobs, thumbnails and status chips.", vi: "Hàng chờ có việc ảnh và video, hình thu nhỏ và nhãn trạng thái." } },
  { id: "queue-preview", route: "/queue", state: { en: "Queue with the quick preview open on one finished job.", vi: "Hàng chờ đang mở xem nhanh một việc đã xong." } },
  { id: "queue-drawer", route: "/queue/sample", state: { en: "Job details drawer open with the result and the prompt.", vi: "Ngăn chi tiết việc đang mở, có kết quả và prompt." } },
  { id: "batch-list", route: "/batch", state: { en: "Batches list with one finished and one running batch.", vi: "Danh sách Hàng loạt có một lô xong và một lô đang chạy." } },
  { id: "batch-new", route: "/batch/new", state: { en: "New batch screen with a pasted list of prompts.", vi: "Màn tạo lô mới đã dán danh sách prompt." } },
  { id: "library-grid", route: "/library", state: { en: "Library grid of images and videos.", vi: "Lưới Thư viện gồm ảnh và video." } },
  { id: "library-detail", route: "/library/sample", state: { en: "One library item open with its details.", vi: "Một tác phẩm trong Thư viện đang mở chi tiết." } },
  { id: "library-extend", route: "/library/sample", state: { en: "A Muse video open in the Library with the extend action available.", vi: "Một video Muse mở trong Thư viện, có nút kéo dài." } },
  { id: "extend-sheet", route: "/library/sample", state: { en: "Extend plan open: steps or target duration, with the source video.", vi: "Bảng kéo dài đang mở: chọn số bước hoặc thời lượng mục tiêu, kèm video gốc." } },
  { id: "accounts-list", route: "/accounts", state: { en: "Accounts with two ready Muse accounts.", vi: "Tài khoản có hai tài khoản Muse sẵn sàng." } },
  { id: "accounts-add", route: "/accounts", state: { en: "Add account dialog.", vi: "Hộp thoại thêm tài khoản." } },
  { id: "accounts-quota", route: "/accounts", state: { en: "Usage limit panel of one account.", vi: "Bảng hạn mức của một tài khoản." } },
  { id: "accounts-mode", route: "/accounts", state: { en: "Execution method dialog of one account (Auto, HTTP only, UI only) with its concurrent job limits.", vi: "Hộp thoại cách chạy của một tài khoản (Tự động, Chỉ HTTP, Chỉ giao diện) và giới hạn việc cùng lúc." } },
  { id: "settings-general", route: "/settings/general", state: { en: "Settings › General with the language switch.", vi: "Cài đặt › Chung có chọn ngôn ngữ." } },
  { id: "settings-proxy", route: "/settings/proxy", state: { en: "Settings › Proxy.", vi: "Cài đặt › Proxy." } },
  { id: "settings-run", route: "/settings/run", state: { en: "Settings › Job execution.", vi: "Cài đặt › Chạy việc." } },
  { id: "settings-queue", route: "/settings/queue", state: { en: "Settings › Queue.", vi: "Cài đặt › Hàng chờ." } },
  { id: "settings-notifications", route: "/settings/notifications", state: { en: "Settings › Notifications.", vi: "Cài đặt › Thông báo." } },
  { id: "settings-api", route: "/settings/api", state: { en: "Settings › API & agent with the server running and one key.", vi: "Cài đặt › API & agent, máy chủ đang chạy và có một khoá." } },
  { id: "settings-api-key", route: "/settings/api", state: { en: "New API key dialog showing a masked key once.", vi: "Hộp thoại khoá API mới hiện khoá (đã che) một lần." } },
  { id: "settings-api-agents", route: "/settings/api", state: { en: "Agent setup section with ready-to-copy configurations.", vi: "Phần cấu hình agent có sẵn nội dung để sao chép." } },
  { id: "settings-remote", route: "/settings/api", state: { en: "Remote access with Quick tunnel and own domain options.", vi: "Truy cập từ xa có Quick tunnel và tên miền riêng." } },
  { id: "settings-security", route: "/settings/security", state: { en: "Settings › Security.", vi: "Cài đặt › Bảo mật." } },
  { id: "settings-diagnostics", route: "/settings/diagnostics", state: { en: "Settings › Diagnostics.", vi: "Cài đặt › Chẩn đoán." } },
  { id: "settings-about", route: "/settings/about", state: { en: "Settings › About with version and credits.", vi: "Cài đặt › Giới thiệu có phiên bản và ghi nguồn." } },
  { id: "guide-home", route: "/guide", state: { en: "Guide page with chapters and search.", vi: "Trang Hướng dẫn có các chương và ô tìm." } },
  { id: "guide-agent", route: "/guide", state: { en: "Guide article with the For your AI agent panel.", vi: "Bài hướng dẫn có thẻ Cho AI agent." } },
];

export const SHOT_IDS: readonly string[] = SHOT_CATALOG.map((s) => s.id);
