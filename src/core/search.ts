import MiniSearch from 'minisearch';
import { parse } from 'parse5';
import { renderMarkdown } from './markdown';
import type { Artifact } from './types';

export function extractText(html: string): string {
  const parts: string[] = [];
  const visit = (node: any) => {
    if (['script', 'style', 'noscript', 'template', 'svg', 'head'].includes(node.tagName)) return;
    if (node.nodeName === '#text') parts.push(node.value);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export interface SearchHit { artifact: Artifact; excerpt: string }

export class ShelfSearch {
  private index = new MiniSearch({ fields: ['title', 'project', 'description', 'body'], storeFields: ['body'], searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 4, project: 2 } } });
  private artifacts = new Map<string, Artifact>();

  replace(artifacts: Artifact[], contents: Map<string, string>): void {
    this.index.removeAll();
    this.artifacts = new Map(artifacts.map(artifact => [artifact.id, artifact]));
    this.index.addAll(artifacts.map(artifact => {
      const source = contents.get(artifact.id) || '';
      const html = artifact.kind === 'html' ? source : renderMarkdown(source).html;
      return { id: artifact.id, title: artifact.title, project: artifact.project, description: artifact.description, body: extractText(html).slice(0, 200_000) };
    }));
  }

  search(query: string): SearchHit[] {
    if (!query.trim()) return Array.from(this.artifacts.values(), artifact => ({ artifact, excerpt: artifact.description }));
    return this.index.search(query.trim()).slice(0, 100).flatMap(result => {
      const artifact = this.artifacts.get(result.id);
      if (!artifact) return [];
      const body = String(result.body || artifact.description);
      const term = result.terms[0] || query;
      const position = Math.max(0, body.toLowerCase().indexOf(term.toLowerCase()) - 45);
      return [{ artifact, excerpt: `${position ? '…' : ''}${body.slice(position, position + 170)}${body.length > position + 170 ? '…' : ''}` }];
    });
  }
}
