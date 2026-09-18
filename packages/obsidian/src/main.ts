import { addIcon, FileSystemAdapter, Notice, Plugin, removeIcon, type WorkspaceLeaf } from 'obsidian';
import { watch, type FSWatcher } from 'chokidar';
import { writeFile, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadCatalog, findSource } from './core/catalog';
import { canonicalFile, readBoundedFile } from './core/files';
import { DocumentServer } from './core/server';
import { ShelfSearch } from './core/search';
import { fetchGitHubMarkdown } from './core/remote';
import { parseProtocol } from './core/protocol';
import { DEFAULT_SETTINGS, MAX_DOCUMENT_BYTES, message, type Artifact, type Catalog, type LineRange, type Settings } from './core/types';
import { DocumentView, DOCUMENT_VIEW } from './ui/document';
import { ShelfView, SHELF_VIEW, SearchModal } from './ui/shelf';
import { ConfigureModal, ShelfSettingsTab } from './ui/settings';
import { DOCSHELF_ICON, DOCSHELF_ICON_SVG } from './ui/icon';
import { NativeMarkdownView, NATIVE_MARKDOWN_VIEW, nativeMarkdownExtension } from './ui/native-markdown';
import { RecoveryStore } from './core/editing';
import { IndexSources } from './core/index-sources';

export default class DocShelfPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  catalog: Catalog | null = null;
  search = new ShelfSearch();
  server = new DocumentServer();
  ready: Promise<void> = Promise.resolve();
  error = '';
  loading = false;
  recovery!: RecoveryStore;
  private watcher: FSWatcher | null = null;
  private watchedPaths = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private refreshPending: Promise<void> | null = null;
  private refreshRequested = false;
  private indexSources = new IndexSources();
  private remoteCache = new Map<string, string>();
  private remoteRequests = new Map<string, Promise<string>>();
  private abort = new AbortController();
  private revisions = new Map<string, string>();

  async onload(): Promise<void> {
    addIcon(DOCSHELF_ICON, DOCSHELF_ICON_SVG);
    this.register(() => removeIcon(DOCSHELF_ICON));
    const data = await this.loadData();
    this.recovery = new RecoveryStore(path.join(this.basePath(), this.manifest.dir!, 'recovery'));
    this.settings = {
      shelfPath: typeof data?.shelfPath === 'string' ? data.shelfPath : DEFAULT_SETTINGS.shelfPath,
      workspaceRoot: typeof data?.workspaceRoot === 'string' ? data.workspaceRoot : '',
      runHtmlScripts: typeof data?.runHtmlScripts === 'boolean' ? data.runHtmlScripts : true,
      vaultId: typeof data?.vaultId === 'string' ? data.vaultId : '',
    };
    this.registerView(SHELF_VIEW, leaf => new ShelfView(leaf, this));
    this.registerView(DOCUMENT_VIEW, leaf => new DocumentView(leaf, this));
    this.registerView(NATIVE_MARKDOWN_VIEW, leaf => new NativeMarkdownView(leaf, this));
    this.registerEditorExtension(nativeMarkdownExtension);
    this.addSettingTab(new ShelfSettingsTab(this));
    this.addRibbonIcon(DOCSHELF_ICON, 'Open DocShelf', () => { void this.openShelf(); });
    this.addCommand({ id: 'open-shelf', name: 'Open shelf', callback: () => { void this.openShelf(); } });
    this.addCommand({ id: 'search', name: 'Search documents', callback: () => new SearchModal(this).open() });
    this.addCommand({ id: 'reload', name: 'Reload shelf and documents', callback: () => { void this.refresh(); } });
    this.addCommand({ id: 'configure', name: 'Configure shelf', callback: () => this.showSettings() });
    this.addCommand({ id: 'recovery', name: 'Reveal Markdown recovery files', callback: () => this.revealRecovery() });
    this.addCommand({ id: 'copy-link', name: 'Copy document link', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(NativeMarkdownView) || this.app.workspace.getActiveViewOfType(DocumentView);
      if (!view?.artifact) return false;
      if (!checking) void view.copyLink();
      return true;
    } });
    this.addCommand({ id: 'copy-reference', name: 'Copy source reference', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(NativeMarkdownView) || this.app.workspace.getActiveViewOfType(DocumentView);
      if (!view?.artifact) return false;
      if (!checking) void view.copyReference();
      return true;
    } });
    this.registerObsidianProtocolHandler('docshelf', params => {
      void (async () => {
        try {
          const { source, range } = parseProtocol(params);
          await this.ready;
          await this.refresh();
          const artifact = this.catalog && findSource(this.catalog, source);
          if (!artifact) throw new Error('This source is not registered in this vault’s DocShelf.');
          if (range && artifact.kind === 'claude') throw new Error('Claude Artifact pages do not expose source-line ranges.');
          await this.openArtifact(artifact, range);
        } catch (error) { new Notice(message(error)); }
      })();
    });
    this.ready = this.initialize();
    await this.ready;
  }

  private async initialize(): Promise<void> {
    try { await this.server.start(); await this.refresh(); }
    catch (error) { this.error = message(error); this.emit(); }
  }

  onunload(): void {
    this.disposed = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.watcher?.close();
    this.watcher = null;
    void this.server.close();
    this.listeners.clear();
    this.remoteCache.clear();
    this.remoteRequests.clear();
    this.indexSources.clear();
  }

  basePath(): string {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error('DocShelf requires a local desktop vault.');
    return this.app.vault.adapter.getBasePath();
  }
  shelfPath(): string { return path.resolve(this.basePath(), this.settings.shelfPath); }
  vaultIdentity(): string { return this.settings.vaultId || this.app.vault.getName(); }

  async configure(settings: Settings): Promise<void> {
    this.settings = settings;
    await this.saveData(settings);
    this.catalog = null;
    this.server.setCatalog(null);
    this.abort.abort();
    this.abort = new AbortController();
    this.remoteCache.clear();
    this.remoteRequests.clear();
    this.indexSources.clear();
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshRequested = true;
    if (!this.refreshPending) this.refreshPending = Promise.resolve().then(async () => {
      try {
        while (this.refreshRequested && !this.disposed) { this.refreshRequested = false; await this.refreshNow(); }
      } finally { this.refreshPending = null; }
    });
    return this.refreshPending;
  }

  scheduleRefresh(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 200);
  }

  private async refreshNow(): Promise<void> {
    if (this.disposed) return;
    this.loading = true;
    this.emit();
    const settings = this.settings;
    try {
      const catalog = await loadCatalog(this.shelfPath(), settings.workspaceRoot, { allowUnavailableFiles: true });
      if (this.disposed || settings !== this.settings) return;
      const contents = new Map<string, string>();
      const revisions = new Map<string, string>();
      const failures: string[] = [];
      let indexedBytes = 0;
      this.indexSources.retain(new Set(catalog.artifacts.flatMap(artifact => artifact.sourcePath ? [artifact.sourcePath] : [])));
      for (const artifact of catalog.artifacts) {
        if (this.disposed || settings !== this.settings) return;
        try {
          const budget = 16 * 1024 * 1024 - indexedBytes;
          const local = artifact.sourcePath ? await this.indexSources.read(artifact.sourcePath, catalog.roots, budget) : undefined;
          const source = local ? local.source : this.remoteCache.get(artifact.source);
          const contentRevision = local?.revision || createHash('sha256').update(source || '').digest('hex');
          const assets = await Promise.all((artifact.assets || []).map(async asset => {
            try {
              const assetPath = await canonicalFile(path.resolve(path.dirname(artifact.sourcePath!), asset), catalog.roots);
              const info = await stat(assetPath);
              return [asset, info.mtimeMs, info.size, info.ino];
            } catch (error) {
              const failure = message(error);
              failures.push(`${artifact.title}: ${failure}`);
              return [asset, failure];
            }
          }));
          revisions.set(artifact.route, createHash('sha256').update(JSON.stringify([artifact, assets, settings.runHtmlScripts, contentRevision])).digest('hex'));
          if (source !== undefined && indexedBytes + source.length <= 16 * 1024 * 1024) {
            contents.set(artifact.id, source);
            indexedBytes += source.length;
          } else if (source !== undefined || local) failures.push('Search content limit reached; remaining documents are searchable by title.');
        } catch (error) {
          const failure = message(error);
          failures.push(`${artifact.title}: ${failure}`);
          revisions.set(artifact.route, createHash('sha256').update(JSON.stringify([artifact, failure])).digest('hex'));
        }
      }
      if (this.disposed || settings !== this.settings) return;
      this.catalog = catalog;
      this.server.setCatalog(catalog, settings.runHtmlScripts);
      await this.search.replace(catalog.artifacts, contents, () => !this.disposed && settings === this.settings);
      if (this.disposed || settings !== this.settings) return;
      this.revisions = revisions;
      this.error = failures[0] || '';
      await this.updateWatcher(catalog);
    } catch (error) {
      this.error = `${message(error)}${this.catalog ? ' Showing the last valid shelf.' : ''}`;
      if (!this.catalog) await this.search.replace([], new Map());
      await this.updateWatcher(this.catalog);
    } finally {
      this.loading = false;
      if (!this.disposed) this.emit();
    }
  }

  private async updateWatcher(catalog: Catalog | null): Promise<void> {
    if (this.disposed) return;
    const sources = new Set([this.shelfPath()]);
    for (const artifact of catalog?.artifacts || []) {
      if (artifact.sourcePath) sources.add(artifact.sourcePath);
      if (artifact.canonicalPath) sources.add(artifact.canonicalPath);
      for (const asset of artifact.assets || []) sources.add(path.resolve(path.dirname(artifact.sourcePath!), asset));
    }
    // Parent aliases (notably macOS /var and /private/var) must share one watch.
    // Otherwise removing a missing canonical path can unwatch its surviving
    // lexical alias too, preventing detection when the source is recreated.
    // Preserve the final component so registered file symlinks stay watched.
    const paths = new Set(await Promise.all([...sources].map(async source => path.join(await realpath(path.dirname(source)).catch(() => path.dirname(source)), path.basename(source)))));
    if (this.disposed) return;
    if (this.watcher && paths.size === this.watchedPaths.size && [...paths].every(file => this.watchedPaths.has(file))) return;
    await this.watcher?.close();
    if (this.disposed) return;
    this.watchedPaths = paths;
    const parents = new Set([...paths].map(file => path.dirname(file)));
    // Observe each parent once, with an explicit file allowlist. Chokidar's
    // per-file recovery watches can compete for one directory's read throttle
    // after several different files have been deleted and restored.
    const watcher = watch([...parents], {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      ignored: file => !paths.has(file) && ![...parents].some(parent => parent === file || parent.startsWith(`${file}${path.sep}`)),
    });
    this.watcher = watcher;
    const schedule = () => {
      if (this.disposed || this.watcher !== watcher) return;
      this.scheduleRefresh();
    };
    watcher.on('all', schedule);
    // Re-read after startup too, covering writes during watcher replacement.
    watcher.once('ready', schedule);
    watcher.on('error', error => { this.error = `File watcher: ${message(error)}`; this.emit(); });
  }

  async readArtifact(artifact: Artifact): Promise<string> {
    if (this.disposed || !this.catalog?.artifacts.some(item => item.id === artifact.id && item.source === artifact.source)) throw new Error('This document is no longer registered.');
    if (artifact.sourcePath) return (await readBoundedFile(artifact.sourcePath, this.catalog.roots, MAX_DOCUMENT_BYTES)).toString('utf8');
    if (artifact.kind !== 'github' || !artifact.rawUrl) throw new Error('This remote source cannot be downloaded.');
    const cached = this.remoteCache.get(artifact.source);
    if (cached !== undefined) return cached;
    let request = this.remoteRequests.get(artifact.source);
    if (!request) {
      const signal = this.abort.signal;
      request = fetchGitHubMarkdown(artifact.rawUrl, signal).then(source => {
        if (!this.disposed && !signal.aborted) this.remoteCache.set(artifact.source, source);
        return source;
      }).finally(() => { if (this.remoteRequests.get(artifact.source) === request) this.remoteRequests.delete(artifact.source); });
      this.remoteRequests.set(artifact.source, request);
    }
    const result = await request;
    if (!this.disposed) void this.refresh();
    return result;
  }

  invalidate(artifact: Artifact): void { this.remoteCache.delete(artifact.source); }
  documentRevision(route: string): string { return this.revisions.get(route) || ''; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }

  async openShelf(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SHELF_VIEW)[0];
    const leaf = existing || this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: SHELF_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openArtifact(artifact: Artifact, range: LineRange | null = null, hash = '', target?: WorkspaceLeaf): Promise<void> {
    const native = artifact.kind === 'markdown';
    const type = native ? NATIVE_MARKDOWN_VIEW : DOCUMENT_VIEW;
    const existing = this.app.workspace.getLeavesOfType(type).find(leaf => {
      const open = (leaf.view as DocumentView | NativeMarkdownView).artifact;
      return open?.route === artifact.route && (!native || open.sourcePath === artifact.sourcePath);
    });
    const leaf = target || existing || this.app.workspace.getLeaf('tab');
    const previous = existing === leaf ? leaf.view.getState() : {};
    // A shelf activation preserves the mode. Explicit source/heading links
    // still reveal their requested location in the native editor.
    const mode = native
      ? (range || hash ? 'source' : previous.mode || 'source')
      : (artifact.kind === 'html' && range ? 'source' : 'reading');
    await leaf.setViewState({ type, active: true, state: { ...previous, route: artifact.route, mode, lines: range ? `${range.start}-${range.end}` : undefined, hash } });
    await this.app.workspace.revealLeaf(leaf);
  }

  nativeViews(): NativeMarkdownView[] { return this.app.workspace.getLeavesOfType(NATIVE_MARKDOWN_VIEW).map(leaf => leaf.view).filter((view): view is NativeMarkdownView => view instanceof NativeMarkdownView); }

  revealRecovery(): void {
    const { shell } = require('electron') as { shell: { showItemInFolder(path: string): void } };
    shell.showItemInFolder(this.recovery.directory);
  }

  showSettings(): void { new ConfigureModal(this).open(); }

  async createShelf(): Promise<void> {
    try {
      await writeFile(this.shelfPath(), `${JSON.stringify({ version: 1, artifacts: [] }, null, 2)}\n`, { flag: 'wx' });
      await this.refresh();
      new Notice('Empty shelf created. Add registrations to the JSON file, then reload.');
      const { shell } = require('electron') as { shell: { showItemInFolder(path: string): void } };
      shell.showItemInFolder(this.shelfPath());
    } catch (error) { new Notice(message(error)); }
  }

  async revealArtifact(artifact: Artifact): Promise<void> {
    if (!artifact.sourcePath || !this.catalog) return;
    try {
      const file = await canonicalFile(artifact.sourcePath, this.catalog.roots);
      const { shell } = require('electron') as { shell: { showItemInFolder(path: string): void } };
      shell.showItemInFolder(file);
    } catch (error) { new Notice(message(error)); }
  }

  openExternal(value: string): void {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported external link.');
      const { shell } = require('electron') as { shell: { openExternal(url: string): Promise<void> } };
      void shell.openExternal(url.href).catch(() => new Notice('Could not open the external link.'));
    } catch { new Notice('Unsupported external link.'); }
  }
}
