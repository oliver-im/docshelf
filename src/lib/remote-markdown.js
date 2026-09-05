import DOMPurify from 'dompurify';
import { renderRemoteMarkdownContent } from './remote-markdown-content.js';

export const remoteMarkdownSizeLimit = 2 * 1024 * 1024;

/**
 * @param {string} rawUrl
 * @returns {Promise<{ markdown: string, assetBaseUrl: string }>}
 */
export async function fetchRemoteMarkdown(rawUrl) {
  const response = await fetch(rawUrl, {
    cache: 'no-cache',
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText || ''}`.trim());
  }

  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > remoteMarkdownSizeLimit) {
    await response.body?.cancel();
    throw new Error('The Markdown file is larger than DocShelf’s 2 MB limit.');
  }

  if (!response.body) throw new Error('GitHub returned an empty response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let markdown = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > remoteMarkdownSizeLimit) {
        await reader.cancel();
        throw new Error('The Markdown file is larger than DocShelf’s 2 MB limit.');
      }
      markdown += decoder.decode(value, { stream: true });
    }
    markdown += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return {
    markdown,
    assetBaseUrl: response.url || rawUrl,
  };
}

/**
 * Render remote Markdown as a self-contained document using DocShelf's hosted
 * stylesheet. Raw HTML is omitted before the result is sanitized.
 *
 * @param {string} markdown
 * @param {{
 *   title?: string,
 *   fallbackTitle: string,
 *   sourceUrl: string,
 *   assetBaseUrl: string,
 *   linkBaseUrl: string,
 *   stylesheetUrl: string,
 *   lineLinksScriptUrl: string,
 * }} options
 * @returns {Promise<{ html: string, title: string }>}
 */
export async function renderRemoteMarkdownDocument(markdown, options) {
  const rendered = renderRemoteMarkdownContent(markdown);
  const sanitized = DOMPurify.sanitize(rendered.html, {
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['form', 'style'],
    USE_PROFILES: { html: true },
  });
  const parsed = new DOMParser().parseFromString(`<main>${sanitized}</main>`, 'text/html');
  const content = parsed.querySelector('main');
  if (!content) throw new Error('Could not render the Markdown document.');

  rewriteRemoteLinks(content, options);
  addHeadingIds(content);

  const inferredTitle = content.querySelector('h1')?.textContent?.trim();
  const title = options.title?.trim() || inferredTitle || options.fallbackTitle;
  const stylesheetUrl = new URL(options.stylesheetUrl).href;
  const lineLinksScriptUrl = new URL(options.lineLinksScriptUrl).href;
  const assetOrigins = Array.from(
    new Set([new URL(stylesheetUrl).origin, new URL(lineLinksScriptUrl).origin]),
  )
    .map(escapeHtml)
    .join(' ');

  return {
    title,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src ${assetOrigins}; script-src 'unsafe-inline' ${assetOrigins}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${escapeHtml(stylesheetUrl)}">
    <script src="${escapeHtml(lineLinksScriptUrl)}" defer></script>
    <script>${remoteThemeScript}</script>
  </head>
  <body>
    <main class="markdown-document" data-docshelf-remote-markdown data-docshelf-source-line-count="${rendered.sourceLineCount}">
      <nav class="markdown-source" aria-label="Document source">
        <a href="${escapeHtml(options.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
      </nav>
${content.innerHTML}
    </main>
  </body>
</html>
`,
  };
}

/** @param {Element} content @param {{ assetBaseUrl: string, linkBaseUrl: string }} options */
function rewriteRemoteLinks(content, options) {
  for (const image of content.querySelectorAll('img[src]')) {
    const source = resolveSafeUrl(image.getAttribute('src'), options.assetBaseUrl, {
      dataImages: true,
    });
    if (!source) {
      image.removeAttribute('src');
      continue;
    }
    image.setAttribute('src', source);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }

  for (const link of content.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href?.startsWith('#')) continue;
    const destination = resolveSafeUrl(href, options.linkBaseUrl, { mail: true });
    if (!destination) {
      link.removeAttribute('href');
      continue;
    }
    link.setAttribute('href', destination);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
}

/** @param {Element} content */
function addHeadingIds(content) {
  const used = new Map();
  for (const heading of content.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const base = slug(heading.textContent || '') || 'section';
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    heading.id = count === 0 ? base : `${base}-${count}`;
  }
}

/**
 * @param {string | null} value
 * @param {string} baseUrl
 * @param {{ dataImages?: boolean, mail?: boolean }} [options]
 */
function resolveSafeUrl(value, baseUrl, options = {}) {
  if (!value) return null;
  if (options.dataImages && /^data:image\/(?:gif|jpeg|png|webp);/i.test(value)) return value;

  let resolved;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    return null;
  }

  if (resolved.protocol === 'https:' || resolved.protocol === 'http:') return resolved.href;
  if (options.mail && resolved.protocol === 'mailto:') return resolved.href;
  return null;
}

/** @param {string} value */
function slug(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const remoteThemeScript = `(() => {
  const root = document.documentElement;
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  let parentRoot;
  try { parentRoot = window.parent.document.documentElement; } catch {}
  const applyTheme = () => {
    const parentTheme = parentRoot?.dataset.theme;
    const theme = parentTheme === 'light' || parentTheme === 'dark'
      ? parentTheme
      : colorScheme.matches ? 'dark' : 'light';
    root.dataset.theme = theme;
    root.dataset.colorScheme = theme;
  };
  applyTheme();
  colorScheme.addEventListener('change', applyTheme);
  if (parentRoot) {
    new MutationObserver(applyTheme).observe(parentRoot, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
})();`;
