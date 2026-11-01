import { Modal } from 'obsidian';
import type DocShelfPlugin from '../main';
import { documentLabel } from '../core/catalog';
import { MAX_SEARCH_DOCUMENT_CHARACTERS } from '../core/search-text';

export function coverageSummary(plugin: DocShelfPlugin): string {
  const { indexed, total, partial } = plugin.search.coverage;
  return `Content search: ${indexed} of ${total} documents.${partial ? ` ${partial} shortened.` : ''}`;
}

export class SearchCoverageModal extends Modal {
  private unsubscribe?: () => void;
  constructor(private plugin: DocShelfPlugin) { super(plugin.app); }

  onOpen(): void {
    this.titleEl.setText('Search coverage');
    this.unsubscribe = this.plugin.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: coverageSummary(this.plugin) });
    this.contentEl.createEl('p', { text: 'Titles, filenames, project names, and descriptions remain searchable for every document.' });
    const list = this.contentEl.createDiv({ cls: 'docshelf-search-coverage-list' });
    for (const artifact of this.plugin.catalog?.artifacts || []) {
      const coverage = this.plugin.search.coverageFor(artifact.id);
      if (coverage === 'full') continue;
      const reason = coverage === 'partial' ? `First ${MAX_SEARCH_DOCUMENT_CHARACTERS.toLocaleString()} text characters indexed.`
        : coverage === 'limit' ? 'Metadata only: the shelf content budget is full.'
        : artifact.kind === 'claude' ? 'Metadata only: Claude Artifact content is not available to search.'
        : artifact.kind === 'github' ? 'Metadata only: open the document to download its content.'
        : 'Metadata only: the source could not be read.';
      const row = list.createDiv({ cls: 'docshelf-search-coverage-item' });
      const label = documentLabel(artifact);
      row.createEl('button', { text: `${artifact.project} · ${label.name}` }).onclick = () => { this.close(); void this.plugin.openArtifact(artifact); };
      row.createDiv({ text: artifact.source, cls: 'docshelf-muted' });
      row.createDiv({ text: reason, cls: 'docshelf-muted' });
    }
    this.contentEl.createEl('button', { text: 'Close' }).onclick = () => this.close();
  }

  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
}
