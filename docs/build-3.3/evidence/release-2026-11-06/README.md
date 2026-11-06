# Build 3.3 — phát hành beta.34 (06/11/2026)

Lấp các khoảng trống “production” sau beta.33: cập nhật ngay trong app, quay lại bản trước, gỡ cài từ Cài đặt
Windows, biểu tượng trang trên tab trang mở thêm, và tệp cộng đồng cho kho mã. Kho dữ liệu vẫn v7 (không đổi cấu trúc).

## Gói

| Tệp | Byte | SHA-256 |
|---|---|---|
| `Muse4AI-2.0.0-beta.34-win-x64.zip` | 169.577.931 | `8F73995734D11F2942BE97CB1A047B574840D230778D09E20B097F8E14BC1EE9` |
| `Muse4AI-2.0.0-beta.34-Setup-win-x64.exe` | 171.756.320 | `B59214CAEDCF71C45F68DDC9ADFE0CCD405F8B9F941E07286A561D844B4655C5` |

ZIP đóng gói trên Linux (`npm run package:win`), gửi lên VPS theo từng phần và khớp SHA-256; EXE biên dịch trên VPS
bằng cùng nguồn Inno Setup (ISCC thoát 0), tải về và khớp lại SHA-256 trước khi đưa lên website.

## Cổng trước phát hành

- Desktop: Vitest **841 đạt / 3 bỏ qua** (66 tệp), `tsc --noEmit` sạch.
- Website + nội dung: **58/58** sau khi điền bản beta.34 (gồm cổng “bản mới nhất có tệp tải được” và
  `/releases/latest.json` trỏ đúng tên miền chính, đúng byte/SHA-256). `CHANGELOG.md` sinh lại từ `content/site.ts`.
- Phòng thử Windows: **29/29** (`../lab-windows-2026-11-06/`) — cập nhật trong app khi có lượt đang chạy, quay bản,
  gỡ cài giữ/xoá dữ liệu, gỡ khi có lượt đang chạy. Ảnh Hướng dẫn `settings-about` chụp lại trên Windows (66 ảnh,
  cổng OCR/riêng tư 0 lỗi).

## Website

- Bộ cài lưu trên kho tệp của website (con trỏ `content/releases/muse4ai-setup-2.0.0-beta.34.exe.asset.json`).
- Xuất bản `muse4ai.andrewbabo.com`: `/releases/latest.json` = beta.34, 171.756.320 byte, SHA-256 như trên; trang
  `/download` và `/vi/download` hiện beta.34 + SHA-256. Tải EXE từ website thật → SHA-256 khớp từng byte.
- Từ bản này, app đã cài sẽ tự thấy bản mới qua tệp `latest.json` (chỉ đọc, không gửi dữ liệu).

## Nâng bản thật trên VPS — để chính bộ cài đóng app

Script nâng bản (giữ riêng): sao lưu `data/` + `vault.json` + `ui-locale`, **không** thoát app trước, chạy Setup EXE im
lặng trong phiên tương tác 1, rồi đọc `/v1/health`:

| Giờ VPS | App đang chạy trước khi cài | Bộ cài | Còn tiến trình cũ | Kết quả |
|---|---|---|---|---|
| 00:15–00:16 (07/11) | 5 tiến trình beta.33 | thoát 0 sau 35 s | 0 | `current.txt` = beta.34, health OK |

Kiểm sau nâng cấp:
- Nhật ký app: `start` version 2.0.0-beta.34, electron 45.2.1; hàng chờ “recovered 0, review 8” như trước.
- `versions.json` mới: kho v7; beta.34/33/32 đọc được v7, beta.31/30 chỉ đọc v6 — nên app chỉ mời quay lại beta.33.
- Đọc chỉ-đọc bản sao trước và sau nâng cấp: `quick_check` ok, 457 việc, 2 tài khoản đều giữ proxy, 11 proxy, 244 tệp
  thư viện, 2 ứng dụng OAuth, 29 khoá API — giống hệt nhau. Bản sao dùng để đếm đã xoá ngay.
- Lần đầu app thật có mục trong Cài đặt Windows › Ứng dụng (“Muse4AI”, 2.0.0-beta.34), `tools\uninstall.ps1` có mặt,
  khoá thông báo Windows trỏ về beta.34; giữ `app-2.0.0-beta.33` làm bản trước (beta.32 được dọn).
- Tên miền ổn định: `/v1/health` 200; hai đường khám phá OAuth 200; `POST /mcp` không khoá → 401 kèm `resource_metadata`.
- `Muse4AIStart` / `Muse4AIQuit` trỏ về `app-2.0.0-beta.34`.

## Lùi bản

Kho không đổi (v7), nên beta.33 mở được dữ liệu hiện tại: Cài đặt › Giới thiệu › “Quay lại bản này”, hoặc liên kết
“quay lại bản 2.0.0-beta.33” trong cửa sổ gỡ cài của Windows. Riêng VPS có thêm hai tác vụ `Muse4AIStart/Quit`
(chỉ có trên máy chủ): khi quay bản thì cho chúng trỏ lại `app-2.0.0-beta.33`. Bản sao dữ liệu trước nâng cấp:
`C:\MuseStudioLab\rel34\prod-backup-20261107-001535` (giữ lại). Thư mục thử `b34-upd` và gói thử đã dọn.

## Kho mã công khai

- `andrew-babo/muse4ai` `main`: `66d5694f` (mã beta.34, Build 3.3, CHANGELOG/CONTRIBUTING/CODE_OF_CONDUCT, mẫu
  issue/PR, README số test + liên kết mới; README tiếng Việt sửa liên kết tương đối trong `docs/`) và `ab43232e`.
- Lần chạy đầu: Audit xanh, Windows EXE đỏ ở 3 test — máy Windows của GitHub đổi xuống dòng LF→CRLF khi lấy mã, test
  so nguyên văn `CHANGELOG.md` và đoạn hàm PowerShell. Sửa test so theo LF (`ab43232e`) → **Audit xanh, Windows EXE
  xanh** (gồm kiểm bộ cài trên Windows).
- Script phòng thử/VPS (`evidence/lab/`) vẫn giữ riêng như các bản trước. Tag phát hành GitHub: anh tự tạo khi cần.

## Chưa kiểm

- Cập nhật trong app trên máy người dùng thật từ beta.34 lên bản kế tiếp — lần đầu sẽ xảy ra ở bản sau (đã thử trọn
  trên phòng thử với bản giả beta.35).
- SmartScreen vẫn cảnh báo vì bộ cài chưa ký số.
