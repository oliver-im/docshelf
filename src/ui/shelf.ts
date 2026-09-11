import { ItemView, FuzzySuggestModal, type WorkspaceLeaf } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { SearchHit } from '../core/search';

export const SHELF_VIEW = 'docshelf-shelf';

export class ShelfView extends ItemView {
  private query = '';
  private results!: HTMLElement;
  private status!: HTMLElement;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) { super(leaf); }
  getViewType(): string { return SHELF_VIEW; }
  getDisplayText(): string { return 'DocShelf'; }
  getIcon(): string { return 'library'; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('docshelf-shelf');
    const heading = this.contentEl.createDiv({ cls: 'docshelf-shelf-heading' });
    heading.createEl('h2', { text: 'DocShelf' });
    const actions = heading.createDiv({ cls: 'docshelf-toolbar' });
    actions.createEl('button', { text: 'Reload', attr: { type: 'button' } }).onclick = () => { void this.plugin.refresh(); };
    actions.createEl('button', { text: 'Configure', attr: { type: 'button' } }).onclick = () => this.plugin.showSettings();
    const input = this.contentEl.createEl('input', { cls: 'docshelf-search', type: 'search', attr: { placeholder: 'Search documents…', 'aria-label': 'Search DocShelf' } });
    input.value = this.query;
    input.addEventListener('input', () => { this.query = input.value; this.renderResults(); });
    input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); this.results.querySelector<HTMLButtonElement>('button')?.focus(); } });
    this.status = this.contentEl.createDiv({ cls: 'docshelf-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.results = this.contentEl.createDiv({ cls: 'docshelf-results' });
    this.unsubscribe = this.plugin.subscribe(() => this.renderResults());
    this.renderResults();
  }

  async onClose(): Promise<void> { this.unsubscribe?.(); }

  private renderResults(): void {
    if (!this.results) return;
    this.results.empty();
    const artifacts = this.plugin.catalog?.artifacts || [];
    const hits = this.plugin.search.search(this.query);
    this.status.setText(this.plugin.error || (this.plugin.loading ? 'Refreshing documents…' : `${artifacts.length} document${artifacts.length === 1 ? '' : 's'}${this.query ? ` · ${hits.length} found` : ''}`));
    this.status.classList.toggle('docshelf-error', !!this.plugin.error);
    if (!artifacts.length) {
      const empty = this.results.createDiv({ cls: 'docshelf-empty' });
      empty.createEl('h3', { text: 'Your documents, in one place' });
      empty.createEl('p', { text: 'Register Markdown and HTML files in a shelf JSON file. Their originals stay in their projects.' });
      empty.createEl('button', { text: 'Configure shelf', cls: 'mod-cta' }).onclick = () => this.plugin.showSettings();
      empty.createEl('button', { text: 'Create empty shelf file' }).onclick = () => { void this.plugin.createShelf(); };
      return;
    }
    if (!hits.length) { this.results.createEl('p', { text: 'No matching documents. Try a title, project, or phrase from the content.', cls: 'docshelf-empty' }); return; }
    let project = '';
    const ordered = this.query ? hits : [...hits].sort((a, b) => a.artifact.project.localeCompare(b.artifact.project) || a.artifact.title.localeCompare(b.artifact.title));
    for (const { artifact, excerpt } of ordered) {
      if (!this.query && artifact.project !== project) { project = artifact.project; this.results.createEl('h3', { text: project, cls: 'docshelf-project' }); }
      const button = this.results.createEl('button', { cls: 'docshelf-item', attr: { type: 'button' } });
      const title = button.createDiv({ cls: 'docshelf-item-heading' });
      title.createSpan({ text: artifact.title, cls: 'docshelf-item-title' });
      title.createSpan({ text: artifact.kind === 'github' ? 'GitHub' : artifact.kind === 'claude' ? 'Claude' : artifact.kind === 'html' ? 'HTML' : 'MD', cls: 'docshelf-kind' });
      button.createSpan({ text: excerpt || artifact.description, cls: 'docshelf-item-description' });
      if (this.query) button.createSpan({ text: artifact.project, cls: 'docshelf-muted' });
      button.onclick = () => { void this.plugin.openArtifact(artifact); };
    }
  }
}

export class SearchModal extends FuzzySuggestModal<SearchHit> {
  constructor(private plugin: DocShelfPlugin) { super(plugin.app); this.setPlaceholder('Search DocShelf…'); }
  getItems(): SearchHit[] { return this.plugin.search.search(''); }
  getItemText(hit: SearchHit): string { return `${hit.artifact.title} — ${hit.artifact.project}`; }
  getSuggestions(query: string): any[] { return this.plugin.search.search(query).map(item => ({ item, match: { score: 0, matches: [] } })); }
  renderSuggestion(value: any, el: HTMLElement): void {
    const hit = value.item as SearchHit;
    el.createDiv({ text: hit.artifact.title });
    el.createDiv({ text: `${hit.artifact.project} · ${hit.excerpt}`, cls: 'docshelf-muted' });
  }
  onChooseItem(hit: SearchHit): void { void this.plugin.openArtifact(hit.artifact); }
}
