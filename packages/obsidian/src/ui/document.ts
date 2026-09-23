import { ItemView, Notice, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type DocShelfPlugin from '../main';
import type { Artifact, LineRange } from '../core/types';
import { message } from '../core/types';
import { parseLineFragment } from '@docshelf/core/line-permalinks';
import { checkRange, createAgentReference, createPermalink, parseRange } from '../core/protocol';
import { sourceLines } from '../core/markdown';
import { LineSelection } from './lines';
import { renderReading } from './render';
import { session } from '@electron/remote';

export const DOCUMENT_VIEW = 'docshelf-document';
interface DocumentState extends Record<string, unknown> { route?: string; mode?: 'reading' | 'source'; lines?: string; hash?: string }
interface Webview extends HTMLElement { src: string; getURL(): string; reload(): void; executeJavaScript(script: string): Promise<unknown> }

export class DocumentView extends ItemView {
  artifact: Artifact | null = null;
  range: LineRange | null = null;
  private mode: 'reading' | 'source' = 'reading';
  private source = '';
  private body!: HTMLElement;
  private status!: HTMLElement;
  private unsubscribe?: () => void;
  private generation = 0;
  private closed = false;
  private route = '';
  private page = 0;
  private hash = '';
  private lastRevision = '';
  private releaseReportNavigation?: () => void;
  private localReportIdentity = '';
  private localPartition = `docshelf-local-${randomBytes(16).toString('hex')}`;
  private remotePartition = `docshelf-remote-${randomBytes(16).toString('hex')}`;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) { super(leaf); }
  getViewType(): string { return DOCUMENT_VIEW; }
  getDisplayText(): string { return this.artifact?.title || 'DocShelf document'; }
  getIcon(): string { return 'file-text'; }
  getState(): DocumentState { return { route: this.route, mode: this.mode, lines: this.range ? `${this.range.start}-${this.range.end}` : undefined, hash: this.hash || undefined }; }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = (value || {}) as DocumentState;
    this.route = typeof state.route === 'string' ? state.route : '';
    this.mode = state.mode === 'source' ? 'source' : 'reading';
    this.hash = typeof state.hash === 'string' ? state.hash : '';
    try { this.range = parseRange(state.lines); } catch { this.range = null; }
    await this.loadDocument();
    await super.setState(value, result);
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.addClass('docshelf-document');
    this.unsubscribe = this.plugin.subscribe(() => {
      if (!this.plugin.loading && this.lastRevision !== this.plugin.documentRevision(this.route)) void this.loadDocument();
    });
  }
  async onClose(): Promise<void> { this.closed = true; this.generation++; this.unsubscribe?.(); this.clearContent(); }

  private clearContent(): void {
    this.contentEl.empty();
    this.releaseReportNavigation?.();
    this.releaseReportNavigation = undefined;
  }

  async loadDocument(): Promise<void> {
    const generation = ++this.generation;
    await this.plugin.ready;
    if (this.closed || generation !== this.generation) return;
    const revision = this.plugin.documentRevision(this.route);
    this.artifact = this.plugin.catalog?.artifacts.find(item => item.route === this.route) || null;
    const identity = this.artifact?.kind === 'html'
      ? JSON.stringify([this.artifact.route, this.artifact.sourcePath, this.artifact.canonicalPath]) : '';
    if (identity !== this.localReportIdentity) {
      // Reloads retain this report's state; navigating this leaf to another
      // source must not give it the previous report's storage or capabilities.
      this.localReportIdentity = identity;
      this.localPartition = `docshelf-local-${randomBytes(16).toString('hex')}`;
    }
    if (!this.artifact) {
      this.lastRevision = revision;
      this.clearContent();
      this.contentEl.createEl('p', { text: 'This document is no longer registered. Open DocShelf to choose another document.', cls: 'docshelf-empty' });
      return;
    }
    // Migrate existing workspace tabs from the old local Markdown reader.
    if (this.artifact.kind === 'markdown') {
      const artifact = this.artifact;
      // Finish the host's current setViewState before replacing this view.
      // Re-entering it here lets the outer transition overwrite the new view.
      this.contentEl.win.setTimeout(() => {
        if (!this.closed && generation === this.generation && this.leaf.view === this) void this.plugin.openArtifact(artifact, this.range, this.hash, this.leaf);
      }, 0);
      return;
    }
    try {
      this.source = this.artifact.kind === 'claude' ? '' : await this.plugin.readArtifact(this.artifact);
      if (this.closed || generation !== this.generation) return;
      this.render();
      this.lastRevision = revision;
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.lastRevision = revision;
      this.clearContent();
      this.contentEl.createEl('h2', { text: this.artifact.title });
      this.contentEl.createEl('p', { text: message(error), cls: 'docshelf-error', attr: { role: 'alert' } });
      this.contentEl.createEl('button', { text: 'Try again' }).onclick = () => { void this.loadDocument(); };
    }
  }

  private render(): void {
    if (!this.artifact) return;
    const artifact = this.artifact;
    const lines = sourceLines(this.source);
    if ((this.range && artifact.kind === 'html') || lines.length > 20_000) this.mode = 'source';
    this.clearContent();
    const header = this.contentEl.createDiv({ cls: 'docshelf-document-header' });
    header.createDiv({ text: artifact.project, cls: 'docshelf-eyebrow' });
    header.createEl('h1', { text: artifact.title });
    const sourceLabel = header.createDiv({ text: artifact.sourcePath || artifact.source, cls: 'docshelf-source-path' });
    sourceLabel.title = artifact.sourcePath || artifact.source;
    const toolbar = header.createDiv({ cls: 'docshelf-toolbar' });
    if (artifact.kind !== 'claude') {
      for (const mode of ['reading', 'source'] as const) {
        const button = toolbar.createEl('button', { text: mode === 'reading' ? (artifact.kind === 'html' ? 'Report' : 'Reading') : 'Source', attr: { 'aria-pressed': String(this.mode === mode), type: 'button' } });
        button.onclick = () => { this.mode = mode; if (mode === 'reading' && artifact.kind === 'html') this.range = null; this.page = this.range ? Math.floor((this.range.start - 1) / 400) : 0; this.render(); this.saveState(); };
      }
    }
    toolbar.createEl('button', { text: 'Copy link' }).onclick = () => { void this.copyLink(); };
    toolbar.createEl('button', { text: 'Copy reference' }).onclick = () => { void this.copyReference(); };
    if (artifact.sourcePath) toolbar.createEl('button', { text: 'Reveal source' }).onclick = () => { void this.plugin.revealArtifact(artifact); };
    toolbar.createEl('button', { text: 'Reload' }).onclick = () => { this.plugin.invalidate(artifact); void this.loadDocument(); };
    this.status = header.createDiv({ cls: 'docshelf-selection-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.body = this.contentEl.createDiv({ cls: 'docshelf-document-body' });
    if (artifact.kind === 'claude') { this.renderWebview(artifact.source, true); this.status.setText('Published Claude Artifact · requires a network connection'); return; }
    let rangeError = '';
    try { checkRange(this.range, lines.length); } catch (error) { rangeError = message(error); this.range = null; }
    if (this.mode === 'reading' && artifact.kind === 'html') {
      const url = new URL(this.plugin.server.documentUrl(artifact));
      url.hash = this.hash;
      this.renderWebview(url.href, false);
      this.status.setText(this.plugin.settings.runHtmlScripts ? 'Interactive report' : 'Report scripts are disabled');
    } else {
      const selection = new LineSelection(this.range, range => { this.range = range; this.updateRangeStatus(); this.saveState(); });
      if (this.mode === 'source' || lines.length > 20_000) this.renderSource(lines, selection);
      else renderReading(this.body, this.source, artifact, this.plugin.server, selection, href => { void this.navigate(href); });
      this.updateRangeStatus();
      this.contentEl.win.requestAnimationFrame(() => {
        if (this.closed) return;
        selection.scrollToSelection();
        if (this.hash && !this.range) this.scrollToHash(this.hash);
      });
    }
    if (rangeError) { this.status.setText(rangeError); this.status.addClass('docshelf-error'); }
  }

  private renderSource(lines: string[], selection: LineSelection): void {
    if (this.range && (this.range.start < this.page * 400 + 1 || this.range.start > (this.page + 1) * 400)) this.page = Math.floor((this.range.start - 1) / 400);
    this.page = Math.min(this.page, Math.max(0, Math.ceil(lines.length / 400) - 1));
    if (lines.length > 400) {
      const pager = this.body.createDiv({ cls: 'docshelf-source-pager docshelf-toolbar' });
      const previous = pager.createEl('button', { text: 'Previous lines' });
      previous.disabled = this.page === 0;
      previous.onclick = () => { this.page--; this.range = null; this.render(); };
      pager.createSpan({ text: `${this.page * 400 + 1}–${Math.min((this.page + 1) * 400, lines.length)} of ${lines.length}` });
      const next = pager.createEl('button', { text: 'Next lines' });
      next.disabled = (this.page + 1) * 400 >= lines.length;
      next.onclick = () => { this.page++; this.range = null; this.render(); };
    }
    const source = this.body.createDiv({ cls: 'docshelf-source-view' });
    for (let index = this.page * 400; index < Math.min((this.page + 1) * 400, lines.length); index++) {
      const row = source.createDiv({ cls: 'docshelf-source-row' });
      selection.addButton(row, index + 1);
      row.createEl('code', { text: lines[index] || ' ' });
    }
    if (!lines.length) source.createEl('p', { text: 'This document is empty.' });
  }

  private renderWebview(url: string, remote: boolean): void {
    // Obsidian's createEl typings do not include Electron's custom webview element.
    // eslint-disable-next-line obsidianmd/prefer-create-el -- Create the isolated guest in this view's own document.
    const webview = this.body.ownerDocument.createElement('webview') as Webview;
    webview.addClass('docshelf-webview');
    webview.setAttribute('partition', remote ? this.remotePartition : this.localPartition);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no,webSecurity=yes');
    webview.setAttribute('src', url);
    webview.setAttribute('aria-label', this.artifact?.title || 'Document');
    if (!remote) {
      // DOM webview will-navigate events cannot cancel navigation. Guard this
      // view's private session before attaching the guest, using the async
      // request callback (also safe across Electron's remote bridge).
      const requests = session.fromPartition(this.localPartition).webRequest;
      const document = new URL(url);
      const filter = { urls: ['<all_urls>'] };
      requests.onBeforeRequest(filter, (details, callback) => {
        if (this.closed || !webview.isConnected) { callback({ cancel: true }); return; }
        if (details.resourceType !== 'mainFrame') { callback({ cancel: details.resourceType === 'subFrame' }); return; }
        let destination: URL;
        try { destination = new URL(details.url); } catch { callback({ cancel: true }); return; }
        if (destination.origin === document.origin && destination.pathname === document.pathname && !destination.username && !destination.password) {
          callback({}); return;
        }
        callback({ cancel: true });
        const target = this.plugin.server.navigationTarget(details.url);
        if (target) {
          void this.plugin.openArtifact(target.artifact, parseLineFragment(target.hash), target.hash, this.leaf).catch(error => new Notice(message(error)));
        } else if (destination.origin !== document.origin && ['http:', 'https:'].includes(destination.protocol)) {
          this.plugin.openExternal(destination.href);
        }
      });
      this.releaseReportNavigation = () => requests.onBeforeRequest(filter, null);
    }
    webview.addEventListener('did-fail-load', (event: Event) => {
      const failure = event as Event & { errorCode: number; isMainFrame: boolean };
      if (failure.errorCode === -3 || failure.isMainFrame === false || !remote && failure.errorCode === -20) return;
      this.status.setText(remote ? 'The published artifact could not load. Check the network connection and source URL.' : 'The HTML viewer could not load this document. Reload to try again.');
      this.status.addClass('docshelf-error');
    });
    this.body.appendChild(webview);
  }

  private updateRangeStatus(): void {
    this.status.setText(this.range ? `Source lines ${this.range.start}${this.range.end === this.range.start ? '' : `–${this.range.end}`} selected · Shift-click to extend` : 'Click a source line number to select a passage. Shift-click to extend.');
  }
  private saveState(): void { this.app.workspace.requestSaveLayout(); }

  async copyLink(): Promise<void> {
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createPermalink(this.plugin.vaultIdentity(), this.artifact, this.range)); new Notice('DocShelf link copied.'); }
    catch { new Notice('Could not access the clipboard.'); }
  }
  async copyReference(): Promise<void> {
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createAgentReference(this.artifact, this.range)); new Notice('Source reference copied.'); }
    catch { new Notice('Could not access the clipboard.'); }
  }

  private scrollToHash(hash: string): void {
    try {
      const id = decodeURIComponent(hash.slice(1));
      this.body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
    } catch { /* Invalid fragments do not navigate. */ }
  }

  private async navigate(href: string): Promise<void> {
    if (!this.artifact || !href) return;
    if (href.startsWith('#')) {
      const range = parseLineFragment(href);
      if (range) { this.range = range; this.render(); this.saveState(); } else this.scrollToHash(href);
      return;
    }
    if (/^https?:\/\//i.test(href)) { this.plugin.openExternal(href); return; }
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) { new Notice('This link type is not supported.'); return; }
    if (this.artifact.kind === 'github') {
      try { this.plugin.openExternal(new URL(href, this.artifact.linkBaseUrl).href); } catch { new Notice('Invalid link.'); }
      return;
    }
    try {
      const [beforeHash, fragment = ''] = href.split('#');
      const candidate = path.resolve(path.dirname(this.artifact.sourcePath!), decodeURIComponent(beforeHash.split('?')[0]));
      const target = this.plugin.catalog?.artifacts.find(item => item.sourcePath === candidate || item.canonicalPath === candidate);
      if (!target) { new Notice('Register this document in the shelf to open it here.'); return; }
      const hash = fragment ? `#${fragment}` : '';
      await this.plugin.openArtifact(target, parseLineFragment(hash), hash, this.leaf);
    } catch { new Notice('Could not resolve this document link.'); }
  }
}
