import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_SETTINGS: DocArticle[] = [
  {
    slug: "remote-access",
    chapter: "settings",
    order: 1,
    title: { en: "Remote access", vi: "Truy cập từ xa" },
    summary: {
      en: "Let a cloud agent reach your PC through a tunnel or HTTPS domain, or share only within a trusted private network.",
      vi: "Cho agent đám mây gọi tới máy qua đường hầm hoặc tên miền HTTPS, hay chỉ chia sẻ trong một mạng riêng đáng tin cậy.",
    },
    before: [
      {
        en: "Enable API for agents and create a separate key for the remote agent.",
        vi: "Bật API cho agent và tạo khoá riêng cho agent từ xa.",
      },
      {
        en: "Keep this PC awake and the app running while remote agents need it.",
        vi: "Giữ máy thức và app hoạt động trong lúc agent từ xa cần kết nối.",
      },
      {
        en: "A public address makes the server reachable; it does not remove key requirements.",
        vi: "Địa chỉ công khai giúp gọi được máy chủ; nó không bỏ yêu cầu dùng khoá.",
      },
    ],
    steps: [
      {
        title: { en: "Choose who can connect", vi: "Chọn nơi được kết nối" },
        body: {
          en: "Open Settings › API & agent. The access choices are This machine only, Private network, Quick tunnel, and Named tunnel.",
          vi: "Mở Cài đặt › API & agent. Các lựa chọn là Chỉ máy này, Mạng riêng, Đường hầm tạm thời và Đường hầm có tên.",
        },
        shot: "settings-remote",
      },
      {
        title: { en: "Use a Quick tunnel for a temporary link", vi: "Dùng đường hầm tạm thời" },
        body: {
          en: "Confirm public sharing and wait for the tunnel to be online. The app uses cloudflared. The address changes each time the app starts, so update your cloud agent after a restart.",
          vi: "Xác nhận chia sẻ công khai và chờ đường hầm trực tuyến. App dùng cloudflared. Địa chỉ thay đổi mỗi lần app khởi động, nên bạn cần cập nhật agent đám mây sau khi mở lại.",
        },
      },
      {
        title: { en: "Choose a fixed address if needed", vi: "Chọn địa chỉ cố định khi cần" },
        body: {
          en: "A named tunnel uses your Cloudflare setup and domain. The separate domain section can provide direct HTTPS using App-managed HTTPS with Caddy, or an Existing HTTPS proxy such as Caddy, nginx, or IIS. Follow its DNS and connectivity checks; these routes can coexist with a tunnel.",
          vi: "Đường hầm có tên dùng cấu hình Cloudflare và tên miền của bạn. Phần tên miền riêng có thể phục vụ HTTPS trực tiếp bằng App tự chạy HTTPS với Caddy, hoặc Proxy HTTPS có sẵn như Caddy, nginx hay IIS. Làm theo bước kiểm tra DNS và kết nối; các cách này có thể chạy cùng đường hầm.",
        },
      },
      {
        title: { en: "Use private sharing only where reachable", vi: "Chỉ chia sẻ riêng khi có đường kết nối" },
        body: {
          en: "Private network is for devices that can reach your PC through a LAN or private network such as Tailscale. It is not automatically a public link for a cloud service.",
          vi: "Mạng riêng dành cho thiết bị có thể gọi tới máy bạn qua LAN hoặc mạng riêng như Tailscale. Nó không tự trở thành liên kết công khai cho dịch vụ đám mây.",
        },
      },
      {
        title: { en: "Copy the address and limit exposure", vi: "Chép địa chỉ và hạn chế chia sẻ" },
        body: {
          en: `Use the current public base with ${FACTS.mcpPath} for MCP or ${FACTS.restBase} for REST, plus the agent’s key. Turn off sharing when it is not needed; disable a separately enabled domain too.`,
          vi: `Dùng địa chỉ công khai hiện tại với ${FACTS.mcpPath} cho MCP hoặc ${FACTS.restBase} cho REST, kèm khoá của agent. Tắt chia sẻ khi không cần; nếu đã bật tên miền riêng, hãy tắt cả phần đó.`,
        },
        code: {
          lang: "text",
          text: `https://your-tunnel.trycloudflare.com${FACTS.mcpPath}\nAuthorization: Bearer ${FACTS.placeholderKey}`,
        },
      },
    ],
    success: {
      en: "The intended remote agent can read status with its key, and unnecessary sharing is off.",
      vi: "Agent từ xa cần dùng đọc được trạng thái bằng khoá riêng, còn các cách chia sẻ không cần thiết đã tắt.",
    },
    troubleshoot: [
      {
        q: { en: "Why did yesterday’s link stop working?", vi: "Vì sao liên kết hôm qua không còn dùng được?" },
        a: {
          en: "Quick tunnel addresses change at app startup. Copy the current address into the agent again.",
          vi: "Địa chỉ đường hầm tạm thời đổi khi app khởi động. Chép địa chỉ hiện tại vào agent lần nữa.",
        },
      },
      {
        q: { en: "Why does a public URL still need a key?", vi: "Vì sao URL công khai vẫn cần khoá?" },
        a: {
          en: "The tunnel changes reachability, not authorization. Protected operations still require an active key.",
          vi: "Đường hầm chỉ đổi khả năng kết nối, không đổi quyền truy cập. Thao tác được bảo vệ vẫn cần khoá còn hiệu lực.",
        },
      },
      {
        q: { en: "Does turning off the tunnel stop my domain?", vi: "Tắt đường hầm có tắt tên miền không?" },
        a: {
          en: "The domain is configured separately and can run alongside a tunnel. Check both, or disable the API entirely.",
          vi: "Tên miền được cấu hình riêng và có thể chạy cùng đường hầm. Kiểm tra cả hai hoặc tắt toàn bộ API.",
        },
      },
    ],
    related: ["connect-overview", "api-keys", "privacy-and-data"],
    appRoute: "/settings/api",
    updated: "2026-11-02",
  },
  {
    slug: "settings-overview",
    chapter: "settings",
    order: 2,
    title: { en: "Find the right setting", vi: "Tìm đúng phần cài đặt" },
    summary: {
      en: "Find language, output folders, job controls, notifications, agent access, security, and diagnostics in Settings.",
      vi: "Tìm ngôn ngữ, thư mục kết quả, điều khiển công việc, thông báo, kết nối agent, bảo mật và chẩn đoán trong Cài đặt.",
    },
    before: [
      {
        en: "Decide what you want to change before changing several settings at once.",
        vi: "Xác định điều cần đổi trước khi thay nhiều cài đặt cùng lúc.",
      },
      {
        en: `Keep ${FACTS.productName} open so you can check the result of each change.`,
        vi: `Giữ ${FACTS.productName} mở để kiểm tra kết quả sau mỗi thay đổi.`,
      },
    ],
    steps: [
      {
        title: { en: "Start with General", vi: "Bắt đầu từ Chung" },
        body: {
          en: "Open Settings › General for language and the Library folder. English is the default; Vietnamese is also available.",
          vi: "Mở Cài đặt › Chung để chọn ngôn ngữ và thư mục Thư viện. Mặc định là tiếng Anh; bạn cũng có thể chọn tiếng Việt.",
        },
        shot: "settings-general",
      },
      {
        title: { en: "Find work and connection controls", vi: "Tìm cài đặt công việc và kết nối" },
        body: {
          en: "Use Proxy for proxy management, Job execution for the direct channel and app-wide limits, Queue for retries, and Notifications for alerts. Each account’s execution method is on its card in Accounts.",
          vi: "Dùng Proxy để quản lý proxy, Chạy việc cho kênh trực tiếp và giới hạn toàn app, Hàng chờ cho số lần thử lại, Thông báo cho cảnh báo. Cách chạy của từng tài khoản nằm trên thẻ của nó trong Tài khoản.",
        },
      },
      {
        title: { en: "Manage agent access", vi: "Quản lý kết nối agent" },
        body: {
          en: "API & agent contains the server switch, port, keys, agent configuration, and remote sharing. Leave remote sharing off unless another machine needs access.",
          vi: "API & agent có công tắc máy chủ, cổng, khoá, cấu hình agent và chia sẻ từ xa. Giữ chia sẻ từ xa tắt nếu máy khác không cần truy cập.",
        },
      },
      {
        title: { en: "Find support information", vi: "Tìm thông tin hỗ trợ" },
        body: {
          en: "Check Security for security settings, Diagnostics for an exportable diagnostics ZIP, and About for the installed version, maker, and acknowledgments.",
          vi: "Xem Bảo mật để chỉnh bảo mật, Chẩn đoán để xuất ZIP chẩn đoán và Giới thiệu để xem phiên bản, tác giả cùng ghi nguồn.",
        },
      },
    ],
    success: {
      en: "You can find the setting you need without changing unrelated controls.",
      vi: "Bạn tìm được phần cần dùng mà không phải đổi các cài đặt không liên quan.",
    },
    troubleshoot: [
      {
        q: { en: "Where is the account’s connection mode?", vi: "Chế độ kết nối tài khoản ở đâu?" },
        a: {
          en: "Open that account’s settings in Accounts, not the API server settings.",
          vi: "Mở cài đặt của tài khoản trong Tài khoản, không phải cài đặt máy chủ API.",
        },
      },
      {
        q: { en: "Where can I check the installed version?", vi: "Xem phiên bản đã cài ở đâu?" },
        a: {
          en: "Open Settings › About before reporting a problem.",
          vi: "Mở Cài đặt › Giới thiệu trước khi báo lỗi.",
        },
      },
    ],
    related: ["proxies-and-modes", "remote-access", "updates-and-backups"],
    appRoute: "/settings/general",
    updated: "2026-11-02",
  },
  {
    slug: "updates-and-backups",
    chapter: "settings",
    order: 3,
    title: { en: "Updates, rollback, and backups", vi: "Cập nhật, quay lại và sao lưu" },
    summary: {
      en: "Install a newer version without deleting your data, understand rollback limits, and recover from a checked backup.",
      vi: "Cài phiên bản mới mà không xoá dữ liệu, hiểu giới hạn khi quay về bản cũ và khôi phục từ bản sao lưu đã được kiểm tra.",
    },
    before: [
      {
        en: "Finish or inspect active jobs before quitting. Do not delete the data folder to update.",
        vi: "Hoàn tất hoặc kiểm tra việc đang chạy trước khi thoát. Không xoá thư mục dữ liệu để cập nhật.",
      },
      {
        en: `The app installs in ${FACTS.installDir}; its roaming data is in ${FACTS.dataDir}. Output files live separately.`,
        vi: `App được cài tại ${FACTS.installDir}; dữ liệu roaming nằm tại ${FACTS.dataDir}. Tệp kết quả được lưu riêng.`,
      },
    ],
    steps: [
      {
        title: { en: "Check the version and quit fully", vi: "Xem phiên bản rồi thoát hẳn" },
        body: {
          en: "Check Settings › About. Then right-click the tray icon and choose Quit. The window’s X button only hides the app in the tray.",
          vi: "Xem Cài đặt › Giới thiệu. Sau đó bấm phải biểu tượng ở khay hệ thống và chọn thoát. Nút X của cửa sổ chỉ ẩn app xuống khay.",
        },
        shot: "settings-about",
      },
      {
        title: { en: "Install the newer package", vi: "Cài gói phiên bản mới" },
        body: {
          en: "Run the new EXE installer, or extract the new ZIP and run install.ps1. Installing over the current version preserves sign-ins, settings, queue, and library. Automatic updating is not available.",
          vi: "Chạy bộ cài EXE mới, hoặc giải nén ZIP mới rồi chạy install.ps1. Cài đè giữ phiên đăng nhập, cài đặt, hàng chờ và thư viện. App chưa có tự cập nhật.",
        },
      },
      {
        title: { en: "Understand automatic backups", vi: "Hiểu sao lưu tự động" },
        body: {
          en: `Database backups are stored under ${FACTS.dataDir}\\backups. The app keeps daily backups and makes a backup before a data-schema upgrade. These database copies are not a backup of your output files or every sign-in file.`,
          vi: `Bản sao lưu cơ sở dữ liệu nằm trong ${FACTS.dataDir}\\backups. App giữ bản sao lưu hằng ngày và tạo bản trước khi nâng cấu trúc dữ liệu. Đây không phải bản sao của tệp kết quả hay toàn bộ tệp phiên đăng nhập.`,
        },
      },
      {
        title: { en: "Restore only when needed", vi: "Chỉ khôi phục khi cần" },
        body: {
          en: "At startup the app checks the database. If it is corrupt, it offers the newest backup that passes its check and keeps the damaged files for diagnosis. Changes after the backup may be lost; library files remain separate.",
          vi: "Khi khởi động, app kiểm tra cơ sở dữ liệu. Nếu dữ liệu hỏng, app đề nghị dùng bản sao mới nhất vượt qua kiểm tra và giữ tệp hỏng để chẩn đoán. Thay đổi sau thời điểm sao lưu có thể mất; tệp thư viện được lưu riêng.",
        },
      },
      {
        title: { en: "Roll back carefully", vi: "Quay về bản cũ cẩn thận" },
        body: {
          en: "Quit first, then run the rollback command from the extracted installer folder. An older version may not read an upgraded database. If it reports newer-version data, preserve the current database and follow the installer guide’s pre-upgrade backup procedure; do not overwrite data casually.",
          vi: "Thoát hẳn trước, rồi chạy lệnh quay lại từ thư mục bộ cài đã giải nén. Bản cũ có thể không đọc được cơ sở dữ liệu đã nâng cấp. Nếu báo dữ liệu thuộc bản mới hơn, giữ lại dữ liệu hiện tại và làm theo quy trình dùng bản sao trước nâng cấp trong hướng dẫn cài; không tuỳ tiện ghi đè.",
        },
        code: {
          lang: "powershell",
          text: "powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Rollback",
        },
      },
      {
        title: { en: "Export diagnostics for support", vi: "Xuất chẩn đoán khi cần hỗ trợ" },
        body: {
          en: "Open Settings › Diagnostics and export the diagnostics ZIP. Review what you share. If the app cannot start, preserve its logs and describe the startup error.",
          vi: "Mở Cài đặt › Chẩn đoán và xuất ZIP chẩn đoán. Xem lại nội dung trước khi chia sẻ. Nếu app không mở được, giữ nhật ký và mô tả lỗi khởi động.",
        },
        shot: "settings-diagnostics",
      },
    ],
    success: {
      en: "The intended version opens with your data, or you have a preserved backup and diagnostics for recovery.",
      vi: "Phiên bản cần dùng mở được cùng dữ liệu, hoặc bạn đã giữ bản sao và thông tin chẩn đoán để khôi phục.",
    },
    troubleshoot: [
      {
        q: { en: "The installer says the app is still running.", vi: "Bộ cài báo app vẫn đang chạy." },
        a: {
          en: "Quit from the tray icon. Closing the window alone does not stop the app.",
          vi: "Thoát bằng biểu tượng ở khay hệ thống. Chỉ đóng cửa sổ chưa dừng app.",
        },
      },
      {
        q: { en: "Will restoring a backup keep recent changes?", vi: "Khôi phục có giữ thay đổi mới không?" },
        a: {
          en: "Not necessarily. Jobs and settings changed after that backup can be lost. Keep the current files before manual recovery.",
          vi: "Không chắc. Công việc và cài đặt thay đổi sau bản sao có thể mất. Giữ tệp hiện tại trước khi tự khôi phục.",
        },
      },
      {
        q: { en: "Are my videos inside the database backup?", vi: "Video có nằm trong bản sao cơ sở dữ liệu không?" },
        a: {
          en: "No. Back up the output folder separately if you need an independent copy of your media.",
          vi: "Không. Hãy sao lưu riêng thư mục kết quả nếu cần bản sao độc lập của ảnh và video.",
        },
      },
    ],
    related: ["install", "troubleshooting", "privacy-and-data"],
    appRoute: "/settings/about",
    updated: "2026-11-02",
  },
  {
    slug: "privacy-and-data",
    chapter: "settings",
    order: 4,
    title: { en: "Privacy and your data", vi: "Quyền riêng tư và dữ liệu" },
    summary: {
      en: "See what stays on your PC, what your prompts and attached files send to Muse, and how to limit agent access safely.",
      vi: "Biết dữ liệu nào ở trên máy, prompt và tệp đính kèm nào được gửi tới Muse, cùng cách giới hạn quyền truy cập của agent.",
    },
    before: [
      {
        en: "Only attach files you are allowed to send to Muse.",
        vi: "Chỉ đính kèm tệp bạn được phép gửi tới Muse.",
      },
      {
        en: "Review your agent provider’s data practices separately; its service is outside the app.",
        vi: "Xem riêng cách nhà cung cấp agent xử lý dữ liệu; dịch vụ đó nằm ngoài app.",
      },
    ],
    steps: [
      {
        title: { en: "Know what stays on this PC", vi: "Biết dữ liệu lưu trên máy" },
        body: {
          en: `${FACTS.productName} keeps jobs, settings, API-key records, downloaded files, and account sign-in sessions in its own local storage. It does not store your Muse password. Roaming data is under ${FACTS.dataDir}; media uses your chosen output folder.`,
          vi: `${FACTS.productName} lưu công việc, cài đặt, bản ghi khoá API, tệp đã tải và phiên đăng nhập trong vùng lưu trữ riêng trên máy. App không lưu mật khẩu Muse. Dữ liệu roaming nằm tại ${FACTS.dataDir}; nội dung tải về dùng thư mục kết quả bạn chọn.`,
        },
        shot: "settings-general",
      },
      {
        title: { en: "Know what is sent to Muse", vi: "Biết nội dung gửi tới Muse" },
        body: {
          en: "Your prompts and attached files are sent to Muse through your own account so it can answer or generate results. Jobs on one account share its Muse memory and history. Avoid sending confidential material without permission.",
          vi: "Prompt và tệp bạn đính kèm được gửi tới Muse qua tài khoản của bạn để trả lời hoặc tạo kết quả. Các việc trên một tài khoản dùng chung bộ nhớ và lịch sử Muse. Không gửi tài liệu mật khi chưa được phép.",
        },
      },
      {
        title: { en: "Understand the project boundary", vi: "Hiểu ranh giới của dự án" },
        body: {
          en: "The app does not send your jobs, files, keys, or sign-in sessions to Andrew Babo or the Muse4AI website. Connecting an agent or enabling a tunnel introduces the separate providers you choose.",
          vi: "App không gửi công việc, tệp, khoá hoặc phiên đăng nhập của bạn tới Andrew Babo hay website Muse4AI. Khi kết nối agent hoặc bật đường hầm, bạn sử dụng thêm các nhà cung cấp riêng do mình chọn.",
        },
      },
      {
        title: { en: "Limit access and shared material", vi: "Giới hạn truy cập và nội dung chia sẻ" },
        body: {
          en: "Use one key per agent, keep sharing off when unnecessary, and revoke unused keys. Review diagnostics and screenshots before sending them. Never include a full API key in a screenshot or URL.",
          vi: "Dùng khoá riêng cho từng agent, tắt chia sẻ khi không cần và thu hồi khoá không còn dùng. Xem lại chẩn đoán và ảnh chụp trước khi gửi. Không để toàn bộ khoá API trong ảnh hoặc URL.",
        },
        shot: "settings-security",
      },
    ],
    success: {
      en: "You know which data stays local, which goes to Muse, and who can access the app through your keys.",
      vi: "Bạn biết dữ liệu nào ở trên máy, nội dung nào gửi tới Muse và ai có thể truy cập app bằng khoá.",
    },
    troubleshoot: [
      {
        q: { en: "Does no password storage mean no session storage?", vi: "Không lưu mật khẩu có nghĩa là không lưu phiên không?" },
        a: {
          en: "No. The app retains sign-in sessions in its own storage so accounts can stay signed in.",
          vi: "Không. App giữ phiên đăng nhập trong vùng lưu trữ riêng để tài khoản có thể tiếp tục đăng nhập.",
        },
      },
      {
        q: { en: "Can I isolate research between agents?", vi: "Có thể tách nghiên cứu giữa các agent không?" },
        a: {
          en: "Separate API keys control access, but jobs on one Muse account still share that account’s memory. Use separate accounts when separation matters.",
          vi: "Khoá API riêng giúp quản lý truy cập, nhưng các việc trên cùng tài khoản Muse vẫn dùng chung bộ nhớ. Dùng tài khoản riêng khi cần tách biệt.",
        },
      },
    ],
    related: ["api-keys", "remote-access", "accounts-and-limits"],
    appRoute: "/settings/security",
    updated: "2026-11-02",
  },
];
