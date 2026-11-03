#!/usr/bin/env python3
"""Guide screenshots pipeline (Build 3.0, R3-SHOT): PNG captures -> WebP 2x/1x + OCR privacy gate + manifest.

Input: a folder of lossless captures named "<id>.<en|vi>.png", taken at 1440x900 CSS px and 2x (2880x1800)
from the isolated test-mode lab on the Windows VPS (synthetic profile), or a 2x crop of one region.

Output:
  content/shots/<id>.<locale>.webp      2x, quality 82 stepping down to 72 until <= 180 KB
  content/shots/<id>.<locale>@1x.webp   1440 px wide, quality 82 (web srcset only; the app bundles 2x)
  content/shots.ts                      manifest (SHOTS) regenerated between the GENERATED markers
  <evidence>/shots-ocr.json             OCR text + findings for every shipped 2x WebP
  <evidence>/shots-ocr.md               human-readable gate summary

Gate (exit code 1 on any finding): emails, "msk_" + 8 or more key characters (masked bullets allowed),
"C:\\Users\\", IPv4 outside 127.0.0.1 / 0.0.0.0 / 192.0.2.x / 198.51.100.x / 203.0.113.x, tunnel host names
other than your-tunnel.trycloudflare.com, Vietnamese letters in English shots (the language switch label
"Tiếng Việt" is allowed), and every English id needing a Vietnamese twin.

Usage: python3 desktop/scripts/docs-shots.py --src /path/to/png --app-version 2.0.0-beta.24+b3lab [--evidence dir]
       [--keep-existing]   only the captures in --src are (re)processed; every other shot keeps its shipped WebP and
                           report row from the previous <evidence>/shots-ocr.json, after its file sha256 is re-checked
"""
import argparse, concurrent.futures as cf, hashlib, io, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "content" / "shotCatalog.ts"
OUT = ROOT / "content" / "shots"
MANIFEST = ROOT / "content" / "shots.ts"
MAX_2X = 180 * 1024
FULL = (2880, 1800)

VI_LETTERS = re.compile(r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]", re.I)
LANG_SWITCH = re.compile(r"T[iíì][eéếè]{1,2}ng\s*Vi[eéệẹ]{1,2}t", re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}")
KEY = re.compile(r"msk_([A-Za-z0-9_\-]{8,})", re.I)
# Masked keys render as bullets; OCR reads them back as runs of round letters (e.g. "seccecccecest").
MASK_CHARS = set("secoaunmrvwxz")
USERS = re.compile(r"[A-Z]:\\+Users\\+", re.I)
IPV4 = re.compile(r"(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])")
TUNNEL = re.compile(r"([a-z0-9-]+)\.trycloudflare\.com", re.I)
IP_OK = ("127.0.0.1", "0.0.0.0")
# English words that carry these letters on their own (prompt text such as "café corner"), not leaked Vietnamese UI.
EN_WORDS = {"café", "cafés", "décor", "entrée", "naïve", "résumé"}
IP_OK_PREFIX = ("192.0.2.", "198.51.100.", "203.0.113.")


def catalog():
    src = CATALOG.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'\{ id: "([a-z0-9-]+)", route: [^,]+, state: \{ en: "((?:[^"\\]|\\.)*)", vi: "((?:[^"\\]|\\.)*)" \}', src):
        out[m.group(1)] = {"en": m.group(2), "vi": m.group(3)}
    if len(out) < 10:
        sys.exit("could not read content/shotCatalog.ts")
    return out


def webp(img: Image.Image, q: int) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / "in.png", Path(d) / "out.webp"
        img.save(src)
        subprocess.run(["cwebp", "-quiet", "-q", str(q), "-m", "6", "-sharp_yuv", "-metadata", "none", str(src), "-o", str(dst)], check=True)
        return dst.read_bytes()


def ocr(data: bytes, lang: str) -> str:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.png"
        Image.open(io.BytesIO(data)).convert("RGB").save(p)
        # One OCR thread per process: the pool already runs one image per core (OpenMP oversubscription made it ~300x slower).
        r = subprocess.run(["tesseract", str(p), "-", "-l", lang, "--psm", "3"], capture_output=True, text=True, env=dict(os.environ, OMP_THREAD_LIMIT="1"), timeout=600)
        return r.stdout


def en_word(w: str) -> bool:
    return re.sub(r"[^\w]", "", w.lower()) in EN_WORDS


def findings(text: str, locale: str):
    f = []
    for m in EMAIL.finditer(text):
        f.append(("email", m.group(0)))
    for m in KEY.finditer(text):
        tok = m.group(1)
        if tok.upper().startswith("YOUR_KEY") or set(tok.lower().strip("_-")) <= MASK_CHARS:
            continue  # msk_YOUR_KEY or masked bullets read back as one repeated character
        f.append(("api-key", "msk_" + tok[:3] + "…"))
    for m in USERS.finditer(text):
        f.append(("user-path", m.group(0)))
    for m in IPV4.finditer(text):
        ip = m.group(0)
        if any(int(x) > 255 for x in m.groups()):
            continue
        if ip in IP_OK or ip.startswith(IP_OK_PREFIX):
            continue
        f.append(("ipv4", ip))
    for m in TUNNEL.finditer(text):
        if m.group(1).lower() != "your-tunnel":
            f.append(("tunnel", m.group(0)))
    if locale == "en":
        stripped = LANG_SWITCH.sub(" ", text)
        words = sorted({w for w in re.findall(r"\S+", stripped) if VI_LETTERS.search(w) and not en_word(w)})
        if words:
            f.append(("vietnamese-in-en", " ".join(words[:12])))
    return f


def process(png: Path, app_version: str, captured: dict, alts: dict, dom_vi: dict):
    sid, loc = png.name[:-4].rsplit(".", 1)
    img = Image.open(png).convert("RGB")
    crop = img.size != FULL
    q, data = 82, b""
    for q in (82, 80, 78, 76, 74, 72):
        data = webp(img, q)
        if len(data) <= MAX_2X:
            break
    one = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    data1 = webp(one, 82)
    # English shots use the English model only: the Vietnamese model invents diacritics on English UI text.
    # The capture step also checks the page text itself (domVi in capture-log.jsonl), which is exact.
    text = ocr(data, "eng" if loc == "en" else "vie+eng")
    found = findings(text, loc)
    unconfirmed = []
    private = [x for x in found if x[0] != "vietnamese-in-en"]
    if private:
        # Confirmation read on the lossless capture: WebP artefacts make OCR misread digits ("198.51.100.22" as
        # "198.51.160.22"). A value seen in both reads is a problem; one seen only in the WebP read is listed for review.
        again = set(findings(ocr(png.read_bytes(), "eng" if loc == "en" else "vie+eng"), loc))
        unconfirmed = [x for x in private if x not in again]
        found = [x for x in found if x not in unconfirmed]
    found += [("vietnamese-in-en", w) for w in dom_vi.get(f"{sid}.{loc}", []) if not en_word(w)]
    name = f"{sid}.{loc}.webp"
    return {
        "id": sid, "locale": loc, "file": name, "w": img.width, "h": img.height, "crop": crop,
        "bytes": len(data), "quality": q, "sha256": hashlib.sha256(data).hexdigest(), "bytes1x": len(data1),
        "appVersion": app_version, "capturedAt": captured.get(f"{sid}.{loc}") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(png.stat().st_mtime)),
        "alt": alts.get(sid), "ocr": text, "findings": found, "unconfirmed": unconfirmed, "_data": data, "_data1": data1,
    }


def ts_string(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def write_manifest(rows):
    lines = []
    for r in rows:
        lines.append(
            "  { id: %s, locale: %s, file: %s, w: %d, h: %d, bytes: %d, sha256: %s, appVersion: %s, capturedAt: %s, profile: \"synthetic\", alt: { en: %s, vi: %s } },"
            % (ts_string(r["id"]), ts_string(r["locale"]), ts_string(r["file"]), r["w"], r["h"], r["bytes"], ts_string(r["sha256"]), ts_string(r["appVersion"]), ts_string(r["capturedAt"]), ts_string(r["alt"]["en"]), ts_string(r["alt"]["vi"]))
        )
    src = MANIFEST.read_text(encoding="utf-8")
    block = "// GENERATED by desktop/scripts/docs-shots.py — do not edit by hand.\nexport const SHOTS: Shot[] = [\n" + "\n".join(lines) + "\n];\n// END GENERATED"
    if "// GENERATED by desktop/scripts/docs-shots.py" in src:
        src = re.sub(r"// GENERATED by desktop/scripts/docs-shots\.py.*?// END GENERATED", lambda _m: block, src, flags=re.S)
    else:
        src = re.sub(r"/\*\* Screenshot manifest[^\n]*\*/\nexport const SHOTS: Shot\[\] = \[\];", lambda _m: "/** Screenshot manifest written by the capture pipeline (R3-SHOT). */\n" + block, src)
    MANIFEST.write_text(src, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--app-version", required=True)
    ap.add_argument("--evidence", default=str(ROOT / "docs" / "build-3.0" / "evidence" / "shots"))
    ap.add_argument("--captured-log", default=None, help="capture-log.jsonl with capture times")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep-existing", action="store_true", help="keep shipped shots that are not in --src (sha-checked)")
    a = ap.parse_args()
    alts = catalog()
    captured, dom_vi = {}, {}
    if a.captured_log and Path(a.captured_log).exists():
        for line in Path(a.captured_log).read_text().splitlines():
            r = json.loads(line)
            captured[f"{r['id']}.{r['locale']}"] = r["at"]
            dom_vi[f"{r['id']}.{r['locale']}"] = r.get("domVi") or []
    pngs = sorted(p for p in Path(a.src).glob("*.png") if re.fullmatch(r"[a-z0-9-]+\.(en|vi)\.png", p.name))
    unknown = [p.name for p in pngs if p.name.rsplit(".", 2)[0] not in alts]
    if unknown:
        sys.exit(f"not in the shot catalog: {unknown}")
    with cf.ThreadPoolExecutor(max_workers=min(14, os.cpu_count() or 4)) as ex:
        rows = list(ex.map(lambda p: process(p, a.app_version, captured, alts, dom_vi), pngs))
    problems = []
    if a.keep_existing:
        # Incremental run: a shot not recaptured keeps the WebP it shipped with and its earlier gate result, but only
        # when the file on disk is byte-identical to that report (a hand-edited or missing file fails the run).
        prev_path = Path(a.evidence) / "shots-ocr.json"
        prev = json.loads(prev_path.read_text(encoding="utf-8")) if prev_path.exists() else {"shots": []}
        new = {(r["id"], r["locale"]) for r in rows}
        for r in prev["shots"]:
            if (r["id"], r["locale"]) in new or r["id"] not in alts:
                continue
            f = OUT / r["file"]
            if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest() != r["sha256"] or not (OUT / r["file"].replace(".webp", "@1x.webp")).exists():
                problems.append({"id": r["id"], "locale": r["locale"], "kind": "kept-file", "detail": "shipped WebP missing or changed since the last gate"})
                continue
            rows.append({**r, "alt": alts[r["id"]], "_kept": True})
    rows.sort(key=lambda r: (list(alts).index(r["id"]), r["locale"]))
    have = {(r["id"], r["locale"]) for r in rows}
    for sid in alts:
        for loc in ("en", "vi"):
            if (sid, loc) not in have:
                problems.append({"id": sid, "locale": loc, "kind": "missing", "detail": "no capture"})
    for r in rows:
        for kind, detail in r["findings"]:
            problems.append({"id": r["id"], "locale": r["locale"], "kind": kind, "detail": detail})
        if r["bytes"] > MAX_2X:
            problems.append({"id": r["id"], "locale": r["locale"], "kind": "size", "detail": f"{r['bytes']} B > {MAX_2X} B at q72"})
        if not r["crop"] and (r["w"], r["h"]) != FULL:
            problems.append({"id": r["id"], "locale": r["locale"], "kind": "dimensions", "detail": f"{r['w']}x{r['h']}"})
    ev = Path(a.evidence)
    ev.mkdir(parents=True, exist_ok=True)
    report = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
    (ev / "shots-ocr.json").write_text(json.dumps({"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "appVersion": a.app_version, "problems": problems, "shots": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# Guide screenshots — OCR and privacy gate", "", f"Generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} · app {a.app_version} · synthetic lab profile · {len(rows)} shots", "",
          f"Result: **{'PASS' if not problems else 'FAIL'}** ({len(problems)} problem(s)).", "", "| id | locale | size | q | 2x bytes | 1x bytes | findings |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['id']} | {r['locale']} | {r['w']}×{r['h']}{' (crop)' if r['crop'] else ''} | {r['quality']} | {r['bytes']} | {r['bytes1x']} | {', '.join(k for k, _ in r['findings']) or '—'} |")
    review = [(r["id"], r["locale"], k, d) for r in rows for k, d in r["unconfirmed"]]
    if review:
        md += ["", "## OCR misreads (seen only in the WebP read, not in the lossless re-read)", ""] + [f"- {i}.{l}: {k} — {d}" for i, l, k, d in review]
    if problems:
        md += ["", "## Problems", ""] + [f"- {p['id']}.{p['locale']}: {p['kind']} — {p['detail']}" for p in problems]
    (ev / "shots-ocr.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"{len(rows)} shots, {len(problems)} problem(s); report in {ev}")
    for p in problems[:40]:
        print(" -", p)
    if problems or a.dry_run:
        sys.exit(1 if problems else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    keep = set()
    for r in rows:
        keep |= {r["file"], r["file"].replace(".webp", "@1x.webp")}
        if r.get("_kept"):
            continue
        (OUT / r["file"]).write_bytes(r["_data"])
        (OUT / r["file"].replace(".webp", "@1x.webp")).write_bytes(r["_data1"])
    for f in OUT.glob("*.webp"):
        if f.name not in keep:
            f.unlink()
    write_manifest(rows)
    print("wrote", len(rows), "shots to content/shots and the manifest")


if __name__ == "__main__":
    main()
