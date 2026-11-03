import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_ACCOUNT: DocArticle[] = [
  {
    slug: "add-muse-account",
    chapter: "account",
    order: 1,
    title: {
      en: "Add a Muse account",
      vi: "Thêm tài khoản Muse",
    },
    summary: {
      en: "Add a Muse account with its own proxy, sign in yourself, and check that the account is ready to accept jobs.",
      vi: "Thêm tài khoản Muse với proxy riêng, tự đăng nhập trong cửa sổ Muse và kiểm tra tài khoản đã sẵn sàng nhận việc.",
    },
    before: [
      {
        en: `Open ${FACTS.productName} and finish the first-run notice.`,
        vi: `Mở ${FACTS.productName} và xác nhận lưu ý khi dùng lần đầu.`,
      },
      {
        en: "Have access to your Muse account and its verification method. A secondary account is recommended.",
        vi: "Bạn truy cập được tài khoản Muse và phương thức xác minh của tài khoản. Nên dùng tài khoản phụ.",
      },
      {
        en: "Have a working, unassigned proxy. Each account uses its own proxy.",
        vi: "Chuẩn bị proxy hoạt động, chưa gán cho tài khoản khác. Mỗi tài khoản dùng proxy riêng.",
      },
    ],
    steps: [
      {
        title: {
          en: "1. Open the account dialog",
          vi: "1. Mở hộp thoại thêm tài khoản",
        },
        body: {
          en: "Open Accounts and choose Add account. Enter a recognizable alias; it is a label in the app, not your Muse login.",
          vi: "Mở Tài khoản rồi chọn Thêm tài khoản. Nhập Tên gọi dễ nhận biết; đây là nhãn trong app, không phải tên đăng nhập Muse.",
        },
        shot: "accounts-add",
      },
      {
        title: {
          en: "2. Assign a proxy",
          vi: "2. Gán proxy",
        },
        body: {
          en: "Choose an available healthy proxy. If none is available, import and test one first. A proxy failure stops this account; the app does not switch it to a direct connection.",
          vi: "Chọn proxy khoẻ còn trống. Nếu chưa có, hãy chọn Nhập proxy và kiểm tra trước. Khi proxy lỗi, tài khoản dừng; app không tự chuyển sang kết nối trực tiếp.",
        },
      },
      {
        title: {
          en: "3. Sign in yourself",
          vi: "3. Tự đăng nhập Muse",
        },
        body: {
          en: "Continue to sign-in. In the separate Muse window, enter your account details and complete Muse's verification yourself. The app does not store passwords or verification codes.",
          vi: "Chọn Tiếp tục đăng nhập. Trong cửa sổ Muse riêng, nhập thông tin tài khoản và tự hoàn tất xác minh của Muse. App không lưu mật khẩu hay mã xác nhận.",
        },
      },
      {
        title: {
          en: "4. Check that the account is ready",
          vi: "4. Kiểm tra tài khoản đã sẵn sàng",
        },
        body: {
          en: "The app detects a completed sign-in automatically. Return to Accounts and check the account's status before sending a Studio request. Resolve any verification or usage-limit notice first.",
          vi: "App tự nhận ra khi bạn đăng nhập xong. Quay lại Tài khoản và kiểm tra trạng thái trước khi gửi yêu cầu trong Studio. Xử lý thông báo xác minh hoặc hạn mức nếu có.",
        },
        shot: "accounts-list",
      },
    ],
    success: {
      en: "The account appears in Accounts without a sign-in or proxy error and is ready to accept work.",
      vi: "Tài khoản xuất hiện trong Tài khoản, không báo lỗi đăng nhập hay proxy và đã sẵn sàng nhận việc.",
    },
    troubleshoot: [
      {
        q: {
          en: "There is no healthy proxy available. What should I do?",
          vi: "Không có proxy khoẻ còn trống thì làm sao?",
        },
        a: {
          en: "Open Settings › Proxy to add and test a proxy. A proxy assigned to another account is not available for this account.",
          vi: "Mở Cài đặt › Proxy để thêm và kiểm tra proxy. Proxy đã gán cho tài khoản khác sẽ không dùng được cho tài khoản này.",
        },
      },
      {
        q: {
          en: "Muse asks for verification. Can the app finish it?",
          vi: "Muse yêu cầu xác minh. App có làm thay được không?",
        },
        a: {
          en: "No. Open the account's control window and complete the check yourself. When finished, use the session-check action if shown. Stop if Muse reports an unsupported region or unusual account restrictions.",
          vi: "Không. Mở Điều khiển của tài khoản và tự xác minh. Khi xong, chọn Đã xong, kiểm tra phiên nếu nút này xuất hiện. Dừng nếu Muse báo vùng không hỗ trợ hoặc hạn chế tài khoản bất thường.",
        },
      },
      {
        q: {
          en: "The account is signed in but jobs still wait. Why?",
          vi: "Tài khoản đã đăng nhập nhưng lượt vẫn chờ. Vì sao?",
        },
        a: {
          en: "Check whether the account is paused, busy, out of usage limit, or reporting a proxy error. Signing in does not remove Muse's limits.",
          vi: "Kiểm tra tài khoản có đang tạm dừng, bận, hết hạn mức hoặc lỗi proxy không. Đăng nhập không xoá hạn mức do Muse đặt.",
        },
      },
    ],
    related: ["first-open", "accounts-and-limits", "proxies-and-modes", "create-image"],
    appRoute: "/accounts",
    updated: "2026-11-02",
  },
];
