import { FileSystemAdapter, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { watch, type FSWatcher } from 'chokidar';
import { writeFile, stat } from 'node:fs/promises';
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

export default class DocShelfPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  catalog: Catalog | null = null;
  search = new ShelfSearch();
  server = new DocumentServer();
  ready: Promise<void> = Promise.resolve();
  error = '';
  loading = false;
  private watcher: FSWatcher | null = null;
  private watchedPaths = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private refreshTail: Promise<void> = Promise.resolve();
  private remoteCache = new Map<string, string>();
  private remoteRequests = new Map<string, Promise<string>>();
  private abort = new AbortController();
  private revisions = new Map<string, string>();

  async onload(): Promise<void> {
    const data = await this.loadData();
    this.settings = {
      shelfPath: typeof data?.shelfPath === 'string' ? data.shelfPath : DEFAULT_SETTINGS.shelfPath,
      workspaceRoot: typeof data?.workspaceRoot === 'string' ? data.workspaceRoot : '',
      runHtmlScripts: typeof data?.runHtmlScripts === 'boolean' ? data.runHtmlScripts : true,
      vaultId: typeof data?.vaultId === 'string' ? data.vaultId : '',
    };
    this.registerView(SHELF_VIEW, leaf => new ShelfView(leaf, this));
    this.registerView(DOCUMENT_VIEW, leaf => new DocumentView(leaf, this));
    this.addSettingTab(new ShelfSettingsTab(this));
    this.addRibbonIcon('library', 'Open DocShelf', () => { void this.openShelf(); });
    this.addCommand({ id: 'open-shelf', name: 'Open shelf', callback: () => { void this.openShelf(); } });
    this.addCommand({ id: 'search', name: 'Search documents', callback: () => new SearchModal(this).open() });
    this.addCommand({ id: 'reload', name: 'Reload shelf and documents', callback: () => { void this.refresh(); } });
    this.addCommand({ id: 'configure', name: 'Configure shelf', callback: () => this.showSettings() });
    this.addCommand({ id: 'copy-link', name: 'Copy document link', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(DocumentView);
      if (!view?.artifact) return false;
      if (!checking) void view.copyLink();
      return true;
    } });
    this.addCommand({ id: 'copy-reference', name: 'Copy source reference', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(DocumentView);
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
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshTail = this.refreshTail.catch(() => {}).then(() => this.refreshNow());
    return this.refreshTail;
  }

  private async refreshNow(): Promise<void> {
    if (this.disposed) return;
    this.loading = true;
    this.emit();
    const settings = this.settings;
    try {
      const catalog = await loadCatalog(this.shelfPath(), settings.workspaceRoot);
      if (this.disposed || settings !== this.settings) return;
      this.catalog = catalog;
      this.server.setCatalog(catalog, settings.runHtmlScripts);
      const contents = new Map<string, string>();
      const revisions = new Map<string, string>();
      const failures: string[] = [];
      let indexedBytes = 0;
      for (const artifact of catalog.artifacts) {
        if (this.disposed || settings !== this.settings) return;
        try {
          const source = artifact.sourcePath ? (await readBoundedFile(artifact.sourcePath, catalog.roots, MAX_DOCUMENT_BYTES)).toString('utf8') : this.remoteCache.get(artifact.source);
          const assets = await Promise.all((artifact.assets || []).map(async asset => {
            const info = await stat(path.resolve(path.dirname(artifact.sourcePath!), asset));
            return [asset, info.mtimeMs, info.size, info.ino];
          }));
          revisions.set(artifact.route, createHash('sha256').update(JSON.stringify([artifact, assets, settings.runHtmlScripts])).update(source || '').digest('hex'));
          if (source !== undefined && indexedBytes + source.length <= 16 * 1024 * 1024) {
            contents.set(artifact.id, source);
            indexedBytes += source.length;
          } else if (source !== undefined) failures.push('Search content limit reached; remaining documents are searchable by title.');
        } catch (error) { failures.push(`${artifact.title}: ${message(error)}`); }
      }
      if (this.disposed || settings !== this.settings) return;
      this.search.replace(catalog.artifacts, contents);
      this.revisions = revisions;
      this.error = failures[0] || '';
      await this.updateWatcher(catalog);
    } catch (error) {
      this.error = `${message(error)}${this.catalog ? ' Showing the last valid shelf.' : ''}`;
      if (!this.catalog) this.search.replace([], new Map());
      await this.updateWatcher(this.catalog);
    } finally {
      this.loading = false;
      if (!this.disposed) this.emit();
    }
  }

  private async updateWatcher(catalog: Catalog | null): Promise<void> {
    if (this.disposed) return;
    const paths = new Set([this.shelfPath()]);
    for (const artifact of catalog?.artifacts || []) {
      if (artifact.sourcePath) paths.add(artifact.sourcePath);
      if (artifact.canonicalPath) paths.add(artifact.canonicalPath);
      for (const asset of artifact.assets || []) paths.add(path.resolve(path.dirname(artifact.sourcePath!), asset));
    }
    if (!this.watcher) {
      this.watcher = watch([...paths], { ignoreInitial: true, followSymlinks: false, atomic: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
      this.watcher.on('all', () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, 200);
      });
      this.watcher.on('error', error => { this.error = `File watcher: ${message(error)}`; this.emit(); });
    } else {
      this.watcher.add([...paths].filter(file => !this.watchedPaths.has(file)));
      await this.watcher.unwatch([...this.watchedPaths].filter(file => !paths.has(file)));
    }
    this.watchedPaths = paths;
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
  documentRevision(route: string): string { return `${this.revisions.get(route) || ''}:${this.error}`; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }

  async openShelf(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(SHELF_VIEW)[0] || this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: SHELF_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openArtifact(artifact: Artifact, range: LineRange | null = null, hash = '', target?: WorkspaceLeaf): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DOCUMENT_VIEW).find(leaf => (leaf.view as DocumentView).artifact?.route === artifact.route);
    const leaf = target || existing || this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: DOCUMENT_VIEW, active: true, state: { route: artifact.route, mode: artifact.kind === 'html' && range ? 'source' : 'reading', lines: range ? `${range.start}-${range.end}` : undefined, hash } });
    await this.app.workspace.revealLeaf(leaf);
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
