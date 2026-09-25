import { ItemView, FuzzySuggestModal, Menu, setIcon, setTooltip, type FuzzyMatch, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { SearchHit } from '../core/search';
import type { Artifact } from '../core/types';
import { DOCSHELF_ICON } from './icon';
import { documentLabel } from '../core/catalog';
import type { DocumentTreeNode, FolderSegment } from '@docshelf/core/directories';
import { homedir } from 'node:os';
import path from 'node:path';

export const SHELF_VIEW = 'docshelf-shelf';
const PROJECT_DRAG_TYPE = 'application/x-docshelf-project';
const DOCUMENT_DRAG_TYPE = 'application/x-docshelf-document';
const FOLDER_DRAG_TYPE = 'application/x-docshelf-folder';
const ROOT_FOLDER = JSON.stringify([]);
const stringList = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [];
const orderMap = (value: unknown): Map<string, string[]> => new Map(value && typeof value === 'object' && !Array.isArray(value)
  ? Object.entries(value).map(([key, names]) => [key, stringList(names)]) : []);
type FolderNode = Extract<DocumentTreeNode<Artifact>, { type: 'folder' }>;
/** Keep the first folder's identity as its ordering key when single-folder rows merge or split. */
const childKey = (node: FolderNode): string => node.orderKey;
const siblingsKey = (project: string, parent: string): string => JSON.stringify([project, parent]);
const displayPath = (file: string): string => file.startsWith(homedir() + path.sep) ? `~${file.slice(homedir().length)}` : file;

export class ShelfView extends ItemView {
  private query = '';
  private collapsedProjects = new Set<string>();
  private collapsedFolders = new Set<string>();
  private projectOrder: string[] = [];
  private documentOrder = new Map<string, string[]>();
  private folderOrder = new Map<string, string[]>();
  private draggedProject: string | null = null;
  private draggedDocument: { project: string; folder: string; route: string } | null = null;
  private draggedFolder: { siblings: string; name: string; key: string } | null = null;
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
  getState(): Record<string, unknown> { return { collapsedProjects: [...this.collapsedProjects], collapsedFolders: [...this.collapsedFolders], projectOrder: this.projectOrder, documentOrder: Object.fromEntries(this.documentOrder), folderOrder: Object.fromEntries(this.folderOrder) }; }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    this.renderedResults = '';
    const state = value as { collapsedProjects?: unknown; collapsedFolders?: unknown; projectOrder?: unknown; documentOrder?: unknown; folderOrder?: unknown } | null;
    this.collapsedProjects = new Set(stringList(state?.collapsedProjects));
    this.collapsedFolders = new Set(stringList(state?.collapsedFolders));
    this.projectOrder = stringList(state?.projectOrder);
    this.documentOrder = orderMap(state?.documentOrder);
    this.folderOrder = orderMap(state?.folderOrder);
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
    if (this.draggedProject !== null || this.draggedDocument !== null || this.draggedFolder !== null) { this.renderAfterDrag = true; return; }
    const artifacts = this.plugin.catalog?.artifacts || [];
    const searching = !!this.query.trim();
    const hits = this.plugin.search.search(this.query);
    const folders = this.plugin.documentFolders();
    const searchStatus = searching ? (hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No matching documents.') : '';
    // Background refreshes must not shift the rows under a pointer or drag.
    this.status.setText(this.plugin.error || (this.plugin.loading && !this.plugin.catalog ? 'Loading documents…' : searchStatus));
    this.status.classList.toggle('docshelf-error', !!this.plugin.error);
    // Collapsing a project updates its existing DOM directly. Include order
    // here, while setState explicitly invalidates restored collapse state.
    const key = JSON.stringify([this.query, this.projectOrder, [...this.documentOrder], [...this.folderOrder], hits, artifacts.length, [...folders], this.plugin.catalog?.directories, this.plugin.shelfMissing && this.plugin.shelfPath()]);
    if (key === this.renderedResults) return;
    this.renderedResults = key;
    this.results.empty();
    if (!artifacts.length && !this.plugin.catalog?.directories?.length) { this.renderEmptyShelf(); return; }
    if (searching && !hits.length) { this.results.createEl('p', { text: 'Try a title, project, or phrase from the content.', cls: 'docshelf-empty' }); return; }
    if (searching) {
      for (const hit of hits) this.renderItem(this.results, hit, true, folders.get(hit.artifact.route) || []);
      return;
    }
    const groups = new Map<string, SearchHit[]>();
    const ordered = [...hits].sort((a, b) => a.artifact.project.localeCompare(b.artifact.project) || a.artifact.title.localeCompare(b.artifact.title));
    for (const hit of ordered) {
      const project = hit.artifact.project;
      if (!groups.has(project)) groups.set(project, []);
      groups.get(project)!.push(hit);
    }
    for (const directory of this.plugin.catalog?.directories || []) if (!groups.has(directory.project)) groups.set(directory.project, []);
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
      const ordered = this.orderedDocuments(project, documents.map(hit => hit.artifact));
      this.renderTree(items, project, this.plugin.projectTree(project, ordered), folders);
    }
  }

  private renderEmptyShelf(): void {
    const empty = this.results.createDiv({ cls: 'docshelf-empty-shelf' });
    empty.createEl('h3', { text: 'Your shelf is empty' });
    const add = empty.createEl('button', { cls: 'mod-cta', attr: { type: 'button' } });
    setIcon(add.createSpan({ cls: 'docshelf-button-icon', attr: { 'aria-hidden': 'true' } }), 'plus');
    add.createSpan({ text: 'Add files or folders' });
    add.onclick = () => this.plugin.showAdd();
    empty.createEl('button', { text: 'Use an existing shelf…', cls: 'docshelf-empty-link', attr: { type: 'button' } }).onclick = () => this.plugin.showSettings();
    if (this.plugin.shelfMissing) empty.createEl('p', { text: `Adding creates ${displayPath(this.plugin.shelfPath())}`, cls: 'docshelf-empty-note' });
  }

  private renderTree(parent: HTMLElement, project: string, nodes: DocumentTreeNode<Artifact>[], folders: Map<string, FolderSegment[]>, parentKey = ROOT_FOLDER): void {
    for (const node of this.orderedFolders(project, parentKey, nodes)) {
      const collapseKey = JSON.stringify([project, node.key]);
      const folder = parent.createDiv({ cls: 'docshelf-folder' });
      const toggle = folder.createEl('button', { cls: 'docshelf-folder-toggle', attr: { type: 'button', 'aria-expanded': String(!this.collapsedFolders.has(collapseKey)), 'aria-description': 'Drag to reorder folders. Press Shift+F10 for folder actions.' } });
      setIcon(toggle.createSpan({ cls: 'docshelf-project-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
      setIcon(toggle.createSpan({ cls: 'docshelf-item-icon', attr: { 'aria-hidden': 'true' } }), 'folder');
      toggle.createSpan({ text: node.name, cls: 'docshelf-folder-name' });
      if (node.registered && !node.count) toggle.createSpan({ text: 'No documents', cls: 'docshelf-folder-empty' });
      toggle.dataset.project = project;
      toggle.dataset.folder = node.key;
      setTooltip(toggle, node.name, { placement: 'right' });
      const items = folder.createDiv({ cls: 'docshelf-folder-items' });
      items.hidden = this.collapsedFolders.has(collapseKey);
      toggle.onclick = () => {
        items.hidden = !items.hidden;
        toggle.setAttribute('aria-expanded', String(!items.hidden));
        if (items.hidden) this.collapsedFolders.add(collapseKey);
        else this.collapsedFolders.delete(collapseKey);
        this.app.workspace.requestSaveLayout();
      };
      this.makeFolderSortable(folder, toggle, project, parentKey, node);
      const showMenu = () => this.showFolderMenu(project, parentKey, node, toggle);
      toggle.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); showMenu(); });
      toggle.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); showMenu(); }
      });
      this.renderTree(items, project, node.children, folders, node.key);
    }
    // Folders stay above the documents beside them.
    for (const node of nodes) if (node.type === 'document') this.renderItem(parent, { artifact: node.item, excerpt: '' }, false, folders.get(node.item.route) || []);
  }

  /** Folder rows under one parent: saved order first, then the rest alphabetically as the tree lists them. */
  private orderedFolders(project: string, parent: string, nodes: DocumentTreeNode<Artifact>[]): FolderNode[] {
    const folders = nodes.filter((node): node is FolderNode => node.type === 'folder');
    const order = this.folderOrder.get(siblingsKey(project, parent)) || [];
    const byKey = new Map(folders.map(node => [childKey(node), node]));
    const saved = new Set(order);
    return [...order.flatMap(name => byKey.has(name) ? [byKey.get(name)!] : []), ...folders.filter(node => !saved.has(childKey(node)))];
  }

  /** Stable ordering keys of the folder rows under one parent, read from the live catalog in display order. */
  private siblingFolders(project: string, parent: string): string[] {
    const key = parent;
    const find = (nodes: DocumentTreeNode<Artifact>[]): DocumentTreeNode<Artifact>[] | undefined => {
      for (const node of nodes) if (node.type === 'folder') {
        if (node.key === key) return node.children;
        const found = find(node.children);
        if (found) return found;
      }
    };
    const tree = this.plugin.projectTree(project, this.orderedDocuments(project));
    const children = parent === ROOT_FOLDER ? tree : find(tree);
    return children ? this.orderedFolders(project, parent, children).map(node => childKey(node)) : [];
  }

  private saveSiblingFolders(project: string, parent: string, order: string[], focusKey: string): void {
    const key = siblingsKey(project, parent);
    if (order.length) this.folderOrder.set(key, order);
    else this.folderOrder.delete(key);
    this.app.workspace.requestSaveLayout();
    this.renderResults();
    Array.from(this.results.querySelectorAll<HTMLButtonElement>('.docshelf-folder-toggle')).find(button => button.dataset.project === project && button.dataset.folder === focusKey)?.focus();
  }

  private showFolderMenu(project: string, parent: string, node: FolderNode, toggle: HTMLButtonElement): void {
    const menu = this.createMenu(project);
    this.addMoveActions(menu, childKey(node), () => this.siblingFolders(project, parent), order => this.saveSiblingFolders(project, parent, order, node.key));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from shelf…').setIcon('list-minus').onClick(() => this.plugin.showRemove({ project, folder: node.key, name: node.path.join('/') })));
    this.showMenu(menu, toggle);
  }

  private makeFolderSortable(folder: HTMLElement, toggle: HTMLButtonElement, project: string, parent: string, node: FolderNode): void {
    const siblings = siblingsKey(project, parent);
    const name = childKey(node);
    toggle.draggable = true;
    toggle.addEventListener('dragstart', event => {
      if (!event.dataTransfer) { event.preventDefault(); return; }
      event.stopPropagation();
      this.draggedFolder = { siblings, name, key: node.key };
      event.dataTransfer.setData(FOLDER_DRAG_TYPE, name);
      event.dataTransfer.effectAllowed = 'move';
      toggle.addClass('is-dragging');
    });
    toggle.addEventListener('dragend', () => this.endDrag());
    // Rows under another parent ignore the drag, so it reaches the sibling that contains them.
    folder.addEventListener('dragover', event => {
      if (this.draggedFolder?.siblings !== siblings || !event.dataTransfer?.types.includes(FOLDER_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      this.clearDropMarker();
      if (this.draggedFolder.name === name) return;
      const bounds = folder.getBoundingClientRect();
      folder.addClass(event.clientY < bounds.top + bounds.height / 2 ? 'docshelf-drop-before' : 'docshelf-drop-after');
      this.dropMarker = folder;
    });
    folder.addEventListener('dragleave', event => {
      if (this.draggedFolder?.siblings === siblings && (!event.relatedTarget || !folder.contains(event.relatedTarget as Node))) this.clearDropMarker();
    });
    folder.addEventListener('drop', event => {
      const source = this.draggedFolder;
      if (source?.siblings !== siblings || event.dataTransfer?.getData(FOLDER_DRAG_TYPE) !== source.name) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = folder.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      this.endDrag();
      if (source.name === name) return;
      // Check the live folder rows after any refresh during the drag.
      const order = this.siblingFolders(project, parent);
      if (!order.includes(source.name) || !order.includes(name)) return;
      order.splice(order.indexOf(source.name), 1);
      order.splice(order.indexOf(name) + (after ? 1 : 0), 0, source.name);
      this.saveSiblingFolders(project, parent, order, source.key);
    });
  }

  /** Documents directly inside one folder, in display order. */
  private folderDocuments(project: string, folder: string): string[] {
    const folders = this.plugin.documentFolders();
    return this.orderedDocuments(project).filter(artifact => (folders.get(artifact.route)?.at(-1)?.key || ROOT_FOLDER) === folder).map(artifact => artifact.route);
  }

  /** Reorder one folder's documents within the positions they already hold in the project order. */
  private saveFolderDocuments(project: string, folder: string, order: string[], focusRoute: string): void {
    const folders = this.plugin.documentFolders();
    const routes = this.orderedDocuments(project).map(artifact => artifact.route);
    const inFolder = (route: string) => (folders.get(route)?.at(-1)?.key || ROOT_FOLDER) === folder;
    if (routes.filter(inFolder).length !== order.length) return;
    const next = [...order];
    this.saveDocumentOrder(project, routes.map(route => inFolder(route) ? next.shift()! : route), focusRoute);
  }

  private orderedProjects(names: Iterable<string> = [...(this.plugin.catalog?.artifacts || []), ...(this.plugin.catalog?.directories || [])].map(entry => entry.project)): string[] {
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
    const folderOrders = [...this.folderOrder.keys()].filter(key => (JSON.parse(key) as string[])[0] === project);
    menu.addItem(item => item.setTitle('Reset to alphabetical').setIcon('list-restart').setDisabled(!this.documentOrder.get(project)?.length && !folderOrders.length).onClick(() => {
      this.documentOrder.delete(project);
      for (const key of folderOrders) this.folderOrder.delete(key);
      this.app.workspace.requestSaveLayout();
      this.renderResults();
      Array.from(this.results.querySelectorAll<HTMLButtonElement>('.docshelf-project-toggle')).find(button => button.dataset.project === project)?.focus();
    }));
    menu.addItem(item => item.setTitle('Reset project order').setIcon('list-restart').setDisabled(!this.projectOrder.length).onClick(() => this.saveProjectOrder([], project)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from shelf…').setIcon('list-minus').onClick(() => this.plugin.showRemove({ project })));
    this.showMenu(menu, toggle);
  }

  private showDocumentMenu(artifact: Artifact, button: HTMLButtonElement, searching: boolean, folder: string): void {
    const { project, route } = artifact;
    const menu = this.createMenu(project);
    if (!searching) this.addMoveActions(menu, route, () => this.folderDocuments(project, folder), order => this.saveFolderDocuments(project, folder, order, route));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from shelf…').setIcon('list-minus').onClick(() => this.plugin.showRemove({ artifact })));
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

  private makeDocumentSortable(button: HTMLButtonElement, { project, route }: Artifact, folder: string): void {
    button.draggable = true;
    button.setAttribute('aria-description', `Drag to reorder within this ${folder === ROOT_FOLDER ? 'project' : 'folder'}. Press Shift+F10 for document actions.`);
    button.addEventListener('dragstart', event => {
      if (!event.dataTransfer) { event.preventDefault(); return; }
      event.stopPropagation();
      this.draggedDocument = { project, folder, route };
      event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, route);
      event.dataTransfer.effectAllowed = 'move';
      button.addClass('is-dragging');
    });
    button.addEventListener('dragend', () => this.endDrag());
    button.addEventListener('dragover', event => {
      if (!this.draggedDocument) return; // Let project drags reach the group.
      event.stopPropagation();
      this.clearDropMarker();
      if (this.draggedDocument.project !== project || this.draggedDocument.folder !== folder || !event.dataTransfer?.types.includes(DOCUMENT_DRAG_TYPE)) return;
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
      if (source.project !== project || source.folder !== folder || event.dataTransfer?.getData(DOCUMENT_DRAG_TYPE) !== source.route) return;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      this.endDrag();
      if (source.route === route) return;
      // Check the live folder membership after any refresh during the drag.
      const order = this.folderDocuments(project, folder);
      if (!order.includes(source.route) || !order.includes(route)) return;
      order.splice(order.indexOf(source.route), 1);
      order.splice(order.indexOf(route) + (after ? 1 : 0), 0, source.route);
      this.saveFolderDocuments(project, folder, order, source.route);
    });
  }

  private makeDocumentMenu(button: HTMLButtonElement, artifact: Artifact, searching: boolean, folder: string): void {
    const showMenu = () => this.showDocumentMenu(artifact, button, searching, folder);
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
    this.draggedFolder = null;
    this.clearDropMarker();
    this.results?.querySelector('.is-dragging')?.removeClass('is-dragging');
    if (this.renderAfterDrag) { this.renderAfterDrag = false; this.renderResults(); }
  }

  private renderItem(parent: HTMLElement, { artifact, excerpt }: SearchHit, searching: boolean, folders: FolderSegment[]): void {
    const kind = { markdown: 'Markdown', html: 'HTML', github: 'GitHub Markdown', claude: 'Claude artifact' }[artifact.kind];
    const icon = { markdown: 'file-text', html: 'file-code', github: 'github', claude: 'globe' }[artifact.kind];
    const label = documentLabel(artifact);
    const folder = folders.at(-1)?.key || ROOT_FOLDER;
    const location = [artifact.project, ...folders.length ? [folders.map(folder => folder.name).join('/')] : []].join(' › ');
    const button = parent.createEl('button', { cls: 'docshelf-item', attr: { type: 'button', 'aria-label': label.name, 'aria-description': [label.title, kind, searching ? location : '', searching ? excerpt : ''].filter(Boolean).join('. ') } });
    button.toggleClass('docshelf-search-result', searching);
    button.dataset.route = artifact.route;
    setTooltip(button, [label.title, `${label.name} (${kind})`].filter(Boolean).join('\n'), { placement: 'right' });
    const heading = button.createDiv({ cls: 'docshelf-item-heading' });
    setIcon(heading.createSpan({ cls: 'docshelf-item-icon', attr: { 'aria-hidden': 'true' } }), icon);
    heading.createSpan({ text: label.name, cls: 'docshelf-item-title' });
    if (label.title) heading.createSpan({ text: label.title, cls: 'docshelf-item-subtitle' });
    if (searching) {
      if (excerpt) button.createSpan({ text: excerpt, cls: 'docshelf-item-description' });
      button.createSpan({ text: location, cls: 'docshelf-item-project' });
    } else this.makeDocumentSortable(button, artifact, folder);
    this.makeDocumentMenu(button, artifact, searching, folder);
    button.onclick = () => { void this.plugin.openArtifact(artifact); };
  }
}

export class SearchModal extends FuzzySuggestModal<SearchHit> {
  constructor(private plugin: DocShelfPlugin) { super(plugin.app); this.setPlaceholder('Search DocShelf…'); }
  getItems(): SearchHit[] { return this.plugin.search.search(''); }
  getItemText(hit: SearchHit): string { return `${hit.artifact.title} — ${hit.artifact.project}`; }
  getSuggestions(query: string): FuzzyMatch<SearchHit>[] { return this.plugin.search.search(query).map(item => ({ item, match: { score: 0, matches: [] } })); }
  renderSuggestion(value: FuzzyMatch<SearchHit>, el: HTMLElement): void {
    const hit = value.item;
    el.createDiv({ text: hit.artifact.title });
    el.createDiv({ text: [hit.artifact.project, hit.excerpt].filter(Boolean).join(' · '), cls: 'docshelf-muted' });
  }
  onChooseItem(hit: SearchHit): void { void this.plugin.openArtifact(hit.artifact); }
}
