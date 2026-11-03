import type { GwEvent } from "../shared/gateway/events";
import {
  activePath,
  ageHttpHealth,
  HTTP_ACK_TIMEOUT_MS,
  HTTP_FETCH_RETRY_DELAYS_MS,
  HTTP_IDLE_CLOSE_MS,
  HTTP_RECONCILE_GIVE_UP_MS,
  HTTP_RECONCILE_READS,
  HTTP_RECONCILE_SPAN_MS,
  HTTP_RECONNECT_DELAYS_MS,
  HTTP_STABLE_READ_GAP_MS, HTTP_MEDIA_GRACE_MS,
  HTTP_TIMEOUT_MS,
  httpUsable,
  incompatibleAppWide,
  initialHealth,
  manualProbeAllowed,
  probeDue,
  recordHttpFailure,
  recordHttpSuccess,
  SELF_CHECK_EVERY_MS,
  submitGap,
  usesHttp,
  type AccountExecution,
  type BridgeStatus,
  type ExecMode,
  type HttpHealth,
  type HttpReason,
} from "../shared/execution";
import type { Account } from "../shared/types";
import { sleep, throwIfAborted } from "./adapter/types";
import { ChannelError, type HttpChannel } from "./adapter/muse/httpChannel";
import { GW_HISTORY_FALLBACK_MS, GW_POLL_MS } from "./adapter/muse/httpProtocol";

// Build 2.0 R88–R99 — per-account HTTP path state (in memory only), the account's one channel connection, event pump,
// send pacing, probes and the app-wide bridge status. The coordinator stays the only writer of the store.

export interface HttpTimings {
  ackTimeoutMs: number;
  reconnectDelaysMs: readonly number[];
  fetchRetryDelaysMs: readonly number[];
  reconcileReads: number;
  reconcileSpanMs: number;
  reconcileGiveUpMs: number;
  stableGapMs: number;
  mediaGraceMs: number;
  idleCloseMs: number;
  pollMs: number;
  historyFallbackMs: number;
  timeoutMs: { chat: number; image: number; video: number };
  /** R101 pacing between two sends on one account. */
  submitGap: () => number;
}

export const DEFAULT_TIMINGS: HttpTimings = {
  ackTimeoutMs: HTTP_ACK_TIMEOUT_MS,
  reconnectDelaysMs: HTTP_RECONNECT_DELAYS_MS,
  fetchRetryDelaysMs: HTTP_FETCH_RETRY_DELAYS_MS,
  reconcileReads: HTTP_RECONCILE_READS,
  reconcileSpanMs: HTTP_RECONCILE_SPAN_MS,
  reconcileGiveUpMs: HTTP_RECONCILE_GIVE_UP_MS,
  stableGapMs: HTTP_STABLE_READ_GAP_MS,
  mediaGraceMs: HTTP_MEDIA_GRACE_MS,
  idleCloseMs: HTTP_IDLE_CLOSE_MS,
  pollMs: GW_POLL_MS,
  historyFallbackMs: GW_HISTORY_FALLBACK_MS,
  timeoutMs: HTTP_TIMEOUT_MS,
  submitGap: () => submitGap(),
};

export interface ExecDeps {
  channelFor(accountId: string): HttpChannel;
  /** Drops the account's channel (page destroyed); the next channelFor builds a new one. */
  dropChannel?(accountId: string): void;
  now(): number;
  log(level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>): void;
  /** Account execution view changed (account event) — or the bridge status when `accountId` is null. */
  changed(accountId: string | null): void;
  /** R91 — exactly one Windows notification per switch to the UI path (auto mode). */
  switchedToUi(accountId: string, reason: HttpReason): void;
  /** R89 — app-wide incompatibility notice (banner + notification). */
  incompatible(): void;
  httpEnabled(): boolean;
  /** R97 — when the last HTTP turn succeeded, from the store (survives restarts); read once, at the first self-check. */
  lastHttpSuccessAt?(): number | null;
  timings?: Partial<HttpTimings>;
}

type Listener = (e: GwEvent | { kind: "channel"; open: boolean }) => void;

export class ExecutionManager {
  readonly t: HttpTimings;
  private health = new Map<string, HttpHealth>();
  private mismatch = new Map<string, number>();
  private compat: BridgeStatus["compat"] = "unknown";
  private lastCheck: { at: number; ok: boolean } | null = null;
  private results: BridgeStatus["results"] = [];
  private checking = false;
  private probing = new Set<string>();
  private listeners = new Map<string, Map<string, Set<Listener>>>();
  private pumps = new Map<string, Promise<void>>();
  private connecting = new Map<string, Promise<void>>();
  private gate = new Map<string, Promise<void>>();
  private lastSendAt = new Map<string, number>();
  private holds = new Map<string, number>();
  private lastHttpOkAt: number | null = null;
  private lastOkSeeded = false;
  private nextSelfCheckAt: number | null = null;
  private stopped = false;

  constructor(private d: ExecDeps) {
    this.t = { ...DEFAULT_TIMINGS, ...d.timings };
  }

  stop(): void {
    this.stopped = true;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ health
  healthOf(id: string): HttpHealth {
    const h = ageHttpHealth(this.health.get(id) ?? initialHealth(), this.d.now());
    this.health.set(id, h);
    return h;
  }

  /** HTTP can take new sends on this account now (switch on, compatible, health allows). */
  usable(id: string): boolean {
    return this.d.httpEnabled() && this.compat !== "incompatible" && httpUsable(this.healthOf(id));
  }

  /** R89 — one technical failure. `mode` decides whether going down is a switch to the UI path (R91). */
  recordFailure(id: string, reason: HttpReason, mode: ExecMode, opts: { probe?: boolean } = {}): void {
    const before = this.healthOf(id);
    const { health, wentDown } = recordHttpFailure(before, reason, this.d.now(), opts);
    this.health.set(id, health);
    if (health.state !== before.state) this.d.log("warn", "path", "path.state", { id, from: before.state, to: health.state, reason });
    if (reason === "protocol_mismatch") {
      this.mismatch.set(id, this.d.now());
      if (this.compat !== "incompatible" && incompatibleAppWide(this.mismatch, this.d.now())) {
        this.compat = "incompatible";
        this.d.log("error", "path", "gw.incompatible", { accounts: this.mismatch.size });
        this.d.incompatible();
        this.d.changed(null);
      }
    }
    if (wentDown && mode === "auto") {
      this.d.log("warn", "path", "path.switch", { id, to: "ui", reason });
      this.d.switchedToUi(id, reason);
    }
    this.d.changed(id);
  }

  recordSuccess(id: string): void {
    const before = this.healthOf(id);
    const h = recordHttpSuccess(before, this.d.now());
    this.health.set(id, h);
    this.lastHttpOkAt = this.d.now();
    this.mismatch.delete(id);
    if (before.state !== h.state) {
      this.d.log("info", "path", "path.state", { id, from: before.state, to: h.state });
      if (before.state === "down") this.d.log("info", "path", "path.switch", { id, to: "http" });
    }
    if (before.state !== h.state || before.failTimes.length) this.d.changed(id);
  }

  forget(id: string): void {
    this.health.delete(id);
    this.mismatch.delete(id);
    this.listeners.delete(id);
    this.gate.delete(id);
    this.lastSendAt.delete(id);
    this.d.dropChannel?.(id);
  }

  // ------------------------------------------------------------------ connection
  /** Connects the account's channel with the R89 reconnect ladder; one attempt in flight per account. */
  /** `verify` asks the page first instead of trusting the last known state (before a send or a reconcile read). */
  async ensureConnected(id: string, signal?: AbortSignal, verify = false): Promise<HttpChannel> {
    const ch = this.d.channelFor(id);
    if (ch.isOpen() && (!verify || (await ch.checkOpen()))) return ch;
    let p = this.connecting.get(id);
    if (!p) {
      p = (async () => {
        let last: unknown = null;
        for (let i = 0; i <= this.t.reconnectDelaysMs.length; i++) {
          try {
            await ch.connect(signal);
            if (ch.lastWoke) this.d.log("info", "path", "gw.wake", { id });
            if (i > 0) this.d.log("info", "path", "gw.reconnect", { id, attempt: i });
            // R94: a new connection has no subscriptions — whoever reconnected (a send, a reconcile read, the pump),
            // every followed turn is registered again (live-like test 01/11: events were lost until history fallback).
            await this.resubscribeAll(id, ch);
            return;
          } catch (e) {
            last = e;
            // Muse signals and proxy problems are not retried (R90, R96).
            if (e instanceof ChannelError && !["connect_failed", "stream_lost"].includes(e.reason)) throw e;
            if (i < this.t.reconnectDelaysMs.length) await sleep(this.t.reconnectDelaysMs[i], signal);
          }
        }
        throw last instanceof ChannelError ? last : new ChannelError(String(last), "connect_failed");
      })().finally(() => this.connecting.delete(id));
      this.connecting.set(id, p);
    }
    await p;
    return ch;
  }

  /** R101 — waits for this account's turn to send (0.4–1.2 s after the previous send). */
  async paced(id: string, signal: AbortSignal): Promise<void> {
    const prev = this.gate.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.gate.set(id, prev.then(() => mine));
    try {
      await prev;
      throwIfAborted(signal);
      const last = this.lastSendAt.get(id);
      if (last !== undefined) {
        const wait = last + this.t.submitGap() - Date.now();
        if (wait > 0) await sleep(wait, signal);
      }
      this.lastSendAt.set(id, Date.now());
    } finally {
      release();
    }
  }

  // ------------------------------------------------------------------ tracking (R94)
  /** Follows one conversation: events for it reach `listener`; the account's pump runs while anything is tracked. */
  track(id: string, sessionId: string, listener: Listener): () => void {
    let byAcc = this.listeners.get(id);
    if (!byAcc) this.listeners.set(id, (byAcc = new Map()));
    let set = byAcc.get(sessionId);
    if (!set) byAcc.set(sessionId, (set = new Set()));
    set.add(listener);
    void this.subscribe(id, sessionId);
    if (!this.pumps.has(id)) {
      const p = this.pump(id).finally(() => this.pumps.delete(id));
      this.pumps.set(id, p);
    }
    return () => {
      set!.delete(listener);
      if (!set!.size) byAcc!.delete(sessionId);
    };
  }

  tracking(id: string): number {
    return this.listeners.get(id)?.size ?? 0;
  }

  /** R94 — a run uses the account's channel (upload, pacing wait, send, downloads): no idle close until released. */
  hold(id: string): () => void {
    this.holds.set(id, (this.holds.get(id) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.holds.get(id) ?? 1) - 1;
      if (n > 0) this.holds.set(id, n);
      else this.holds.delete(id);
    };
  }

  private async resubscribeAll(id: string, ch: HttpChannel): Promise<void> {
    for (const sid of [...(this.listeners.get(id)?.keys() ?? [])]) {
      try {
        await ch.subscribe(sid);
      } catch {
        return; // the connection died again; the next reconnect repeats this
      }
    }
  }

  private async subscribe(id: string, sessionId: string): Promise<void> {
    try {
      const ch = this.d.channelFor(id);
      if (ch.isOpen()) await ch.subscribe(sessionId);
    } catch {
      /* the pump re-subscribes after a reconnect */
    }
  }

  private emit(id: string, e: GwEvent | { kind: "channel"; open: boolean }, sessionId?: string): void {
    const byAcc = this.listeners.get(id);
    if (!byAcc) return;
    const sets = sessionId ? [byAcc.get(sessionId)] : [...byAcc.values()];
    for (const s of sets) for (const l of [...(s ?? [])]) l(e);
  }

  private async pump(id: string): Promise<void> {
    let idleSince: number | null = null;
    while (!this.stopped) {
      const n = this.tracking(id);
      if (n === 0) {
        if (this.holds.get(id)) {
          // A run is between steps (upload, pacing, downloads): not idle, nothing to poll yet.
          idleSince = null;
          await sleep(this.t.pollMs * 5);
          continue;
        }
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= this.t.idleCloseMs) {
          this.d.channelFor(id).close(); // R94: no tracked turn for 60 s → close the connection
          return;
        }
        await sleep(Math.min(this.t.pollMs * 5, this.t.idleCloseMs));
        continue;
      }
      idleSince = null;
      const ch = this.d.channelFor(id);
      try {
        if (!ch.isOpen()) {
          await this.ensureConnected(id); // re-subscribes every followed turn
          this.emit(id, { kind: "channel", open: true });
        }
        const r = await ch.poll();
        for (const e of r.events) if (e.sess) this.emit(id, e, e.sess);
        if (!r.open) this.emit(id, { kind: "channel", open: false });
      } catch (e) {
        const reason: HttpReason = e instanceof ChannelError && ["connect_failed", "stream_lost", "protocol_mismatch"].includes(e.reason) ? (e.reason as HttpReason) : "stream_lost";
        this.emit(id, { kind: "channel", open: false });
        // The runner records the failure once per job (R89 “mỗi việc tính tối đa một sự kiện cho mỗi loại”).
        this.d.log("warn", "path", "gw.pump", { id, reason });
        await sleep(this.t.reconnectDelaysMs[this.t.reconnectDelaysMs.length - 1] ?? 10_000);
        continue;
      }
      await sleep(this.t.pollMs);
    }
  }

  // ------------------------------------------------------------------ probes and self-check (R92, R97)
  /** One read-only probe (no prompt). Updates health; returns the plain result. */
  async probe(acc: Account, manual: boolean): Promise<{ ok: boolean; reason: string | null; skipped?: boolean }> {
    const h = this.healthOf(acc.id);
    if (manual) {
      if (!manualProbeAllowed(h, this.d.now())) return { ok: false, reason: null, skipped: true };
      this.health.set(acc.id, { ...h, lastManualProbeAt: this.d.now() });
    }
    if (this.probing.has(acc.id)) return { ok: false, reason: null, skipped: true };
    this.probing.add(acc.id);
    this.d.changed(acc.id);
    try {
      const ch = this.d.channelFor(acc.id);
      const wasOpen = ch.isOpen();
      const r = await ch.probe();
      this.d.log(r.ok ? "info" : "warn", "path", "path.probe", { id: acc.id, ok: r.ok, reason: r.reason });
      if (r.ok && !wasOpen) await this.resubscribeAll(acc.id, ch); // the probe opened a fresh connection
      if (r.ok) {
        this.recordSuccess(acc.id);
        // App-wide incompatibility is lifted only by “Kiểm ngay” (checkNow) or a new app version (R89).
        if (this.compat === "unknown") this.compat = "ok";
        this.d.changed(null);
      } else if (r.reason && ["connect_failed", "stream_lost", "protocol_mismatch", "fetch_failed"].includes(r.reason)) {
        this.recordFailure(acc.id, r.reason as HttpReason, acc.execMode, { probe: true });
      }
      return { ok: r.ok, reason: r.ok ? null : r.message || r.reason };
    } finally {
      this.probing.delete(acc.id);
      this.d.changed(acc.id);
    }
  }

  /** R92 — due automatic probes for accounts whose HTTP is down (ready/busy, auto/http, switch on). */
  dueProbes(accounts: Account[]): Account[] {
    if (!this.d.httpEnabled()) return [];
    const now = this.d.now();
    return accounts.filter((a) => usesHttp(a.execMode) && (a.state === "ready" || a.state === "busy") && !this.probing.has(a.id) && probeDue(this.healthOf(a.id), now));
  }

  /** R97 — “Kiểm ngay”: each ready auto/http account in turn, ≥ 2 s apart. */
  async checkNow(accounts: Account[], gapMs = 2_000): Promise<BridgeStatus> {
    if (this.checking) return this.bridge();
    this.checking = true;
    this.d.changed(null);
    const results: BridgeStatus["results"] = [];
    try {
      const list = accounts.filter((a) => usesHttp(a.execMode) && a.state === "ready");
      // Nothing free to probe (all busy, paused or signed out) is not a failed check: keep the previous result.
      if (!list.length) return this.bridge();
      for (let i = 0; i < list.length; i++) {
        if (i) await sleep(gapMs);
        const a = list[i];
        const r = await this.probe(a, false);
        results.push({ accountId: a.id, alias: a.alias, ok: r.ok, at: this.d.now(), reason: r.ok ? null : r.reason });
      }
      const ok = results.some((r) => r.ok);
      this.lastCheck = { at: this.d.now(), ok };
      if (ok) {
        this.compat = "ok";
        this.mismatch.clear();
      }
      this.results = results;
      return this.bridge();
    } finally {
      this.checking = false;
      this.d.changed(null);
    }
  }

  /** R97 — self-check 60 s after first frame, then every 6 h, only when no HTTP turn succeeded for 6 h. */
  selfCheckDue(firstFrameAt: number | null, firstDelayMs: number): boolean {
    if (!this.d.httpEnabled() || firstFrameAt === null) return false;
    const now = this.d.now();
    this.nextSelfCheckAt ??= firstFrameAt + firstDelayMs;
    if (now < this.nextSelfCheckAt) return false;
    this.nextSelfCheckAt = now + SELF_CHECK_EVERY_MS;
    if (!this.lastOkSeeded) {
      // A success from before this start counts too (AC-PATH-11 ca 2: one an hour ago → no check after opening the app).
      this.lastOkSeeded = true;
      const stored = this.d.lastHttpSuccessAt?.() ?? null;
      if (stored !== null && (this.lastHttpOkAt === null || stored > this.lastHttpOkAt)) this.lastHttpOkAt = stored;
    }
    return this.lastHttpOkAt === null || now - this.lastHttpOkAt >= SELF_CHECK_EVERY_MS;
  }

  async selfCheck(accounts: Account[]): Promise<void> {
    const a = accounts.find((x) => usesHttp(x.execMode) && x.state === "ready");
    if (!a) return;
    const r = await this.probe(a, false);
    this.lastCheck = { at: this.d.now(), ok: r.ok };
    this.results = [{ accountId: a.id, alias: a.alias, ok: r.ok, at: this.d.now(), reason: r.ok ? null : r.reason }];
    this.d.changed(null);
  }

  // ------------------------------------------------------------------ views
  bridge(): BridgeStatus {
    return { httpEnabled: this.d.httpEnabled(), compat: this.compat, lastCheckAt: this.lastCheck?.at ?? null, lastCheckOk: this.lastCheck?.ok ?? null, results: this.results, checking: this.checking };
  }

  view(a: Account, runningHttp: number, runningUi: number): AccountExecution {
    const h = this.healthOf(a.id);
    const enabled = this.d.httpEnabled() && this.compat !== "incompatible";
    const off = a.execMode === "ui" || !enabled;
    const httpState = off ? "off" : h.state;
    const reason = a.execMode === "ui" ? "mode_ui" : !this.d.httpEnabled() ? "global_off" : this.compat === "incompatible" ? "incompatible" : h.reason;
    return {
      mode: a.execMode,
      activePath: activePath(enabled ? a.execMode : a.execMode === "http" ? "http" : "ui", this.usable(a.id)),
      httpState,
      reason,
      since: h.since,
      nextProbeAt: h.state === "down" ? h.nextProbeAt : null,
      runningHttp,
      runningUi,
      maxConcurrent: a.maxConcurrent,
      uiMaxConcurrent: a.uiMaxConcurrent,
      probing: this.probing.has(a.id),
      failCount: h.failTimes.length,
    };
  }
}
