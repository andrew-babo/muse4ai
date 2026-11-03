import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_BATCH: DocArticle[] = [
  {
    slug: "batches",
    chapter: "batch",
    order: 1,
    title: { en: "Create and follow batches", vi: "Tạo và theo dõi lô" },
    summary: {
      en: "Turn a pasted or imported prompt list into a batch, check each row, and follow progress without sending jobs one by one.",
      vi: "Tạo lô từ danh sách prompt đã dán hoặc nhập từ tệp, kiểm tra từng dòng và theo dõi tiến trình mà không gửi từng lượt.",
    },
    before: [
      {
        en: "Prepare one prompt per line, or a TXT or CSV file.",
        vi: "Chuẩn bị mỗi dòng một prompt hoặc tệp TXT hay CSV.",
      },
      {
        en: "Have ready Muse accounts with enough usage limit for the work you intend to send.",
        vi: "Có tài khoản Muse sẵn sàng và còn hạn mức cho công việc bạn định gửi.",
      },
      {
        en: "Review the list for accidental duplicates before importing it.",
        vi: "Rà soát danh sách để loại prompt trùng ngoài ý muốn trước khi nhập.",
      },
    ],
    steps: [
      {
        title: { en: "1. Create a batch", vi: "1. Tạo lô mới" },
        body: {
          en: `In ${FACTS.productName}, open Batches and choose New batch. Give it a recognizable name and choose the default type, creation mode, repeat setting, and account.`,
          vi: `Trong ${FACTS.productName}, mở Hàng loạt rồi chọn Lô mới. Đặt tên dễ nhận biết và chọn mặc định cho loại, cách tạo, số lần lặp cùng tài khoản.`,
        },
        shot: "batch-new",
      },
      {
        title: { en: "2. Paste or import prompts", vi: "2. Dán hoặc nhập prompt" },
        body: {
          en: "Paste one prompt per line, choose a TXT or CSV file, or drop the file into the import area. Use the CSV sample shown in the app if you need columns for per-row settings.",
          vi: "Dán mỗi dòng một prompt, bấm Chọn tệp… để nhập TXT hoặc CSV, hay thả tệp vào vùng nhập. Dùng Xem mẫu CSV trong app nếu cần cột thiết lập riêng cho từng dòng.",
        },
      },
      {
        title: { en: "3. Validate every row", vi: "3. Kiểm tra từng dòng" },
        body: {
          en: "Run the list check, review the parsed rows, and fix errors. Check the total number of jobs, including repeats. Changing defaults applies to the next list check, so check again after changing them.",
          vi: "Bấm Kiểm danh sách, xem các dòng đã đọc và sửa lỗi. Kiểm tra tổng số lượt, gồm cả lần lặp. Đổi mặc định chỉ áp dụng cho lần đọc tiếp theo, nên hãy kiểm lại sau khi đổi.",
        },
      },
      {
        title: { en: "4. Start or save a draft", vi: "4. Bắt đầu hoặc lưu nháp" },
        body: {
          en: "Save a draft if the list is not ready. Otherwise, use the start button after confirming its job count. Each created job uses the selected accounts' Muse usage limit.",
          vi: "Chọn Lưu nháp nếu danh sách chưa sẵn sàng. Nếu đã kiểm tra xong, xác nhận số lượt trên nút Bắt đầu rồi chạy. Mỗi lượt tạo dùng hạn mức Muse của các tài khoản được chọn.",
        },
      },
      {
        title: { en: "5. Follow the batch", vi: "5. Theo dõi lô" },
        body: {
          en: "Open the batch to follow finished, running, waiting, failed, and review counts. Pause or resume when needed. Finished files appear in Library, grouped by the batch name.",
          vi: "Mở lô để xem số lượt đã xong, đang chạy, đang chờ, lỗi và cần xem. Dùng Tạm dừng hoặc Tiếp tục khi cần. Tệp hoàn chỉnh nằm trong Thư viện, nhóm theo tên lô.",
        },
        shot: "batch-list",
      },
    ],
    success: {
      en: "The batch shows the intended number of jobs and its progress updates as results arrive in Library.",
      vi: "Lô hiển thị đúng số lượt dự kiến và tiến trình cập nhật khi kết quả xuất hiện trong Thư viện.",
    },
    troubleshoot: [
      {
        q: {
          en: "The imported text has strange characters. What should I do?",
          vi: "Văn bản nhập vào có ký tự lạ thì làm sao?",
        },
        a: {
          en: "The file may not be UTF-8. Open it in Notepad, save it with UTF-8 encoding, then import and validate it again.",
          vi: "Tệp có thể chưa dùng UTF-8. Mở bằng Notepad, chọn Lưu thành với mã hoá UTF-8, rồi nhập và kiểm tra lại.",
        },
      },
      {
        q: {
          en: "Why are there more jobs than prompt lines?",
          vi: "Vì sao số lượt nhiều hơn số dòng prompt?",
        },
        a: {
          en: "Check the repeat default and any CSV repeat values. Repeated rows create separate jobs, so confirm the total before starting.",
          vi: "Kiểm tra mặc định Lặp mỗi dòng và giá trị lặp trong CSV. Mỗi lần lặp tạo lượt riêng, nên hãy xác nhận tổng trước khi chạy.",
        },
      },
      {
        q: {
          en: "Will cancelling the remainder stop jobs already generating?",
          vi: "Huỷ phần còn lại có dừng lượt đang tạo không?",
        },
        a: {
          en: "No. The confirmation states that waiting jobs are cancelled while generating jobs continue until finished. Do not resubmit jobs needing review.",
          vi: "Không. Hộp xác nhận cho biết lượt chưa chạy sẽ bị huỷ, còn lượt đang tạo vẫn tiếp tục đến khi xong. Không gửi lại lượt đang cần kiểm tra.",
        },
      },
    ],
    related: ["queue", "library", "accounts-and-limits"],
    appRoute: "/batch",
    updated: "2026-11-02",
  },
];
