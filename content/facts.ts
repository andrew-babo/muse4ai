import type { L } from "./types";

/**
 * Facts the guide states as numbers or names (R3-CNT.5). The desktop test
 * `desktop/test/content-facts.test.ts` checks each one against the app's own
 * source so the guide cannot drift from the product.
 */
export const FACTS = {
  productName: "Muse4AI",
  productId: "muse4ai",
  tagline: {
    en: "AI agent bridge — works with Muse",
    vi: "Cầu nối AI agent — dùng được với Muse",
  } satisfies L,
  /** Version the guide and screenshots describe. */
  appVersion: "2.0.0-beta.24",
  apiDefaultPort: 47821,
  mcpPath: "/mcp",
  restBase: "/v1",
  localMcpUrl: "http://127.0.0.1:47821/mcp",
  localRestUrl: "http://127.0.0.1:47821/v1",
  placeholderKey: "msk_YOUR_KEY",
  /** API keys start with this prefix. */
  keyPrefix: "msk_",
  installDir: "%LOCALAPPDATA%\\Programs\\Muse4AI",
  dataDir: "%APPDATA%\\MuseStudio",
  windows: { en: "Windows 10 or 11, 64-bit", vi: "Windows 10 hoặc 11, bản 64-bit" } satisfies L,
  mcpTools: [
    "muse_status",
    "muse_generate",
    "muse_chat",
    "muse_get_job",
    "muse_list_jobs",
    "muse_cancel_job",
    "muse_extend_video",
    "muse_get_extend",
  ] as const,
  /** Measured on real Muse outputs: 5 clips of 8.0 s (02/11 03:52 UTC, research S25) and 11 clips of 10.0 s (02/11 12:09 UTC, P5 ledger). */
  media: {
    videoSeconds: "8–10",
    videoWidth: 1280,
    videoHeight: 720,
    videoCodec: "H.264 + AAC",
    imageFormat: "WEBP",
    imageWidth: 1920,
    imageHeight: 1280,
  },
  /** Extend chains (desktop MUSE_EXTEND_MAX_STEPS / validateMuseExtend; live 03/11: 10 s → 20.04 s in one step). */
  extend: {
    maxSteps: 6,
    maxSeconds: 60,
    stepSeconds: 10,
  },
  museTermsUrl: "https://muse.ai/terms?locale=en_US",
} as const;

export type McpToolName = (typeof FACTS.mcpTools)[number];
