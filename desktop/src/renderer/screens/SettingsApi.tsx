import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_KEY_MAX_ACTIVE, API_KEY_NAME_MAX } from "@shared/api/constants";
import { formatDateTime, formatTime } from "@shared/format";
import type { ApiAccess, ApiKeyView, ApiRequestLog, ApiScope, ApiStatus, OAuthClient } from "@shared/types";
import { Confirm, Dialog } from "../components/Overlay";
import { Button, Field, IconButton, Pill, Segmented, Spinner, Switch, TextInput } from "../components/ui";
import { agentTemplates, pickAgentUrl } from "../lib/agentTemplates";
import { act, call } from "../lib/api";
import { pushToast, useUi } from "../lib/store";
import { cx } from "../lib/ui";
import { AddressPicker, DOMAIN_MSG, DomainCard, UNREACHABLE_NOTE } from "./SettingsDomain";
import { t } from "@shared/i18n";

// S09d Cài đặt › API & agent and S09e Tạo khoá (screens §10, spec F12 / §4.8).

const ACCESS_OPTIONS: { value: ApiAccess; label: string }[] = [
  { value: "local", label: "Chỉ máy này" },
  { value: "lan", label: "Mạng riêng" },
  { value: "cloudflare_quick", label: "Đường hầm tạm thời" },
  { value: "cloudflare_named", label: "Đường hầm có tên" },
];

const SCOPE_LABEL: Record<ApiScope, string> = { generate: "Tạo và huỷ", read: "Chỉ xem tình trạng" };

function copy(text: string, what = t("Đã chép")) {
  void navigator.clipboard.writeText(text).then(
    () => pushToast({ tone: "ok", title: what }, 2500),
    () => pushToast({ tone: "danger", title: t("Không chép được — chọn chữ rồi bấm Ctrl+C") }),
  );
}

function Card({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="glass-card mb-4 rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-semibold text-ink">{title}</h2>
          {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function CodeLine({ text, label, autoFocus }: { text: string; label: string; autoFocus?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ink/5 px-3 py-2 font-mono text-xs text-ink" data-selectable title={text}>
        {text}
      </code>
      <IconButton label={label} size="sm" onClick={() => copy(text)} data-autofocus={autoFocus ? "" : undefined}>
        <Copy className="size-4" />
      </IconButton>
    </div>
  );
}

export function ApiSettings() {
  const api = useUi((s) => s.snap?.api);
  const [confirmAccess, setConfirmAccess] = useState<ApiAccess | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api) return <Spinner label={t("Đang tải")} />;

  const pickAccess = (v: ApiAccess) => {
    if (v === api.access) return;
    if (v === "cloudflare_quick" || v === "cloudflare_named") setConfirmAccess(v);
    else void act("api.setAccess", { access: v });
  };

  return (
    <>
      <EnableCard api={api} busy={busy} setBusy={setBusy} />
      {api.enabled && (
        <Card title={t("Cho máy khác gọi tới")} sub={t("Mặc định chỉ chương trình trên chính máy này gọi được. Khoá API vẫn luôn bắt buộc.")}>
          <div className="max-w-full overflow-x-auto">
            <Segmented label={t("Cho máy khác gọi tới")} value={api.access} onChange={pickAccess} options={ACCESS_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />
          </div>
          <AccessDetail api={api} />
        </Card>
      )}
      {api.enabled && <DomainCard api={api} />}
      <KeysCard api={api} />
      {api.enabled && <AppsCard api={api} />}
      {api.enabled && <AgentCard api={api} />}
      {api.enabled && <LogCard />}
      <Confirm
        open={!!confirmAccess}
        title={t("Mở API ra Internet?")}
        body={
          <div className="space-y-2">
            <p>{t("Ai có khoá API đều tạo được ảnh/video bằng hạn mức Muse của anh, từ bất cứ đâu.")}</p>
            <p>{t("Lời gọi đi qua máy chủ Cloudflare. App tải bộ kết nối cloudflared (≈ 55 MB, kiểm mã SHA-256) ở lần đầu và chạy ẩn; tắt API hoặc thoát app là dừng chia sẻ.")}</p>
          </div>
        }
        confirmLabel={t("Mở ra Internet")}
        cancelLabel={t("Thôi")}
        onCancel={() => setConfirmAccess(null)}
        onConfirm={() => {
          const v = confirmAccess;
          setConfirmAccess(null);
          if (v) void act("api.setAccess", { access: v, confirmInternet: true });
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ card 1
function EnableCard({ api, busy, setBusy }: { api: ApiStatus; busy: boolean; setBusy: (v: boolean) => void }) {
  const [advanced, setAdvanced] = useState(!!api.error);
  const [port, setPort] = useState(String(api.port));
  useEffect(() => setPort(String(api.port)), [api.port]);
  useEffect(() => {
    if (api.error) setAdvanced(true);
  }, [api.error]);
  const portNum = Number(port);
  const portValid = /^\d+$/.test(port) && portNum >= 1024 && portNum <= 65535;
  const where = api.access === "lan" ? t("mọi giao diện mạng, chỉ nhận mạng riêng") : `127.0.0.1:${api.port}`;
  return (
    <Card
      title={t("API cho agent")}
      sub={t("Cho Claude, Cursor, n8n hay agent của anh gửi lượt tạo ảnh/video vào hàng chờ của máy này — cùng luật như khi anh bấm trong Studio.")}
      actions={
        <Switch
          label={t("Bật API cho agent")}
          checked={api.enabled}
          disabled={busy}
          onChange={async (v) => {
            setBusy(true);
            await act("api.setEnabled", { enabled: v });
            setBusy(false);
          }}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
        {!api.enabled ? (
          <Pill tone="neutral">{t("Đang tắt")}</Pill>
        ) : api.listening ? (
          <>
            <Pill tone="ok">{t("Đang chạy")}</Pill>
            <span className="font-mono text-xs text-ink">{where}</span>
          </>
        ) : api.error ? (
          <>
            <Pill tone="danger">{t("Chưa chạy")}</Pill>
            <span className="text-danger-ink">{api.error}</span>
            {api.suggestedPort && (
              <Button size="sm" variant="secondary" onClick={() => void act("api.setPort", { port: api.suggestedPort! }, t("Đã đổi sang cổng {suggestedPort}", { suggestedPort: api.suggestedPort }))}>
                {t("Dùng cổng {suggestedPort}", { suggestedPort: api.suggestedPort })}
              </Button>
            )}
          </>
        ) : (
          <Spinner label={t("Đang mở cổng")} />
        )}
      </div>
      {!api.enabled && <p className="text-sm text-ink-2">{t("Khi tắt, app không mở cổng mạng nào cho agent. Bật lên thì app chỉ nghe trên chính máy này cho tới khi anh chọn cho máy khác gọi tới.")}</p>}
      {!api.enabled && api.domain.enabled && api.domain.proxy === "external" && (
        <p className="flex items-start gap-2 text-sm text-attention-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(DOMAIN_MSG.external502)}
        </p>
      )}
      {api.enabled && (
        <div>
          <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-ink-2 hover:text-ink">
            <ChevronDown className={cx("size-4 transition-transform", advanced && "rotate-180")} aria-hidden />
            {t("Nâng cao")}
          </button>
          {advanced && (
            <form
              className="mt-3 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (portValid && portNum !== api.port) void act("api.setPort", { port: portNum }, t("Đã đổi sang cổng {portNum}", { portNum }));
              }}
            >
              <div className="w-40">
                <Field label={t("Cổng")} htmlFor="api-port" error={port && !portValid ? "1024–65535" : null}>
                  <TextInput id="api-port" inputMode="numeric" value={port} invalid={!!port && !portValid} onChange={(e) => setPort(e.target.value.trim())} />
                </Field>
              </div>
              <Button type="submit" size="sm" disabled={!portValid || portNum === api.port}>
                {t("Đổi cổng")}
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ card 2 detail
function TunnelState({ api }: { api: ApiStatus }) {
  const cur = api.tunnel;
  if (cur.state === "online" && cur.url)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="ok">{t("Trực tuyến")}</Pill>
        <div className="min-w-[240px] flex-1">
          <CodeLine text={cur.url} label={t("Chép địa chỉ")} />
        </div>
        <Button size="sm" onClick={() => void act("api.setAccess", { access: "local" }, t("Đã dừng chia sẻ"))}>
          {t("Dừng chia sẻ")}
        </Button>
      </div>
    );
  if (cur.state === "error")
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-danger-soft px-4 py-3">
        <AlertTriangle className="size-4 shrink-0 text-danger-ink" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-ink">{cur.error}</span>
        <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void act("api.retryTunnel")}>
          {t("Thử lại")}
        </Button>
      </div>
    );
  const label =
    cur.state === "downloading"
      ? t("Đang tải bộ kết nối… {progress}%", { progress: Math.round((cur.progress ?? 0) * 100) })
      : cur.state === "verifying"
        ? t("Đang kiểm địa chỉ công khai…")
        : cur.state === "retrying"
          ? t("Mất kết nối, đang thử lại (lần {attempt}/5)…", { attempt: cur.attempt })
          : t("Đang kết nối tới Cloudflare…");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-ink" role="status">
        <Spinner />
        {label}
      </div>
      {cur.state === "downloading" && (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-ink/10" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((cur.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {cur.state === "retrying" && cur.error && <p className="text-sm text-ink-2">{cur.error}</p>}
    </div>
  );
}

function AccessDetail({ api }: { api: ApiStatus }) {
  if (api.access === "local") return <p className="text-sm text-ink-2">{t("Chỉ chương trình chạy trên máy này (ví dụ Claude Code, n8n cài cùng máy) gọi được, qua địa chỉ {localUrl}.", { localUrl: api.localUrl ?? `http://127.0.0.1:${api.port}` })}</p>;
  if (api.access === "lan") {
    const fw = `New-NetFirewallRule -DisplayName "Muse4AI API" -Direction Inbound -Protocol TCP -LocalPort ${api.port} -Action Allow -Profile Private`;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">{t("Máy trong mạng nội bộ hoặc Tailscale gọi được; địa chỉ từ Internet công cộng bị từ chối. Địa chỉ của máy này:")}</p>
        {api.lanUrls.length ? api.lanUrls.map((u) => <CodeLine key={u} text={u} label={t("Chép địa chỉ")} />) : <p className="text-sm text-ink-2">{t("Không thấy địa chỉ mạng riêng nào.")}</p>}
        <p className="text-sm text-ink-2">{t("Nếu máy khác không gọi tới được, quản trị viên mở tường lửa Windows bằng lệnh PowerShell dưới (app không tự sửa tường lửa):")}</p>
        <CodeLine text={fw} label={t("Chép lệnh mở tường lửa")} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {api.access === "cloudflare_named" && <NamedTunnelForm api={api} />}
      {(api.access === "cloudflare_quick" || (api.namedHost && api.tunnel.hasToken)) && <TunnelState api={api} />}
      {api.access === "cloudflare_quick" && (
        <p className="flex items-start gap-2 text-sm text-attention-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("Địa chỉ tạm thời đổi mỗi lần mở app và không cam kết chạy liên tục — khi chạy thật dùng Tên miền trỏ về máy (thẻ dưới) hoặc đường hầm có tên.")}
        </p>
      )}
    </div>
  );
}

function NamedTunnelForm({ api }: { api: ApiStatus }) {
  const [host, setHost] = useState(api.namedHost);
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(!api.tunnel.hasToken);
  const [saving, setSaving] = useState(false);
  useEffect(() => setReplacing(!api.tunnel.hasToken), [api.tunnel.hasToken]);
  const needToken = replacing || !api.tunnel.hasToken;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const r = await act("api.setNamedTunnel", { hostname: host, token: needToken && token ? token : undefined }, t("Đã lưu đường hầm riêng"));
        setSaving(false);
        if (r) setToken("");
      }}
    >
      <p className="text-sm text-ink-2">
        {t("Trong Cloudflare Zero Trust › Networks › Tunnels: tạo đường hầm kiểu Cloudflared, chép token; thêm Public Hostname là tên miền dưới đây với Service")}{" "}<span className="font-mono text-xs text-ink">http://127.0.0.1:{api.port}</span>.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("Tên miền")} htmlFor="named-host" hint={t("Ví dụ muse.tenmiencuaanh.com")}>
          <TextInput id="named-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder={t("muse.tenmiencuaanh.com")} autoComplete="off" spellCheck={false} />
        </Field>
        {needToken ? (
          <Field label={t("Token đường hầm")} htmlFor="named-token" hint={t("Lưu mã hoá bằng Windows, không hiện lại")}>
            <TextInput id="named-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">{t("Token đường hầm")}</span>
            <div className="flex h-10 items-center gap-2">
              <Pill tone="ok" icon={<KeyRound className="size-3" aria-hidden />}>
                {t("Đã lưu trong kho bí mật")}
              </Pill>
              <Button size="sm" variant="quiet" onClick={() => setReplacing(true)}>
                {t("Thay")}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => void act("api.clearTunnelToken", {}, t("Đã xoá token"))}>
                {t("Xoá")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div>
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!host.trim() || (needToken && !token.trim())}>
          {t("Lưu và kết nối")}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ card 3 keys
function KeysCard({ api }: { api: ApiStatus }) {
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<ApiKeyView | null>(null);
  const active = api.keys.filter((k) => !k.revokedAt);
  const revoked = api.keys.filter((k) => k.revokedAt);
  const full = active.length >= API_KEY_MAX_ACTIVE;
  return (
    <Card
      title={t("Khoá API")}
      sub={t("Mỗi agent một khoá. Khoá chỉ hiện một lần lúc tạo; app chỉ giữ bản băm. Thu hồi là chặn ngay lần gọi kế tiếp.")}
      actions={
        <Button variant="primary" size="sm" icon={<Plus className="size-4" />} disabled={full} title={full ? t("Đã đủ {API_KEY_MAX_ACTIVE} khoá — thu hồi bớt khoá cũ", { API_KEY_MAX_ACTIVE }) : undefined} onClick={() => setCreating(true)}>
          {t("Tạo khoá")}
        </Button>
      }
    >
      {full && <p className="text-sm text-attention-ink">{t("Đã đủ {API_KEY_MAX_ACTIVE} khoá còn hiệu lực — thu hồi bớt khoá cũ để tạo khoá mới.", { API_KEY_MAX_ACTIVE })}</p>}
      {active.length === 0 ? (
        <p className="text-sm text-ink-2">{t("Chưa có khoá nào.")}</p>
      ) : (
        <div>
          {/* Fixed layout: fits the 1024 × 728 minimum window without sideways scrolling (AC-API-24). */}
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col />
              <col className="w-[168px]" />
              <col className="w-[104px]" />
              <col className="w-[112px]" />
              <col className="w-[104px]" />
            </colgroup>
            <thead className="text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">{t("Tên")}</th>
                <th className="py-2 pr-3 font-medium">{t("Quyền")}</th>
                <th className="py-2 pr-3 font-medium">{t("Tạo lúc")}</th>
                <th className="py-2 pr-3 font-medium">{t("Dùng gần nhất")}</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">{t("Thao tác")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {active.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="truncate font-medium text-ink" title={k.name}>
                      {k.name}
                    </div>
                    <div className="truncate font-mono text-xs text-ink-3">{k.prefix}…</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Pill tone={k.scope === "generate" ? "accent" : "neutral"}>{t(SCOPE_LABEL[k.scope])}</Pill>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-ink-2">{formatDateTime(k.createdAt)}</td>
                  <td className="py-2.5 pr-3 text-xs text-ink-2">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : t("Chưa dùng")}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="quiet" icon={<Trash2 className="size-4" />} onClick={() => setRevoke(k)}>
                      {t("Thu hồi")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoked.length > 0 && <p className="text-sm text-ink-3">{t("Đã thu hồi: {value}", { value: revoked.map((k) => k.name).join(", ") })}</p>}
      <CreateKeyDialog open={creating} onClose={() => setCreating(false)} api={api} />
      <Confirm
        open={!!revoke}
        danger
        title={t("Thu hồi khoá “{name}”?", { name: revoke?.name ?? "" })}
        body={t("Agent dùng khoá này bị từ chối ngay ở lần gọi kế tiếp. Lượt đã gửi vẫn chạy tiếp trong hàng chờ. Không hoàn tác được.")}
        confirmLabel={t("Thu hồi")}
        onCancel={() => setRevoke(null)}
        onConfirm={() => {
          const k = revoke;
          setRevoke(null);
          if (k) void act("api.revokeKey", { id: k.id }, t("Đã thu hồi “{name}”", { name: k.name }));
        }}
      />
    </Card>
  );
}

function AppsCard({ api }: { api: ApiStatus }) {
  const [revoke, setRevoke] = useState<OAuthClient | null>(null);
  const pending = api.oauth.pending;
  const clients = api.oauth.clients;
  return (
    <Card
      title={t("Ứng dụng đã kết nối")}
      sub={t("Agent kết nối bằng OAuth, không cần bạn đưa khoá API. Khi có app xin kết nối, mã 6 số hiện ở đây và bạn gõ mã đó vào trang xác nhận trong trình duyệt.")}
    >
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((p) => (
            <div key={p.id} className="rounded-[12px] border border-accent/40 bg-accent/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{t("{client} đang xin kết nối", { client: p.clientName })}</div>
                  <div className="truncate text-xs text-ink-2">
                    {t("Quay về")}: {p.redirectHost}
                  </div>
                </div>
                <div className="shrink-0 text-center">
                  <div className="font-mono text-2xl font-semibold tracking-[0.3em] text-accent" data-selectable>
                    {p.pairing}
                  </div>
                  <div className="text-[11px] text-ink-3">{t("Còn {n} lần nhập", { n: p.triesLeft })}</div>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-2">{t("Gõ đúng 6 số này vào trang xác nhận đang mở trong trình duyệt.")}</p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => void act("api.dismissConsent", { id: p.id }, t("Đã bỏ yêu cầu kết nối"))}
                >
                  {t("Bỏ qua")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {clients.length === 0 ? (
        <p className="text-sm text-ink-2">{t("Chưa có ứng dụng nào kết nối.")}</p>
      ) : (
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col />
            <col className="w-[168px]" />
            <col className="w-[104px]" />
            <col className="w-[112px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead className="text-ink-2">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">{t("Tên")}</th>
              <th className="py-2 pr-3 font-medium">{t("Quyền")}</th>
              <th className="py-2 pr-3 font-medium">{t("Tạo lúc")}</th>
              <th className="py-2 pr-3 font-medium">{t("Dùng gần nhất")}</th>
              <th className="py-2 font-medium">
                <span className="sr-only">{t("Thao tác")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="truncate font-medium text-ink" title={c.name}>
                    {c.name}
                  </div>
                  <div className="truncate font-mono text-xs text-ink-3">{c.id}</div>
                </td>
                <td className="py-2.5 pr-3">
                  <Pill tone={c.scope.includes("generate") ? "accent" : "neutral"}>{t(c.scope.includes("generate") ? "Tạo và huỷ" : "Chỉ xem tình trạng")}</Pill>
                </td>
                <td className="py-2.5 pr-3 text-xs text-ink-2">{formatDateTime(c.createdAt)}</td>
                <td className="py-2.5 pr-3 text-xs text-ink-2">{c.lastUsedAt ? formatDateTime(c.lastUsedAt) : t("Chưa dùng")}</td>
                <td className="py-2.5 text-right">
                  <Button size="sm" variant="quiet" icon={<Trash2 className="size-4" />} onClick={() => setRevoke(c)}>
                    {t("Ngắt kết nối")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Confirm
        open={!!revoke}
        danger
        title={t("Ngắt kết nối “{name}”?", { name: revoke?.name ?? "" })}
        body={t("Ứng dụng mất quyền ngay: mọi token của nó bị chặn ở lần gọi kế tiếp. Muốn dùng lại, nó phải xin kết nối một lần nữa.")}
        confirmLabel={t("Ngắt kết nối")}
        onCancel={() => setRevoke(null)}
        onConfirm={() => {
          const c = revoke;
          setRevoke(null);
          if (c) void act("api.revokeClient", { id: c.id }, t("Đã ngắt kết nối “{name}”", { name: c.name }));
        }}
      />
    </Card>
  );
}

function CreateKeyDialog({ open, onClose, api }: { open: boolean; onClose: () => void; api: ApiStatus }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiScope>("generate");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ key: ApiKeyView; token: string } | null>(null);
  // The dialog stays mounted when the key appears, so its focus trap does not run again: move focus to the copy button
  // ourselves (the submit button that had focus is gone, and keyboard users would otherwise fall back to the page).
  useEffect(() => {
    if (!created) return;
    const timer = requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="dialog"] [data-autofocus]')?.focus());
    return () => cancelAnimationFrame(timer);
  }, [created]);
  const reset = useCallback(() => {
    setName("");
    setScope("generate");
    setError(null);
    setCreated(null);
    onClose();
  }, [onClose]);
  const taken = !!name.trim() && api.keys.some((k) => !k.revokedAt && k.name.toLocaleLowerCase("vi") === name.trim().toLocaleLowerCase("vi"));
  const tooLong = [...name.trim()].length > API_KEY_NAME_MAX;

  const submit = async () => {
    if (!name.trim() || taken || tooLong) return;
    setSaving(true);
    setError(null);
    try {
      setCreated(await call<{ key: ApiKeyView; token: string }>("api.createKey", { name: name.trim(), scope }, { quiet: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <Dialog open={open} onClose={reset} title={t("Khoá “{name}” đã tạo", { name: created.key.name })} width={680} dismissable={false} footer={<Button variant="primary" icon={<Check className="size-4" />} onClick={reset}>{t("Đã chép, đóng")}</Button>}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-md bg-attention-soft px-4 py-3 text-sm text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attention-ink" aria-hidden />
            <span>{t("Chép khoá ngay — đóng hộp thoại này là không xem lại được. Quyền: {value}.", { value: t(SCOPE_LABEL[created.key.scope]) })}</span>
          </div>
          <CodeLine text={created.token} label={t("Chép khoá API")} autoFocus />
          <Templates api={api} token={created.token} />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onClose={reset}
      title={t("Tạo khoá API")}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={reset}>
            {t("Huỷ")}
          </Button>
          <Button variant="primary" loading={saving} disabled={!name.trim() || taken || tooLong} onClick={() => void submit()}>
            {t("Tạo khoá")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("Tên khoá")} htmlFor="key-name" hint={t("Đặt theo agent dùng khoá, ví dụ “Agent n8n”.")} error={taken ? t("Đã có khoá cùng tên") : tooLong ? t("Tối đa {API_KEY_NAME_MAX} ký tự", { API_KEY_NAME_MAX }) : error}>
          <TextInput id="key-name" data-autofocus value={name} invalid={taken || tooLong} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Agent n8n" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t("Quyền")}</span>
          <Segmented label={t("Quyền của khoá")} value={scope} onChange={setScope} options={[{ value: "generate", label: t("Tạo và huỷ") }, { value: "read", label: t("Chỉ xem tình trạng") }]} />
          <p className="text-sm text-ink-2">{scope === "generate" ? t("Gửi lượt, huỷ lượt, xem và tải kết quả của chính khoá này.") : t("Chỉ xem tình trạng máy: số tài khoản sẵn sàng, kiểu tạo đang bật. Không gửi được lượt và không thấy lượt của khoá khác — hợp cho bảng theo dõi hoặc bước kiểm tra trước khi gửi.")}</p>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ card 4 agents
function Templates({ api, token, base: baseIn }: { api: ApiStatus; token?: string; base?: string }) {
  const base = baseIn ?? pickAgentUrl(api.urls, null, api.port).url;
  const list = useMemo(() => agentTemplates(base, token), [base, token]);
  const [tab, setTab] = useState(list[0].id);
  const cur = list.find((x) => x.id === tab) ?? list[0];
  const isPublic = base.startsWith("https://");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label={t("Mẫu kết nối agent")} className="flex flex-wrap gap-1.5">
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === cur.id}
            onClick={() => setTab(x.id)}
            className={cx("h-8 rounded-full px-3 text-sm font-medium transition-colors", x.id === cur.id ? "bg-ink text-on-ink" : "bg-ink/5 text-ink-2 hover:text-ink")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-2" role="tabpanel">
        {cur.note}
        {cur.needsPublic && !isPublic && <span className="text-attention-ink">{" "}{t("Hiện API chưa mở ra Internet nên mẫu này chưa dùng được từ OpenAI.")}</span>}
      </p>
      <div className="relative min-w-0">
        <pre className="scroll-area max-h-56 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-[12px] bg-ink/5 p-3 pr-12 font-mono text-xs leading-5 text-ink" data-selectable>
          {cur.code}
        </pre>
        <IconButton label={t("Chép mẫu {label}", { label: cur.label })} size="sm" className="absolute right-2 top-2" onClick={() => copy(cur.code, t("Đã chép mẫu {label}", { label: cur.label }))}>
          <Copy className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

function AgentCard({ api }: { api: ApiStatus }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const cur = pickAgentUrl(api.urls, chosen, api.port);
  const internet = api.urls.filter((u) => u.internet);
  return (
    <Card
      title={t("Kết nối agent")}
      sub={t("Mẫu cấu hình dùng địa chỉ anh chọn dưới đây; thay {API_KEY} bằng khoá anh đã chép lúc tạo.")}
      actions={
        <Button size="sm" variant="quiet" icon={<ExternalLink className="size-4" />} disabled={!api.listening} onClick={() => void act("api.openDocs")}>
          {t("Tài liệu API (OpenAPI)")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">{t("Địa chỉ cho agent")}</span>
        <AddressPicker urls={api.urls} value={cur.url} onChange={setChosen} />
        <CodeLine text={cur.url} label={t("Chép địa chỉ cho agent")} />
        {cur.internet && !cur.online && (
          <p className="flex items-start gap-2 text-sm text-attention-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(UNREACHABLE_NOTE)}
          </p>
        )}
      </div>
      {internet.length >= 2 && (
        <div className="flex flex-col gap-2 rounded-md bg-ink/[0.03] p-4">
          <h3 className="text-sm font-semibold text-ink">{t("Dự phòng")}</h3>
          {internet.map((u) => (
            <CodeLine key={u.url} text={u.url} label={t("Chép địa chỉ {value}", { value: u.via === "domain" ? t("tên miền") : t("đường hầm") })} />
          ))}
          <p className="text-sm text-ink-2">{t("Một địa chỉ lỗi thì gửi lại qua địa chỉ còn lại với cùng Idempotency-Key (MCP: cùng request_id) — app trả đúng lượt cũ, không tạo lượt trùng. Link tải mới lấy bằng GET /v1/jobs/{id} qua địa chỉ đang chạy.")}</p>
        </div>
      )}
      <Templates api={api} base={cur.url} />
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ card 5 log
const VIA_LABEL: Record<ApiRequestLog["via"], string> = { local: "Máy này", lan: "Mạng riêng", tunnel: "Đường hầm", domain: "Tên miền" };

function LogCard() {
  const [rows, setRows] = useState<ApiRequestLog[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await call<ApiRequestLog[]>("api.requestLog", { limit: 50 }, { quiet: true }));
    } catch {
      /* keep the previous rows */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <Card
      title={t("Nhật ký gọi API")}
      sub={t("50 lần gọi gần nhất. Không ghi khoá, prompt hay link tải; IP đã che. Giữ 14 ngày.")}
      actions={
        <IconButton label={t("Làm mới nhật ký")} size="sm" onClick={() => void load()}>
          <RefreshCw className={cx("size-4", loading && "animate-spin")} />
        </IconButton>
      }
    >
      {!rows ? (
        <Spinner label={t("Đang tải")} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-2">{t("Chưa có lần gọi nào.")}</p>
      ) : (
        <div className="scroll-area max-h-80 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[72px]" />
              <col />
              <col />
              <col className="w-[124px]" />
              <col className="w-[64px]" />
            </colgroup>
            <thead className="sticky top-0 bg-surface text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">{t("Giờ")}</th>
                <th className="py-2 pr-3 font-medium">{t("Khoá · đường vào")}</th>
                <th className="py-2 pr-3 font-medium">{t("Thao tác")}</th>
                <th className="py-2 pr-3 font-medium">{t("Kết quả")}</th>
                <th className="py-2 font-medium">{t("Độ trễ")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-ink-2">{formatTime(r.ts)}</td>
                  <td className="py-2 pr-3">
                    <div className="truncate text-ink" title={r.keyName ?? undefined}>
                      {r.keyName ?? "—"}
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {t(VIA_LABEL[r.via])}
                      {r.ipMasked ? <span className="font-mono"> · {r.ipMasked}</span> : null}
                    </div>
                  </td>
                  <td className="truncate py-2 pr-3 font-mono text-xs text-ink" title={`${r.method} ${r.route}`}>
                    {r.method} {r.route}
                  </td>
                  <td className="py-2 pr-3">
                    <Pill tone={r.status < 300 ? "ok" : r.status < 500 ? "attention" : "danger"}>{r.status}</Pill>
                    {r.code && (
                      <div className="mt-0.5 truncate font-mono text-xs text-ink-3" title={r.code}>
                        {r.code}
                      </div>
                    )}
                  </td>
                  <td className="py-2 font-mono text-xs text-ink-2">{r.durationMs >= 1000 ? `${(r.durationMs / 1000).toFixed(1)} s` : `${r.durationMs} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
