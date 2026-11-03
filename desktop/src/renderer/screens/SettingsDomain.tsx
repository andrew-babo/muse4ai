import { AlertTriangle, Check, ChevronDown, Circle, Copy, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENT_VIA_LABEL, DOMAIN_MSG, hhmm, normalizeDomain } from "@shared/api/domain";
import type { AgentUrl, ApiDomainProxy, ApiStatus, DomainState, DomainStep, DomainStepKey } from "@shared/types";
import { Confirm } from "../components/Overlay";
import { Button, Field, IconButton, Pill, Segmented, Spinner, TextInput } from "../components/ui";
import { act, call } from "../lib/api";
import { pushToast } from "../lib/store";
import { cx } from "../lib/ui";
import { t } from "@shared/i18n";
import { formatTime } from "@shared/format";

// S09d-domain — Tên miền trỏ về máy này (screens §10.1, spec F13 / R34–R38). Runs next to the tunnel, never instead of it.

const STATE_PILL: Record<DomainState, { tone: "ok" | "neutral" | "danger" | "accent" | "attention"; label: string }> = {
  off: { tone: "neutral", label: "Đang tắt" },
  preparing: { tone: "accent", label: "Đang chuẩn bị" },
  checking: { tone: "accent", label: "Đang kiểm" },
  pending: { tone: "attention", label: "Chưa trực tuyến" },
  online: { tone: "ok", label: "Trực tuyến" },
  error: { tone: "danger", label: "Lỗi" },
};

const STEP_LABEL: Record<DomainStepKey, string> = {
  dns: "Bản ghi DNS",
  port: "Cổng 80/443 trên máy",
  cert: "Chứng chỉ HTTPS",
  app: "Gọi thử đúng app",
};

export function copyText(text: string, what = t("Đã chép")) {
  void navigator.clipboard.writeText(text).then(
    () => pushToast({ tone: "ok", title: what }, 2500),
    () => pushToast({ tone: "danger", title: t("Không chép được — chọn chữ rồi bấm Ctrl+C") }),
  );
}

function Copyable({ text, value, label }: { text: string; value?: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink" data-selectable title={text}>
        {text}
      </code>
      <IconButton label={label} size="sm" onClick={() => copyText(value ?? text)}>
        <Copy className="size-4" />
      </IconButton>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative min-w-0">
      <pre className="scroll-area max-h-56 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-[12px] bg-ink/5 p-3 pr-12 font-mono text-xs leading-5 text-ink" data-selectable>
        {code}
      </pre>
      <IconButton label={label} size="sm" className="absolute right-2 top-2" onClick={() => copyText(code, t("Đã chép"))}>
        <Copy className="size-4" />
      </IconButton>
    </div>
  );
}

function StepIcon({ s }: { s: DomainStep["state"] }) {
  if (s === "ok")
    return (
      <span className="grid size-5 place-items-center rounded-full bg-ok text-on-ink" aria-hidden>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (s === "running") return <Spinner className="size-5 text-accent" />;
  if (s === "warn")
    return (
      <span className="grid size-5 place-items-center rounded-full bg-attention-soft text-attention-ink" aria-hidden>
        <AlertTriangle className="size-3.5" />
      </span>
    );
  if (s === "fail")
    return (
      <span className="grid size-5 place-items-center rounded-full bg-danger-soft text-danger-ink" aria-hidden>
        <X className="size-3.5" strokeWidth={3} />
      </span>
    );
  return <Circle className="size-5 text-ink-3" aria-hidden />;
}

const STEP_WORD: Record<DomainStep["state"], string> = { ok: "đạt", running: "đang chờ", warn: "cảnh báo", fail: "lỗi", pending: "chưa tới lượt", skip: "bỏ qua" };

function Steps({ steps }: { steps: Record<DomainStepKey, DomainStep> }) {
  const keys = (Object.keys(STEP_LABEL) as DomainStepKey[]).filter((k) => steps[k].state !== "skip");
  return (
    <ol className="flex flex-col gap-2.5" aria-label={t("Các bước kiểm tên miền")}>
      {keys.map((k) => {
        const st = steps[k];
        return (
          <li key={k} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 shrink-0">
              <StepIcon s={st.state} />
            </span>
            <span className="min-w-0">
              <span className="font-medium text-ink">{t(STEP_LABEL[k])}</span>
              <span className="sr-only"> — {t(STEP_WORD[st.state])}</span>
              <span className={cx("text-ink-2", st.state === "fail" && "text-danger-ink", st.state === "warn" && "text-attention-ink")}> — {st.detail ? t(st.detail) : t("chờ bước trên")}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function caddyConfig(host: string, port: number): string {
  return [`${host} {`, `\treverse_proxy 127.0.0.1:${port}`, "}"].join("\n");
}

function nginxConfig(host: string, port: number): string {
  return [
    "server {",
    "    listen 443 ssl;",
    `    server_name ${host};`,
    "    ssl_certificate     /duong/dan/fullchain.pem;",
    "    ssl_certificate_key /duong/dan/privkey.pem;",
    "    location / {",
    `        proxy_pass http://127.0.0.1:${port};`,
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_http_version 1.1;",
    "        proxy_buffering off;",
    "        proxy_read_timeout 120s;",
    "    }",
    "}",
  ].join("\n");
}

function Guide({ api }: { api: ApiStatus }) {
  const d = api.domain;
  const [fwOpen, setFwOpen] = useState(false);
  const [sample, setSample] = useState<"caddy" | "nginx">("caddy");
  const ip = d.publicIp;
  const fw = `New-NetFirewallRule -DisplayName "Muse4AI HTTPS" -Direction Inbound -Program "${d.caddyPath ?? "caddy.exe"}" -Protocol TCP -LocalPort 80,443 -Action Allow`;
  return (
    <div className="flex flex-col gap-3 rounded-md bg-ink/[0.03] p-4">
      <h3 className="text-sm font-semibold text-ink">{t("Việc anh cần làm")}</h3>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-2">{t("1. Ở nơi quản lý tên miền, tạo bản ghi A:")}</span>
        <Copyable text={`A · ${d.host} → ${ip ?? t("IP công khai của máy")}`} value={ip ?? d.host} label={ip ? t("Chép IP cho bản ghi A") : t("Chép tên miền")} />
        <span className="text-xs text-ink-3">
          {t("{value} Nếu tên miền ở Cloudflare: để đám mây xám (chỉ DNS).", { value: ip ? t("IP do app dò từ Internet — kiểm lại với nhà cung cấp VPS.") : t("Chưa dò được IP công khai — xem trong trang quản lý VPS.") })}
        </span>
      </div>
      {d.proxy === "managed" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-2">{t("2. Mở cổng TCP 80 và 443 ở tường lửa của nhà cung cấp VPS (hoặc chuyển cổng trên router).")}</span>
          <button type="button" onClick={() => setFwOpen((o) => !o)} aria-expanded={fwOpen} className="inline-flex w-fit items-center gap-1 rounded-md text-sm font-medium text-ink-2 hover:text-ink">
            <ChevronDown className={cx("size-4 transition-transform", fwOpen && "rotate-180")} aria-hidden />
            {t("Tường lửa Windows (quản trị viên chạy)")}
          </button>
          {fwOpen && (
            <>
              <p className="text-xs text-ink-3">{t("Chỉ cần khi tường lửa Windows đang chặn. Mở PowerShell bằng quyền quản trị viên rồi chạy — app không tự sửa tường lửa.")}</p>
              <Copyable text={fw} label={t("Chép lệnh mở tường lửa")} />
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink-2">
            {t("2. Cấu hình proxy HTTPS của anh: giữ Host, không xoá Origin, chuyển tới")}{" "}<span className="font-mono text-xs text-ink">http://127.0.0.1:{api.port}</span>.
          </span>
          <Segmented size="sm" label={t("Mẫu cấu hình proxy")} value={sample} onChange={setSample} options={[{ value: "caddy", label: "Caddy" }, { value: "nginx", label: "nginx" }]} />
          <CodeBlock code={sample === "caddy" ? caddyConfig(d.host, api.port) : nginxConfig(d.host, api.port)} label={t("Chép mẫu {value}", { value: sample === "caddy" ? "Caddy" : "nginx" })} />
        </div>
      )}
    </div>
  );
}

export function DomainCard({ api }: { api: ApiStatus }) {
  const d = api.domain;
  const [host, setHost] = useState(d.host);
  const [proxy, setProxy] = useState<ApiDomainProxy>(d.proxy);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    if (!d.enabled) {
      setHost(d.host);
      setProxy(d.proxy);
    }
  }, [d.enabled, d.host, d.proxy]);

  const parsed = host.trim() ? normalizeDomain(host, { namedHost: api.namedHost }) : null;
  const inputError = serverError ?? (touched && parsed && !parsed.ok ? parsed.error : null);
  const pill = STATE_PILL[d.state];

  const enable = async () => {
    setTouched(true);
    setServerError(null);
    const p = normalizeDomain(host, { namedHost: api.namedHost });
    if (!p.ok) return;
    setConfirm(p.host);
  };
  const confirmed = async () => {
    const h = confirm;
    setConfirm(null);
    if (!h) return;
    setSaving(true);
    try {
      await call("api.setDomain", { enabled: true, host: h, proxy, confirmInternet: true }, { quiet: true });
      pushToast({ tone: "ok", title: t("Đã bật tên miền — app đang kiểm từng bước") }, 3500);
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const checkNow = async () => {
    setChecking(true);
    await act("api.domainCheck");
    setChecking(false);
  };

  return (
    <section className="glass-card mb-4 rounded-lg p-5" aria-labelledby="domain-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="domain-title" className="text-md font-semibold text-ink">
            {t("Tên miền trỏ về máy này")}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t("Gọi thẳng vào máy qua HTTPS, không qua đường hầm. Đường hầm vẫn chạy trong lúc chờ.")}</p>
        </div>
        {d.enabled && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<RefreshCw className={cx("size-4", checking && "animate-spin")} />} disabled={checking || d.state === "preparing"} onClick={() => void checkNow()}>
              {t("Kiểm lại ngay")}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => void act("api.setDomain", { enabled: false }, t("Đã tắt tên miền — đường hầm không bị ảnh hưởng"))}>
              {t("Tắt tên miền")}
            </Button>
          </div>
        )}
      </div>

      {!d.enabled ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void enable();
          }}
        >
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Field label={t("Tên miền")} htmlFor="domain-host" hint={t("Tên miền con anh quản lý DNS, ví dụ api.tenmiencuaanh.com")} error={inputError}>
              <TextInput
                id="domain-host"
                value={host}
                invalid={!!inputError}
                onChange={(e) => {
                  setHost(e.target.value);
                  setServerError(null);
                }}
                onBlur={() => setTouched(true)}
                placeholder={t("api.tenmiencuaanh.com")}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">{t("Kiểu HTTPS")}</span>
              <Segmented
                label={t("Kiểu HTTPS")}
                value={proxy}
                onChange={setProxy}
                options={[
                  { value: "managed", label: t("App tự chạy HTTPS") },
                  { value: "external", label: t("Proxy HTTPS có sẵn") },
                ]}
              />
            </div>
          </div>
          <p className="text-sm text-ink-2">
            {proxy === "managed"
              ? t("App chạy Caddy ẩn trên cổng 80/443 và tự xin chứng chỉ Let's Encrypt. Cần cổng 443 trống.")
              : t("Máy đã có Caddy, nginx hay IIS phục vụ HTTPS: app không chạy proxy, chỉ kiểm tên miền và đưa mẫu cấu hình.")}
          </p>
          <div>
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!host.trim()}>
              {t("Bật tên miền")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2" role="status">
            <span className="min-w-0 truncate font-mono text-sm text-ink" title={d.host}>
              {d.host}
            </span>
            <Pill tone={pill.tone}>{t(pill.label)}</Pill>
            <span className="text-xs text-ink-3">{d.proxy === "managed" ? t("App tự chạy HTTPS") : t("Proxy HTTPS có sẵn")}</span>
          </div>

          {d.state === "online" && d.url && <Copyable text={d.url} label={t("Chép địa chỉ tên miền")} />}

          {d.state === "error" && d.error && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-danger-soft px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-danger-ink" aria-hidden />
              <span className="min-w-0 flex-1 text-sm text-ink">{d.error}</span>
              <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void act("api.domainRetry")}>
                {t("Thử lại")}
              </Button>
            </div>
          )}
          {d.state !== "error" && d.error && (
            <p className="flex items-center gap-2 text-sm text-attention-ink" role="status">
              <Spinner className="text-attention-ink" />
              {t("{error} — chạy lại (lần {attempt}/5)…", { error: d.error, attempt: d.attempt })}
            </p>
          )}
          {d.state === "preparing" && !d.error && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-ink" role="status">
                <Spinner />
                {d.progress !== null ? t("Đang tải Caddy… {progress}%", { progress: Math.round(d.progress * 100) }) : t("Đang chạy Caddy…")}
              </div>
              {d.progress !== null && (
                <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-ink/10" aria-hidden>
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </div>
              )}
            </div>
          )}

          <Steps steps={d.steps} />
          {d.notes.length > 0 && (
            <ul className="flex flex-col gap-1">
              {d.notes.map((n) => (
                <li key={n} className="flex items-start gap-2 text-sm text-attention-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-3">
            {t("Kiểm từ chính máy này — máy ở xa có thể khác (NAT, DNS nội bộ).{value}", { value: d.checkedAt ? t(" Kiểm lần cuối {value}.", { value: formatTime(d.checkedAt) }) : "" })}
          </p>

          {d.state === "online" && !showGuide ? (
            <button type="button" onClick={() => setShowGuide(true)} className="inline-flex w-fit items-center gap-1 rounded-md text-sm font-medium text-ink-2 hover:text-ink">
              <ChevronDown className="size-4" aria-hidden />
              {t("Xem hướng dẫn")}
            </button>
          ) : (
            <Guide api={api} />
          )}
        </div>
      )}

      <Confirm
        open={!!confirm}
        title={t("Mở API ra Internet?")}
        body={
          <div className="space-y-2">
            <p>{t("Ai có khoá API đều tạo được ảnh/video bằng hạn mức Muse của anh, từ bất cứ đâu, qua https://{confirm}.", { confirm })}</p>
            {proxy === "managed" ? (
              <p>{t("HTTPS kết thúc ngay trên máy này. App tải Caddy (≈ 18 MB, kiểm mã SHA-256) ở lần đầu, chạy ẩn và tự xin, gia hạn chứng chỉ Let's Encrypt; tắt tên miền, tắt API hoặc thoát app là dừng.")}</p>
            ) : (
              <p>{t("App không chạy proxy; proxy HTTPS của anh chuyển lời gọi tới http://127.0.0.1:{port}.", { port: api.port })}</p>
            )}
            <p>{t("App không sửa DNS hay tường lửa — anh làm theo hướng dẫn hiện ra sau khi bật. Đường hầm (nếu đang chạy) vẫn giữ nguyên.")}</p>
          </div>
        }
        confirmLabel={t("Mở ra Internet")}
        cancelLabel={t("Thôi")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmed()}
      />
    </section>
  );
}

/** R38 — address picker for the snippets (domain → tunnel → LAN → this machine). */
export function AddressPicker({ urls, value, onChange }: { urls: AgentUrl[]; value: string; onChange: (url: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t("Địa chỉ cho agent")} className="flex flex-wrap gap-1.5">
      {urls.map((u) => {
        const on = u.url === value;
        const status = u.internet ? (u.online ? t("Trực tuyến") : t("chưa trực tuyến")) : null;
        return (
          <button
            key={`${u.via}-${u.url}`}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(u.url)}
            title={u.url}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
              on ? "border-accent bg-accent-soft text-ink" : "border-line bg-ink/5 text-ink-2 hover:text-ink",
            )}
          >
            <span className={cx("size-2 rounded-full", u.online ? "bg-ok" : "bg-attention")} aria-hidden />
            {t(AGENT_VIA_LABEL[u.via])}
            {status && <span className="text-ink-3">· {status}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const UNREACHABLE_NOTE = "Địa chỉ này chưa trực tuyến — agent ở xa chưa gọi được.";
export { DOMAIN_MSG, hhmm };
