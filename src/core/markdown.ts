import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

const markdown = new MarkdownIt({ html: true, linkify: true, breaks: false });
markdown.renderer.rules.html_block = () => '';
markdown.renderer.rules.html_inline = () => '';

const selectable = new Set(['heading_open', 'paragraph_open', 'fence', 'code_block', 'table_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open']);
for (const type of selectable) {
  const render = markdown.renderer.rules[type];
  markdown.renderer.rules[type] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const result = render ? render(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    if (!token.map || token.level !== 0) return result;
    return result.replace(/^<([\w-]+)/, `<$1 data-docshelf-line-start="${token.map[0] + 1}" data-docshelf-line-end="${token.map[1]}"`);
  };
}

markdown.core.ruler.after('inline', 'docshelf-breaks', state => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.map || !token.children) continue;
    let line = token.map[0] + 1;
    for (const child of token.children) {
      if (child.type === 'softbreak' || child.type === 'hardbreak') {
        child.meta = { line };
        line += 1;
      }
    }
  }
});
const hardbreak = markdown.renderer.rules.hardbreak!;
markdown.renderer.rules.hardbreak = (tokens, index, options, env, self) => {
  return hardbreak(tokens, index, options, env, self).replace('<br', `<br data-docshelf-line-break-after="${tokens[index].meta?.line}"`);
};

/** Hide frontmatter while preserving every source-line offset. */
export function withoutFrontmatter(source: string): string {
  return source.replace(/^(---|\+\+\+)\n(?:[\s\S]*?\n)?\1(?:\n|$)/, match => '\n'.repeat(match.split('\n').length - 1));
}

export function sourceLines(source: string): string[] {
  if (!source) return [];
  const lines = source.replace(/\r\n?|\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function renderMarkdown(source: string): { html: string; lineCount: number } {
  const normalized = source.replace(/\r\n?/g, '\n');
  const tokens = markdown.parse(withoutFrontmatter(normalized), {});
  addHeadingIds(tokens);
  return { html: markdown.renderer.render(tokens, markdown.options, {}), lineCount: sourceLines(source).length };
}

function addHeadingIds(tokens: Token[]): void {
  const used = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const text = tokens[i + 1]?.content || '';
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const occurrence = used.get(slug) || 0;
    used.set(slug, occurrence + 1);
    tokens[i].attrSet('id', occurrence ? `${slug}-${occurrence}` : slug);
  }
}
