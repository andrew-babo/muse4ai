# Build 3.3 — Spec: lấp các khoảng trống để Muse4AI chạy như phần mềm production

> Revision R1 · 06/11/2026 · **Nguồn chuẩn duy nhất** của luật và AC-ID cho Build 3.3. `plan.md`, `qa-human.md` và
> bằng chứng chỉ tham chiếu AC-ID. Mức: Compact (Discover/Research ngắn nằm ngay trong file này).

## 0. Discover ngắn

- **Yêu cầu (anh, 06/11 21:08):** “lắp các gap để nền tảng của chúng ta chuẩn xịn tiện lợi giống production”.
- **Khoảng trống đọc từ beta.33 + roadmap:**
  1. Không có tự kiểm tra bản mới: người dùng phải tự vào web xem; Cài đặt › Giới thiệu ghi “Chưa có tự cập nhật”.
  2. Người dùng bản EXE không gỡ được app từ Windows (Cài đặt › Ứng dụng không có Muse4AI) và không quay lại bản trước
     được, vì `uninstall.ps1` / `install.ps1 -Rollback` chỉ nằm trong gói ZIP mà website không phát.
  3. Hàng tab của cửa sổ trang mở thêm chỉ có chữ cái đầu, chưa có biểu tượng thật của trang.
  4. Kho mã công khai thiếu các tệp cộng đồng chuẩn: cách báo lỗ hổng bảo mật, hướng dẫn đóng góp, mẫu báo lỗi,
     nhật ký thay đổi.
  5. `SITE_URL` vẫn là `muse4ai.lovable.app`, địa chỉ này giờ chuyển hướng 302 sang tên miền chính
     `muse4ai.andrewbabo.com` → canonical/sitemap trỏ vào một địa chỉ chuyển hướng.
- **Giữ nguyên:** dữ liệu `%APPDATA%\MuseStudio`, thư viện ảnh/video không bao giờ bị xoá, một trình cài
  (`install.ps1`) cho cả EXE và ZIP, giữ một bản trước, không cần quyền quản trị, chưa ký số.
- **Không làm ở build này:** ký số (cần anh mua/được cấp chứng chỉ), bản Mac/Linux (không có máy để kiểm), phát hành tag
  GitHub (anh tự làm).

## 0b. Research ngắn

- Windows liệt kê ứng dụng cài theo người dùng từ `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<khoá>`
  (`DisplayName`, `DisplayVersion`, `Publisher`, `DisplayIcon`, `InstallLocation`, `EstimatedSize` KB, `UninstallString`,
  `QuietUninstallString`, `NoModify`, `NoRepair`, `URLInfoAbout`, `HelpLink`, `URLUpdateInfo`). Không cần quyền quản trị.
- Inno Setup: `/SILENT` bỏ trang chọn ngôn ngữ và trang lời chào, chỉ hiện cửa sổ tiến trình; `/LANG=en|vi`;
  `{param:TEN|mặc định}` đọc tham số tự đặt; mục `[Run]` không cờ `postinstall` + `Check:` chạy ngay sau khi cài.
- Tệp do app tự tải bằng `net.fetch` không mang dấu “tải từ Internet” (Zone.Identifier) nên SmartScreen không chặn;
  bù lại app phải tự kiểm SHA-256 + kích thước theo tệp thông tin lấy qua HTTPS.
- `session.fetch()` (Electron ≥ 25) đi qua đúng proxy + cookie của phiên tài khoản.
- `muse4ai.lovable.app/*` trả 302 sang `https://muse4ai.andrewbabo.com/*` (đo 06/11); tệp EXE trên CDN trả 200, có
  `content-length` và `cache-control: immutable`.

## 1. Luật — nguồn chuẩn

### Cập nhật trong app (UPD)
- **AC-UPD-01** Website phát `/releases/latest.json` dựng từ `LATEST_RELEASE` của `content/site.ts`: `version`, `date`,
  `url` tuyệt đối cùng gốc với website (hoặc `null` khi bản đó không phát tải), `sha256`, `bytes`, `notes` (en/vi),
  `page` (trang Tải về). Cache ngắn (≤ 5 phút). Không có bản phát tải → `url: null`.
- **AC-UPD-02** App kiểm bản mới lúc mở (sau khung hình đầu ~1 phút) rồi mỗi 12 giờ khi “Tự kiểm tra bản mới” bật
  (mặc định bật); nút “Kiểm tra ngay” luôn dùng được. Lần kiểm chỉ đọc tệp thông tin (không gửi dữ liệu nào của người
  dùng; chỉ có `User-Agent: Muse4AI/<phiên bản>`), quá 15 giây hoặc lớn hơn 64 KiB là lỗi; lỗi giữ kết quả cũ và nói lý do.
- **AC-UPD-03** “Mới hơn” theo so sánh phiên bản ngữ nghĩa, phần thử nghiệm so số (`beta.34` > `beta.4`). Tệp thông tin
  sai (phiên bản sai dạng, `url` không phải https hoặc khác gốc với nơi trả tệp thông tin, SHA-256 không đủ 64 hex,
  kích thước ngoài 1 MB–1 GB) → báo “Thông tin bản mới không hợp lệ”, không bao giờ mời tải.
- **AC-UPD-04** Một bản mới chỉ được báo một lần: thông báo nhỏ trong app + chấm trên mục Cài đặt và thẻ Giới thiệu
  (chấm còn tới khi cập nhật). Bản đã báo không báo lại.
- **AC-UPD-05** Tải về thư mục dữ liệu máy (`%LOCALAPPDATA%\MuseStudio\updates`), có tiến trình, huỷ được; cần trống ít
  nhất 1,2 × kích thước; kiểm số byte và SHA-256 trước khi cho cài; sai thì xoá tệp và báo lỗi; tệp đúng của cùng bản
  được dùng lại, không tải lại.
- **AC-UPD-06** “Cài và mở lại”: còn việc đang chạy thì hỏi trước (nói số việc; lượt Muse đã nhận được đối soát khi
  mở lại — theo dõi tiếp hoặc “Cần xem”, không bao giờ gửi lại; lượt chưa gửi vẫn trong hàng chờ); chạy bộ cài ở chế độ im lặng bằng ngôn ngữ của app, truyền đúng thư mục cài, app thoát bình thường, bộ cài mở
  lại bản mới. Dữ liệu giữ nguyên vì đi đúng đường của bộ cài EXE.
- **AC-UPD-07** Bản mới mở lên báo “Đã cập nhật lên X” một lần (kèm ghi chú từ tệp thông tin đã lưu); tệp bộ cài của
  bản ≤ bản đang chạy bị dọn lúc mở app.
- **AC-UPD-08** App không chạy từ thư mục cài chuẩn (chạy từ thư mục giải nén, bản dev) vẫn kiểm và báo bản mới, nhưng
  nút cài đổi thành “Mở trang tải về”.

### Quay lại bản trước (RBK)
- **AC-RBK-01** App ghi `%APPDATA%\MuseStudio\versions.json` (chỉ tiến trình chính ghi) sau khi mở kho: phiên bản kho
  hiện tại và phiên bản kho mỗi bản app đọc được, gồm cả các bản cũ đã biết.
- **AC-RBK-02** Bản trước chỉ được mời quay lại khi nó đọc được kho hiện tại (phiên bản kho của bản trước ≥ phiên bản kho
  đang dùng); không biết hoặc kho đã mới hơn → nói rõ vì sao không quay lại được, không có nút.
- **AC-RBK-03** “Quay lại bản X” (Cài đặt › Giới thiệu, hoặc trong hộp gỡ cài của Windows): hỏi lại, app thoát bình
  thường, lối tắt + bản đang dùng chuyển sang X, mở X. Bản mới vẫn nằm trên máy (lần cài sau vẫn chỉ giữ một bản trước).
  Sau khi đã quay lại, bản còn giữ là bản mới hơn: nó được mời bằng chữ “Chuyển sang bản X”, không bao giờ “Quay lại”;
  khi bản mới nhất trên website chính là bản đang giữ trên máy thì không có nút tải lại, chỉ chỉ sang “Chuyển sang”.

### Gỡ cài từ Windows (UNI)
- **AC-UNI-01** Mỗi lần cài (EXE, ZIP, quay lại bản) ghi Muse4AI vào Cài đặt Windows › Ứng dụng của người dùng hiện tại:
  tên, phiên bản, nhà phát hành, biểu tượng, dung lượng, link website/trợ giúp/tải bản mới, chỉ có nút Gỡ (không Sửa).
  Thư mục cài khác thư mục chuẩn có khoá riêng, không đè mục của bản chuẩn.
- **AC-UNI-02** Trình cài giữ bản sao đã kiểm SHA-256 của `install.ps1` + `uninstall.ps1` trong `<thư mục cài>\tools`,
  nên gỡ và quay lại bản không cần gói ZIP.
- **AC-UNI-03** Gỡ từ Windows mở cửa sổ song ngữ (theo ngôn ngữ app): ảnh/video trong thư viện luôn được giữ; ô chọn
  “Xoá luôn tài khoản, proxy, cài đặt và phiên đăng nhập trên máy này” mặc định tắt; Huỷ không đổi gì; có bản trước
  quay lại được thì có thêm “Quay lại bản X”. Xong thì báo kết quả.
- **AC-UNI-04** App đang mở → gỡ cài nhờ app thoát bình thường, chờ tối đa 45 giây; không thoát được (đang chờ người
  dùng trả lời) → dừng, nói lý do, không đổi gì.
- **AC-UNI-05** Gỡ cài chỉ đụng thứ trỏ vào chính thư mục cài của nó: lối tắt có đích nằm trong đó, mục “mở cùng
  Windows” trỏ vào đó, khoá gỡ cài của nó; chương trình phụ (cloudflared/Caddy) còn sót chỉ dừng khi không còn Muse4AI
  nào chạy; xoá dữ liệu chỉ cho thư mục cài chuẩn (hoặc phòng thử).

### Biểu tượng trang trên hàng tab (FAV)
- **AC-FAV-01** Tab trang mở thêm hiện biểu tượng thật của trang, tải chỉ qua phiên + proxy của tài khoản; chỉ nhận
  ảnh PNG/ICO/GIF/JPEG/WebP/SVG ≤ 64 KiB; lỗi hoặc không có → chữ cái đầu như cũ. Hàng tab chỉ cho ảnh `data:`.

### Kho mã và website (OSS, WEB)
- **AC-OSS-01** Kho công khai có `SECURITY.md` (báo riêng qua GitHub Security Advisories), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, mẫu báo lỗi/đề xuất (nhắc không dán khoá API), mẫu PR; `CHANGELOG.md` sinh từ `RELEASES` và có
  test bắt lệch.
- **AC-WEB-01** `SITE_URL` là tên miền chính `https://muse4ai.andrewbabo.com`; canonical, sitemap, hreflang, og:image và
  tệp thông tin bản mới dùng cùng gốc này.

### Phát hành (REL)
- **AC-REL-01** beta.34: ZIP + EXE, kiểm UPD/RBK/UNI trong phòng thử Windows (không đụng bản thật), nâng bản thật VPS
  (sao lưu, kiểm dữ liệu), trang Tải về + `latest.json` live khớp SHA-256, đẩy GitHub, Audit xanh.

## 2. Màn hình

- **Cài đặt › Giới thiệu › “Cập nhật”** (thay thẻ “Cài bản mới”): dòng trạng thái (đang dùng bản mới nhất · lúc kiểm /
  có bản X ngày Y, dung lượng / lỗi + Thử lại), ghi chú bản mới, nút chính đổi theo trạng thái (Tải và cài → thanh tiến
  trình + Huỷ → Cài và mở lại; hoặc Mở trang tải về), nút phụ “Kiểm tra ngay”, công tắc “Tự kiểm tra bản mới”; dòng
  “Bản trước còn giữ: X” + “Quay lại bản này” hoặc lý do; mục gấp “Cài thủ công (EXE/ZIP)” giữ hướng dẫn cũ.
- **Thanh bên:** chấm nhỏ trên Cài đặt khi có bản mới; thẻ Giới thiệu cũng có chấm.
- **Hộp gỡ cài Windows:** cửa sổ nhỏ có biểu tượng app, tiêu đề “Gỡ Muse4AI”, một đoạn giải thích, ô chọn xoá dữ liệu,
  nút “Gỡ cài đặt” / “Huỷ”, link “Quay lại bản X” khi được phép; sau đó hộp kết quả.
