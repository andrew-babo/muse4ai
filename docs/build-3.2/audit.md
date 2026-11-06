# Build 3.2 — Audit cuối build (P7)

> 04/11/2026 · bản gộp beta.32 (ZIP `CD1ACD04…26A9AB7B`). Skill `technical-audit` / `functional-audit` /
> `performance-audit` chưa kích hoạt riêng trong dự án này: đây là tự rà theo G1–G5, không phải báo cáo của các skill đó.

## Phạm vi đã rà
`desktop/src/shared/proxyShare.ts`, `shared/extraPages.ts`, `main/extraPages.ts`, `main/accounts.ts` (nối cửa sổ Muse),
`main/db.ts` (v7), `main/coordinator.ts` + `repo.ts` (gán/gỡ proxy), `renderer/components/ProxyPicker.tsx`,
`screens/Accounts.tsx`, `screens/Settings.tsx`, câu chữ i18n, `content/docs/account(s).ts`.

## G1 — Giao diện, trải nghiệm
- PASS: proxy chưa ai dùng đứng đầu và được chọn sẵn; proxy đang dùng ghi tên tài khoản; dòng nhắc khi dùng chung; thẻ
  tài khoản ghi “dùng chung với …” (ảnh Windows VI/EN).
- PASS: cửa sổ Muse giữ nguyên; popup đúng kích thước trang xin và canh giữa 0 px trên Windows; cửa sổ phụ chỉ hiện hàng
  tab khi ≥ 2 trang; Ctrl+W / Ctrl+Tab; tiêu đề “trang — tài khoản”.
- PASS: hàng tab là trang cục bộ khoá CSP (`default-src 'none'`), không tải mạng, không chữ cố định ngoài bản dịch.
- Lưu ý: chưa đo hiệu năng riêng; trang phụ tính là “đang dùng” nên trang Muse không bị dỡ khi rảnh trong lúc mở.

## G2 — Quyền, an toàn, toàn vẹn dữ liệu
- PASS: chỉ mở trang phụ khi cửa sổ Muse đang hiện (ẩn → `null`); trang việc / kênh trực tiếp vẫn từ chối.
- PASS: chỉ `http(s)` và `about:blank`; giao thức khác bị chặn; nhật ký chỉ có giao thức + tên miền.
- PASS: popup/tab dùng chung hồ sơ + proxy của tài khoản (proxy thử thấy đủ yêu cầu), WebRTC
  `disable_non_proxied_udp`; quyền trình duyệt và tải tệp vẫn bị từ chối ở cấp hồ sơ.
- PASS: giới hạn 8 tab / 4 popup mỗi tài khoản; xoá tài khoản / trang Muse sập / hết điều khiển → đóng hết.
- PASS: lệnh thử `__test.extra` từ chối khi không có `MUSE4AI_TEST=1` (chốt chặn chung cho tiền tố `__test.`, đã có test).
- PASS: kho v7 bỏ ghi trùng chủ sở hữu proxy (một nguồn `accounts.proxy_id`), sao lưu tự động trước khi nâng, test
  v6→v7 so từng cột; bản thật nâng xong giữ đúng gán proxy.
- Rủi ro còn lại (đã ghi Spec R149): `javascript:` tới dưới dạng `about:blank`; không lọc theo tên miền (cần cho
  Connect MCP). Một số trang đăng nhập (vd. Google) có thể từ chối trình duyệt nhúng — chưa kiểm với trang thật.

## G3 — E2E tích hợp
- PASS: Electron thật Linux 30/30, Windows 32/32 với trang thử + proxy thử cục bộ.
- NOT RUN: Muse/Meta thật, Connect MCP thật (cần tài khoản anh đăng nhập) → `qa-human.md`.

## G4 — Nâng cấp, phát hành, lùi bản
- PASS: sao lưu trước cài, cài im lặng, mở bản mới, `/v1/health`, OAuth metadata, `/mcp` 401 có `resource_metadata`.
- Cách lùi có ghi (`evidence/release-2026-11-04/README.md`); chưa diễn tập lùi trên bản thật (không cần trừ khi có sự cố).

## G5 — Vận hành
- Nhật ký nâng kho + hàng chờ đọc lại sau cài. Không có giám sát tự động dài hạn (giới hạn đã biết của dự án).

## Kết luận
Không còn lỗi nghiêm trọng mở về quyền/dữ liệu. Phát hiện duy nhất trong lượt (popup lệch khung trên Windows) đã sửa
và kiểm lại. Phần chưa kiểm: trang thật của Muse/Meta/dịch vụ MCP.
