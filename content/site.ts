import type { Author, Release } from "./types";

/**
 * Public origin used for canonical, hreflang, sitemap and og:image (R3-WEB.2).
 * Switch to the custom domain only once its DNS points at the published site (D-3).
 */
export const SITE_URL = "https://muse4ai.lovable.app";

export const AUTHOR: Author = {
  name: "Andrew Babo",
  bio: null,
  // Only profiles Andrew provides and that are live (R3-AUTHOR.2).
  sameAs: [],
};

/** Newest first. `url = null` keeps the download page in "private beta" mode. */
export const RELEASES: Release[] = [
  {
    version: "2.0.0-beta.31",
    date: "2026-11-03",
    bytes: 171741048,
    sha256: "8BC00D84E495EDD18CDDFA3BF6D074F2FAF10FCB090F27308AB271F2A17B8B8A",
    url: "/__l5e/assets-v1/bdf5bb58-44ef-4707-8ec1-f8517daeda52/muse4ai-setup-win-x64.exe",
    notes: [
      { en: "Settings › API & agent now shows a no-key OAuth setup, and OAuth also works through your own domain, not only the temporary tunnel.", vi: "Cài đặt › API & agent giờ có mục kết nối không cần khoá (OAuth), và OAuth chạy được cả qua tên miền riêng chứ không chỉ đường tunnel tạm." },
    ],
  },
  {
    version: "2.0.0-beta.30",
    date: "2026-11-03",
    bytes: 171746215,
    sha256: "041A799FFE0FAAB007B30A1FEAB0DAA535090F56D9F6EC90D2C8717058CF53AE",
    url: null,
    notes: [
      { en: "Agents can now connect with OAuth: you approve each app by typing the 6-digit code shown in the Muse4AI window, and can disconnect it any time.", vi: "Agent giờ kết nối được bằng OAuth: bạn duyệt từng app bằng mã 6 số hiện trong cửa sổ Muse4AI, và ngắt được bất cứ lúc nào." },
    ],
  },
  {
    version: "2.0.0-beta.29",
    date: "2026-11-03",
    bytes: 171709298,
    sha256: "3BE1ADE96B0A3C235D2BC6D9AB6691B6A22A0B9DC782F5E701BDFA77E3EF600E",
    url: null,
    notes: [
      { en: "The installer now shows the app's own mascot art and friendly bilingual steps — no command window.", vi: "Bộ cài giờ hiện ảnh các bạn mascot của app cùng các bước song ngữ dễ chịu — không còn cửa sổ dòng lệnh." },
      { en: "A video made through HTTP/API can now be extended, and every step follows the video's own path.", vi: "Video tạo qua HTTP/API đã kéo dài được, và mỗi bước đi đúng đường của video nguồn." },
    ],
  },
  {
    version: "2.0.0-beta.28",
    date: "2026-11-03",
    bytes: null,
    sha256: null,
    url: null,
    notes: [
      { en: "Extend always follows the source video's path: agents calling REST or MCP never have to change an account setting.", vi: "Kéo dài luôn đi đúng đường của video nguồn: agent gọi qua REST hay MCP không cần đổi chế độ tài khoản." },
    ],
  },
  {
    version: "2.0.0-beta.27",
    date: "2026-11-03",
    bytes: null,
    sha256: null,
    url: null,
    notes: [
      { en: "The Extend button and the API say why a video cannot be extended before you click.", vi: "Nút Kéo dài và API nói rõ vì sao video không kéo dài được trước khi bạn bấm." },
      { en: "A video conversation now reports its extend steps and its newest video.", vi: "Hội thoại video nay báo các bước kéo dài và video mới nhất." },
    ],
  },
  {
    version: "2.0.0-beta.24",
    date: "2026-11-02",
    bytes: 162840722,
    sha256: "ED1D97D94111017F713D455479BE8A928FCAE7AAE6A8ADD966C981767DD5CE31",
    url: null,
    notes: [
      { en: "New name: Muse4AI (your data and settings stay where they were).", vi: "Tên mới: Muse4AI (dữ liệu và cài đặt của bạn giữ nguyên)." },
      { en: "Installer and app in English and Vietnamese.", vi: "Bộ cài và ứng dụng có tiếng Anh và tiếng Việt." },
    ],
  },
  {
    version: "2.0.0-beta.23",
    date: "2026-11-02",
    bytes: null,
    sha256: null,
    url: null,
    notes: [
      { en: "Queue shows a picture and the prompt for every job, with a quick preview on hover.", vi: "Hàng chờ hiện hình và prompt của từng việc, rê chuột để xem nhanh." },
      { en: "The whole app is available in English and Vietnamese; English is the default.", vi: "Toàn bộ ứng dụng có tiếng Anh và tiếng Việt; mặc định là tiếng Anh." },
      { en: "Faster Queue filtering and smooth scrolling with thousands of jobs.", vi: "Lọc Hàng chờ nhanh hơn, cuộn mượt với hàng nghìn việc." },
    ],
  },
  {
    version: "2.0.0-beta.19",
    date: "2026-11-02",
    bytes: null,
    sha256: null,
    url: null,
    notes: [
      { en: "Answers in Ask are shown as tidy articles (headings, lists, tables).", vi: "Câu trả lời trong Hỏi đáp hiện như bài viết gọn (tiêu đề, danh sách, bảng)." },
      { en: "Muse4AI now works with Muse only; support for another site was removed.", vi: "Muse4AI giờ chỉ làm việc với Muse; đã bỏ hỗ trợ một trang khác." },
    ],
  },
];

export const LATEST_RELEASE: Release = RELEASES[0] as Release;
