# Build 3.2 — phát hành beta.32 (04/11/2026)

## Gói

| Tệp | Byte | SHA-256 |
|---|---|---|
| `Muse4AI-2.0.0-beta.32-win-x64.zip` | 169.594.372 | `CD1ACD04F928A1B2C8516E9100345BA7CB5A212E71E55A791F58F35C26A9AB7B` |
| `Muse4AI-2.0.0-beta.32-Setup-win-x64.exe` | 171.775.932 | `801F598845920E829EEA5AD4C98555F0600938D002AE132FA56AFD9661810274` |

ZIP đóng gói trên Linux (`npm run package:win`), gửi lên VPS theo từng phần và khớp SHA-256; EXE biên dịch trên VPS bằng
cùng nguồn Inno Setup (`desktop/installer/setup.iss`, `../lab/compile_exe.py`, ISCC thoát 0). Chưa phát hành qua
GitHub Actions (anh tự làm).

## Cổng trước phát hành

- Desktop: Vitest **774 đạt / 3 bỏ qua**, `tsc --noEmit` sạch. Website + nội dung: 52/53 trước khi thêm mục beta.32 vào
  trang Tải về (ca còn lại chính là cổng “bản mới nhất trên trang = bản app”), 53/53 sau khi thêm.
- E2E Electron thật: Linux 30/30 (`../e2e-linux-2026-11-04/`), Windows **32/32** trên đúng ZIP này
  (`../lab-windows-2026-11-04/`).
- Rà G1–G5: `../../audit.md`.

## Nâng bản thật trên VPS (20:11–20:13 giờ VPS, 13:11–13:13 UTC)

Một tác vụ tương tác trong phiên 1 (`../lab/deploy_prod.py`): sao lưu `data/` + `vault.json` + `ui-locale` vào
`C:\Muse4AILab\exe-beta32b\prod-backup-20261104-201157` → thoát beta.31 (còn 0 tiến trình sau 6 s) → cài im lặng (thoát 0,
`current.txt` = beta.32) → mở beta.32 → `/v1/health` OK. `Muse4AIStart` / `Muse4AIQuit` nhập lại từ XML của chính chúng,
chỉ đổi thư mục bản.

Kiểm sau nâng cấp:
- Nhật ký: `db migrated from 6`, bản sao tự động `backups\before-v7-from-v6-1793797961245.sqlite`; hàng chờ
  “recovered 0, review 8” như trước.
- Đọc chỉ-đọc kho trước/sau: 2 tài khoản giữ đúng proxy của mình, 457 việc giữ nguyên, bảng `proxies` không còn cột
  `account_id` (một nguồn duy nhất là `accounts.proxy_id`).
- Tên miền ổn định `muse.mailera.app`: `/v1/health` 200; `/.well-known/oauth-protected-resource` và
  `/.well-known/oauth-authorization-server` 200; `POST /mcp` không khoá → 401 kèm `resource_metadata` (OAuth vẫn nhận).
- Cổng 47822 là Muse4AI beta.32; 47821 (LinkedInAuto) và phòng thử cũ 47823 không đụng.

## Lùi bản

Kho đã lên v7, beta.31 không mở kho mới hơn. Cách lùi: thoát beta.32 → chép `prod-backup-20261104-201157\data` đè lên
`%APPDATA%\MuseStudio\data` → mở `app-2.0.0-beta.31\Muse4AI.exe` (thư mục bản cũ vẫn còn) → nhập lại hai tác vụ
`Muse4AIStart/Quit` trỏ về beta.31 (bản XML gốc: `C:\Muse4AILab\exe-beta32b\Muse4AI*.xml.orig`).

## Chưa kiểm

- Bấm Connect MCP thật / Trung tâm tài khoản Meta thật trong cửa sổ Muse của tài khoản thật (cần anh đăng nhập) —
  `../../qa-human.md` QA-06…08.
- Theo dõi dài hạn: không có hệ thống giám sát tự động; lượt này chỉ kiểm ngay sau nâng cấp.
