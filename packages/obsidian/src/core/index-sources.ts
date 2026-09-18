import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalFile, readBoundedFile } from './files';
import { MAX_DOCUMENT_BYTES } from './types';

interface IndexedSource { identity: string; revision: string; length: number; source?: string }

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
      if (previous?.identity === identity && (previous.source !== undefined || previous.length > textBudget)) {
        if (previous.length > textBudget) previous.source = undefined;
        return previous;
      }
      const bytes = await readBoundedFile(file, roots, MAX_DOCUMENT_BYTES);
      const source = bytes.toString('utf8');
      const entry = { identity, revision: createHash('sha256').update(bytes).digest('hex'), length: source.length, source: source.length <= textBudget ? source : undefined };
      this.entries.set(file, entry);
      return entry;
    } catch (error) { this.entries.delete(file); throw error; }
  }

  retain(files: Set<string>): void { for (const file of this.entries.keys()) if (!files.has(file)) this.entries.delete(file); }
  clear(): void { this.entries.clear(); }
}
