/**
 * Astro gives generated assets beneath `_astro/` a content-hash filename, so browsers may keep
 * those for as long as they like. An unhashed file can also be copied there from `public/`, so only
 * filenames with a hash-shaped penultimate segment get the immutable policy. Everything else lives
 * at a stable URL that a rebuild replaces in place and must be revalidated on every use.
 *
 * @param {string} relativePath the served file's path relative to the build root, `/`-separated
 */
export function cacheControl(relativePath) {
  return hasAstroFingerprint(relativePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/**
 * A validator that lets revalidation answer 304 instead of resending the file. Artifacts use their
 * content revision, which survives rebuilds that leave them unchanged; other files use the weak
 * size-and-mtime form that static file servers conventionally send.
 *
 * @param {{ size: number, mtimeMs: number }} stats
 * @param {string} [contentRevision]
 */
export function entityTag(stats, contentRevision) {
  if (contentRevision) return `"${contentRevision}"`;
  return `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
}

/**
 * Whether the copy a client identifies with If-None-Match is still current. GET and HEAD use weak
 * comparison, so a weak request validator matches the equivalent strong response validator.
 *
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {string} etag
 */
export function isFresh(headers, etag) {
  const ifNoneMatch = headers['if-none-match'];
  if (!ifNoneMatch) return false;
  const current = withoutWeakPrefix(etag);
  return ifNoneMatch.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || withoutWeakPrefix(value) === current;
  });
}

/** @param {string} relativePath */
function hasAstroFingerprint(relativePath) {
  if (!relativePath.startsWith('_astro/')) return false;
  const filename = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const segments = filename.split('.');
  if (segments.length < 3) return false;
  const fingerprint = segments.at(-2);
  return (
    fingerprint.length >= 5 &&
    /^[A-Za-z0-9_-]+$/.test(fingerprint) &&
    /[A-Z0-9_-]/.test(fingerprint)
  );
}

/** @param {string} value */
function withoutWeakPrefix(value) {
  return value.startsWith('W/') ? value.slice(2) : value;
}
