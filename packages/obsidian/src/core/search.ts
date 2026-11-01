import MiniSearch from 'minisearch';
import { documentLabel } from './catalog';
import type { Artifact } from './types';
import type { SearchContent } from './search-text';
import { setTimeout as yieldToEventLoop } from 'node:timers/promises';

export { extractText } from './search-text';
export type SearchCoverage = 'full' | 'partial' | 'limit' | 'unavailable';

export interface SearchHit { artifact: Artifact; excerpt: string }

export class ShelfSearch {
  private index = new MiniSearch({ fields: ['title', 'name', 'project', 'description', 'body'], storeFields: ['body'], searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 4, name: 4, project: 2 } } });
  private artifacts = new Map<string, Artifact>();
  private entries = new Map<string, { metadata: string; body: string; coverage: SearchCoverage }>();

  coverageFor(id: string): SearchCoverage { return this.entries.get(id)?.coverage || 'unavailable'; }

  get coverage() {
    const entries = [...this.entries.values()];
    return {
      total: entries.length,
      indexed: entries.filter(entry => entry.coverage === 'full' || entry.coverage === 'partial').length,
      partial: entries.filter(entry => entry.coverage === 'partial').length,
      limited: entries.filter(entry => entry.coverage === 'limit').length,
    };
  }

  async replace(artifacts: Artifact[], contents: Map<string, SearchContent>, active = () => true): Promise<void> {
    this.artifacts = new Map(artifacts.map(artifact => [artifact.id, artifact]));
    for (const id of this.entries.keys()) if (!this.artifacts.has(id)) { this.index.discard(id); this.entries.delete(id); }
    let started = performance.now();
    for (const artifact of artifacts) {
      if (!active()) return;
      const content = contents.get(artifact.id);
      const body = content?.body || '';
      const coverage: SearchCoverage = !content ? 'unavailable' : content.body === undefined ? 'limit' : content.truncated ? 'partial' : 'full';
      const name = documentLabel(artifact).name;
      const metadata = JSON.stringify([artifact.title, name, artifact.project, artifact.description]);
      const previous = this.entries.get(artifact.id);
      if (previous?.body === body && previous.metadata === metadata) { previous.coverage = coverage; continue; }
      const document = { id: artifact.id, title: artifact.title, name, project: artifact.project, description: artifact.description, body };
      if (previous) this.index.replace(document); else this.index.add(document);
      this.entries.set(artifact.id, { metadata, body, coverage });
      // Initial indexing and large batches should let the renderer paint and
      // process input between documents. Ordinary refreshes touch only changes.
      if (performance.now() - started >= 8) { await yieldToEventLoop(0); started = performance.now(); }
    }
  }

  search(query: string): SearchHit[] {
    if (!query.trim()) return Array.from(this.artifacts.values(), artifact => ({ artifact, excerpt: '' }));
    return this.index.search(query.trim()).slice(0, 100).flatMap(result => {
      const artifact = typeof result.id === 'string' ? this.artifacts.get(result.id) : undefined;
      if (!artifact) return [];
      const body = typeof result.body === 'string' && result.body ? result.body : artifact.description;
      const term = result.terms[0] || query;
      const position = Math.max(0, body.toLowerCase().indexOf(term.toLowerCase()) - 45);
      return [{ artifact, excerpt: `${position ? '…' : ''}${body.slice(position, position + 170)}${body.length > position + 170 ? '…' : ''}` }];
    });
  }
}
