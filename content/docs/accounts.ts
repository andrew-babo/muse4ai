import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_ACCOUNTS: DocArticle[] = [
  {
    slug: "accounts-and-limits",
    chapter: "accounts",
    order: 1,
    title: {
      en: "Accounts and usage limits",
      vi: "Tài khoản và hạn mức sử dụng",
    },
    summary: {
      en: "Check each Muse account’s usage, paused state, and parallel jobs before sending more work from the app or an agent.",
      vi: "Xem hạn mức, trạng thái tạm dừng và số việc song song của từng tài khoản Muse trước khi gửi thêm việc từ app hoặc agent.",
    },
    before: [
      {
        en: "Add and sign in to your own Muse account first.",
        vi: "Trước tiên, thêm và đăng nhập tài khoản Muse của bạn.",
      },
      {
        en: `${FACTS.productName} is free. Creating images and videos uses your Muse account’s usage limit.`,
        vi: `${FACTS.productName} miễn phí. Việc tạo ảnh và video sử dụng hạn mức của tài khoản Muse của bạn.`,
      },
      {
        en: "Jobs on one account share that account’s Muse memory. Use a separate account for research you want to keep apart.",
        vi: "Các việc trên cùng tài khoản dùng chung bộ nhớ Muse của tài khoản đó. Dùng tài khoản riêng cho nội dung nghiên cứu cần tách biệt.",
      },
    ],
    steps: [
      {
        title: { en: "Check account readiness", vi: "Kiểm tra tài khoản" },
        body: {
          en: "Open Accounts. Read each account’s state before assigning work. A paused account needs attention; adding parallel jobs will not fix it.",
          vi: "Mở Tài khoản. Xem trạng thái từng tài khoản trước khi giao việc. Tài khoản bị tạm dừng cần được xử lý; tăng số việc song song không giải quyết được vấn đề.",
        },
        shot: "accounts-list",
      },
      {
        title: { en: "Read the usage panel", vi: "Xem bảng hạn mức" },
        body: {
          en: "Inspect the weekly limit and extra part reported by Muse. If Muse reports nothing left, automatic assignment skips that account.",
          vi: "Xem hạn mức tuần và phần bổ sung do Muse cung cấp. Khi Muse báo đã hết hạn mức, chế độ giao việc tự động sẽ bỏ qua tài khoản đó.",
        },
        shot: "accounts-quota",
      },
      {
        title: { en: "Set parallel work carefully", vi: "Chọn số việc song song" },
        body: {
          en: "Open the account’s settings and choose its maximum parallel jobs. This controls simultaneous work, not the usage limit granted by Muse.",
          vi: "Mở cài đặt tài khoản và chọn số việc song song tối đa. Tuỳ chọn này chỉ điều khiển số việc chạy cùng lúc, không tăng hạn mức Muse cấp.",
        },
        shot: "accounts-mode",
      },
      {
        title: { en: "Resolve pauses before continuing", vi: "Xử lý trước khi chạy tiếp" },
        body: {
          en: "For verification or expired sign-in, open the account window and complete the requested action yourself. For a limit or unsupported region, respect Muse’s restriction; do not change proxies to get around it.",
          vi: "Nếu cần xác minh hoặc đăng nhập lại, mở cửa sổ tài khoản và tự hoàn tất yêu cầu. Nếu hết hạn mức hoặc vùng chưa được hỗ trợ, tuân theo giới hạn của Muse; không đổi proxy để né giới hạn.",
        },
      },
    ],
    success: {
      en: "You know which accounts can take work and which must wait or need your attention.",
      vi: "Bạn biết tài khoản nào có thể nhận việc và tài khoản nào cần chờ hoặc cần bạn xử lý.",
    },
    troubleshoot: [
      {
        q: { en: "Why is an account skipped?", vi: "Vì sao tài khoản bị bỏ qua?" },
        a: {
          en: "Check its state and usage panel. An exhausted or paused account is not ready for automatic assignment.",
          vi: "Kiểm tra trạng thái và bảng hạn mức. Tài khoản hết hạn mức hoặc bị tạm dừng chưa thể nhận việc tự động.",
        },
      },
      {
        q: { en: "Does more parallel work give more usage?", vi: "Chạy song song có tăng hạn mức không?" },
        a: {
          en: "No. It only changes how much work can run at once. Muse still controls the account’s usage limit.",
          vi: "Không. Tuỳ chọn này chỉ đổi số việc có thể chạy cùng lúc. Muse vẫn quyết định hạn mức tài khoản.",
        },
      },
      {
        q: { en: "Why do research answers share context?", vi: "Vì sao câu trả lời nghiên cứu dùng chung ngữ cảnh?" },
        a: {
          en: "Jobs on one account share its Muse memory and history. Use a separate account and manage Muse memory yourself when separation matters.",
          vi: "Các việc trên một tài khoản dùng chung bộ nhớ và lịch sử Muse. Khi cần tách biệt, dùng tài khoản riêng và tự quản lý bộ nhớ trong Muse.",
        },
      },
    ],
    related: ["add-muse-account", "proxies-and-modes", "queue"],
    appRoute: "/accounts",
    updated: "2026-11-02",
  },
  {
    slug: "proxies-and-modes",
    chapter: "accounts",
    order: 2,
    title: {
      en: "Proxies and connection modes",
      vi: "Proxy và chế độ kết nối",
    },
    summary: {
      en: "Choose a proxy and connection mode for each account, and understand when Auto pauses instead of switching paths.",
      vi: "Chọn proxy và chế độ kết nối cho từng tài khoản, đồng thời hiểu khi nào Tự động tạm dừng thay vì đổi đường kết nối.",
    },
    before: [
      {
        en: "Have a working proxy you are allowed to use.",
        vi: "Chuẩn bị proxy hoạt động và bạn được phép sử dụng.",
      },
      {
        en: "Each account uses its assigned proxy. There is no direct-connection fallback.",
        vi: "Mỗi tài khoản dùng proxy được gán. App không tự chuyển sang kết nối trực tiếp.",
      },
      {
        en: `These settings control how ${FACTS.productName} reaches Muse, not how an agent reaches the app.`,
        vi: `Các cài đặt này điều khiển cách ${FACTS.productName} kết nối tới Muse, không phải cách agent kết nối tới app.`,
      },
    ],
    steps: [
      {
        title: { en: "Test your proxies", vi: "Kiểm tra proxy" },
        body: {
          en: "Open Settings › Proxy and use Test all. Fix a failing proxy before assigning it to an account.",
          vi: "Mở Cài đặt › Proxy và kiểm tra toàn bộ danh sách. Sửa proxy lỗi trước khi gán cho tài khoản.",
        },
        shot: "settings-proxy",
      },
      {
        title: { en: "Assign the account’s proxy", vi: "Gán proxy cho tài khoản" },
        body: {
          en: "In Accounts, use the account card’s menu to change its proxy. Each proxy shows which accounts already use it; sharing is allowed, but those accounts go out through the same IP address. A failed proxy does not cause the account to connect directly.",
          vi: "Trong Tài khoản, mở menu trên thẻ tài khoản để đổi proxy. Mỗi proxy ghi rõ tài khoản nào đang dùng; dùng chung được, nhưng các tài khoản đó sẽ ra cùng một địa chỉ IP. Khi proxy lỗi, tài khoản không tự kết nối trực tiếp.",
        },
      },
      {
        title: { en: "Choose a connection mode", vi: "Chọn chế độ kết nối" },
        body: {
          en: "Open the execution method button on the account card. Auto (recommended) prefers HTTP and switches to page control only for technical errors. HTTP only uses the lighter channel; UI only controls the account’s Muse page and uses more memory. Changing the method applies to newly sent jobs.",
          vi: "Bấm nút cách chạy trên thẻ tài khoản. Tự động (khuyên dùng) ưu tiên HTTP và chỉ chuyển sang điều khiển trang khi gặp lỗi kỹ thuật. Chỉ HTTP dùng kênh nhẹ hơn; Chỉ giao diện điều khiển trang Muse của tài khoản và tốn RAM hơn. Thay đổi áp dụng cho việc gửi mới.",
        },
        shot: "accounts-mode",
      },
      {
        title: { en: "Respect account pauses", vi: "Tuân theo trạng thái tạm dừng" },
        body: {
          en: "Verification, usage limits, and unsupported regions pause the account. Auto does not switch paths to get around these restrictions.",
          vi: "Yêu cầu xác minh, hết hạn mức và vùng chưa hỗ trợ sẽ làm tài khoản tạm dừng. Tự động không đổi đường kết nối để né các giới hạn này.",
        },
      },
    ],
    success: {
      en: "The account has a tested proxy and an appropriate connection mode, with no direct fallback.",
      vi: "Tài khoản đã có proxy được kiểm tra và chế độ kết nối phù hợp, không có đường dự phòng trực tiếp.",
    },
    troubleshoot: [
      {
        q: { en: "Why does Proxy error stop the account?", vi: "Vì sao lỗi proxy làm tài khoản dừng?" },
        a: {
          en: "The app keeps the account on its assigned proxy. Test or replace that proxy instead of expecting a direct fallback.",
          vi: "App giữ tài khoản trên proxy đã gán. Hãy kiểm tra hoặc thay proxy, thay vì chờ app tự kết nối trực tiếp.",
        },
      },
      {
        q: { en: "Will UI only fix a usage limit?", vi: "Chỉ giao diện có xử lý hết hạn mức không?" },
        a: {
          en: "No. A connection mode does not change the limits or region rules of your Muse account.",
          vi: "Không. Chế độ kết nối không thay đổi hạn mức hay quy định vùng của tài khoản Muse.",
        },
      },
    ],
    related: ["accounts-and-limits", "add-muse-account", "troubleshooting"],
    appRoute: "/settings/proxy",
    updated: "2026-11-04",
  },
];
