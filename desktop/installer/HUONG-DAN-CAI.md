# Muse4AI — hướng dẫn cài và xử lý sự cố

*English: INSTALL-GUIDE.md*

Bản thử nghiệm cho Windows 10/11 và Windows Server 2016 trở lên, 64-bit. Chưa ký số, cài bằng PowerShell, **không cần quyền quản trị**.

> Muse4AI điều khiển trang web Muse thay anh — đây không phải cách kết nối chính thức của Meta. Dùng tài khoản Muse phụ; app dừng ngay khi Muse báo hết hạn mức, yêu cầu xác minh hoặc vùng không hỗ trợ, không tìm cách vượt.

## 1. Cài lần đầu

1. Tải tệp `Muse4AI-<phiên bản>-win-x64.zip` và giải nén vào một thư mục bất kỳ (ví dụ `Downloads\Muse4AI`).
2. Mở thư mục vừa giải nén, bấm vào thanh địa chỉ, gõ `powershell` rồi Enter.
3. Chạy:

   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   Trình cài kiểm mã SHA-256 của gói, cài vào `%LOCALAPPDATA%\Programs\Muse4AI`, tạo lối tắt ở Start Menu và Desktop rồi mở app. Lệnh không đổi cài đặt ExecutionPolicy của máy.
4. Làm theo 4 bước trong app: xác nhận lưu ý → chọn thư mục lưu ảnh/video → dán danh sách proxy → thêm tài khoản Muse và đăng nhập trong cửa sổ app mở ra (app **không** lưu mật khẩu).

Nếu thấy “Gói cài không khớp mã kiểm tra”: tệp ZIP bị hỏng hoặc bị sửa — tải lại gói, không cài tiếp.

**Hoặc dùng bộ cài EXE** `Muse4AI-<phiên bản>-Setup-win-x64.exe`: bấm đúp, chọn ngôn ngữ (English / Tiếng Việt), bấm Tiếp. Bộ cài chạy đúng quy trình PowerShell ở trên. Ngôn ngữ chọn ở đây là ngôn ngữ đầu tiên của app nếu app chưa từng chọn ngôn ngữ; đổi lại bất kỳ lúc nào ở chân thanh bên hoặc Cài đặt › Chung. App mặc định English.

## 2. Cài bản mới

1. Thoát hẳn app: chuột phải biểu tượng Muse4AI dưới khay → **Thoát** (bấm X chỉ thu xuống khay).
2. Giải nén gói mới và chạy lại lệnh ở bước 1.3.

Tài khoản đã đăng nhập, hàng chờ, cài đặt và thư viện được giữ nguyên. Bản trước vẫn nằm trong thư mục cài để quay lại khi cần. Nếu app đang mở, trình cài dừng và nhắc “Hãy thoát Muse4AI trước”.

## 3. Quay lại bản trước

```
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
```

Trình cài sẽ nhắc: nếu bản mới đã nâng cấp dữ liệu, những gì ghi sau lần nâng cấp (lượt mới, đổi cài đặt) có thể không có trong bản cũ. Ảnh/video trong thư viện không bị ảnh hưởng. Bản sao lưu tự động nằm trong `%APPDATA%\MuseStudio\backups` (mỗi ngày một bản, giữ 7 bản, và một bản trước mỗi lần nâng cấp dữ liệu).

Nếu bản cũ báo **“Dữ liệu thuộc phiên bản mới hơn”** (ví dụ quay từ Build 2.0 về Build 1.0), bản cũ không tự đọc được dữ liệu mới. Dùng bản sao lưu trước nâng cấp:

1. Thoát hẳn app (khay → **Thoát**).
2. Mở `%APPDATA%\MuseStudio\data`, đổi tên `muse.sqlite` thành `muse.sqlite.moi` (đổi tên luôn `muse.sqlite-wal`, `muse.sqlite-shm` nếu có) — giữ lại để nâng cấp lại sau.
3. Trong `%APPDATA%\MuseStudio\backups`, chép tệp `before-v<mới>-from-v<cũ>-….sqlite` mới nhất vào `data` rồi đổi tên thành `muse.sqlite`.
4. Mở app. Mất những gì ghi sau giờ nâng cấp (giờ nằm trong tên tệp sao lưu); thư viện ảnh/video, đăng nhập tài khoản và proxy giữ nguyên.

## 4. Gỡ cài

| Muốn | Lệnh | Kết quả |
|---|---|---|
| Gỡ app, giữ dữ liệu | `powershell -ExecutionPolicy Bypass -File .\uninstall.ps1` | Mất app và lối tắt; tài khoản, hàng chờ, cài đặt và thư viện còn nguyên |
| Gỡ và xoá dữ liệu app | thêm `-RemoveData` | Xoá thêm dữ liệu app (`%APPDATA%\MuseStudio`, `%LOCALAPPDATA%\MuseStudio`); **thư mục ảnh/video vẫn giữ nguyên** |

Nếu app từng bị tắt ngang, lệnh gỡ dừng luôn chương trình HTTPS/đường hầm còn sót **của app** (chỉ bản nằm trong thư mục của app, không đụng Caddy/cloudflared khác trên máy).

## 5. Xử lý sự cố

| Anh thấy | Nghĩa là | Làm gì |
|---|---|---|
| Dải báo “Muse vừa đổi giao diện”, các lượt ảnh hoặc video tạm dừng | Trang Muse thay đổi, app không nhận ra nút/ô nhập nữa | Chờ bản cập nhật Muse4AI; lượt chưa gửi vẫn nằm trong hàng chờ, không mất |
| Tài khoản “Lỗi proxy” | Proxy của tài khoản không kết nối được; app **không** chuyển sang mạng trực tiếp | Cài đặt › Proxy → Kiểm tất cả; đổi proxy cho tài khoản ở thẻ tài khoản (⋯ → Đổi proxy). Lượt chưa gửi tự chuyển sang tài khoản khác |
| Tài khoản “Cần xác minh” / “Cần đăng nhập lại” | Muse yêu cầu xác minh hoặc phiên hết hạn | Bấm **Điều khiển** trên thẻ tài khoản, tự xác minh/đăng nhập trong cửa sổ, rồi bấm “Đã xong, kiểm tra phiên”. Gặp yêu cầu lạ thì dừng dùng tài khoản đó |
| “Hết hạn mức đến …” | Muse giới hạn số lượt | Tài khoản tự nghỉ đến giờ đó rồi nhận việc lại; không cần làm gì |
| Lượt “Cần anh xem” | App không chắc Muse đã nhận lượt (ví dụ mất mạng đúng lúc gửi) | Mở lượt: “Nhập từ lịch sử Muse” nếu lượt đã có trên Muse (lấy kết quả, không tạo mới), hoặc “Gửi lại” (có thể tốn thêm hạn mức). App không tự gửi lại để tránh trùng |
| “Ổ đĩa sắp đầy” / “Ổ đĩa gần đầy — đã tạm dừng tải về” | Dưới 2 GB trống ở ổ chứa thư viện thì app nhắc; dưới 500 MB thì tạm dừng tải kết quả về | Dọn ổ hoặc đổi thư mục thư viện trong Cài đặt › Chung; app tự tải tiếp khi đủ chỗ |
| Lúc mở app hiện hộp “Muse4AI — khôi phục dữ liệu” | Tệp dữ liệu của app bị hỏng (ví dụ mất điện đúng lúc ghi) | Bấm **Khôi phục bản sao lưu**: app dùng bản sao lưu gần nhất còn tốt; lượt/tài khoản/cài đặt thay đổi sau giờ sao lưu có thể mất, thư viện ảnh/video không ảnh hưởng, tệp hỏng được giữ lại bên cạnh để em xem. Nếu không có bản sao lưu nào dùng được, app báo lỗi và thoát — gửi em tệp chẩn đoán |
| App không mở được sau khi cài bản mới | Bản mới lỗi trên máy này | Chạy lệnh quay lại bản trước (mục 3) rồi báo em kèm tệp chẩn đoán |

**Tệp chẩn đoán:** Cài đặt › Chẩn đoán → **Xuất gói chẩn đoán (.zip)**. Gói đã che IP, email, mật khẩu và cookie; gửi tệp này khi cần em xem lỗi. Nếu app không mở được, gửi thư mục `%APPDATA%\MuseStudio\logs`.

## 6. Cho agent khác gọi Muse4AI (API & MCP)

API **tắt sẵn**. Bật ở Cài đặt › **API & agent**:

1. Bật công tắc **API cho agent** — chương trình trên chính máy này gọi được qua `http://127.0.0.1:47821` (cổng bận thì app gợi ý cổng trống, bấm một lần để đổi).
2. **Tạo khoá** cho từng agent (đặt tên theo agent, chọn “Tạo và huỷ” hoặc “Chỉ xem tình trạng”). Khoá chỉ hiện **một lần** — chép ngay; mất thì thu hồi rồi tạo khoá mới.
3. Muốn agent ở **máy khác** gọi tới, có hai đường — dùng **cùng lúc** được:
   - **Đường hầm tạm thời** (thẻ “Cho máy khác gọi tới”): chạy ngay, địa chỉ `https://….trycloudflare.com` đổi mỗi lần mở app. **Đường hầm có tên** dùng tên miền trên Cloudflare của anh. Lần đầu app tải `cloudflared` (~55 MB, có kiểm mã SHA-256). Mạng nội bộ/Tailscale dùng **Mạng riêng**.
   - **Tên miền trỏ về máy này** (thẻ dưới): gọi thẳng vào máy qua HTTPS, địa chỉ cố định. Anh tạo bản ghi **A** trỏ tên miền về IP công khai của máy (app hiện sẵn IP), máy cần nhận cổng **80 và 443** từ Internet. Kiểu **App tự chạy HTTPS**: app tải Caddy (~18 MB, kiểm mã SHA-256), tự xin và gia hạn chứng chỉ Let's Encrypt. Đã có IIS/nginx/Caddy riêng thì chọn **Proxy HTTPS có sẵn** và dán mẫu cấu hình app đưa. App **không** tự sửa DNS hay tường lửa — 4 bước kiểm (DNS, cổng, chứng chỉ, gọi thử) cho biết còn thiếu gì; lệnh mở tường lửa (nếu cần) có nút chép, chạy bằng PowerShell quyền quản trị.
   - Trong lúc chờ tên miền chạy, cứ dùng đường hầm. Agent nên giữ cả hai địa chỉ: một đường lỗi thì gửi lại qua đường kia **cùng Idempotency-Key** — app trả đúng lượt cũ, không tạo lượt trùng.
4. Thẻ **Kết nối agent** có sẵn mẫu cho Claude Code, Cursor, VS Code, Claude Desktop, Codex CLI, Gemini CLI, Python, OpenAI, n8n và curl, dùng địa chỉ anh chọn (mặc định: tên miền nếu đang trực tuyến, rồi đến đường hầm); tài liệu đầy đủ ở `/v1/openapi.json`.

Ai có khoá đều dùng được hạn mức Muse của anh. Tắt API hoặc thoát app là dừng chia sẻ ngay (cả đường hầm lẫn HTTPS của tên miền); thu hồi khoá có hiệu lực từ lần gọi kế tiếp. Lượt từ agent nằm chung hàng chờ, có nhãn “API · tên khoá”, theo đúng luật của app (không tự gửi lại khi không chắc Muse đã nhận, dừng khi Muse báo hết hạn mức/xác minh).

## 7. Vibes (đã bỏ từ 2.0.0-beta.19)

Muse4AI chỉ còn dùng Muse. Đăng nhập và tạo video trên Vibes đã bỏ; dữ liệu và video Vibes cũ trong Thư viện vẫn giữ nguyên, xem được, nhưng không chạy tiếp lượt Vibes nào.

## 8. Windows cảnh báo khi cài

App chưa ký số nên Windows SmartScreen hoặc phần mềm diệt virus có thể hỏi lại. Đây là bản thử nghiệm; chỉ cài gói do em gửi và kiểm mã SHA-256 ở tệp `SHA256SUMS.txt` nếu cần (`Get-FileHash .\app.zip`).
