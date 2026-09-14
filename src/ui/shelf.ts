import { ItemView, FuzzySuggestModal, Menu, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { SearchHit } from '../core/search';
import { DOCSHELF_ICON } from './icon';

export const SHELF_VIEW = 'docshelf-shelf';

export class ShelfView extends ItemView {
  private query = '';
  private collapsedProjects = new Set<string>();
  private results!: HTMLElement;
  private status!: HTMLElement;
  private menu?: Menu;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) { super(leaf); }
  getViewType(): string { return SHELF_VIEW; }
  getDisplayText(): string { return 'DocShelf'; }
  getIcon(): string { return DOCSHELF_ICON; }
  getState(): Record<string, unknown> { return { collapsedProjects: [...this.collapsedProjects] }; }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = value as { collapsedProjects?: unknown } | null;
    this.collapsedProjects = new Set(Array.isArray(state?.collapsedProjects) ? state.collapsedProjects.filter((project): project is string => typeof project === 'string') : []);
    this.renderResults();
    await super.setState(value, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('docshelf-shelf');
    const toolbar = this.contentEl.createDiv({ cls: 'docshelf-shelf-toolbar' });
    const input = toolbar.createEl('input', { cls: 'docshelf-search', type: 'search', attr: { placeholder: 'Search documents…', 'aria-label': 'Search DocShelf' } });
    input.value = this.query;
    input.addEventListener('input', () => { this.query = input.value; this.renderResults(); });
    input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); this.results.querySelector<HTMLButtonElement>('button')?.focus(); } });
    const more = toolbar.createEl('button', { cls: 'clickable-icon docshelf-menu-button', attr: { type: 'button', 'aria-label': 'DocShelf options', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    setIcon(more, 'ellipsis');
    setTooltip(more, 'DocShelf options');
    more.onclick = () => {
      this.menu?.hide();
      const menu = this.menu = new Menu().setUseNativeMenu(false);
      menu.addItem(item => item.setTitle('Reload shelf').setIcon('refresh-cw').onClick(() => { void this.plugin.refresh(); }));
      menu.addItem(item => item.setTitle('Configure shelf').setIcon('settings').onClick(() => this.plugin.showSettings()));
      more.setAttribute('aria-expanded', 'true');
      menu.onHide(() => { more.setAttribute('aria-expanded', 'false'); this.menu = undefined; });
      const bounds = more.getBoundingClientRect();
      menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, more.ownerDocument);
    };
    this.status = this.contentEl.createDiv({ cls: 'docshelf-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.results = this.contentEl.createDiv({ cls: 'docshelf-results' });
    this.unsubscribe = this.plugin.subscribe(() => this.renderResults());
    this.renderResults();
  }

  async onClose(): Promise<void> { this.menu?.hide(); this.unsubscribe?.(); }

  private renderResults(): void {
    if (!this.results) return;
    this.results.empty();
    const artifacts = this.plugin.catalog?.artifacts || [];
    const searching = !!this.query.trim();
    const hits = this.plugin.search.search(this.query);
    this.status.setText(this.plugin.error || (this.plugin.loading ? 'Refreshing documents…' : `${artifacts.length} document${artifacts.length === 1 ? '' : 's'}${searching ? ` · ${hits.length} found` : ''}`));
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
    if (searching) {
      for (const hit of hits) this.renderItem(this.results, hit, true);
      return;
    }
    const groups = new Map<string, SearchHit[]>();
    const ordered = [...hits].sort((a, b) => a.artifact.project.localeCompare(b.artifact.project) || a.artifact.title.localeCompare(b.artifact.title));
    for (const hit of ordered) {
      const project = hit.artifact.project;
      if (!groups.has(project)) groups.set(project, []);
      groups.get(project)!.push(hit);
    }
    for (const [project, documents] of groups) {
      const group = this.results.createDiv({ cls: 'docshelf-project' });
      const heading = group.createEl('h3', { cls: 'docshelf-project-heading' });
      const toggle = heading.createEl('button', { cls: 'docshelf-project-toggle', attr: { type: 'button', 'aria-expanded': String(!this.collapsedProjects.has(project)) } });
      const chevron = toggle.createSpan({ cls: 'docshelf-project-chevron', attr: { 'aria-hidden': 'true' } });
      setIcon(chevron, 'chevron-right');
      toggle.createSpan({ text: project, cls: 'docshelf-project-name' });
      toggle.createSpan({ text: String(documents.length), cls: 'docshelf-project-count', attr: { 'aria-label': `${documents.length} document${documents.length === 1 ? '' : 's'}` } });
      const items = group.createDiv({ cls: 'docshelf-project-items' });
      items.hidden = this.collapsedProjects.has(project);
      toggle.onclick = () => {
        items.hidden = !items.hidden;
        toggle.setAttribute('aria-expanded', String(!items.hidden));
        if (items.hidden) this.collapsedProjects.add(project);
        else this.collapsedProjects.delete(project);
        this.app.workspace.requestSaveLayout();
      };
      for (const hit of documents) this.renderItem(items, hit, false);
    }
  }

  private renderItem(parent: HTMLElement, { artifact, excerpt }: SearchHit, showProject: boolean): void {
    const button = parent.createEl('button', { cls: 'docshelf-item', attr: { type: 'button' } });
    const title = button.createDiv({ cls: 'docshelf-item-heading' });
    title.createSpan({ text: artifact.title, cls: 'docshelf-item-title' });
    title.createSpan({ text: artifact.kind === 'github' ? 'GitHub' : artifact.kind === 'claude' ? 'Claude' : artifact.kind === 'html' ? 'HTML' : 'MD', cls: 'docshelf-kind' });
    button.createSpan({ text: excerpt || artifact.description, cls: 'docshelf-item-description' });
    if (showProject) button.createSpan({ text: artifact.project, cls: 'docshelf-muted' });
    button.onclick = () => { void this.plugin.openArtifact(artifact); };
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
