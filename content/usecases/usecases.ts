import type { UseCase } from "../types";
import { FACTS } from "../facts";

const l = (en: string, vi: string): UseCase["title"] => ({ en, vi });

const clipLimit = l(
  `Muse clips are about ${FACTS.media.videoSeconds} s at ${FACTS.media.videoWidth}×${FACTS.media.videoHeight}; assemble the final video in an editor such as CapCut or Remotion.`,
  `Clip Muse dài khoảng ${FACTS.media.videoSeconds} giây, độ phân giải ${FACTS.media.videoWidth}×${FACTS.media.videoHeight}; bạn ghép video hoàn chỉnh bằng CapCut hoặc Remotion.`,
);

const usageLimit = l(
  "Generation uses your own Muse account's usage limit. Review a small sample before requesting a larger batch.",
  "Việc tạo ảnh và video dùng hạn mức tài khoản Muse của bạn. Hãy duyệt một nhóm mẫu trước khi yêu cầu tạo cả loạt.",
);

const consistencyLimit = l(
  "Character and product consistency is not guaranteed. Compare every result with your references before using it.",
  "Nhân vật và sản phẩm có thể khác nhau giữa các kết quả. Hãy đối chiếu từng ảnh, clip với tài liệu tham chiếu trước khi dùng.",
);

const commercialDisclosure = l(
  "Label AI-generated content and disclose affiliate links or ads wherever applicable under the platform's rules.",
  "Gắn nhãn nội dung do AI tạo; công khai liên kết tiếp thị hoặc nội dung quảng cáo khi có, theo quy định của nền tảng.",
);

export const USE_CASE_LIST: UseCase[] = [
  {
    slug: "affiliate-videos",
    category: "sales",
    title: l(
      "Affiliate videos with clear product details",
      "Video affiliate rõ thông tin, dễ dựng lại",
    ),
    summary: l(
      "Plan affiliate videos from real product photos, then generate supporting clips for TikTok Shop edits without inventing product claims.",
      "Tạo video AI cho TikTok Shop affiliate từ ảnh sản phẩm thật, có cảnh phụ và lời giới thiệu để bạn duyệt trước khi dựng.",
    ),
    who: l(
      "TikTok Shop affiliates and creators who have checked the product themselves.",
      "Người làm TikTok Shop affiliate, KOC đã kiểm tra sản phẩm thực tế.",
    ),
    outcome: l(
      "A reviewed script, a shot list, and supporting images and clips ready for your editor.",
      "Kịch bản đã duyệt, danh sách cảnh và bộ ảnh, clip phụ để bạn đưa vào phần mềm dựng.",
    ),
    lanes: {
      you: l(
        "Provide real product photos, verified features, your experience, and the affiliate disclosure.",
        "Gửi ảnh sản phẩm thật, tính năng đã kiểm chứng, trải nghiệm của bạn và thông tin tiếp thị liên kết.",
      ),
      agent: l(
        "Draft the hook and shot list, separate verified claims from unknowns, and request approved visuals.",
        "Viết câu mở đầu, chia cảnh, tách thông tin đã kiểm chứng khỏi điều chưa rõ rồi yêu cầu tạo cảnh đã duyệt.",
      ),
      muse4ai: l(
        "Send the agent's image and video requests to your Muse account and return the generated assets.",
        "Chuyển yêu cầu tạo ảnh, video của agent tới tài khoản Muse của bạn và trả lại các tệp kết quả.",
      ),
    },
    prompt: l(
      "Use these real photos and my notes about this desk lamp to plan a TikTok Shop affiliate video. Do not invent benefits or say I tested anything outside my notes. Ask me to approve the script, then request supporting visuals through Muse4AI. Mark where the AI and affiliate disclosures belong.",
      "Dựa vào ảnh thật và ghi chú của tôi về đèn bàn này, lên kịch bản video TikTok Shop affiliate. Không tự thêm công dụng hay trải nghiệm dùng thử. Cho tôi duyệt kịch bản rồi mới nhờ Muse4AI tạo cảnh phụ. Đánh dấu chỗ cần ghi nhãn AI và thông báo tiếp thị liên kết.",
    ),
    media: ["uc-affiliate-videos-1", "uc-affiliate-videos-2"],
    limits: [clipLimit, usageLimit, consistencyLimit],
    docs: ["reference-files", "create-video", "library"],
    related: ["product-photos", "sales-videos", "short-ads"],
    disclosure: commercialDisclosure,
    featured: true,
    rank: 1,
  },
  {
    slug: "product-photos",
    category: "sales",
    title: l("Product photos for a consistent shop set", "Bộ ảnh sản phẩm cho shop online"),
    summary: l(
      "Create AI product photo concepts from real references, then check shape, color, and packaging before using them in your shop.",
      "Tạo ảnh sản phẩm AI từ ảnh thật để thử bối cảnh cho shop Shopee; kiểm tra màu, hình dáng và bao bì trước khi đăng bán.",
    ),
    who: l(
      "Shopee sellers and small shop teams preparing product listings.",
      "Chủ shop Shopee và nhóm bán hàng cần chuẩn bị ảnh đăng sản phẩm.",
    ),
    outcome: l(
      "A reviewed set of product scene concepts, with unsuitable variations removed.",
      "Bộ ảnh bối cảnh sản phẩm đã duyệt, loại bỏ những ảnh làm sai đặc điểm hàng thật.",
    ),
    lanes: {
      you: l(
        "Supply clear product photos and identify details that must not change.",
        "Gửi ảnh rõ sản phẩm và chỉ ra những chi tiết không được thay đổi.",
      ),
      agent: l(
        "Propose backgrounds and lighting, request image variations, and organize them for comparison.",
        "Đề xuất nền, ánh sáng, yêu cầu tạo các phương án ảnh và sắp xếp để bạn đối chiếu.",
      ),
      muse4ai: l(
        "Pass image prompts and references to Muse and return generated scene variations.",
        "Gửi lời nhắc và ảnh tham chiếu tới Muse, trả lại các phương án bối cảnh được tạo.",
      ),
    },
    prompt: l(
      "Use these photos of my ceramic mug to propose clean listing backgrounds. Keep its handle, glaze color, and proportions as reference requirements. Create a small sample through Muse4AI for my review. Do not add labels or imply that the generated images are real product photographs.",
      "Dùng ảnh chiếc cốc gốm này để đề xuất nền đăng bán trên Shopee. Lấy quai cốc, màu men và tỷ lệ làm yêu cầu tham chiếu. Nhờ Muse4AI tạo một nhóm mẫu nhỏ để tôi kiểm tra. Không thêm nhãn hay giới thiệu ảnh tạo ra là ảnh chụp sản phẩm thật.",
    ),
    media: ["uc-product-photos-1", "uc-product-photos-2"],
    limits: [
      usageLimit,
      consistencyLimit,
      l(
        "Inspect dimensions, materials, labels, and included accessories; generated images must not misrepresent what buyers receive.",
        "Kiểm tra kích thước, chất liệu, nhãn và phụ kiện; ảnh tạo ra không được khiến khách hiểu sai về hàng sẽ nhận.",
      ),
    ],
    docs: ["create-image", "reference-files", "batches"],
    related: ["affiliate-videos", "restaurant-menus", "sales-videos"],
    disclosure: commercialDisclosure,
    featured: true,
    rank: 2,
  },
  {
    slug: "lesson-videos",
    category: "education",
    title: l("Lesson videos with reviewed illustrations", "Video bài giảng có minh hoạ dễ hiểu"),
    summary: l(
      "Prepare lesson videos with AI illustrations and short opening clips, while keeping explanations and classroom examples under teacher review.",
      "Làm video bài giảng với ảnh minh hoạ và clip mở bài cho giáo viên THCS; bạn kiểm tra kiến thức trước khi đưa vào bài giảng điện tử.",
    ),
    who: l(
      "Middle school teachers and tutors preparing visual explanations.",
      "Giáo viên THCS và gia sư cần hình ảnh để giải thích bài học.",
    ),
    outcome: l(
      "A lesson outline, reviewed illustrations, and short clips to insert into your teaching materials.",
      "Dàn ý bài học, ảnh minh hoạ đã kiểm tra và clip ngắn để chèn vào học liệu.",
    ),
    lanes: {
      you: l(
        "Provide the learning objective, grade level, approved source material, and likely misconceptions.",
        "Gửi mục tiêu bài học, khối lớp, tài liệu được phép dùng và những chỗ học sinh hay hiểu sai.",
      ),
      agent: l(
        "Break the concept into scenes, draft narration, and request visuals after you approve the explanation.",
        "Chia kiến thức thành từng cảnh, soạn lời dẫn và yêu cầu tạo hình sau khi bạn duyệt cách giải thích.",
      ),
      muse4ai: l(
        "Generate illustrative images and short clips through Muse for your lesson.",
        "Tạo ảnh minh hoạ và clip ngắn qua Muse để bạn dùng trong bài giảng.",
      ),
    },
    prompt: l(
      "Help me plan a lesson video about the water cycle for middle school students. Use my attached lesson notes, flag any uncertain explanation, and propose illustrative scenes. After I approve, ask Muse4AI for visuals without embedded labels; I will add accurate labels in my slides.",
      "Giúp tôi soạn video bài giảng về vòng tuần hoàn nước cho học sinh THCS. Bám theo giáo án đính kèm, đánh dấu chỗ chưa chắc và đề xuất cảnh minh hoạ. Sau khi tôi duyệt, nhờ Muse4AI tạo hình không có chữ; tôi sẽ thêm nhãn chính xác trong slide.",
    ),
    media: ["uc-lesson-videos-1", "uc-lesson-videos-2"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Check every explanation against your teaching sources. AI illustrations are not scientific evidence or historical records.",
        "Đối chiếu mọi lời giải thích với tài liệu dạy học. Hình AI không phải bằng chứng khoa học hay tư liệu lịch sử.",
      ),
    ],
    docs: ["ask-and-research", "reference-files", "create-video"],
    related: ["ngo-explainers", "storyboards", "research-to-visuals"],
    featured: true,
    rank: 3,
  },
  {
    slug: "short-ads",
    category: "sales",
    title: l("Short ads built from approved scenes", "Video quảng cáo ngắn từ cảnh đã duyệt"),
    summary: l(
      "Create short AI ad concepts with separate hooks, product scenes, and closing shots, then assemble approved clips in your editor.",
      "Tạo video quảng cáo bằng AI với câu mở đầu, cảnh sản phẩm và cảnh kết riêng; duyệt nội dung rồi ghép clip trong CapCut.",
    ),
    who: l(
      "Marketers and small businesses testing creative directions for paid ads.",
      "Nhân viên marketing và doanh nghiệp nhỏ muốn thử hướng hình ảnh cho quảng cáo.",
    ),
    outcome: l(
      "Alternative ad scripts and approved scene assets for an edited short ad.",
      "Các phương án kịch bản quảng cáo và tư liệu từng cảnh đã duyệt để dựng video ngắn.",
    ),
    lanes: {
      you: l(
        "Set the audience, offer, approved claims, brand references, and platform requirements.",
        "Nêu người xem, ưu đãi, thông tin được phép quảng cáo, mẫu thương hiệu và yêu cầu nền tảng.",
      ),
      agent: l(
        "Draft distinct hooks and shot plans, then request visuals only for the direction you select.",
        "Viết các câu mở đầu và phương án chia cảnh, chỉ yêu cầu tạo hình cho hướng bạn chọn.",
      ),
      muse4ai: l(
        "Generate short scene clips and supporting images through your Muse account.",
        "Tạo clip từng cảnh và ảnh bổ trợ qua tài khoản Muse của bạn.",
      ),
    },
    prompt: l(
      "Plan a short ad for our reusable lunch box using these approved product claims. Offer two different hooks without inventing testimonials. Let me choose a direction before requesting clips through Muse4AI. Leave price, captions, and the ad disclosure for the final edit.",
      "Lên video quảng cáo ngắn cho hộp cơm dùng nhiều lần, chỉ dùng các thông tin sản phẩm tôi gửi. Đề xuất hai câu mở đầu, không bịa lời khách hàng. Đợi tôi chọn hướng rồi mới nhờ Muse4AI tạo clip. Giá, phụ đề và nhãn quảng cáo sẽ thêm khi dựng.",
    ),
    media: ["uc-short-ads-1", "uc-short-ads-2"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Review claims and platform ad policies yourself. Product details may drift, and ad approval is not guaranteed.",
        "Bạn cần tự kiểm tra lời quảng cáo và chính sách nền tảng. Chi tiết sản phẩm có thể sai lệch; không bảo đảm quảng cáo được duyệt.",
      ),
    ],
    docs: ["create-video", "reference-files", "queue"],
    related: ["affiliate-videos", "sales-videos", "social-campaigns"],
    disclosure: commercialDisclosure,
    featured: true,
    rank: 4,
  },
  {
    slug: "sales-videos",
    category: "sales",
    title: l("Sales videos with offers you can verify", "Video bán hàng dùng giá và ưu đãi thật"),
    summary: l(
      "Build sales videos from your current prices, offer terms, and real product references, with AI clips reserved for supporting scenes.",
      "Tạo video AI bán hàng từ giá và điều kiện ưu đãi bạn cung cấp; dùng ảnh thật làm tham chiếu và clip AI cho cảnh minh hoạ.",
    ),
    who: l(
      "Shop owners preparing product launches, seasonal offers, or store updates.",
      "Chủ shop chuẩn bị giới thiệu sản phẩm, ưu đãi theo mùa hoặc thông báo bán hàng.",
    ),
    outcome: l(
      "A sales script tied to your verified offer and supporting visuals for the final edit.",
      "Kịch bản bán hàng bám đúng ưu đãi đã xác nhận và bộ hình minh hoạ để dựng.",
    ),
    lanes: {
      you: l(
        "Supply current prices, stock information, offer dates, and real product references.",
        "Gửi giá hiện tại, tình trạng hàng, thời gian ưu đãi và ảnh sản phẩm thật.",
      ),
      agent: l(
        "Draft the offer clearly, flag missing terms, and plan supporting scenes without invented urgency.",
        "Viết ưu đãi rõ ràng, hỏi điều kiện còn thiếu và chia cảnh mà không bịa lý do thúc giục mua.",
      ),
      muse4ai: l(
        "Produce requested illustrative images and short clips through Muse.",
        "Tạo ảnh minh hoạ và clip ngắn theo yêu cầu qua Muse.",
      ),
    },
    prompt: l(
      "Turn this approved price list and offer note into a sales video plan for my shop. Ask about missing dates or conditions instead of guessing. After I approve the script, request supporting visuals through Muse4AI. Keep prices as editable text for my editor.",
      "Dựa vào bảng giá và nội dung ưu đãi đã duyệt này, lên video bán hàng cho shop. Nếu thiếu ngày áp dụng hay điều kiện thì hỏi lại, đừng đoán. Đợi tôi duyệt kịch bản rồi nhờ Muse4AI tạo cảnh minh hoạ. Để giá ở dạng chữ có thể sửa khi dựng.",
    ),
    media: ["uc-sales-videos-1", "uc-sales-videos-2"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Verify prices, stock, dates, and claims before publishing. Generated products may differ from the real item.",
        "Kiểm tra giá, tồn kho, ngày áp dụng và công dụng trước khi đăng. Sản phẩm tạo bằng AI có thể khác hàng thật.",
      ),
    ],
    docs: ["reference-files", "create-video", "library"],
    related: ["affiliate-videos", "product-photos", "short-ads"],
    disclosure: commercialDisclosure,
    featured: true,
    rank: 5,
  },
  {
    slug: "remotion-broll",
    category: "dev",
    title: l("B-roll for agent-built Remotion videos", "B-roll cho video dựng bằng Remotion"),
    summary: l(
      "Have your agent build a Remotion composition and request B-roll clips or images through Muse4AI, keeping timing and captions editable.",
      "Nhờ agent dựng bố cục Remotion rồi lấy B-roll và ảnh qua Muse4AI; giữ thời lượng cảnh, phụ đề và lớp chữ ở dạng dễ chỉnh sửa.",
    ),
    who: l(
      "Editors and developers using a coding agent to build videos in [Remotion](https://www.remotion.dev).",
      "Người dựng video và lập trình viên dùng coding agent để làm video bằng [Remotion](https://www.remotion.dev).",
    ),
    outcome: l(
      "A Remotion composition built by your agent, with generated assets placed into planned scenes.",
      "Bố cục Remotion do agent xây dựng, có ảnh và clip được đặt vào các cảnh đã lên kế hoạch.",
    ),
    lanes: {
      you: l(
        "Provide the brief, approved script, brand assets, and access to your Remotion project.",
        "Gửi yêu cầu, kịch bản đã duyệt, tư liệu thương hiệu và dự án Remotion để agent làm việc.",
      ),
      agent: l(
        "Use Claude Code with Remotion's Agent Skills, for example, to build the composition, request B-roll, and place returned files on the timeline.",
        "Chẳng hạn, dùng Claude Code cùng Agent Skills của Remotion để dựng bố cục, yêu cầu B-roll và đưa tệp nhận được vào dòng thời gian.",
      ),
      muse4ai: l(
        "Generate the requested clips and images through Muse; composition code and rendering stay with the agent and Remotion.",
        "Tạo clip và ảnh theo yêu cầu qua Muse; phần mã bố cục và kết xuất do agent cùng Remotion xử lý.",
      ),
    },
    prompt: l(
      "Use Remotion's Agent Skills to build a composition from this approved script. Show me the scene plan first. Ask Muse4AI for B-roll clips and images only where needed, then place the returned assets in the composition. Keep captions editable and flag missing assets rather than inventing file paths.",
      "Dùng Agent Skills của Remotion để dựng bố cục từ kịch bản đã duyệt này. Cho tôi xem kế hoạch cảnh trước. Chỉ nhờ Muse4AI tạo B-roll và ảnh ở chỗ cần thiết, rồi đưa tệp nhận được vào bố cục. Giữ phụ đề dễ sửa; báo tệp còn thiếu, không tự bịa đường dẫn.",
    ),
    media: ["uc-remotion-broll-1", "uc-remotion-broll-2"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Muse4AI does not build or render Remotion compositions. Your agent needs a working Remotion project and must check asset paths and timing.",
        "Muse4AI không dựng hay kết xuất bố cục Remotion. Agent cần dự án Remotion hoạt động được và phải kiểm tra đường dẫn tệp, nhịp cảnh.",
      ),
    ],
    docs: ["agent-skill", "create-video", "mcp-tools"],
    related: ["storyboards", "realistic-broll", "data-report-videos"],
    featured: true,
    rank: 6,
  },
  {
    slug: "storyboards",
    category: "creators",
    title: l("Storyboards to review before production", "Storyboard để duyệt ý tưởng trước khi quay"),
    summary: l(
      "Use an AI storyboard workflow to turn a script into shot references and rough motion tests before committing to production.",
      "Làm storyboard bằng AI từ kịch bản, tạo khung hình tham chiếu và clip thử chuyển động để cả nhóm duyệt ý tưởng trước khi quay.",
    ),
    who: l(
      "Directors, freelance editors, and agency teams discussing a script with clients.",
      "Đạo diễn, người dựng tự do và nhóm agency cần trao đổi kịch bản với khách hàng.",
    ),
    outcome: l(
      "A shot-by-shot storyboard and selected motion studies for a rough animatic.",
      "Storyboard theo từng cảnh và một số clip thử để ghép bản phác chuyển động.",
    ),
    lanes: {
      you: l(
        "Provide the script, visual references, required shots, and production constraints.",
        "Gửi kịch bản, mẫu hình ảnh, cảnh bắt buộc và điều kiện sản xuất.",
      ),
      agent: l(
        "Number shots, describe framing and movement, and request images before selected video tests.",
        "Đánh số cảnh, mô tả khung hình và chuyển động, yêu cầu tạo ảnh trước rồi mới thử clip cho cảnh đã chọn.",
      ),
      muse4ai: l(
        "Generate storyboard frames and short motion studies through Muse.",
        "Tạo khung hình storyboard và clip thử chuyển động qua Muse.",
      ),
    },
    prompt: l(
      "Break this café ad script into a storyboard with framing, action, and transition notes. Ask me to approve the shot list, then request draft frames through Muse4AI. Only test motion for the selected shots. Label the result as a concept, not finished production footage.",
      "Chia kịch bản quảng cáo quán cà phê này thành storyboard, ghi khung hình, hành động và cách chuyển cảnh. Cho tôi duyệt danh sách rồi nhờ Muse4AI tạo ảnh phác. Chỉ thử chuyển động ở cảnh được chọn. Ghi rõ đây là bản ý tưởng, không phải tư liệu quay hoàn chỉnh.",
    ),
    media: ["uc-storyboards-1", "uc-storyboards-2"],
    limits: [
      clipLimit,
      usageLimit,
      consistencyLimit,
      l(
        "Treat frames as concept references, not exact promises of camera movement, blocking, or final production quality.",
        "Dùng khung hình để trao đổi ý tưởng, không xem đó là cam kết chính xác về máy quay, diễn xuất hay chất lượng bản cuối.",
      ),
    ],
    docs: ["create-image", "create-video", "reference-files"],
    related: ["remotion-broll", "short-ads", "realistic-broll"],
    featured: true,
    rank: 7,
  },
  {
    slug: "data-report-videos",
    category: "office",
    title: l("Report videos with charts from your data", "Video báo cáo dùng biểu đồ từ dữ liệu thật"),
    summary: l(
      "Turn a sales spreadsheet into a data-report video plan, with charts made in a chart tool and AI visuals used only as supporting scenes.",
      "Biến file Excel doanh số thành kịch bản video báo cáo; biểu đồ lấy từ công cụ vẽ, còn ảnh và clip AI chỉ dùng làm nền minh hoạ.",
    ),
    who: l(
      "Office teams presenting monthly sales, operations, or project results.",
      "Nhân viên văn phòng báo cáo doanh số, vận hành hoặc kết quả dự án hằng tháng.",
    ),
    outcome: l(
      "A checked narration outline, chart assets made from your data, and separate illustrative scene assets.",
      "Dàn ý lời dẫn đã kiểm tra, biểu đồ vẽ từ dữ liệu của bạn và bộ cảnh minh hoạ tách riêng.",
    ),
    lanes: {
      you: l(
        "Provide a shareable spreadsheet, metric definitions, reporting period, and approved conclusions.",
        "Gửi bảng tính được phép chia sẻ, định nghĩa chỉ số, kỳ báo cáo và kết luận đã duyệt.",
      ),
      agent: l(
        "Check calculations, build charts in a chart tool, draft narration, and request only decorative visuals from Muse4AI.",
        "Kiểm tra phép tính, vẽ biểu đồ bằng công cụ biểu đồ, viết lời dẫn và chỉ nhờ Muse4AI tạo cảnh trang trí.",
      ),
      muse4ai: l(
        "Generate background images and transition clips through Muse, separate from all charts and numbers.",
        "Tạo ảnh nền và clip chuyển cảnh qua Muse, tách khỏi toàn bộ biểu đồ và số liệu.",
      ),
    },
    prompt: l(
      "Use this shareable sales spreadsheet to plan our monthly report video. Confirm the reporting period and totals with me. Build charts from the data in a chart tool, not in AI images. Ask Muse4AI only for neutral backgrounds and transition clips, then list what I need to assemble.",
      "Dùng file Excel doanh số được phép chia sẻ này để lên video báo cáo tháng. Xác nhận kỳ báo cáo và tổng số với tôi. Vẽ biểu đồ từ dữ liệu bằng công cụ biểu đồ, không để AI vẽ số. Chỉ nhờ Muse4AI tạo nền trung tính và clip chuyển cảnh, rồi liệt kê những phần tôi cần ghép.",
    ),
    media: ["uc-data-report-videos-1", "uc-data-report-videos-2"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Review totals, units, filters, dates, and conclusions. Remove confidential rows before sharing files with an agent or Muse.",
        "Kiểm tra tổng số, đơn vị, bộ lọc, ngày tháng và kết luận. Bỏ dữ liệu mật trước khi gửi tệp cho agent hoặc Muse.",
      ),
    ],
    docs: ["reference-files", "create-video", "library"],
    related: ["remotion-broll", "research-to-visuals", "hr-onboarding"],
    disclosure: l(
      "Numbers and charts must come from your data and a chart tool, never from AI pictures. Identify AI-generated illustrative backgrounds separately.",
      "Số liệu và biểu đồ phải lấy từ dữ liệu của bạn và công cụ vẽ biểu đồ, không lấy từ ảnh AI. Ghi rõ phần nền minh hoạ do AI tạo.",
    ),
    featured: true,
    rank: 8,
  },
  {
    slug: "realistic-broll",
    category: "creators",
    title: l("Realistic B-roll, clearly illustrative", "B-roll chân thật, ghi rõ là minh hoạ"),
    summary: l(
      "Generate realistic B-roll for narration gaps and abstract topics, with clear labels so illustrative scenes are not mistaken for evidence.",
      "Tạo B-roll chân thật cho đoạn lời dẫn thiếu hình và chủ đề trừu tượng; ghi rõ cảnh minh hoạ để người xem không hiểu là tư liệu thật.",
    ),
    who: l(
      "YouTubers and editors who need illustrative cutaways rather than documentary evidence.",
      "YouTuber và người dựng cần cảnh chèn minh hoạ, không phải bằng chứng tư liệu.",
    ),
    outcome: l(
      "A reviewed set of illustrative cutaways matched to specific narration passages.",
      "Bộ cảnh chèn minh hoạ đã duyệt, gắn với từng đoạn lời dẫn cụ thể.",
    ),
    lanes: {
      you: l(
        "Mark narration gaps and identify any real places or events that must not be simulated.",
        "Đánh dấu đoạn thiếu hình và những địa điểm, sự kiện thật không được mô phỏng gây hiểu nhầm.",
      ),
      agent: l(
        "Suggest generic scenes, request approved clips, and note where illustrative labels are needed.",
        "Đề xuất cảnh không gắn với sự kiện cụ thể, yêu cầu tạo clip đã duyệt và ghi chỗ cần nhãn minh hoạ.",
      ),
      muse4ai: l(
        "Generate short illustrative clips and images through your Muse account.",
        "Tạo clip minh hoạ ngắn và ảnh qua tài khoản Muse của bạn.",
      ),
    },
    prompt: l(
      "Suggest B-roll for this narration about working from home. Use generic fictional spaces, not recognizable real offices. Show me the shot list before requesting clips through Muse4AI. Mark every generated scene as illustrative and keep real interview footage separate.",
      "Đề xuất B-roll cho lời dẫn về làm việc tại nhà này. Dùng không gian hư cấu, không mô phỏng văn phòng thật dễ nhận ra. Cho tôi xem danh sách cảnh trước khi nhờ Muse4AI tạo clip. Đánh dấu mọi cảnh tạo ra là minh hoạ và tách riêng tư liệu phỏng vấn thật.",
    ),
    media: ["uc-realistic-broll-1"],
    limits: [
      clipLimit,
      usageLimit,
      consistencyLimit,
      l(
        "AI footage must not be presented as real footage of real places or events, or used as evidence that something happened.",
        "Không được giới thiệu cảnh AI là tư liệu quay thật về địa điểm, sự kiện có thật hoặc dùng làm bằng chứng một việc đã xảy ra.",
      ),
    ],
    docs: ["create-video", "queue", "library"],
    related: ["remotion-broll", "storyboards", "event-recaps"],
    featured: true,
    rank: 9,
  },
  {
    slug: "restaurant-menus",
    category: "sales",
    title: l("Menu visuals grounded in real dishes", "Ảnh menu bám đúng món quán đang bán"),
    summary: l(
      "Explore AI menu visuals from photos of your real dishes, then check portions and ingredients before adding prices in a layout tool.",
      "Tạo ảnh menu AI từ ảnh món ăn thật của quán, kiểm tra khẩu phần và nguyên liệu rồi thêm tên món, giá bằng công cụ dàn trang.",
    ),
    who: l(
      "Café and restaurant owners updating printed or delivery menus.",
      "Chủ quán ăn, quán cà phê cần cập nhật menu in hoặc menu giao hàng.",
    ),
    outcome: l(
      "Reviewed dish image concepts ready for a menu layout with editable names and prices.",
      "Bộ ảnh món ăn đã duyệt để dàn menu, với tên món và giá được thêm riêng, dễ sửa.",
    ),
    lanes: {
      you: l(
        "Photograph actual servings and provide ingredients, portion details, and current prices.",
        "Chụp khẩu phần đang bán, gửi thành phần, lượng món và giá hiện tại.",
      ),
      agent: l(
        "Suggest backgrounds and framing, request image samples, and keep menu text outside the generated image.",
        "Đề xuất nền, góc chụp, yêu cầu tạo ảnh mẫu và giữ chữ menu tách khỏi ảnh AI.",
      ),
      muse4ai: l(
        "Generate dish presentation concepts from your references through Muse.",
        "Tạo phương án trình bày món ăn từ ảnh tham chiếu qua Muse.",
      ),
    },
    prompt: l(
      "Use these photos of our actual noodle bowl to propose a clean menu image. Do not add toppings or enlarge the serving. Ask Muse4AI for a small sample first. Keep dish names and prices out of the image so I can add them in the menu layout.",
      "Dùng ảnh bát bún quán đang bán này để đề xuất ảnh menu nền gọn. Không thêm topping hay làm khẩu phần lớn hơn. Nhờ Muse4AI tạo ít ảnh mẫu trước. Không đưa tên món và giá vào ảnh để tôi thêm khi dàn menu.",
    ),
    media: ["uc-restaurant-menus-1"],
    limits: [
      usageLimit,
      consistencyLimit,
      l(
        "Check ingredients, portions, and allergen information yourself. Label AI visuals and do not misrepresent the dish customers receive.",
        "Tự kiểm tra nguyên liệu, khẩu phần và thông tin dị ứng. Gắn nhãn ảnh AI, không khiến khách hiểu sai về món thực tế.",
      ),
    ],
    docs: ["reference-files", "create-image", "library"],
    related: ["product-photos", "sales-videos"],
    featured: false,
    rank: 10,
  },
  {
    slug: "social-campaigns",
    category: "creators",
    title: l("Social campaign visuals from one brief", "Bộ hình chiến dịch từ một bản yêu cầu"),
    summary: l(
      "Plan a social campaign with related AI image concepts and supporting clips, then adapt each approved asset to its posting format.",
      "Lên bộ hình chiến dịch mạng xã hội với ảnh AI và clip bổ trợ theo một ý tưởng; duyệt từng mẫu rồi chỉnh cho từng định dạng đăng.",
    ),
    who: l(
      "Small social teams managing a launch or a themed content calendar.",
      "Nhóm nội dung nhỏ chuẩn bị ra mắt sản phẩm hoặc lịch bài theo chủ đề.",
    ),
    outcome: l(
      "A content matrix and reviewed visual assets organized by post and channel.",
      "Bảng nội dung và bộ tư liệu hình ảnh đã duyệt, chia theo bài đăng và kênh.",
    ),
    lanes: {
      you: l(
        "Set the campaign goal, audience, brand references, channels, and approved message.",
        "Nêu mục tiêu, người xem, mẫu thương hiệu, kênh đăng và thông điệp đã duyệt.",
      ),
      agent: l(
        "Map messages to posts, keep a shared visual brief, and request samples before larger batches.",
        "Chia thông điệp theo bài, giữ một bản hướng dẫn hình ảnh chung và yêu cầu mẫu trước khi tạo loạt.",
      ),
      muse4ai: l(
        "Generate requested image concepts and short scene clips through Muse.",
        "Tạo các phương án ảnh và clip ngắn theo yêu cầu qua Muse.",
      ),
    },
    prompt: l(
      "Plan a social campaign for our bookstore's reading week using this brief. Map each post to one message and propose related visual concepts. Request a small sample through Muse4AI after my approval. List cropping and text-overlay work separately for each channel.",
      "Lên chiến dịch mạng xã hội cho tuần lễ đọc sách của nhà sách theo yêu cầu này. Mỗi bài có một thông điệp và hình ảnh cùng hướng. Đợi tôi duyệt rồi nhờ Muse4AI tạo nhóm mẫu. Liệt kê riêng phần cắt khung và thêm chữ cho từng kênh.",
    ),
    media: ["uc-social-campaigns-1"],
    limits: [
      clipLimit,
      usageLimit,
      consistencyLimit,
      l(
        "Check channel dimensions and crop safety in your editor. Generation does not schedule posts or guarantee campaign results.",
        "Kiểm tra kích thước và vùng cắt trong phần mềm chỉnh sửa. Tạo hình không bao gồm lên lịch đăng hay bảo đảm hiệu quả chiến dịch.",
      ),
    ],
    docs: ["batches", "reference-files", "library"],
    related: ["short-ads", "thumbnails", "shorts-series"],
    featured: false,
    rank: 11,
  },
  {
    slug: "thumbnails",
    category: "creators",
    title: l("Thumbnail backgrounds with room for text", "Ảnh nền thumbnail có chỗ đặt chữ"),
    summary: l(
      "Create AI thumbnail background options around your video's actual topic, then add readable titles and brand elements in an editor.",
      "Tạo ảnh nền thumbnail AI bám đúng nội dung video, chừa chỗ đặt tiêu đề; thêm chữ rõ và nhận diện kênh bằng công cụ chỉnh ảnh.",
    ),
    who: l(
      "YouTube creators and editors preparing covers for published videos.",
      "Người làm YouTube và người dựng cần ảnh bìa cho video sắp đăng.",
    ),
    outcome: l(
      "Several reviewed background concepts ready for text, cropping, and final export.",
      "Một số phương án nền đã duyệt để thêm chữ, cắt khung và xuất ảnh cuối.",
    ),
    lanes: {
      you: l(
        "Provide the real topic, intended title, brand references, and any photos you have permission to use.",
        "Gửi nội dung thật, tiêu đề dự kiến, mẫu nhận diện và ảnh bạn có quyền sử dụng.",
      ),
      agent: l(
        "Suggest distinct compositions, reserve text space, and request background variations.",
        "Đề xuất các bố cục khác nhau, chừa chỗ cho chữ và yêu cầu tạo phương án nền.",
      ),
      muse4ai: l(
        "Generate background images through Muse without relying on generated lettering.",
        "Tạo ảnh nền qua Muse, không dựa vào chữ do AI vẽ trong ảnh.",
      ),
    },
    prompt: l(
      "Propose thumbnail backgrounds for my video about organizing a small desk. Keep the imagery faithful to the video and leave clear space for my title. After I choose a direction, request backgrounds through Muse4AI without text. I will add the title in my image editor.",
      "Đề xuất nền thumbnail cho video sắp xếp bàn làm việc nhỏ của tôi. Hình phải đúng nội dung video và chừa chỗ rõ để đặt tiêu đề. Đợi tôi chọn hướng rồi nhờ Muse4AI tạo nền không có chữ. Tôi sẽ thêm tiêu đề trong công cụ chỉnh ảnh.",
    ),
    media: ["uc-thumbnails-1"],
    limits: [
      usageLimit,
      consistencyLimit,
      l(
        "Add readable text in an editor and check the small-screen preview. A thumbnail does not guarantee clicks or views.",
        "Thêm chữ bằng công cụ chỉnh ảnh và xem thử ở kích thước nhỏ. Thumbnail không bảo đảm lượt nhấp hay lượt xem.",
      ),
    ],
    docs: ["create-image", "reference-files", "library"],
    related: ["social-campaigns", "shorts-series"],
    featured: false,
    rank: 12,
  },
  {
    slug: "hr-onboarding",
    category: "office",
    title: l("Onboarding visuals for real procedures", "Hình hướng dẫn nhân viên mới theo quy trình"),
    summary: l(
      "Turn approved HR procedures into an onboarding video plan, using AI illustrations for generic scenes and real screenshots for exact steps.",
      "Làm video onboarding từ quy trình nhân sự đã duyệt; dùng ảnh AI cho cảnh minh hoạ chung và ảnh màn hình thật cho thao tác cụ thể.",
    ),
    who: l(
      "HR and operations teams preparing orientation for new employees.",
      "Nhóm nhân sự và vận hành chuẩn bị tài liệu cho nhân viên mới.",
    ),
    outcome: l(
      "A reviewed onboarding outline and illustrative assets separated from real process screenshots.",
      "Dàn ý hướng dẫn đã duyệt và bộ hình minh hoạ tách riêng khỏi ảnh màn hình quy trình thật.",
    ),
    lanes: {
      you: l(
        "Provide an approved, shareable procedure and identify private information to exclude.",
        "Gửi quy trình đã duyệt, được phép chia sẻ và chỉ rõ thông tin riêng tư cần bỏ.",
      ),
      agent: l(
        "Break the procedure into steps, flag missing details, and request generic supporting visuals.",
        "Chia quy trình thành bước, đánh dấu thông tin thiếu và yêu cầu tạo hình minh hoạ chung.",
      ),
      muse4ai: l(
        "Generate illustrative workplace images and short clips through Muse.",
        "Tạo ảnh môi trường làm việc và clip minh hoạ ngắn qua Muse.",
      ),
    },
    prompt: l(
      "Turn this approved onboarding checklist into a video outline for new staff. Ask about unclear steps. Use real screenshots for software instructions and request only generic workplace illustrations through Muse4AI. Do not send employee records or confidential policies.",
      "Chuyển checklist onboarding đã duyệt này thành dàn ý video cho nhân viên mới. Hỏi lại những bước chưa rõ. Dùng ảnh màn hình thật để chỉ thao tác phần mềm; chỉ nhờ Muse4AI tạo cảnh công sở minh hoạ chung. Không gửi hồ sơ nhân viên hay chính sách mật.",
    ),
    media: ["uc-hr-onboarding-1"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "HR must verify policies and instructions. Do not use generated screens as exact software guidance or share private employee data.",
        "Nhân sự phải kiểm tra chính sách và hướng dẫn. Không dùng màn hình AI để chỉ thao tác chính xác hoặc chia sẻ dữ liệu riêng của nhân viên.",
      ),
    ],
    docs: ["reference-files", "create-video", "library"],
    related: ["data-report-videos", "lesson-videos"],
    featured: false,
    rank: 13,
  },
  {
    slug: "real-estate-clips",
    category: "sales",
    title: l("Property clips with honest visual context", "Clip bất động sản tách rõ cảnh minh hoạ"),
    summary: l(
      "Plan real-estate clips around verified listing details and real property footage, using clearly labeled AI scenes only for illustration.",
      "Lên clip bất động sản từ thông tin đã kiểm chứng và tư liệu căn nhà thật; chỉ dùng cảnh AI có nhãn rõ để minh hoạ ý tưởng.",
    ),
    who: l(
      "Property agents and editors preparing listing introductions.",
      "Môi giới và người dựng chuẩn bị video giới thiệu bất động sản.",
    ),
    outcome: l(
      "A listing video plan that separates verified property footage from illustrative concepts.",
      "Kế hoạch video tách rõ tư liệu căn nhà đã xác nhận và cảnh ý tưởng minh hoạ.",
    ),
    lanes: {
      you: l(
        "Provide current property photos, footage, verified specifications, and permission to use them.",
        "Gửi ảnh, video hiện trạng, thông số đã kiểm tra và quyền sử dụng tư liệu.",
      ),
      agent: l(
        "Build the script around real assets and request only clearly identified illustrative scenes.",
        "Viết kịch bản dựa trên tư liệu thật, chỉ yêu cầu tạo những cảnh được xác định rõ là minh hoạ.",
      ),
      muse4ai: l(
        "Generate requested concept images or atmosphere clips through Muse, not evidence of property condition.",
        "Tạo ảnh ý tưởng hoặc clip gợi không khí qua Muse, không tạo bằng chứng về hiện trạng căn nhà.",
      ),
    },
    prompt: l(
      "Plan an introduction for this apartment using my verified listing and real footage. Do not invent views, facilities, or renovations. If an illustrative opening is useful, propose it separately before requesting it through Muse4AI. Label it clearly and keep it apart from property footage.",
      "Lên video giới thiệu căn hộ từ tin đăng đã kiểm tra và tư liệu quay thật của tôi. Không tự thêm tầm nhìn, tiện ích hay hạng mục sửa chữa. Nếu cần cảnh mở đầu minh hoạ, đề xuất riêng rồi mới nhờ Muse4AI tạo. Ghi nhãn rõ và tách khỏi cảnh căn hộ thật.",
    ),
    media: ["uc-real-estate-clips-1"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "AI footage must not be presented as real footage of real places or events, including the listed property or its surroundings.",
        "Không được giới thiệu cảnh AI là tư liệu quay thật về địa điểm, sự kiện có thật, kể cả căn nhà đang bán và khu vực xung quanh.",
      ),
      l(
        "Verify dimensions, amenities, legal claims, and current condition. Generated concepts cannot replace an inspection or real listing photos.",
        "Kiểm tra diện tích, tiện ích, pháp lý và hiện trạng. Hình ý tưởng không thay thế việc xem nhà hay ảnh đăng bán thật.",
      ),
    ],
    docs: ["reference-files", "create-video", "library"],
    related: ["realistic-broll", "sales-videos", "product-photos"],
    featured: false,
    rank: 14,
  },
  {
    slug: "shorts-series",
    category: "creators",
    title: l("A Shorts series planned before batching", "Chuỗi Shorts có kế hoạch trước khi tạo loạt"),
    summary: l(
      "Plan a YouTube Shorts series with repeatable scripts and batched AI scene requests, then review each episode before editing and publishing.",
      "Lên chuỗi YouTube Shorts với mẫu kịch bản chung và tạo video AI theo đợt; kiểm tra từng tập trước khi dựng, thêm chữ và đăng.",
    ),
    who: l(
      "Creators producing recurring educational, lifestyle, or explainer shorts.",
      "Người làm nội dung sản xuất Shorts kiến thức, đời sống hoặc giải thích theo chuỗi.",
    ),
    outcome: l(
      "An episode plan, reusable scene briefs, and reviewed assets grouped by episode.",
      "Kế hoạch từng tập, mẫu yêu cầu cảnh có thể dùng lại và tư liệu đã duyệt chia theo tập.",
    ),
    lanes: {
      you: l(
        "Choose the series topic, approve episode facts, and set a manageable production batch.",
        "Chọn chủ đề chuỗi, duyệt thông tin từng tập và xác định số tập làm mỗi đợt.",
      ),
      agent: l(
        "Draft a repeatable structure, vary the examples, and request assets in small reviewed batches.",
        "Soạn cấu trúc chung, đổi ví dụ từng tập và yêu cầu tạo tư liệu theo nhóm nhỏ có duyệt.",
      ),
      muse4ai: l(
        "Generate requested scene images and short clips through Muse for each episode.",
        "Tạo ảnh từng cảnh và clip ngắn theo yêu cầu qua Muse cho từng tập.",
      ),
    },
    prompt: l(
      "Plan a Shorts series about simple desk organization. Draft a reusable episode structure and the first few episode briefs. Let me approve one pilot before requesting more assets through Muse4AI. Group results by episode and list the vertical cropping and caption work still needed.",
      "Lên chuỗi Shorts về sắp xếp bàn làm việc đơn giản. Soạn cấu trúc chung và yêu cầu cho vài tập đầu. Cho tôi duyệt một tập thử trước khi nhờ Muse4AI tạo thêm tư liệu. Chia kết quả theo tập và ghi phần còn phải cắt dọc, thêm phụ đề.",
    ),
    media: ["uc-shorts-series-1"],
    limits: [
      clipLimit,
      usageLimit,
      consistencyLimit,
      l(
        "Check facts per episode and adapt framing for vertical delivery in your editor. Muse4AI does not publish or schedule the series.",
        "Kiểm tra kiến thức từng tập và chỉnh khung dọc trong phần mềm dựng. Muse4AI không đăng hay lên lịch phát hành chuỗi.",
      ),
    ],
    docs: ["batches", "queue", "accounts-and-limits"],
    related: ["social-campaigns", "thumbnails", "lesson-videos"],
    featured: false,
    rank: 15,
  },
  {
    slug: "ngo-explainers",
    category: "education",
    title: l("NGO explainers with responsible visuals", "Video giải thích cho tổ chức phi lợi nhuận"),
    summary: l(
      "Build NGO explainer videos from approved source material, using labeled AI illustrations rather than fabricated beneficiary stories or footage.",
      "Làm video giải thích cho tổ chức phi lợi nhuận từ tài liệu đã duyệt; dùng hình AI có nhãn, không dựng chuyện hay tư liệu người thụ hưởng.",
    ),
    who: l(
      "Nonprofit communications teams and community educators.",
      "Nhóm truyền thông tổ chức phi lợi nhuận và người làm giáo dục cộng đồng.",
    ),
    outcome: l(
      "A source-checked explainer script and clearly identified illustrative assets.",
      "Kịch bản giải thích đã đối chiếu nguồn và bộ hình được ghi rõ là minh hoạ.",
    ),
    lanes: {
      you: l(
        "Provide approved sources, safeguarding rules, audience needs, and consent requirements.",
        "Gửi nguồn đã duyệt, nguyên tắc bảo vệ người liên quan, nhu cầu người xem và yêu cầu đồng ý sử dụng hình ảnh.",
      ),
      agent: l(
        "Draft plain-language explanations, retain source notes, and request respectful generic illustrations.",
        "Viết lời giải thích dễ hiểu, giữ ghi chú nguồn và yêu cầu hình minh hoạ chung, tôn trọng người được nói tới.",
      ),
      muse4ai: l(
        "Generate illustrative scenes through Muse, not documentary records or personal testimony.",
        "Tạo cảnh minh hoạ qua Muse, không tạo hồ sơ tư liệu hay lời chứng cá nhân.",
      ),
    },
    prompt: l(
      "Use these approved materials to plan an explainer about our community recycling program. Keep source notes for factual claims. Do not invent beneficiaries or quotes. After review, ask Muse4AI for respectful generic illustrations and mark them as AI-generated.",
      "Dùng tài liệu đã duyệt này để lên video giải thích chương trình tái chế cộng đồng. Giữ ghi chú nguồn cho các thông tin thực tế. Không bịa người thụ hưởng hay lời trích dẫn. Sau khi duyệt, nhờ Muse4AI tạo hình minh hoạ chung, phù hợp và có nhãn AI.",
    ),
    media: ["uc-ngo-explainers-1"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Review facts, consent, and safeguarding. Generated people or scenes must not be presented as real beneficiaries or field evidence.",
        "Kiểm tra thông tin, sự đồng ý và yêu cầu bảo vệ người liên quan. Không giới thiệu người, cảnh AI là người thụ hưởng thật hay bằng chứng thực địa.",
      ),
    ],
    docs: ["ask-and-research", "reference-files", "create-video"],
    related: ["lesson-videos", "research-to-visuals", "realistic-broll"],
    featured: false,
    rank: 16,
  },
  {
    slug: "event-recaps",
    category: "creators",
    title: l("Event recaps built around real footage", "Video tổng kết giữ tư liệu sự kiện thật"),
    summary: l(
      "Plan event recap videos around real recordings, with AI-generated opening and closing visuals kept separate from evidence of the event.",
      "Lên video tổng kết sự kiện từ tư liệu quay thật; dùng ảnh và clip AI cho cảnh mở, kết, tách rõ khỏi những gì diễn ra tại sự kiện.",
    ),
    who: l(
      "Event teams and editors assembling recaps from approved photos and recordings.",
      "Nhóm tổ chức sự kiện và người dựng làm video từ ảnh, bản quay được phép dùng.",
    ),
    outcome: l(
      "A recap structure based on real moments, with separate illustrative opening and closing assets.",
      "Bố cục tổng kết dựa trên khoảnh khắc thật, kèm tư liệu minh hoạ mở và kết tách riêng.",
    ),
    lanes: {
      you: l(
        "Provide real event assets, confirmed names and dates, and usage permissions.",
        "Gửi tư liệu sự kiện thật, tên và ngày đã xác nhận, cùng quyền sử dụng hình ảnh.",
      ),
      agent: l(
        "Arrange real highlights, verify captions against your notes, and propose separate decorative scenes.",
        "Sắp xếp điểm nhấn thật, đối chiếu chú thích với ghi chú của bạn và đề xuất riêng các cảnh trang trí.",
      ),
      muse4ai: l(
        "Generate abstract or illustrative opening and closing assets through Muse.",
        "Tạo ảnh hoặc clip mở, kết mang tính trừu tượng hay minh hoạ qua Muse.",
      ),
    },
    prompt: l(
      "Plan a recap using this approved footage from our school fair. Keep names and dates tied to my notes. Suggest an abstract opening and closing, then request them through Muse4AI after approval. Do not generate attendees, speeches, or activities that were not recorded.",
      "Lên video tổng kết từ tư liệu hội chợ trường đã duyệt này. Dùng tên và ngày đúng theo ghi chú của tôi. Đề xuất cảnh mở, kết trừu tượng rồi đợi duyệt mới nhờ Muse4AI tạo. Không tạo thêm người tham dự, bài phát biểu hay hoạt động chưa được ghi lại.",
    ),
    media: ["uc-event-recaps-1"],
    limits: [
      clipLimit,
      usageLimit,
      l(
        "Do not fabricate attendees, quotes, or event moments. Label generated scenes and never present them as real event recordings.",
        "Không bịa người tham dự, lời nói hay khoảnh khắc sự kiện. Gắn nhãn cảnh tạo bằng AI, không giới thiệu là bản quay thật tại sự kiện.",
      ),
    ],
    docs: ["reference-files", "create-video", "library"],
    related: ["realistic-broll", "social-campaigns", "storyboards"],
    featured: false,
    rank: 17,
  },
  {
    slug: "research-to-visuals",
    category: "office",
    title: l("Research notes into a visual brief", "Từ ghi chú nghiên cứu đến bản yêu cầu hình"),
    summary: l(
      "Turn research notes into a visual brief with source-linked claims, illustrative image ideas, and a review step before generating assets.",
      "Biến ghi chú nghiên cứu thành bản yêu cầu hình ảnh, gắn nguồn cho nhận định và duyệt ý tưởng minh hoạ trước khi nhờ AI tạo ảnh.",
    ),
    who: l(
      "Analysts, researchers, and office teams preparing presentations from shareable sources.",
      "Chuyên viên phân tích, người nghiên cứu và nhóm văn phòng làm thuyết trình từ nguồn được phép chia sẻ.",
    ),
    outcome: l(
      "A source-aware visual brief and reviewed illustrations, with uncertain claims clearly marked.",
      "Bản yêu cầu hình ảnh có ghi nguồn và bộ minh hoạ đã duyệt, đánh dấu rõ nhận định chưa chắc.",
    ),
    lanes: {
      you: l(
        "Provide shareable sources, the research question, and the audience's decision needs.",
        "Gửi nguồn được phép chia sẻ, câu hỏi nghiên cứu và điều người xem cần để ra quyết định.",
      ),
      agent: l(
        "Compare claims with sources, distinguish findings from hypotheses, and draft visual prompts for approval.",
        "Đối chiếu nhận định với nguồn, tách kết quả khỏi giả thuyết và soạn lời nhắc tạo hình để bạn duyệt.",
      ),
      muse4ai: l(
        "Forward approved Ask requests to Muse and generate requested illustrative images or clips.",
        "Chuyển yêu cầu Ask đã duyệt tới Muse và tạo ảnh hoặc clip minh hoạ theo yêu cầu.",
      ),
    },
    prompt: l(
      "Turn these shareable research notes into a visual brief for our team presentation. Link factual claims to the supplied sources and flag gaps. Suggest illustrations separately from data charts. After I approve, use Muse4AI for illustrative assets only, not for evidence or invented findings.",
      "Chuyển ghi chú nghiên cứu được phép chia sẻ này thành bản yêu cầu hình cho buổi thuyết trình nhóm. Gắn nhận định thực tế với nguồn tôi gửi và đánh dấu chỗ thiếu. Tách ý tưởng minh hoạ khỏi biểu đồ dữ liệu. Đợi tôi duyệt rồi dùng Muse4AI tạo hình minh hoạ, không tạo bằng chứng hay bịa kết quả.",
    ),
    media: ["uc-research-to-visuals-1"],
    limits: [
      usageLimit,
      l(
        "Verify citations and conclusions yourself. Muse does not provide access to Meta's internal data stores.",
        "Bạn cần tự kiểm tra trích dẫn và kết luận. Muse không cung cấp quyền truy cập kho dữ liệu nội bộ của Meta.",
      ),
      l(
        "AI images are illustrations, not research evidence. Build quantitative charts from verified data in a chart tool.",
        "Ảnh AI là hình minh hoạ, không phải bằng chứng nghiên cứu. Vẽ biểu đồ định lượng từ dữ liệu đã kiểm tra bằng công cụ biểu đồ.",
      ),
      l(
        "Share only permitted material. Jobs on the same Muse account share its Muse memory; use a separate account for research.",
        "Chỉ gửi tài liệu được phép chia sẻ. Các tác vụ trên cùng tài khoản dùng chung bộ nhớ Muse; nên dùng tài khoản riêng cho nghiên cứu.",
      ),
    ],
    docs: ["ask-and-research", "reference-files", "create-image"],
    related: ["data-report-videos", "lesson-videos", "ngo-explainers"],
    featured: false,
    rank: 18,
  },
];
