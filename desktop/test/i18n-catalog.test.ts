import { describe, expect, it } from "vitest";
import { CATALOG, CATALOG_PARTS } from "../src/shared/i18n/catalog";
import { findTexts } from "./i18nKeys";

// Build 2.0 AC-I18N-03 — every Vietnamese UI text in the source has English, renderer text goes through t(), and the
// catalog parts never disagree.

/** Vietnamese strings that are not UI text, with the reason. */
const NOT_UI: { file: RegExp; key: RegExp; why: string }[] = [
  { file: /^main\/probe\.ts$/, key: /=>/, why: "source code of the media probe page; its two error texts are separate keys" },
  { file: /^shared\/api\/openapi\.ts$/, key: /./, why: "OpenAPI documentation is English by rule (R122); “Hỏi đáp” names the app screen" },
  { file: /^renderer\/lib\/ui\.ts$/, key: /^(Mây|Sương|Gió|Nắng|Mưa|Trăng)$/, why: "suggested account names: names stay as they are in both languages" },
];

const PH = /\{(\w+)\}/g;
const PLURAL = /\{(\w+)\|[^|{}]*\|[^|{}]*\}/g;
const names = (s: string, re: RegExp) => new Set([...s.matchAll(re)].map((m) => m[1]));

describe("AC-I18N-03 translation coverage", () => {
  const texts = findTexts().filter((x) => !NOT_UI.some((n) => n.file.test(x.file) && n.key.test(x.key)));

  it("finds the source texts (sanity)", () => {
    expect(texts.length).toBeGreaterThan(1200);
  });

  it("every Vietnamese text in the source has an English entry", () => {
    const missing = [...new Map(texts.filter((x) => CATALOG[x.key] === undefined).map((x) => [x.key, `${x.file}:${x.line}  ${JSON.stringify(x.key)}`])).values()];
    expect(missing, `missing English for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("renderer JSX text and visible attributes always go through t()", () => {
    const raw = texts.filter((x) => x.raw).map((x) => `${x.file}:${x.line}  ${JSON.stringify(x.key)}`);
    expect(raw, `untranslated renderer text:\n${raw.join("\n")}`).toEqual([]);
  });

  it("English entries use only placeholders their key has, and plurals refer to a key placeholder", () => {
    const bad: string[] = [];
    for (const [key, en] of Object.entries(CATALOG)) {
      if (typeof en !== "string") continue;
      const k = names(key, PH);
      const plain = names(en.replace(PLURAL, ""), PH);
      const plurals = names(en, PLURAL);
      for (const n of [...plain, ...plurals]) if (!k.has(n)) bad.push(`${JSON.stringify(key)} → ${JSON.stringify(en)} (unknown {${n}})`);
      for (const n of k) if (!plain.has(n)) bad.push(`${JSON.stringify(key)} → ${JSON.stringify(en)} (drops {${n}})`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("no English entry still contains Vietnamese, and parts do not disagree on a key", () => {
    const vi = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
    const leftovers = Object.entries(CATALOG).filter(([, en]) => typeof en === "string" && vi.test(en)).map(([k]) => k);
    expect(leftovers).toEqual([]);
    const seen = new Map<string, unknown>();
    const conflicts: string[] = [];
    for (const [part, cat] of Object.entries(CATALOG_PARTS))
      for (const [k, v] of Object.entries(cat)) {
        if (seen.has(k) && seen.get(k) !== v) conflicts.push(`${part}: ${JSON.stringify(k)}`);
        seen.set(k, v);
      }
    expect(conflicts).toEqual([]);
  });
});
