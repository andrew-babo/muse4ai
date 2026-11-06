# Build 3.2 — phòng thử Windows (04/11/2026)

Kết quả **32/32 PASS** trên bản đóng gói thật `Muse4AI-2.0.0-beta.32-win-x64.zip` (169.594.372 B, SHA-256
`CD1ACD04…26A9AB7B`), chạy trên VPS Windows Server 2016 trong phiên người dùng (phiên 1), thư mục riêng
`C:\MuseStudioLab\b32-xwin` với dữ liệu, hồ sơ trình duyệt và cổng riêng. Bản thật beta.31 (cổng 47822) không bị đụng:
kiểm `/v1/health` = 200 trước và sau, phòng thử dừng sạch (`lab procs: 0`).

## Cách chạy

- `../lab/xwin_lab.py setup` giải nén ZIP vào phòng thử, mở app với `MUSE4AI_TEST=1` (chỉ để bật lệnh `__test.*`; mọi
  thao tác đi qua đúng hàm của nút thật) và một tác vụ “agent” trong phiên 1 để chụp đúng cửa sổ app và gõ phím thật.
- `../lab/xwin_lab.py run` dùng lại `desktop/e2e/extra_pages_e2e.py` (cùng kịch bản đã chạy 30/30 trên Linux) với dung sai
  kích thước popup = **0 px**, rồi thêm các ca chỉ có ở Windows (Ctrl+W bằng bàn phím thật, popup canh giữa).
- Trang thử và proxy thử đều chạy cục bộ trên VPS (127.0.0.1); proxy thử ghi lại mọi yêu cầu (`proxy-log.json`: 16 yêu
  cầu, chỉ trang thử). Không mở trang Muse/Meta thật, không đăng nhập tài khoản thật.

## Kết quả theo AC (nguồn: `../../spec.md`)

| AC | Ca | Kết quả |
|---|---|---|
| AC-PRXS-01 | Hai tài khoản cùng một proxy | PASS |
| AC-PRXS-09 | Thẻ tài khoản ghi “dùng chung với …”; proxy chưa ai dùng đứng đầu và được chọn sẵn; chọn proxy đang dùng hiện dòng nhắc | PASS |
| AC-XWIN-01 | `window.open` có kích thước → popup đúng **480×640** vùng trang (khung 496×679), **canh giữa đúng 0 px**; `window.opener` trả kết quả rồi tự đóng; tiêu đề có tên tài khoản | PASS |
| AC-XWIN-02 | Không kích thước → cửa sổ phụ 1 tab, không hàng tab; tab trống được gán địa chỉ sau (kiểu nút Connect) vẫn tải | PASS |
| AC-XWIN-03 | Từ 2 tab hiện hàng tab (36 px); bấm tab chọn; **Ctrl+W bàn phím thật** đóng tab, còn 1 thì hàng tab ẩn | PASS |
| AC-XWIN-04 | `file:`, `chrome:`, `mailto:`, `ms-settings:`, `devtools:` bị từ chối | PASS |
| AC-XWIN-05 | Cửa sổ Muse ẩn → `window.open` trả `null`, không mở gì | PASS |
| AC-XWIN-06 | Tối đa 8 tab, 4 popup mỗi tài khoản | PASS |
| AC-XWIN-07 | Đăng nhập xong: popup đóng, tab còn; Huỷ / hết điều khiển: đóng hết | PASS |
| AC-XWIN-08 | Popup và tab đi qua proxy của tài khoản, WebRTC `disable_non_proxied_udp` | PASS |
| AC-XWIN-09 | Dòng chỉ dẫn trong hộp điều khiển đúng tiếng Việt / tiếng Anh | PASS |
| — | Tài khoản khác không bị dính trang phụ; trang app không có lỗi | PASS |

Lần chạy đầu (bản ZIP trước, SHA `2EA1A8BD…`) có **1 FAIL thật**: popup lệch 8 px ngang, 20 px dọc vì vị trí được tính
theo kích thước vùng trang, còn Windows cộng thêm khung cửa sổ. Sửa: `popupPlacement()` (thuần, có test) cộng khung của
cửa sổ Muse vào rồi mới canh giữa; đóng gói lại, chạy lại toàn bộ → 32/32.

## Ảnh (đã cắt viền trong suốt của Windows để không lộ màn hình phía sau)

- `x01_popup_over_muse.webp` — popup “Connect a tool — Mây” giữa cửa sổ Muse; trang gốc đã nhận “oauth-ok”.
- `x02_one_tab_no_strip.webp`, `x03_two_tabs_strip.webp`, `x04_limits.webp` — cửa sổ phụ 1 tab / 2 tab / 8 tab.
- `p01…p05`, `w01…w03` — thẻ tài khoản dùng chung proxy, hộp Thêm tài khoản (VI/EN), Cài đặt › Proxy, dòng chỉ dẫn.

## Chưa kiểm ở đây

- Trang Muse/Meta thật và nút Connect MCP thật (cần tài khoản anh tự đăng nhập) — xem `../../qa-human.md`.
- Bộ cài EXE và nâng cấp bản thật: ghi ở `../release-2026-11-04/README.md`.
