# Build 3.3 — phòng thử Windows (06/11/2026)

Máy: VPS Windows Server được anh cho phép, phiên người dùng 1. Phòng thử riêng `C:\MuseStudioLab\b34-upd`
(thư mục cài, dữ liệu, lối tắt, mục gỡ cài đều riêng); app thật beta.33 trên cùng máy được kiểm trước/sau mỗi bước
(health 200, phiên bản, mục Ứng dụng, lối tắt Start Menu, khoá thông báo Windows) và không bị đổi.

Kết quả: **29/29 đạt** (`results.json`), chạy trên bộ cài dựng bằng Inno Setup trên chính máy Windows từ hai gói ZIP
của cùng mã nguồn: beta.34 (bản được thử) và beta.35 (cùng app, chỉ đổi số bản để có “bản mới” giả). Bản mới được phục
vụ từ máy chủ cục bộ `127.0.0.1` (chỉ cho phép ở chế độ thử; bản thật bắt buộc HTTPS cùng tên miền website).

| Gói | Kích thước | SHA-256 |
|---|---|---|
| Muse4AI-2.0.0-beta.34-win-x64.zip | 169 577 931 | `68B492CF14DCE86ECFA065EF42F1F62BDE8B1A2BA1287B16F7F2D45E9EA6E1EA` |
| Muse4AI-2.0.0-beta.35-win-x64.zip (phòng thử) | 169 577 926 | `256B728C886A1044B115842CC7C91BF0562C5FFD6EFF845C063C5DB788BE777D` |
| Muse4AI-2.0.0-beta.34-Setup-win-x64.exe | 171 757 021 | `A653A09EAB72161AFC8F5CA5C46EFB4D7618E4277C8BB9EE4C86AB7117C0223F` |
| Muse4AI-2.0.0-beta.35-Setup-win-x64.exe (phòng thử) | 171 758 039 | `8AB7248997731593F4496D5081498D23B4D0EDF14BF4CDD00007FB5BBD36202D` |

Bản phát hành beta.34 cuối cùng được dựng lại sau vòng này với một thay đổi giao diện nhỏ (bản mới nhất đã nằm sẵn
trên máy thì không mời tải lại — có test `latestIsKept`); bản đó được kiểm khi nâng app thật trên VPS.

## Đã kiểm (theo AC trong `../../spec.md`)
- **AC-UNI-01/02/05** Cài im lặng bằng EXE (30 s): `tools\install.ps1` + `uninstall.ps1` cùng byte với gói, mục
  Ứng dụng (HKCU) chỉ có nút Gỡ + link website, tên/khoá riêng theo thư mục cài, lối tắt nằm trong phòng thử.
- **AC-UPD-02…05** Kiểm tra ngay → thấy beta.35 → tải 171 758 039 byte → SHA-256 khớp (`u01`, `u02`).
- **AC-UPD-06** Có một lượt đang chạy (cổng Muse giả, không ra mạng) → bấm “Cài và mở lại” thì app hỏi trước (`u03`);
  “Cài ngay” → app đóng, cửa sổ cài hiện tiến trình (`u04`), tự mở beta.35 sau 44 s; beta.34 được giữ làm bản trước.
- **AC-UPD-07** Mở lại thấy “Đã cập nhật từ 2.0.0-beta.34 lên 2.0.0-beta.35” một lần (`u05` VI, `u06` EN); bộ cài
  đã dùng được dọn; lượt đã gửi vẫn là đúng một việc, không gửi lại.
- **AC-RBK-01…03** “Quay lại bản này” → hỏi lại (`r01`) → app đóng, beta.34 mở lại sau 10 s với cùng dữ liệu, mục
  Ứng dụng theo; bản còn giữ beta.35 giờ được mời bằng “Chuyển sang bản này” (`r02`).
- **AC-UNI-03/04** Gỡ từ chính lệnh của mục Ứng dụng, bấm chuột như người dùng: Huỷ không đổi gì (`n01`); có lượt đang
  chạy thì app hỏi (`n02`), gỡ cài chờ rồi dừng sau 51 s và nói lý do, không đổi gì (`n03`); không còn lượt thì app
  thoát bình thường (log `viaQuit:true`), chương trình + mục + lối tắt được gỡ trong 3 s, dữ liệu giữ lại (`n04`).
- **AC-UNI-05** Tick “Xoá luôn tài khoản, proxy, cài đặt…” (`n05`) → dữ liệu app phòng thử bị xoá, tệp trong thư viện
  vẫn còn (`n06`).

## Lỗi thật tìm thấy và đã sửa trong vòng này
1. “Quay lại bản này” đóng app nhưng không mở bản cũ: PowerShell chạy tách rời không có cửa sổ console thoát ngay.
   Nay chạy qua `cmd.exe /c start "" /min` với tham số đã kiểm (`consoleLaunchArgs`, có test), thử lại đạt 10 s.
2. Chữ ô “Xoá luôn…” trong cửa sổ gỡ cài bị cắt: nay đo chiều cao theo chữ, xem lại VI/EN.
3. Sau khi quay lại, cửa sổ gỡ cài và Cài đặt ghi “quay lại bản 2.0.0-beta.35” cho một bản mới hơn: nay ghi
   “chuyển sang”, và không mời tải lại bản đã có sẵn trên máy.

## Công cụ thử và riêng tư
- Ảnh chụp bằng `PrintWindow` từng cửa sổ của phòng thử (app, bộ cài, cửa sổ gỡ cài) — không bao giờ chụp màn hình,
  nên cửa sổ khác trên máy không thể lọt vào ảnh. Một ảnh của lần chạy trước bị cửa sổ khác che đã bị xoá ngay, không
  lưu ở đâu, và công cụ được đổi sang cách chụp này trước vòng cuối.
- Bấm nút bằng chuột thật vào đúng nút của cửa sổ phòng thử (chỉ nhận cửa sổ của app thử, bộ cài thử, hoặc PowerShell
  chạy script trong thư mục thử).
- Dọn xong: tác vụ, máy chủ cục bộ, thư mục cài/dữ liệu/gói thử đã xoá; khoá thông báo Windows trả về app thật.

Script phòng thử (`upd_lab.py`: setup/install/update/after/rollback/uninstall/removedata/teardown; `agent34.ps1`,
`serve34.ps1`, `compile_exe.py`) được giữ riêng, không đưa lên kho công khai vì gắn với máy chủ thử.
