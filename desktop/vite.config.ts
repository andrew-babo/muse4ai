import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// Renderer bundle served from app://bundle/ (relative base so file paths work inside the packaged app).
export default defineConfig({
  root: path.join(here, "src/renderer"),
  base: "./",
  publicDir: path.join(here, "public"),
  plugins: [react(), tailwindcss()],
  // `@content` = the repository's shared guide/skill content (Build 3.0), read by the Guide screen.
  resolve: { alias: { "@shared": path.join(here, "src/shared"), "@content": path.join(here, "../content") } },
  build: {
    outDir: path.join(here, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome130",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5199, strictPort: true, fs: { allow: [path.join(here, "..")] } },
});
