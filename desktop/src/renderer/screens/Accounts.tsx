import { AppWindow, Check, Eye, Gauge, Globe, LogIn, MonitorPlay, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Shield, ShieldCheck, Trash2, Unplug, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITY_LABEL } from "@shared/capabilities";
import { QUOTA_TIER_CHIP, quotaView } from "@shared/quota";
import { ALIAS_MAX } from "@shared/constants";
import { formatLatency, formatNumber, formatTime } from "@shared/format";
import type { Account, CapabilityKey, Proxy } from "@shared/types";
import { validateAlias } from "@shared/validate";
import { namesSummary, proxyUsers, suggestProxy } from "@shared/proxyShare";
import { Avatar } from "../components/Avatar";
import { ProxyPicker } from "../components/ProxyPicker";
import { Confirm, Dialog, Menu } from "../components/Overlay";
import { Button, Empty, Field, IconButton, Pill, SectionTitle, Spinner, TextInput } from "../components/ui";
import { act, call } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { pushToast, useUi, type LoginProgressView } from "../lib/store";
import { accountStatus, AVATARS, avatarNames, cx } from "../lib/ui";
import { QuotaPanel } from "./QuotaPanel";
import { ExecutionBlock } from "./Execution";
import { t, tc } from "@shared/i18n";

// S07 roster · S07a add · S07b preview · S07c takeover/login · S07d remove (AC-ACC-*).

export function Accounts() {
  const r = useRoute();
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const proxies = useUi((s) => s.snap?.proxies ?? []);
  const [adding, setAdding] = useState(false);
  const [rename, setRename] = useState<Account | null>(null);
  const [changeProxy, setChangeProxy] = useState<Account | null>(null);
  const [remove, setRemove] = useState<Account | null>(null);
  const [takeoverAsk, setTakeoverAsk] = useState<Account | null>(null);
  const focus = new URLSearchParams(r.path.split("?")[1] ?? "").get("focus");
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (focus) cardRefs.current.get(focus)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);
  const previewId = r.name === "accounts" && r.panel === "preview" ? r.id : undefined;
  const takeoverId = r.name === "accounts" && r.panel === "takeover" ? r.id : undefined;
  const takeoverQuery = new URLSearchParams(r.path.split("?")[1] ?? "");
  const takeoverSite = "muse" as const;
  const takeoverLogin = takeoverQuery.get("login") === "1";
  // In-app “Mở” on a “cần đăng nhập lại” notice: open only that site's login step, then show the stepper.
  const loginLinkId = r.name === "accounts" && r.panel === "login" ? r.id : undefined;
  const loginHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!loginLinkId || loginHandled.current === r.path) return;
    loginHandled.current = r.path;
    void act("account.openLogin", { id: loginLinkId, site: takeoverSite }).then((ok) =>
      navigate(ok ? `/accounts/${loginLinkId}/takeover?login=1` : `/accounts?focus=${loginLinkId}`, { replace: true }),
    );
  }, [loginLinkId, takeoverSite, r.path]);

  const startTakeover = (a: Account) => {
    if (a.state === "busy" && a.currentJobId) setTakeoverAsk(a);
    else void act("account.takeoverStart", { id: a.id, mode: "now" }).then(() => navigate(`/accounts/${a.id}/takeover`));
  };

  return (
    <div className="flex h-full">
      <div className="scroll-area min-w-0 flex-1 px-8 pt-6">
        <SectionTitle
          sub={t("{accountsCount} tài khoản · {itemsCount} đang nhận việc", { accountsCount: formatNumber(accounts.length), itemsCount: formatNumber(accounts.filter((a) => a.state === "ready" || a.state === "busy").length) })}
          actions={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              {t("Thêm tài khoản")}
            </Button>
          }
        >
          {tc("nav", "Tài khoản")}
        </SectionTitle>
        {accounts.length === 0 ? (
          <Empty
            icon={<Users className="size-6" />}
            title={t("Chưa có tài khoản nào")}
            body={t("Thêm tài khoản Muse đầu tiên: em gán cho nó một proxy rồi mở cửa sổ để anh đăng nhập. Em không lưu mật khẩu.")}
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                {t("Thêm tài khoản")}
              </Button>
            }
          />
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 pb-8 xl:grid-cols-2 2xl:grid-cols-3">
            {accounts.map((a) => (
              <div key={a.id} ref={(el) => void (el ? cardRefs.current.set(a.id, el) : cardRefs.current.delete(a.id))}>
                <AccountCard account={a} proxy={proxies.find((p) => p.id === a.proxyId) ?? null} sharedWith={a.proxyId ? proxyUsers(a.proxyId, accounts, a.id).map((u) => u.alias) : []} highlight={focus === a.id} onRename={() => setRename(a)} onProxy={() => setChangeProxy(a)} onRemove={() => setRemove(a)} onTakeover={() => startTakeover(a)} />
              </div>
            ))}
          </div>
        )}
      </div>
      {previewId && <PreviewPanel id={previewId} onTakeover={(a) => startTakeover(a)} />}
      {takeoverId && <TakeoverOverlay key={`${takeoverId}${takeoverLogin ? ":login" : ""}`} id={takeoverId} site={takeoverSite} loginMode={takeoverLogin} />}
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      {rename && <RenameDialog account={rename} onClose={() => setRename(null)} />}
      {changeProxy && <ProxyDialog account={changeProxy} onClose={() => setChangeProxy(null)} />}
      {remove && <RemoveDialog account={remove} onClose={() => setRemove(null)} />}
      <Dialog
        open={!!takeoverAsk}
        onClose={() => setTakeoverAsk(null)}
        title={t("{alias} đang tạo một lượt", { alias: takeoverAsk?.alias ?? "" })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTakeoverAsk(null)}>
              {t("Không")}
            </Button>
            <Button
              onClick={() => {
                const a = takeoverAsk!;
                setTakeoverAsk(null);
                void act("account.takeoverStart", { id: a.id, mode: "now" }).then(() => navigate(`/accounts/${a.id}/takeover`));
              }}
            >
              {t("Dừng ngay")}
            </Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                const a = takeoverAsk!;
                setTakeoverAsk(null);
                void act("account.takeoverStart", { id: a.id, mode: "afterCurrent" }, t("Sẽ chuyển sang điều khiển khi xong lượt hiện tại"));
              }}
            >
              {t("Sau lượt hiện tại")}
            </Button>
          </>
        }
      >
        {t("“Dừng ngay” sẽ chuyển lượt đang tạo sang “Cần anh xem” để không gửi trùng. “Sau lượt hiện tại” chờ lượt xong rồi mới mở cửa sổ.")}
      </Dialog>
    </div>
  );
}

function AccountCard({ account: a, proxy, sharedWith, highlight, onRename, onProxy, onRemove, onTakeover }: { account: Account; proxy: Proxy | null; sharedWith: string[]; highlight: boolean; onRename: () => void; onProxy: () => void; onRemove: () => void; onTakeover: () => void }) {
  const st = accountStatus(a);
  const [checking, setChecking] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const needsLogin = a.state === "new" || a.state === "needs_login";
  const caps = (Object.keys(CAPABILITY_LABEL) as CapabilityKey[]).filter((k) => !k.startsWith("vibes.") && a.capabilities[k]);
  const qv = quotaView(a.quota, Date.now());
  const quotaChip = a.state !== "limit_reached" && !qv.stale ? QUOTA_TIER_CHIP[qv.tier] : undefined;
  return (
    <article className={cx("glass-card flex flex-col gap-4 rounded-lg p-5 transition-shadow", highlight && "ring-2 ring-accent")} aria-label={`${a.alias} — ${st.label}`}>
      <header className="flex items-start gap-4">
        <Avatar account={a} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink">{a.alias}</h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Pill tone={st.tone}>{st.label}</Pill>
            {quotaChip && <Pill tone="attention">{t(quotaChip)}</Pill>}
            {a.lastActiveAt && <span className="text-xs text-ink-2">{t("Hoạt động {lastActiveAt}", { lastActiveAt: formatTime(a.lastActiveAt) })}</span>}
          </div>
          {a.stateNote && <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">{t(a.stateNote)}</p>}
        </div>
        <Menu
          label={t("Thao tác cho {alias}", { alias: a.alias })}
          align="end"
          width={250}
          items={[
            {
              label: t("Kiểm phiên đăng nhập"),
              icon: <ShieldCheck className="size-4" />,
              onSelect: async () => {
                setChecking(true);
                const r = await act<Account>("account.checkSession", { id: a.id });
                setChecking(false);
                if (r) pushToast({ tone: r.state === "ready" ? "ok" : "attention", title: `${r.alias}: ${accountStatus(r).label}` }, 3500);
              },
            },
            { label: t("Đọc hạn mức Muse"), icon: <Gauge className="size-4" />, onSelect: () => void act("account.readQuota", { id: a.id }, t("Đã cập nhật hạn mức")) },
            {
              label: t("Xem IP ra của proxy"),
              icon: <Globe className="size-4" />,
              onSelect: async () => {
                const r = await act<{ ip: string | null; country: string | null }>("account.exitIp", { id: a.id });
                if (r) setIp(`${r.ip ?? "?"}${r.country ? ` · ${r.country}` : ""}`);
              },
            },
            { label: "", separator: true },
            a.state === "paused" ? { label: t("Tiếp tục nhận việc"), icon: <Play className="size-4" />, onSelect: () => void act("account.resume", { id: a.id }) } : { label: t("Tạm dừng nhận việc"), icon: <Pause className="size-4" />, onSelect: () => void act("account.pause", { id: a.id }) },
            { label: t("Đổi proxy"), icon: <Unplug className="size-4" />, onSelect: onProxy },
            { label: t("Đổi tên / avatar"), icon: <Pencil className="size-4" />, onSelect: onRename },
            { label: "", separator: true },
            { label: t("Xoá tài khoản"), icon: <Trash2 className="size-4" />, danger: true, onSelect: onRemove },
          ]}
          trigger={(p) => (
            <IconButton label={t("Thao tác cho {alias}", { alias: a.alias })} size="sm" {...p}>
              {checking ? <Spinner /> : <MoreHorizontal className="size-4" />}
            </IconButton>
          )}
        />
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-[12px] bg-ink/4 px-3 py-2">
          <dt className="text-xs text-ink-2">Proxy</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 truncate text-ink">
            {proxy ? (
              <>
                <span className={cx("size-2 shrink-0 rounded-full", proxy.health === "healthy" ? "bg-ok" : proxy.health === "failed" ? "bg-danger" : "bg-neutral")} aria-hidden />
                {proxy.label} · {proxy.country ?? "?"}
                {proxy.latencyMs ? <span className="font-mono text-xs text-ink-2"> {formatLatency(proxy.latencyMs)}</span> : null}
              </>
            ) : (
              <span className="text-danger-ink">{t("Chưa có proxy")}</span>
            )}
          </dd>
          {proxy && sharedWith.length > 0 && (
            <dd className="mt-0.5 truncate text-xs text-ink-2" title={sharedWith.join(", ")}>
              {t("dùng chung với {names}", { names: namesSummary(sharedWith) })}
            </dd>
          )}
          {ip && <dd className="mt-0.5 font-mono text-xs text-ink-2">{t("IP ra {ip}", { ip })}</dd>}
        </div>
        <div className="rounded-[12px] bg-ink/4 px-3 py-2">
          <dt className="text-xs text-ink-2">{t("Hôm nay")}</dt>
          <dd className="mt-0.5 text-ink">{t("{todayCount} lượt", { todayCount: formatNumber(a.todayCount) })}</dd>
        </div>
      </dl>
      <QuotaPanel account={a} />
      <ExecutionBlock account={a} />
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {caps.map((k) => (
            <span key={k} className="rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink-2">
              {t(CAPABILITY_LABEL[k])}
            </span>
          ))}
        </div>
      )}
      <footer className="flex flex-wrap gap-2">
        {needsLogin ? (
          <Button variant="primary" size="sm" icon={<LogIn className="size-4" />} onClick={() => void act("account.openLogin", { id: a.id }).then((r) => r && navigate(`/accounts/${a.id}/takeover?login=1`))} disabled={!a.proxyId} title={!a.proxyId ? t("Gán proxy trước") : undefined}>
            {t("Đăng nhập")}
          </Button>
        ) : a.state === "proxy_error" ? (
          <Button variant="primary" size="sm" icon={<Unplug className="size-4" />} onClick={onProxy}>
            {t("Đổi proxy")}
          </Button>
        ) : a.state === "paused" ? (
          <Button variant="primary" size="sm" icon={<Play className="size-4" />} onClick={() => void act("account.resume", { id: a.id })}>
            {t("Tiếp tục")}
          </Button>
        ) : a.state === "logging_in" || a.state === "takeover" ? (
          <Button variant="primary" size="sm" icon={<MonitorPlay className="size-4" />} onClick={() => navigate(`/accounts/${a.id}/takeover`)}>
            {t("Mở phiên điều khiển")}
          </Button>
        ) : null}
        <Button size="sm" icon={<Eye className="size-4" />} onClick={() => navigate(`/accounts/${a.id}/preview`)}>
          {t("Xem màn hình")}
        </Button>
        {a.state !== "takeover" && a.state !== "logging_in" && (
          <Button size="sm" icon={<MonitorPlay className="size-4" />} onClick={onTakeover} disabled={!a.proxyId}>
            {t("Điều khiển")}
          </Button>
        )}
        {a.state === "checkpoint" && <span className="self-center text-xs text-attention-ink">{t("Mở Điều khiển để tự xác minh trên Muse")}</span>}
      </footer>
    </article>
  );
}

function PreviewPanel({ id, onTakeover }: { id: string; onTakeover: (a: Account) => void }) {
  const account = useUi((s) => s.snap?.accounts.find((a) => a.id === id) ?? null);
  const frame = useUi((s) => s.previews[id]);
  useEffect(() => {
    void call("account.previewStart", { id }, { quiet: true }).catch(() => undefined);
    return () => void call("account.previewStop", { id }, { quiet: true }).catch(() => undefined);
  }, [id]);
  if (!account) return null;
  return (
    <aside className="glass m-3 ml-0 flex w-[min(46vw,620px)] shrink-0 flex-col rounded-lg" aria-label={t("Màn hình của {alias}", { alias: account.alias })}>
      <div className="flex items-center gap-3 px-5 pt-4">
        <Avatar account={account} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-ink">{account.alias}</div>
          <div className="text-xs text-ink-2">{t("Chỉ xem · cập nhật mỗi giây")}</div>
        </div>
        <Button size="sm" variant="primary" onClick={() => onTakeover(account)}>
          {t("Điều khiển")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("/accounts")}>
          {t("Đóng")}
        </Button>
      </div>
      <div className="m-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-canvas-deep ring-1 ring-line">
        {frame ? <img src={frame} alt={t("Ảnh chụp màn hình trình duyệt của {alias}", { alias: account.alias })} className="max-h-full max-w-full object-contain" /> : <p className="px-6 text-center text-sm text-ink-2">{t("Không có gì đang diễn ra. Khi tài khoản làm việc, màn hình Muse sẽ hiện ở đây.")}</p>}
      </div>
    </aside>
  );
}

/** S07c / S07c2. `login` = opened right after starting a login flow: show the stepper while it runs, then go back
 * (the store shows the one summary toast). Without it: takeover / checkpoint / needs-login panel as before. */
/** Build 3.2 R155 — where the pages the Muse window opens go. */
function ExtraPagesHint() {
  return (
    <p className="flex items-start gap-2 text-sm text-ink-2">
      <AppWindow className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t("Trang Muse mở thêm (Trung tâm tài khoản Meta, nút Kết nối của công cụ…) hiện trong cửa sổ riêng, cùng proxy của tài khoản.")}</span>
    </p>
  );
}

function TakeoverOverlay({ id, site, loginMode }: { id: string; site: "muse" | "vibes"; loginMode: boolean }) {
  const account = useUi((s) => s.snap?.accounts.find((a) => a.id === id) ?? null);
  const progress = useUi((s) => s.logins[id] ?? null);
  const [busy, setBusy] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const sawLogin = useRef(false);
  const sawTakeover = useRef(false);
  const loginRunning = !!progress && !progress.done;
  useEffect(() => {
    if (!account) return;
    if (loginRunning || account.state === "logging_in") {
      sawLogin.current = true;
      return;
    }
    if (account.state === "takeover") {
      sawTakeover.current = true;
      return;
    }
    if (sawLogin.current) {
      navigate("/accounts", { replace: true });
      return;
    }
    if (sawTakeover.current) {
      sawTakeover.current = false;
      if (account.state === "ready") pushToast({ tone: "ok", title: t("{alias} đã sẵn sàng", { alias: account.alias }) }, 3500);
      navigate("/accounts", { replace: true });
      return;
    }
    if (loginMode) {
      // The flow's first event arrives within one event batch; a flow that finished at once (all steps already
      // logged in) never shows the stepper, so leave after a short grace period.
      const left = 1500 - (Date.now() - mountedAt);
      if (left <= 0) {
        navigate("/accounts", { replace: true });
        return;
      }
      const timer = setTimeout(() => setTick((x) => x + 1), left);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [account, loginRunning, loginMode, mountedAt, tick]);
  if (!account) return null;
  if (loginRunning) return <LoginStepper account={account} progress={progress!} />;
  if (loginMode) return null;
  const login = account.state === "logging_in";
  const takeover = account.state === "takeover";
  const needs = account.state === "needs_login" || account.state === "new" || account.state === "checkpoint";
  return (
    <Dialog
      open
      onClose={() => navigate("/accounts")}
      title={login ? t("Đăng nhập Muse cho {alias}", { alias: account.alias }) : takeover ? t("Anh đang điều khiển {alias}", { alias: account.alias }) : `${account.alias}: ${accountStatus(account).label}`}
      width={540}
      footer={
        login ? (
          <>
            <Button variant="ghost" onClick={() => void act("account.cancelLogin", { id }).then(() => navigate("/accounts"))}>
              {t("Huỷ đăng nhập")}
            </Button>
            <Button icon={<RefreshCw className="size-4" />} onClick={() => void act("account.showWindow", { id })}>
              {t("Mở lại cửa sổ")}
            </Button>
          </>
        ) : takeover ? (
          <>
            <Button icon={<RefreshCw className="size-4" />} onClick={() => void act("account.showWindow", { id, site })}>
              {t("Mở lại cửa sổ")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              data-autofocus
              onClick={async () => {
                setBusy(true);
                await act("account.takeoverEnd", { id });
                setBusy(false);
                navigate("/accounts");
              }}
            >
              {t("Đã xong, kiểm tra phiên")}
            </Button>
          </>
        ) : needs ? (
          <>
            <Button variant="ghost" onClick={() => navigate("/accounts")}>
              {t("Để sau")}
            </Button>
            {account.state === "checkpoint" ? (
              <Button variant="primary" onClick={() => void act("account.takeoverStart", { id, mode: "now" })}>
                {t("Mở điều khiển")}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void act("account.openLogin", { id }).then((r) => r && navigate(`/accounts/${id}/takeover?login=1`, { replace: true }))} disabled={!account.proxyId}>
                {t("Đăng nhập")}
              </Button>
            )}
          </>
        ) : (
          <Button onClick={() => navigate("/accounts")}>{t("Đóng")}</Button>
        )
      }
    >
      <div className="flex items-start gap-4">
        <Avatar account={account} size={56} />
        <div className="flex-1 space-y-2 leading-relaxed">
          {login && (
            <>
              <p>{t("Em đã mở một cửa sổ Muse riêng cho {alias}, đi qua proxy của tài khoản này.", { alias: account.alias })}</p>
              <ol className="list-decimal space-y-1 pl-5 text-ink">
                <li>{t("Nhập email hoặc số điện thoại của tài khoản Muse.")}</li>
                <li>{t("Nhập mã xác nhận Muse gửi về.")}</li>
                <li>{t("Chọn “Remember this device” nếu có.")}</li>
              </ol>
              <p className="flex items-center gap-2 text-sm">
                <Spinner />{" "}{t("Em tự nhận ra khi đăng nhập xong — anh không cần bấm gì thêm.")}
              </p>
              <ExtraPagesHint />
            </>
          )}
          {takeover && (
            <>
              <p>
                {t("Cửa sổ {value} của {alias} đang mở. Tài khoản tạm ngừng nhận việc cho tới khi anh bấm “Đã xong”.", { value: site === "vibes" ? "Vibes" : "Muse", alias: account.alias })}
              </p>
              <ExtraPagesHint />
            </>
          )}
          {needs && <p>{account.state === "checkpoint" ? t("Muse cần anh tự xác minh tài khoản trong cửa sổ Muse. Em không vượt bước này.") : t("Phiên đăng nhập đã hết. Đăng nhập lại để tài khoản tiếp tục nhận việc.")}</p>}
          {!login && !takeover && !needs && <p>{t("Tài khoản đang {toLowerCase}.", { toLowerCase: accountStatus(account).label.toLowerCase() })}</p>}
          <p className="text-xs text-ink-3">{t("Em không lưu mật khẩu hay mã xác nhận. Phiên đăng nhập nằm trong hồ sơ trình duyệt riêng của tài khoản trên máy này.")}</p>
        </div>
      </div>
    </Dialog>
  );
}

const STEP_TEXT: Record<LoginProgressView["steps"][number]["state"], string> = {
  pending: "Chưa tới",
  active: "Đang chờ anh đăng nhập",
  done: "Đã đăng nhập",
  skipped: "Đã đăng nhập sẵn",
  deferred: "Để sau",
  cancelled: "Đã huỷ",
  timeout: "Bước này đã dừng",
  failed: "Chưa dùng được",
};

/** S07c2 — two-step login (R41): the web page is in the account's own window; this stepper stays in the app. */
function LoginStepper({ account, progress }: { account: Account; progress: LoginProgressView }) {
  const proxy = useUi((s) => s.snap?.proxies.find((p) => p.id === account.proxyId) ?? null);
  const active = progress.active;
  const name = () => "Muse";
  return (
    <Dialog
      open
      onClose={() => navigate("/accounts")}
      title={t("Đăng nhập tài khoản {alias}", { alias: account.alias })}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={() => void act("account.cancelLogin", { id: account.id })}>
            {t("Huỷ")}
          </Button>
          <Button icon={<RefreshCw className="size-4" />} onClick={() => void act("account.showWindow", { id: account.id, site: active ?? "muse" })}>
            {t("Mở lại cửa sổ")}
          </Button>
          <Button variant="primary" data-autofocus onClick={() => void act("account.loginCheckNow", { id: account.id }, t("Đang kiểm tra phiên…"))}>
            {t("Đã xong, kiểm tra phiên")}
          </Button>
        </>
      }
    >
      <ol className="flex flex-wrap items-center gap-3" aria-label={t("Các bước đăng nhập")}>
        {progress.steps.map((st, i) => {
          const done = st.state === "done";
          const skipped = st.state === "skipped";
          const now = st.state === "active";
          return (
            <li key={st.site} className="flex items-center gap-3" aria-current={now ? "step" : undefined}>
              {i > 0 && <span className="h-px w-10 bg-line-strong" aria-hidden />}
              <span className={cx("flex size-8 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-ok text-on-ink" : skipped ? "bg-ink/10 text-ink-2" : now ? "bg-accent text-on-ink" : "bg-ink/8 text-ink-2")}>
                {done || skipped ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className="text-base">
                <span className="font-semibold text-ink">{name()}</span>
                <span className="text-ink-2"> · {t(STEP_TEXT[st.state])}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-sm text-ink-2">
        {t("Cùng hồ sơ và proxy {label}{value}", { label: proxy?.label ?? t("của tài khoản"), value: proxy?.exitIpMasked ? ` · ${proxy.exitIpMasked}` : "" })}
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_240px]">
        <div className="space-y-2 leading-relaxed text-ink">
          <p>{t("Em đã mở trang Muse trong cửa sổ riêng của {alias}, đi qua proxy của tài khoản này.", { alias: account.alias })}</p>
          <p className="text-sm text-ink-2">{t("Nhập email hoặc số điện thoại, rồi mã xác nhận Muse gửi về.")}</p>
          <p className="flex items-center gap-2 text-sm">
            <Spinner />{" "}{t("Em tự nhận ra khi anh đăng nhập xong.")}
          </p>
          <ExtraPagesHint />
        </div>
        <ul className="space-y-3 rounded-md bg-ink/4 p-4 text-sm">
          <li className="flex gap-2">
            <Shield className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <span>
              <b className="font-semibold text-ink">{t("App không điền mật khẩu hay mã xác minh")}</b>
              <span className="block text-ink-2">{t("Anh luôn là người kiểm soát tài khoản của mình.")}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <Zap className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <span>
              <b className="font-semibold text-ink">{t("Tự nhận ra khi anh đăng nhập xong")}</b>
              <span className="block text-ink-2">{t("Mỗi bước tối đa 15 phút.")}</span>
            </span>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

function AvatarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-8 gap-2">
      {AVATARS.map((src, i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={avatarNames()[i]} title={avatarNames()[i]} onClick={() => onChange(i)} className={cx("overflow-hidden rounded-full bg-surface p-0.5 ring-2 transition", value === i ? "ring-accent" : "ring-transparent hover:ring-line-strong")}>
          <img src={src} alt="" className="size-full rounded-full" />
        </button>
      ))}
    </div>
  );
}

export function AddAccountDialog({ open, onClose, inline }: { open: boolean; onClose: () => void; inline?: boolean }) {
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const proxies = useUi((s) => s.snap?.proxies ?? []);
  const healthy = useMemo(() => proxies.filter((p) => p.health === "healthy"), [proxies]);
  const freeCount = useMemo(() => healthy.filter((p) => !accounts.some((a) => a.proxyId === p.id)).length, [healthy, accounts]);
  const [avatar, setAvatar] = useState(accounts.length % 8);
  const [alias, setAlias] = useState("");
  const [proxyId, setProxyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      const n = accounts.length % 8;
      setAvatar(n);
      setAlias(avatarNames().find((x) => !accounts.some((a) => a.alias === x)) ?? "");
      setProxyId(null);
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const v = validateAlias(alias, accounts.map((a) => a.alias));
  // R144: an unused healthy proxy is chosen for the user; sharing one is always an explicit click.
  const chosen = proxyId ?? suggestProxy(proxies, accounts)?.id ?? null;
  const submit = async () => {
    setTouched(true);
    if (!v.ok || !chosen) return;
    setBusy(true);
    try {
      const a = await call<Account>("account.add", { alias, avatar, proxyId: chosen });
      onClose();
      if (inline) await call("settings.set", { key: "onboardingStep", value: 4 });
      await call("account.openLogin", { id: a.id });
      navigate(`/accounts/${a.id}/takeover?login=1`);
    } catch {
      /* toast */
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <div className="flex flex-col gap-4">
      <AvatarPicker value={avatar} onChange={(i) => setAvatar(i)} />
      <Field label={t("Tên gọi")} htmlFor="acc-alias" hint={t("Chỉ để anh nhận ra trong app — không phải tên đăng nhập Muse.")} error={touched && !v.ok ? t(v.reason) : null}>
        <TextInput id="acc-alias" value={alias} maxLength={ALIAS_MAX + 4} onChange={(e) => setAlias(e.target.value)} invalid={touched && !v.ok} data-autofocus />
      </Field>
      <Field
        label="Proxy"
        hint={
          healthy.length === 0
            ? undefined
            : freeCount > 0
              ? t("{freeCount} proxy chưa dùng · {usedCount} đang dùng (dùng chung được).", { freeCount, usedCount: healthy.length - freeCount })
              : t("Mọi proxy khoẻ đều đang dùng — chọn một proxy để dùng chung, hoặc nhập thêm proxy.")
        }
      >
        {healthy.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-attention-soft px-3 py-2.5 text-sm text-ink">
            {t("Chưa có proxy khoẻ nào.")}
            <Button
              size="sm"
              onClick={() => {
                onClose();
                navigate("/settings/proxy");
              }}
            >
              {t("Nhập proxy")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ProxyPicker proxies={proxies} accounts={accounts} value={chosen} onChange={setProxyId} healthyOnly label={t("Chọn proxy")} />
            {freeCount === 0 && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClose();
                    navigate("/settings/proxy");
                  }}
                >
                  {t("Nhập thêm proxy")}
                </Button>
              </div>
            )}
          </div>
        )}
      </Field>
    </div>
  );
  if (inline)
    return (
      <div className="flex flex-col gap-4">
        {body}
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!chosen}>
            {t("Tiếp tục đăng nhập")}
          </Button>
        </div>
      </div>
    );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Thêm tài khoản Muse")}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Huỷ")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!chosen}>
            {t("Tiếp tục đăng nhập")}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

function RenameDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const [alias, setAlias] = useState(account.alias);
  const [avatar, setAvatar] = useState(account.avatar);
  const [busy, setBusy] = useState(false);
  const v = validateAlias(alias, accounts.map((a) => a.alias), account.alias);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("Đổi tên / avatar")}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Huỷ")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.ok}
            onClick={async () => {
              setBusy(true);
              const r = await act("account.rename", { id: account.id, alias, avatar });
              setBusy(false);
              if (r) onClose();
            }}
          >
            {t("Lưu")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <Field label={t("Tên gọi")} htmlFor="rn-alias" error={!v.ok ? t(v.reason) : null}>
          <TextInput id="rn-alias" value={alias} onChange={(e) => setAlias(e.target.value)} invalid={!v.ok} data-autofocus />
        </Field>
      </div>
    </Dialog>
  );
}

function ProxyDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const proxies = useUi((s) => s.snap?.proxies ?? []);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const [sel, setSel] = useState(account.proxyId);
  // R102: the change waits up to 60 s for turns Muse already has, then asks “Dừng chờ”.
  const [phase, setPhase] = useState<"pick" | "waiting" | "force">("pick");
  const [left, setLeft] = useState(60);
  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const run = async (force: boolean) => {
    if (!sel) return;
    setPhase("waiting");
    setLeft(60);
    const r = await call<{ changed: boolean; needsForce?: boolean }>("account.setProxy", { id: account.id, proxyId: sel, force }).catch((e: unknown) => {
      pushToast({ tone: "danger", title: t("Chưa đổi được proxy"), body: e instanceof Error ? e.message : String(e) }, 6000);
      return null;
    });
    if (!r) return setPhase("pick");
    if (r.changed) {
      pushToast({ tone: "ok", title: t("Đã đổi proxy") }, 3500);
      onClose();
    } else if (r.needsForce) setPhase("force");
  };
  return (
    <>
      <Dialog
        open={phase === "pick"}
        onClose={onClose}
        title={t("Đổi proxy cho {alias}", { alias: account.alias })}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("Huỷ")}
            </Button>
            <Button variant="primary" disabled={!sel || sel === account.proxyId} onClick={() => void run(false)}>
              {t("Đổi proxy")}
            </Button>
          </>
        }
      >
        <p className="mb-3">{t("Proxy đang dùng cho tài khoản khác vẫn chọn được (dùng chung). Nếu tài khoản đang làm việc, app ngừng gửi việc mới và chờ lượt đang chạy xong (tối đa 60 giây) rồi mới đổi.")}</p>
        {proxies.length === 0 ? <p className="text-sm">{t("Chưa có proxy nào.")}</p> : <ProxyPicker proxies={proxies} accounts={accounts} value={sel} onChange={setSel} forAccountId={account.id} label="Proxy" />}
      </Dialog>
      <Dialog open={phase === "waiting"} onClose={() => undefined} dismissable={false} title={t("Đang chờ {alias} xong lượt đang chạy", { alias: account.alias })}>
        <p className="flex items-center gap-2">
          <Spinner />{" "}{t("Không gửi việc mới trong lúc chờ · còn tối đa {left} giây…", { left })}
        </p>
      </Dialog>
      <Confirm
        open={phase === "force"}
        title={t("Lượt đang tạo chưa xong")}
        body={t("Muse đã nhận các lượt này. Dừng chờ sẽ chuyển chúng sang “Cần anh xem” rồi đổi proxy.")}
        confirmLabel={t("Dừng chờ và đổi proxy")}
        danger
        onCancel={() => {
          void call("account.cancelProxyChange", { id: account.id }).catch(() => undefined);
          onClose();
        }}
        onConfirm={() => void run(true)}
      />
    </>
  );
}

function RemoveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"confirm" | "waiting" | "force">("confirm");
  const [left, setLeft] = useState(60);
  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const run = async (force: boolean) => {
    setPhase("waiting");
    setLeft(60);
    const r = await call<{ removed: boolean; needsForce?: boolean }>("account.remove", { id: account.id, force }).catch(() => null);
    if (!r) return setPhase("confirm");
    if (r.removed) {
      pushToast({ tone: "ok", title: t("Đã xoá {alias}", { alias: account.alias }) }, 3500);
      onClose();
    } else if (r.needsForce) setPhase("force");
  };
  return (
    <>
      <Confirm
        open={phase === "confirm"}
        title={t("Xoá tài khoản {alias}?", { alias: account.alias })}
        confirmLabel={t("Xoá tài khoản")}
        danger
        onCancel={onClose}
        onConfirm={() => typed.trim() === account.alias && void run(false)}
        body={
          <div className="space-y-3">
            <p>{t("Lượt chưa gửi sẽ quay lại hàng chờ cho tài khoản khác. Hồ sơ trình duyệt và phiên đăng nhập của tài khoản này bị xoá khỏi máy; ảnh/video đã tải vẫn giữ trong thư viện.")}</p>
            <Field label={t("Gõ “{alias}” để xác nhận", { alias: account.alias })} htmlFor="rm-alias">
              <TextInput id="rm-alias" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </Field>
            {typed && typed.trim() !== account.alias && <p className="text-sm text-danger-ink">{t("Tên chưa khớp")}</p>}
          </div>
        }
      />
      <Dialog open={phase === "waiting"} onClose={() => undefined} dismissable={false} title={t("Đang chờ {alias} xong lượt hiện tại", { alias: account.alias })}>
        <p className="flex items-center gap-2">
          <Spinner />{" "}{t("Còn tối đa {left} giây…", { left })}
        </p>
      </Dialog>
      <Confirm
        open={phase === "force"}
        title={t("Lượt đang tạo chưa xong")}
        body={t("Muse đã nhận lượt này. Buộc dừng sẽ chuyển lượt sang “Cần anh xem” rồi xoá tài khoản.")}
        confirmLabel={t("Buộc dừng và xoá")}
        danger
        onCancel={onClose}
        onConfirm={() => void run(true)}
      />
    </>
  );
}
