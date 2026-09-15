import { ItemView, FuzzySuggestModal, Menu, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { SearchHit } from '../core/search';
import { DOCSHELF_ICON } from './icon';

export const SHELF_VIEW = 'docshelf-shelf';
const PROJECT_DRAG_TYPE = 'application/x-docshelf-project';
const stringList = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [];

export class ShelfView extends ItemView {
  private query = '';
  private collapsedProjects = new Set<string>();
  private projectOrder: string[] = [];
  private draggedProject: string | null = null;
  private dropMarker?: HTMLElement;
  private renderAfterDrag = false;
  private projectMenu?: Menu;
  private results!: HTMLElement;
  private status!: HTMLElement;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) { super(leaf); }
  getViewType(): string { return SHELF_VIEW; }
  getDisplayText(): string { return 'DocShelf'; }
  getIcon(): string { return DOCSHELF_ICON; }
  getState(): Record<string, unknown> { return { collapsedProjects: [...this.collapsedProjects], projectOrder: this.projectOrder }; }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = value as { collapsedProjects?: unknown; projectOrder?: unknown } | null;
    this.collapsedProjects = new Set(stringList(state?.collapsedProjects));
    this.projectOrder = stringList(state?.projectOrder);
    this.renderResults();
    await super.setState(value, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('docshelf-shelf');
    const input = this.contentEl.createEl('input', { cls: 'docshelf-search', type: 'search', attr: { placeholder: 'Search documents…', 'aria-label': 'Search DocShelf' } });
    input.value = this.query;
    input.addEventListener('input', () => { this.query = input.value; this.renderResults(); });
    input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); this.results.querySelector<HTMLButtonElement>('button')?.focus(); } });
    this.status = this.contentEl.createDiv({ cls: 'docshelf-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.results = this.contentEl.createDiv({ cls: 'docshelf-results' });
    this.unsubscribe = this.plugin.subscribe(() => this.renderResults());
    this.renderResults();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.projectMenu?.hide();
    this.renderAfterDrag = false;
    this.endDrag();
  }

  private renderResults(): void {
    if (!this.results) return;
    // A file watcher refresh must not remove the element being dragged.
    if (this.draggedProject !== null) { this.renderAfterDrag = true; return; }
    this.results.empty();
    const artifacts = this.plugin.catalog?.artifacts || [];
    const searching = !!this.query.trim();
    const hits = this.plugin.search.search(this.query);
    const searchStatus = searching ? (hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No matching documents.') : '';
    this.status.setText(this.plugin.error || (this.plugin.loading ? 'Refreshing documents…' : searchStatus));
    this.status.classList.toggle('docshelf-error', !!this.plugin.error);
    if (!artifacts.length) {
      const empty = this.results.createDiv({ cls: 'docshelf-empty' });
      empty.createEl('h3', { text: 'Your documents, in one place' });
      empty.createEl('p', { text: 'Register Markdown and HTML files in a shelf JSON file. Their originals stay in their projects.' });
      empty.createEl('button', { text: 'Configure shelf', cls: 'mod-cta' }).onclick = () => this.plugin.showSettings();
      empty.createEl('button', { text: 'Create empty shelf file' }).onclick = () => { void this.plugin.createShelf(); };
      return;
    }
    if (!hits.length) { this.results.createEl('p', { text: 'Try a title, project, or phrase from the content.', cls: 'docshelf-empty' }); return; }
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
    for (const project of this.orderedProjects(groups.keys())) {
      const documents = groups.get(project)!;
      const group = this.results.createDiv({ cls: 'docshelf-project' });
      const heading = group.createEl('h3', { cls: 'docshelf-project-heading' });
      const toggle = heading.createEl('button', { cls: 'docshelf-project-toggle', attr: { type: 'button', 'aria-expanded': String(!this.collapsedProjects.has(project)) } });
      const chevron = toggle.createSpan({ cls: 'docshelf-project-chevron', attr: { 'aria-hidden': 'true' } });
      setIcon(chevron, 'chevron-right');
      toggle.createSpan({ text: project, cls: 'docshelf-project-name' });
      toggle.createSpan({ text: String(documents.length), cls: 'docshelf-project-count', attr: { 'aria-label': `${documents.length} document${documents.length === 1 ? '' : 's'}` } });
      toggle.dataset.project = project;
      toggle.draggable = true;
      toggle.setAttribute('aria-description', 'Drag to reorder projects. Press Shift+F10 for project order options.');
      toggle.addEventListener('dragstart', event => {
        if (!event.dataTransfer) { event.preventDefault(); return; }
        event.stopPropagation();
        this.draggedProject = project;
        event.dataTransfer.setData(PROJECT_DRAG_TYPE, project);
        event.dataTransfer.effectAllowed = 'move';
        toggle.addClass('is-dragging');
      });
      toggle.addEventListener('dragend', () => this.endDrag());
      group.addEventListener('dragover', event => {
        if (this.draggedProject === null || !event.dataTransfer?.types.includes(PROJECT_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        this.clearDropMarker();
        if (this.draggedProject === project) return;
        const bounds = group.getBoundingClientRect();
        group.addClass(event.clientY < bounds.top + bounds.height / 2 ? 'docshelf-drop-before' : 'docshelf-drop-after');
        this.dropMarker = group;
      });
      group.addEventListener('dragleave', event => {
        if (!event.relatedTarget || !group.contains(event.relatedTarget as Node)) this.clearDropMarker();
      });
      group.addEventListener('drop', event => {
        const source = this.draggedProject;
        if (source === null || event.dataTransfer?.getData(PROJECT_DRAG_TYPE) !== source) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = group.getBoundingClientRect();
        const after = event.clientY >= bounds.top + bounds.height / 2;
        this.endDrag();
        if (source === project) return;
        const order = this.orderedProjects();
        if (!order.includes(source) || !order.includes(project)) return;
        order.splice(order.indexOf(source), 1);
        order.splice(order.indexOf(project) + (after ? 1 : 0), 0, source);
        this.saveProjectOrder(order, source);
      });
      toggle.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        this.showProjectMenu(project, toggle);
      });
      toggle.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          event.stopPropagation();
          this.showProjectMenu(project, toggle);
        }
      });
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

  private orderedProjects(names: Iterable<string> = (this.plugin.catalog?.artifacts || []).map(artifact => artifact.project)): string[] {
    const projects = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    const available = new Set(projects);
    const saved = new Set(this.projectOrder);
    return [...this.projectOrder.filter(project => available.has(project)), ...projects.filter(project => !saved.has(project))];
  }

  private saveProjectOrder(order: string[], focusProject: string): void {
    this.projectOrder = order;
    this.app.workspace.requestSaveLayout();
    this.renderResults();
    Array.from(this.results.querySelectorAll<HTMLButtonElement>('.docshelf-project-toggle')).find(button => button.dataset.project === focusProject)?.focus();
  }

  private showProjectMenu(project: string, toggle: HTMLButtonElement): void {
    this.projectMenu?.hide();
    const order = this.orderedProjects();
    const index = order.indexOf(project);
    const menu = this.projectMenu = new Menu().setUseNativeMenu(false);
    for (const [title, icon, offset] of [['Move up', 'arrow-up', -1], ['Move down', 'arrow-down', 1]] as const) {
      menu.addItem(item => item.setTitle(title).setIcon(icon).setDisabled(index < 0 || index + offset < 0 || index + offset >= order.length).onClick(() => {
        // Read the current catalog in case it changed while the menu was open.
        const current = this.orderedProjects();
        const from = current.indexOf(project);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= current.length) return;
        current.splice(from, 1);
        current.splice(to, 0, project);
        this.saveProjectOrder(current, project);
      }));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Reset to alphabetical').setIcon('list-restart').setDisabled(!this.projectOrder.length).onClick(() => this.saveProjectOrder([], project)));
    menu.onHide(() => { this.projectMenu = undefined; if (toggle.isConnected) toggle.focus(); });
    const bounds = toggle.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, toggle.ownerDocument);
  }

  private clearDropMarker(): void {
    this.dropMarker?.removeClass('docshelf-drop-before', 'docshelf-drop-after');
    this.dropMarker = undefined;
  }

  private endDrag(): void {
    this.draggedProject = null;
    this.clearDropMarker();
    this.results?.querySelector('.is-dragging')?.removeClass('is-dragging');
    if (this.renderAfterDrag) { this.renderAfterDrag = false; this.renderResults(); }
  }

  private renderItem(parent: HTMLElement, { artifact, excerpt }: SearchHit, searching: boolean): void {
    const kind = { markdown: 'Markdown', html: 'HTML', github: 'GitHub Markdown', claude: 'Claude artifact' }[artifact.kind];
    const icon = { markdown: 'file-text', html: 'file-code', github: 'github', claude: 'globe' }[artifact.kind];
    const button = parent.createEl('button', { cls: 'docshelf-item', attr: { type: 'button', 'aria-label': artifact.title, 'aria-description': [kind, searching ? artifact.project : '', searching ? excerpt : ''].filter(Boolean).join('. ') } });
    button.toggleClass('docshelf-search-result', searching);
    setTooltip(button, `${artifact.title} (${kind})`, { placement: 'right' });
    const title = button.createDiv({ cls: 'docshelf-item-heading' });
    setIcon(title.createSpan({ cls: 'docshelf-item-icon', attr: { 'aria-hidden': 'true' } }), icon);
    title.createSpan({ text: artifact.title, cls: 'docshelf-item-title' });
    if (searching) {
      if (excerpt) button.createSpan({ text: excerpt, cls: 'docshelf-item-description' });
      button.createSpan({ text: artifact.project, cls: 'docshelf-item-project' });
    }
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
    el.createDiv({ text: [hit.artifact.project, hit.excerpt].filter(Boolean).join(' · '), cls: 'docshelf-muted' });
  }
  onChooseItem(hit: SearchHit): void { void this.plugin.openArtifact(hit.artifact); }
}
