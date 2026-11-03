import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_LIBRARY: DocArticle[] = [
  {
    slug: "library",
    chapter: "library",
    order: 1,
    title: { en: "Find and reuse results", vi: "Tìm và dùng lại kết quả" },
    summary: {
      en: "Find finished results in Library, filter by prompt or batch, open local files, and reuse an image as a Studio reference.",
      vi: "Tìm kết quả trong Thư viện, lọc theo prompt hoặc lô, mở tệp trên máy và dùng lại ảnh làm tham chiếu trong Studio.",
    },
    before: [
      {
        en: "Finish a job and allow its result to download.",
        vi: "Hoàn tất một lượt và chờ tải kết quả về máy.",
      },
      {
        en: "Keep the downloaded files available in their saved locations.",
        vi: "Giữ các tệp đã tải tại vị trí lưu để app mở được.",
      },
    ],
    steps: [
      {
        title: { en: "1. Open Library", vi: "1. Mở Thư viện" },
        body: {
          en: `Open Library in ${FACTS.productName}. Browse the finished results, or narrow the view by type, batch, account, or favorites.`,
          vi: `Mở Thư viện trong ${FACTS.productName}. Duyệt kết quả hoàn chỉnh hoặc lọc theo loại, lô, tài khoản hay Yêu thích.`,
        },
        shot: "library-grid",
      },
      {
        title: { en: "2. Search by prompt", vi: "2. Tìm theo prompt" },
        body: {
          en: "Use the prompt search to find words from the original request. If nothing appears, clear other filters and try a shorter phrase.",
          vi: "Dùng Tìm theo prompt để tìm từ có trong yêu cầu gốc. Nếu không thấy kết quả, bỏ các bộ lọc khác và thử cụm từ ngắn hơn.",
        },
      },
      {
        title: { en: "3. Preview and open the file", vi: "3. Xem và mở tệp" },
        body: {
          en: "Open an item to inspect it and its details. Use Open file to launch the saved file or the folder action to locate it on your PC.",
          vi: "Mở tác phẩm để xem kết quả và thông tin chi tiết. Chọn Mở file để mở tệp đã lưu hoặc Hiện trong thư mục để tìm vị trí trên máy.",
        },
        shot: "library-detail",
      },
      {
        title: { en: "4. Reuse an image in Studio", vi: "4. Dùng lại ảnh trong Studio" },
        body: {
          en: "For an image, choose Use as reference image. Check the attachment in Studio, describe the changes you want, and send only when ready. Reuse creates a new request; it does not change the original file.",
          vi: "Với ảnh, chọn Dùng làm ảnh tham chiếu. Kiểm tra ảnh đính kèm trong Studio, mô tả phần muốn đổi rồi mới gửi. Dùng lại sẽ tạo yêu cầu mới, không sửa tệp gốc.",
        },
      },
    ],
    success: {
      en: "You can find a finished result, open its local file, and bring a saved image into Studio as a reference.",
      vi: "Bạn tìm được kết quả hoàn chỉnh, mở được tệp trên máy và đưa ảnh đã lưu vào Studio làm tham chiếu.",
    },
    troubleshoot: [
      {
        q: {
          en: "Why is Library empty?",
          vi: "Vì sao Thư viện trống?",
        },
        a: {
          en: "Check that a job finished and its result downloaded. Clear search and filters, then inspect the job in Queue if the file is still missing.",
          vi: "Kiểm tra lượt đã xong và kết quả đã tải về chưa. Xoá tìm kiếm cùng bộ lọc, rồi mở lượt trong Hàng chờ nếu vẫn thiếu tệp.",
        },
      },
      {
        q: {
          en: "The app says the file is missing. What should I check?",
          vi: "App báo không tìm thấy tệp thì kiểm tra gì?",
        },
        a: {
          en: "The file may have been moved or deleted. Restore it to its saved location if possible, then use Rescan to refresh the library's file status.",
          vi: "Tệp có thể đã bị chuyển hoặc xoá. Nếu được, đưa tệp về vị trí đã lưu rồi chọn Quét lại để cập nhật tình trạng tệp trong thư viện.",
        },
      },
      {
        q: {
          en: "Will changing the library folder move existing results?",
          vi: "Đổi thư mục thư viện có chuyển kết quả cũ không?",
        },
        a: {
          en: "No. General settings changes the destination for new files only. Existing files remain in their original locations.",
          vi: "Không. Thay đổi trong Cài đặt › Chung chỉ áp dụng cho tệp mới. Tệp đang có vẫn nằm ở vị trí cũ.",
        },
      },
    ],
    related: ["extend-video", "reference-files", "queue", "batches", "settings-overview"],
    appRoute: "/library",
    updated: "2026-11-03",
  },
  {
    slug: "extend-video",
    chapter: "library",
    order: 2,
    title: { en: "Extend a video", vi: "Kéo dài video" },
    summary: {
      en: `Continue a Muse video from Library about ${FACTS.extend.stepSeconds} seconds per step, up to ${FACTS.extend.maxSteps} steps (about ${FACTS.extend.maxSeconds} seconds), and get one longer video each time.`,
      vi: `Nối tiếp một video Muse trong Thư viện, mỗi lần khoảng ${FACTS.extend.stepSeconds} giây, tối đa ${FACTS.extend.maxSteps} lần (khoảng ${FACTS.extend.maxSeconds} giây), mỗi lần ra một video dài hơn.`,
    },
    before: [
      {
        en: "Pick a video Muse made through Muse4AI: from Studio, a batch or an AI agent.",
        vi: "Chọn video do Muse tạo qua Muse4AI: từ Studio, Hàng loạt hay AI agent.",
      },
      {
        en: "The Muse account that made the video must still be in Accounts, ready, with usage limit remaining.",
        vi: "Tài khoản Muse đã tạo video vẫn phải còn trong Tài khoản, đang sẵn sàng và còn hạn mức.",
      },
    ],
    steps: [
      {
        title: { en: "1. Open the video and choose Extend video", vi: "1. Mở video và chọn Kéo dài video" },
        body: {
          en: "Open Library, click the video, and choose Extend video. If the button is grey, the line under it says why, for example that the account is missing or the video has no Muse conversation.",
          vi: "Mở Thư viện, bấm vào video rồi chọn Kéo dài video. Nếu nút bị mờ, dòng chữ bên dưới cho biết lý do, ví dụ thiếu tài khoản hoặc video chưa có hội thoại Muse.",
        },
        shot: "library-extend",
      },
      {
        title: { en: "2. Choose how to continue", vi: "2. Chọn cách nối tiếp" },
        body: {
          en: "Auto lets Muse continue the same scene. Based on description lets you write what should happen next, for example “the boat drifts under a small wooden bridge”.",
          vi: "Tự động để Muse nối tiếp đúng cảnh đang có. Theo mô tả cho bạn viết cảnh tiếp theo, ví dụ “chiếc thuyền trôi qua dưới một cây cầu gỗ nhỏ”.",
        },
        shot: "extend-sheet",
      },
      {
        title: { en: "3. Set how long", vi: "3. Chọn dài bao nhiêu" },
        body: {
          en: `Steps sets how many times to extend (1–${FACTS.extend.maxSteps}); Target length stops near the length you pick (up to ${FACTS.extend.maxSeconds} seconds). Each step is one Muse request and may use usage limit.`,
          vi: `Số lần là số lần kéo dài (1–${FACTS.extend.maxSteps}); Đến khoảng dừng khi gần tới độ dài bạn chọn (tối đa ${FACTS.extend.maxSeconds} giây). Mỗi lần là một yêu cầu Muse và có thể dùng hạn mức.`,
        },
      },
      {
        title: { en: "4. Start and follow the chain", vi: "4. Bắt đầu và theo dõi chuỗi" },
        body: {
          en: "Choose Start extending. Each finished step adds one new, longer video to Library; the original stays as it was. Use View chain to see every step or to stop the chain.",
          vi: "Bấm Bắt đầu kéo dài. Mỗi lần xong sẽ thêm một video mới, dài hơn vào Thư viện; video gốc vẫn giữ nguyên. Chọn Xem chuỗi để xem từng lần hoặc dừng chuỗi.",
        },
      },
    ],
    success: {
      en: "Library shows a new video longer than the original, and the chain lists each finished step.",
      vi: "Thư viện có video mới dài hơn bản gốc và chuỗi liệt kê từng lần đã xong.",
    },
    troubleshoot: [
      {
        q: { en: "Why is Extend video greyed out?", vi: "Vì sao nút Kéo dài video bị mờ?" },
        a: {
          en: "Read the line under the button. Common reasons: the account that made the video was removed, the video was made before this version saved its Muse conversation, or a newer video now continues that conversation. Make a new video, or extend the newest one.",
          vi: "Đọc dòng chữ dưới nút. Lý do hay gặp: tài khoản tạo video đã bị xoá, video được tạo trước khi bản này lưu hội thoại Muse, hoặc đã có video mới hơn nối tiếp hội thoại đó. Hãy tạo video mới hoặc kéo dài video mới nhất.",
        },
      },
      {
        q: { en: "Does the account's run method matter?", vi: "Cách chạy của tài khoản có ảnh hưởng không?" },
        a: {
          en: "Yes. A video keeps the way it was made: one made over HTTP continues over HTTP, one made through the Muse page continues through the page. Keep the account on Auto and both work; the app tells you if the current setting blocks it.",
          vi: "Có. Video giữ cách nó được tạo: video tạo qua HTTP thì kéo dài qua HTTP, video tạo qua giao diện Muse thì kéo dài qua giao diện. Để tài khoản ở Tự động thì cả hai đều chạy; nếu cài đặt hiện tại chặn, app sẽ báo.",
        },
      },
      {
        q: { en: "The join between steps is not smooth.", vi: "Chỗ nối giữa các lần chưa liền mạch." },
        a: {
          en: "Muse decides each continuation, so a seamless join is not guaranteed. Try Auto for the same scene, or describe the next moment more precisely.",
          vi: "Muse tự quyết định từng đoạn nối, nên không bảo đảm mọi chỗ nối đều liền. Thử Tự động để giữ cùng cảnh, hoặc mô tả khoảnh khắc tiếp theo cụ thể hơn.",
        },
      },
    ],
    related: ["library", "edit-video", "create-video", "accounts-and-limits"],
    appRoute: "/library",
    updated: "2026-11-03",
  },
];
