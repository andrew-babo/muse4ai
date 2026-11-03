// Default numbers from spec rev 3 (§4.4, A5: proposed defaults, adjustable in Settings where noted).

export const PROMPT_MAX = 4000; // R17
export const PROMPT_COUNTER_FROM = 3500;
export const ALIAS_MAX = 32;

export const REF_MAX_BYTES = 20 * 1024 * 1024; // R10
export const REF_MAX_EDGE = 8192;
export const REF_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
/** R10 — how many reference images one job may carry: Muse's picker accepted 50 live (2026-11-01); videos with 2/5/10 kept every picture, 15 made Muse fall back to a flat collage. */
export const REF_MAX_PER_JOB = 50;
/** R10 — above this many pictures the composer warns that Muse may drop some or make a flat collage. */
export const REF_SOFT_MAX = 10;

export const BATCH_MAX_JOBS = 1000; // R11
export const REPEAT_MIN = 1;
export const REPEAT_MAX = 4;

export const PRE_SUBMIT_RETRY_DELAYS_MS = [30_000, 120_000]; // R4: 2 retries
export const DOWNLOAD_RETRY_DELAYS_MS = [5_000, 15_000, 45_000]; // R4: up to 3 download retries

export const COOLDOWN_MS = 120_000; // R8
export const FAIL_WINDOW_MS = 15 * 60_000;
export const FAIL_LIMIT = 3;
export const LIMIT_DEFAULT_MS = 60 * 60_000; // R5

export const DISK_WARN_BYTES = 2 * 1024 ** 3; // R14
export const DISK_PAUSE_BYTES = 500 * 1024 ** 2;

export const LOG_RETENTION_DAYS = 14; // R20
export const LOG_MAX_BYTES = 10 * 1024 ** 2;

export const LEASE_RELEASE_WAIT_MS = 60_000; // R16
export const HEARTBEAT_MS = 500; // §8 G5 — main → UI pulse, cheap (one coalesced message)
/** No pulse for this long → "Đang kết nối lại…" and writes locked (AC-APP-05: shown within ≤ 2 s). */
export const CONNECTION_LOST_MS = 1_500;
export const EVENT_BATCH_MS = 100; // §4.6
export const GLASS_LIGHT_BLUR_PX = 12; // R21

export const DEFAULT_PER_ACCOUNT_CONCURRENCY = 1; // Build 1.0 R3 — kept only for the legacy setting key
/** Build 2.0 R99 — app total of live runs (1–100); the Build 1.0 meaning (1–8 pages) moved to `concurrencyUiPages`. */
export const DEFAULT_GLOBAL_CONCURRENCY = 40;
export const DEFAULT_UI_PAGES = 8;

export const PRIORITY_BATCH = 0;
export const PRIORITY_STANDALONE = 1; // R19
export const PRIORITY_BUMPED = 2;

export const IMAGE_TIMEOUT_MS = 300_000;
export const VIDEO_TIMEOUT_MS = 720_000;
/** Editing an uploaded MP4: Muse reworks it frame by frame and may iterate several passes (live: >12 min). */
export const VIDEO_EDIT_TIMEOUT_MS = 1_500_000;

// Spec rev 8 §13 (A12: proposed numbers, adjusted after measuring).
export const QUOTA_LOW_PERCENT = 80; // R72 “sắp hết”
export const QUOTA_READ_EVERY = 5; // R71(b): sent Muse jobs between reads
export const QUOTA_READ_AGE_MS = 30 * 60_000; // R71(c)(d)
/** Build 2.0 R103 — reads for reasons (b)(c) at most once per 10 minutes per account (many concurrent sends). */
export const QUOTA_COUNT_READ_GAP_MS = 10 * 60_000;
export const QUOTA_STALE_MS = 6 * 60 * 60_000; // R70
export const QUOTA_BACKOFF_MS = [10 * 60_000, 30 * 60_000] as const; // R71: after the 1st / 2nd+ failed read
export const QUOTA_AUTO_READS_MAX = 2; // R71: concurrent automatic reads app-wide
