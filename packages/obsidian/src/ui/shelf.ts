import { ItemView, FuzzySuggestModal, Menu, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { SearchHit } from '../core/search';
import type { Artifact } from '../core/types';
import { DOCSHELF_ICON } from './icon';
import { documentLabel } from '../core/catalog';

export const SHELF_VIEW = 'docshelf-shelf';
const PROJECT_DRAG_TYPE = 'application/x-docshelf-project';
const DOCUMENT_DRAG_TYPE = 'application/x-docshelf-document';
const stringList = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [];

export class ShelfView extends ItemView {
  private query = '';
  private collapsedProjects = new Set<string>();
  private projectOrder: string[] = [];
  private documentOrder = new Map<string, string[]>();
  private draggedProject: string | null = null;
  private draggedDocument: { project: string; route: string } | null = null;
  private dropMarker?: HTMLElement;
  private renderAfterDrag = false;
  private orderMenu?: Menu;
  private results!: HTMLElement;
  private status!: HTMLElement;
  private renderedResults = '';
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) { super(leaf); }
  getViewType(): string { return SHELF_VIEW; }
  getDisplayText(): string { return 'DocShelf'; }
  getIcon(): string { return DOCSHELF_ICON; }
  getState(): Record<string, unknown> { return { collapsedProjects: [...this.collapsedProjects], projectOrder: this.projectOrder, documentOrder: Object.fromEntries(this.documentOrder) }; }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    this.renderedResults = '';
    const state = value as { collapsedProjects?: unknown; projectOrder?: unknown; documentOrder?: unknown } | null;
    this.collapsedProjects = new Set(stringList(state?.collapsedProjects));
    this.projectOrder = stringList(state?.projectOrder);
    const orders = state?.documentOrder;
    this.documentOrder = new Map(orders && typeof orders === 'object' && !Array.isArray(orders)
      ? Object.entries(orders).map(([project, routes]) => [project, stringList(routes)]) : []);
    this.renderResults();
    await super.setState(value, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.renderedResults = '';
    this.contentEl.addClass('docshelf-shelf');
    this.registerDomEvent(this.contentEl, 'contextmenu', event => {
      if (event.defaultPrevented || (event.target as HTMLElement).closest('input, textarea')) return;
      event.preventDefault();
      new Menu().addItem(item => item.setTitle('Add…').setIcon('plus').onClick(() => this.plugin.showAdd())).showAtMouseEvent(event);
    });
    const tools = this.contentEl.createDiv({ cls: 'docshelf-shelf-tools' });
    const input = tools.createEl('input', { cls: 'docshelf-search', type: 'search', attr: { placeholder: 'Search documents…', 'aria-label': 'Search DocShelf' } });
    const add = tools.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Add…', title: 'Add…', type: 'button' } });
    setIcon(add, 'plus');
    add.onclick = () => this.plugin.showAdd();
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
    this.orderMenu?.hide();
    this.renderAfterDrag = false;
    this.endDrag();
  }

  private renderResults(): void {
    if (!this.results) return;
    // A file watcher refresh must not remove the element being dragged.
    if (this.draggedProject !== null || this.draggedDocument !== null) { this.renderAfterDrag = true; return; }
    const artifacts = this.plugin.catalog?.artifacts || [];
    const searching = !!this.query.trim();
    const hits = this.plugin.search.search(this.query);
    const searchStatus = searching ? (hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No matching documents.') : '';
    // Background refreshes must not shift the rows under a pointer or drag.
    this.status.setText(this.plugin.error || (this.plugin.loading && !this.plugin.catalog ? 'Loading documents…' : searchStatus));
    this.status.classList.toggle('docshelf-error', !!this.plugin.error);
    // Collapsing a project updates its existing DOM directly. Include order
    // here, while setState explicitly invalidates restored collapse state.
    const key = JSON.stringify([this.query, this.projectOrder, [...this.documentOrder], hits, artifacts.length]);
    if (key === this.renderedResults) return;
    this.renderedResults = key;
    this.results.empty();
    if (!artifacts.length) {
      const empty = this.results.createDiv({ cls: 'docshelf-empty' });
      empty.createEl('h3', { text: 'Your documents, in one place' });
      empty.createEl('p', { text: 'Add files or folders. Documents stay in their projects and folders update automatically.' });
      empty.createEl('button', { text: 'Add…', cls: 'mod-cta' }).onclick = () => this.plugin.showAdd();
      empty.createEl('button', { text: 'Configure shelf' }).onclick = () => this.plugin.showSettings();
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
      for (const artifact of this.orderedDocuments(project, documents.map(hit => hit.artifact))) this.renderItem(items, { artifact, excerpt: '' }, false);
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
    const menu = this.createMenu(project);
    this.addMoveActions(menu, project, () => this.orderedProjects(), order => this.saveProjectOrder(order, project));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Reset to alphabetical').setIcon('list-restart').setDisabled(!this.documentOrder.get(project)?.length).onClick(() => {
      this.documentOrder.delete(project);
      this.app.workspace.requestSaveLayout();
      this.renderResults();
      Array.from(this.results.querySelectorAll<HTMLButtonElement>('.docshelf-project-toggle')).find(button => button.dataset.project === project)?.focus();
    }));
    menu.addItem(item => item.setTitle('Reset project order').setIcon('list-restart').setDisabled(!this.projectOrder.length).onClick(() => this.saveProjectOrder([], project)));
    this.showMenu(menu, toggle);
  }

  private showDocumentMenu(artifact: Artifact, button: HTMLButtonElement, searching: boolean): void {
    const { project, route } = artifact;
    const menu = this.createMenu(project);
    if (!searching) this.addMoveActions(menu, route, () => this.orderedDocuments(project).map(item => item.route), order => this.saveDocumentOrder(project, order, route));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from shelf…').setIcon('list-minus').onClick(() => this.plugin.showRemove(artifact)));
    this.showMenu(menu, button);
  }

  private createMenu(project: string): Menu {
    this.orderMenu?.hide();
    const menu = this.orderMenu = new Menu().setUseNativeMenu(false);
    menu.addItem(item => item.setTitle('Add…').setIcon('plus').onClick(() => this.plugin.showAdd(project)));
    menu.addSeparator();
    return menu;
  }

  private addMoveActions(menu: Menu, key: string, getOrder: () => string[], saveOrder: (order: string[]) => void): void {
    const order = getOrder();
    const index = order.indexOf(key);
    for (const [title, icon, offset] of [['Move up', 'arrow-up', -1], ['Move down', 'arrow-down', 1]] as const) {
      menu.addItem(item => item.setTitle(title).setIcon(icon).setDisabled(index < 0 || index + offset < 0 || index + offset >= order.length).onClick(() => {
        // Read the current catalog in case it changed while the menu was open.
        const current = getOrder();
        const from = current.indexOf(key);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= current.length) return;
        current.splice(from, 1);
        current.splice(to, 0, key);
        saveOrder(current);
      }));
    }
  }

  private showMenu(menu: Menu, anchor: HTMLButtonElement): void {
    menu.onHide(() => { this.orderMenu = undefined; if (anchor.isConnected) anchor.focus(); });
    const bounds = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, anchor.ownerDocument);
  }

  private orderedDocuments(project: string, documents = (this.plugin.catalog?.artifacts || []).filter(artifact => artifact.project === project)): Artifact[] {
    const alphabetical = [...documents].sort((a, b) => documentLabel(a).name.localeCompare(documentLabel(b).name) || a.route.localeCompare(b.route));
    const available = new Map(alphabetical.map(artifact => [artifact.route, artifact]));
    const order = this.documentOrder.get(project) || [];
    const saved = new Set(order);
    return [...order.flatMap(route => available.has(route) ? [available.get(route)!] : []), ...alphabetical.filter(artifact => !saved.has(artifact.route))];
  }

  private saveDocumentOrder(project: string, order: string[], focusRoute: string): void {
    if (order.length) this.documentOrder.set(project, order);
    else this.documentOrder.delete(project);
    this.app.workspace.requestSaveLayout();
    this.renderResults();
    Array.from(this.results.querySelectorAll<HTMLButtonElement>('.docshelf-item')).find(button => button.dataset.route === focusRoute)?.focus();
  }

  private makeDocumentSortable(button: HTMLButtonElement, { project, route }: Artifact): void {
    button.draggable = true;
    button.setAttribute('aria-description', 'Drag to reorder within this project. Press Shift+F10 for document actions.');
    button.addEventListener('dragstart', event => {
      if (!event.dataTransfer) { event.preventDefault(); return; }
      event.stopPropagation();
      this.draggedDocument = { project, route };
      event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, route);
      event.dataTransfer.effectAllowed = 'move';
      button.addClass('is-dragging');
    });
    button.addEventListener('dragend', () => this.endDrag());
    button.addEventListener('dragover', event => {
      if (!this.draggedDocument) return; // Let project drags reach the group.
      event.stopPropagation();
      this.clearDropMarker();
      if (this.draggedDocument.project !== project || !event.dataTransfer?.types.includes(DOCUMENT_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (this.draggedDocument.route === route) return;
      const bounds = button.getBoundingClientRect();
      button.addClass(event.clientY < bounds.top + bounds.height / 2 ? 'docshelf-drop-before' : 'docshelf-drop-after');
      this.dropMarker = button;
    });
    button.addEventListener('dragleave', event => {
      if (!this.draggedDocument) return;
      event.stopPropagation();
      if (!event.relatedTarget || !button.contains(event.relatedTarget as Node)) this.clearDropMarker();
    });
    button.addEventListener('drop', event => {
      const source = this.draggedDocument;
      if (!source) return;
      event.stopPropagation();
      if (source.project !== project || event.dataTransfer?.getData(DOCUMENT_DRAG_TYPE) !== source.route) return;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      this.endDrag();
      if (source.route === route) return;
      // Check the live project membership after any refresh during the drag.
      const order = this.orderedDocuments(project).map(artifact => artifact.route);
      if (!order.includes(source.route) || !order.includes(route)) return;
      order.splice(order.indexOf(source.route), 1);
      order.splice(order.indexOf(route) + (after ? 1 : 0), 0, source.route);
      this.saveDocumentOrder(project, order, source.route);
    });
  }

  private makeDocumentMenu(button: HTMLButtonElement, artifact: Artifact, searching: boolean): void {
    const showMenu = () => this.showDocumentMenu(artifact, button, searching);
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      showMenu();
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        event.stopPropagation();
        showMenu();
      }
    });
  }

  private clearDropMarker(): void {
    this.dropMarker?.removeClass('docshelf-drop-before', 'docshelf-drop-after');
    this.dropMarker = undefined;
  }

  private endDrag(): void {
    this.draggedProject = null;
    this.draggedDocument = null;
    this.clearDropMarker();
    this.results?.querySelector('.is-dragging')?.removeClass('is-dragging');
    if (this.renderAfterDrag) { this.renderAfterDrag = false; this.renderResults(); }
  }

  private renderItem(parent: HTMLElement, { artifact, excerpt }: SearchHit, searching: boolean): void {
    const kind = { markdown: 'Markdown', html: 'HTML', github: 'GitHub Markdown', claude: 'Claude artifact' }[artifact.kind];
    const icon = { markdown: 'file-text', html: 'file-code', github: 'github', claude: 'globe' }[artifact.kind];
    const label = documentLabel(artifact);
    const button = parent.createEl('button', { cls: 'docshelf-item', attr: { type: 'button', 'aria-label': label.name, 'aria-description': [label.title, kind, searching ? artifact.project : '', searching ? excerpt : ''].filter(Boolean).join('. ') } });
    button.toggleClass('docshelf-search-result', searching);
    button.dataset.route = artifact.route;
    setTooltip(button, [label.title, `${label.name} (${kind})`].filter(Boolean).join('\n'), { placement: 'right' });
    const heading = button.createDiv({ cls: 'docshelf-item-heading' });
    setIcon(heading.createSpan({ cls: 'docshelf-item-icon', attr: { 'aria-hidden': 'true' } }), icon);
    heading.createSpan({ text: label.name, cls: 'docshelf-item-title' });
    if (label.title) heading.createSpan({ text: label.title, cls: 'docshelf-item-subtitle' });
    if (searching) {
      if (excerpt) button.createSpan({ text: excerpt, cls: 'docshelf-item-description' });
      button.createSpan({ text: artifact.project, cls: 'docshelf-item-project' });
    } else this.makeDocumentSortable(button, artifact);
    this.makeDocumentMenu(button, artifact, searching);
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
