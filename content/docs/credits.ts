import type { DocArticle } from "../types";
import { FACTS } from "../facts";

export const DOCS_CREDITS: DocArticle[] = [
  {
    slug: "open-source",
    chapter: "credits",
    order: 1,
    title: { en: "Open source and acknowledgments", vi: "Mã nguồn mở và lời cảm ơn" },
    summary: {
      en: "See the projects behind Muse4AI, starting with muse2api, and find acknowledgments and installed license texts.",
      vi: "Xem các dự án góp phần xây dựng Muse4AI, bắt đầu từ muse2api, cùng danh sách ghi nguồn và nơi chứa giấy phép khi cài đặt.",
    },
    before: [
      {
        en: "This page explains project acknowledgments, not instructions for connecting an agent.",
        vi: "Trang này giải thích ghi nguồn dự án, không phải hướng dẫn kết nối agent.",
      },
      {
        en: `${FACTS.productName} is an independent project by Andrew Babo, not affiliated with or endorsed by Meta.`,
        vi: `${FACTS.productName} là dự án độc lập của Andrew Babo, không liên kết với Meta và không được Meta bảo chứng.`,
      },
    ],
    steps: [
      {
        title: { en: "Thank the muse2api projects first", vi: "Trước hết, cảm ơn các dự án muse2api" },
        body: {
          en: "The Muse web integration builds on work from [muse2api by czg86389-hub](https://github.com/czg86389-hub/muse2api) and [muse2api by www222fff](https://github.com/www222fff/muse2api). Thank you to their authors for the foundations used in page interaction and result handling.",
          vi: "Phần làm việc với web Muse dựa trên đóng góp từ [muse2api của czg86389-hub](https://github.com/czg86389-hub/muse2api) và [muse2api của www222fff](https://github.com/www222fff/muse2api). Cảm ơn các tác giả đã đặt nền tảng cho việc tương tác với trang và xử lý kết quả.",
        },
        shot: "settings-about",
      },
      {
        title: { en: "Read the complete acknowledgments", vi: "Xem đầy đủ danh sách ghi nguồn" },
        body: {
          en: "The complete list of libraries, fonts, tools and app components, with what each one does and its license, is on the [Open source page](/open-source). In the app, the same list also appears right below this guide.",
          vi: "Danh sách đầy đủ gồm thư viện, phông chữ, công cụ và thành phần của app, kèm vai trò và giấy phép từng mục, nằm ở [trang Mã mở](/open-source). Trong app, danh sách này còn hiện ngay bên dưới bài hướng dẫn.",
        },
      },
      {
        title: { en: "Find the installed license text", vi: "Tìm giấy phép trong bản cài" },
        body: {
          en: "Open Settings › About for the app’s acknowledgments. The muse2api license text is also shipped in the installation folder at the path below.",
          vi: "Mở Cài đặt › Giới thiệu để xem ghi nguồn trong app. Toàn văn giấy phép muse2api cũng được kèm trong thư mục cài tại đường dẫn dưới đây.",
        },
        code: {
          lang: "text",
          text: `${FACTS.installDir}\\resources\\muse2api.txt`,
        },
      },
    ],
    success: {
      en: "You can identify the upstream projects and locate their acknowledgments and shipped license text.",
      vi: "Bạn biết các dự án nền tảng và tìm được phần ghi nguồn cùng giấy phép đi kèm.",
    },
    troubleshoot: [
      {
        q: { en: "Does an acknowledgment mean a partnership?", vi: "Ghi nguồn có nghĩa là hợp tác không?" },
        a: {
          en: "No. Acknowledgments credit work used by the project; they do not imply an affiliation or endorsement.",
          vi: "Không. Ghi nguồn là ghi nhận công sức được dự án sử dụng, không có nghĩa là liên kết hay bảo chứng.",
        },
      },
      {
        q: { en: "Where is the full dependency list?", vi: "Danh sách thành phần đầy đủ ở đâu?" },
        a: {
          en: "Read the automatically rendered credits below this article. Consult each entry’s linked project and license for details.",
          vi: "Xem danh sách ghi nguồn tự hiển thị bên dưới bài này. Mở liên kết dự án và giấy phép của từng mục để biết chi tiết.",
        },
      },
    ],
    related: ["what-is-muse4ai", "privacy-and-data", "settings-overview"],
    appRoute: "/settings/about",
    updated: "2026-11-02",
  },
];
