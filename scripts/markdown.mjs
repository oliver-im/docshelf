import { readFileSync } from 'node:fs';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';

const themeSyncScript = readFileSync(
  new URL('../.agents/skills/docshelf/assets/theme-sync.js', import.meta.url),
  'utf8',
).trimEnd();

const processorPromise = createMarkdownProcessor({
  gfm: true,
  smartypants: false,
  syntaxHighlight: 'prism',
  remarkPlugins: [remarkDocShelfCodeLines],
  rehypePlugins: [rehypeDocShelfLineMetadata],
  remarkRehype: {
    allowDangerousHtml: false,
  },
});

const sourceLineOffsetKey = '__docshelfSourceLineOffset';
const selectableTags = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'tr',
]);
const fallbackSelectableTags = new Set(['blockquote', 'li']);

/**
 * Render a registered Markdown source as a complete, standalone HTML document.
 * The source remains untouched; DocShelf writes this output only beneath its runtime directory.
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
    rendered = await processor.render(parsed.content, {
      frontmatter: {
        ...parsed.frontmatter,
        [sourceLineOffsetKey]: sourceLineOffset(parsed),
      },
    });
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

/** @param {{ rawFrontmatter?: string }} parsed */
function sourceLineOffset(parsed) {
  return parsed.rawFrontmatter?.match(/\n/g)?.length || 0;
}

function rehypeDocShelfLineMetadata() {
  return (tree, file) => {
    const rawOffset = file.data.astro?.frontmatter?.[sourceLineOffsetKey];
    const lineOffset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const codeLines = Array.isArray(file.data.docshelfCodeLines)
      ? file.data.docshelfCodeLines
      : [];
    annotateSelectableBlocks(tree, lineOffset, { codeLines, codeIndex: 0 });
  };
}

function remarkDocShelfCodeLines() {
  return (tree, file) => {
    const codeLines = [];
    collectCodeLines(tree, codeLines);
    file.data.docshelfCodeLines = codeLines;
  };
}

/** @param {Record<string, any>} node @param {Array<{ start: number, end: number }>} codeLines */
function collectCodeLines(node, codeLines) {
  if (
    node.type === 'code' &&
    Number.isSafeInteger(node.position?.start?.line) &&
    Number.isSafeInteger(node.position?.end?.line)
  ) {
    codeLines.push({
      start: node.position.start.line,
      end: node.position.end.line,
    });
  }

  if (!Array.isArray(node.children)) return;
  for (const child of node.children) collectCodeLines(child, codeLines);
}

/**
 * Add source locations to useful rendered blocks without creating overlapping
 * controls for containers whose children already have more precise locations.
 *
 * @param {Record<string, any>} node
 * @param {number} lineOffset
 * @param {{ codeLines: Array<{ start: number, end: number }>, codeIndex: number }} state
 */
function annotateSelectableBlocks(node, lineOffset, state) {
  let hasSelectableDescendant = false;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (annotateSelectableBlocks(child, lineOffset, state)) hasSelectableDescendant = true;
    }
  }

  const tagName = typeof node.tagName === 'string' ? node.tagName : '';
  const selectable =
    selectableTags.has(tagName) ||
    (fallbackSelectableTags.has(tagName) && !hasSelectableDescendant);
  const codeRange = tagName === 'pre' ? state.codeLines[state.codeIndex++] : null;
  const start = node.position?.start?.line ?? codeRange?.start;
  const end = node.position?.end?.line ?? codeRange?.end;

  if (
    selectable &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start > 0 &&
    end >= start
  ) {
    node.properties ||= {};
    node.properties['data-docshelf-line-start'] = String(start + lineOffset);
    node.properties['data-docshelf-line-end'] = String(end + lineOffset);
    return true;
  }

  return hasSelectableDescendant;
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
    <script src="/markdown-line-links.js" defer></script>
    <script>
${themeSyncScript}
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
