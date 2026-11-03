import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatDate, formatDateTime, formatNumber, formatUntil } from "../src/shared/format";
import { DEFAULT_LOCALE, getLocale, localeFromAcceptLanguage, missingKeys, resolveStartLocale, setLocale, t, tc, tl } from "../src/shared/i18n";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/main/db";
import { defaultSettings, Repo } from "../src/main/repo";
import { sqlite } from "./helpers";
import { SETTINGS_VALIDATORS } from "../src/shared/ipc";

// Build 2.0 R120–R122 — two UI languages (docs/build-2.0/spec.md rev 3).

afterEach(() => setLocale("vi"));

describe("AC-I18N-07 number/date/size formatting follows the UI language", () => {
  const nov2 = new Date(2026, 10, 2, 15, 40).getTime();
  it("Vietnamese: 1.234.567 · 02/11/2026 · 1,5 MB", () => {
    setLocale("vi");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatDate(nov2)).toBe("02/11/2026");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatDateTime(nov2)).toBe("15:40 · 02/11/2026");
  });
  it("English: 1,234,567 · Nov 2, 2026 · 1.5 MB, 24-hour clock kept", () => {
    setLocale("en");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatDate(nov2)).toBe("Nov 2, 2026");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatDateTime(nov2)).toBe("15:40 · Nov 2, 2026");
    expect(formatUntil(nov2, nov2 + 86_400_000)).toBe("15:40 · Nov 2");
  });
});

describe("AC-I18N-08 English is the default language", () => {
  it("fresh settings start in English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(defaultSettings("C:/lib").language).toBe("en");
  });
  it("a fresh process (no saved language) translates to English", async () => {
    vi.resetModules();
    const fresh = await import("../src/shared/i18n");
    expect(fresh.getLocale()).toBe("en");
    expect(fresh.t("Hàng chờ")).toBe("Queue");
  });
  it("R124: an installer-picked language is the first choice only while none is saved", () => {
    expect(resolveStartLocale(undefined, "vi")).toEqual({ locale: "vi", persist: true });
    expect(resolveStartLocale("en", "vi")).toEqual({ locale: "en", persist: false });
    expect(resolveStartLocale("vi", null)).toEqual({ locale: "vi", persist: false });
    expect(resolveStartLocale(null, "fr")).toEqual({ locale: "en", persist: false });
    expect(resolveStartLocale(null, null)).toEqual({ locale: "en", persist: false });
  });
  it("R124: a store upgraded from an older build has no saved language until one is chosen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-lang-"));
    const { db } = openDatabase(sqlite, path.join(dir, "data", "muse.sqlite"), path.join(dir, "backups"));
    const repo = new Repo(db);
    expect(repo.hasSetting("language")).toBe(false);
    expect(repo.getSettings(defaultSettings("C:/lib")).language).toBe("en");
    repo.setSetting("language", "vi");
    expect(repo.hasSetting("language")).toBe(true);
    expect(resolveStartLocale(repo.getSettings(defaultSettings("C:/lib")).language, "en")).toEqual({ locale: "vi", persist: false });
    db.close();
  });
  it("the setting accepts only vi / en", () => {
    expect(SETTINGS_VALIDATORS.language.safeParse("en").success).toBe(true);
    expect(SETTINGS_VALIDATORS.language.safeParse("fr").success).toBe(false);
  });
});

describe("t(): messages with placeholders", () => {
  it("Vietnamese fills the key itself", () => {
    expect(t("Đã chọn {selectedCount}", { selectedCount: 3 })).toBe("Đã chọn 3");
  });
  it("English uses the catalog and picks plurals", () => {
    setLocale("en");
    expect(t("Hàng chờ")).toBe("Queue");
    expect(t("Huỷ {canCancelCount} lượt?", { canCancelCount: 1 })).toBe("Cancel 1 job?");
    expect(t("Huỷ {canCancelCount} lượt?", { canCancelCount: 4 })).toBe("Cancel 4 jobs?");
    expect(t("{n} tệp", { n: "1,234" })).toBe("1,234 files");
  });
});

describe("AC-I18N-04 stored Vietnamese text is shown in the current language", () => {
  it("app-made errors with numbers/names inside translate; Muse text inside stays verbatim", () => {
    setLocale("en");
    expect(t("Tải tệp từ Muse lỗi: timeout")).toBe("Failed to download the file from Muse: timeout");
    expect(t("Muse không tạo nội dung: “I can't help with that”")).toBe("Muse did not generate content: “I can't help with that”");
    expect(t("Muse chưa xong sau 12 phút")).toBe("Muse has not finished after 12 minutes");
    expect(t("Proxy đang dùng cho Mây")).toBe("The proxy is in use by Mây");
  });
  it("a nested app message is translated inside the outer one", () => {
    setLocale("en");
    expect(t("Lần 3 lỗi: Muse báo hết hạn mức")).toBe("Step 3 failed: Muse reports the quota is exhausted");
  });
  it("text that is not from the app (prompt, Muse answer) is left as it is", () => {
    setLocale("en");
    expect(t("Một tách cà phê trên bàn gỗ ở Đà Lạt")).toBe("Một tách cà phê trên bàn gỗ ở Đà Lạt");
    expect(t("upstream 502")).toBe("upstream 502");
  });
  it("multi-line stored errors translate line by line", () => {
    setLocale("en");
    expect(t("Dữ liệu cục bộ bị hỏng (quick_check)\nKhông tìm thấy bản sao lưu nào dùng được.")).toBe("Local data is corrupted (quick_check)\nNo usable backups found.");
  });
  it("Vietnamese mode never changes stored text", () => {
    expect(t("Tải tệp từ Muse lỗi: timeout")).toBe("Tải tệp từ Muse lỗi: timeout");
  });
});

describe("AC-I18N-06 API language from Accept-Language", () => {
  it("picks the first supported language by quality", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("fr-FR, vi;q=0.8, en;q=0.5")).toBe("vi");
    expect(localeFromAcceptLanguage("de, fr")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage("en;q=0, vi")).toBe("vi");
  });
  it("tl() translates for an explicit language without touching the app language", () => {
    expect(tl("en", "Khoá API sai hoặc đã bị thu hồi")).toBe("Invalid or revoked API key");
    expect(getLocale()).toBe("vi");
    expect(tl("vi", "Khoá API sai hoặc đã bị thu hồi")).toBe("Khoá API sai hoặc đã bị thu hồi");
  });
});

describe("tc(): one Vietnamese word, two English forms", () => {
  it("“Tài khoản” is “Account” in a column and “Accounts” in navigation; Vietnamese unchanged", () => {
    setLocale("en");
    expect(t("Tài khoản")).toBe("Account");
    expect(tc("nav", "Tài khoản")).toBe("Accounts");
    expect(tc("nav", "Hàng chờ")).toBe("Queue");
    setLocale("vi");
    expect(tc("nav", "Tài khoản")).toBe("Tài khoản");
  });
  it("context entries are never used to translate stored text backwards", () => {
    setLocale("en");
    expect(t("Tài khoản@@nav")).toBe("Tài khoản@@nav");
  });
});

describe("missing keys are reported for diagnostics", () => {
  it("an unknown message key with params is recorded", () => {
    setLocale("en");
    t("Khoá chưa có trong bảng dịch {x}", { x: 1 });
    expect(missingKeys()).toContain("Khoá chưa có trong bảng dịch {x}");
  });
});

describe("Studio reference count reads naturally in both languages", () => {
  it("English uses singular for one and plural for two; Vietnamese keeps one form", () => {
    setLocale("en");
    expect(t("{referencesCount} ảnh tham chiếu", { referencesCount: 1 })).toBe("1 reference image");
    expect(t("{referencesCount} ảnh tham chiếu", { referencesCount: 2 })).toBe("2 reference images");
    expect(t("{referencesCount} tệp tham chiếu", { referencesCount: 3 })).toBe("3 reference files");
    setLocale("vi");
    expect(t("{referencesCount} ảnh tham chiếu", { referencesCount: 2 })).toBe("2 ảnh tham chiếu");
  });
});
