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
      en: "Add a Muse account with a proxy, sign in yourself, and check that the account is ready to accept jobs.",
      vi: "Thêm tài khoản Muse với một proxy, tự đăng nhập trong cửa sổ Muse và kiểm tra tài khoản đã sẵn sàng nhận việc.",
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
        en: "Have a working proxy. A separate proxy for each account is best; accounts can share one, but then they go out through the same IP address.",
        vi: "Chuẩn bị proxy hoạt động. Tốt nhất mỗi tài khoản một proxy riêng; dùng chung được, nhưng các tài khoản sẽ ra cùng một địa chỉ IP.",
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
          en: "Each proxy in the list shows “Not in use” or which accounts already use it, unused ones first. The app pre-selects an unused healthy proxy; to share one, click it and read the short note. If there is no healthy proxy, import and test one first. A proxy failure stops every account on it; the app does not switch to a direct connection.",
          vi: "Mỗi proxy trong danh sách ghi “Chưa ai dùng” hoặc tên các tài khoản đang dùng, proxy chưa dùng xếp trước. App chọn sẵn một proxy khoẻ chưa ai dùng; muốn dùng chung thì bấm vào proxy đó và đọc dòng nhắc. Nếu chưa có proxy khoẻ, hãy Nhập proxy và kiểm tra trước. Khi proxy lỗi, mọi tài khoản trên proxy đó dừng; app không tự chuyển sang kết nối trực tiếp.",
        },
      },
      {
        title: {
          en: "3. Sign in yourself",
          vi: "3. Tự đăng nhập Muse",
        },
        body: {
          en: "Continue to sign-in. In the separate Muse window, enter your account details and complete Muse's verification yourself. If Muse opens another page (for example Meta Accounts Center or a tool's Connect button), it shows in its own small window or a tab, through the same proxy. The app does not store passwords or verification codes.",
          vi: "Chọn Tiếp tục đăng nhập. Trong cửa sổ Muse riêng, nhập thông tin tài khoản và tự hoàn tất xác minh của Muse. Nếu Muse mở thêm trang (ví dụ Trung tâm tài khoản Meta hay nút Kết nối của một công cụ), trang đó hiện trong cửa sổ nhỏ hoặc một tab riêng, đi cùng proxy. App không lưu mật khẩu hay mã xác nhận.",
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
          en: "Every proxy is already in use. What should I do?",
          vi: "Proxy nào cũng đang có tài khoản dùng thì làm sao?",
        },
        a: {
          en: "You can pick one and share it — the list shows who already uses it. For separate IP addresses, open Settings › Proxy to add and test another proxy.",
          vi: "Anh có thể chọn một proxy để dùng chung — danh sách ghi rõ ai đang dùng. Muốn mỗi tài khoản một địa chỉ IP riêng thì mở Cài đặt › Proxy để thêm và kiểm tra proxy mới.",
        },
      },
      {
        q: {
          en: "I clicked Connect (or opened Meta Accounts Center) and a new page appeared. Where is it?",
          vi: "Tôi bấm Kết nối (hoặc mở Trung tâm tài khoản Meta) và có trang mới. Trang đó nằm đâu?",
        },
        a: {
          en: "A small sign-in window opens over the Muse window and closes itself when you finish. Other pages open in one extra window; with two or more pages, a thin row of tabs appears at the top (Ctrl+W closes a tab, Ctrl+Tab switches). They only open while you use the account's window, always through its proxy.",
          vi: "Cửa sổ đăng nhập nhỏ mở ngay giữa cửa sổ Muse và tự đóng khi bạn xác nhận xong. Trang khác mở trong một cửa sổ phụ; từ hai trang trở lên sẽ có hàng tab mảnh phía trên (Ctrl+W đóng tab, Ctrl+Tab chuyển tab). Các trang này chỉ mở khi bạn đang dùng cửa sổ của tài khoản, luôn đi qua proxy của nó.",
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
    updated: "2026-11-04",
  },
];
