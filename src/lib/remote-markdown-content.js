import { marked } from 'marked';

/** @typedef {import('marked').Token} Token */
/** @typedef {{ start: number, end: number }} SourceRange */

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
  /** @type {WeakMap<Token, number>} */
  const hardBreakLines = new WeakMap();
  annotateParagraphHardBreaks(tokens, ranges, hardBreakLines);
  const renderer = new marked.Renderer();
  renderer.html = () => '';

  /**
   * Keep each renderer's token type and Marked's renderer context intact.
   * @template {Token} T
   * @param {(token: T) => string} render
   * @returns {(this: import('marked').Renderer, token: T) => string}
   */
  function withSourceRange(render) {
    return function (token) {
      return addSourceRange(render.call(this, token), ranges.get(token));
    };
  }
  renderer.heading = withSourceRange(renderer.heading);
  renderer.paragraph = withSourceRange(renderer.paragraph);
  renderer.code = withSourceRange(renderer.code);
  renderer.blockquote = withSourceRange(renderer.blockquote);
  renderer.list = withSourceRange(renderer.list);
  renderer.table = withSourceRange(renderer.table);

  const renderBreak = renderer.br;
  renderer.br = function (token) {
    const html = renderBreak.call(this, token);
    const sourceLine = hardBreakLines.get(token);
    return typeof sourceLine === 'number' && Number.isSafeInteger(sourceLine) && sourceLine > 0
      ? html.replace(/^<br\b/i, `<br data-docshelf-line-break-after="${sourceLine}"`)
      : html;
  };

  return {
    html: marked.parser(tokens, { gfm: true, renderer }),
    sourceLineCount: countSourceLines(markdown),
  };
}

/**
 * Annotate authored hard breaks without changing normal Markdown paragraph
 * flow, matching DocShelf's registered-Markdown renderer.
 *
 * @param {Token[]} tokens
 * @param {WeakMap<Token, SourceRange>} ranges
 * @param {WeakMap<Token, number>} hardBreakLines
 */
function annotateParagraphHardBreaks(tokens, ranges, hardBreakLines) {
  for (const token of tokens) {
    const range = ranges.get(token);
    if (token.type === 'paragraph' && range && Array.isArray(token.tokens)) {
      annotateInlineBreaks(token.tokens, range.start, hardBreakLines);
    }
  }
}

/**
 * @param {Token[]} tokens
 * @param {number} startingLine
 * @param {WeakMap<Token, number>} hardBreakLines
 */
function annotateInlineBreaks(tokens, startingLine, hardBreakLines) {
  let sourceLine = startingLine;

  for (const token of tokens) {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    const lineBreaks = countLineBreaks(raw);

    if (token.type === 'br') hardBreakLines.set(token, sourceLine);
    if ('tokens' in token && Array.isArray(token.tokens)) {
      annotateInlineBreaks(token.tokens, sourceLine, hardBreakLines);
    }
    sourceLine += lineBreaks;
  }
}

/** @param {Token[]} tokens */
function sourceRanges(tokens) {
  /** @type {WeakMap<Token, SourceRange>} */
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
