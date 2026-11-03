import { museExtendEligibility, validateMuseExtend, MUSE_EXTEND_DEFAULT_STEPS, MUSE_EXTEND_MAX_STEPS } from "@shared/museExtend";
import { AlertTriangle, ArrowRightToLine, Film, Info, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatusTone } from "@shared/accountMachine";
import { formatElapsed, formatNumber, formatTime } from "@shared/format";
import type { Account, Asset, ChainStatus, ChainStep, ExtendChain, ExtendMode, Job, JobState } from "@shared/types";
import { EXTEND_DIRECTIVE_MAX, EXTEND_TARGET_MAX_S, EXTEND_TARGET_MIN_S, EXTEND_TARGET_STEP_S, VIBES_EXTEND_DEFAULT_STEPS, extendEligibility, formatSeconds, remainingSteps, validateExtend, vibesStatus } from "@shared/vibes";
import { ApiSourcePill } from "../components/ApiSource";
import { Avatar } from "../components/Avatar";
import { Drawer } from "../components/Overlay";
import { Button, Pill, Segmented, Spinner, Stepper } from "../components/ui";
import { act, call } from "../lib/api";
import { useWindowWidth } from "../lib/hooks";
import { navigate } from "../lib/router";
import { getState, onEntity, pushToast, setState, useUi } from "../lib/store";
import { cx, jobLabel, JOB_TONE, thumbUrl, uid } from "../lib/ui";
import { t } from "@shared/i18n";

// S06e Kéo dài sheet · chain card (S02/S04) · S03-chain drawer · lineage strip (S06b). Rules live in spec R45–R49;
// the main process re-checks everything (the UI is not a security boundary).

const NO_ACCOUNTS: Account[] = [];

/** Pass the asset the caller already shows so the form appears without waiting for a re-read (AC-EXT-22 ≤ 150 ms). */
export function openExtend(assetId: string, seed?: Asset): void {
  setState({ extendAssetId: assetId, extendSeed: seed && seed.id === assetId ? seed : null });
}

export function openChain(chainId: string): void {
  setState({ chainId });
}

export const CHAIN_LABEL: Record<ChainStatus, string> = {
  running: "Đang kéo dài",
  waiting: "Đang chờ",
  needs_review: "Cần anh xem",
  completed: "Xong",
  stopped: "Đã dừng",
  cancelled: "Đã huỷ",
};

export const CHAIN_TONE: Record<ChainStatus, StatusTone> = {
  running: "accent",
  waiting: "attention",
  needs_review: "attention",
  completed: "ok",
  stopped: "neutral",
  cancelled: "neutral",
};

const ACTIVE: ChainStatus[] = ["running", "waiting", "needs_review"];
export const chainActive = (c: Pick<ExtendChain, "status">) => ACTIVE.includes(c.status);

/** “lần {k}/{N hoặc tối đa}” (screens §11.5). */
export function chainStepText(c: Pick<ExtendChain, "plan" | "maxSteps" | "stepsDone" | "status">): string {
  const total = c.plan.type === "steps" ? Math.min(c.plan.value, c.maxSteps) : c.maxSteps;
  const k = chainActive(c) ? Math.min(c.stepsDone + 1, total) : Math.max(1, c.stepsDone);
  return c.plan.type === "steps" ? t("lần {k}/{total}", { k, total }) : t("lần {k}/tối đa {total}", { k, total });
}

export function chainPlanText(c: Pick<ExtendChain, "plan">): string {
  return c.plan.type === "steps" ? t("Kéo dài {value} lần", { value: c.plan.value }) : t("Đến khoảng {value} giây", { value: c.plan.value });
}

function stepTone(state: JobState): StatusTone {
  if (state === "completed") return "ok";
  if (state === "failed") return "danger";
  if (state === "needs_review" || state === "held" || state === "retry_wait") return "attention";
  if (state === "queued" || state === "cancelled") return "neutral";
  return "accent";
}

const DOT: Record<StatusTone, string> = {
  ok: "bg-ok",
  accent: "bg-accent ring-4 ring-accent-soft",
  attention: "bg-attention",
  danger: "bg-danger",
  neutral: "bg-ink/15",
};
const MAX_DOTS = 24;

/** One dot per step: green done, blue running, grey not yet, amber waiting/needs review, red failed — never a % bar (spec §5). */
export function ChainDots({ chain, steps }: { chain: ExtendChain; steps?: ChainStep[] }) {
  const planned = chain.plan.type === "steps" ? Math.min(chain.plan.value, chain.maxSteps) : 0;
  let tones: StatusTone[];
  if (steps) {
    tones = [...steps].sort((a, b) => a.step - b.step).map((s) => (s.state === "queued" && chain.status === "waiting" ? "attention" : stepTone(s.state)));
  } else {
    tones = Array.from({ length: chain.stepsDone }, () => "ok" as StatusTone);
    if (chain.currentJobId) tones.push(chain.status === "running" ? "accent" : "attention");
  }
  if (chainActive(chain)) while (tones.length < planned) tones.push("neutral");
  else if (!steps && chain.plan.type === "steps") while (tones.length < planned) tones.push("neutral");
  const shown = tones.slice(0, MAX_DOTS);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("{stepsDone} lần đã xong", { stepsDone: chain.stepsDone })}>
      {shown.map((item, i) => (
        <span key={i} className={cx("size-2.5 rounded-full", DOT[item])} aria-hidden />
      ))}
      {tones.length > MAX_DOTS && <span className="text-xs text-ink-2">+{tones.length - MAX_DOTS}</span>}
    </div>
  );
}

function ChainActions({ chain, size = "sm" }: { chain: ExtendChain; size?: "sm" | "md" }) {
  const canStop = chain.status === "running" || chain.status === "waiting";
  const canContinue = chain.site === "muse" && (chain.status === "stopped" || chain.status === "cancelled" || chain.status === "needs_review") && !chain.currentJobId && remainingSteps(chain.plan, chain.stepsDone, chain.maxSteps) > 0;
  return (
    <>
      {canStop && (
        <Button size={size} icon={<Square className="size-3.5" />} onClick={() => void act("chain.cancel", { id: chain.id }, t("Đã dừng chuỗi — lần đang chạy vẫn được theo dõi tới khi xong"))}>
          {t("Dừng chuỗi")}
        </Button>
      )}
      {canContinue && (
        <Button size={size} icon={<Play className="size-3.5" />} onClick={() => void act("chain.continue", { id: chain.id }, t("Đã tiếp tục chuỗi"))}>
          {t("Tiếp tục chuỗi")}
        </Button>
      )}
    </>
  );
}

/** S02/S04 chain card. */
export function ChainCard({ chain, compact }: { chain: ExtendChain; compact?: boolean }) {
  const account = useUi((s) => (chain.accountId ? s.snap?.accounts.find((a) => a.id === chain.accountId) ?? null : null));
  const thumb = chain.lastAssetId ?? chain.rootAssetId;
  return (
    <article className={cx("glass-card flex gap-4 rounded-lg", compact ? "p-3" : "p-4")} aria-label={t("Chuỗi kéo dài {chain} — {value}", { chain: chainStepText(chain), value: t(CHAIN_LABEL[chain.status]) })}>
      <button type="button" onClick={() => openChain(chain.id)} className={cx("relative shrink-0 overflow-hidden rounded-[12px] bg-canvas-deep ring-1 ring-line", compact ? "h-16 w-24" : "h-[72px] w-32")} aria-label={t("Mở chi tiết chuỗi")}>
        <img src={thumbUrl(thumb)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-ink/70 text-on-ink">
            <ArrowRightToLine className="size-3.5" aria-hidden />
          </span>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {!compact && <Avatar account={account} size={24} />}
          <span className="text-base font-medium text-ink">{t("Chuỗi kéo dài · {chain}", { chain: chainStepText(chain) })}</span>
          {chain.lastDurationMs !== null && <span className="font-mono text-sm text-ink-2">{formatSeconds(chain.lastDurationMs)}</span>}
          <Pill tone={CHAIN_TONE[chain.status]}>{t(CHAIN_LABEL[chain.status])}</Pill>
          <ApiSourcePill apiKeyId={chain.apiKeyId} />
        </div>
        <div className="mt-2">
          <ChainDots chain={chain} />
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">
          {chain.reason ? t(chain.reason) : `${chainPlanText(chain)} · ${chain.mode === "auto" ? t("Tự động") : t("Theo mô tả")}${chain.accountAlias ? ` · ${chain.accountAlias}` : ""}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant={compact ? "ghost" : "secondary"} onClick={() => openChain(chain.id)}>
            {t("Chi tiết")}
          </Button>
          <ChainActions chain={chain} />
        </div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------------------------------------ S06e
export function ExtendSheet() {
  const assetId = useUi((s) => s.extendAssetId);
  const accounts = useUi((s) => s.snap?.accounts ?? NO_ACCOUNTS);
  const caps = useUi((s) => s.snap?.capabilities);
  const vibesMaxSteps = useUi((s) => s.snap?.settings.extendMaxSteps ?? 20);
  const httpOn = useUi((s) => !!s.snap?.settings.bridgeHttpEnabled);
  const width = useWindowWidth();
  const seed = useUi((s) => (s.extendSeed && s.extendSeed.id === s.extendAssetId ? s.extendSeed : null));
  const [fresh, setAsset] = useState<{ id: string; asset: Asset | null } | undefined>(undefined);
  // The fresh read wins once it is back; until then the opener's copy fills the form.
  const asset: Asset | null | undefined = fresh && fresh.id === assetId ? fresh.asset : seed ?? undefined;
  const isMuse = asset?.site === "muse";
  const provider = isMuse ? "Muse" : "Vibes";
  const maxSteps = isMuse ? MUSE_EXTEND_MAX_STEPS : vibesMaxSteps;
  const verified = !!caps?.[isMuse ? "muse.video.extend" : "vibes.video.extend"];
  const [mode, setMode] = useState<ExtendMode>("auto");
  const [directive, setDirective] = useState("");
  const [planType, setPlanType] = useState<"steps" | "target">("steps");
  const [steps, setSteps] = useState(1);
  const [target, setTarget] = useState(30);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const requestId = useRef(uid());
  /** The opening whose provider default (Muse 1 step, R55; Vibes 3 steps, screens §11.4) has been applied. */
  const defaultedFor = useRef<string | null>(null);
  const close = useCallback(() => setState({ extendAssetId: null, extendSeed: null }), []);

  useEffect(() => {
    if (!assetId) return;
    // Each opening is a fresh request: Tự động never carries an earlier description (R46).
    setAsset(undefined);
    setMode("auto");
    setDirective("");
    setTouched(false);
    setBusy(false);
    defaultedFor.current = null;
    requestId.current = uid();
    let live = true;
    void call<Asset | null>("library.get", { assetId }, { quiet: true }).then(
      (a) => live && setAsset({ id: assetId, asset: a ?? null }),
      () => live && setAsset({ id: assetId, asset: null }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // Once the source is known, start from its provider's default number of steps (within the current maximum).
  useEffect(() => {
    if (!assetId || !asset || defaultedFor.current === assetId) return;
    defaultedFor.current = assetId;
    setSteps(Math.min(isMuse ? MUSE_EXTEND_DEFAULT_STEPS : VIBES_EXTEND_DEFAULT_STEPS, maxSteps));
  }, [assetId, asset, isMuse, maxSteps]);

  const owner = asset?.sourceOwnerId ? accounts.find((a) => a.id === asset.sourceOwnerId) ?? null : null;
  const info = asset ? isMuse ? museExtendEligibility(asset, owner, verified, { httpOn }) : { ok: false, reason: t("Chức năng này không còn hỗ trợ"), waitNote: null } : null;
  // The form appears once the source is read; then focus goes to the first segmented (screens §11.4).
  const formShown = !!info?.ok;
  // A parent effect runs after the Drawer's focus trap (child) has recorded the opener, so Esc still returns there.
  useEffect(() => {
    if (assetId && formShown) document.querySelector<HTMLElement>(t("[role=\"dialog\"][aria-label^=\"Kéo dài video\"] [data-autofocus]"))?.focus();
  }, [assetId, formShown]);
  const plan = planType === "steps" ? { type: "steps" as const, value: steps } : { type: "target" as const, value: target };
  const error = isMuse ? validateMuseExtend({ mode, directive, plan }, maxSteps, asset?.durationMs ?? null) : validateExtend({ mode, directive, plan }, maxSteps);
  const ownerNeedsLogin = owner ? isMuse ? ["needs_login", "new"].includes(owner.state) : ["needs_login", "logged_out"].includes(vibesStatus(owner.vibes)) : false;

  const submit = async () => {
    setTouched(true);
    if (error || !info?.ok || !asset || asset.site !== "muse" || busy) return;
    setBusy(true);
    try {
      const r = await act<{ chain: ExtendChain; replayed: boolean }>("extend.start", { assetId: asset.id, mode, directive: mode === "directive" ? directive : null, plan, clientRequestId: requestId.current });
      if (!r) return;
      close();
      pushToast({ tone: "ok", title: r.replayed ? t("Chuỗi này đã được bắt đầu trước đó") : t("Đã bắt đầu chuỗi kéo dài"), body: owner ? t("Chạy trên {alias} · {value}", { alias: owner.alias, value: isMuse ? t("mỗi lần gửi có thể dùng hạn mức Muse") : t("mỗi lần dùng 1 lượt Vibes") }) : undefined, action: { label: t("Xem chuỗi"), run: () => openChain(r.chain.id) } }, 6000);
    } finally {
      setBusy(false);
    }
  };

  const floating = width < 1100;
  const len = directive.trim().length;
  return (
    <Drawer
      open={!!assetId}
      onClose={close}
      title={isMuse ? t("Kéo dài video Muse") : t("Kéo dài video")}
      width={floating ? 360 : 400}
      floating={floating}
      top
      footer={
        info?.ok ? (
          <>
            <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={touched && !!error}>
              {t("Bắt đầu kéo dài")}
            </Button>
            <Button variant="ghost" onClick={close}>
              {t("Huỷ")}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t("Đóng")}</Button>
        )
      }
    >
      {asset === undefined ? (
        <div className="flex justify-center py-10">
          <Spinner label={t("Đang mở")} />
        </div>
      ) : !asset || !info ? (
        <Locked reason={!asset ? t("Không còn tác phẩm này") : t("Chỉ kéo dài được video")} />
      ) : !info.ok ? (
        <Locked reason={info.reason ? t(info.reason) : t("Không kéo dài được video này")} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <img src={thumbUrl(asset.id)} alt="" className="h-14 w-24 shrink-0 rounded-[10px] object-cover ring-1 ring-line" />
            <div className="min-w-0 text-sm">
              <div className="line-clamp-2 text-ink">{asset.prompt || `Video ${provider}`}</div>
              <div className="font-mono text-xs text-ink-2">{asset.durationMs ? formatElapsed(asset.durationMs) : "—"}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Segmented label={t("Kiểu kéo dài")} autoFocus value={mode} onChange={setMode} options={[{ value: "auto", label: t("Tự động") }, { value: "directive", label: t("Theo mô tả") }]} />
            <div className={cx("transition-opacity", mode === "auto" && "opacity-50")}>
              <textarea
                aria-label={t("Mô tả cho các lần kéo dài")}
                disabled={mode === "auto"}
                value={directive}
                maxLength={EXTEND_DIRECTIVE_MAX + 200}
                onChange={(e) => setDirective(e.target.value)}
                rows={3}
                placeholder={mode === "auto" ? isMuse ? t("Tiếp tục từ video nguồn") : t("Tự động: Vibes tự nối tiếp, không gửi mô tả") : t("Ví dụ: máy quay lùi dần, trời chuyển sang hoàng hôn")}
                className="w-full resize-none rounded-[12px] border border-line-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed"
              />
              <div className={cx("text-right font-mono text-xs", len > EXTEND_DIRECTIVE_MAX ? "text-danger-ink" : "text-ink-3")}>
                {formatNumber(len)}/{formatNumber(EXTEND_DIRECTIVE_MAX)}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-ink">{t("Kéo dài")}</div>
            <div className="flex flex-col items-start gap-2">
              <Segmented label={t("Kế hoạch kéo dài")} size="sm" value={planType} onChange={setPlanType} options={[{ value: "steps", label: t("Số lần") }, { value: "target", label: t("Đến khoảng") }]} />
              {planType === "steps" ? <Stepper label={t("số lần")} value={steps} onChange={setSteps} min={1} max={maxSteps} step={1} suffix={t("lần")} /> : <Stepper label={t("số giây")} value={target} onChange={setTarget} min={EXTEND_TARGET_MIN_S} max={isMuse ? 60 : EXTEND_TARGET_MAX_S} step={EXTEND_TARGET_STEP_S} suffix={t("giây")} />}
            </div>
            <p className="text-xs text-ink-2">{t("Tối đa {maxSteps} lần mỗi chuỗi · Dừng khi {provider} không kéo dài thêm", { maxSteps, provider })}</p>
            {touched && error && (
              <p className="text-sm text-danger-ink" role="alert">
                {error ? t(error) : null}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-ink">
            <Avatar account={owner} size={24} />
            <span>
              {t("Chạy trên")}{" "}<b className="font-semibold">{owner?.alias}</b> · {isMuse ? t("mỗi lần gửi có thể dùng hạn mức Muse") : t("mỗi lần dùng 1 lượt Vibes")}
            </span>
          </div>
          {info.waitNote && (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-attention-soft px-3 py-2 text-sm text-ink" role="status">
              <span className="min-w-0 flex-1">{info.waitNote}</span>
              {ownerNeedsLogin && owner && (
                <button
                  type="button"
                  className="font-semibold text-accent-ink hover:underline"
                  onClick={() =>
                    void act("account.openLogin", { id: owner.id, site: isMuse ? "muse" : "vibes" }).then((r) => {
                      if (!r) return;
                      setState({ extendAssetId: null, extendSeed: null, lightbox: null });
                      navigate(`/accounts/${owner.id}/takeover?login=1`);
                    })
                  }
                >
                  {t("Đăng nhập {provider}", { provider })}
                </button>
              )}
            </div>
          )}
          <div className="flex gap-2 rounded-[12px] bg-attention-soft/60 px-3 py-2.5 text-sm text-ink">
            <Info className="mt-0.5 size-4 shrink-0 text-attention-ink" aria-hidden />
            {isMuse ? t("Độ dài do Muse quyết định. Không bảo đảm mối nối liền.") : t("Độ dài cuối cùng do Vibes quyết định — app đo từng bản và dừng đúng luật")}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Locked({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] bg-ink/5 px-4 py-3 text-sm text-ink" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attention-ink" aria-hidden />
      <span>{reason}</span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ S03-chain
type ChainDetail = { chain: ExtendChain; steps: ChainStep[]; root: Asset | null };

/** Loads one chain and keeps it fresh from `chain`, `job` and `asset` events of that chain. */
function useChainDetail(chainId: string | null): { data: ChainDetail | null; missing: boolean } {
  const [data, setData] = useState<ChainDetail | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setData(null);
    setMissing(false);
    if (!chainId) return;
    let live = true;
    let cur: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      void call<ChainDetail>("chain.get", { id: chainId }, { quiet: true }).then(
        (d) => live && (setData(d), setMissing(false)),
        () => live && setMissing(true),
      );
    load();
    const off = onEntity((type, p) => {
      const hit = (type === "chain" && (p as ExtendChain).id === chainId) || ((type === "job" || type === "asset") && (p as Job | Asset).chainId === chainId);
      if (!hit) return;
      if (cur) clearTimeout(cur);
      cur = setTimeout(load, 150);
    });
    return () => {
      live = false;
      off();
      if (cur) clearTimeout(cur);
    };
  }, [chainId]);
  return { data, missing };
}

export function ChainDrawer() {
  const chainId = useUi((s) => s.chainId);
  const live = useUi((s) => (s.chainId ? s.snap?.chains.find((c) => c.id === s.chainId) ?? null : null));
  const account = useUi((s) => (live?.accountId ? s.snap?.accounts.find((a) => a.id === live.accountId) ?? null : null));
  const { data, missing } = useChainDetail(chainId);
  const close = useCallback(() => {
    setState({ chainId: null });
    if (getState().route.startsWith("/queue/chain/")) navigate("/queue", { replace: true });
  }, []);
  const chain = live && data && live.rev >= data.chain.rev ? live : data?.chain ?? live;
  const steps = useMemo(() => [...(data?.steps ?? [])].sort((a, b) => a.step - b.step), [data]);
  const outputs = steps.filter((s) => s.assetId).map((s) => s.assetId!);
  const lineageIds = [...(data?.root ? [data.root.id] : []), ...outputs];
  return (
    <Drawer
      open={!!chainId}
      onClose={close}
      title={chain ? t("Chuỗi kéo dài · {chain}", { chain: chainStepText(chain) }) : t("Chuỗi kéo dài")}
      width={460}
      footer={
        chain ? (
          <>
            <ChainActions chain={chain} size="md" />
            {chain.lastAssetId && (
              <Button variant="primary" icon={<Film className="size-4" />} className="ml-auto" onClick={() => setState({ lightbox: { assetId: chain.lastAssetId!, ids: lineageIds.length ? lineageIds : [chain.lastAssetId!] } })}>
                {t("Mở bản mới nhất")}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {missing && !chain ? (
        <p className="py-8 text-center text-base text-ink-2">{t("Không còn chuỗi này")}</p>
      ) : !chain ? (
        <div className="flex justify-center py-10">
          <Spinner label={t("Đang tải")} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Pill tone={CHAIN_TONE[chain.status]}>{t(CHAIN_LABEL[chain.status])}</Pill>
            {chain.lastDurationMs !== null && <span className="font-mono text-sm text-ink">{formatSeconds(chain.lastDurationMs)}</span>}
            <ApiSourcePill apiKeyId={chain.apiKeyId} />
          </div>
          {chain.reason && <p className={cx("rounded-[12px] px-3 py-2 text-sm text-ink", chain.status === "waiting" || chain.status === "needs_review" ? "bg-attention-soft" : "bg-ink/5")}>{t(chain.reason)}</p>}
          <ChainDots chain={chain} steps={steps.length ? steps : undefined} />
          {data?.root && (
            <button type="button" onClick={() => setState({ lightbox: { assetId: data.root!.id, ids: lineageIds } })} className="flex items-center gap-3 rounded-[12px] bg-ink/4 p-2 text-left hover:bg-ink/6">
              <img src={thumbUrl(data.root.id)} alt="" className="h-12 w-20 shrink-0 rounded-[8px] object-cover" />
              <span className="min-w-0 text-sm">
                <span className="block text-xs text-ink-2">{t("Video gốc · {durationMs}", { durationMs: formatSeconds(data.root.durationMs) })}</span>
                <span className="line-clamp-2 text-ink">{data.root.prompt || "Video Vibes"}</span>
              </span>
            </button>
          )}
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-2">{t("Tài khoản")}</dt>
            <dd className="flex items-center gap-1.5 text-ink">
              <Avatar account={account} size={20} /> {chain.accountAlias ?? t("Đã xoá")}
            </dd>
            <dt className="text-ink-2">{t("Kiểu")}</dt>
            <dd className="text-ink">{chain.mode === "auto" ? t("Tự động") : t("Theo mô tả: {directive}", { directive: chain.directive ?? "" })}</dd>
            <dt className="text-ink-2">{t("Kế hoạch")}</dt>
            <dd className="text-ink">
              {t("{chain} · tối đa {maxSteps} lần", { chain: chainPlanText(chain), maxSteps: chain.maxSteps })}
            </dd>
            <dt className="text-ink-2">{t("Bắt đầu")}</dt>
            <dd className="font-mono text-xs leading-5 text-ink">{formatTime(chain.createdAt)}</dd>
          </dl>
          <div>
            <div className="mb-2 text-sm font-medium text-ink">{t("Từng lần")}</div>
            {steps.length === 0 ? (
              <p className="text-sm text-ink-2">{t("Chưa có lần nào.")}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {steps.map((s) => (
                  <li key={s.jobId} className="flex items-center gap-3 rounded-[12px] bg-ink/4 px-2.5 py-2">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => (s.assetId ? setState({ lightbox: { assetId: s.assetId, ids: lineageIds } }) : setState({ detailJobId: s.jobId }))}>
                      {s.assetId ? <img src={thumbUrl(s.assetId)} alt="" className="h-9 w-14 shrink-0 rounded-[6px] object-cover" /> : <span className="h-9 w-14 shrink-0 rounded-[6px] bg-ink/6" aria-hidden />}
                      <span className="w-12 shrink-0 text-sm font-medium text-ink">{t("Lần {step}", { step: s.step })}</span>
                      <span className="w-16 shrink-0 font-mono text-xs text-ink-2">{formatSeconds(s.durationMs)}</span>
                      <Pill tone={JOB_TONE[s.state]}>{jobLabel(s.state)}</Pill>
                      <span className="ml-auto font-mono text-xs text-ink-3">{s.at ? formatTime(s.at) : ""}</span>
                    </button>
                    {(s.state === "needs_review" || s.state === "failed") && (
                      <Button size="sm" onClick={() => setState({ detailJobId: s.jobId })}>
                        {s.state === "needs_review" ? t("Xem và quyết định") : t("Xem lỗi")}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------------ S06b lineage
/** “Gốc, Lần 1…” under the video in Xem lớn; the asset being viewed has a blue ring (screens §11.5). */
export function Lineage({ asset }: { asset: Asset }) {
  const { data } = useChainDetail(asset.chainId);
  if (!asset.chainId || !data) return null;
  const items = [
    ...(data.root ? [{ id: data.root.id, label: t("Gốc"), ms: data.root.durationMs, missing: data.root.missing }] : []),
    ...[...data.steps]
      .sort((a, b) => a.step - b.step)
      .filter((s) => s.assetId)
      .map((s) => ({ id: s.assetId!, label: t("Lần {step}", { step: s.step }), ms: s.durationMs, missing: false })),
  ];
  if (items.length < 2) return null;
  const ids = items.map((i) => i.id);
  return (
    <nav aria-label={t("Các bản trong chuỗi")} className="glass-strong flex max-w-full gap-2 overflow-x-auto rounded-md p-2">
      {items.map((i) => (
        <button key={i.id} type="button" aria-current={i.id === asset.id ? "true" : undefined} onClick={() => setState({ lightbox: { assetId: i.id, ids } })} className={cx("flex shrink-0 flex-col items-center gap-1 rounded-[10px] p-1 ring-2 transition", i.id === asset.id ? "ring-accent" : "ring-transparent hover:ring-line-strong")}>
          {i.missing ? <span className="flex h-10 w-16 items-center justify-center rounded-[6px] bg-ink/6 text-[10px] text-ink-2">{t("Không thấy")}</span> : <img src={thumbUrl(i.id)} alt="" className="h-10 w-16 rounded-[6px] object-cover" />}
          <span className="text-[11px] text-ink-2">
            {i.label} · <span className="font-mono">{formatSeconds(i.ms)}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
