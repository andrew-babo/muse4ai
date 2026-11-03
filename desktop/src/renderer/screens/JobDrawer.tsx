import { AlertTriangle, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { allowedActions, ERROR_HINT, ERROR_LABEL, type JobAction } from "@shared/jobMachine";
import { formatDateTime, formatElapsed, formatTime } from "@shared/format";
import type { Asset, Attempt, Job } from "@shared/types";
import { Avatar } from "../components/Avatar";
import { Confirm, Drawer, Menu } from "../components/Overlay";
import { Button, Pill, Spinner } from "../components/ui";
import { ApiSourcePill } from "../components/ApiSource";
import { act, call } from "../lib/api";
import { focusComposer, setDraft } from "../lib/composer";
import { navigate } from "../lib/router";
import { onEntity, pushToast, setState, useUi } from "../lib/store";
import { cx, jobLabel, JOB_TONE, thumbUrl } from "../lib/ui";
import { openLightbox, recreate } from "./JobCard";
import { openChain } from "./Extend";
import { ChatAnswer } from "./ChatResult";
import { EXEC_PATH_LABEL } from "@shared/execution";
import { t } from "@shared/i18n";

// S03 — job detail drawer: attempts, error, and only the actions valid for the state (spec §4.1).

const PHASE_LABEL: Record<Attempt["phase"], string> = { generate: "Tạo", download: "Tải về", reconcile: "Đối soát", extend: "Kéo dài" };
const OUTCOME_LABEL: Record<string, string> = {
  accepted: "Muse đã nhận",
  submitted: "Đã gửi",
  generated: "Muse đã tạo xong",
  downloaded: "Đã tải",
  duplicate: "Trùng tệp",
  error: "Lỗi",
  aborted: "Đã dừng",
  download_failed: "Tải lỗi",
  found: "Đã tìm thấy",
  not_found: "Không thấy",
  no_media: "Muse không trả tệp",
  reconciled: "Đã đối soát",
  imported: "Đã nhập từ lịch sử",
  interrupted: "Bị ngắt",
};

export function JobDrawer() {
  const jobId = useUi((s) => s.detailJobId);
  const accounts = useUi((s) => s.snap?.accounts ?? []);
  const width = typeof window !== "undefined" ? window.innerWidth : 1440;
  const [data, setData] = useState<{ job: Job; attempts: Attempt[]; assets: Asset[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState<null | "stopWaiting" | "resend">(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setState({ detailJobId: null }), []);

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      setData(await call("job.get", { jobId }, { quiet: true }));
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [jobId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useEffect(
    () =>
      onEntity((type, p) => {
        if (!jobId) return;
        if ((type === "job" && (p as Job).id === jobId) || (type === "asset" && (p as Asset).jobId === jobId)) void load();
      }),
    [jobId, load],
  );

  if (!jobId) return null;
  const job = data?.job;
  const acc = job?.accountId ? accounts.find((a) => a.id === job.accountId) ?? null : null;
  // R50 — an extend step is pinned to the source's account and belongs to its chain: no account change, no free re-create.
  const EXTEND_HIDDEN: JobAction[] = ["changeAccount", "recreate", "editResend"];
  const actions = job ? allowedActions(job.state, { errorClass: job.errorClass, remoteRef: job.remoteRef }).filter((a) => job.operation !== "extend" || !EXTEND_HIDDEN.includes(a)) : [];
  const siteName = job?.site === "vibes" ? "Vibes" : "Muse";

  const run = async (a: JobAction) => {
    if (!job) return;
    switch (a) {
      case "cancel":
        return void act("job.cancel", { jobId: job.id }, t("Đã huỷ lượt"));
      case "prioritize":
        return void act("job.prioritize", { jobId: job.id }, t("Đã đưa lên đầu hàng"));
      case "resumeBatch":
        return job.batchId ? void act("batch.resume", { id: job.batchId }) : undefined;
      case "stopWaiting":
        return setConfirm("stopWaiting");
      case "retryNow":
        return void act("job.retryNow", { jobId: job.id });
      case "importFromHistory":
        return void act("job.resolveReview", { jobId: job.id, resolution: "import" }, job.site === "vibes" ? t("Đang kiểm lại trên Vibes") : t("Đang nhập kết quả từ Muse"));
      case "resend":
        if (job.state === "cancelled") return void act("job.retry", { jobId: job.id }, t("Đã đưa lại vào hàng chờ"));
        return setConfirm("resend");
      case "dismiss":
        return void act("job.resolveReview", { jobId: job.id, resolution: "dismiss" });
      case "recreate":
        return void recreate({ ...job, assets: [] });
      case "retry":
        return void act("job.retry", { jobId: job.id }, t("Đã đưa lại vào hàng chờ"));
      case "editResend":
        setDraft(job.kind === "chat" ? { prompt: job.prompt, kind: "chat" } : { prompt: job.prompt, kind: job.kind, mode: job.mode === "reference" ? "text" : job.mode });
        close();
        navigate("/studio");
        focusComposer();
        return;
      case "changeAccount":
        return;
    }
  };

  const LABEL: Record<JobAction, string> = {
    cancel: t("Huỷ"),
    changeAccount: t("Đổi tài khoản"),
    prioritize: t("Ưu tiên"),
    resumeBatch: t("Tiếp tục lô"),
    stopWaiting: t("Ngừng chờ"),
    retryNow: t("Thử lại ngay"),
    importFromHistory: job?.site === "vibes" ? t("Kiểm lại trên Vibes") : t("Nhập từ lịch sử Muse"),
    resend: t("Gửi lại"),
    dismiss: t("Bỏ qua"),
    recreate: t("Tạo lại"),
    retry: t("Thử lại"),
    editResend: t("Sửa và gửi lại"),
  };

  const primary: JobAction[] = ["importFromHistory", "retry", "retryNow", "recreate", "resumeBatch", "editResend"];

  return (
    <>
      <Drawer
        open
        onClose={close}
        floating={width < 1440}
        label={t("Chi tiết lượt")}
        title={job ? <span className="flex items-center gap-2">{t("Chi tiết lượt")}{" "}<Pill tone={JOB_TONE[job.state]}>{jobLabel(job.state)}</Pill></span> : t("Chi tiết lượt")}
        footer={
          job && actions.length ? (
            <>
              {actions.map((a) =>
                a === "changeAccount" ? (
                  <Menu
                    key={a}
                    label={t("Đổi tài khoản")}
                    items={[{ label: t("Tự động"), checked: job.accountPref === "auto", onSelect: () => void act("job.changeAccount", { jobId: job.id, accountPref: "auto" }) }, ...accounts.map((x) => ({ label: x.alias, checked: job.accountPref === x.id, onSelect: () => void act("job.changeAccount", { jobId: job.id, accountPref: x.id }) }))]}
                    trigger={(p) => (
                      <Button size="sm" {...p}>
                        {LABEL[a]}
                      </Button>
                    )}
                  />
                ) : (
                  <Button key={a} size="sm" variant={primary.includes(a) ? "primary" : a === "cancel" || a === "stopWaiting" || a === "dismiss" ? "ghost" : "secondary"} onClick={() => void run(a)}>
                    {LABEL[a]}
                  </Button>
                ),
              )}
            </>
          ) : undefined
        }
      >
        {missing ? (
          <p className="py-10 text-center text-ink-2">{t("Không còn lượt này.")}</p>
        ) : !job ? (
          <div className="flex justify-center py-10">
            <Spinner label={t("Đang tải")} />
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-2">
            <section>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-base text-ink" data-selectable>
                  {job.prompt}
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1.5 text-ink-2 hover:bg-ink/5"
                  aria-label={t("Chép prompt")}
                  title={t("Chép prompt")}
                  onClick={() => {
                    void navigator.clipboard.writeText(job.prompt);
                    pushToast({ tone: "ok", title: t("Đã chép prompt") }, 2500);
                  }}
                >
                  <Copy className="size-4" />
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-ink-2">{t("Loại")}</dt>
                <dd className="text-ink">
                  {job.kind === "chat" ? t("Hỏi đáp{value} · Muse", { value: job.referenceIds.length ? t(" · {referenceIdsCount} tệp đính kèm", { referenceIdsCount: job.referenceIds.length }) : "" }) : <>{job.kind === "image" ? t("Ảnh") : "Video"} · {job.operation === "extend" ? t("Kéo dài · lần {stepIndex}{value}", { stepIndex: job.stepIndex ?? 1, value: job.extendMode === "directive" ? t(" · Theo mô tả") : t(" · Tự động") }) : job.mode === "text" ? t("Từ chữ") : t("Từ ảnh")} · {siteName}</>}
                </dd>
                {job.execPath && (
                  <>
                    <dt className="text-ink-2">{t("Đường chạy")}</dt>
                    <dd className="text-ink">{t(EXEC_PATH_LABEL[job.execPath])}</dd>
                  </>
                )}
                {job.chainId && (
                  <>
                    <dt className="text-ink-2">{t("Chuỗi")}</dt>
                    <dd>
                      <button type="button" className="text-sm font-semibold text-accent-ink hover:underline" onClick={() => openChain(job.chainId!)}>
                        {t("Mở chuỗi kéo dài")}
                      </button>
                    </dd>
                  </>
                )}
                <dt className="text-ink-2">{t("Nguồn")}</dt>
                <dd className="text-ink">{job.apiKeyId ? <ApiSourcePill apiKeyId={job.apiKeyId} /> : job.batchId ? t("Hàng loạt") : "Studio"}</dd>
                <dt className="text-ink-2">{t("Tài khoản")}</dt>
                <dd className="flex items-center gap-2 text-ink">
                  {acc ? (
                    <>
                      <Avatar account={acc} size={20} showStatus={false} /> {acc.alias}
                    </>
                  ) : job.accountPref === "auto" ? (
                    t("Tự động")
                  ) : (
                    accounts.find((a) => a.id === job.accountPref)?.alias ?? "—"
                  )}
                </dd>
                <dt className="text-ink-2">{t("Tạo lúc")}</dt>
                <dd className="font-mono text-xs leading-5 text-ink">{formatDateTime(job.createdAt)}</dd>
                {job.completedAt && (
                  <>
                    <dt className="text-ink-2">{t("Kết thúc")}</dt>
                    <dd className="font-mono text-xs leading-5 text-ink">
                      {formatDateTime(job.completedAt)} {job.startedAt ? `(${formatElapsed(job.completedAt - job.startedAt)})` : ""}
                    </dd>
                  </>
                )}
                <dt className="text-ink-2">{t("Lần thử")}</dt>
                <dd className="text-ink">{job.attemptNo}</dd>
                <dt className="text-ink-2">{t("Liên kết {siteName}", { siteName })}</dt>
                {/* A direct-channel job is tracked by its Muse conversation, which stays in the main process: no page link. */}
                <dd className="text-ink">{job.remoteRef ? t("Có") : job.execPath === "http" ? t("Theo dõi qua kênh trực tiếp") : t("Chưa có")}</dd>
              </dl>
            </section>
            {(job.errorClass || job.errorMessage) && job.state !== "completed" && (
              <section className={cx("rounded-md px-4 py-3", job.state === "needs_review" ? "bg-attention-soft" : job.state === "failed" ? "bg-danger-soft" : "bg-ink/5")}>
                <div className="flex items-center gap-2 text-base font-medium text-ink">
                  <AlertTriangle className={cx("size-4", job.state === "failed" ? "text-danger-ink" : "text-attention-ink")} aria-hidden />
                  {job.errorClass ? t(ERROR_LABEL[job.errorClass]) : t("Ghi chú")}
                </div>
                {job.errorMessage && <p className="mt-1 text-sm text-ink-2">{t(job.errorMessage)}</p>}
                {job.state === "needs_review" && (
                  <p className="mt-2 text-sm text-ink">
                    {t("{value}“Gửi lại” có thể tạo thêm một lượt và tốn thêm hạn mức.", { value: job.remoteRef ? (job.site === "vibes" ? t("“Kiểm lại trên Vibes” đọc lại đúng lượt bên Vibes để lấy kết quả, không tạo mới. ") : t("“Nhập từ lịch sử Muse” sẽ mở lại đúng lượt bên Muse để lấy kết quả, không tạo mới. ")) : "" })}
                  </p>
                )}
                {job.errorClass && ERROR_HINT[job.errorClass] && job.state === "failed" && <p className="mt-1 text-sm text-ink">{t("Gợi ý: {value}", { value: t(ERROR_HINT[job.errorClass]) })}</p>}
              </section>
            )}
            {job.kind === "chat" && job.state === "completed" && (
              <section>
                <h3 className="mb-2 text-sm font-medium text-ink-2">{t("Câu trả lời")}</h3>
                <ChatAnswer job={job} files={data.assets.filter((a) => a.kind === "file")} alias={acc?.alias ?? null} />
              </section>
            )}
            {data.assets.some((a) => a.kind !== "file") && (
              <section>
                <h3 className="mb-2 text-sm font-medium text-ink-2">{t("Kết quả")}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {data.assets.filter((a) => a.kind !== "file").map((a, _i, media) => (
                    <button key={a.id} type="button" onClick={() => openLightbox(a.id, media.map((x) => x.id))} className="overflow-hidden rounded-[12px] ring-1 ring-line" aria-label={t("Xem lớn")}>
                      <img src={thumbUrl(a.id)} alt="" className="aspect-[3/2] w-full object-cover" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3 className="mb-2 text-sm font-medium text-ink-2">{t("Các lần thử")}</h3>
              {data.attempts.length === 0 ? (
                <p className="text-sm text-ink-2">{t("Chưa chạy lần nào.")}</p>
              ) : (
                <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
                  {data.attempts.map((item) => {
                    const a = accounts.find((x) => x.id === item.accountId);
                    return (
                      <li key={item.id} className="relative">
                        <span className={cx("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-surface", item.errorClass ? "bg-danger" : item.outcome === "interrupted" ? "bg-attention" : item.endedAt ? "bg-ok" : "bg-accent")} aria-hidden />
                        <div className="text-sm text-ink">
                          {t(PHASE_LABEL[item.phase])}{item.path ? ` · ${t(EXEC_PATH_LABEL[item.path])}` : ""} · {a?.alias ?? "—"} · <span className="font-mono text-xs">{formatTime(item.startedAt)}</span>
                          {/* An interrupted step ended when the app closed, which is unknown: no duration. */}
                          {item.endedAt && item.outcome !== "interrupted" ? <span className="text-ink-2"> ({formatElapsed(item.endedAt - item.startedAt)})</span> : null}
                        </div>
                        <div className="text-sm text-ink-2">
                          {item.outcome ? t(OUTCOME_LABEL[item.outcome] ?? item.outcome) : t("Đang chạy")}
                          {item.errorClass ? ` — ${t(ERROR_LABEL[item.errorClass])}` : ""}
                          {item.note ? ` · ${t(item.note)}` : ""}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <Confirm
        open={confirm === "stopWaiting"}
        title={t("Ngừng chờ lượt này?")}
        body={t("Muse có thể vẫn tạo xong và vẫn tính vào hạn mức. Em chỉ ngừng chờ trên máy, kết quả (nếu có) sẽ không được tải về.")}
        confirmLabel={t("Ngừng chờ")}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          await act("job.cancel", { jobId: job!.id });
          setBusy(false);
          setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "resend"}
        title={t("Gửi lại lượt này?")}
        body={t("Muse có thể đã nhận lượt trước. Gửi lại có thể tạo thêm một kết quả và tốn thêm hạn mức.")}
        confirmLabel={t("Vẫn gửi lại")}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          await act("job.resolveReview", { jobId: job!.id, resolution: "resend" }, t("Đã đưa lại vào hàng chờ"));
          setBusy(false);
          setConfirm(null);
        }}
      />
    </>
  );
}
