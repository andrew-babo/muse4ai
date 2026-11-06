# Build 3.3 — Master Plan — revision P1 (06/11/2026)

## 1. Mục tiêu, baseline, quyền
- Nguồn: `spec.md` R1 (AC-UPD-01…08, AC-RBK-01…03, AC-UNI-01…05, AC-FAV-01, AC-OSS-01, AC-WEB-01, AC-REL-01).
  Baseline: desktop `2.0.0-beta.33`, Vitest 775 đạt / 3 bỏ qua, website 53/53, kho dữ liệu v7.
- Quyền: anh giao lấp khoảng trống, chạy liền mạch (06/11 21:08); được tự cài VPS + xuất bản web + đẩy GitHub (memory
  15/10, 23/10, 30/10). Không gửi tin thật; không xoá dữ liệu thật; phòng thử không đụng lối tắt/khoá gỡ cài/dữ liệu
  của bản thật.

## 2. KEEP / REUSE / REFACTOR / REPLACE
| Phần | Quyết định | Lý do |
|---|---|---|
| `install.ps1` | REFACTOR: thêm `tools\`, khoá gỡ cài, `-Target`, `-Gui`, mở lại sau khi quay bản | Một trình cài cho EXE/ZIP/app |
| `uninstall.ps1` | REFACTOR: thêm `-Gui` (WinForms), chỉ đụng thứ trỏ vào thư mục của nó | AC-UNI-03…05 |
| `setup.iss` | REFACTOR: `/INSTALLROOT=`, `/RELAUNCH=1` cho cài im lặng | AC-UPD-06 |
| Thẻ “Cài bản mới” | REPLACE → thẻ “Cập nhật” | AC-UPD, AC-RBK |
| `content/site.ts` `SITE_URL` | REFACTOR → tên miền chính | AC-WEB-01 |
| Hàng tab trang mở thêm | REFACTOR: thêm biểu tượng `data:` | AC-FAV-01 |

## 3. Phase
1. **P1 Logic chung + website:** `shared/updates.ts` (so phiên bản, kiểm tệp thông tin, luật quay bản, bản ghi
   versions), `shared/extraPages.ts` (chọn + kiểm biểu tượng), route `/releases/latest.json`, `SITE_URL`. Test.
2. **P2 Tiến trình chính:** `main/updater.ts` (kiểm, lịch, tải + kiểm, cài im lặng, quay bản, dọn tệp, báo một lần),
   `versions.json`, lệnh IPC `update.*`, cài đặt `updateCheck`. Test với fetch/spawn giả.
3. **P3 Giao diện:** thẻ Cập nhật, chấm thanh bên, thông báo một lần, Việt/Anh, bài Hướng dẫn “Cài đặt & cập nhật”.
4. **P4 Trình cài:** `install.ps1`, `uninstall.ps1`, `setup.iss`; test tĩnh (cú pháp PowerShell trên Windows, luật
   khoá/đường dẫn bằng test đọc tệp).
5. **P5 Biểu tượng tab** (`main/extraPages.ts`) + E2E Linux sẵn có thêm ca biểu tượng.
6. **P6 Kho mã:** SECURITY/CONTRIBUTING/CODE_OF_CONDUCT/mẫu issue + PR, `CHANGELOG.md` sinh từ `RELEASES` + test.
7. **P7 Phòng thử Windows (beta.34):** cài vào thư mục thử bằng EXE, kiểm mục Ứng dụng, cập nhật trong app tới “bản”
   giả từ máy chủ thử cục bộ, quay bản, gỡ cài (giữ/xoá dữ liệu phòng thử), cài khi đang có việc chạy.
8. **P8 Phát hành:** nâng bản thật VPS bằng EXE (sao lưu, kiểm dữ liệu), trang Tải về + `latest.json`, xuất bản web,
   đẩy GitHub (Audit xanh), bằng chứng `evidence/`.

## 4. Ma trận truy vết
| AC-ID | Phase | Test/QA |
|---|---|---|
| AC-UPD-01, AC-WEB-01 | 1 | `src/site/releases.test.ts`, `content/content.test.ts`, kiểm live |
| AC-UPD-02…05, 07, 08 | 1–2 | `desktop/test/updates.test.ts`, `desktop/test/updater.test.ts`, phòng thử |
| AC-UPD-06 | 2, 4, 7 | `updater.test.ts` (tham số bộ cài), phòng thử |
| AC-RBK-01…03 | 1–2, 4, 7 | `updates.test.ts`, phòng thử |
| AC-UNI-01…05 | 4, 7 | `desktop/test/installer-scripts.test.ts`, phòng thử |
| AC-FAV-01 | 1, 5 | `extra-pages.test.ts`, `e2e/extra_pages_e2e.py` |
| AC-OSS-01 | 6 | `content/changelog.test.ts` |
| AC-REL-01 | 8 | `evidence/release-*` |

## 5. Gate
- G1 logic chung + test xanh · G2 typecheck desktop + website sạch · G3 phòng thử Windows đủ AC · G4 bản thật nâng xong,
  dữ liệu khớp · G5 live web + GitHub Audit xanh.
