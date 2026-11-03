// The product is named Muse4AI everywhere a person or an agent reads it, while the
// on-disk data folder keeps its pre-rename name so an installed app never loses its store.
// Values here are the ones the user chose on 02/11/2026: name "Muse4AI",
// sub-title "AI agent bridge — works with Muse", data folder unchanged.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND } from "../src/shared/brand";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const TEXT = /\.(ts|tsx|css|html|json|md|txt|ps1|iss|mjs|py)$/;

function walk(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : TEXT.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("Brand: Muse4AI", () => {
  it("package and shared brand agree on the name users and agents see", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("muse4ai");
    expect(pkg.productName).toBe("Muse4AI");
    expect(BRAND.id).toBe("muse4ai");
    expect(BRAND.name).toBe("Muse4AI");
    expect(BRAND.tagline).toBe("AI agent bridge — works with Muse");
    expect(BRAND.taglineVi).toBe("Cầu nối AI agent — dùng được với Muse");
  });

  it("the data folder keeps its pre-rename name, so an installed store is still found", () => {
    expect(BRAND.dataDir).toBe("MuseStudio");
    const main = read("src/main/main.ts");
    expect(main).toContain("BRAND.dataDir");
    expect(main).not.toContain('app.getPath("appData"), "MuseStudio"');
    expect(main).not.toContain('process.env.LOCALAPPDATA, "MuseStudio"');
    expect(read("src/main/paths.ts")).toContain("path.join(pictures, BRAND.name)");
  });

  it("the installer writes to a Muse4AI program folder, never to the data folder, and keeps its upgrade id", () => {
    const iss = read("installer/setup.iss");
    expect(iss).toContain("DefaultDirName={localappdata}\\Programs\\Muse4AI");
    expect(iss).toContain("AppId=MuseStudioSetup");
    const ps1 = read("installer/install.ps1");
    expect(ps1).toContain("Programs\\Muse4AI");
    expect(ps1).toContain("NEVER touches data (%APPDATA%\\MuseStudio");
    expect(read("installer/uninstall.ps1")).toContain("Join-Path $env:APPDATA 'MuseStudio'");
  });

  it("no shipped surface still carries the old two-word name", () => {
    const hits = [...walk("src"), ...walk("installer"), ...walk("scripts")].filter((f) => read(f).includes("Muse Studio"));
    expect(hits).toEqual([]);
  });

  it("API, MCP and their docs state the brand id, not the old one", () => {
    expect(read("src/main/api/server.ts")).toContain("service: BRAND.id");
    expect(read("src/main/api/service.ts")).toContain("service: BRAND.id");
    expect(read("src/main/api/mcp.ts")).toContain("{ name: BRAND.id, title: BRAND.name");
    expect(read("src/shared/api/domain.ts")).toContain("o.service === BRAND.id");
    expect(read("src/main/api/tunnel.ts")).toContain("j.service === BRAND.id");
    expect(read("src/shared/api/openapi.ts")).toContain("BRAND.tagline");
    expect(read("src/shared/api/mcpProtocol.ts")).toContain("BRAND.tagline");
    expect(read("src/renderer/lib/agentTemplates.ts")).toContain("[BRAND.id]");
  });
});
