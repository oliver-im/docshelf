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

/** Resolve native editor link clicks using the source line, never a vault lookup. */
export function markdownLink(source: string, line: number, column: number, label?: string): string | null {
  const text = source.split('\n')[line] || '';
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (column >= match.index! && column <= match.index! + match[0].length) return match[1].split('|')[0];
  }
  const tokens = markdown.parse(withoutFrontmatter(source), {});
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.map || line < token.map[0] || line >= token.map[1]) continue;
    const links: { href: string; label: string }[] = [];
    let link: { href: string; label: string } | undefined;
    for (const child of token.children || []) {
      if (child.type === 'link_open') link = { href: child.attrGet('href') || '', label: '' };
      else if (child.type === 'link_close') { if (link) links.push(link); link = undefined; }
      else if (link) link.label += child.content;
    }
    let offset = 0;
    for (const link of links) {
      const start = text.indexOf(`[${link.label}]`, offset);
      if (start >= 0) {
        const end = text.indexOf(')', start + link.label.length + 2);
        if (column >= start && column <= (end < 0 ? start + link.label.length + 2 : end)) return link.href;
        offset = start + link.label.length + 2;
      }
    }
    const matches = label ? links.filter(link => link.label === label) : links;
    if (matches.length === 1) return matches[0].href;
  }
  return null;
}

export function markdownHeadingLine(source: string, hash: string): number | undefined {
  const tokens = markdown.parse(withoutFrontmatter(source), {});
  addHeadingIds(tokens);
  const heading = decodeURIComponent(hash.replace(/^#/, ''));
  return tokens.find((token, index) => token.type === 'heading_open' && (token.attrGet('id') === heading || tokens[index + 1]?.content === heading))?.map?.[0];
}
