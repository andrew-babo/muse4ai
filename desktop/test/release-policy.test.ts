import { describe, expect, it } from 'vitest';
// @ts-expect-error Plain JavaScript build helper is intentionally outside the app tsconfig.
import { assertReleaseTag } from '../scripts/release-policy.mjs';

describe('Windows release version safety', () => {
  it('accepts v1.0.0-beta.18 for package 1.0.0-beta.18', () => {
    expect(() => assertReleaseTag('refs/tags/v1.0.0-beta.18', '1.0.0-beta.18')).not.toThrow();
  });
  it('refuses a mismatched release tag', () => {
    expect(() => assertReleaseTag('refs/tags/v1.0.0-beta.17', '1.0.0-beta.18')).toThrow();
  });
  it('allows a manual branch build without publishing a tag', () => {
    expect(() => assertReleaseTag('refs/heads/main', '1.0.0-beta.18')).not.toThrow();
  });
});