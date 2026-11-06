# Build 3.2 — phát hành beta.33 (06/11/2026)

Bản bảo trì sau audit 06/11 (`../../../audit/2026-11-06.md`): đưa hai bản sửa bộ cài tới người dùng và gộp các cập nhật
thư viện Dependabot. Không đổi cấu trúc dữ liệu (kho vẫn v7).

## Có gì trong bản

- Bộ cài EXE truyền `-CloseRunning -ResultFile` cho `install.ps1` (TECH-02): app đang mở được nhờ thoát theo cách
  bình thường (`--quit`, giống khay → Thoát; còn việc đang chạy thì app hỏi trước), lỗi hiện đúng lý do.
- `install.ps1` / `uninstall.ps1` chạy được khi mở từ PowerShell 7 (TECH-03) và luôn ghi lý do khi dừng giữa chừng.
- Lời chào trong bộ cài viết lại cho người dùng văn phòng (VI/EN), bỏ câu “thoát trước khi cài” đã sai với hành vi mới;
  bài Cài đặt / Cập nhật (website + Hướng dẫn trong app) và màn Cài đặt › Giới thiệu nói cùng một điều.
- Dependabot #1–#5 áp trong commit `8e106ec0` của kho công khai: Electron 45.0.0 → 45.2.1, Vite plugin React 6.2.1,
  Tailwind 4.3.4, Vitest 5.1.0, lucide-react 1.67.0, @tanstack/react-virtual 3.14.25, @types/node 26.6.6; GitHub
  Actions checkout/setup-node v7, upload-artifact v7, download-artifact v8. Dependabot tự đóng cả 5 PR.

## Gói

| Tệp | Byte | SHA-256 |
|---|---|---|
| `Muse4AI-2.0.0-beta.33-win-x64.zip` | 169.558.551 | `643D9ADBB2236DEF0BCFDEF74899366F4BFD04F1C27FCBEA416D6DD0891427EF` |
| `Muse4AI-2.0.0-beta.33-Setup-win-x64.exe` | 171.737.324 | `C650505DD6BFFC6EDCE6E8ED3FB5843C62412CEDD43E3BCFFAFEF2E6E69C2C48` |

ZIP đóng gói trên Linux (`npm run package:win`, Electron 45.2.1), gửi lên VPS theo từng phần và khớp SHA-256; EXE biên
dịch trên VPS bằng cùng nguồn Inno Setup (`../lab/compile_exe.py`, ISCC thoát 0). Một bản EXE biên dịch trước đó
(cùng app, lời chào cũ) chỉ dùng cho lần nâng bản đầu tiên bên dưới rồi bị thay; không phát hành.

## Cổng trước phát hành

- Desktop: Vitest **775 đạt / 3 bỏ qua**, `tsc --noEmit` sạch (với thư viện mới).
- GitHub trên `8e106ec0`: Tests and type check, Dependency vulnerabilities, Leaked keys and passwords, Windows EXE
  `package` (build → cài im lặng → cài lại giữ dữ liệu → gỡ giữ dữ liệu) đều xanh.
- Website + nội dung: 52/53 trước khi thêm beta.33 vào trang Tải về (ca còn lại là cổng “bản mới nhất = bản app”).

## Nâng bản thật trên VPS — để chính bộ cài đóng app

`../lab/deploy_prod.py <cũ> <mới> <thư mục> installer`: sao lưu `data/` + `vault.json` + `ui-locale`, **không** thoát app
trước, chạy Setup EXE im lặng trong phiên tương tác 1, rồi mở bản mới và đọc `/v1/health`.

| Lần | Giờ VPS | App đang chạy trước khi cài | Bộ cài | Còn tiến trình cũ | Kết quả |
|---|---|---|---|---|---|
| beta.32 → beta.33 (EXE đầu) | 20:00–20:01 | 5 tiến trình beta.32 | thoát 0 sau 42 s | 0 | `current.txt` = beta.33, health OK |
| beta.33 → beta.33 (EXE cuối) | 20:29–20:30 | 5 tiến trình beta.33 | thoát 0 sau 39 s | 0 | health OK |

Kiểm sau nâng cấp:
- Nhật ký app: `start` version 2.0.0-beta.33, electron 45.2.1; hàng chờ “recovered 0, review 8” như trước; cảnh báo
  cloudflared “configuration file was empty” đã có từ các ngày trước (đường hầm tạm), không mới.
- Đọc chỉ-đọc hai bản sao lưu (trước beta.33 và sau lần cài đầu): `quick_check` ok, 457 việc, 2 tài khoản đều giữ proxy,
  11 proxy, 244 tệp thư viện, 2 ứng dụng OAuth, 29 khoá API — giống hệt nhau. Bản tải về để đếm đã xoá ngay.
- Tên miền ổn định `muse.mailera.app`: `/v1/health` 200; hai đường khám phá OAuth 200; `POST /mcp` không khoá → 401 kèm
  `resource_metadata`.
- `Muse4AIStart` / `Muse4AIQuit` trỏ về `app-2.0.0-beta.33`.

Ảnh trang đầu của bộ cài (chụp bằng `PrintWindow` trong phiên 1, huỷ trước khi cài):
`wiz-vi-notice.png`, `wiz-en-notice.png`.

## Lùi bản

Không đổi cấu trúc dữ liệu, nên beta.32 mở được kho hiện tại: thoát beta.33 → `install.ps1 -Rollback` từ gói ZIP
beta.33 (thư mục `app-2.0.0-beta.32` vẫn còn) → nhập lại hai tác vụ `Muse4AIStart/Quit` trỏ về beta.32. Bản sao dữ liệu
trước nâng cấp: `C:\Muse4AILab\exe-beta33\prod-backup-20261106-200043`.

## Chưa kiểm

- Trường hợp còn việc đang chạy lúc cài (app hỏi trước khi thoát → bộ cài chờ ~45 s rồi báo lý do): có test logic, chưa
  thử trên VPS vì phải gửi việc Muse thật.
- Người dùng bản EXE chưa gỡ cài / quay lại bản trước được nếu không có gói ZIP (đã ghi vào roadmap).
