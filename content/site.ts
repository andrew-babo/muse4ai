import type { Author, Release } from "./types";

/**
 * Public origin used for canonical, hreflang, sitemap, og:image and the app's update manifest (R3-WEB.2, AC-WEB-01).
 * The custom domain is the primary address; muse4ai.lovable.app answers with a 302 to it (measured 06/11/2026).
 */
export const SITE_URL = "https://muse4ai.andrewbabo.com";

/**
 * The public source repository (MIT). One entry so the site, the guide and the
 * machine mirrors can never point at different addresses.
 */
export const REPO = {
  owner: "andrew-babo",
  name: "muse4ai",
  url: "https://github.com/andrew-babo/muse4ai",
  cloneUrl: "https://github.com/andrew-babo/muse4ai.git",
  issuesUrl: "https://github.com/andrew-babo/muse4ai/issues",
  license: "MIT",
  language: "TypeScript",
  /** Top-level folders a reader can open straight away. */
  folders: ["desktop", "content", "agent-kit", "scripts", "docs"],
} as const;


export const AUTHOR: Author = {
  name: "Andrew Babo",
  bio: null,
  // Only profiles Andrew provides and that are live (R3-AUTHOR.2).
  sameAs: [],
};

/** Newest first. `url = null` keeps the download page in "private beta" mode. */
export const RELEASES: Release[] = [
  {
    version: "2.0.0-beta.34",
    date: "2026-11-06",
    bytes: 171756320,
    sha256: "B59214CAEDCF71C45F68DDC9ADFE0CCD405F8B9F941E07286A561D844B4655C5",
    url: "/__l5e/assets-v1/8670ef65-b3f2-4b3a-a2ec-5ed06c9a2dbb/muse4ai-setup-win-x64.exe",
    notes: [
      { en: "Muse4AI now checks for new versions by itself. When one is out, open Settings › About and choose Download and install: it downloads, checks the file, installs and opens again in about a minute — your accounts, queue and library stay as they are.", vi: "Muse4AI giờ tự kiểm tra bản mới. Khi có bản mới, mở Cài đặt › Giới thiệu và chọn Tải và cài: app tự tải, kiểm tệp, cài rồi mở lại sau khoảng một phút — tài khoản, hàng chờ và thư viện vẫn nguyên." },
      { en: "If a new version gives you trouble, go back to the previous one from the same screen. The app only offers this when that version can still read your data.", vi: "Nếu bản mới có vấn đề, bạn quay lại bản trước ngay trên màn hình đó. App chỉ mời quay lại khi bản đó còn đọc được dữ liệu của bạn." },
      { en: "Muse4AI now appears in Windows Settings › Apps. Uninstalling opens a small window in your language: your image and video library is always kept, and you choose whether to keep accounts and settings for later.", vi: "Muse4AI giờ có trong Cài đặt Windows › Ứng dụng. Khi gỡ, một cửa sổ nhỏ hiện bằng ngôn ngữ của bạn: thư viện ảnh và video luôn được giữ, còn tài khoản và cài đặt thì bạn chọn giữ lại hay xoá." },
      { en: "Pages opened from the Muse window now show each site's own icon on their tabs.", vi: "Các trang mở từ cửa sổ Muse giờ hiện biểu tượng riêng của từng trang trên thẻ tab." },
    ],
  },
  {
    version: "2.0.0-beta.33",
    date: "2026-11-06",
    bytes: 171737324,
    sha256: "C650505DD6BFFC6EDCE6E8ED3FB5843C62412CEDD43E3BCFFAFEF2E6E69C2C48",
    url: "/__l5e/assets-v1/ca7c4aba-2f74-4829-88d3-5a2ea37285d3/muse4ai-setup-win-x64.exe",
    notes: [
      { en: "If Muse4AI is open when you install, setup now closes it for you (the normal way, like choosing Quit) and carries on — no need to quit first.", vi: "Nếu Muse4AI đang mở lúc cài, bộ cài giờ tự đóng app (đóng bình thường, như khi chọn Thoát) rồi cài tiếp — không cần thoát trước nữa." },
      { en: "When setup cannot finish, it now tells you the real reason. It also works on computers where it is started from the newer PowerShell 7.", vi: "Khi không cài xong, bộ cài giờ nói rõ lý do. Bộ cài cũng chạy được trên máy mở nó từ PowerShell 7 đời mới." },
      { en: "A friendlier first screen in the installer, and the app's built-in browser engine (Electron 45.2.1) and other parts are updated to their latest patch releases.", vi: "Màn hình đầu của bộ cài thân thiện hơn; lõi trình duyệt bên trong app (Electron 45.2.1) và các thành phần khác được cập nhật lên bản vá mới nhất." },
    ],
  },
  {
    version: "2.0.0-beta.32",
    date: "2026-11-04",
    bytes: 171775932,
    sha256: "801F598845920E829EEA5AD4C98555F0600938D002AE132FA56AFD9661810274",
    url: null,
    notes: [
      { en: "When adding an account, each proxy now says which accounts already use it. Sharing a proxy is allowed — you just see it clearly.", vi: "Khi thêm tài khoản, mỗi proxy giờ ghi rõ đang dùng cho tài khoản nào. Vẫn dùng chung được — chỉ là nhìn ra rõ ràng." },
      { en: "In the Muse sign-in window, small pop-ups (like a tool's Connect or OAuth step) and links that open a new page now show up — the window itself stays as clean as before.", vi: "Trong cửa sổ đăng nhập Muse, cửa sổ nhỏ (như bước Connect hay OAuth của công cụ) và link mở trang mới giờ hiện được — cửa sổ chính vẫn gọn như cũ." },
    ],
  },
  {
    version: "2.0.0-beta.31",
    date: "2026-11-03",
    bytes: 171741048,
    sha256: "8BC00D84E495EDD18CDDFA3BF6D074F2FAF10FCB090F27308AB271F2A17B8B8A",
    url: null,
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
