import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMMANDS, SETTINGS_VALIDATORS, type CommandName, type CommandResult } from "../shared/ipc";
import { redact } from "../shared/redact";
import { suggestProxy } from "../shared/proxyShare";
import { publicJob } from "../shared/jobMachine";
import { canOpenFile, safeHttpUrl } from "../shared/chat";
import type { Settings, Site } from "../shared/types";
import { CommandError, type Coordinator } from "./coordinator";
import type { Services } from "./services";
import type { ApiController } from "./api/controller";
import { canWriteDir } from "./paths";
import { seedDataset } from "./testSeed";
import { SKILL_SOURCES, SKILL_ZIP_NAME, skillZip } from "@content/skill";
import { installSkill, SkillInstallError, skillTargetInfo } from "./skillInstall";

// Command dispatcher: schema-validated input → coordinator/services (AC-SEC-02). Unknown commands are rejected.

export interface ShellOps {
  minimize(): void;
  toggleMaximize(): void;
  closeWindow(): void;
  quit(force: boolean): { needsConfirm: boolean; running: number };
  quitInfo(): { running: number };
  openFileDialog(kind: "batch" | "image" | "proxy" | "chat"): Promise<string | null>;
  saveFileDialog(defaultName: string, ext: "csv" | "zip"): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  openPath(p: string): Promise<string>;
  showItemInFolder(p: string): void;
  copyFile(p: string, mime: string): void;
  setLoginItem(on: boolean): void;
  dataDir(): string;
  previewStart(id: string): void;
  showAccountWindow(id: string, site?: "muse" | "vibes"): void;
  previewStop(id: string): void;
  testScript?(accountId: string, steps: Record<string, unknown>[]): void;
  /** Test mode: script the fake Vibes of one account (errors, session answers). */
  testVibes?(accountId: string, steps: Record<string, unknown>[] | undefined, me: unknown[] | undefined): void;
  /** Test mode: what the fake Usage panel shows (`null` = default, `"fail"` = the read fails). */
  testQuota?(accountId: string, text: string | null, delayMs?: number): void;
  testGw?(accountId: string, steps: Record<string, unknown>[] | undefined, opts?: { completeMs?: number; replyText?: string; replyFiles?: { name: string; mime: string; text: string }[] }): void;
  /** Same function the tray menu "Thoát" calls (AC-APP-03 E2E). */
  trayQuit?(): void;
  /** Same function a notification click calls: show the window and open a route. */
  showRoute?(route: string): void;
  /** Same function a Windows toast activation calls, for a toast of this run or of an older run (AC-VIB-10). */
  activateToast?(route: string, fromThisRun: boolean): void;
  metrics?(): unknown;
  /** Test mode (Build 3.2): the account's real Muse window and its popups/tabs — same functions takeover and sign-in use. */
  testExtra?(accountId: string, op: "open" | "state" | "hide" | "close", arg: { url?: string; keepTabs?: boolean }): Promise<unknown>;
  flushEvents?(): void;
  /** Opens an http(s) URL in the default browser (only URLs built by the main process). */
  openUrl?(url: string): Promise<void>;
  /** The user's home folder (Claude Code skills live under it); test mode may point it at a scratch folder. */
  homeDir?(): string;
}

export class IpcDispatcher {
  private readyLogged = false;
  constructor(
    private coord: Coordinator,
    private svc: Services,
    private sh: ShellOps,
    private opts: {
      testMode: boolean;
      log: (level: "info" | "warn" | "error", scope: string, msg: string, data?: Record<string, unknown>) => void;
      api?: ApiController;
      /** Main-process start-up phases (ms since process start), logged with the first frame. */
      startupPhases?: () => Record<string, number>;
      /** Called once when the renderer reports its first frame. */
      onFirstFrame?: () => void;
    },
  ) {}

  private home(): string {
    return this.sh.homeDir?.() ?? os.homedir();
  }

  private mustApi(): ApiController {
    if (!this.opts.api) throw new CommandError("API cho agent chưa sẵn sàng", "unavailable");
    return this.opts.api;
  }

  async dispatch(name: string, raw: unknown): Promise<CommandResult> {
    // AC-SEC-02: refuse, log a warning (command name only — never the payload), and never run anything.
    const shown = String(name).replace(/[^\w.-]/g, "?").slice(0, 64);
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, name) || (name.startsWith("__test.") && !this.opts.testMode)) {
      this.opts.log("warn", "ipc", "rejected unknown command", { name: shown });
      return { ok: false, error: "Lệnh không hợp lệ", code: "unknown_command" };
    }
    const schema = COMMANDS[name as CommandName];
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      this.opts.log("warn", "ipc", "rejected invalid input", { name: shown, issues: parsed.error.issues.length });
      return { ok: false, error: "Dữ liệu gửi lên không hợp lệ", code: "invalid_input" };
    }
    try {
      const data = await this.run(name as CommandName, parsed.data as Record<string, never>);
      return { ok: true, data: data ?? null };
    } catch (e) {
      if (e instanceof CommandError) return { ok: false, error: e.message, code: e.code };
      this.opts.log("error", "ipc", "command failed", { name, error: redact(e) });
      return { ok: false, error: "Có lỗi không mong muốn, anh thử lại giúp em", code: "internal" };
    }
  }

  private async run(name: CommandName, i: Record<string, never>): Promise<unknown> {
    const c = this.coord;
    const s = this.svc;
    const a = i as unknown as Record<string, unknown> & { id: string; jobId: string; assetId: string };
    switch (name) {
      case "app.snapshot":
        return this.opts.api ? { ...c.snapshot(), api: this.opts.api.status() } : c.snapshot();
      case "app.ping":
        return { t: Date.now() };
      case "app.markReady": {
        // §5 start-up budget: process start → first interactive frame, written to the local log only.
        const processMs = Math.round(process.uptime() * 1000);
        const first = !this.readyLogged;
        this.readyLogged = true;
        // Renderer phases (ms since the renderer's own time origin): bundle running, snapshot back, first frame.
        const rendererPhases = a.scriptMs !== undefined && a.snapMs !== undefined ? { script: Math.round(Number(a.scriptMs)), snapshot: Math.round(Number(a.snapMs)), frame: Math.round(Number(a.ms)) } : undefined;
        this.opts.log("info", "app", first ? "startup" : "renderer reload", {
          processMs,
          rendererMs: Math.round(Number(a.ms)),
          ...(first && this.opts.startupPhases ? { phases: this.opts.startupPhases() } : {}),
          ...(rendererPhases ? { rendererPhases } : {}),
        });
        if (first) this.opts.onFirstFrame?.();
        return { processMs, first };
      }
      case "app.setRoute":
        c.setSetting("lastRoute", String(a.route));
        return null;
      case "app.dismissRecovered":
        c.dismissRecovered();
        return null;
      case "app.quit":
        return this.sh.quit(!!a.force);
      case "app.quitInfo":
        return this.sh.quitInfo();
      case "app.trayExplained":
        c.setSetting("closeToTrayExplained", true);
        return null;
      case "app.openUrl": {
        const url = String(a.url);
        if (!safeHttpUrl(url)) throw new CommandError("Chỉ mở được liên kết http hoặc https", "validation");
        await this.sh.openUrl?.(url);
        return null;
      }
      case "win.minimize":
        return this.sh.minimize();
      case "win.maximize":
        return this.sh.toggleMaximize();
      case "win.close":
        return this.sh.closeWindow();

      // ---------- jobs
      case "job.create": {
        const ids = await c.createJobs(i as never);
        // §5: the new card must show ≤ 100 ms after Send, so skip the 100 ms event coalescing for this one.
        this.sh.flushEvents?.();
        return ids;
      }
      case "job.cancel":
        return c.cancelJob(a.jobId);
      case "job.retry":
        return c.retryJob(a.jobId);
      case "job.retryNow":
        return c.retryNow(a.jobId);
      case "job.prioritize":
        return c.prioritize(a.jobId);
      case "job.changeAccount":
        return c.changeAccount(a.jobId, String(a.accountPref));
      case "job.resolveReview":
        return c.resolveReview(a.jobId, a.resolution as "import" | "resend" | "dismiss");
      case "job.get":
        return c.jobDetail(a.jobId);
      case "job.query": {
        const page = c.repo.queryJobs(i as never);
        const assets = c.repo.assetsForJobs(page.items.map((j) => j.id));
        // R96: rows pass through publicJob so main-only ids (Muse conversation, reconcile baseline) never reach the renderer.
        return { ...page, items: page.items.map((j) => ({ ...publicJob(j), assets: assets.get(j.id) ?? [] })) };
      }
      case "job.stateCounts":
        return c.repo.stateCounts((a.batchId as string | null | undefined) ?? undefined, a.search as string | undefined);
      case "job.markFailedSeen":
        c.markFailedSeen();
        return null;

      // ---------- batches
      case "batch.parse":
        return s.parseBatch(String(a.text), a.defaults as never, a.fileName as string | undefined, a.baseDir as string | undefined);
      case "batch.pickFile": {
        const f = await this.sh.openFileDialog("batch");
        if (!f) return null;
        const st = fs.statSync(f);
        if (st.size > 5 * 1024 * 1024) throw new CommandError("Tệp lớn hơn 5 MB");
        const text = fs.readFileSync(f, "utf8");
        return { text, fileName: path.basename(f), baseDir: path.dirname(f) };
      }
      case "batch.saveDraft":
        return c.saveDraft(i as never);
      case "batch.start":
        return s.startBatch(a.id);
      case "batch.pause":
        return c.pauseBatch(a.id);
      case "batch.resume":
        return c.resumeBatch(a.id);
      case "batch.cancelRemaining":
        return c.cancelRemaining(a.id);
      case "batch.retryFailed":
        return c.retryFailed(a.id);
      case "batch.delete":
        c.deleteDraft(a.id);
        return null;
      case "batch.exportCsv": {
        const { name: bn, csv } = s.batchCsv(a.id);
        const f = await this.sh.saveFileDialog(`${bn}.csv`, "csv");
        if (!f) return null;
        fs.writeFileSync(f, csv, "utf8");
        return { path: f };
      }
      case "batch.openFolder":
        await this.sh.openPath(s.batchFolder(a.id));
        return null;
      case "batch.fromAssets":
        return s.batchFromAssets(a.assetIds as string[]);

      // ---------- references
      case "reference.pick": {
        const f = await this.sh.openFileDialog("image");
        return f ? s.addReferencePath(f) : null;
      }
      case "reference.addPath":
        return s.addReferencePath(String(a.filePath));
      case "reference.addBytes": {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(String(a.data));
        const bytes = Buffer.from(m ? m[2] : String(a.data), "base64");
        return s.addReferenceBytes(bytes, (a.name as string) || "Ảnh dán");
      }
      case "reference.fromAsset":
        return s.referenceFromAsset(a.assetId);

      // ---------- accounts
      case "account.add":
        return c.addAccount(i as never);
      case "account.rename":
        return c.renameAccount(a.id, String(a.alias), a.avatar as number | undefined);
      case "account.remove":
        return c.removeAccount(a.id, !!a.force);
      case "account.pause":
        return c.pauseAccount(a.id);
      case "account.resume":
        return c.resumeAccount(a.id);
      case "account.setProxy":
        return c.setAccountProxy(a.id, String(a.proxyId), !!a.force);
      case "account.cancelProxyChange":
        c.cancelProxyChange(a.id);
        return null;
      case "account.openLogin":
        return c.openLogin(a.id, a.site as "muse" | "vibes" | undefined);
      case "account.cancelLogin":
        c.cancelLogin(a.id);
        return null;
      case "account.skipLoginStep":
        c.skipLoginStep(a.id);
        return null;
      case "account.loginCheckNow":
        c.loginCheckNow(a.id);
        return null;
      case "account.loginState":
        return c.loginState(a.id);
      case "account.showWindow":
        if (a.site === "vibes" && !c.supportsVibes()) throw new CommandError("Vibes đã được bỏ khỏi Muse4AI", "unavailable");
        this.sh.showAccountWindow(a.id, a.site as "muse" | "vibes" | undefined);
        return null;
      case "account.checkSession":
        return c.checkSession(a.id);
      case "account.previewStart":
        this.sh.previewStart(a.id);
        return null;
      case "account.previewStop":
        this.sh.previewStop(a.id);
        return null;
      case "account.takeoverStart":
        return c.takeoverStart(a.id, a.mode as "afterCurrent" | "now", (a.site as "muse" | "vibes" | undefined) ?? "muse");
      case "account.takeoverEnd":
        return c.takeoverEnd(a.id);
      case "account.readQuota":
        return c.readQuota(a.id);
      case "account.exitIp":
        return c.exitIp(a.id);
      case "account.suggestProxy": {
        const free = suggestProxy(c.repo.listProxies(), c.repo.listAccounts());
        return { proxyId: free?.id ?? null };
      }

      case "account.checkVibes":
        return c.checkVibes(a.id);
      case "account.setVibesEnabled":
        return c.setVibesEnabled(a.id, !!a.enabled);
      case "account.acceptVibesIdentity":
        return c.acceptVibesIdentity(a.id);
      case "account.setExecution":
        return c.setExecution(a.id, { mode: a.mode as "auto" | "http" | "ui", maxConcurrent: Number(a.maxConcurrent), uiMaxConcurrent: Number(a.uiMaxConcurrent) });
      case "account.probeHttp":
        return c.probeHttp(a.id);
      case "bridge.checkNow":
        return c.bridgeCheckNow();

      // ---------- Hỏi đáp (Build 2.0)
      case "chat.create": {
        const id = c.createChatJob(i as never);
        this.sh.flushEvents?.();
        return c.jobDetail(id);
      }
      case "chat.pickAttachment": {
        const f = await this.sh.openFileDialog("chat");
        return f ? s.addChatAttachmentPath(f) : null;
      }
      case "chat.attachPath":
        return s.addChatAttachmentPath(String(a.filePath));
      case "chat.attachBytes": {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(String(a.data));
        return s.addChatAttachmentBytes(Buffer.from(m ? m[2] : String(a.data), "base64"), String(a.name));
      }
      case "chat.conversation":
        return c.conversationView(String(a.conversationId));
      case "chat.readText":
        return s.readChatText(a.assetId);

      // ---------- Kéo dài (F16)
      case "extend.start": {
        const r = c.startExtend(i as never);
        this.sh.flushEvents?.();
        return r;
      }
      case "chain.get":
        return c.chainDetail(a.id);
      case "chain.list":
        return c.listChains();
      case "chain.cancel":
        return c.cancelChain(a.id);
      case "chain.continue":
        return c.continueChain(a.id);

      // ---------- proxies
      case "proxy.import":
        return c.importProxies(String(a.text));
      case "proxy.pickFile": {
        const f = await this.sh.openFileDialog("proxy");
        if (!f) return null;
        if (fs.statSync(f).size > 1024 * 1024) throw new CommandError("Tệp lớn hơn 1 MB");
        return c.importProxies(fs.readFileSync(f, "utf8"));
      }
      case "proxy.test":
        await c.testProxy(a.id);
        return c.repo.getProxy(a.id);
      case "proxy.testAll":
        return c.testAllProxies();
      case "proxy.remove":
        c.removeProxy(a.id);
        return null;
      case "proxy.unassign":
        c.unassignProxy(a.id);
        return null;

      // ---------- library
      case "library.query":
        return c.repo.queryAssets(i as never);
      case "library.facets":
        return c.repo.libraryFacets();
      case "library.reveal":
        this.sh.showItemInFolder(s.mustAssetFile(a.assetId).path);
        return null;
      case "library.open": {
        const file = s.mustAssetFile(a.assetId);
        // R84 — a chat output that Windows could run or script is never opened from the app, only shown in its folder.
        if (file.kind === "file" && !canOpenFile(file.filename ?? path.basename(file.path))) throw new CommandError("Loại tệp này có thể chạy chương trình nên app không mở — bấm “Mở thư mục” để xem", "unsupported_file");
        const err = await this.sh.openPath(file.path);
        if (err) throw new CommandError("Windows không mở được tệp này");
        return null;
      }
      case "library.copyFile": {
        const asset = s.mustAssetFile(a.assetId);
        this.sh.copyFile(asset.path, asset.mime);
        return null;
      }
      case "library.trash":
        return s.trash(a.assetIds as string[]);
      case "library.favorite":
        return s.favorite(a.assetId, !!a.value);
      case "library.rescan":
        return s.rescan();
      case "library.get":
        return c.repo.getAsset(a.assetId);

      // ---------- settings
      case "settings.set": {
        const key = String(a.key) as keyof Settings;
        const v = SETTINGS_VALIDATORS[key]?.safeParse(a.value);
        if (!v?.success) throw new CommandError("Giá trị cài đặt không hợp lệ");
        if (key === "launchAtLogin") this.sh.setLoginItem(!!v.data);
        if (key === "concurrencyUiPages" && Number(v.data) > c.settings().globalConcurrency) throw new CommandError("Số trang giao diện không được lớn hơn tổng việc cùng lúc");
        return c.setSetting(key, v.data as never);
      }
      case "settings.pickLibraryDir": {
        const dir = await this.sh.pickDirectory();
        if (!dir) return null;
        if (!canWriteDir(dir)) throw new CommandError("Không ghi được vào thư mục này — chọn thư mục khác", "not_writable");
        return c.setSetting("libraryDir", dir);
      }
      case "settings.openDataDir":
        await this.sh.openPath(this.sh.dataDir());
        return null;
      case "diagnostics.export": {
        const zip = s.diagnosticsZip();
        const d = new Date();
        const f = await this.sh.saveFileDialog(`Muse4AI-chan-doan-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.zip`, "zip");
        if (!f) return null;
        fs.writeFileSync(f, zip);
        return { path: f, bytes: zip.length };
      }
      case "engine.clearUiChanged":
        c.clearUiChanged(undefined, a.site as Site | undefined);
        return null;

      // ---------- agent API (§4.8)
      case "api.status":
        return this.mustApi().status();
      case "api.setEnabled":
        return this.mustApi().setEnabled(!!a.enabled);
      case "api.setPort":
        return this.mustApi().setPort(Number(a.port));
      case "api.setAccess":
        return this.mustApi().setAccess(a.access as never, !!a.confirmInternet);
      case "api.setNamedTunnel":
        return this.mustApi().setNamedTunnel({ hostname: String(a.hostname), token: (a.token as string | null | undefined) ?? undefined });
      case "api.clearTunnelToken":
        return this.mustApi().clearTunnelToken();
      case "api.retryTunnel":
        return this.mustApi().retryTunnel();
      case "api.setDomain":
        return this.mustApi().setDomain({
          enabled: !!a.enabled,
          host: a.host === undefined ? undefined : String(a.host),
          proxy: a.proxy as "managed" | "external" | undefined,
          confirmInternet: !!a.confirmInternet,
        });
      case "api.domainRetry":
        return this.mustApi().domainRetry();
      case "api.domainCheck":
        return this.mustApi().domainCheck();
      case "api.createKey":
        return this.mustApi().createKey(String(a.name), a.scope as never);
      case "api.revokeKey":
        return this.mustApi().revokeKey(String(a.id));
      case "api.revokeClient":
        return this.mustApi().revokeClient(String(a.id));
      case "api.dismissConsent":
        return this.mustApi().dismissConsent(String(a.id));
      case "api.requestLog":
        return this.mustApi().requestLog(a.limit === undefined ? 50 : Number(a.limit));
      case "api.openDocs": {
        const st = this.mustApi().status();
        if (!st.localUrl) throw new CommandError("API đang tắt");
        await this.sh.openUrl?.(`${st.localUrl}/v1/openapi.json`);
        return null;
      }

      // ---------- Agent Skill (Build 3.0 R3-SKILL.5/6)
      case "skill.info":
        return skillTargetInfo(this.home());
      case "skill.install": {
        const enc = new TextEncoder();
        const files = Object.entries(SKILL_SOURCES).map(([name, text]) => ({ name, data: enc.encode(text) }));
        try {
          return installSkill(this.home(), files, { replace: a.replace === true });
        } catch (e) {
          if (e instanceof SkillInstallError) throw new CommandError(e.message, e.code === "exists" ? "conflict" : e.code === "unsafe_path" ? "validation" : "io");
          throw e;
        }
      }
      case "skill.saveZip": {
        const f = await this.sh.saveFileDialog(SKILL_ZIP_NAME, "zip");
        if (!f) return null;
        const zip = skillZip();
        fs.writeFileSync(f, zip);
        return { path: f, bytes: zip.length };
      }

      // ---------- test-only
      case "__test.freeze": {
        const until = Date.now() + Number(a.ms);
        while (Date.now() < until) {
          /* deliberately block the main process (heartbeat test) */
        }
        return null;
      }
      case "__test.script":
        this.sh.testScript?.(String(a.accountId), a.steps as Record<string, unknown>[]);
        return null;
      case "__test.navigate":
        this.sh.showRoute?.(String(a.route));
        return null;
      case "__test.activateToast":
        this.sh.activateToast?.(String(a.route), !!a.fromThisRun);
        return null;
      case "__test.trayQuit":
        this.sh.trayQuit?.();
        return null;
      case "__test.setCaps":
        return c.testSetCapabilities(String(a.accountId), a.caps as Record<string, boolean>);
      case "__test.metrics":
        return this.sh.metrics?.() ?? null;
      case "__test.setVerified":
        return c.testSetVerified(a.caps as Record<string, boolean>);
      case "__test.gw":
        this.sh.testGw?.(String(a.accountId), a.steps as Record<string, unknown>[] | undefined, { completeMs: a.completeMs as number | undefined, replyText: a.replyText as string | undefined, replyFiles: a.replyFiles as { name: string; mime: string; text: string }[] | undefined });
        return null;
      case "__test.vibes":
        this.sh.testVibes?.(String(a.accountId), a.steps as Record<string, unknown>[] | undefined, a.me as unknown[] | undefined);
        return null;
      case "__test.quota":
        if (a.text !== undefined) this.sh.testQuota?.(String(a.accountId), (a.text as string | null) ?? null, a.delayMs as number | undefined);
        if (typeof a.ageMs === "number") c.ageQuotaForTest(String(a.accountId), a.ageMs);
        return null;
      case "__test.extra":
        return (await this.sh.testExtra?.(String(a.accountId), a.op as "open" | "state" | "hide" | "close", { url: a.url as string | undefined, keepTabs: a.keepTabs as boolean | undefined })) ?? null;
      case "__test.seed":
        return seedDataset(c.repo, c.settings().libraryDir, { jobs: Number(a.jobs), assets: Number(a.assets) });
    }
    throw new CommandError("Lệnh không hợp lệ", "unknown_command");
  }
}
