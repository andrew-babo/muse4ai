import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_STUDIO: DocArticle[] = [
  {
    slug: "create-image",
    chapter: "studio",
    order: 1,
    title: { en: "Create an image", vi: "Tạo ảnh" },
    summary: {
      en: "Create an image from a clear description in Studio, follow its progress, and find the finished file on your PC.",
      vi: "Tạo ảnh từ mô tả trong Studio, theo dõi tiến trình và tìm tệp kết quả trên máy để dùng cho công việc của bạn.",
    },
    before: [
      {
        en: "Have a Muse account ready with usage limit remaining.",
        vi: "Có tài khoản Muse sẵn sàng và còn hạn mức.",
      },
      {
        en: "Check that your library folder has room for new files.",
        vi: "Kiểm tra thư mục thư viện còn chỗ cho tệp mới.",
      },
    ],
    steps: [
      {
        title: { en: "1. Select Image", vi: "1. Chọn Ảnh" },
        body: {
          en: "Open Studio, choose Image, and use the text creation mode for a new image. For editing an existing picture, see [Reference files](/docs/reference-files).",
          vi: "Mở Studio, chọn Ảnh rồi chọn Từ chữ để tạo ảnh mới. Nếu muốn sửa ảnh có sẵn, xem [Tệp tham chiếu](/docs/reference-files).",
        },
        shot: "studio-image",
      },
      {
        title: { en: "2. Describe the result", vi: "2. Mô tả kết quả" },
        body: {
          en: "Describe the subject, setting, light, and style. For a shop photo, explain where the product should sit and what should be in the background.",
          vi: "Nêu chủ thể, bối cảnh, ánh sáng và phong cách. Với ảnh cho shop, hãy nói rõ sản phẩm đặt ở đâu và phông nền cần có gì.",
        },
      },
      {
        title: { en: "3. Send once", vi: "3. Gửi một lần" },
        body: {
          en: "Choose an account or leave account selection automatic, then send the request. If no account is ready, the job waits in Queue. Do not send it again just because it is waiting.",
          vi: "Chọn tài khoản hoặc giữ Tự động rồi gửi yêu cầu. Nếu chưa có tài khoản sẵn sàng, lượt sẽ nằm trong Hàng chờ. Đừng gửi lại chỉ vì lượt đang chờ.",
        },
      },
      {
        title: { en: "4. Review the saved image", vi: "4. Xem ảnh đã lưu" },
        body: {
          en: `Open the finished result in Studio or Library. Images normally arrive as ${FACTS.media.imageFormat}, around ${FACTS.media.imageWidth}×${FACTS.media.imageHeight}; inspect the actual file before using it.`,
          vi: `Mở kết quả hoàn chỉnh trong Studio hoặc Thư viện. Ảnh thường có định dạng ${FACTS.media.imageFormat}, khoảng ${FACTS.media.imageWidth}×${FACTS.media.imageHeight}; hãy kiểm tra tệp thực tế trước khi dùng.`,
        },
      },
    ],
    success: {
      en: "The job finishes, its image opens, and the downloaded file appears in Library.",
      vi: "Lượt hoàn tất, bạn mở được ảnh và tệp đã tải xuất hiện trong Thư viện.",
    },
    troubleshoot: [
      {
        q: { en: "Why is the job waiting?", vi: "Vì sao lượt vẫn đang chờ?" },
        a: {
          en: "Check Accounts for a ready account with remaining usage limit and a working proxy. Also check whether other jobs are using the available parallel slots.",
          vi: "Kiểm tra có tài khoản sẵn sàng, còn hạn mức và proxy hoạt động không. Các lượt khác cũng có thể đang dùng hết số việc chạy song song.",
        },
      },
      {
        q: {
          en: "The result is not what I wanted. What should I change?",
          vi: "Ảnh chưa đúng ý thì nên sửa gì?",
        },
        a: {
          en: "Make the description more specific or attach a reference image. Sending another request creates another job and uses your Muse usage limit.",
          vi: "Viết mô tả cụ thể hơn hoặc thêm ảnh tham chiếu. Gửi yêu cầu mới sẽ tạo lượt mới và dùng hạn mức Muse của bạn.",
        },
      },
    ],
    related: ["reference-files", "queue", "library"],
    appRoute: "/studio",
    updated: "2026-11-02",
  },
  {
    slug: "create-video",
    chapter: "studio",
    order: 2,
    title: { en: "Create a video", vi: "Tạo video" },
    summary: {
      en: "Describe a short video in Studio, submit it to Muse, and review the finished clip before using it in your project.",
      vi: "Mô tả video ngắn trong Studio, gửi yêu cầu đến Muse và xem lại clip hoàn chỉnh trước khi dùng cho dự án của bạn.",
    },
    before: [
      {
        en: "Have a ready Muse account with usage limit remaining.",
        vi: "Có tài khoản Muse sẵn sàng và còn hạn mức.",
      },
      {
        en: "Plan one short scene and make room for the downloaded video.",
        vi: "Chuẩn bị một cảnh ngắn và chỗ trống để lưu video.",
      },
    ],
    steps: [
      {
        title: { en: "1. Select Video", vi: "1. Chọn Video" },
        body: {
          en: "Open Studio and select Video. Use the text creation mode to start from a description rather than an existing image or MP4.",
          vi: "Mở Studio và chọn Video. Chọn Từ chữ để bắt đầu bằng mô tả thay vì dùng ảnh hoặc MP4 có sẵn.",
        },
        shot: "studio-video",
      },
      {
        title: { en: "2. Describe one short scene", vi: "2. Mô tả một cảnh ngắn" },
        body: {
          en: `Muse clips are about ${FACTS.media.videoSeconds} seconds. Describe the subject, its motion, the camera movement, and the setting rather than asking for many scenes.`,
          vi: `Clip Muse dài khoảng ${FACTS.media.videoSeconds} giây. Hãy mô tả chủ thể, chuyển động, cách máy quay di chuyển và bối cảnh thay vì yêu cầu quá nhiều cảnh.`,
        },
      },
      {
        title: { en: "3. Send and follow progress", vi: "3. Gửi và theo dõi" },
        body: {
          en: "Choose an account or automatic selection, then send once. Follow the job in Studio or Queue. If it needs review, inspect it instead of submitting a duplicate.",
          vi: "Chọn tài khoản hoặc Tự động rồi gửi một lần. Theo dõi lượt trong Studio hoặc Hàng chờ. Nếu lượt cần kiểm tra, hãy mở chi tiết thay vì gửi trùng.",
        },
      },
      {
        title: { en: "4. Play the finished clip", vi: "4. Phát clip hoàn chỉnh" },
        body: {
          en: `Open the result and check motion, framing, and sound. Typical output is ${FACTS.media.videoWidth}×${FACTS.media.videoHeight} with ${FACTS.media.videoCodec}. Find the saved file in Library.`,
          vi: `Mở kết quả để kiểm tra chuyển động, khung hình và âm thanh. Tệp thường có kích thước ${FACTS.media.videoWidth}×${FACTS.media.videoHeight}, dùng ${FACTS.media.videoCodec}. Tìm tệp đã lưu trong Thư viện.`,
        },
      },
    ],
    success: {
      en: "The finished clip plays in the app and its downloaded file is available in Library.",
      vi: "Clip hoàn chỉnh phát được trong app và tệp đã tải có trong Thư viện.",
    },
    troubleshoot: [
      {
        q: {
          en: "Why is the clip shorter than the story I described?",
          vi: "Vì sao clip ngắn hơn câu chuyện tôi mô tả?",
        },
        a: {
          en: `Muse normally produces clips of about ${FACTS.media.videoSeconds} seconds. Simplify the request to one scene; do not assume a longer prompt produces a longer video.`,
          vi: `Muse thường tạo clip khoảng ${FACTS.media.videoSeconds} giây. Hãy rút yêu cầu còn một cảnh; mô tả dài hơn không đồng nghĩa video sẽ dài hơn.`,
        },
      },
      {
        q: {
          en: "An image-to-video or editing option is unavailable. Why?",
          vi: "Vì sao tuỳ chọn ảnh thành video hoặc sửa video chưa dùng được?",
        },
        a: {
          en: "Some actions depend on what the current Muse version supports. Follow the app's notice rather than repeatedly resending the request.",
          vi: "Một số thao tác phụ thuộc khả năng của phiên bản Muse hiện tại. Làm theo thông báo trong app thay vì gửi lại nhiều lần.",
        },
      },
    ],
    related: ["edit-video", "extend-video", "reference-files", "library"],
    appRoute: "/studio",
    updated: "2026-11-03",
  },
  {
    slug: "edit-video",
    chapter: "studio",
    order: 3,
    title: { en: "Edit a video", vi: "Sửa video" },
    summary: {
      en: "Attach an MP4 in Studio, describe the change in words, and Muse returns a new edited video while your original file stays as it was.",
      vi: "Đính một tệp MP4 trong Studio, viết rõ muốn sửa gì; Muse trả về video mới đã sửa, tệp gốc của bạn vẫn giữ nguyên.",
    },
    before: [
      {
        en: "Have a ready Muse account with usage limit remaining.",
        vi: "Có tài khoản Muse sẵn sàng và còn hạn mức.",
      },
      {
        en: "Keep the MP4 you want to change on your PC (a short clip works best).",
        vi: "Có sẵn tệp MP4 muốn sửa trên máy (clip ngắn cho kết quả tốt nhất).",
      },
    ],
    steps: [
      {
        title: { en: "1. Choose Video, then Edit video", vi: "1. Chọn Video, rồi Sửa video" },
        body: {
          en: "Open Studio and select Video. Open the creation method menu next to it and choose Edit video (MP4 → video).",
          vi: "Mở Studio và chọn Video. Mở menu cách tạo bên cạnh và chọn Sửa video (MP4 → video).",
        },
        shot: "studio-video-edit",
      },
      {
        title: { en: "2. Attach the MP4", vi: "2. Đính tệp MP4" },
        body: {
          en: "Drag the MP4 into Studio or use the attach button. Check the small preview: it is the clip Muse will change. A video from Library can be attached the same way.",
          vi: "Kéo tệp MP4 vào Studio hoặc bấm nút đính kèm. Xem ô xem trước nhỏ: đó là clip Muse sẽ sửa. Video trong Thư viện cũng đính được theo cách này.",
        },
      },
      {
        title: { en: "3. Say what should change", vi: "3. Ghi rõ muốn đổi gì" },
        body: {
          en: "Write one clear change, for example “make the light warmer and add a slow push-in at the end”. Name what must stay the same, such as the product or the person.",
          vi: "Viết một thay đổi rõ ràng, ví dụ “làm ánh sáng ấm hơn và thêm cảnh đẩy máy chậm ở cuối”. Ghi luôn phần cần giữ nguyên, như sản phẩm hay nhân vật.",
        },
      },
      {
        title: { en: "4. Send once and compare", vi: "4. Gửi một lần và so sánh" },
        body: {
          en: "Send, follow the job in Studio or Queue, then play the new clip next to the original. The edited video is a new file in Library; the original is never overwritten.",
          vi: "Gửi, theo dõi lượt trong Studio hoặc Hàng chờ, rồi phát clip mới cạnh bản gốc. Video đã sửa là tệp mới trong Thư viện; bản gốc không bị ghi đè.",
        },
      },
    ],
    success: {
      en: "A new edited clip plays in the app, appears in Library, and your original MP4 is unchanged.",
      vi: "Clip mới đã sửa phát được trong app, có trong Thư viện và tệp MP4 gốc của bạn vẫn nguyên vẹn.",
    },
    troubleshoot: [
      {
        q: { en: "The app refuses my file. Why?", vi: "App không nhận tệp của tôi, vì sao?" },
        a: {
          en: "Edit video takes MP4 files only. Convert other formats to MP4 first, and keep the clip short; a very large file can take longer to send.",
          vi: "Sửa video chỉ nhận tệp MP4. Hãy đổi định dạng khác sang MP4 trước và giữ clip ngắn; tệp quá lớn sẽ gửi lâu hơn.",
        },
      },
      {
        q: { en: "Is editing the same as extending?", vi: "Sửa video có giống kéo dài không?" },
        a: {
          en: "No. Editing changes a clip you attach and returns a new clip. Extending continues a Muse video from Library and returns one longer video; see Extend a video.",
          vi: "Không. Sửa video thay đổi clip bạn đính kèm và trả về clip mới. Kéo dài nối tiếp một video Muse trong Thư viện và trả về một video dài hơn; xem bài Kéo dài video.",
        },
      },
      {
        q: { en: "The result changed more than I asked.", vi: "Kết quả đổi nhiều hơn tôi muốn." },
        a: {
          en: "Ask for one change at a time and say what must stay the same. Muse decides the final look, so compare before you use the new clip.",
          vi: "Mỗi lần chỉ yêu cầu một thay đổi và ghi rõ phần cần giữ. Muse quyết định hình ảnh cuối cùng, nên hãy so sánh trước khi dùng clip mới.",
        },
      },
    ],
    related: ["create-video", "extend-video", "reference-files", "library"],
    appRoute: "/studio",
    updated: "2026-11-03",
  },
  {
    slug: "ask-and-research",
    chapter: "studio",
    order: 4,
    title: { en: "Ask and research", vi: "Hỏi đáp và tìm hiểu tài liệu" },
    summary: {
      en: "Ask Muse a question or attach research files in Studio, then read the answer and continue the same conversation.",
      vi: "Đặt câu hỏi hoặc đính kèm tài liệu trong Studio, đọc câu trả lời của Muse rồi hỏi tiếp trong cùng hội thoại.",
    },
    before: [
      {
        en: "Have a ready Muse account and check that Ask is available.",
        vi: "Có tài khoản Muse sẵn sàng và kiểm tra chế độ Hỏi đáp dùng được.",
      },
      {
        en: "Prepare a clear question and any files you have permission to share with Muse.",
        vi: "Chuẩn bị câu hỏi rõ ràng và tài liệu bạn được phép gửi cho Muse.",
      },
      {
        en: "Consider a separate account for research because jobs on one account share its Muse memory.",
        vi: "Cân nhắc tài khoản riêng cho nghiên cứu vì các lượt trên cùng tài khoản dùng chung bộ nhớ Muse.",
      },
    ],
    steps: [
      {
        title: { en: "1. Choose Ask", vi: "1. Chọn Hỏi đáp" },
        body: {
          en: `Open Studio in ${FACTS.productName} and select Ask. Choose the account you want to use for this conversation.`,
          vi: `Mở Studio trong ${FACTS.productName}, chọn Hỏi đáp rồi chọn tài khoản bạn muốn dùng cho hội thoại này.`,
        },
        shot: "studio-ask",
      },
      {
        title: { en: "2. Give context and attach files", vi: "2. Nêu bối cảnh và thêm tệp" },
        body: {
          en: "Explain the task and the format you need. For example, ask for a short summary of a sales report. Attach relevant files and check their names before sending.",
          vi: "Nêu công việc và cách trình bày bạn cần. Ví dụ, nhờ tóm tắt ngắn báo cáo bán hàng. Đính kèm tài liệu liên quan và kiểm tra tên tệp trước khi gửi.",
        },
      },
      {
        title: { en: "3. Send and read the answer", vi: "3. Gửi và đọc câu trả lời" },
        body: {
          en: "Send once and wait for the answer, which opens as an article. Check important claims against your source material before using them.",
          vi: "Gửi một lần rồi chờ câu trả lời được trình bày dạng bài viết. Đối chiếu thông tin quan trọng với tài liệu gốc trước khi sử dụng.",
        },
      },
      {
        title: { en: "4. Continue or start fresh", vi: "4. Hỏi tiếp hoặc bắt đầu mới" },
        body: {
          en: "Use the conversation continuation option for a follow-up. A conversation stays on the account that created it. Choose a new conversation when you want a separate thread.",
          vi: "Dùng tuỳ chọn tiếp hội thoại để hỏi thêm. Hội thoại chỉ chạy trên tài khoản đã tạo ra nó. Chọn Hỏi trong hội thoại mới khi muốn tách sang luồng khác.",
        },
      },
    ],
    success: {
      en: "You can read the answer and either continue its conversation or start a separate question.",
      vi: "Bạn đọc được câu trả lời và có thể hỏi tiếp trong hội thoại đó hoặc bắt đầu câu hỏi riêng.",
    },
    troubleshoot: [
      {
        q: {
          en: "Why can I not switch accounts for a follow-up?",
          vi: "Vì sao tôi không đổi được tài khoản khi hỏi tiếp?",
        },
        a: {
          en: "The conversation belongs to its original Muse account. Start a new conversation to use another account.",
          vi: "Hội thoại thuộc tài khoản Muse đã tạo ra nó. Hãy bắt đầu hội thoại mới nếu muốn dùng tài khoản khác.",
        },
      },
      {
        q: {
          en: "A file was refused. What should I check?",
          vi: "Tệp bị từ chối thì cần kiểm tra gì?",
        },
        a: {
          en: "Read the attachment warning and check the file type, size, and total attachments. A refused file is not included just because it was dropped into Studio.",
          vi: "Đọc cảnh báo đính kèm, kiểm tra loại tệp, dung lượng và tổng số tệp. Tệp bị từ chối sẽ không được gửi chỉ vì bạn đã thả vào Studio.",
        },
      },
    ],
    related: ["reference-files", "accounts-and-limits", "privacy-and-data"],
    appRoute: "/studio",
    updated: "2026-11-02",
  },
  {
    slug: "reference-files",
    chapter: "studio",
    order: 5,
    title: { en: "Use reference files", vi: "Dùng tệp tham chiếu" },
    summary: {
      en: "Attach reference images, video, or research files in the right Studio mode and check them before submitting a job.",
      vi: "Đính kèm ảnh tham chiếu, video hoặc tài liệu đúng chế độ trong Studio và kiểm tra tệp trước khi gửi yêu cầu.",
    },
    before: [
      {
        en: "Have local files you have permission to send to Muse.",
        vi: "Chuẩn bị tệp trên máy mà bạn được phép gửi cho Muse.",
      },
      {
        en: "Have a ready account and decide whether you want image editing, video work, or questions about files.",
        vi: "Có tài khoản sẵn sàng và xác định bạn muốn sửa ảnh, làm video hay hỏi về tài liệu.",
      },
    ],
    steps: [
      {
        title: { en: "1. Choose the right mode", vi: "1. Chọn đúng chế độ" },
        body: {
          en: `In ${FACTS.productName} Studio, use Image for image editing, Video for video requests, or Ask for questions about documents. Select an editing mode when working from an existing image or MP4.`,
          vi: `Trong Studio của ${FACTS.productName}, chọn Ảnh để sửa ảnh, Video để làm video hoặc Hỏi đáp để hỏi về tài liệu. Chọn chế độ sửa phù hợp khi dùng ảnh hoặc MP4 có sẵn.`,
        },
      },
      {
        title: { en: "2. Attach the files", vi: "2. Đính kèm tệp" },
        body: {
          en: "Use the attachment control to choose reference images. For video editing, use the MP4 attachment action in the appropriate mode. In Ask, attach documents through its file control or drop them into Studio.",
          vi: "Dùng nút đính kèm để chọn ảnh tham chiếu. Khi sửa video, dùng Thêm video MP4 trong chế độ phù hợp. Với Hỏi đáp, dùng nút đính kèm tệp hoặc thả tài liệu vào Studio.",
        },
        shot: "studio-references",
      },
      {
        title: { en: "3. Check the attachment list", vi: "3. Kiểm tra danh sách đính kèm" },
        body: {
          en: "Check every thumbnail or filename and remove anything unrelated. Follow any size, count, or support warning. Do not assume all files from a multi-file drop were attached.",
          vi: "Kiểm tra từng ảnh thu nhỏ hoặc tên tệp, rồi bỏ tệp không liên quan. Làm theo cảnh báo về dung lượng, số lượng hoặc khả năng hỗ trợ. Đừng mặc định mọi tệp thả cùng lúc đều đã được đính kèm.",
        },
      },
      {
        title: { en: "4. Explain how to use them", vi: "4. Nói rõ cách dùng tệp" },
        body: {
          en: "Describe what should stay, what should change, or which question the files should answer. Send once, then review the result before making another request.",
          vi: "Nêu phần cần giữ, phần cần đổi hoặc câu hỏi cần trả lời từ tài liệu. Gửi một lần rồi xem kết quả trước khi tạo yêu cầu khác.",
        },
      },
    ],
    success: {
      en: "The intended files are visible in the composer before sending, and the result reflects the requested edit or question.",
      vi: "Các tệp cần dùng hiện trong ô soạn trước khi gửi, và kết quả đáp ứng yêu cầu sửa hoặc câu hỏi của bạn.",
    },
    troubleshoot: [
      {
        q: {
          en: "I dropped several images but not all appeared. Why?",
          vi: "Tôi thả nhiều ảnh nhưng không thấy đủ. Vì sao?",
        },
        a: {
          en: "Media-mode drops can select only the first matching image. Use the attachment control to add more and check the visible list before sending.",
          vi: "Khi thả tệp ở chế độ tạo ảnh hoặc video, app có thể chỉ lấy ảnh phù hợp đầu tiên. Dùng nút đính kèm để thêm và kiểm tra danh sách trước khi gửi.",
        },
      },
      {
        q: {
          en: "My MP4 was not attached when I dropped it. What now?",
          vi: "Thả MP4 nhưng tệp không được đính kèm thì làm sao?",
        },
        a: {
          en: "Choose the video-editing mode and use its MP4 attachment action. General media drops are not a substitute for that control.",
          vi: "Chọn chế độ Sửa video rồi dùng Thêm video MP4. Thả tệp vào vùng tạo ảnh hoặc video không thay thế thao tác này.",
        },
      },
      {
        q: {
          en: "Can I reuse a finished image?",
          vi: "Tôi có dùng lại ảnh đã tạo được không?",
        },
        a: {
          en: "Yes. Open the image in Library and use its reference-image action to bring it back into Studio.",
          vi: "Có. Mở ảnh trong Thư viện rồi chọn Dùng làm ảnh tham chiếu để đưa ảnh trở lại Studio.",
        },
      },
    ],
    related: ["create-image", "create-video", "ask-and-research", "library"],
    appRoute: "/studio",
    updated: "2026-11-02",
  },
];
