MUSE STUDIO — HƯỚNG DẪN CÀI (bản thử nghiệm, chưa ký số)   ·   English: README-install.txt

1. Giải nén tệp ZIP này vào một thư mục bất kỳ (ví dụ Downloads\Muse4AI).
2. Mở thư mục vừa giải nén, bấm vào thanh địa chỉ, gõ  powershell  rồi Enter.
3. Chạy lệnh:
     powershell -ExecutionPolicy Bypass -File .\install.ps1
   Trình cài kiểm mã SHA-256 của gói, cài vào %LOCALAPPDATA%\Programs\Muse4AI,
   tạo lối tắt ở Start Menu và Desktop rồi mở app. Không cần quyền quản trị.
   Hoặc dùng Muse4AI-<phiên bản>-Setup-win-x64.exe: bấm đúp, chọn English hoặc Tiếng Việt, Tiếp.

Cài bản mới: thoát Muse4AI (chuột phải biểu tượng dưới khay → Thoát) rồi chạy lại lệnh trên
với gói mới. Dữ liệu, tài khoản và thư viện được giữ nguyên.

Quay lại bản trước:  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
Gỡ cài (giữ dữ liệu): powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
Gỡ và xoá dữ liệu app (vẫn giữ thư mục ảnh/video): thêm  -RemoveData

Windows có thể cảnh báo vì app chưa ký số — đây là bản thử nghiệm.
Chữ của trình cài: thêm  -Lang vi  hoặc  -Lang en  (mặc định theo ngôn ngữ app, nếu chưa có thì English).
