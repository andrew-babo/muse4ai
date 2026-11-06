# Human QA — Build 3.2 (proxy dùng chung + trang mở thêm)

Kỳ vọng lấy từ `spec.md` (R1.1); bảng này chỉ ghi thao tác. QA tay không thay test tự động (quyền, nâng kho, giới hạn).

## Chuẩn bị
- Bản 2.0.0-beta.32 trên máy anh. Ít nhất 2 tài khoản Muse và 2 proxy (một proxy để dùng chung).
- Chỉ dùng tài khoản thử; không gửi tin hay kết nối công cụ thật nếu không muốn.

## Checklist
| QA-ID | AC-ID | Anh làm | Mong đợi (xem Spec) | Trạng thái | Ghi chú |
|---|---|---|---|---|---|
| QA-01 | AC-PRXS-08/09 | Tài khoản › Thêm tài khoản, nhìn danh sách proxy | Proxy chưa ai dùng đứng đầu và được chọn sẵn; proxy đang dùng ghi tên tài khoản | NOT RUN | |
| QA-02 | AC-PRXS-01/09 | Bấm proxy đang dùng → Tiếp tục đăng nhập | Hiện dòng nhắc vàng, vẫn thêm được | NOT RUN | |
| QA-03 | AC-PRXS-02 | Menu thẻ tài khoản › Đổi proxy, chọn proxy tài khoản khác đang dùng | Đổi được; thẻ ghi “dùng chung với …” | NOT RUN | |
| QA-04 | AC-PRXS-06 | Cài đặt › Proxy, menu proxy dùng chung › Gỡ khỏi 2 tài khoản | Cả hai tài khoản mất proxy (báo “Chưa có proxy”) | NOT RUN | |
| QA-05 | AC-PRXS-04 | Mở app sau khi nâng từ beta.31 | Mọi tài khoản giữ đúng proxy cũ, không mất đăng nhập | NOT RUN | |
| QA-06 | AC-XWIN-01 | Trong cửa sổ Muse (Điều khiển), bấm một nút “Kết nối”/đăng nhập mở cửa sổ nhỏ | Cửa sổ nhỏ hiện giữa cửa sổ Muse, xác nhận xong tự đóng | NOT RUN | |
| QA-07 | AC-XWIN-02/03 | Mở Trung tâm tài khoản Meta (hoặc link mở tab mới), rồi mở thêm một trang | Cửa sổ phụ; từ 2 trang có hàng tab; Ctrl+W, Ctrl+Tab chạy | NOT RUN | |
| QA-08 | AC-XWIN-07 | Đăng nhập xong khi đang có cửa sổ phụ; lần khác bấm “Đã xong, kiểm tra phiên” | Đăng nhập xong: cửa sổ phụ còn; Đã xong: tất cả đóng | NOT RUN | |
| QA-09 | AC-XWIN-09 | Đổi Tiếng Việt / English, mở hộp Điều khiển | Dòng chỉ dẫn về trang mở thêm đúng ngôn ngữ | NOT RUN | |

## Tổng hợp
- Kiểm tự động và phòng thử Windows: xem `evidence/` (chưa thay cho QA tay ở trang Muse/Meta thật).
- Người duyệt văn phong/hình ảnh: chưa duyệt.

## Kết quả thử trên VPS thật — 04/11/2026 20:33 (giờ VN)
- Tài khoản "Thử B" (đã đăng nhập sẵn), bản beta.32 chính thức.
- Settings › General › **Accounts Center** → mở trang quản lý tài khoản Meta trong cửa sổ phụ, đúng phiên đăng nhập: PASS.
- Settings › Connectors › **Google Drive › Connect** → trang "Sign in with Google" mở thành tab thứ 2 cạnh Accounts Center; hàng tab mảnh, không thanh địa chỉ, tiêu đề ghi tên tài khoản: PASS. Không đăng nhập Google, không kết nối thật.
- Ảnh: `evidence/qa-prod-2026-11-04/tabs-accounts-center-google.webp`. Sau thử đã đóng tab, bỏ cổng gỡ lỗi, app chạy lại bình thường (health 200).
- Ghi chú nhỏ: biểu tượng tab đang là chữ "A" thay vì logo trang.
