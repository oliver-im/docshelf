const claudeArtifactIdPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const claudeArtifactPathPattern = new RegExp(
  `^/public/artifacts/(${claudeArtifactIdPattern})(?:/embed)?/?$`,
  'i',
);

/**
 * Accept only Claude's public Artifact share and embed URLs. General Claude
 * pages and arbitrary remote HTML are deliberately excluded.
 *
 * @param {string} source
 * @returns {{ artifactId: string, publicUrl: string, embedUrl: string } | null}
 */
export function parseClaudeArtifactUrl(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'claude.ai' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }

  const match = claudeArtifactPathPattern.exec(url.pathname);
  if (!match) return null;

  const artifactId = match[1].toLowerCase();
  const publicUrl = `https://claude.ai/public/artifacts/${artifactId}`;
  return { artifactId, publicUrl, embedUrl: `${publicUrl}/embed` };
}
