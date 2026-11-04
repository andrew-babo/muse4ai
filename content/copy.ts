import { FACTS } from "./facts";
import type { L } from "./types";

/**
 * Website page copy and interface words (R3-CNT). Kept in content/ so the same
 * checks (translations, forbidden claims, secrets, links) cover it.
 */

const l = (en: string, vi: string): L => ({ en, vi });

export const UI = {
  skip: l("Skip to content", "Bỏ qua tới nội dung"),
  nav: {
    agents: l("AI agents", "AI agent"),
    useCases: l("Use cases", "Tình huống"),
    docs: l("Docs", "Tài liệu"),
    download: l("Download", "Tải về"),
    downloadCta: l("Download for Windows", "Tải cho Windows"),
    search: l("Search", "Tìm kiếm"),
    menu: l("Menu", "Menu"),
    close: l("Close", "Đóng"),
    language: l("Language", "Ngôn ngữ"),
    home: l("Muse4AI home", "Trang chủ Muse4AI"),
  },
  github: {
    mark: l("GitHub", "GitHub"),
    source: l("Source code", "Mã nguồn"),
    viewSource: l("View source on GitHub", "Xem mã nguồn trên GitHub"),
    issues: l("Report a problem", "Báo một lỗi"),
    stars: l("stars", "lượt theo dõi"),
    clone: l("Copy the clone command", "Chép lệnh tải code"),
    folderNote: l("Inside the repo", "Bên trong kho code"),
    licenseNote: l("MIT licensed — free to use and free to learn from.", "Giấy phép MIT — dùng thoải mái, học thoải mái."),
  },
  footer: {

    product: l("Product", "Sản phẩm"),
    docs: l("Docs", "Tài liệu"),
    agents: l("AI agents", "AI agent"),
    project: l("Project", "Dự án"),
    allAgents: l("All agents", "Tất cả agent"),
    madeBy: l("Made by Andrew Babo", "Made by Andrew Babo"),
    portfolio: l("Free, non-commercial portfolio project.", "Dự án portfolio miễn phí, phi thương mại."),
    disclaimer: l(
      "Muse4AI is independent and not affiliated with Meta, Muse or any AI agent maker. Product names belong to their owners.",
      "Muse4AI là dự án độc lập, không liên kết với Meta, Muse hay hãng AI agent nào. Tên sản phẩm thuộc về chủ sở hữu.",
    ),
  },
  search: {
    placeholder: l("Search guides, agents and use cases…", "Tìm bài hướng dẫn, agent, tình huống…"),
    empty: l("Nothing found. These pages are a good start:", "Không tìm thấy. Bạn có thể bắt đầu từ:"),
    hint: l("Type at least one word. Vietnamese works with or without accents.", "Gõ ít nhất một từ. Tiếng Việt có dấu hay không dấu đều được."),
    kinds: { doc: l("Guide", "Hướng dẫn"), agent: l("Agent", "Agent"), usecase: l("Use case", "Tình huống") },
    open: l("Open search (Ctrl K)", "Mở tìm kiếm (Ctrl K)"),
  },
  copy: l("Copy", "Sao chép"),
  copied: l("Copied", "Đã chép"),
  external: l("opens in a new tab", "mở thẻ mới"),
  onThisPage: l("On this page", "Trên trang này"),
  before: l("Before you start", "Trước khi bắt đầu"),
  steps: l("Steps", "Các bước"),
  success: l("Check it worked", "Kiểm tra thành công"),
  troubleshoot: l("If it doesn't work", "Nếu không chạy"),
  related: l("Related", "Liên quan"),
  previous: l("Previous", "Bài trước"),
  next: l("Next", "Bài sau"),
  markdown: l("Markdown for AI", "Bản Markdown cho AI"),
  updated: l("Updated", "Cập nhật"),
  zoom: l("Click to enlarge", "Bấm để phóng to"),
  shotMissing: l("Screenshot coming soon", "Ảnh chụp sẽ có sớm"),
  aiLabel: l("AI-generated", "Tạo bằng AI"),
  soundOn: l("Play with sound", "Bật tiếng"),
  themeDark: l("Switch to dark mode", "Chuyển sang giao diện tối"),
  themeLight: l("Switch to light mode", "Chuyển sang giao diện sáng"),
  soundOff: l("Mute", "Tắt tiếng"),
  promptUsed: l("Prompt sent to Muse", "Prompt đã gửi Muse (nguyên văn)"),
  playVideo: l("Play video", "Phát video"),
  readGuide: l("Read the guide", "Đọc hướng dẫn"),
  allDocs: l("All guides", "Mọi bài hướng dẫn"),
  chapter: l("Chapter", "Chương"),
  notFound: {
    title: l("This page doesn't exist", "Không có trang này"),
    body: l("The address may be mistyped, or the page moved. These are good places to continue:", "Địa chỉ có thể gõ sai hoặc trang đã đổi chỗ. Bạn có thể đi tiếp tại:"),
  },
  error: {
    title: l("This page didn't load", "Trang chưa tải được"),
    body: l("Something went wrong. Try again, or go back to the home page.", "Có lỗi xảy ra. Thử lại hoặc quay về trang chủ."),
    retry: l("Try again", "Thử lại"),
  },
  status: {
    verified: l("Tested with Muse4AI", "Đã kiểm với Muse4AI"),
    documented: l("Setup guide — not yet tested", "Có hướng dẫn — chưa kiểm"),
    later: l("Not available yet", "Chưa dùng được"),
  },
  connection: {
    local: l("On this PC", "Trên máy này"),
    public: l("Cloud app", "Ứng dụng trên mây"),
    bridge: l("Command bridge", "Cầu nối lệnh"),
  },
  filters: {
    all: l("All", "Tất cả"),
    local: l("On this PC", "Trên máy này"),
    public: l("Cloud apps", "Ứng dụng trên mây"),
    later: l("Not yet", "Chưa hỗ trợ"),
  },
  agentPage: {
    officialDocs: l("Official documentation", "Tài liệu chính hãng"),
    config: l("Configuration", "Cấu hình"),
    oneClick: l("Install in one click", "Cài bằng một lần bấm"),
    oneClickNote: l(
      "Opens the app with the server filled in. You still replace msk_YOUR_KEY with your own key there.",
      "Mở app với máy chủ đã điền sẵn. Bạn vẫn phải thay msk_YOUR_KEY bằng khoá của mình trong đó.",
    ),
    notes: l("Good to know", "Cần biết"),
    why: l("Why not yet", "Vì sao chưa được"),
    skills: l("Supports Agent Skills", "Hỗ trợ Agent Skill"),
    skillLink: l("Teach it with the Muse4AI skill", "Dạy agent bằng skill Muse4AI"),
  },
  useCasePage: {
    who: l("Who it's for", "Dành cho ai"),
    outcome: l("What you get", "Kết quả"),
    flow: l("Who does what", "Ai làm gì"),
    you: l("You", "Bạn"),
    agent: l("Your agent", "Agent của bạn"),
    bridge: l("Muse4AI", "Muse4AI"),
    prompt: l("Prompt to give your agent", "Prompt đưa cho agent"),
    samples: l("Samples made with Muse through Muse4AI", "Mẫu tạo bằng Muse qua Muse4AI"),
    samplesPending: l(
      "Samples for this use case are being made on a test account and will appear here.",
      "Mẫu cho tình huống này đang được tạo bằng tài khoản thử và sẽ hiện ở đây.",
    ),
    limits: l("Limits to keep in mind", "Giới hạn cần nhớ"),
    disclosure: l("Labeling", "Ghi nhãn"),
    guides: l("Guides you'll use", "Bài hướng dẫn cần dùng"),
    more: l("More use cases", "Tình huống khác"),
  },
  categories: {
    all: l("All", "Tất cả"),
    sales: l("Selling", "Bán hàng"),
    education: l("Teaching", "Giáo dục"),
    creators: l("Content creators", "Sáng tạo nội dung"),
    office: l("Office work", "Văn phòng"),
    dev: l("Developers", "Lập trình"),
  },
};

export const HOME = {
  eyebrow: l("Free Windows app · works with your Muse account", "Ứng dụng Windows miễn phí · dùng tài khoản Muse của bạn"),
  h1: l("Muse for AI agents", "Muse cho AI agent"),
  lead: l(
    "Tell your AI assistant what you need in plain words. It drives Muse for you — pictures, short videos, research and more — and hands the finished files back. No code, no copy-pasting between tabs.",
    "Nói với trợ lý AI điều bạn cần bằng lời thường. Trợ lý sẽ điều khiển Muse giúp bạn — làm ảnh, video ngắn, tìm hiểu thông tin và hơn thế nữa — rồi trả lại tệp đã xong. Không cần code, không phải chép qua lại giữa các tab.",
  ),
  chatYou: l("Make a clean product photo of our handmade ceramic mug for the shop page.", "Làm giúp mình ảnh sản phẩm chiếc cốc gốm thủ công để đăng lên shop nhé."),
  chatAgent: l("On it — I asked Muse. Here's your photo.", "Có ngay — mình đã nhờ Muse. Ảnh của bạn đây."),
  benefits: [
    { title: l("Just ask", "Cứ nói là được"), body: l("Write like you'd message a colleague. Your assistant turns it into the right request for Muse.", "Viết như nhắn cho đồng nghiệp. Trợ lý tự biến nó thành yêu cầu đúng cho Muse.") },
    { title: l("It does the clicking", "Trợ lý bấm thay bạn"), body: l("Pictures, clips, answers from your documents — one after another, while you get on with your day.", "Ảnh, clip, câu trả lời từ tài liệu — làm lần lượt từng việc trong khi bạn làm việc khác.") },
    { title: l("Files land on your PC", "Tệp về thẳng máy bạn"), body: l("Every result is saved in a folder you choose and shown with a picture, so nothing gets lost.", "Mọi kết quả lưu vào thư mục bạn chọn, có hình xem trước, không thất lạc.") },
  ],
  showcaseTitle: l("Real voices, music and on-screen text — made by Muse", "Có giọng nói, nhạc, chữ trên hình — Muse làm hết"),
  showcaseBody: l(
    "Every scene, voice and sound was made by Muse from a starting picture and one request; longer samples join a few Muse scenes and add captions. Hover to play with sound off; click a clip to hear it.",
    "Mọi cảnh, giọng nói và âm thanh đều do Muse làm từ một ảnh mở đầu và một câu nhờ; clip dài hơn ghép vài cảnh Muse và thêm phụ đề. Rê chuột để xem, bấm vào clip để nghe tiếng.",
  ),
  /** Home showcase: English and Vietnamese pages show different clips (made separately for each audience). */
  showcase: {
    en: [
      { media: "uc4-affiliate-en", slug: "affiliate-videos", label: "Affiliate product reviews" },
      { media: "uc4-fb-en", slug: "short-ads", label: "Facebook ads for a small shop" },
      { media: "home-en-ugc", slug: "short-ads", label: "UGC-style Facebook ads" },
      { media: "home-en-drama", slug: "shorts-series", label: "Short drama episodes" },
      { media: "home-en-lesson", slug: "lesson-videos", label: "Lessons where words appear as you speak" },
      { media: "home-en-testimonial", slug: "social-campaigns", label: "Customer stories (AI characters)" },
    ],
    vi: [
      { media: "uc4-affiliate-vi", slug: "affiliate-videos", label: "Video review affiliate" },
      { media: "uc4-fb-vi", slug: "short-ads", label: "Quảng cáo Facebook cho tiệm nhỏ" },
      { media: "home-vi-ugc", slug: "short-ads", label: "Quảng cáo Facebook kiểu UGC" },
      { media: "home-vi-drama", slug: "shorts-series", label: "Phim drama ngắn" },
      { media: "home-vi-lesson", slug: "lesson-videos", label: "Bài giảng nói tới đâu chữ hiện tới đó" },
      { media: "home-vi-testimonial", slug: "social-campaigns", label: "Chia sẻ của khách (nhân vật AI)" },
    ],
  },
  anythingTitle: l("If Muse can do it, your assistant can ask for it", "Muse làm được gì, trợ lý nhờ được nấy"),
  anythingBody: l(
    "Muse4AI doesn't limit you to a few templates. It simply lets the AI assistant you already use talk to Muse — so the list below is only a start.",
    "Muse4AI không gò bạn vào vài mẫu có sẵn. Nó chỉ mở đường cho trợ lý AI bạn đang dùng nói chuyện với Muse — nên danh sách dưới đây mới chỉ là khởi đầu.",
  ),
  logoStrip: l("Connect the AI assistant you already use", "Kết nối trợ lý AI bạn đang dùng"),
  agentsWord: l("Works with the assistant you already use", "Dùng với trợ lý AI bạn đang quen"),
  ctaHow: l("See how it works", "Xem cách hoạt động"),
  relayTitle: l("One request, start to finish", "Một yêu cầu, từ đầu đến cuối"),
  relay: {
    ask: l("Your agent asks", "Agent của bạn yêu cầu"),
    queue: l("Muse4AI runs it on your PC", "Muse4AI chạy trên máy bạn"),
    result: l("The file comes back", "Tệp kết quả trả về"),
    running: l("Running", "Đang tạo"),
    done: l("Done", "Xong"),
    jobTitle: l("Image · Account A", "Ảnh · Tài khoản A"),
    queueTitle: l("Queue", "Hàng chờ"),
    earlier: l("Earlier", "Trước đó"),
    kindImage: l("Image", "Ảnh"),
    kindVideo: l("Video", "Video"),
    caption: l(
      "The prompt and the picture are a real Muse job made through Muse4AI on a test account. The agent's call is written the way any MCP agent sends it; the job shows in the Queue and the agent gets the file.",
      "Prompt và ảnh là một lượt Muse thật, tạo qua Muse4AI bằng tài khoản thử. Lệnh của agent được viết đúng cách mọi agent MCP gửi; việc hiện trong Hàng chờ và agent nhận tệp.",
    ),
  },
  stepsTitle: l("Start in three steps", "Bắt đầu với ba bước"),
  steps: [
    {
      title: l("Install and sign in", "Cài app và đăng nhập"),
      body: l("Install Muse4AI on Windows and sign in to your own Muse account inside the app.", "Cài Muse4AI trên Windows và đăng nhập tài khoản Muse của bạn ngay trong app."),
      href: "/docs/install",
    },
    {
      title: l("Connect your agent", "Kết nối agent"),
      body: l("Create a key in Settings › API & agent and paste the ready-made setup into your agent.", "Tạo khoá trong Cài đặt › API & agent rồi dán cấu hình có sẵn vào agent."),
      href: "/docs/connect-overview",
    },
    {
      title: l("Ask in plain words", "Nhờ bằng lời thường"),
      body: l("Ask your agent for a product photo, a short clip or a research summary. Follow each job in the Queue.", "Nhờ agent tạo ảnh sản phẩm, clip ngắn hay tóm tắt tài liệu. Theo dõi từng việc trong Hàng chờ."),
      href: "/docs/queue",
    },
  ],
  agentsTitle: l("Works with the agents you already use", "Dùng được với agent bạn đang dùng"),
  agentsBody: l(
    "Any agent that can add an MCP server with a header key can connect. Each guide says whether it was tested with Muse4AI.",
    "Agent nào thêm được máy chủ MCP kèm khoá trong header đều kết nối được. Mỗi bài ghi rõ đã thử với Muse4AI hay chưa.",
  ),
  agentsAll: l("See every agent guide", "Xem mọi hướng dẫn agent"),
  useCasesTitle: l("What people make with it", "Mọi người làm được gì"),
  useCasesAll: l("All use cases", "Mọi tình huống"),
  appTitle: l("A real app, not a script", "Một app thật, không phải đoạn script"),
  appBody: l(
    "Studio for making things yourself, a Queue with pictures, Batches for long lists, a Library on your disk and several Muse accounts — in English and Vietnamese.",
    "Studio để tự tạo, Hàng chờ có hình, Hàng loạt cho danh sách dài, Thư viện trên ổ đĩa và nhiều tài khoản Muse — có tiếng Anh và tiếng Việt.",
  ),
  appLink: l("Explore the features", "Xem các tính năng"),
  honestTitle: l("Good to know before you start", "Cần biết trước khi bắt đầu"),
  honest: [
    l("Muse4AI is free. Creating images and videos uses your own Muse account's usage limit.", "Muse4AI miễn phí. Việc tạo ảnh và video dùng hạn mức tài khoản Muse của bạn."),
    l("Muse decides limits, verification and regions. The app pauses and tells you; it does not work around them.", "Muse quyết định hạn mức, xác minh và vùng hỗ trợ. App dừng lại và báo cho bạn, không tìm cách né."),
    l("Everything stays on your PC. The app has no Muse4AI account and sends nothing to its maker.", "Mọi thứ nằm trên máy bạn. App không có tài khoản Muse4AI và không gửi gì cho người làm ra nó."),
    l("Independent project, not affiliated with Meta or Muse. You are responsible for following Muse's terms.", "Dự án độc lập, không liên kết với Meta hay Muse. Bạn tự chịu trách nhiệm tuân theo điều khoản của Muse."),
  ],
  honestLink: l("Read the full disclaimer", "Đọc miễn trừ đầy đủ"),
  ossLine: l(
    "Built on open source and on ideas from the muse2api projects — every source is credited.",
    "Xây trên mã nguồn mở và ý tưởng từ các dự án muse2api — mọi nguồn đều được ghi.",
  ),
  ossLink: l("Open source & credits", "Mã mở & ghi nguồn"),
  repoTitle: l("The whole app is on GitHub", "Cả app nằm trên GitHub"),
  repoBody: l(
    "Muse4AI is a small personal project, not a company: every line of it is public. Read it, run it from source, or tell Andrew what broke.",
    "Muse4AI là một dự án cá nhân nhỏ, không phải công ty: từng dòng code đều công khai. Bạn có thể đọc, tự chạy từ code, hoặc báo cho Andrew chỗ nào hỏng.",
  ),

};

export const FEATURES = {
  h1: l("Everything Muse4AI does", "Muse4AI làm được gì"),
  lead: l(
    "One Windows app that lets you and your AI agents use Muse with order and visibility: a place to create, a queue to follow, a library on your disk.",
    "Một app Windows giúp bạn và AI agent dùng Muse có trật tự và dễ theo dõi: nơi tạo, hàng chờ để theo dõi, thư viện trên ổ đĩa.",
  ),
  items: [
    {
      id: "studio",
      title: l("Studio", "Studio"),
      body: l(
        "Make images and short videos from a description, edit a picture with references, or ask questions about your files. Answers appear as tidy articles you can copy.",
        "Tạo ảnh và video ngắn từ mô tả, sửa ảnh với ảnh tham chiếu, hay hỏi về tài liệu của bạn. Câu trả lời hiện như bài viết gọn, sao chép được.",
      ),
      shot: "studio-image",
      doc: "create-image",
    },
    {
      id: "queue",
      title: l("Queue with pictures", "Hàng chờ có hình"),
      body: l(
        "Every job — from you or an agent — shows its picture, prompt and status. Hover for a quick preview. Jobs Muse may already have received are marked for review instead of being sent twice.",
        "Mọi việc — của bạn hay của agent — hiện hình, prompt và trạng thái. Rê chuột để xem nhanh. Việc mà Muse có thể đã nhận được đánh dấu cần xem, không bị gửi hai lần.",
      ),
      shot: "queue-list",
      doc: "queue",
    },
    {
      id: "batches",
      title: l("Batches", "Hàng loạt"),
      body: l("Paste a list of prompts and let them run one after another, with pause and resume.", "Dán danh sách prompt và để chúng chạy lần lượt, có tạm dừng và chạy tiếp."),
      shot: "batch-new",
      doc: "batches",
    },
    {
      id: "library",
      title: l("Library on your disk", "Thư viện trên ổ đĩa"),
      body: l("Finished files are saved in a folder you choose, sorted by month and batch. Search, preview and reuse an image as a new reference.", "Tệp hoàn chỉnh lưu trong thư mục bạn chọn, chia theo tháng và lô. Tìm, xem và dùng lại ảnh làm tham chiếu mới."),
      shot: "library-grid",
      doc: "library",
    },
    {
      id: "accounts",
      title: l("Several Muse accounts", "Nhiều tài khoản Muse"),
      body: l(
        "Add more than one Muse account, each with its own proxy. See the usage each account has left, and set how many jobs each may run at once.",
        "Thêm nhiều tài khoản Muse, mỗi tài khoản một proxy riêng. Xem hạn mức còn lại và đặt số việc mỗi tài khoản được chạy cùng lúc.",
      ),
      shot: "accounts-list",
      doc: "accounts-and-limits",
    },
    {
      id: "agents",
      title: l("MCP and REST for agents", "MCP và REST cho agent"),
      body: l(
        `Eight MCP tools and a REST API on your PC at port ${FACTS.apiDefaultPort}. Each agent gets its own key; status-only keys can watch without creating.`,
        `Tám công cụ MCP và REST API trên máy bạn ở cổng ${FACTS.apiDefaultPort}. Mỗi agent có khoá riêng; khoá chỉ xem trạng thái thì không tạo được.`,
      ),
      shot: "settings-api",
      doc: "connect-overview",
    },
    {
      id: "remote",
      title: l("Remote access when you need it", "Truy cập từ xa khi cần"),
      body: l(
        "Cloud agents such as Claude on the web can reach your PC through a tunnel or your own HTTPS domain. Off by default; keys are always required.",
        "Agent trên mây như Claude bản web có thể gọi tới máy bạn qua tunnel hoặc tên miền HTTPS riêng. Mặc định tắt; luôn cần khoá.",
      ),
      shot: "settings-remote",
      doc: "remote-access",
    },
    {
      id: "languages",
      title: l("English and Vietnamese", "Tiếng Anh và tiếng Việt"),
      body: l(
        "The whole app, its notifications, the installer and replies to agents come in both languages. English is the default; switch any time.",
        "Toàn bộ app, thông báo, bộ cài và phản hồi cho agent đều có hai ngôn ngữ. Mặc định tiếng Anh; đổi lúc nào cũng được.",
      ),
      shot: "settings-general",
      doc: "settings-overview",
    },
  ],
};

export const HOW = {
  h1: l("How Muse4AI works", "Muse4AI hoạt động thế nào"),
  lead: l(
    "Three parts, all of them yours: your AI agent, the Muse4AI app on your Windows PC, and your Muse account.",
    "Ba phần, đều là của bạn: AI agent, app Muse4AI trên máy Windows và tài khoản Muse của bạn.",
  ),
  parts: [
    {
      title: l("Your AI agent", "AI agent của bạn"),
      body: l(
        "Claude Code, Codex, Cursor or another agent decides what to make and sends a request with its own key, through MCP or REST.",
        "Claude Code, Codex, Cursor hay agent khác quyết định cần tạo gì và gửi yêu cầu kèm khoá riêng, qua MCP hoặc REST.",
      ),
    },
    {
      title: l("Muse4AI on your PC", "Muse4AI trên máy bạn"),
      body: l(
        "The app checks the key, puts the request in the Queue, picks a ready Muse account, sends it once and saves the result to your Library.",
        "App kiểm khoá, đưa yêu cầu vào Hàng chờ, chọn tài khoản Muse sẵn sàng, gửi đúng một lần và lưu kết quả vào Thư viện.",
      ),
    },
    {
      title: l("Your Muse account", "Tài khoản Muse của bạn"),
      body: l(
        "Muse makes the image, video or answer under your account and its usage limit, through the proxy you set for that account.",
        "Muse tạo ảnh, video hay câu trả lời bằng tài khoản và hạn mức của bạn, qua proxy bạn đặt cho tài khoản đó.",
      ),
    },
  ],
  dataTitle: l("Where your data lives", "Dữ liệu của bạn nằm ở đâu"),
  data: [
    l(`Accounts, settings, the Queue and Library records stay in ${FACTS.dataDir} on your PC.`, `Tài khoản, cài đặt, Hàng chờ và thông tin Thư viện nằm ở ${FACTS.dataDir} trên máy bạn.`),
    l("Finished files go to the library folder you choose.", "Tệp hoàn chỉnh nằm trong thư mục thư viện bạn chọn."),
    l("You sign in to Muse yourself; the app keeps the session, not your password.", "Bạn tự đăng nhập Muse; app giữ phiên đăng nhập, không giữ mật khẩu."),
    l("API keys are stored only as a fingerprint (hash); the full key is shown once when you create it.", "Khoá API chỉ được lưu dạng dấu vân tay (hash); khoá đầy đủ chỉ hiện một lần lúc tạo."),
  ],
  rulesTitle: l("Rules that keep jobs safe", "Các luật giữ cho việc an toàn"),
  rules: [
    l("Each request carries its own ID, so a retry after a dropped connection does not create a second job.", "Mỗi yêu cầu có mã riêng, nên thử lại sau khi rớt mạng không tạo việc thứ hai."),
    l("If the app cannot tell whether Muse received a job, it marks it for review instead of sending it again.", "Nếu app không chắc Muse đã nhận việc, app đánh dấu cần xem thay vì gửi lại."),
    l("When Muse asks for verification, reports a limit or an unsupported region, the account pauses until you act.", "Khi Muse yêu cầu xác minh, báo hết hạn mức hay vùng không hỗ trợ, tài khoản dừng cho tới khi bạn xử lý."),
    l("A broken proxy stops its account; the app never switches to a direct connection.", "Proxy hỏng thì tài khoản đó dừng; app không bao giờ tự chuyển sang kết nối trực tiếp."),
  ],
  next: l("Ready to connect an agent?", "Sẵn sàng kết nối agent?"),
  privacyLink: l("Privacy details", "Chi tiết quyền riêng tư"),
};

export const DOWNLOAD = {
  h1: l("Download Muse4AI for Windows", "Tải Muse4AI cho Windows"),
  lead: l(
    "Free app for Windows 10 and 11 (64-bit). Your data stays on your PC and is kept when you update.",
    "App miễn phí cho Windows 10 và 11 (64-bit). Dữ liệu nằm trên máy bạn và được giữ khi cập nhật.",
  ),
  privateTitle: l("Private beta for now", "Hiện là bản beta riêng"),
  privateBody: l(
    "The current version is shared privately while testing continues. A public download link will appear on this page; there is no other official download.",
    "Phiên bản hiện tại đang được chia sẻ riêng trong lúc thử nghiệm. Link tải công khai sẽ hiện trên trang này; không có nơi tải chính thức nào khác.",
  ),
  version: l("Version", "Phiên bản"),
  date: l("Released", "Ngày phát hành"),
  size: l("Installer size", "Dung lượng bộ cài"),
  checksum: l("SHA-256 of the installer", "SHA-256 của bộ cài"),
  checksumNote: l(
    "After downloading, compare this value with Windows: open PowerShell in the download folder and run the command below.",
    "Sau khi tải, so mã này bằng Windows: mở PowerShell trong thư mục tải về rồi chạy lệnh bên dưới.",
  ),
  requirements: l("What you need", "Bạn cần gì"),
  req: [
    l("Windows 10 or 11, 64-bit.", "Windows 10 hoặc 11, bản 64-bit."),
    l("Your own Muse account and a working proxy for it.", "Tài khoản Muse của bạn và một proxy hoạt động cho tài khoản đó."),
    l("Free disk space for the files you create.", "Ổ đĩa còn chỗ cho các tệp bạn tạo."),
  ],
  unsigned: l(
    "The installer is not code-signed yet, so Windows SmartScreen may warn you. Continue only with a file whose SHA-256 matches the value above.",
    "Bộ cài chưa được ký số nên Windows SmartScreen có thể cảnh báo. Chỉ tiếp tục với tệp có SHA-256 khớp với mã ở trên.",
  ),
  guides: l("Install, update and remove", "Cài, cập nhật và gỡ"),
  install: l("Install guide", "Hướng dẫn cài"),
  update: l("Updates and backups", "Cập nhật và sao lưu"),
  changelog: l("What changed in each version", "Thay đổi của từng phiên bản"),
};

export const ABOUT = {
  h1: l("Made by Andrew Babo", "Made by Andrew Babo"),
  lead: l(
    "Muse4AI is a free, non-commercial portfolio project by Andrew Babo: a bridge that lets the AI agents people already use work with Muse in an orderly, visible way.",
    "Muse4AI là dự án portfolio miễn phí, phi thương mại của Andrew Babo: một cây cầu để các AI agent mọi người đang dùng làm việc với Muse một cách có trật tự, dễ theo dõi.",
  ),
  why: l("Why it exists", "Vì sao có dự án này"),
  whyBody: l(
    "AI agents are good at planning work but cannot use Muse on their own. Muse4AI gives them one clear door — on your PC, with your account, with every job in sight.",
    "AI agent giỏi lên kế hoạch nhưng không tự dùng Muse được. Muse4AI cho agent một cánh cửa rõ ràng — trên máy bạn, bằng tài khoản của bạn, mọi việc đều nhìn thấy.",
  ),
  principles: l("How it is built", "Được làm theo nguyên tắc nào"),
  principleList: [
    l("Local first: no cloud account, no database on the web.", "Ưu tiên chạy trên máy: không tài khoản đám mây, không cơ sở dữ liệu trên web."),
    l("Honest about limits: Muse's rules come first.", "Trung thực về giới hạn: luật của Muse đứng trước."),
    l("Plain language in English and Vietnamese.", "Lời văn dễ hiểu bằng tiếng Anh và tiếng Việt."),
    l("Every borrowed idea and library is credited.", "Mọi ý tưởng và thư viện mượn đều được ghi nguồn."),
  ],
};

export const LEGAL = {
  disclaimer: {
    h1: l("Disclaimer & trademarks", "Miễn trừ & nhãn hiệu"),
    sections: [
      {
        title: l("An independent project", "Một dự án độc lập"),
        body: l(
          "Muse4AI is an independent, non-commercial project by Andrew Babo. It is not affiliated with, sponsored by or approved by Meta Platforms, Muse, or any AI agent maker named on this site.",
          "Muse4AI là dự án độc lập, phi thương mại của Andrew Babo. Dự án không liên kết, không được tài trợ và không được Meta Platforms, Muse hay bất kỳ hãng AI agent nào nêu trên trang này phê duyệt.",
        ),
      },
      {
        title: l("Names and trademarks", "Tên và nhãn hiệu"),
        body: l(
          "Muse, Meta, Claude, ChatGPT, Codex, Cursor, GitHub Copilot, VS Code, Antigravity, Gemini, Lovable, Grok and other names are trademarks of their owners. They appear only to say which tools Muse4AI can work with. This site shows agent names as text, not their logos, unless an owner's published rules allow it.",
          "Muse, Meta, Claude, ChatGPT, Codex, Cursor, GitHub Copilot, VS Code, Antigravity, Gemini, Lovable, Grok và các tên khác là nhãn hiệu của chủ sở hữu. Các tên chỉ dùng để nói Muse4AI làm việc được với công cụ nào. Trang này ghi tên agent bằng chữ, không dùng logo, trừ khi quy định công khai của chủ sở hữu cho phép.",
        ),
      },
      {
        title: l("Muse's terms are your responsibility", "Điều khoản của Muse là trách nhiệm của bạn"),
        body: l(
          "Muse4AI works with your own Muse account. Muse's terms may restrict automated use of its service, and Muse can limit or suspend accounts. Read [Muse's terms](https://muse.ai/terms?locale=en_US) and decide for yourself; using a secondary account is wise.",
          "Muse4AI dùng tài khoản Muse của chính bạn. Điều khoản của Muse có thể hạn chế việc dùng tự động và Muse có thể giới hạn hoặc khoá tài khoản. Hãy đọc [điều khoản của Muse](https://muse.ai/terms?locale=en_US) và tự quyết định; nên dùng tài khoản phụ.",
        ),
      },
      {
        title: l("What the app will not do", "Những việc app không làm"),
        body: l(
          "The app does not get around usage limits, verification, regional rules or other restrictions. When Muse reports one, the account pauses and you decide what to do.",
          "App không né hạn mức, xác minh, quy định theo vùng hay các hạn chế khác. Khi Muse báo, tài khoản dừng và bạn quyết định làm gì tiếp.",
        ),
      },
      {
        title: l("No warranty", "Không bảo đảm"),
        body: l(
          "Muse4AI is provided as is, without any warranty. Results come from Muse; check them before you use them, and label AI-generated content where rules require it.",
          "Muse4AI được cung cấp nguyên trạng, không kèm bảo đảm. Kết quả do Muse tạo; hãy kiểm tra trước khi dùng và ghi nhãn nội dung do AI tạo khi quy định yêu cầu.",
        ),
      },
    ],
  },
  privacy: {
    h1: l("Privacy", "Quyền riêng tư"),
    sections: [
      {
        title: l("This website", "Website này"),
        body: l(
          "This site sets no cookies, runs no analytics and loads no third-party scripts. Fonts are served from this site. Like any website, the hosting service may process technical data such as your IP address to deliver pages; this project adds no tracking of its own.",
          "Website không đặt cookie, không chạy phân tích và không tải script bên thứ ba. Phông chữ phục vụ từ chính trang. Như mọi website, dịch vụ lưu trữ có thể xử lý dữ liệu kỹ thuật như địa chỉ IP để trả trang; dự án không thêm theo dõi nào.",
        ),
      },
      {
        title: l("The Muse4AI app", "App Muse4AI"),
        body: l(
          `The app stores everything on your PC, in ${FACTS.dataDir} and your library folder. It has no Muse4AI account and sends no data to Andrew Babo. It talks to Muse through the proxy you set, and to your agents only through the API you turn on.`,
          `App lưu mọi thứ trên máy bạn, ở ${FACTS.dataDir} và thư mục thư viện. App không có tài khoản Muse4AI và không gửi dữ liệu cho Andrew Babo. App nói chuyện với Muse qua proxy bạn đặt, và với agent chỉ qua API bạn bật.`,
        ),
      },
      {
        title: l("What you send to Muse and agents", "Những gì bạn gửi cho Muse và agent"),
        body: l(
          "Prompts and files you send are handled by Muse under its own policies, and by your agent's maker under theirs. Do not send private or customer data you are not allowed to share.",
          "Prompt và tệp bạn gửi được Muse xử lý theo chính sách của Muse, và được hãng agent xử lý theo chính sách của họ. Đừng gửi dữ liệu riêng tư hay dữ liệu khách hàng mà bạn không được phép chia sẻ.",
        ),
      },
    ],
  },
};

export const OSS = {
  h1: l("Open source & credits", "Mã mở & ghi nguồn"),
  lead: l(
    "Muse4AI learned from other people's work and is built with open-source software. Here is every source, with its license.",
    "Muse4AI học từ công sức của người khác và được xây bằng phần mềm mã nguồn mở. Đây là mọi nguồn, kèm giấy phép.",
  ),
  groups: {
    referenced: l("Referenced directly", "Tham khảo trực tiếp"),
    design: l("Design references", "Tham khảo thiết kế"),
    legacy: l("Used in earlier versions", "Đã dùng ở bản trước"),
    app: l("Inside the Windows app", "Bên trong app Windows"),
    web: l("Inside this website", "Bên trong website này"),
    font: l("Fonts", "Phông chữ"),
    tool: l("Build and install tools", "Công cụ dựng và cài đặt"),
    "runtime-download": l("Downloaded only when you turn a feature on", "Chỉ tải khi bạn bật tính năng"),
  },
  license: l("License", "Giấy phép"),
};

export const CHANGELOG = {
  h1: l("What's new", "Có gì mới"),
  lead: l("Changes in each Muse4AI version, in plain words.", "Thay đổi của từng phiên bản Muse4AI, viết dễ hiểu."),
};

export const DOCS_HUB = {
  h1: l("Muse4AI guide, A to Z", "Hướng dẫn Muse4AI từ A đến Z"),
  lead: l(
    "Step-by-step guides with real screenshots, written for everyone — from installing the app to connecting your AI agent.",
    "Hướng dẫn từng bước kèm ảnh thật, viết cho mọi người — từ cài app đến kết nối AI agent.",
  ),
  forAgents: l("For AI agents", "Cho AI agent"),
  forAgentsBody: l(
    "Agents can read every guide as Markdown, or start from llms.txt. The Muse4AI skill teaches them the safe way to send jobs.",
    "Agent có thể đọc mọi bài dạng Markdown, hoặc bắt đầu từ llms.txt. Skill Muse4AI dạy agent cách gửi việc an toàn.",
  ),
  skillZip: l("Download the skill (.zip)", "Tải skill (.zip)"),
  skillHow: l("How the skill works", "Skill hoạt động thế nào"),
};

export const AGENTS_HUB = {
  h1: l("Connect your AI agent to Muse", "Kết nối AI agent với Muse"),
  lead: l(
    "Pick your agent for exact setup steps. Agents on your PC use the local address; cloud apps need remote access first.",
    "Chọn agent để xem từng bước cài. Agent trên máy dùng địa chỉ cục bộ; ứng dụng trên mây cần bật truy cập từ xa trước.",
  ),
  honest: l(
    "\"Setup guide — not yet tested\" means the steps follow the maker's own documentation but nobody has confirmed them end to end with Muse4AI yet.",
    "\"Có hướng dẫn — chưa kiểm\" nghĩa là các bước theo tài liệu của hãng nhưng chưa ai xác nhận chạy trọn vẹn với Muse4AI.",
  ),
};

export const USECASES_HUB = {
  h1: l("Use cases for Muse4AI", "Tình huống dùng Muse4AI"),
  lead: l(
    "Real workflows where you decide, your agent plans and Muse4AI gets the pictures and clips made — with the limits stated plainly.",
    "Quy trình thật: bạn quyết định, agent lên kế hoạch, Muse4AI lo phần tạo ảnh và clip — giới hạn ghi rõ ràng.",
  ),
};
