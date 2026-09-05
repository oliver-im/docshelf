import { marked } from 'marked';

const rangedRendererMethods = [
  'heading',
  'paragraph',
  'code',
  'blockquote',
  'list',
  'table',
];

/**
 * Render public Markdown in the browser while retaining the source ranges of
 * its top-level blocks. Marked's block tokens consume the source in order, so
 * their raw text provides stable line positions without trusting remote HTML.
 *
 * @param {string} markdown
 * @returns {{ html: string, sourceLineCount: number }}
 */
export function renderRemoteMarkdownContent(markdown) {
  const tokens = marked.lexer(markdown, { gfm: true });
  const ranges = sourceRanges(tokens);
  preserveParagraphSourceBreaks(tokens, ranges);
  const renderer = new marked.Renderer();
  renderer.html = () => '';

  for (const method of rangedRendererMethods) {
    const render = renderer[method];
    renderer[method] = function (token) {
      return addSourceRange(render.call(this, token), ranges.get(token));
    };
  }

  const renderBreak = renderer.br;
  renderer.br = function (token) {
    const html = renderBreak.call(this, token);
    const sourceLine = token.docshelfLineBreakAfter;
    return Number.isSafeInteger(sourceLine) && sourceLine > 0
      ? html.replace(/^<br\b/i, `<br data-docshelf-line-break-after="${sourceLine}"`)
      : html;
  };

  return {
    html: marked.parser(tokens, { gfm: true, renderer }),
    sourceLineCount: countSourceLines(markdown),
  };
}

/**
 * CommonMark normally collapses soft source breaks like spaces. Preserve them
 * in top-level paragraphs so the line gutter remains visually aligned with the
 * source, matching DocShelf's registered-Markdown renderer.
 *
 * @param {Array<Record<string, any>>} tokens
 * @param {WeakMap<Record<string, any>, { start: number, end: number }>} ranges
 */
function preserveParagraphSourceBreaks(tokens, ranges) {
  for (const token of tokens) {
    const range = ranges.get(token);
    if (token.type === 'paragraph' && range && Array.isArray(token.tokens)) {
      token.tokens = annotateInlineBreaks(token.tokens, range.start).tokens;
    }
  }
}

/**
 * @param {Array<Record<string, any>>} tokens
 * @param {number} startingLine
 * @returns {{ tokens: Array<Record<string, any>>, nextLine: number }}
 */
function annotateInlineBreaks(tokens, startingLine) {
  const annotated = [];
  let sourceLine = startingLine;

  for (const token of tokens) {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    const lineBreaks = countLineBreaks(raw);

    if (token.type === 'text' && typeof token.text === 'string' && token.text.includes('\n')) {
      const parts = token.text.split('\n');
      for (const [index, text] of parts.entries()) {
        if (text) annotated.push({ ...token, raw: text, text });
        if (index < parts.length - 1) {
          annotated.push({
            type: 'br',
            raw: '\n',
            docshelfLineBreakAfter: sourceLine,
          });
          sourceLine += 1;
        }
      }
      continue;
    }

    if (token.type === 'br') token.docshelfLineBreakAfter = sourceLine;
    if (Array.isArray(token.tokens)) {
      token.tokens = annotateInlineBreaks(token.tokens, sourceLine).tokens;
    }
    annotated.push(token);
    sourceLine += lineBreaks;
  }

  return { tokens: annotated, nextLine: sourceLine };
}

/** @param {Array<Record<string, any>>} tokens */
function sourceRanges(tokens) {
  const ranges = new WeakMap();
  let sourceLine = 1;

  for (const token of tokens) {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    const lineBreaks = countLineBreaks(raw);
    if (rangedRendererMethods.includes(token.type)) {
      ranges.set(token, {
        start: sourceLine,
        end: sourceLine + lineBreaks - (endsWithLineBreak(raw) ? 1 : 0),
      });
    }
    sourceLine += lineBreaks;
  }

  return ranges;
}

/** @param {string} html @param {{ start: number, end: number } | undefined} range */
function addSourceRange(html, range) {
  if (!range) return html;
  const attributes =
    ` data-docshelf-line-start="${range.start}"` +
    ` data-docshelf-line-end="${range.end}"`;
  return html.replace(/^<([a-z][a-z\d-]*)\b/i, `<$1${attributes}`);
}

/** @param {string} source */
function countSourceLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

/** @param {string} source */
function countLineBreaks(source) {
  return source.match(/\r\n|\r|\n/g)?.length || 0;
}

/** @param {string} source */
function endsWithLineBreak(source) {
  return /(?:\r\n|\r|\n)$/.test(source);
}
