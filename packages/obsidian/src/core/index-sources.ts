import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalFile, readBoundedFile } from './files';
import { MAX_DOCUMENT_BYTES } from './types';
import { searchContent, type SearchContent } from './search-text';

interface IndexedSource extends SearchContent { identity: string; revision: string; length: number }

/** A search-only cache. Editor/server reads and all write conflict checks still
 * read the real file. Canonical containment is checked even on cache hits. */
export class IndexSources {
  private entries = new Map<string, IndexedSource>();

  async read(file: string, roots: string[], textBudget: number): Promise<IndexedSource> {
    try {
      const canonical = await canonicalFile(file, roots);
      const info = await stat(canonical, { bigint: true });
      const identity = [canonical, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
      const previous = this.entries.get(file);
      if (previous?.identity === identity && (previous.body !== undefined || previous.length > textBudget)) {
        if (previous.length > textBudget) previous.body = undefined;
        return previous;
      }
      const bytes = await readBoundedFile(file, roots, MAX_DOCUMENT_BYTES);
      const kind = ['.html', '.htm'].includes(path.extname(file).toLowerCase()) ? 'html' : 'markdown';
      const entry = { identity, revision: createHash('sha256').update(bytes).digest('hex'), ...searchContent(bytes.toString('utf8'), kind) };
      if (entry.length > textBudget) entry.body = undefined;
      this.entries.set(file, entry);
      return entry;
    } catch (error) { this.entries.delete(file); throw error; }
  }

  /** Remote sources are already bounded by the reader; retain only their extracted search text here. */
  remote(key: string, source: string, textBudget: number): IndexedSource {
    const revision = createHash('sha256').update(source).digest('hex');
    const previous = this.entries.get(key);
    if (previous?.revision === revision && (previous.body !== undefined || previous.length > textBudget)) {
      if (previous.length > textBudget) previous.body = undefined;
      return previous;
    }
    const entry = { identity: revision, revision, ...searchContent(source, 'markdown') };
    if (entry.length > textBudget) entry.body = undefined;
    this.entries.set(key, entry);
    return entry;
  }

  retain(files: Set<string>): void { for (const file of this.entries.keys()) if (!files.has(file)) this.entries.delete(file); }
  clear(): void { this.entries.clear(); }
}
