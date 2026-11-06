# Build 3.2 — Spec: proxy dùng chung có nhãn + trang mở thêm trong cửa sổ Muse

> Revision R1 · 04/11/2026 · **Nguồn chuẩn duy nhất** của luật và AC-ID cho Build 3.2. `plan.md`, `qa-human.md` và
> bằng chứng chỉ tham chiếu AC-ID. Mức: Compact (Discover/Research ngắn nằm ngay trong file này).

## 0. Discover ngắn

- **Yêu cầu (anh, 04/11 18:51):**
  1. Khi thêm tài khoản và chọn proxy, giao diện không cho biết proxy đó đang dùng cho tài khoản nào. **Được phép
     dùng chung, không cấm**, nhưng phải nhìn ra để phân biệt.
  2. Cửa sổ Muse (đăng nhập / điều khiển) chặn mọi trang mở thêm: “Quản lý tài khoản Meta” mở tab mới không lên;
     thêm MCP / MCP OAuth bấm “Connect” bật cửa sổ nhỏ hoặc tab mới cũng không lên. Giữ cửa sổ gọn đẹp như hiện tại —
     **không** thêm thanh địa chỉ hay giao diện kiểu trình duyệt đầy đủ.
- **Người dùng:** dân văn phòng chạy Muse4AI trên Windows; người tự đăng nhập Muse, tự kết nối công cụ trong Muse.
- **Hiện trạng (đọc code beta.31):**
  - Kho dữ liệu khoá cứng 1 proxy ↔ 1 tài khoản: `accounts.proxy_id UNIQUE` và `proxies.account_id UNIQUE` (hai nguồn
    ghi cho cùng một sự thật), lệnh `account.add` / `account.setProxy` từ chối “Proxy đang dùng cho …” (AC-PRX-02 của
    Build 1.0). Hộp thoại Thêm tài khoản chỉ liệt kê proxy trống; hộp Đổi proxy chỉ hiện proxy trống.
  - `AccountManager.window()` đặt `setWindowOpenHandler(() => deny)` cho cửa sổ Muse; mọi `window.open` / `target=_blank`
    bị bỏ âm thầm. Trang việc (pool), kênh trực tiếp cũng deny.
- **Giữ nguyên:** mỗi tài khoản một hồ sơ trình duyệt riêng; mọi lưu lượng của tài khoản đi qua proxy của nó, không
  bao giờ đi thẳng (R1/R2); quyền trình duyệt (camera, vị trí…) vẫn từ chối; tải tệp từ trang vẫn chặn; cửa sổ Muse
  chính giữ nguyên hình dạng; trang việc/kênh trực tiếp vẫn không mở trang phụ.

## 0b. Research ngắn (04/11/2026, Electron 45.0.0 có trong `desktop/package.json`)

- `webContents.setWindowOpenHandler(details)` cho biết `url`, `features`, `disposition` (`default` | `foreground-tab` |
  `background-tab` | `new-window` | `other`). Trả `{action:"allow", overrideBrowserWindowOptions}` tạo cửa sổ con cùng
  phiên (Chromium tạo trang mới trong cùng BrowserContext của trang mở → **cùng hồ sơ, cùng proxy**) và giữ
  `window.opener` — điều kiện để luồng OAuth dạng popup gửi kết quả về trang gốc rồi tự đóng.
- `createWindow(options)` (cùng phản hồi) cho phép nhận trang mới vào một `WebContentsView` thay vì cửa sổ riêng;
  `outlivesOpener:true` giữ trang khi trang mở nó bị đóng. Dùng cho tab để không mất `window.opener` và không chết theo
  trang Muse khi trang này bị dỡ lúc rảnh.
- `features` rỗng/`noopener` → Chromium coi là tab; có `width`/`height`/`popup` → cửa sổ bật lên. Shift+click cũng ra
  `new-window` nhưng không có kích thước → coi là tab.
- Trang `WebContentsView` không tự giải phóng khi gỡ khỏi cửa sổ → phải `webContents.close()`.
- Không có PoC live riêng: hành vi được kiểm trực tiếp trong phòng thử Windows (plan Phase 4) với trang thử cục bộ.

## 1. Phạm vi

**Trong phạm vi**
1. Proxy dùng chung được giữa nhiều tài khoản; mọi chỗ chọn/hiện proxy cho biết proxy đang dùng cho tài khoản nào.
2. Cửa sổ Muse của tài khoản (lúc đăng nhập và lúc điều khiển) mở được cửa sổ bật lên và trang mở thêm, cùng hồ sơ +
   proxy của tài khoản, không thanh địa chỉ.

**Ngoài phạm vi:** nhập địa chỉ tay, nút “tab mới”, lưu tab qua lần mở app, tải tệp từ trang phụ, mở bằng trình duyệt
ngoài, trang phụ cho trang việc / kênh trực tiếp / Vibes (Vibes đã bỏ khỏi bản chính thức).

## 2. Luật — nguồn chuẩn

### 2.1 Proxy dùng chung (PRXS)

- **R142 — Một nguồn sự thật cho gán proxy.** Tài khoản giữ `proxyId` (có thể nhiều tài khoản cùng một proxy). Cột
  `proxies.account_id` bị bỏ; “proxy đang dùng cho ai” luôn tính từ danh sách tài khoản. Nâng kho dữ liệu v6 → v7: bỏ
  ràng buộc duy nhất, giữ nguyên mọi tài khoản/proxy/gán hiện có, có bản sao lưu trước khi nâng (cơ chế sẵn có).
- **R143 — Dùng chung được, không cấm.** `account.add` và `account.setProxy` nhận proxy đang dùng cho tài khoản khác.
  Thêm tài khoản vẫn chỉ nhận proxy **khoẻ** (như cũ). Không truyền proxy → app tự chọn proxy khoẻ **chưa ai dùng**, độ
  trễ thấp nhất; không còn proxy trống thì báo `no_proxy` (không tự ý cho dùng chung).
- **R144 — Luôn thấy ai đang dùng.** Mỗi dòng proxy trong hộp Thêm tài khoản và hộp Đổi proxy ghi “Chưa ai dùng” hoặc
  “Đang dùng: Mây, Gió” (tối đa 2 tên + “+N”), proxy chưa dùng xếp trước (độ trễ tăng dần), rồi tới proxy ít người dùng
  hơn. Hộp Thêm chọn sẵn proxy chưa dùng đầu tiên; nếu không còn proxy trống thì **không chọn sẵn** — anh tự chọn.
- **R145 — Nhắc nhẹ khi dùng chung.** Chọn một proxy đang có tài khoản khác dùng → hiện một dòng nhắc (tông chú ý,
  không phải lỗi): “Proxy này đang dùng cho {tên}. Dùng chung được, nhưng các tài khoản sẽ ra cùng một địa chỉ IP.”
  Nút tiếp tục vẫn bấm được.
- **R146 — Thẻ tài khoản và Kho proxy.** Thẻ tài khoản ghi “dùng chung với {tên}” cạnh tên proxy khi có tài khoản khác
  cùng proxy. Cài đặt › Kho proxy: cột Tài khoản hiện mọi tài khoản đang dùng (avatar + tên, gọn khi nhiều); số
  “đang gán” đếm proxy có ít nhất một tài khoản.
- **R147 — Gỡ, xoá, kiểm lại với proxy dùng chung.** “Gỡ khỏi tài khoản” gỡ proxy khỏi **mọi** tài khoản đang dùng
  (từ chối cả lệnh nếu một trong số đó đang làm việc / được giữ). Xoá proxy chỉ khi không còn tài khoản nào dùng (nút
  mờ + gợi ý như cũ). Kiểm lại proxy thành công → **mọi** tài khoản đang ở “Lỗi proxy” trên proxy đó trở lại “Sẵn sàng”
  rồi kiểm phiên. Đổi proxy của một tài khoản không đụng tới tài khoản khác cùng proxy.

### 2.2 Trang mở thêm trong cửa sổ Muse (XWIN)

- **R148 — Chỉ khi anh đang dùng cửa sổ.** Cửa sổ Muse của tài khoản chỉ mở trang phụ khi nó **đang hiện cho anh**
  (đăng nhập hoặc điều khiển). Khi ẩn (đang chạy việc nền), trang việc, kênh trực tiếp: vẫn từ chối như cũ.
- **R149 — Chỉ địa chỉ web.** Chỉ mở `https:` / `http:` và `about:blank` (popup OAuth hay mở trống rồi mới chuyển
  trang). Mọi giao thức khác (`file:`, `data:`, `chrome:`, `devtools:`, `mailto:`, giao thức ứng dụng…) bị từ chối. Nhật
  ký chỉ ghi giao thức + tên miền, **không bao giờ** ghi đường dẫn/tham số (có thể chứa mã OAuth).
  *Quyết định (khác đề xuất trong chat 04/11 “chỉ trang Meta, link lạ thì mở bằng trình duyệt máy”):* **không** lọc
  theo tên miền, vì nút Connect của MCP/OAuth mở sang trang của chính dịch vụ (Notion, Google, GitHub…) và cần
  `window.opener` trong cùng phiên Muse — mở ra trình duyệt máy thì kết quả không về được. Bù lại bằng R148 (chỉ khi
  anh đang dùng cửa sổ), R152 (cùng hồ sơ + proxy, chặn WebRTC/quyền/tải tệp) và giới hạn số trang (R153).
  *Delta R1.1 (E2E 04/11):* `window.open('javascript:…')` tới app dưới dạng trang trống `about:blank` (Chromium tạo trang
  trống rồi chạy đoạn mã đó **trong quyền của chính trang mở nó**), nên không chặn riêng được mà không chặn luôn nút
  Kết nối kiểu “mở trang trống trước, gán địa chỉ sau khi hỏi máy chủ”. Không thêm quyền gì cho trang; AC-XWIN-04 kiểm
  các giao thức còn lại, và kiểm thêm luồng trang trống được gán địa chỉ sau.
- **R150 — Cửa sổ bật lên (popup).** Trang xin cửa sổ có kích thước (`width`/`height`/`popup`) → mở một cửa sổ nhỏ
  nằm giữa cửa sổ gốc, kích thước theo trang xin, kẹp trong 360–1000 × 400–900 px (mặc định 520 × 720), nằm trong màn
  hình, không menu, nền trắng ngà. Giữ `window.opener` để trang gốc nhận kết quả; trang tự đóng được. Tiêu đề:
  “{tiêu đề trang} — {tên tài khoản}”. Popup trong popup theo cùng luật.
- **R151 — Trang mở thêm (tab).** Link mở tab mới / `window.open` không kích thước → trang vào **một cửa sổ “trang mở
  thêm” riêng của tài khoản** (gọn, không thanh địa chỉ, không nút tab mới). Có 1 trang: cửa sổ chỉ có trang đó, trông
  như cửa sổ Muse. **Từ 2 trang trở lên** mới hiện một hàng tab mảnh phía trên (tên trang, chữ cái đầu tên miền, nút ✕;
  bấm tab để chuyển). Phím: Ctrl+W đóng trang, Ctrl+Tab / Ctrl+Shift+Tab chuyển, Alt+← / Alt+→ lùi/tiến, F5 / Ctrl+R
  tải lại. Tiêu đề cửa sổ: “{tiêu đề trang đang xem} — {tên tài khoản}”. Đóng trang cuối → đóng cửa sổ.
- **R152 — Cùng hồ sơ, cùng proxy, cùng giới hạn an toàn.** Mọi popup/tab dùng chính hồ sơ của tài khoản (cùng cookie,
  cùng proxy), chặn WebRTC lộ IP như trang Muse, quyền trình duyệt vẫn từ chối, tải tệp vẫn chặn. Hàng tab là trang của
  app, **không tải gì từ mạng** (CSP `default-src 'none'`), không hiện favicon (favicon sẽ phải tải qua mạng).
- **R153 — Giới hạn.** Tối đa 8 tab và 4 popup đang mở mỗi tài khoản; vượt → từ chối và đưa cửa sổ trang mở thêm lên
  trước. Trang bị sập → tab đó tự đóng.
- **R154 — Khi nào đóng.** Đăng nhập xong: cửa sổ Muse ẩn như cũ, **popup đóng**, cửa sổ trang mở thêm **giữ lại**
  để anh làm nốt (ví dụ đang ở Trung tâm tài khoản Meta). Huỷ đăng nhập, đóng cửa sổ Muse giữa chừng, bấm “Đã xong”
  điều khiển, xoá tài khoản, trang Muse sập: đóng hết popup và trang mở thêm. Trong lúc cửa sổ trang mở thêm còn mở,
  trang Muse của tài khoản không bị dỡ vì rảnh.
- **R155 — Chỉ dẫn trong app.** Hộp đăng nhập và màn điều khiển ghi một dòng: trang Muse mở thêm (Trung tâm tài khoản
  Meta, nút Kết nối của công cụ…) hiện trong cửa sổ riêng, cùng proxy của tài khoản. Bài Hướng dẫn “Tài khoản” cập nhật
  theo (proxy dùng chung được + trang mở thêm).

## 3. Màn hình và trạng thái (Screens)

| Màn | Trạng thái | Nội dung |
|---|---|---|
| S07a Thêm tài khoản | có proxy trống | Danh sách proxy khoẻ dạng dòng chọn: chấm sức khoẻ, `Tên · quốc gia`, độ trễ, dòng phụ “Chưa ai dùng” (xanh) / “Đang dùng: …”; chọn sẵn dòng chưa dùng đầu tiên |
| S07a | hết proxy trống, còn proxy khoẻ | Không chọn sẵn; gợi ý “Mọi proxy khoẻ đều đang dùng — chọn một proxy để dùng chung, hoặc nhập thêm proxy” + nút Nhập proxy |
| S07a | không có proxy khoẻ | Như cũ: “Chưa có proxy khoẻ nào.” + Nhập proxy |
| S07a / Đổi proxy | chọn proxy đang dùng | Dòng nhắc R145 dưới danh sách |
| Đổi proxy | — | Hiện **mọi** proxy (proxy hiện tại gắn “đang dùng”), dòng phụ người dùng như S07a |
| S07 thẻ tài khoản | proxy dùng chung | “P01 · VN 120 ms · dùng chung với Gió” |
| S09 Kho proxy | — | Cột Tài khoản: tối đa 2 avatar+tên, “+N” |
| Cửa sổ Muse | đăng nhập/điều khiển | Không đổi |
| Popup | — | Cửa sổ nhỏ giữa cửa sổ gốc, không menu |
| Trang mở thêm | 1 trang | Cửa sổ gọn chỉ có trang |
| Trang mở thêm | ≥ 2 trang | Hàng tab 36 px nền trắng ngà; tab đang xem nền trắng, có ✕ |

## 4. Dữ liệu và hợp đồng

- Kho v7: bảng `accounts` dựng lại không có `UNIQUE(proxy_id)` + chỉ mục thường `accounts_proxy(proxy_id)`; bảng
  `proxies` dựng lại không có cột `account_id` (giữ `UNIQUE(host, port)`). Gán cũ: tài khoản có `proxy_id` giữ nguyên;
  tài khoản thiếu `proxy_id` mà proxy cũ ghi `account_id` là nó → lấy lại; `proxy_id` trỏ tới proxy không còn → `NULL`.
- Kiểu `Proxy` bỏ `accountId`. Ai dùng proxy = `accounts.filter(a => a.proxyId === p.id)` (hàm chung
  `proxyUsers`/`proxyChoices` trong `src/shared`, dùng cho cả giao diện lẫn tiến trình chính).
- IPC/REST/MCP: không đổi tên lệnh. `account.add`, `account.setProxy` không còn lỗi “Proxy đang dùng cho …”.
  `proxy.unassign` gỡ khỏi mọi tài khoản. REST/MCP không trả proxy (không đổi).

## 5. Acceptance criteria — nguồn chuẩn

| AC-ID | Điều kiện/input | Hành động | Kết quả cụ thể | Bắt buộc | Kiểm |
|---|---|---|---|---|---|
| AC-PRXS-01 | Proxy P01 khoẻ đang dùng cho “Mây” | `account.add` tên “Gió” với P01 | Tạo được; Mây và Gió cùng `proxyId = P01`; không lỗi | có | U |
| AC-PRXS-02 | Gió dùng P02; P01 đang dùng cho Mây | `account.setProxy(Gió, P01)` | Đổi được; P02 không còn ai dùng; Mây vẫn ở P01 | có | U |
| AC-PRXS-03 | P01 (Mây), P02 trống độ trễ 300 ms, P03 trống 120 ms | `account.add` không truyền proxy; rồi khi mọi proxy đều có người dùng | Lần 1 chọn P03; khi hết proxy trống → lỗi `no_proxy`, không tự dùng chung | có | U |
| AC-PRXS-04 | Kho v6 có 2 tài khoản gán P01/P02, 1 proxy trống | Mở bằng bản mới | Lên v7, có bản sao lưu `before-v7-from-v6`, gán giữ nguyên; sau đó gán P01 cho tài khoản thứ ba được | có | U |
| AC-PRXS-05 | P01 dùng cho Mây + Gió, cả hai “Lỗi proxy” | Kiểm lại P01 thành công | Cả hai về “Sẵn sàng” và được kiểm phiên | có | U |
| AC-PRXS-06 | P01 dùng cho Mây + Gió | `proxy.unassign(P01)`; lần khác Gió đang chạy việc | Lần 1: cả hai mất proxy; lần 2: từ chối “Tài khoản đang làm việc”, không gỡ ai | có | U |
| AC-PRXS-07 | Xoá Mây (đang dùng chung P01 với Gió) | `account.remove(Mây)` | Gió vẫn dùng P01 | có | U |
| AC-PRXS-08 | 4 proxy: P01 (Mây, Gió), P02 (Nắng), P03 trống 300 ms, P04 trống 90 ms | Tính danh sách chọn | Thứ tự P04, P03, P02, P01; nhãn “Chưa ai dùng” / “Đang dùng: Nắng” / “Đang dùng: Mây, Gió”; với 3 người “Mây, Gió +1” | có | U |
| AC-PRXS-09 | Hộp Thêm tài khoản / Đổi proxy, chọn P01 đang dùng cho Mây | Mở hộp, bấm P01 | Dòng phụ “Đang dùng: Mây”; dòng nhắc R145 hiện; nút tiếp tục bật. Hết proxy trống → không có dòng nào được chọn sẵn | có | W |
| AC-XWIN-01 | Cửa sổ Muse đang hiện | Trang gọi `window.open(url, "x", "width=480,height=640")` (https) | Mở 1 popup 480 × 640 nằm giữa cửa sổ gốc, cùng hồ sơ (cookie đặt ở trang gốc đọc được), `window.opener` khác null; popup gọi `window.close()` → đóng | có | U/W |
| AC-XWIN-02 | Cửa sổ Muse đang hiện | Bấm link `target=_blank` (https) | Mở cửa sổ trang mở thêm có đúng 1 trang, **không** hàng tab | có | U/W |
| AC-XWIN-03 | Đã có 1 trang mở thêm | Mở trang thứ 2; bấm ✕ ở trang 2; Ctrl+W | Hàng tab hiện khi có 2 trang; đóng trang 2 → hàng tab ẩn; đóng trang cuối → cửa sổ đóng | có | U/W |
| AC-XWIN-04 | — | `window.open` tới `file:///…`, `javascript:…`, `data:…`, `ms-settings:` | Không mở gì; log chỉ có giao thức | có | U |
| AC-XWIN-05 | Cửa sổ Muse đang ẩn (chạy việc nền) | Trang gọi `window.open` | Không mở gì | có | U/W |
| AC-XWIN-06 | Đã có 8 tab / 4 popup | Xin thêm | Bị từ chối, cửa sổ trang mở thêm lên trước | có | U |
| AC-XWIN-07 | Popup + 1 trang mở thêm đang mở trong lúc đăng nhập | Đăng nhập xong; lần khác bấm Huỷ | Xong: popup đóng, trang mở thêm còn; Huỷ: tất cả đóng | có | U/W |
| AC-XWIN-08 | Popup / trang mở thêm | Đọc cài đặt trang | Cùng proxy của tài khoản (IP ra trùng IP của trang Muse), WebRTC `disable_non_proxied_udp` | có | W |
| AC-XWIN-09 | Hộp đăng nhập / màn điều khiển (Việt, Anh) | Mở | Có dòng chỉ dẫn R155 đúng ngôn ngữ | có | U/W |

Tổng: **18 AC** bắt buộc (PRXS 9 + XWIN 9). Kiểm: U = test tự động; W = bản Windows trong phòng thử riêng.

## 6. Chất lượng, phát hành, phục hồi

- Không đổi hiệu năng đường chạy việc; trang phụ chỉ tồn tại khi anh mở.
- Nâng kho v7 có sao lưu tự động trước khi nâng; lùi về beta.31 cần khôi phục bản sao lưu đó (bản cũ từ chối kho mới
  hơn). Ghi trong ghi chú phát hành.
- Phát hành: beta.32 (ZIP + EXE), cài lên VPS sản xuất cổng 47822 theo quy trình đã có (sao lưu `data/`, cài trong
  phiên 1), cập nhật trang Tải về + bài Hướng dẫn trên website.

## 7. Revision

| Rev | Ngày | Thay đổi |
|---|---|---|
| R1 | 04/11/2026 | Tạo mới từ yêu cầu 04/11 18:51 (anh duyệt hướng: proxy dùng chung có nhãn, trang mở thêm gọn). Thay AC-PRX-02 của Build 1.0 (“từ chối proxy đang dùng”) bằng R143. |
