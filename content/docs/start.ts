import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_START: DocArticle[] = [
  {
    slug: "what-is-muse4ai",
    chapter: "start",
    order: 1,
    title: {
      en: `What is ${FACTS.productName}?`,
      vi: `${FACTS.productName} là gì?`,
    },
    summary: {
      en: "Learn how Muse4AI connects your Windows PC, your Muse account, and AI agents, and what using it means for your usage limit.",
      vi: "Tìm hiểu cách Muse4AI kết nối máy Windows, tài khoản Muse và AI agent, cùng những điều cần biết về hạn mức sử dụng.",
    },
    before: [
      {
        en: "Have access to a Windows PC.",
        vi: "Bạn có máy tính Windows để sử dụng app.",
      },
      {
        en: "Have your own Muse account if you want to create results.",
        vi: "Bạn có tài khoản Muse riêng nếu muốn tạo kết quả.",
      },
    ],
    steps: [
      {
        title: {
          en: "1. Understand the bridge",
          vi: "1. Hiểu vai trò cầu nối",
        },
        body: {
          en: `${FACTS.productName} is a free Windows app that runs on your PC and works with your own Muse account. You can send requests in Studio or let AI agents send them through MCP or REST.\n\nIt is not a new AI model and is not affiliated with Meta. Creating images and videos uses your Muse account's usage limit; the app itself is free.`,
          vi: `${FACTS.productName} là app Windows miễn phí, chạy trên máy của bạn và dùng tài khoản Muse của bạn. Bạn có thể gửi yêu cầu trong Studio hoặc để AI agent gửi qua MCP hay REST.\n\nĐây không phải mô hình AI mới và không có liên kết với Meta. App miễn phí, nhưng việc tạo ảnh và video vẫn dùng hạn mức của tài khoản Muse của bạn.`,
        },
      },
      {
        title: {
          en: "2. See where work is tracked",
          vi: "2. Xem nơi theo dõi công việc",
        },
        body: {
          en: "Queue brings jobs together so you can follow their status and open their results. Finished files appear in Library and are saved on your PC.",
          vi: "Hàng chờ tập hợp các lượt để bạn theo dõi trạng thái và mở kết quả. Tệp hoàn chỉnh xuất hiện trong Thư viện và được lưu trên máy.",
        },
        shot: "queue-list",
      },
      {
        title: {
          en: "3. Choose your starting point",
          vi: "3. Chọn cách bắt đầu",
        },
        body: {
          en: "Start with [installation](/docs/install), then [add a Muse account](/docs/add-muse-account). You can try Studio before following [Connect an agent](/docs/connect-overview). Agent access needs an API key.",
          vi: "Bắt đầu bằng [cài đặt](/docs/install), rồi [thêm tài khoản Muse](/docs/add-muse-account). Bạn có thể thử Studio trước khi xem [kết nối agent](/docs/connect-overview). Agent cần khoá API để truy cập.",
        },
      },
    ],
    success: {
      en: "You know which account supplies the results, where the files are saved, and whether to start in Studio or connect an agent.",
      vi: "Bạn biết kết quả được tạo bằng tài khoản nào, tệp lưu ở đâu và nên bắt đầu trong Studio hay kết nối agent.",
    },
    troubleshoot: [
      {
        q: {
          en: "Do I need a separate Muse4AI account?",
          vi: "Tôi có cần tài khoản Muse4AI riêng không?",
        },
        a: {
          en: "No. There is no separate Muse4AI account. You sign in to your own Muse account inside the app.",
          vi: "Không. App không có tài khoản Muse4AI riêng. Bạn đăng nhập tài khoản Muse của mình trong app.",
        },
      },
      {
        q: {
          en: "Why did creation stop if the app is free?",
          vi: "Vì sao app miễn phí nhưng không tạo tiếp được?",
        },
        a: {
          en: "Muse controls your account's usage limit and availability. The app pauses when Muse reports a limit, verification request, or unsupported region; it does not bypass these checks.",
          vi: "Muse quyết định hạn mức và khả năng sử dụng của tài khoản. App dừng khi Muse báo hết hạn mức, yêu cầu xác minh hoặc vùng không hỗ trợ; app không vượt các kiểm tra này.",
        },
      },
    ],
    related: ["install", "add-muse-account", "connect-overview"],
    appRoute: "/queue",
    updated: "2026-11-02",
  },
  {
    slug: "install",
    chapter: "start",
    order: 2,
    title: {
      en: `Install ${FACTS.productName}`,
      vi: `Cài đặt ${FACTS.productName}`,
    },
    summary: {
      en: "Install Muse4AI with the Windows EXE or ZIP package, handle SmartScreen safely, and keep your data when updating.",
      vi: "Cài Muse4AI bằng bộ cài EXE hoặc gói ZIP, xử lý cảnh báo SmartScreen và giữ dữ liệu khi cập nhật phiên bản mới.",
    },
    before: [
      {
        en: `Use ${FACTS.windows.en}.`,
        vi: `Dùng ${FACTS.windows.vi}.`,
      },
      {
        en: "Have the Muse4AI EXE installer or ZIP package from a source you trust.",
        vi: "Chuẩn bị bộ cài EXE hoặc gói ZIP Muse4AI từ nguồn bạn tin cậy.",
      },
      {
        en: "If updating with the EXE, you can leave the app open: setup closes it the normal way, like choosing Quit. With the ZIP, right-click the tray icon and choose Quit first; the window's X only minimizes it to the tray.",
        vi: "Nếu cập nhật bằng EXE, bạn cứ để app mở: bộ cài tự đóng app theo cách bình thường, như khi chọn Thoát. Nếu dùng ZIP, hãy nhấp phải biểu tượng ở khay hệ thống và chọn Thoát trước; nút X chỉ thu nhỏ app xuống khay.",
      },
    ],
    steps: [
      {
        title: {
          en: "1. Choose EXE or ZIP",
          vi: "1. Chọn bộ cài EXE hoặc ZIP",
        },
        body: {
          en: "For the simplest route, open the EXE installer, choose English or Tiếng Việt, and follow its instructions. For ZIP installation, extract the whole package into a folder first.",
          vi: "Cách đơn giản nhất là mở bộ cài EXE, chọn English hoặc Tiếng Việt rồi làm theo hướng dẫn. Nếu dùng ZIP, hãy giải nén toàn bộ gói vào một thư mục trước.",
        },
      },
      {
        title: {
          en: "2. Check any Windows warning",
          vi: "2. Kiểm tra cảnh báo của Windows",
        },
        body: {
          en: "The app is not code-signed, so SmartScreen may warn you. Only if you trust the package, choose **More info → Run anyway**. Do not continue with a package whose checksum check fails.",
          vi: "App chưa được ký số nên SmartScreen có thể cảnh báo. Chỉ khi tin cậy gói cài, bạn mới chọn **More info → Run anyway**. Không tiếp tục nếu bộ cài báo kiểm tra mã băm thất bại.",
        },
      },
      {
        title: {
          en: "3. Run PowerShell if using ZIP",
          vi: "3. Chạy PowerShell nếu dùng ZIP",
        },
        body: {
          en: "Skip this step if you used the EXE. In the extracted folder, type `powershell` in File Explorer's address bar and press Enter. Run the command below. It does not change the machine's saved execution policy.",
          vi: "Bỏ qua bước này nếu bạn dùng EXE. Trong thư mục đã giải nén, gõ `powershell` vào thanh địa chỉ File Explorer rồi nhấn Enter. Chạy lệnh dưới đây. Lệnh không đổi chính sách thực thi đã lưu của máy.",
        },
        code: {
          lang: "powershell",
          text: "powershell -ExecutionPolicy Bypass -File .\\install.ps1",
        },
      },
      {
        title: {
          en: "4. Check the install and data locations",
          vi: "4. Kiểm tra nơi cài và nơi lưu dữ liệu",
        },
        body: {
          en: `The app installs to \`${FACTS.installDir}\`. Its data stays in \`${FACTS.dataDir}\` when you install an update, including accounts, settings, queue, and library records. Downloaded results use the library folder you choose.`,
          vi: `App được cài tại \`${FACTS.installDir}\`. Khi cài bản mới, dữ liệu trong \`${FACTS.dataDir}\` được giữ lại, gồm tài khoản, cài đặt, hàng chờ và thông tin thư viện. Tệp kết quả dùng thư mục thư viện bạn chọn.`,
        },
      },
      {
        title: {
          en: "5. Continue with first-run setup",
          vi: "5. Tiếp tục thiết lập lần đầu",
        },
        body: {
          en: "The installer opens the app. If this is your first installation, follow the welcome setup in [First open](/docs/first-open).",
          vi: "Bộ cài sẽ mở app. Nếu đây là lần cài đầu tiên, hãy làm theo màn chào trong bài [Lần đầu mở app](/docs/first-open).",
        },
        shot: "onboarding-welcome",
      },
    ],
    success: {
      en: "Muse4AI opens from its shortcut. A first installation shows the welcome setup; an update keeps your existing data.",
      vi: "Bạn mở được Muse4AI bằng lối tắt. Lần cài đầu hiện phần thiết lập; bản cập nhật giữ dữ liệu đang có.",
    },
    troubleshoot: [
      {
        q: {
          en: "The installer says the app is still running. What now?",
          vi: "Bộ cài báo app vẫn chạy thì làm sao?",
        },
        a: {
          en: "The EXE asks the app to quit and waits about 45 seconds. If jobs are still running, Muse4AI first asks whether to quit. Answer it or let the jobs finish, quit from the tray icon (not the window's X button), then run the installer again.",
          vi: "Bộ cài EXE nhờ app tự thoát và chờ khoảng 45 giây. Nếu còn việc đang chạy, Muse4AI sẽ hỏi lại trước khi thoát. Hãy trả lời câu hỏi đó hoặc chờ việc xong, thoát từ biểu tượng ở khay hệ thống (không chỉ bấm X trên cửa sổ), rồi chạy lại bộ cài.",
        },
      },
      {
        q: {
          en: "The package does not match its checksums. Should I continue?",
          vi: "Gói cài không khớp mã băm. Tôi có nên tiếp tục?",
        },
        a: {
          en: "No. The package may be damaged or modified. Download a fresh copy from a trusted source.",
          vi: "Không. Gói có thể bị hỏng hoặc đã bị sửa. Hãy tải bản mới từ nguồn tin cậy.",
        },
      },
      {
        q: {
          en: "The new version will not open. What can I do?",
          vi: "Bản mới không mở được thì xử lý thế nào?",
        },
        a: {
          en: "See [Updates and backups](/docs/updates-and-backups) before rolling back. Older versions may not read data upgraded by a newer version.",
          vi: "Xem [Cập nhật và sao lưu](/docs/updates-and-backups) trước khi quay về bản cũ. Bản cũ có thể không đọc được dữ liệu đã được bản mới nâng cấp.",
        },
      },
    ],
    related: ["first-open", "updates-and-backups", "troubleshooting"],
    updated: "2026-11-02",
  },
  {
    slug: "first-open",
    chapter: "start",
    order: 3,
    title: {
      en: "First open",
      vi: "Lần đầu mở app",
    },
    summary: {
      en: "Complete first-run setup, choose where results are saved, and prepare a Muse account before sending your first request.",
      vi: "Hoàn tất thiết lập lần đầu, chọn thư mục lưu kết quả và chuẩn bị tài khoản Muse trước khi gửi yêu cầu đầu tiên.",
    },
    before: [
      {
        en: `Install ${FACTS.productName} and open it.`,
        vi: `Cài ${FACTS.productName} rồi mở app.`,
      },
      {
        en: "Choose a local folder with space for downloaded results.",
        vi: "Chuẩn bị thư mục trên máy còn đủ chỗ lưu kết quả.",
      },
      {
        en: "Have your Muse sign-in details and a working proxy ready if you want to finish account setup now.",
        vi: "Chuẩn bị thông tin đăng nhập Muse và proxy hoạt động nếu muốn thiết lập tài khoản ngay.",
      },
    ],
    steps: [
      {
        title: {
          en: "1. Read the notice",
          vi: "1. Đọc lưu ý trước khi dùng",
        },
        body: {
          en: "Read the account-risk notice, then acknowledge it and choose Continue if you agree. Muse can limit or suspend accounts; the app stops for verification, usage limits, or unsupported regions.",
          vi: "Đọc lưu ý về rủi ro tài khoản, xác nhận rồi chọn Tiếp tục nếu đồng ý. Muse có thể giới hạn hoặc khoá tài khoản; app dừng khi gặp xác minh, hạn mức hoặc vùng không hỗ trợ.",
        },
        shot: "onboarding-welcome",
      },
      {
        title: {
          en: "2. Choose the results folder",
          vi: "2. Chọn thư mục lưu kết quả",
        },
        body: {
          en: "Keep the suggested folder or choose another folder, then confirm it. Images and videos are organized by month and batch.",
          vi: "Giữ thư mục được đề xuất hoặc bấm Chọn thư mục khác, rồi chọn Dùng thư mục này. Ảnh và video được chia theo tháng và theo lô.",
        },
      },
      {
        title: {
          en: "3. Prepare a proxy and account",
          vi: "3. Chuẩn bị proxy và tài khoản",
        },
        body: {
          en: "Add a working proxy, then add your Muse account and sign in in its separate window. You can skip setup, but jobs cannot run until an account is ready. See [Add a Muse account](/docs/add-muse-account).",
          vi: "Thêm proxy hoạt động, rồi thêm tài khoản Muse và đăng nhập trong cửa sổ riêng. Bạn có thể chọn Bỏ qua, nhưng cần tài khoản sẵn sàng thì lượt mới chạy được. Xem [Thêm tài khoản Muse](/docs/add-muse-account).",
        },
      },
      {
        title: {
          en: "4. Enter Studio and check your preferences",
          vi: "4. Vào Studio và kiểm tra tuỳ chọn",
        },
        body: {
          en: `Enter Studio when setup is complete. In Settings › General, choose your language and check the library folder. Changing the folder affects new files only; old files remain where they are. App data is separate, in \`${FACTS.dataDir}\`.`,
          vi: `Chọn Vào Studio khi hoàn tất. Trong Cài đặt › Chung, chọn ngôn ngữ và kiểm tra thư mục ở mục Thư viện. Đổi thư mục chỉ áp dụng cho tệp mới; tệp cũ giữ nguyên chỗ. Dữ liệu app nằm riêng tại \`${FACTS.dataDir}\`.`,
        },
        shot: "settings-general",
      },
    ],
    success: {
      en: "Studio opens, your language is correct, and your chosen library folder is shown in General settings.",
      vi: "Studio mở được, ngôn ngữ đúng ý bạn và mục Chung hiển thị thư mục thư viện bạn đã chọn.",
    },
    troubleshoot: [
      {
        q: {
          en: "I skipped account setup. Can I return to it?",
          vi: "Tôi đã bỏ qua bước tài khoản. Có làm lại được không?",
        },
        a: {
          en: "Yes. Open Accounts and add an account when your proxy and Muse sign-in details are ready.",
          vi: "Có. Mở Tài khoản và thêm tài khoản khi bạn đã chuẩn bị proxy cùng thông tin đăng nhập Muse.",
        },
      },
      {
        q: {
          en: "Why did changing the folder not move my old files?",
          vi: "Vì sao đổi thư mục mà tệp cũ không chuyển theo?",
        },
        a: {
          en: "The setting changes where new results are saved. It does not move existing files.",
          vi: "Cài đặt này đổi nơi lưu kết quả mới, không di chuyển tệp đang có.",
        },
      },
    ],
    related: ["add-muse-account", "create-image", "settings-overview"],
    appRoute: "/settings/general",
    updated: "2026-11-02",
  },
];
