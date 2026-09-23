import MiniSearch from 'minisearch';
import { parse } from 'parse5';
import { markdownText } from './markdown';
import { documentLabel } from './catalog';
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
  private index = new MiniSearch({ fields: ['title', 'name', 'project', 'description', 'body'], storeFields: ['body'], searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 4, name: 4, project: 2 } } });
  private artifacts = new Map<string, Artifact>();
  private entries = new Map<string, { source: string; kind: string; metadata: string; body: string }>();

  async replace(artifacts: Artifact[], contents: Map<string, string>, active = () => true): Promise<void> {
    this.artifacts = new Map(artifacts.map(artifact => [artifact.id, artifact]));
    for (const id of this.entries.keys()) if (!this.artifacts.has(id)) { this.index.discard(id); this.entries.delete(id); }
    let started = performance.now();
    for (const artifact of artifacts) {
      if (!active()) return;
      const source = contents.get(artifact.id) || '';
      const name = documentLabel(artifact).name;
      const metadata = JSON.stringify([artifact.title, name, artifact.project, artifact.description]);
      const previous = this.entries.get(artifact.id);
      const sameSource = previous?.source === source && previous.kind === artifact.kind;
      if (sameSource && previous.metadata === metadata) continue;
      const body = sameSource ? previous.body : (artifact.kind === 'html' ? extractText(source) : markdownText(source)).slice(0, 200_000);
      const document = { id: artifact.id, title: artifact.title, name, project: artifact.project, description: artifact.description, body };
      if (previous) this.index.replace(document); else this.index.add(document);
      this.entries.set(artifact.id, { source, kind: artifact.kind, metadata, body });
      // Initial indexing and large batches should let the renderer paint and
      // process input between documents. Ordinary refreshes touch only changes.
      if (performance.now() - started >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); started = performance.now(); }
    }
  }

  search(query: string): SearchHit[] {
    if (!query.trim()) return Array.from(this.artifacts.values(), artifact => ({ artifact, excerpt: '' }));
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
