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
    title: { en: "Updates, rollback, uninstall, and backups", vi: "Cập nhật, quay lại, gỡ cài và sao lưu" },
    summary: {
      en: "Update from inside the app without losing data, go back to the kept previous version, uninstall cleanly from Windows Settings, and recover from a backup.",
      vi: "Cập nhật ngay trong app mà không mất dữ liệu, quay lại bản trước còn giữ, gỡ cài gọn từ Cài đặt Windows và khôi phục từ bản sao lưu đã kiểm tra.",
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
        title: { en: "See your version and the update check", vi: "Xem phiên bản và việc kiểm tra bản mới" },
        body: {
          en: "Settings › About shows the version you use and an Updates card. When the app opens and every 12 hours it reads one small file on the Muse4AI website to see whether a newer version exists; it sends none of your data. Turn the switch off to stop checking, or press Check now at any time.",
          vi: "Cài đặt › Giới thiệu hiện phiên bản đang dùng và thẻ Cập nhật. Lúc mở app và mỗi 12 giờ, app đọc một tệp nhỏ trên website Muse4AI để biết có bản mới không; không gửi dữ liệu nào của bạn. Tắt công tắc nếu không muốn app kiểm tra, hoặc bấm Kiểm tra ngay bất cứ lúc nào.",
        },
        shot: "settings-about",
      },
      {
        title: { en: "Update from inside the app", vi: "Cập nhật ngay trong app" },
        body: {
          en: "When a newer version is out, a dot appears next to Settings and the app tells you once. Open Settings › About and choose Download and install: the app downloads the installer, checks its SHA-256 fingerprint, then closes, installs, and opens again in about a minute. Sign-ins, settings, queue, and library are kept. If jobs are running it asks first: jobs already sent are reconciled when the app reopens, jobs not yet sent stay in the queue.",
          vi: "Khi có bản mới, Cài đặt có một chấm nhỏ và app báo bạn một lần. Mở Cài đặt › Giới thiệu rồi chọn Tải và cài: app tải bộ cài, kiểm dấu vân tay SHA-256, rồi tự đóng, cài và mở lại sau khoảng một phút. Phiên đăng nhập, cài đặt, hàng chờ và thư viện được giữ nguyên. Nếu còn việc đang chạy, app hỏi trước: việc đã gửi sẽ được đối soát khi mở lại, việc chưa gửi vẫn nằm trong hàng chờ.",
        },
      },
      {
        title: { en: "Or install the newer package yourself", vi: "Hoặc tự cài gói phiên bản mới" },
        body: {
          en: "You can still run a new EXE installer from the website (it closes the app for you), or extract the new ZIP, quit from the tray icon, and run install.ps1. Installing over the current version keeps your data the same way.",
          vi: "Bạn vẫn có thể chạy bộ cài EXE mới tải từ website (bộ cài tự đóng app), hoặc giải nén ZIP mới, thoát app từ biểu tượng ở khay rồi chạy install.ps1. Cài đè vẫn giữ dữ liệu như trên.",
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
        title: { en: "Go back to the previous version", vi: "Quay lại bản trước" },
        body: {
          en: "Each update keeps one previous version on the PC. If the new one has a problem, open Settings › About › Previous version and choose Go back to this version; the app closes and opens the older one with the same data. It only offers this when that version can read your current data — after a data-store upgrade an older version cannot, and the card says so. Without the app, the uninstall window offers the same rollback, or run the command below.",
          vi: "Mỗi lần cập nhật, máy giữ lại một bản trước. Nếu bản mới có vấn đề, mở Cài đặt › Giới thiệu › Bản trước rồi chọn Quay lại bản này; app đóng và mở bản cũ với cùng dữ liệu. App chỉ mời quay lại khi bản đó đọc được dữ liệu hiện tại — sau khi kho dữ liệu đã nâng cấp thì bản cũ không đọc được, và thẻ sẽ nói rõ. Khi không mở được app, cửa sổ gỡ cài có cùng lựa chọn quay lại, hoặc chạy lệnh dưới đây.",
        },
        code: {
          lang: "powershell",
          text: "powershell -ExecutionPolicy Bypass -File \"$env:LOCALAPPDATA\\Programs\\Muse4AI\\tools\\install.ps1\" -Rollback",
        },
      },
      {
        title: { en: "Uninstall from Windows Settings", vi: "Gỡ cài từ Cài đặt Windows" },
        body: {
          en: "Open Windows Settings › Apps › Installed apps, find Muse4AI and choose Uninstall. A small window asks whether to also delete accounts, proxies, settings, and sign-ins saved on this PC; leave it unticked to keep them for a later reinstall. Images and videos in your library are always kept. If the app is open, it is asked to quit the normal way first.",
          vi: "Mở Cài đặt Windows › Ứng dụng › Ứng dụng đã cài, tìm Muse4AI rồi chọn Gỡ cài đặt. Một cửa sổ nhỏ hỏi có xoá luôn tài khoản, proxy, cài đặt và phiên đăng nhập lưu trên máy không; để trống nếu muốn giữ lại cho lần cài sau. Ảnh và video trong thư viện luôn được giữ. Nếu app đang mở, app được nhờ tự thoát theo cách bình thường trước.",
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
          en: "The EXE waits about 45 seconds for the app to quit. If jobs are still running, Muse4AI first asks whether to quit. Answer it or let the jobs finish, quit from the tray icon (closing the window alone does not stop the app), then run the installer again.",
          vi: "Bộ cài EXE chờ app thoát khoảng 45 giây. Nếu còn việc đang chạy, Muse4AI sẽ hỏi lại trước khi thoát. Hãy trả lời câu hỏi đó hoặc chờ việc xong, thoát bằng biểu tượng ở khay hệ thống (chỉ đóng cửa sổ chưa dừng app), rồi chạy lại bộ cài.",
        },
      },
      {
        q: { en: "The Updates card says this copy cannot install by itself.", vi: "Thẻ Cập nhật báo bản này không tự cài được." },
        a: {
          en: "That copy was not installed with the EXE or install.ps1 (for example it runs from another folder). Open the download page, run the installer once, and later updates work from inside the app.",
          vi: "Bản đó không được cài bằng bộ cài EXE hay install.ps1 (ví dụ chạy từ một thư mục khác). Mở trang tải về, chạy bộ cài một lần, các lần cập nhật sau sẽ làm được ngay trong app.",
        },
      },
      {
        q: { en: "Checking for updates failed.", vi: "Kiểm tra bản mới bị lỗi." },
        a: {
          en: "Usually the PC is offline or the website could not be reached. Nothing else is affected and the app keeps working; it tries again in 12 hours, or press Check now. A download that does not match its SHA-256 fingerprint is deleted and never run.",
          vi: "Thường do máy mất mạng hoặc không vào được website. Không ảnh hưởng gì khác, app vẫn chạy bình thường; app thử lại sau 12 giờ, hoặc bấm Kiểm tra ngay. Tệp tải về không khớp dấu vân tay SHA-256 sẽ bị xoá và không bao giờ được chạy.",
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
    updated: "2026-11-06",
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
          en: "The app does not send your jobs, files, keys, or sign-in sessions to Andrew Babo or the Muse4AI website. Its update check only downloads a small public file from the website (you can turn it off in Settings › About). Connecting an agent or enabling a tunnel introduces the separate providers you choose.",
          vi: "App không gửi công việc, tệp, khoá hoặc phiên đăng nhập của bạn tới Andrew Babo hay website Muse4AI. Việc kiểm tra bản mới chỉ tải một tệp công khai nhỏ từ website (tắt được trong Cài đặt › Giới thiệu). Khi kết nối agent hoặc bật đường hầm, bạn sử dụng thêm các nhà cung cấp riêng do mình chọn.",
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
    updated: "2026-11-06",
  },
];
