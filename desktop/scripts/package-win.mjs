// Builds the Windows release ZIP (R22): app payload + install.ps1 + uninstall.ps1 + SHA256SUMS.txt.
// Usage: node scripts/package-win.mjs   (run `npm run build` first)
import { packager } from "@electron/packager";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const out = path.join(root, "release");
const stage = path.join(out, "stage");
function zipDirectory(source, destination) {
  if (process.platform === "win32") {
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)}, ${quote(destination)}, [IO.Compression.CompressionLevel]::Optimal, $false)`]);
  } else {
    execFileSync("zip", ["-qr", "-X", destination, "."], { cwd: source });
  }
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const f of ["dist/main/main.cjs", "dist/main/preload.cjs", "dist/renderer/index.html", "dist/renderer/probe.html"]) {
  if (!fs.existsSync(path.join(root, f))) throw new Error(`Missing ${f} — run npm run build first`);
}

const keep = [/^\/package\.json$/, /^\/dist(\/|$)/, /^\/resources(\/|$)/, /^\/LICENSES(\/|$)/];
const [appDir] = await packager({
  dir: root,
  name: "Muse4AI",
  executableName: "Muse4AI",
  platform: "win32",
  arch: "x64",
  out: path.join(out, "pkg"),
  overwrite: true,
  asar: true,
  prune: false,
  appVersion: version,
  appCopyright: "© 2026 Andrew Babo",
  // Embedded into Muse4AI.exe (resedit, no wine needed) so taskbar, Alt+Tab and every shortcut show our mark.
  icon: path.join(root, "resources", "icon.ico"),
  extraResource: ["resources/icon.ico", "resources/icon.png", "resources/tray.png", "LICENSES/muse2api.txt", "LICENSES/VibesAI-api.txt"].map((p) => path.join(root, p)),
  ignore: (p) => p !== "" && !keep.some((re) => re.test(p.replaceAll("\\", "/"))) && !/^\/(dist|resources|LICENSES)$/.test(p),
  win32metadata: { CompanyName: "Andrew Babo", FileDescription: "Muse4AI", ProductName: "Muse4AI", InternalName: "Muse4AI" },
});

// Payload zip of the packaged app folder contents.
const payload = path.join(stage, "app.zip");
zipDirectory(appDir, payload);
// PowerShell 5.1 and old Notepad read BOM-less files as ANSI → write UTF-8 with BOM and CRLF.
for (const f of ["install.ps1", "uninstall.ps1", "README-install.txt", "INSTALL-GUIDE.md", "README-cai-dat.txt", "HUONG-DAN-CAI.md"]) {
  const text = fs.readFileSync(path.join(root, "installer", f), "utf8").replace(/^\uFEFF/, "").replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(path.join(stage, f), "\uFEFF" + text, "utf8");
}
fs.writeFileSync(path.join(stage, "version.txt"), version + "\r\n");
const sha = (f) => createHash("sha256").update(fs.readFileSync(path.join(stage, f))).digest("hex").toUpperCase();
const sums = ["app.zip", "install.ps1", "uninstall.ps1", "version.txt"].map((f) => `${sha(f)}  ${f}`).join("\r\n") + "\r\n";
fs.writeFileSync(path.join(stage, "SHA256SUMS.txt"), sums);

const zipName = `Muse4AI-${version}-win-x64.zip`;
zipDirectory(stage, path.join(out, zipName));
const zipSha = createHash("sha256").update(fs.readFileSync(path.join(out, zipName))).digest("hex").toUpperCase();
fs.writeFileSync(path.join(out, `${zipName}.sha256.txt`), `${zipSha}  ${zipName}\r\n`);
console.log(JSON.stringify({ zip: path.join(out, zipName), sha256: zipSha, bytes: fs.statSync(path.join(out, zipName)).size, appDir }, null, 2));
