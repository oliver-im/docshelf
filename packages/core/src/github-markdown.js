const markdownExtensionPattern = /\.(?:md|markdown)$/i;
const safeRepositorySegmentPattern = /^[a-z0-9_.-]+$/i;

/**
 * Parse a public GitHub Markdown URL without accepting general remote content.
 * GitHub file-view URLs are converted directly to raw.githubusercontent.com;
 * owner and repository casing is normalized for both URL forms.
 *
 * @param {string} source
 * @returns {{
 *   sourceUrl: string,
 *   rawUrl: string,
 *   linkBaseUrl: string,
 *   owner: string,
 *   repository: string,
 *   fileName: string,
 * } | null}
 */
export function parseGitHubMarkdownUrl(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    /%2f|%5c/i.test(url.pathname)
  ) {
    return null;
  }

  url.hash = '';
  const segments = url.pathname.split('/').filter(Boolean);
  const owner = segments[0]?.toLowerCase();
  const repository = segments[1]?.toLowerCase();
  if (
    !owner ||
    !repository ||
    !safeRepositorySegmentPattern.test(owner) ||
    !safeRepositorySegmentPattern.test(repository)
  ) {
    return null;
  }

  segments[0] = owner;
  segments[1] = repository;

  const fileName = decodedFileName(segments.at(-1));
  if (!fileName || !markdownExtensionPattern.test(fileName)) return null;

  if (url.hostname === 'github.com') {
    if (segments[2] !== 'blob' || segments.length < 5) return null;
    const sourceUrl = `https://github.com/${segments.join('/')}`;
    const rawPath = segments.slice(3).join('/');
    return {
      sourceUrl,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repository}/${rawPath}`,
      linkBaseUrl: sourceUrl,
      owner,
      repository,
      fileName,
    };
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    if (segments.length < 4) return null;
    const rawUrl = `https://raw.githubusercontent.com/${segments.join('/')}`;
    return {
      sourceUrl: rawUrl,
      rawUrl,
      linkBaseUrl: rawUrl,
      owner,
      repository,
      fileName,
    };
  }

  return null;
}

/** @param {string | undefined} value */
function decodedFileName(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
