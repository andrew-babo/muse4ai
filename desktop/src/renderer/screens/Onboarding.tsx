import { Check, FolderOpen } from "lucide-react";
import { useState } from "react";
import logo from "../assets/logo.png";
import { Button } from "../components/ui";
import { act } from "../lib/api";
import { navigate } from "../lib/router";
import { useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { AddAccountDialog } from "./Accounts";
import { ProxySettings } from "./Settings";
import { t } from "@shared/i18n";
import { LanguageSwitch } from "../components/LanguageSwitch";

// S01 — first run: risk note → library folder → proxies → first account (AC-ONB-01/02/03).

const STEPS = ["Lưu ý", "Thư mục", "Proxy", "Tài khoản"];

export function Onboarding() {
  const s = useUi((x) => x.snap?.settings);
  const proxies = useUi((x) => x.snap?.proxies ?? []);
  const accounts = useUi((x) => x.snap?.accounts ?? []);
  const [accepted, setAccepted] = useState(s?.riskAccepted ?? false);
  if (!s) return null;
  const step = Math.min(s.onboardingStep, 3);
  const go = async (n: number) => {
    await act("settings.set", { key: "onboardingStep", value: n });
    if (n >= 4) navigate("/studio", { replace: true });
  };
  const healthy = proxies.filter((p) => p.health === "healthy").length;
  return (
    <div className="scroll-area flex h-full justify-center px-8 py-10">
      <div className="w-full max-w-[820px]">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="size-10 rounded-[12px]" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{t("Chào anh, mình bắt đầu nhé")}</h1>
            <p className="text-base text-ink-2">{t("Bốn bước ngắn, khoảng hai phút.")}</p>
          </div>
          <LanguageSwitch origin="onboarding" className="ml-auto" />
        </div>
        <ol className="mt-8 flex items-center gap-3" aria-label={t("Các bước")}>
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", i < step ? "bg-ok text-on-ink" : i === step ? "bg-ink text-on-ink" : "bg-ink/8 text-ink-2")}>{i < step ? <Check className="size-4" /> : i + 1}</span>
              <span className={cx("text-sm", i === step ? "font-semibold text-ink" : "text-ink-2")}>{t(label)}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
            </li>
          ))}
        </ol>
        <div className="glass mt-6 rounded-lg p-7">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">{t("Trước khi dùng")}</h2>
              <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-2">
                <li>{t("Muse4AI điều khiển trang web Muse thay anh. Đây không phải cách kết nối chính thức của Muse; Muse có thể giới hạn hoặc khoá tài khoản. Nên dùng tài khoản phụ.")}</li>
                <li>{t("Em dừng ngay khi gặp hạn mức, yêu cầu xác minh hoặc vùng không hỗ trợ — không tìm cách vượt.")}</li>
                <li>{t("Mọi thứ nằm trên máy này: hàng chờ, thư viện, phiên đăng nhập. Em không lưu mật khẩu Muse.")}</li>
              </ul>
              <label className="mt-2 flex items-center gap-3 text-base text-ink">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                {t("Em hiểu và tự chịu trách nhiệm khi dùng tài khoản Muse của mình.")}
              </label>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={!accepted}
                  onClick={async () => {
                    await act("settings.set", { key: "riskAccepted", value: true });
                    await go(1);
                  }}
                >
                  {t("Tiếp tục")}
                </Button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">{t("Lưu ảnh và video vào đâu?")}</h2>
              <p className="text-base text-ink-2">{t("Em chia theo tháng và theo lô. Anh đổi lại được trong Cài đặt.")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ink/5 px-3 py-2.5 font-mono text-sm text-ink" title={s.libraryDir}>
                  {s.libraryDir}
                </code>
                <Button icon={<FolderOpen className="size-4" />} onClick={() => void act("settings.pickLibraryDir")}>
                  {t("Chọn thư mục khác")}
                </Button>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => void go(0)}>
                  {t("Quay lại")}
                </Button>
                <Button variant="primary" onClick={() => void go(2)}>
                  {t("Dùng thư mục này")}
                </Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">{t("Thêm proxy")}</h2>
              <p className="text-base text-ink-2">{t("Mỗi tài khoản Muse đi qua một proxy (nên dùng proxy riêng). {value}", { value: healthy ? t("Đang có {healthy} proxy khoẻ.", { healthy }) : "" })}</p>
              <ProxySettings compact />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => void go(1)}>
                  {t("Quay lại")}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => void go(3)}>
                    {t("Bỏ qua")}
                  </Button>
                  <Button variant="primary" disabled={!healthy} onClick={() => void go(3)}>
                    {t("Tiếp tục")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">{t("Thêm tài khoản Muse đầu tiên")}</h2>
              <p className="text-base text-ink-2">{t("Em mở một cửa sổ Muse riêng qua proxy để anh đăng nhập. {value}", { value: accounts.length ? t("Đã có {accountsCount} tài khoản.", { accountsCount: accounts.length }) : "" })}</p>
              {accounts.length === 0 ? <AddAccountDialog open inline onClose={() => undefined} /> : null}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => void go(2)}>
                  {t("Quay lại")}
                </Button>
                <div className="flex gap-2">
                  <Button variant={accounts.length ? "primary" : "ghost"} onClick={() => void go(4)}>
                    {accounts.length ? t("Vào Studio") : t("Bỏ qua")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
