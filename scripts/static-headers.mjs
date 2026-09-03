/**
 * Astro names the files beneath `_astro/` by content hash, so browsers may keep those for as long
 * as they like. Everything else lives at a stable URL that a rebuild replaces in place, so it must
 * be revalidated on every use.
 *
 * @param {string} relativePath the served file's path relative to the build root, `/`-separated
 */
export function cacheControl(relativePath) {
  return relativePath.startsWith('_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
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
 * Whether the copy a client identifies with If-None-Match is still current.
 *
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {string} etag
 */
export function isFresh(headers, etag) {
  const ifNoneMatch = headers['if-none-match'];
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value === etag;
  });
}
