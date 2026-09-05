/**
 * Return the canonical identity for remote content that can appear both in a
 * hosted shelf and in browser-local imports. Local artifacts intentionally do
 * not have a remote identity.
 *
 * @param {{ embedUrl?: string, sourceType?: string, rawUrl?: string }} artifact
 * @returns {string | null}
 */
export function remoteArtifactIdentity(artifact) {
  if (typeof artifact.embedUrl === 'string' && artifact.embedUrl) {
    return `claude:${artifact.embedUrl}`;
  }
  if (
    artifact.sourceType === 'github-markdown' &&
    typeof artifact.rawUrl === 'string' &&
    artifact.rawUrl
  ) {
    return `github-markdown:${artifact.rawUrl}`;
  }
  return null;
}

/**
 * @param {{ embedUrl?: string, sourceType?: string, rawUrl?: string }} left
 * @param {{ embedUrl?: string, sourceType?: string, rawUrl?: string }} right
 */
export function artifactsShareRemoteSource(left, right) {
  const leftIdentity = remoteArtifactIdentity(left);
  return leftIdentity !== null && leftIdentity === remoteArtifactIdentity(right);
}
