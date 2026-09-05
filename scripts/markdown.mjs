import { readFileSync } from 'node:fs';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import { sitePath } from './site-path.mjs';

const themeSyncScript = readFileSync(
  new URL('../.agents/skills/docshelf/assets/theme-sync.js', import.meta.url),
  'utf8',
).trimEnd();

const processorPromise = createMarkdownProcessor({
  gfm: true,
  smartypants: false,
  syntaxHighlight: 'prism',
  remarkPlugins: [remarkDocShelfSourceBreaks, remarkDocShelfCodeLines],
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
 * @param {{ basePath?: string }} [options]
 */
export async function renderMarkdownArtifact(artifact, source, options = {}) {
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
    basePath: options.basePath || '/',
    content: rendered.code,
    headings: rendered.metadata.headings,
    sourceLineCount: countSourceLines(source),
    hasMermaid: /<code\b[^>]*\bclass="[^"]*\blanguage-mermaid\b/.test(rendered.code),
  });
}

/** @param {string} source */
function countSourceLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
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

/**
 * CommonMark soft breaks normally collapse like spaces in a browser. DocShelf
 * renders them as explicit breaks so a visible row can retain its source-line
 * identity. The data attribute also gives the client a stable boundary for
 * sizing wrapped line controls.
 */
function remarkDocShelfSourceBreaks() {
  return (tree, file) => {
    const rawOffset = file.data.astro?.frontmatter?.[sourceLineOffsetKey];
    const lineOffset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    preserveSourceBreaks(tree, lineOffset);
  };
}

/** @param {Record<string, any>} node @param {number} lineOffset */
function preserveSourceBreaks(node, lineOffset) {
  if (!Array.isArray(node.children)) return;

  node.children = node.children.flatMap((child) => {
    if (child.type === 'break') {
      annotateSourceBreak(child, child.position?.start?.line, lineOffset);
      return [child];
    }

    if (child.type !== 'text' || !child.value.includes('\n')) {
      preserveSourceBreaks(child, lineOffset);
      return [child];
    }

    let sourceLine = child.position?.start?.line;
    const replacements = [];
    const parts = child.value.split('\n');

    for (const [index, value] of parts.entries()) {
      if (value) replacements.push({ ...child, value, position: undefined });
      if (index === parts.length - 1) continue;

      const sourceBreak = { type: 'break' };
      annotateSourceBreak(sourceBreak, sourceLine, lineOffset);
      replacements.push(sourceBreak);
      if (Number.isSafeInteger(sourceLine)) sourceLine += 1;
    }

    return replacements;
  });
}

/** @param {Record<string, any>} node @param {unknown} sourceLine @param {number} lineOffset */
function annotateSourceBreak(node, sourceLine, lineOffset) {
  if (!Number.isSafeInteger(sourceLine) || sourceLine <= 0) return;
  node.data ||= {};
  node.data.hProperties ||= {};
  node.data.hProperties['data-docshelf-line-break-after'] = String(sourceLine + lineOffset);
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
 * @param {{
 *   title: string,
 *   description: string,
 *   language: string,
 *   basePath: string,
 *   content: string,
 *   headings: Array<{ depth: number, slug: string, text: string }>,
 *   sourceLineCount: number,
 *   hasMermaid: boolean,
 * }} page
 */
function markdownDocument(page) {
  /** @type {Array<{ slug: string, text: string, children: Array<{ slug: string, text: string }> }>} */
  const sections = [];
  for (const heading of page.headings) {
    if (heading.depth === 2) sections.push({ ...heading, children: [] });
    else if (heading.depth === 3) sections.at(-1)?.children.push(heading);
  }
  /** @param {{ slug: string, text: string }} heading */
  const sectionLink = (heading) => `<a href="#${escapeHtml(encodeURIComponent(heading.slug))}">${escapeHtml(heading.text)}</a>`;
  const outline = sections.length >= 3
    ? `<aside class="markdown-outline" data-pagefind-ignore>
      <details open>
        <summary>On this page</summary>
        <nav aria-label="On this page">
          <ol>${sections.map((heading) => `
            <li>${sectionLink(heading)}${heading.children.length
              ? `<ol>${heading.children.map((child) => `<li>${sectionLink(child)}</li>`).join('')}</ol>`
              : ''}</li>`).join('')}
          </ol>
        </nav>
      </details>
    </aside>`
    : '';
  const mermaidScripts = page.hasMermaid
    ? `
    <script src="${sitePath('/mermaid.min.js', page.basePath)}" defer></script>
    <script src="${sitePath('/markdown-mermaid.js', page.basePath)}" defer></script>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="description" content="${escapeHtml(page.description)}">
    <title>${escapeHtml(page.title)}</title>
    <link rel="stylesheet" href="${sitePath('/markdown-tokyo-night.css', page.basePath)}">
    <script src="${sitePath('/markdown-line-links.js', page.basePath)}" defer></script>
    <script src="${sitePath('/markdown-reading.js', page.basePath)}" defer></script>
    <script>
${themeSyncScript}
    </script>
${mermaidScripts}
  </head>
  <body>
    <div class="markdown-layout${outline ? ' has-outline' : ''}">
${outline}
    <main class="markdown-document" data-docshelf-source-line-count="${page.sourceLineCount}">
${page.content}
    </main>
    </div>
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
