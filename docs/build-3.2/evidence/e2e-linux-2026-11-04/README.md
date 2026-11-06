# Build 3.2 — E2E trên app thật (máy dựng Linux, 04/11/2026)

Script: `desktop/e2e/extra_pages_e2e.py` (chạy lại được: `npm run build` rồi `python3 e2e/extra_pages_e2e.py`).
App: Electron 45.0.0 thật (`MUSE4AI_TEST=1`, dữ liệu thử riêng), cửa sổ, popup và tab là `BrowserWindow` /
`WebContentsView` thật trên màn ảo Xvfb 1600×1000. Proxy của tài khoản là một proxy chuyển tiếp nhỏ trên 127.0.0.1 chỉ
tới được trang thử cục bộ — không có gì rời máy. Phím Ctrl+W gửi bằng bàn phím X thật (`xdotool`), không qua CDP.

**Kết quả: 30/30 đạt** (`results.json`). Không có lỗi trang trong cửa sổ app.

| AC (Spec R1.1) | Đã kiểm | Kết quả |
|---|---|---|
| AC-PRXS-01 | Hai tài khoản Mây, Gió thêm trên cùng một proxy | PASS |
| AC-PRXS-09 | Hộp Thêm tài khoản: proxy chưa dùng đứng đầu và được chọn sẵn; dòng “Đang dùng: Mây, Gió”; bấm proxy đang dùng → dòng nhắc nhẹ; thẻ tài khoản “dùng chung với Gió”; Kho proxy cột “Mây, Gió” | PASS (`p01`–`p03`) |
| AC-XWIN-01 | `window.open(…, 'width=480,height=640')` → popup giữa cửa sổ Muse (lệch 2 px), `window.opener` nhận được kết quả, popup tự đóng; tiêu đề “… — Mây” | PASS (`x01`). Linux/X11 thêm 3 px mỗi cạnh (486×646) — kích thước chính xác kiểm ở Windows |
| AC-XWIN-02 | Mở không kích thước → một cửa sổ phụ, 1 tab không có hàng tab, trang chiếm hết; tab trống được trang gán địa chỉ sau (kiểu nút Kết nối hỏi máy chủ trước) vẫn tải đúng | PASS (`x02`) |
| AC-XWIN-03 | Tab thứ 2 → hàng tab 36 px; bấm tab chọn được; Ctrl+W đóng tab đang mở, còn 1 tab thì hàng tab ẩn; tiêu đề cửa sổ “Page 1 — Mây” | PASS (`x03`) |
| AC-XWIN-04 | `file:`, `chrome:`, `mailto:`, `ms-settings:`, `devtools:` → `window.open` trả `null` | PASS (`javascript:` xem delta R149 trong Spec) |
| AC-XWIN-05 | Cửa sổ Muse ẩn (trang chạy việc) → mọi `window.open` trả `null`, không mở gì | PASS |
| AC-XWIN-06 | Tab thứ 9 và popup thứ 5 bị từ chối (8 tab, 4 popup) | PASS (`x04`) |
| AC-XWIN-07 | Đăng nhập xong: popup đóng, tab còn; Huỷ/kết thúc điều khiển: đóng hết | PASS (hàm `closeAll` thật; chỗ gọi trong `openLogin` đã đọc mã, kiểm lại ở Windows) |
| AC-XWIN-08 | Popup và tab đi qua proxy của tài khoản (thấy trong nhật ký proxy cục bộ), WebRTC `disable_non_proxied_udp` | PASS |
| AC-XWIN-09 | Hộp điều khiển có dòng chỉ dẫn, đúng tiếng Việt và tiếng Anh | PASS (`p04`, `p05`) |

Tài khoản kia (Gió) không có trang phụ nào (cách ly theo tài khoản).

Chưa kiểm ở đây: hành vi trên Windows (khung cửa sổ, DPI, phím thật trong phiên Windows), trang Muse/Meta thật.
