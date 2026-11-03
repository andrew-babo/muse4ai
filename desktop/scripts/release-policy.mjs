/** A tag may publish only the version declared by the desktop package. */
export function assertReleaseTag(ref, version) {
  if (!ref.startsWith('refs/tags/')) return;
  if (ref !== `refs/tags/v${version}`) {
    throw new Error(`Release tag must be v${version}; got ${ref.slice(10)}`);
  }
}