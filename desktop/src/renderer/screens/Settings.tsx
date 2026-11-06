import { Bell, Cable, Copy, FileArchive, FolderOpen, Gauge, Info, ListOrdered, MoreHorizontal, Network, Plug, RefreshCw, Shield, SlidersHorizontal, Trash2, Upload, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { BRAND } from "@shared/brand";
import { formatBytes, formatDateTime, formatLatency, formatNumber } from "@shared/format";
import { namesSummary, proxyUsers, usedProxyCount } from "@shared/proxyShare";
import { proxyEntryWhere, type ProxyImportResult } from "@shared/proxyParse";
import type { Proxy, Settings as SettingsT } from "@shared/types";
import { Avatar } from "../components/Avatar";
import { Confirm, Menu } from "../components/Overlay";
import { Button, Empty, IconButton, Pill, SectionTitle, Segmented, Spinner, Switch } from "../components/ui";
import { act, call } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { pushToast, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { ApiSettings } from "./SettingsApi";
import { UpdateCard, useUpdateDot } from "./SettingsUpdate";
import { RunSettings } from "./Execution";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { MakerCard } from "../components/MakerCredit";
import { getLocale, t } from "@shared/i18n";
import { CREDITS, pick } from "@content/index";

// S08 proxy pool · S09 other settings (general, queue, notifications, security, diagnostics, about).

const TABS = [
  { key: "general", label: "Chung", icon: SlidersHorizontal },
  { key: "proxy", label: "Proxy", icon: Network },
  { key: "run", label: "Chạy việc", icon: Cable },
  { key: "queue", label: "Hàng chờ", icon: ListOrdered },
  { key: "notifications", label: "Thông báo", icon: Bell },
  { key: "api", label: "API & agent", icon: Plug },
  { key: "security", label: "Bảo mật", icon: Shield },
  { key: "diagnostics", label: "Chẩn đoán", icon: Gauge },
  { key: "about", label: "Giới thiệu", icon: Info },
];

async function setSetting<K extends keyof SettingsT>(key: K, value: SettingsT[K]) {
  await act("settings.set", { key, value });
}

export function Settings() {
  const r = useRoute();
  const tab = r.name === "settings" ? r.tab : "general";
  const updateDot = useUpdateDot();
  return (
    <div className="flex h-full flex-col px-8 pt-6">
      <SectionTitle>{t("Cài đặt")}</SectionTitle>
      <div className="mt-5 flex min-h-0 flex-1 gap-6 pb-5">
        <nav aria-label={t("Mục cài đặt")} className="w-[200px] shrink-0">
          <ul className="flex flex-col gap-1">
            {TABS.map((item) => (
              <li key={item.key}>
                <button type="button" aria-current={tab === item.key ? "page" : undefined} onClick={() => navigate(`/settings/${item.key}`)} className={cx("flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3 text-base", tab === item.key ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2 hover:bg-surface/60 hover:text-ink")}>
                  <item.icon className="size-4" aria-hidden />
                  <span className="flex-1 text-left">{t(item.label)}</span>
                  {item.key === "about" && updateDot && <span className="size-2 rounded-full bg-accent" aria-label={t("Có bản mới")} />}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="scroll-area min-w-0 flex-1">
          {tab === "proxy" ? <ProxySettings /> : tab === "run" ? <RunSettings /> : tab === "queue" ? <QueueSettings /> : tab === "notifications" ? <NotifySettings /> : tab === "api" ? <ApiSettings /> : tab === "security" ? <SecuritySettings /> : tab === "diagnostics" ? <Diagnostics /> : tab === "about" ? <About /> : <General />}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="glass-card mb-4 rounded-lg p-5">
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-base text-ink">{label}</div>
        {hint && <div className="text-sm text-ink-2">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General() {
  const s = useUi((x) => x.snap?.settings);
  const engine = useUi((x) => x.snap?.engine);
  if (!s || !engine) return null;
  // R21: three choices. Until the user picks one, the machine default is shown as the selected choice.
  const machineDefault = engine.gpuCompositing ? "full" : "light";
  const chosen = s.displayMode === "auto" ? machineDefault : s.displayMode;
  const label = { full: t("Kính đầy đủ"), light: t("Kính nhẹ"), solid: t("Nền đặc") } as const;
  const effective = !engine.osTransparency ? t("Nền đặc (Windows đang tắt hiệu ứng trong suốt)") : label[chosen];
  return (
    <>
      <Card title={t("Ngôn ngữ")} sub={t("Đổi là có hiệu lực ngay trên mọi màn, thông báo và menu khay; lưu cho lần mở sau.")}>
        <LanguageSwitch origin="settings" size="md" />
      </Card>
      <Card title={t("Thư viện")} sub={t("Ảnh và video tải về được lưu thẳng vào thư mục này, chia theo tháng và theo lô.")}>
        <div className="flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink" data-selectable title={s.libraryDir}>
            {s.libraryDir}
          </code>
          <Button size="sm" icon={<FolderOpen className="size-4" />} onClick={() => void act("settings.pickLibraryDir", {}, t("Đã đổi thư mục thư viện"))}>
            {t("Đổi thư mục")}
          </Button>
        </div>
        <p className="text-sm text-ink-2">{t("Đổi thư mục chỉ áp dụng cho tệp mới; tệp cũ giữ nguyên chỗ. Còn trống {diskFreeBytes}.", { diskFreeBytes: formatBytes(engine.diskFreeBytes ?? 0) })}</p>
      </Card>
      <Card title={t("Hiển thị")} sub={t("Đang dùng: {effective}", { effective })}>
        <Segmented
          label={t("Chế độ kính")}
          value={chosen}
          onChange={(v) => void setSetting("displayMode", v)}
          options={[
            { value: "full", label: label.full },
            { value: "light", label: label.light },
            { value: "solid", label: label.solid },
          ]}
        />
        <p className="text-sm text-ink-2">
          {t("{value} Windows bật “Giảm chuyển động” thì avatar đứng yên.", { value: s.displayMode === "auto"
            ? engine.gpuCompositing
              ? t("Đang theo mặc định của máy: có GPU tăng tốc nên dùng Kính đầy đủ.")
              : t("Đang theo mặc định của máy: không có GPU tăng tốc (như máy chủ ảo) nên dùng Kính nhẹ để cuộn mượt.")
            : t("Windows tắt “Hiệu ứng trong suốt” thì luôn dùng Nền đặc; bật lại sẽ về lựa chọn này.") })}
        </p>
      </Card>
      <Card title={t("Khởi động")}>
        <Row label={t("Mở Muse4AI khi đăng nhập Windows")} hint={t("Mở thu nhỏ dưới khay, tiếp tục hàng chờ.")}>
          <Switch label={t("Mở khi đăng nhập Windows")} checked={s.launchAtLogin} onChange={(v) => void setSetting("launchAtLogin", v)} />
        </Row>
      </Card>
    </>
  );
}

function QueueSettings() {
  const s = useUi((x) => x.snap?.settings);
  if (!s) return null;
  return (
    <Card title={t("Hàng chờ")} sub={t("Số việc chạy cùng lúc nằm ở Cài đặt › Chạy việc và trong thẻ từng tài khoản.")}>
      <Row label={t("Số việc cùng lúc")} hint={t("Mỗi tài khoản đặt riêng (1–20); trần toàn app 1–100")}>
        <Button size="sm" onClick={() => navigate("/settings/run")}>
          {t("Mở Chạy việc")}
        </Button>
      </Row>
      <Row label={t("Tự thử lại khi lỗi trước lúc gửi")} hint={t("Chỉ thử lại khi chắc chắn Muse chưa nhận lượt — không bao giờ gửi lại mù sau khi đã gửi.")}>
        <Segmented label={t("Số lần thử lại")} value={String(s.preSubmitRetries)} onChange={(v) => void setSetting("preSubmitRetries", Number(v))} options={[{ value: "0", label: t("Không") }, { value: "1", label: t("1 lần") }, { value: "2", label: t("2 lần") }]} />
      </Row>
    </Card>
  );
}

function NotifySettings() {
  const s = useUi((x) => x.snap?.settings);
  if (!s) return null;
  return (
    <Card title={t("Thông báo Windows")} sub={t("Lô xong, tài khoản cần đăng nhập lại hoặc xác minh, lượt cần anh xem, ổ đĩa sắp đầy.")}>
      <Row label={t("Hiện thông báo Windows")} hint={t("Khi tắt, thông báo vẫn hiện trong app.")}>
        <Switch label={t("Thông báo Windows")} checked={s.notifications} onChange={(v) => void setSetting("notifications", v)} />
      </Row>
    </Card>
  );
}

function SecuritySettings() {
  return (
    <>
      <Card title={t("Dữ liệu nằm trên máy này")} sub={t("Không có máy chủ hay tài khoản Muse4AI nào cả.")}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>{t("Mật khẩu proxy được mã hoá bằng Windows (DPAPI), chỉ tài khoản Windows này đọc được.")}</li>
          <li>{t("Phiên đăng nhập Muse nằm trong hồ sơ trình duyệt riêng của từng tài khoản; em không lưu mật khẩu hay mã xác nhận.")}</li>
          <li>{t("Mỗi tài khoản luôn đi qua proxy của nó. Proxy lỗi thì tài khoản dừng, không bao giờ tự đi mạng trực tiếp.")}</li>
          <li>{t("Nhật ký và gói chẩn đoán đã che IP, email, mật khẩu và cookie.")}</li>
          <li>{t("Khoá API cho agent chỉ được lưu dạng băm (không xem lại được) và thu hồi có hiệu lực ngay ở lần gọi kế tiếp.")}</li>
          <li>{t("Khi chia sẻ API qua Cloudflare, lời gọi và tệp tải về đi qua máy chủ Cloudflare; tắt API là dừng chia sẻ.")}</li>
        </ul>
        <div>
          <Button size="sm" icon={<FolderOpen className="size-4" />} onClick={() => void act("settings.openDataDir")}>
            {t("Mở thư mục dữ liệu")}
          </Button>
        </div>
      </Card>
      <Card title={t("Lưu ý khi dùng Muse qua app")}>
        <p className="text-sm leading-relaxed text-ink-2">{t("Muse4AI điều khiển trang web Muse thay anh — đây không phải cách kết nối chính thức. Muse có thể giới hạn hoặc khoá tài khoản; em dừng ngay khi gặp hạn mức, yêu cầu xác minh hoặc vùng không hỗ trợ và không tìm cách vượt. Nên dùng tài khoản phụ.")}</p>
      </Card>
    </>
  );
}

function Diagnostics() {
  const engine = useUi((x) => x.snap?.engine);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card title={t("Gói chẩn đoán")} sub={t("Gồm nhật ký gần đây và tình trạng tài khoản/proxy, đã che thông tin nhạy cảm. Gửi cho người hỗ trợ khi cần.")}>
        <div>
          <Button
            icon={<FileArchive className="size-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await act<{ path: string; bytes: number } | null>("diagnostics.export");
              setBusy(false);
              if (r) pushToast({ tone: "ok", title: t("Đã xuất gói chẩn đoán"), body: `${r.path} · ${formatBytes(r.bytes)}` }, 6000);
            }}
          >
            {t("Xuất gói chẩn đoán (.zip)")}
          </Button>
        </div>
      </Card>
      {engine && (
        <Card title={t("Tình trạng bộ máy")}>
          <dl className="grid grid-cols-[200px_1fr] gap-y-2 text-sm">
            <dt className="text-ink-2">{t("Phiên bản")}</dt>
            <dd className="font-mono text-xs leading-5 text-ink">{engine.version}</dd>
            <dt className="text-ink-2">{t("Tăng tốc đồ hoạ")}</dt>
            <dd className="text-ink">{engine.gpuCompositing ? t("Có") : t("Không (dùng Kính nhẹ)")}</dd>
            <dt className="text-ink-2">{t("Hiệu ứng trong suốt")}</dt>
            <dd className="text-ink">{engine.osTransparency ? t("Bật") : t("Tắt")}</dd>
            <dt className="text-ink-2">{t("Ổ đĩa thư viện")}</dt>
            <dd className="text-ink">{engine.diskFreeBytes !== null ? t("Còn {diskFreeBytes}", { diskFreeBytes: formatBytes(engine.diskFreeBytes) }) : t("Không đọc được")}</dd>
            <dt className="text-ink-2">{t("Muse đổi giao diện")}</dt>
            <dd className="text-ink">{engine.uiChangedKinds.length ? engine.uiChangedKinds.join(", ") : t("Không")}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}

function About() {
  const engine = useUi((x) => x.snap?.engine);
  const cmd = `powershell -ExecutionPolicy Bypass -File .\\install.ps1`;
  return (
    <>
      <Card title={BRAND.name} sub={t("Phiên bản {version} · bản cài thử nghiệm, chưa ký số", { version: engine?.version ?? "" })}>
        <p className="text-sm font-medium text-ink-2">{t("Cầu nối AI agent — dùng được với Muse")}</p>
        <p className="text-sm leading-relaxed text-ink-2">{t("Tạo ảnh và video qua Muse trên Windows: nhiều tài khoản, mỗi tài khoản đi qua proxy của nó, hàng chờ bền vững và thư viện trên máy.")}</p>
      </Card>
      {/* Updates sit right under the version so a waiting update is seen without scrolling. */}
      <UpdateCard>
        <details className="group border-t border-line pt-4">
          <summary className="cursor-pointer select-none text-base text-ink marker:text-ink-3">{t("Cài thủ công (EXE hoặc ZIP)")}</summary>
          <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-ink-2">
          {t("Cách dễ nhất: chạy tệp Muse4AI-…-Setup-win-x64.exe mới và chọn English hoặc Tiếng Việt — bộ cài tự đóng Muse4AI nếu app đang mở. Bộ cài EXE dùng chung trình cài với gói ZIP nên cũng giữ dữ liệu và tự quay lại bản cũ nếu lỗi.")}
        </p>
        <p className="text-sm font-medium text-ink">{t("Hoặc cài từ gói ZIP:")}</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          <li>{t("Tải tệp Muse4AI-…-win-x64.zip mới và giải nén.")}</li>
          <li>{t("Thoát Muse4AI (chuột phải biểu tượng dưới khay → Thoát).")}</li>
          <li>{t("Mở PowerShell trong thư mục vừa giải nén và chạy lệnh dưới. Trình cài kiểm mã SHA-256 trước khi chép và tự quay lại bản cũ nếu lỗi.")}</li>
        </ol>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink" data-selectable>
            {cmd}
          </code>
          <IconButton
            label={t("Chép lệnh")}
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(cmd);
              pushToast({ tone: "ok", title: t("Đã chép lệnh") }, 2500);
            }}
          >
            <Copy className="size-4" />
          </IconButton>
        </div>
          </div>
        </details>
      </UpdateCard>
      <MakerCard />
      <Card title={t("Mã nguồn mở và ghi công")} sub={t("Danh sách đọc từ cùng nguồn với trang Mã mở trên website.")}>
        {/* Build 3.0 AC-APP-OSS-01: every credit used in the app, from the shared registry (no second hand-written list). */}
        <ul className="space-y-1.5 text-sm text-ink-2">
          {CREDITS.filter((c) => c.usedIn.includes("app")).map((c) => (
            <li key={c.id}>
              <span className="font-medium text-ink">{c.name}</span> — {pick(c.note, getLocale())} <span className="font-mono text-xs text-ink-3">({c.license})</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-2">{t("Toàn văn giấy phép MIT của muse2api và VibesAI-api nằm trong thư mục resources của bản cài, và mở được ngay trong Hướng dẫn.")}</p>
        <div>
          <Button size="sm" variant="secondary" onClick={() => navigate("/guide/open-source")}>
            {t("Mở chương Mã mở trong Hướng dẫn")}
          </Button>
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ S08
export function ProxySettings({ compact }: { compact?: boolean }) {
  const proxies = useUi((x) => x.snap?.proxies ?? []);
  const accounts = useUi((x) => x.snap?.accounts ?? []);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<ProxyImportResult["errors"]>([]);
  const [busy, setBusy] = useState<null | "import" | "all">(null);
  const [del, setDel] = useState<Proxy | null>(null);
  const healthy = proxies.filter((p) => p.health === "healthy").length;
  const doImport = async (fromFile: boolean) => {
    setBusy("import");
    const r = await (fromFile ? call<ProxyImportResult | null>("proxy.pickFile") : call<ProxyImportResult>("proxy.import", { text })).catch(() => null);
    setBusy(null);
    if (!r) return;
    setErrors(r.errors);
    const skippedNote = r.skipped ? t("Bỏ qua {skipped} proxy đã có sẵn.", { skipped: formatNumber(r.skipped) }) : "";
    if (r.added) {
      pushToast({ tone: "ok", title: t("Đã thêm {added} proxy", { added: formatNumber(r.added) }), body: t("{value}Em đang kiểm từng proxy…", { value: skippedNote ? `${skippedNote} ` : "" }) }, 4000);
      if (!r.errors.length) setText("");
      setBusy("all");
      await call("proxy.testAll").catch(() => null);
      setBusy(null);
    } else if (!r.errors.length) pushToast({ tone: "info", title: t("Không có proxy mới"), body: skippedNote || t("Danh sách trống.") }, 3500);
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="glass-card rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-md font-semibold text-ink">{t("Nhập proxy")}</h2>
            <p className="mt-1 text-sm text-ink-2">{t("Mỗi dòng một proxy (hoặc dán nguyên chuỗi cách nhau bằng dấu cách): host:port:user:pass hoặc http://user:pass@host:port. Mật khẩu được mã hoá trên máy.")}</p>
          </div>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 4 : 5} placeholder={"proxy.example.com:8080:user:pass\nsocks5://user:pass@10.0.0.2:1080"} aria-label={t("Danh sách proxy")} className="mt-3 w-full resize-none rounded-[12px] border border-line-strong bg-surface p-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" spellCheck={false} />
        {errors.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-danger-ink" role="alert">
            {errors.slice(0, 6).map((e, i) => (
              <li key={`${e.line}-${e.item ?? 0}-${i}`}>
                {t(proxyEntryWhere(e))}: {t(e.error)}
              </li>
            ))}
            {errors.length > 6 && <li>{t("… và {errorsCount} mục lỗi khác", { errorsCount: errors.length - 6 })}</li>}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => void doImport(false)} loading={busy === "import"} disabled={!text.trim()}>
            {t("Thêm và kiểm")}
          </Button>
          <Button size="sm" icon={<Upload className="size-4" />} onClick={() => void doImport(true)}>
            {t("Chọn tệp…")}
          </Button>
          {proxies.length > 0 && (
            <Button
              size="sm"
              icon={<RefreshCw className={cx("size-4", busy === "all" && "animate-spin")} />}
              disabled={busy === "all"}
              onClick={async () => {
                setBusy("all");
                const r = await act<{ healthy: number; failed: number }>("proxy.testAll");
                setBusy(null);
                if (r) pushToast({ tone: r.failed ? "attention" : "ok", title: t("{healthy} proxy khoẻ · {failed} lỗi", { healthy: r.healthy, failed: r.failed }) }, 3500);
              }}
            >
              {t("Kiểm tất cả")}
            </Button>
          )}
        </div>
      </section>
      <section className="glass-card overflow-hidden rounded-lg">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-md font-semibold text-ink">{t("Kho proxy")}</h2>
          <span className="text-sm text-ink-2">
            {t("{proxiesCount} proxy · {healthy} khoẻ · {itemsCount} đang gán", { proxiesCount: formatNumber(proxies.length), healthy: formatNumber(healthy), itemsCount: formatNumber(usedProxyCount(proxies, accounts)) })}
          </span>
        </div>
        {proxies.length === 0 ? (
          <Empty icon={<Network className="size-6" />} title={t("Chưa có proxy")} body={t("Nên dùng mỗi tài khoản Muse một proxy riêng. Dùng chung được, nhưng các tài khoản sẽ ra cùng một địa chỉ IP.")} />
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[64px]" />
              <col />
              <col className="w-[104px]" />
              <col className="w-[136px]" />
              <col className="w-[116px]" />
              <col className="w-[48px]" />
            </colgroup>
            <thead>
              <tr className="border-y border-line text-left text-xs text-ink-2">
                <th className="px-5 py-2 font-medium">{t("Tên")}</th>
                <th className="py-2 pr-3 font-medium">{t("Địa chỉ")}</th>
                <th className="py-2 pr-3 font-medium">{t("Tình trạng")}</th>
                <th className="py-2 pr-3 font-medium">{t("Đường ra")}</th>
                <th className="py-2 pr-2 font-medium">{t("Tài khoản")}</th>
                <th className="py-2">
                  <span className="sr-only">{t("Thao tác")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((p) => {
                const users = proxyUsers(p.id, accounts);
                const addr = `${p.host}:${p.port}`;
                return (
                  <tr key={p.id} className="border-b border-line align-middle last:border-0">
                    <td className="px-5 py-2.5 font-medium text-ink">{p.label}</td>
                    <td className="py-2.5 pr-3">
                      <div className="truncate font-mono text-xs text-ink" title={addr}>
                        {addr}
                      </div>
                      <div className="text-xs text-ink-3">
                        {p.scheme.toUpperCase()} · {p.hasAuth ? t("có mật khẩu") : t("không mật khẩu")}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.health === "testing" ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                          <Spinner />{" "}{t("Đang kiểm")}
                        </span>
                      ) : (
                        <span title={p.lastError ? t(p.lastError) : undefined}>
                          <Pill tone={p.health === "healthy" ? "ok" : p.health === "failed" ? "danger" : "neutral"}>{p.health === "healthy" ? t("Khoẻ") : p.health === "failed" ? t("Lỗi") : t("Chưa kiểm")}</Pill>
                        </span>
                      )}
                      {p.health === "failed" && p.lastError && (
                        <div className="mt-0.5 truncate text-xs text-danger-ink" title={t(p.lastError)}>
                          {t(p.lastError)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-ink-2">
                      <div className="truncate">
                        {p.exitIpMasked ?? "—"}
                        {p.country ? ` · ${p.country}` : ""}
                      </div>
                      <div className="text-ink-3">{formatLatency(p.latencyMs)}</div>
                    </td>
                    <td className="py-2.5 pr-2">
                      {users.length ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-ink" title={users.map((u) => u.alias).join(", ")}>
                          <span className="flex shrink-0 -space-x-1.5">
                            {users.slice(0, 2).map((u) => (
                              <span key={u.id} className="rounded-full ring-2 ring-surface">
                                <Avatar account={u} size={20} showStatus={false} />
                              </span>
                            ))}
                          </span>
                          <span className="truncate">{namesSummary(users.map((u) => u.alias), users.length > 2 ? 1 : 2)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">{t("Trống")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Menu
                        label={t("Thao tác {label}", { label: p.label })}
                        align="end"
                        items={[
                          { label: t("Kiểm lại"), icon: <RefreshCw className="size-4" />, onSelect: () => void act("proxy.test", { id: p.id }) },
                          { label: users.length > 1 ? t("Gỡ khỏi {n} tài khoản", { n: users.length }) : t("Gỡ khỏi tài khoản"), icon: <Unlink className="size-4" />, disabled: users.length === 0, onSelect: () => void act("proxy.unassign", { id: p.id }) },
                          { label: t("Xoá proxy"), icon: <Trash2 className="size-4" />, danger: true, disabled: users.length > 0, hint: users.length ? t("Gỡ khỏi tài khoản trước") : undefined, onSelect: () => setDel(p) },
                        ]}
                        trigger={(arg) => (
                          <IconButton label={t("Thao tác {label}", { label: p.label })} size="sm" {...arg}>
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        )}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {proxies.some((p) => p.lastTestedAt) && <p className="px-5 py-2 text-xs text-ink-3">{t("Kiểm gần nhất {value}", { value: formatDateTime(Math.max(...proxies.map((p) => p.lastTestedAt ?? 0))) })}</p>}
      </section>
      <Confirm open={!!del} title={t("Xoá proxy {label}?", { label: del?.label ?? "" })} body={t("Mật khẩu của proxy này cũng bị xoá khỏi máy.")} confirmLabel={t("Xoá proxy")} danger onCancel={() => setDel(null)} onConfirm={() => {
        if (del) void act("proxy.remove", { id: del.id });
        setDel(null);
      }} />
    </div>
  );
}
