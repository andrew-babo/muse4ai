import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_HELP: DocArticle[] = [
  {
    slug: "troubleshooting",
    chapter: "help",
    order: 1,
    title: { en: "Troubleshooting", vi: "Xử lý sự cố" },
    summary: {
      en: "Resolve common sign-in, queue, connection, and installation problems without accidentally sending the same job twice.",
      vi: "Xử lý lỗi đăng nhập, hàng chờ, kết nối và cài đặt thường gặp mà không vô tình gửi cùng một công việc thêm lần nữa.",
    },
    before: [
      {
        en: "Keep the error message and note which account, job, or agent is affected.",
        vi: "Giữ thông báo lỗi và ghi lại tài khoản, công việc hoặc agent gặp lỗi.",
      },
      {
        en: "Do not resubmit running or needs_review jobs while investigating.",
        vi: "Không gửi lại việc running hoặc needs_review trong lúc kiểm tra.",
      },
    ],
    steps: [
      {
        title: { en: "Inspect the existing job", vi: "Kiểm tra việc hiện có" },
        body: {
          en: "Open Queue and select the job. Read its state and error before retrying. For needs_review, inspect Muse history rather than immediately creating another job.",
          vi: "Mở Hàng chờ và chọn công việc. Đọc trạng thái, lỗi trước khi thử lại. Với needs_review, kiểm tra lịch sử Muse thay vì tạo ngay việc mới.",
        },
        shot: "queue-drawer",
      },
      {
        title: { en: "Check the affected connection", vi: "Kiểm tra kết nối liên quan" },
        body: {
          en: "For account problems, check Accounts and the assigned proxy. For agent problems, check Settings › API & agent, the current address, and the key.",
          vi: "Nếu lỗi tài khoản, kiểm tra Tài khoản và proxy đã gán. Nếu lỗi agent, kiểm tra Cài đặt › API & agent, địa chỉ hiện tại và khoá.",
        },
      },
      {
        title: { en: "Collect a useful report", vi: "Chuẩn bị báo lỗi hữu ích" },
        body: {
          en: "Record the app version, what you tried, and the exact error. Export a diagnostics ZIP from Settings › Diagnostics. Remove exposed keys from anything you share.",
          vi: "Ghi phiên bản app, thao tác đã thử và nguyên văn lỗi. Xuất ZIP trong Cài đặt › Chẩn đoán. Xoá khoá bị lộ khỏi mọi nội dung bạn chia sẻ.",
        },
        shot: "settings-diagnostics",
      },
    ],
    success: {
      en: "You have resolved the issue or collected a clear report without duplicating work.",
      vi: "Bạn đã xử lý được lỗi hoặc có báo cáo rõ ràng mà không tạo việc trùng.",
    },
    troubleshoot: [
      {
        q: { en: "The account needs verification or sign-in.", vi: "Tài khoản cần xác minh hoặc đăng nhập lại." },
        a: {
          en: "Open the account window using Take over, complete the requested action yourself, then check the session again. Do not automate around verification.",
          vi: "Mở cửa sổ tài khoản bằng thao tác tiếp quản, tự hoàn tất yêu cầu rồi kiểm tra lại phiên. Không tự động hoá để né xác minh.",
        },
      },
      {
        q: { en: "The account is paused for a usage limit.", vi: "Tài khoản tạm dừng vì hết hạn mức." },
        a: {
          en: "Check the usage panel and wait for availability reported by Muse. Increasing parallel work does not restore usage.",
          vi: "Xem bảng hạn mức và chờ Muse báo có thể dùng lại. Tăng số việc song song không khôi phục hạn mức.",
        },
      },
      {
        q: { en: "Muse reports an unsupported region.", vi: "Muse báo vùng chưa được hỗ trợ." },
        a: {
          en: "Stop using the affected account for this work and respect Muse’s restriction. Do not use proxies or connection modes to bypass it.",
          vi: "Dừng dùng tài khoản đó cho công việc này và tuân theo giới hạn của Muse. Không dùng proxy hay chế độ kết nối để né.",
        },
      },
      {
        q: { en: "My Quick tunnel link stopped working.", vi: "Liên kết đường hầm tạm thời không hoạt động." },
        a: {
          en: "Its address changes each time the app starts. Copy the current public MCP address into the agent and retain its key.",
          vi: "Địa chỉ đổi mỗi lần app khởi động. Chép địa chỉ MCP công khai hiện tại vào agent và giữ cấu hình khoá.",
        },
      },
      {
        q: { en: "The agent says unauthorized.", vi: "Agent báo không được cấp quyền." },
        a: {
          en: `Use an active key in Authorization: Bearer. ${FACTS.placeholderKey} is only a placeholder. If the original key is lost, revoke it and create another.`,
          vi: `Dùng khoá còn hiệu lực trong Authorization: Bearer. ${FACTS.placeholderKey} chỉ là khoá mẫu. Nếu mất khoá ban đầu, thu hồi và tạo khoá mới.`,
        },
      },
      {
        q: { en: "The API port is busy.", vi: "Cổng API đang được sử dụng." },
        a: {
          en: "Use the free port suggested in Settings › API & agent, then copy the updated address into every affected agent.",
          vi: "Dùng cổng trống được gợi ý trong Cài đặt › API & agent, rồi cập nhật địa chỉ cho các agent liên quan.",
        },
      },
      {
        q: { en: "Windows SmartScreen warns about the installer.", vi: "Windows SmartScreen cảnh báo bộ cài." },
        a: {
          en: "The app is not code-signed. Only if you trust the downloaded package, choose More info → Run anyway. Do not disable Windows protection globally.",
          vi: "App chưa được ký mã. Chỉ khi tin tưởng gói đã tải, chọn More info → Run anyway. Không tắt toàn bộ cơ chế bảo vệ Windows.",
        },
      },
      {
        q: { en: "A job needs review.", vi: "Một công việc cần kiểm tra." },
        a: {
          en: "The app is unsure whether Muse received it. Inspect the job and Muse history. Import an existing result when available; sending again can create a duplicate and use more of your limit.",
          vi: "App chưa chắc Muse đã nhận việc. Kiểm tra công việc và lịch sử Muse. Nhập kết quả đã có nếu tìm thấy; gửi lại có thể tạo trùng và dùng thêm hạn mức.",
        },
      },
      {
        q: { en: "The video is shorter than requested.", vi: "Video ngắn hơn yêu cầu." },
        a: {
          en: `Muse clips are about ${FACTS.media.videoSeconds} seconds. Prompting for more does not guarantee length. Extension is available only when reported by the server, and added duration is not guaranteed.`,
          vi: `Video Muse thường dài khoảng ${FACTS.media.videoSeconds} giây. Yêu cầu dài hơn trong prompt không đảm bảo độ dài. Chỉ nối video khi máy chủ báo hỗ trợ; thời lượng tăng thêm cũng không được đảm bảo.`,
        },
      },
      {
        q: { en: "The app disappeared after I clicked X.", vi: "App biến mất sau khi tôi bấm X." },
        a: {
          en: "It is hidden in the system tray. Open it from the tray icon. To stop it fully, right-click that icon and choose Quit.",
          vi: "App đang ẩn ở khay hệ thống. Mở lại bằng biểu tượng ở khay. Muốn dừng hẳn, bấm phải biểu tượng đó rồi chọn thoát.",
        },
      },
      {
        q: { en: "The account reports a proxy error.", vi: "Tài khoản báo lỗi proxy." },
        a: {
          en: "Test proxies in Settings › Proxy and fix or replace the assigned proxy. The app does not fall back to a direct connection.",
          vi: "Kiểm tra proxy trong Cài đặt › Proxy, rồi sửa hoặc thay proxy đã gán. App không tự chuyển sang kết nối trực tiếp.",
        },
      },
      {
        q: { en: "Downloads paused because the disk is nearly full.", vi: "Tải kết quả tạm dừng vì ổ gần đầy." },
        a: {
          en: "Free space on the output drive or change the output folder in Settings › General. Downloads can resume when space is available.",
          vi: "Dọn dung lượng ổ lưu kết quả hoặc đổi thư mục trong Cài đặt › Chung. Việc tải có thể tiếp tục khi có đủ chỗ.",
        },
      },
    ],
    related: ["accounts-and-limits", "remote-access", "updates-and-backups", "queue"],
    appRoute: "/settings/diagnostics",
    updated: "2026-11-02",
  },
  {
    slug: "glossary",
    chapter: "help",
    order: 2,
    title: { en: "Glossary", vi: "Giải thích thuật ngữ" },
    summary: {
      en: "Look up unfamiliar app and agent terms in plain language, then return to the guide you were reading with more context.",
      vi: "Tra nghĩa các từ lạ trong app và khi dùng agent bằng lời dễ hiểu, rồi quay lại bài hướng dẫn bạn đang đọc để làm tiếp.",
    },
    before: [
      {
        en: "You do not need programming knowledge to use this glossary.",
        vi: "Bạn không cần biết lập trình để dùng phần giải thích này.",
      },
      {
        en: "Keep the unfamiliar word or the guide you were reading in mind.",
        vi: "Ghi nhớ từ chưa rõ hoặc bài hướng dẫn bạn đang đọc.",
      },
    ],
    steps: [
      {
        title: { en: "Start from your guide", vi: "Bắt đầu từ bài hướng dẫn" },
        body: {
          en: `Open Guide in ${FACTS.productName}. In supported articles, the first use of a glossary term links to its explanation.`,
          vi: `Mở Hướng dẫn trong ${FACTS.productName}. Trong bài có hỗ trợ, lần xuất hiện đầu của thuật ngữ sẽ liên kết tới phần giải thích.`,
        },
        shot: "guide-home",
      },
      {
        title: { en: "Read the list below", vi: "Xem danh sách bên dưới" },
        body: {
          en: "The glossary list appears automatically below this article. Find the term and read its short explanation.",
          vi: "Danh sách thuật ngữ tự hiển thị bên dưới bài này. Tìm từ cần biết và đọc phần giải thích ngắn.",
        },
      },
      {
        title: { en: "Return to the task", vi: "Quay lại việc đang làm" },
        body: {
          en: "Return to your guide and continue the next step. For connection terms, start with [Connect your AI agent](/docs/connect-overview).",
          vi: "Quay lại bài hướng dẫn và làm tiếp. Với thuật ngữ kết nối, bắt đầu từ [Kết nối AI agent](/docs/connect-overview).",
        },
      },
    ],
    success: {
      en: "You understand the term well enough to continue your task.",
      vi: "Bạn hiểu thuật ngữ đủ để tiếp tục việc đang làm.",
    },
    troubleshoot: [
      {
        q: { en: "Do I need to memorize these terms?", vi: "Có cần học thuộc các từ này không?" },
        a: {
          en: "No. Look them up when needed and follow the practical steps in the guide.",
          vi: "Không. Tra khi cần và làm theo các bước thực tế trong bài hướng dẫn.",
        },
      },
      {
        q: { en: "What if a term is not listed?", vi: "Nếu không có từ cần tìm thì sao?" },
        a: {
          en: "Read the surrounding explanation in the relevant guide. For an agent-specific term, consult that agent’s documentation.",
          vi: "Đọc phần giải thích xung quanh trong bài liên quan. Với từ riêng của một agent, xem tài liệu của agent đó.",
        },
      },
    ],
    related: ["what-is-muse4ai", "connect-overview", "troubleshooting"],
    appRoute: "/guide",
    updated: "2026-11-02",
  },
];
