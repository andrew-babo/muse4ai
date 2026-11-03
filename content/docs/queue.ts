import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_QUEUE: DocArticle[] = [
  {
    slug: "queue",
    chapter: "queue",
    order: 1,
    title: { en: "Follow jobs in Queue", vi: "Theo dõi lượt trong Hàng chờ" },
    summary: {
      en: "Track waiting and running jobs, preview finished results, and handle requests that need review without creating duplicates.",
      vi: "Theo dõi lượt đang chờ và đang chạy, xem nhanh kết quả và xử lý lượt cần kiểm tra để tránh tạo yêu cầu trùng.",
    },
    before: [
      {
        en: "Send a request from Studio, a batch, or a connected agent.",
        vi: "Gửi yêu cầu từ Studio, một lô hoặc agent đã kết nối.",
      },
      {
        en: `Keep ${FACTS.productName} running while it processes work.`,
        vi: `Giữ ${FACTS.productName} chạy trong lúc xử lý công việc.`,
      },
    ],
    steps: [
      {
        title: { en: "1. Find the job", vi: "1. Tìm lượt cần xem" },
        body: {
          en: "Open Queue and identify the job by its thumbnail and prompt. Read its status before taking action: it may be waiting, running, finished, failed, cancelled, or awaiting review.",
          vi: "Mở Hàng chờ, nhận diện lượt bằng ảnh thu nhỏ và prompt. Đọc trạng thái trước khi thao tác: lượt có thể đang chờ, đang chạy, đã xong, lỗi, đã huỷ hoặc cần kiểm tra.",
        },
        shot: "queue-list",
      },
      {
        title: { en: "2. Preview a result", vi: "2. Xem nhanh kết quả" },
        body: {
          en: "Hover over or focus a job to open its quick preview. Use this to recognize the result without opening each job's full details.",
          vi: "Di chuột lên lượt hoặc đưa tiêu điểm bàn phím tới lượt để xem nhanh. Bạn có thể nhận ra kết quả mà không cần mở chi tiết từng lượt.",
        },
        shot: "queue-preview",
      },
      {
        title: { en: "3. Open full details", vi: "3. Mở chi tiết" },
        body: {
          en: "Click the job to open its drawer. Check the prompt, result, files, and available actions. Open the finished file or its folder from here when those actions are available.",
          vi: "Bấm vào lượt để mở ngăn chi tiết. Kiểm tra prompt, kết quả, tệp và thao tác hiện có. Mở tệp hoàn chỉnh hoặc thư mục từ đây khi có nút tương ứng.",
        },
        shot: "queue-drawer",
      },
      {
        title: { en: "4. Handle review without resending", vi: "4. Kiểm tra mà không gửi trùng" },
        body: {
          en: "Do not resubmit a job marked as needing review. The app is unsure whether Muse received it. Inspect Muse history and use Import from Muse history if a matching result exists; this retrieves a result rather than creating another one.",
          vi: "Không gửi lại lượt mang trạng thái Cần anh xem. App chưa chắc Muse đã nhận yêu cầu hay chưa. Kiểm tra lịch sử Muse và dùng Nhập từ lịch sử Muse nếu có kết quả phù hợp; thao tác này lấy kết quả, không tạo lượt mới.",
        },
      },
    ],
    success: {
      en: "You can identify the job's current state, open its result, and avoid duplicate submissions when delivery is uncertain.",
      vi: "Bạn xác định được trạng thái hiện tại, mở được kết quả và tránh gửi trùng khi chưa rõ Muse đã nhận yêu cầu hay chưa.",
    },
    troubleshoot: [
      {
        q: {
          en: "Why does a job stay in the waiting state?",
          vi: "Vì sao lượt cứ ở trạng thái chờ?",
        },
        a: {
          en: "Check account readiness, usage limit, proxy health, and parallel-job availability. A paused batch can also keep its unsent jobs waiting.",
          vi: "Kiểm tra tài khoản, hạn mức, proxy và số việc chạy song song còn trống. Lô đang tạm dừng cũng khiến các lượt chưa gửi tiếp tục chờ.",
        },
      },
      {
        q: {
          en: "Is a job needing review the same as a failed job?",
          vi: "Lượt cần kiểm tra có giống lượt lỗi không?",
        },
        a: {
          en: "No. Muse may already have received it. Do not use a fresh Studio request or another job to repeat it; inspect the original job and Muse history first.",
          vi: "Không. Muse có thể đã nhận lượt đó. Đừng tạo yêu cầu mới trong Studio hoặc lượt khác để lặp lại; hãy kiểm tra lượt gốc và lịch sử Muse trước.",
        },
      },
      {
        q: {
          en: "Why are retry actions different between jobs?",
          vi: "Vì sao các lượt có nút thử lại khác nhau?",
        },
        a: {
          en: "Available actions depend on the job's state and whether the app knows Muse received it. Resolve the displayed cause instead of assuming every job is safe to resend.",
          vi: "Thao tác phụ thuộc trạng thái và việc app có biết chắc Muse đã nhận lượt hay không. Hãy xử lý nguyên nhân được hiển thị, không mặc định lượt nào cũng có thể gửi lại an toàn.",
        },
      },
    ],
    related: ["accounts-and-limits", "batches", "library", "troubleshooting"],
    appRoute: "/queue",
    updated: "2026-11-02",
  },
];
