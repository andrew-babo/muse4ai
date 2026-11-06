# Build 3.2 — Master Plan — revision P1 (04/11/2026)

## 1. Mục tiêu, baseline, quyền
- Nguồn: `spec.md` R1 (18 AC: AC-PRXS-01…09, AC-XWIN-01…09). Mức Compact. Baseline: desktop `2.0.0-beta.31`,
  Vitest 740 đạt / 3 bỏ qua (04/11 12:01 UTC), kho dữ liệu v6.
- Quyền: anh giao chạy liền mạch Spec → Plan → Execution (04/11 18:54), được tự xuất bản web + cài VPS (memory 15/10,
  23/10, 30/10). Không gửi tin thật ngoài tài khoản thử; không xoá dữ liệu thật.
- Giữ nguyên: cửa sổ Muse chính, đường chạy việc, R1/R2 (không đi mạng trực tiếp), cổng 47822, dữ liệu `MuseStudio`.

## 2. KEEP / REUSE / REFACTOR / REPLACE / REMOVE
| Phần | Quyết định | Lý do |
|---|---|---|
| `accounts.proxy_id` | KEEP (bỏ UNIQUE) | Nguồn duy nhất của gán proxy (R142) |
| `proxies.account_id`, `Proxy.accountId` | REMOVE | Nguồn thứ hai trùng sự thật, chặn dùng chung |
| `suggestProxy` | REFACTOR → nhận danh sách tài khoản | Tính “chưa dùng” từ nguồn duy nhất |
| Hộp Thêm tài khoản / Đổi proxy | REFACTOR → một bộ chọn proxy dùng chung | Hai hộp cùng nhãn, cùng thứ tự |
| `setWindowOpenHandler(deny)` cửa sổ Muse | REPLACE → `ExtraPages` | R148–R154 |
| Trang việc, kênh trực tiếp | KEEP deny | Không mở trang phụ khi chạy nền |

## 3. Phụ thuộc
Phase 1 (logic chung) → Phase 2 (kho v7 + coordinator) → Phase 3 (giao diện proxy) ; Phase 1 → Phase 4 (trang mở
thêm, độc lập với 2–3) → Phase 5 (chỉ dẫn + Hướng dẫn) → Phase 6 (kiểm Windows) → Phase 7 (audit cuối) → Phase 8
(phát hành beta.32 + website).

## 4. Ma trận truy vết
| AC-ID | Màn/trạng thái | Phase | Test/QA | Gate |
|---|---|---|---|---|
| AC-PRXS-01, 02, 03, 05, 06, 07 | S07, S07a, Đổi proxy | 2 | `test/proxy-share.test.ts` | G2 |
| AC-PRXS-04 | — | 2 | `test/migration-v7.test.ts` | G4 |
| AC-PRXS-08 | S07a, Đổi proxy | 1 | `test/proxy-share.test.ts` (hàm chung) | G1 |
| AC-PRXS-09 | S07a, Đổi proxy | 3, 6 | Windows lab (ảnh) | G1/G3 |
| AC-XWIN-01…06 | Popup, Trang mở thêm | 1, 4, 6 | `test/extra-pages.test.ts` + Windows lab | G2/G3 |
| AC-XWIN-07 | Đăng nhập | 4, 6 | `test/extra-pages.test.ts` + Windows lab | G3 |
| AC-XWIN-08 | Popup, Trang mở thêm | 6 | Windows lab (IP ra, chính sách WebRTC) | G2 |
| AC-XWIN-09 | Hộp đăng nhập, điều khiển | 5, 6 | i18n coverage + Windows lab | G1 |

## 5. Phase
1. **Logic chung (pure TS, `src/shared`)** — `proxyShare.ts` (người dùng proxy, thứ tự + nhãn, gợi ý proxy trống),
   `extraPages.ts` (phân loại `window.open`, đọc `features`, kích thước popup, mô hình tab, lệnh hàng tab, giới hạn).
   Test: AC-PRXS-08, AC-XWIN-01…06 phần logic.
2. **Kho v7 + coordinator + IPC** — migration 7, repo bỏ `account_id`, `addAccount`/`setAccountProxy`/`removeProxy`/
   `unassignProxy`/`testProxy`/`removeAccount`, `account.suggestProxy`. Test AC-PRXS-01…07; sửa test cũ dùng
   `proxy.accountId`.
3. **Giao diện proxy** — `ProxyChoices` dùng chung cho Thêm tài khoản + Đổi proxy, dòng nhắc R145, thẻ tài khoản R146,
   Kho proxy R146, câu chữ “mỗi tài khoản một proxy riêng” sửa thành khuyến nghị; bản dịch tiếng Anh.
4. **Trang mở thêm (`src/main/extraPages.ts`)** — popup (cửa sổ con), cửa sổ trang mở thêm (WebContentsView + hàng tab
   tự chứa), phím tắt, giới hạn, dọn dẹp; nối vào `AccountManager` (chỉ cửa sổ Muse), hoạt động rảnh tính cả trang mở
   thêm. Lệnh thử `__test.extra` (chỉ khi `MUSE4AI_TEST=1`) đọc trạng thái cho phòng thử.
5. **Chỉ dẫn + Hướng dẫn** — dòng R155 trong hộp đăng nhập/điều khiển (Việt/Anh); `content/docs/account.ts` cập nhật
   (proxy dùng chung + trang mở thêm).
6. **Kiểm Windows (phòng thử riêng `C:\MuseStudioLab`, chế độ thử)** — popup/tab/hàng tab/giới hạn/đóng khi xong; hồ sơ
   + proxy (IP ra); hộp Thêm tài khoản với proxy dùng chung (ảnh Việt/Anh). Bằng chứng: `evidence/`.
7. **Audit cuối build** — tự rà G1–G5 trên bản gộp (skill audit chưa kích hoạt riêng: ghi rõ), toàn bộ Vitest + kiểu.
8. **Phát hành** — beta.32 ZIP + EXE trên VPS, nâng bản thật (sao lưu trước), smoke `/v1/health` + MCP, trang Tải về +
   Hướng dẫn trên website, xuất bản.

## 6. Kế hoạch kiểm chứng
- Vitest toàn bộ (≥ 740 + test mới), `tsc --noEmit` desktop, test nội dung `content/`.
- Windows lab: script chạy trong tiến trình chính của bản thử (giống `docs-capture.js`), trang thử là `data:` do tiến
  trình chính nạp, đích popup/tab là trang https công khai; IP ra đọc trong popup/tab so với trang Muse.
- Bản thật sau nâng cấp: `/v1/health` đúng bản, MCP `tools/list`, không gửi tin Muse mới.

## 7. Phát hành / phục hồi
- Sao lưu `data/`, `vault.json`, `ui-locale` trước khi cài; app tự sao lưu kho trước v7. Lùi: cài lại beta.31 + chép
  lại bản sao lưu `before-v7-from-v6-*.sqlite`.
- Quan sát: mở app sau cài, kiểm `/v1/health`, danh sách tài khoản giữ đủ gán proxy, nhật ký không lỗi nâng kho.

## 8. Rủi ro
| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Dựng lại bảng `accounts` làm mất cột/giá trị | Dữ liệu tài khoản | Liệt kê đủ 19 cột, test v6→v7 so từng cột, sao lưu tự động |
| `createWindow` không giữ `window.opener` trên Windows | OAuth dạng tab | Kiểm trong lab; popup (đường OAuth phổ biến) là cửa sổ thật nên luôn giữ opener |
| Trang phụ lộ IP | An toàn tài khoản | Cùng phiên → cùng proxy; hàng tab không tải mạng, dùng phiên tài khoản; kiểm IP ra trong lab |
| Mở trang lạ khi chạy nền | Bất ngờ cho anh | R148: chỉ khi cửa sổ đang hiện |

## 9. Tiến độ
Cập nhật ở `roadmap.md` mục “Build 3.2” và cuối file này sau mỗi phase.

### Tiến độ 04/11 (lượt Execution 1)
- P1–P5 DONE. Desktop 773 đạt / 3 bỏ qua, `tsc` sạch; website + nội dung 53/53.
- E2E Electron thật trên Linux 30/30 (`evidence/e2e-linux-2026-11-04/`): AC-PRXS-01/09, AC-XWIN-01…09 phần E.
- AC-PRXS-02…08 PASS bằng test tự động (`proxy-share.test.ts`, `migration-v7.test.ts`, `coordinator.test.ts`).
- Delta Spec R1.1: R149 — `javascript:` đến dưới dạng `about:blank`, không chặn riêng (lý do trong Spec).
- Còn: P6 Windows (khung cửa sổ, kích thước popup chính xác, phím thật), P7 audit, P8 beta.32.

### Tiến độ 04/11 (lượt Execution 2) — 18/18 AC PASS tự động, P1–P8 DONE
- P6: phòng thử Windows 32/32 (`evidence/lab-windows-2026-11-04/`). Lần đầu 1 FAIL thật (popup lệch 8/20 px do khung
  cửa sổ) → `popupPlacement()` + test → đóng gói lại → 32/32, canh giữa 0 px, kích thước đúng 480×640.
- P7: desktop 774 đạt / 3 bỏ qua, `tsc` sạch, website 53/53; `audit.md` (không còn lỗi nghiêm trọng quyền/dữ liệu).
- P8: ZIP `CD1ACD04…26A9AB7B`, EXE `801F5988…10274`; bản thật VPS lên beta.32 (kho v6→v7, 2 tài khoản giữ đúng proxy,
  457 việc giữ nguyên), smoke tên miền + OAuth + `/mcp` 401; trang Tải về beta.32, xuất bản web
  (`evidence/release-2026-11-04/`).
- Còn mở: QA tay trên trang thật (`qa-human.md`, chờ anh đăng nhập) · GitHub Actions tag (anh tự làm).
