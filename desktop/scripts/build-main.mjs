import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bundles the Electron main process and preload into self-contained CommonJS files (no node_modules at runtime).
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Shared Build 3.0 content (`@content`, outside this package) and Vite-style `?raw` text imports (the Agent Skill files).
const rawText = {
  name: "raw-text",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw-text" }));
    b.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({ contents: fs.readFileSync(args.path, "utf8"), loader: "text" }));
  },
};
const common = {
  alias: { "@content": path.join(root, "../content") },
  plugins: [rawText],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "node:sqlite"],
  sourcemap: "linked",
  logLevel: "info",
  legalComments: "inline",
};
await build({ ...common, entryPoints: [path.join(root, "src/main/main.ts")], outfile: path.join(root, "dist/main/main.cjs") });
await build({ ...common, entryPoints: [path.join(root, "src/preload/preload.ts")], outfile: path.join(root, "dist/main/preload.cjs"), sourcemap: false });
// Build 2.0 channel page client (R96): a browser IIFE injected into each account's hidden light page.
await build({
  entryPoints: [path.join(root, "src/page/gatewayPage.ts")],
  outfile: path.join(root, "dist/main/gateway-page.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
