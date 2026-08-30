import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';

const processorPromise = createMarkdownProcessor({
  gfm: true,
  smartypants: false,
  syntaxHighlight: 'prism',
  remarkRehype: {
    allowDangerousHtml: false,
  },
});

/**
 * Render a registered Markdown source as a complete, standalone HTML document.
 * The source remains untouched; Atlas writes this output only beneath its runtime directory.
 *
 * @param {{ title: string, description: string, sourcePath: string }} artifact
 * @param {string} source
 */
export async function renderMarkdownArtifact(artifact, source) {
  let parsed;
  try {
    parsed = parseFrontmatter(source);
  } catch (error) {
    throw new Error(`Could not parse Markdown frontmatter in ${artifact.sourcePath}`, {
      cause: error,
    });
  }

  const processor = await processorPromise;
  let rendered;
  try {
    rendered = await processor.render(parsed.content, { frontmatter: parsed.frontmatter });
  } catch (error) {
    throw new Error(`Could not render Markdown source ${artifact.sourcePath}`, { cause: error });
  }

  const language = markdownLanguage(parsed.frontmatter);
  return markdownDocument({
    title: artifact.title,
    description: artifact.description,
    language,
    content: rendered.code,
  });
}

/** @param {Record<string, unknown>} frontmatter */
function markdownLanguage(frontmatter) {
  const language = frontmatter.lang;
  return typeof language === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)
    ? language
    : 'en';
}

/**
 * @param {{ title: string, description: string, language: string, content: string }} page
 */
function markdownDocument(page) {
  return `<!doctype html>
<html lang="${escapeHtml(page.language)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="description" content="${escapeHtml(page.description)}">
    <title>${escapeHtml(page.title)}</title>
    <link rel="stylesheet" href="/markdown-tokyo-night.css">
    <script>
      (() => {
        const root = document.documentElement;
        const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
        let parentRoot;

        try {
          if (window.parent !== window) parentRoot = window.parent.document.documentElement;
        } catch {}

        const applyTheme = () => {
          const parentTheme = parentRoot?.dataset.theme;
          const theme = parentTheme === 'light' || parentTheme === 'dark'
            ? parentTheme
            : colorScheme.matches ? 'dark' : 'light';

          if (root.dataset.theme !== theme) root.dataset.theme = theme;
        };

        applyTheme();
        colorScheme.addEventListener('change', applyTheme);

        if (parentRoot) {
          new MutationObserver(applyTheme).observe(parentRoot, {
            attributes: true,
            attributeFilter: ['data-theme'],
          });
        }
      })();
    </script>
  </head>
  <body>
    <main class="markdown-document">
${page.content}
    </main>
  </body>
</html>
`;
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
