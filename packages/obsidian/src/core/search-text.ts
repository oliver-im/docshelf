import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { markdownText } from './markdown';

export const MAX_SEARCH_CHARACTERS = 16 * 1024 * 1024;
export const MAX_SEARCH_DOCUMENT_CHARACTERS = 200_000;

/** A missing body means the extracted text did not fit the remaining shelf budget. */
export interface SearchContent { body?: string; truncated: boolean }

export function extractText(html: string): string {
  const parts: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node && ['script', 'style', 'noscript', 'template', 'svg', 'head'].includes(node.tagName)) return;
    if ('value' in node) parts.push(node.value);
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(parse(html));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function searchContent(source: string, kind: string): SearchContent & { length: number } {
  const text = kind === 'html' ? extractText(source) : markdownText(source);
  // Copy the bounded text so a substring cannot retain a much larger source or extracted string.
  const body = Buffer.from(text.slice(0, MAX_SEARCH_DOCUMENT_CHARACTERS)).toString('utf8');
  return { body, length: body.length, truncated: text.length > MAX_SEARCH_DOCUMENT_CHARACTERS };
}
