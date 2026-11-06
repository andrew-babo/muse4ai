import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, SITE_URL } from "@content/site";
import { installerArgs } from "../src/shared/updates";
import { TOAST_ACTIVATOR_CLSID } from "../src/main/toast";

// Build 3.3 — the installer scripts' contract with the app (Spec AC-UNI-01…05, AC-UPD-06, AC-RBK-03). The scripts run
// only on Windows; their behaviour is exercised in the isolated Windows lab, these checks keep the shared values aligned.

const dir = path.resolve(__dirname, "../installer");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, "");
const install = read("install.ps1");
const uninstall = read("uninstall.ps1");
const setup = read("setup.iss");
const fn = (src: string, name: string) => {
  const start = src.search(new RegExp(`function ${name}[ (]`));
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};

describe("Windows Settings › Apps entry (AC-UNI-01)", () => {
  it("both scripts name the entry with the same function", () => {
    expect(fn(install, "Get-UninstallKeyName")).toBe(fn(uninstall, "Get-UninstallKeyName"));
  });
  it("shows only an Uninstall button and the site's own links", () => {
    const reg = fn(install, "Register-Uninstall");
    for (const k of ["NoModify", "NoRepair"]) expect(reg).toContain(`'${k}'`);
    expect(reg).toContain(`URLInfoAbout         = '${SITE_URL}'`);
    expect(reg).toContain(`URLUpdateInfo        = '${SITE_URL}/download'`);
    expect(reg).toContain(`HelpLink             = '${REPO.issuesUrl}'`);
    expect(reg).toContain("Publisher            = 'Andrew Babo'");
    expect(reg).toMatch(/UninstallString\s+= .*-Gui/);
  });
});

describe("tools kept for uninstall and rollback (AC-UNI-02)", () => {
  it("copies both verified scripts into <install folder>\\tools after a successful install", () => {
    expect(fn(install, "Save-Tools")).toContain("@('install.ps1', 'uninstall.ps1')");
    expect(install).toMatch(/Write-FirstLanguage\s*\n# The app is installed at this point[^\n]*\ntry \{ Save-Tools; Register-Uninstall \$version \}/);
  });
});

describe("uninstall touches only its own install (AC-UNI-03…05)", () => {
  it("removes data only for the standard folder or a lab, and keeps the library", () => {
    expect(uninstall).toContain("$canRemoveData = [bool]$LabData -or ($InstallRoot -ieq $defaultRoot)");
    // The only folders it deletes besides the install folder are the two app-data folders.
    expect(uninstall.match(/Remove-Item -Recurse -Force \$\w+/g)).toEqual(["Remove-Item -Recurse -Force $InstallRoot", "Remove-Item -Recurse -Force $d"]);
    expect(uninstall).toContain("foreach ($d in @($roamingDir, $localDir))");
  });
  it("stops helpers only when no Muse4AI runs anywhere, and checks shortcut / Run / activator targets", () => {
    expect(uninstall).toContain("if (-not $anyApp) {");
    expect((uninstall.match(/Test-Inside/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(uninstall).toContain(TOAST_ACTIVATOR_CLSID);
  });
  it("asks a running app to quit the normal way and waits at most 45 seconds", () => {
    expect(uninstall).toContain("-ArgumentList '--quit'");
    expect(uninstall).toContain("AddSeconds(45)");
  });
});

describe("app ↔ installer arguments (AC-UPD-06, AC-RBK-03)", () => {
  it("setup reads the parameters the app passes and hands the folder to install.ps1", () => {
    const args = installerArgs("en", "C:\\X\\Muse4AI");
    for (const p of ["INSTALLROOT", "RELAUNCH"]) expect(args.some((a) => a.startsWith(`/${p}=`))).toBe(true);
    expect(setup).toContain("{param:INSTALLROOT|}");
    expect(setup).toContain("{param:RELAUNCH|0}");
    expect(setup).toContain("Args := Args + ' -InstallRoot \"' + Root + '\"';");
    expect(setup).toMatch(/Filename: "\{code:AppExe\}"; Flags: nowait; Check: ShouldRelaunch/);
  });
  it("install.ps1 accepts every switch the app's rollback uses", () => {
    const params = install.slice(install.indexOf("param("), install.indexOf(")\n", install.indexOf("param(")));
    for (const p of ["$Rollback", "$Target", "$CloseRunning", "$Gui", "$InstallRoot", "$Lang"]) expect(params).toContain(p);
  });
});

describe("Windows PowerShell 5.1 reads the scripts correctly", () => {
  it("packaging writes both scripts as UTF-8 with BOM (BOM-less Vietnamese text breaks the parser there)", () => {
    const pkg = fs.readFileSync(path.join(dir, "..", "scripts", "package-win.mjs"), "utf8");
    const at = pkg.indexOf('for (const f of ["install.ps1"');
    const list = pkg.slice(at, pkg.indexOf("]) {", at));
    expect(at).toBeGreaterThan(0);
    for (const f of ["install.ps1", "uninstall.ps1"]) expect(list).toContain(`"${f}"`);
    expect(pkg).toContain('"\\uFEFF" + text');
  });
  it("uninstall points its child processes at the lab copy when it uninstalls a lab install", () => {
    expect(uninstall).toMatch(/if \(\$LabData\) \{[\s\S]*?\$env:MUSE4AI_TEST = '1'[\s\S]*?\$env:MUSE4AI_DATA = \$LabData/);
  });
});
