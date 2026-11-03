import { acceptsWork } from "./accountMachine";
import type { Account, CapabilityKey, VibesCapabilityKey } from "./types";

// Spec §4.7. Verified on the live service in Phase 1 (docs/build-1.0/evidence/phase-0-1.md, 26/10/2026).
export const VERIFIED_CAPABILITIES: Record<CapabilityKey, boolean> = {
  "image.text": true,
  "image.reference": true,
  "video.text": true,
  "video.reference": true,
  // Build 2.0 R81: the generic bridge; which path may carry it is decided per path (pathCapability.ts).
  "chat.text": true,
  "muse.video.extend": true,
  // rev 6 (rules B37): Vibes stays off in code until verified live on this version (plan Phase 10 step 10j/10k).
  "vibes.video.text": false,
  "vibes.video.reference": false,
  "vibes.video.extend": false,
};

export const VIBES_CAPABILITIES: VibesCapabilityKey[] = ["vibes.video.text", "vibes.video.reference", "vibes.video.extend"];
export const isVibesCapability = (k: CapabilityKey): k is VibesCapabilityKey => k.startsWith("vibes.");

/** Aspect ratio is not a real Muse control (asked 1:1, got 3:2) → no ratio chip (§4.7). */
export const ASPECT_RATIO_CONTROL = false;

export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  "image.text": "Ảnh từ chữ",
  "image.reference": "Sửa ảnh",
  "video.text": "Video từ chữ",
  "video.reference": "Video từ ảnh",
  "chat.text": "Hỏi đáp",
  "muse.video.extend": "Kéo dài video Muse",
  "vibes.video.text": "Video từ chữ trên Vibes",
  "vibes.video.reference": "Video từ ảnh trên Vibes",
  "vibes.video.extend": "Kéo dài video",
};

/** Enabled when the app version verified it AND some account that can work has not reported it as missing. */
export function enabledCapabilities(accounts: Pick<Account, "state" | "capabilities">[], verified: Record<CapabilityKey, boolean> = VERIFIED_CAPABILITIES): Record<CapabilityKey, boolean> {
  const out = {} as Record<CapabilityKey, boolean>;
  for (const key of Object.keys(VERIFIED_CAPABILITIES) as CapabilityKey[]) {
    // Vibes capabilities depend only on what this version verified (no per-account probe exists for Vibes).
    const anyAccount = isVibesCapability(key) || accounts.length === 0 || accounts.some((a) => a.capabilities[key] !== false);
    out[key] = !!verified[key] && anyAccount;
  }
  return out;
}

export function hasWorkingAccount(accounts: Pick<Account, "state">[]): boolean {
  return accounts.some((a) => acceptsWork(a.state));
}
