import { ItemView, Menu, Notice, setIcon, setTooltip, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type DocShelfPlugin from '../main';
import type { Artifact, LineRange } from '../core/types';
import { message } from '../core/types';
import { parseLineFragment } from '@docshelf/core/line-permalinks';
import { checkRange, createAgentReference, createPermalink, parseRange } from '../core/protocol';
import { sourceLines } from '../core/markdown';
import { SOURCE_LINES_ATTRIBUTE } from '../core/server';
import { LineSelection } from './lines';
import { renderReading } from './render';
import { webFrame } from 'electron';
import { session, webContents } from '@electron/remote';

export const DOCUMENT_VIEW = 'docshelf-document';
interface DocumentState extends Record<string, unknown> { route?: string; mode?: 'reading' | 'source'; lines?: string; hash?: string }
interface Webview extends HTMLElement { src: string; getURL(): string; reload(): void; executeJavaScript(script: string): Promise<unknown>; getWebContentsId(): number }

type ReportGuest = NonNullable<ReturnType<typeof webContents.fromId>>;
interface ReportReference { range: LineRange; spans: string[] }

declare global {
  interface HTMLElementTagNameMap { webview: Webview }
}

export class DocumentView extends ItemView {
  artifact: Artifact | null = null;
  range: LineRange | null = null;
  private mode: 'reading' | 'source' = 'reading';
  private source = '';
  private body!: HTMLElement;
  private status!: HTMLElement;
  private modeAction?: HTMLElement;
  private revealAction?: HTMLElement;
  private referenceMenu: Menu | null = null;
  // A local report's text selection, which the header copy actions cite.
  private reportWebview: Webview | null = null;
  private reportSelection: ReportReference | null = null;
  private selectionCheck: Promise<void> | null = null;
  private selectionPending = false;
  private selectionToken = `docshelf-selection-${randomBytes(16).toString('hex')}`;
  private highlightKey = '';
  private highlightGeneration = 0;
  private endReportDrag: (() => void) | null = null;
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
    // Match the native Markdown view's actions and order so shared actions keep
    // their header positions across document types; later ones sit further left.
    this.addAction('settings', 'Configure DocShelf', () => this.plugin.showSettings());
    this.addAction('link', 'Copy DocShelf link', () => { void this.copyLink(); });
    this.addAction('quote', 'Copy source reference', () => { void this.copyReference(); });
    this.revealAction = this.addAction('folder-open', 'Reveal source', () => { if (this.artifact) void this.plugin.revealArtifact(this.artifact); });
    this.modeAction = this.addAction('code-2', 'Switch to source view', () => this.setMode(this.mode === 'source' ? 'reading' : 'source'));
    this.addAction('refresh-cw', 'Reload', () => { if (this.artifact) this.plugin.invalidate(this.artifact); void this.loadDocument(); });
    this.updateActions(false);
    this.unsubscribe = this.plugin.subscribe(() => {
      if (!this.plugin.loading && this.lastRevision !== this.plugin.documentRevision(this.route)) void this.loadDocument();
    });
  }
  async onClose(): Promise<void> { this.closed = true; this.generation++; this.unsubscribe?.(); this.clearContent(); }

  private clearContent(): void {
    this.endReportDrag?.();
    this.reportWebview = null;
    this.reportSelection = null;
    this.highlightKey = '';
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
    // The host titles an ItemView once, before this asynchronous state names
    // the document. Refresh both titles as its FileView does after a load.
    (this as this & { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
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
      this.updateActions(false);
      this.contentEl.createDiv({ cls: 'docshelf-document-notice' }).createEl('p', { text: 'This document is no longer registered. Open DocShelf to choose another document.', cls: 'docshelf-empty' });
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
      this.updateActions(false);
      const notice = this.contentEl.createDiv({ cls: 'docshelf-document-notice' });
      notice.createEl('h2', { text: this.artifact.title });
      notice.createEl('p', { text: message(error), cls: 'docshelf-error', attr: { role: 'alert' } });
      notice.createEl('button', { text: 'Try again' }).onclick = () => { void this.loadDocument(); };
    }
  }

  private render(): void {
    if (!this.artifact) return;
    const artifact = this.artifact;
    const lines = sourceLines(this.source);
    if ((this.range && artifact.kind === 'html') || lines.length > 20_000) this.mode = 'source';
    this.clearContent();
    this.updateActions(true);
    this.body = this.contentEl.createDiv({ cls: 'docshelf-document-body' });
    this.status = this.contentEl.createDiv({ cls: 'docshelf-editor-status', attr: { role: 'status', 'aria-live': 'polite' } });
    if (artifact.kind === 'claude') { this.renderWebview(artifact.source, true); return; }
    let rangeError = '';
    try { checkRange(this.range, lines.length); } catch (error) { rangeError = message(error); this.range = null; }
    if (this.mode === 'reading' && artifact.kind === 'html') {
      const url = new URL(this.plugin.server.documentUrl(artifact));
      url.hash = this.hash;
      this.renderWebview(url.href, false);
      this.showRangeStatus(null);
    } else {
      const selection = new LineSelection(this.range, range => { this.range = range; this.updateRangeStatus(selection); this.saveState(); });
      if (this.mode === 'source' || lines.length > 20_000) this.renderSource(lines, selection);
      else renderReading(this.body, this.source, artifact, this.plugin.server, selection, href => { void this.navigate(href); });
      this.updateRangeStatus(selection);
      this.contentEl.win.requestAnimationFrame(() => {
        if (this.closed) return;
        selection.scrollToSelection();
        if (this.hash && !this.range) this.scrollToHash(this.hash);
      });
    }
    if (rangeError) this.showProblem(rangeError);
  }

  private setMode(mode: 'reading' | 'source'): void {
    if (!this.artifact) return;
    this.mode = mode;
    if (mode === 'reading' && this.artifact.kind === 'html') this.range = null;
    if (mode === 'source' && this.reportSelection) this.range = this.reportSelection.range;
    this.page = this.range ? Math.floor((this.range.start - 1) / 400) : 0;
    this.render();
    this.saveState();
  }

  private updateActions(rendered: boolean): void {
    this.revealAction?.toggle(!!this.artifact?.sourcePath);
    if (!this.modeAction) return;
    this.modeAction.toggle(rendered && this.artifact?.kind !== 'claude');
    const source = this.mode === 'source';
    setIcon(this.modeAction, source ? 'book-open' : 'code-2');
    setTooltip(this.modeAction, !source ? 'Switch to source view' : this.artifact?.kind === 'html' ? 'Switch to report view' : 'Switch to reading view');
  }

  private showProblem(text: string): void {
    this.status.setText(text);
    this.status.addClass('docshelf-editor-problem');
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
    // Keep the guest detached in this view's document until its guards are ready.
    const webview = this.body.ownerDocument.adoptNode(createEl('webview'));
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
    if (!remote) {
      this.reportWebview = webview;
      // Selection changes inside the report log this view's token from the
      // isolated world; report scripts can neither see nor forge it.
      webview.addEventListener('dom-ready', () => {
        const guest = reportGuest(webview);
        if (!guest) return;
        // Obsidian's own menu for right-clicks in webviews would open beside the
        // reference menu. Obsidian's Web viewer opts out the same way.
        try { guest.noContextMenu = true; } catch { return; }
        void inReport(guest, reportWatchScript(this.selectionToken)).catch(() => null);
      });
      webview.addEventListener('console-message', (event: Event) => {
        const { message } = event as Event & { message: string };
        if (message === this.selectionToken) void this.checkSelection(webview);
        else if (message === `${this.selectionToken}:down`) this.startReportDrag(webview);
        else if (message === `${this.selectionToken}:up`) this.endReportDrag?.();
      });
      // Electron reports right-clicks inside the report. One that reaches this
      // element instead, before a new report accepts input, opens the same menu.
      webview.addEventListener('context-menu', (event: Event) => {
        // Electron reports window coordinates unscaled by Obsidian's zoom.
        const { x, y } = (event as Event & { params: { x: number; y: number } }).params;
        const zoom = webFrame.getZoomFactor();
        void this.showReportMenu(webview, x / zoom, y / zoom);
      });
      webview.addEventListener('contextmenu', event => { event.preventDefault(); void this.showReportMenu(webview, event.clientX, event.clientY); });
    }
    webview.addEventListener('did-fail-load', (event: Event) => {
      const failure = event as Event & { errorCode: number; isMainFrame: boolean };
      if (failure.errorCode === -3 || failure.isMainFrame === false || !remote && failure.errorCode === -20) return;
      this.showProblem(remote ? 'The published artifact could not load. Check the network connection and source URL.' : 'The HTML viewer could not load this document. Reload to try again.');
    });
    this.body.appendChild(webview);
  }

  // A drag that starts in the report loses the pointer when it leaves the
  // report. Until the button is released, keep the rest of the window from
  // reacting to it, and hand a release outside back to the report, which would
  // otherwise keep selecting as the pointer moves.
  private startReportDrag(webview: Webview): void {
    this.endReportDrag?.();
    const doc = webview.ownerDocument;
    const win = doc.defaultView;
    if (!win || webview !== this.reportWebview) return;
    const release = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const bounds = webview.getBoundingClientRect();
      const zoom = webFrame.getZoomFactor();
      try { reportGuest(webview)?.sendInputEvent({ type: 'mouseUp', x: Math.round((event.clientX - bounds.left) * zoom), y: Math.round((event.clientY - bounds.top) * zoom), button: 'left', clickCount: 1 }); } catch { /* The report closed. */ }
      end();
    };
    // A move without the button means the release happened elsewhere.
    const move = (event: MouseEvent) => { if (!(event.buttons & 1)) end(); };
    const end = () => {
      doc.body.removeClass('docshelf-report-dragging');
      win.removeEventListener('mouseup', release, true);
      win.removeEventListener('mousemove', move, true);
      win.removeEventListener('blur', end);
      if (this.endReportDrag === end) this.endReportDrag = null;
    };
    doc.body.addClass('docshelf-report-dragging');
    win.addEventListener('mouseup', release, true);
    win.addEventListener('mousemove', move, true);
    win.addEventListener('blur', end);
    this.endReportDrag = end;
  }

  // Opens the reference menu for a point in this document's CSS pixels.
  private async showReportMenu(webview: Webview, x: number, y: number): Promise<void> {
    const artifact = this.artifact;
    if (!artifact || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const bounds = webview.getBoundingClientRect();
    let found: { text?: unknown; reference?: unknown } | null = null;
    try {
      const guest = reportGuest(webview);
      if (guest) {
        const scale = webFrame.getZoomFactor() / guest.getZoomFactor();
        found = await inReport(guest, reportPointScript(Math.round((x - bounds.left) * scale), Math.round((y - bounds.top) * scale))) as { text?: unknown; reference?: unknown } | null;
      }
    } catch { /* Cite the whole report. */ }
    if (this.closed || !webview.isConnected || artifact !== this.artifact) return;
    const reference = this.readReference(found?.reference);
    const range = reference?.range || null;
    // Right-clicks inside the report never reach an open menu's close handler.
    this.referenceMenu?.hide();
    this.showRangeStatus(range);
    void this.highlightReport(webview, reference?.spans || []);
    // Clicks and keys inside the report never reach the host, so cover and focus
    // it while the menu is open: the menu closes on a click there or on Escape,
    // and a right-click moves it.
    const layer = this.body.createDiv({ cls: 'docshelf-report-layer', attr: { tabindex: '-1' } });
    layer.addEventListener('contextmenu', event => { event.preventDefault(); void this.showReportMenu(webview, event.clientX, event.clientY); });
    // Obsidian's own menu closes on clicks and keys that reach the layer. A
    // native menu that macOS never shows, such as a second one for the same
    // right-click, never reports closing and would leave the layer in place.
    const menu = new Menu().setUseNativeMenu(false);
    // This replaces Obsidian's menu, which offered Copy for selected text.
    if (found?.text === true) {
      menu.addItem(item => item.setTitle('Copy').setIcon('copy').onClick(() => { void this.copyReportText(webview); })).addSeparator();
    }
    menu
      .addItem(item => item.setTitle('Copy DocShelf link').setIcon('link').onClick(() => this.copyLink(range)))
      .addItem(item => item.setTitle('Copy source reference').setIcon('quote').onClick(() => this.copyReference(range)))
      .addItem(item => item.setTitle('Reveal source').setIcon('folder-open').onClick(() => { void this.plugin.revealArtifact(artifact); }));
    this.referenceMenu = menu;
    menu.onHide(() => {
      const focused = layer.contains(layer.doc.activeElement);
      layer.remove();
      if (focused) webview.focus();
      if (this.referenceMenu !== menu) return;
      this.referenceMenu = null;
      this.showReportSelection(webview);
    });
    menu.showAtPosition({ x, y }, webview.ownerDocument);
    layer.focus();
  }

  // Copies the report's selected text, with its markup for rich pastes.
  private async copyReportText(webview: Webview): Promise<void> {
    const guest = reportGuest(webview);
    const found = guest ? await inReport(guest, REPORT_COPY_SCRIPT).catch(() => null) : null;
    const { text, html } = (found || {}) as { text?: unknown; html?: unknown };
    if (typeof text !== 'string' || typeof html !== 'string') return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]); }
    catch { new Notice('Could not access the clipboard.'); }
  }

  // Reads the report's selection again, repeating if it changed meanwhile.
  private async checkSelection(webview: Webview): Promise<void> {
    if (this.selectionCheck) { this.selectionPending = true; return this.selectionCheck; }
    const check = (async () => {
      do {
        this.selectionPending = false;
        const guest = reportGuest(webview);
        const found = guest ? await inReport(guest, REPORT_SELECTION_SCRIPT).catch(() => 'same') : 'same';
        if (this.closed || webview !== this.reportWebview) return;
        if (found === 'same') continue;
        this.reportSelection = this.readReference(found);
        if (!this.referenceMenu) this.showReportSelection(webview);
      } while (this.selectionPending);
    })();
    this.selectionCheck = check;
    try { await check; } finally { this.selectionCheck = null; }
  }

  private showReportSelection(webview: Webview): void {
    this.showRangeStatus(this.reportSelection?.range || null, () => { void this.clearReportSelection(webview); });
    void this.highlightReport(webview, this.reportSelection?.spans || []);
  }

  private async clearReportSelection(webview: Webview): Promise<void> {
    this.reportSelection = null;
    this.showReportSelection(webview);
    const guest = reportGuest(webview);
    if (guest) await inReport(guest, REPORT_CLEAR_SCRIPT).catch(() => null);
  }

  // The highlight is a stylesheet on the tagged spans, so it scrolls with the
  // report without changing its document.
  private async highlightReport(webview: Webview, spans: string[]): Promise<void> {
    const generation = ++this.highlightGeneration;
    const previous = this.highlightKey;
    this.highlightKey = '';
    const guest = reportGuest(webview);
    if (!guest) return;
    try {
      if (previous) await guest.removeInsertedCSS(previous);
      if (!spans.length || generation !== this.highlightGeneration) return;
      const key = await guest.insertCSS(highlightCss(spans, this.accentColor()));
      if (generation === this.highlightGeneration && webview === this.reportWebview) this.highlightKey = key;
      else await guest.removeInsertedCSS(key);
    } catch { /* The report navigated or closed. */ }
  }

  private accentColor(): string {
    const probe = this.contentEl.createDiv();
    probe.setCssStyles({ color: 'var(--interactive-accent)' });
    const color = this.contentEl.win.getComputedStyle(probe).color;
    probe.remove();
    return /^rgba?\([\d.,\s%]+\)$/.test(color) ? color : 'rgb(127, 109, 242)';
  }

  private readReference(found: unknown): ReportReference | null {
    const value = (found || {}) as { lines?: unknown; spans?: unknown };
    const [start, end] = Array.isArray(value.lines) ? value.lines as unknown[] : [];
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number) || (end as number) > sourceLines(this.source).length) return null;
    const range = { start: start as number, end: end as number };
    const spans = (Array.isArray(value.spans) ? value.spans as unknown[] : []).filter((span): span is string => {
      const match = typeof span === 'string' ? /^(\d{1,7})-(\d{1,7})$/.exec(span) : null;
      return !!match && Number(match[1]) >= range.start && Number(match[2]) <= range.end;
    });
    return { range, spans: spans.slice(0, MAX_HIGHLIGHT_SPANS) };
  }

  private showRangeStatus(range: LineRange | null, clear?: () => void): void {
    this.status.empty();
    this.status.removeClass('docshelf-editor-problem');
    if (this.mode === 'reading' && this.artifact?.kind === 'html' && !this.plugin.settings.runHtmlScripts) this.status.createSpan({ text: 'Report scripts are disabled' });
    if (!range) return;
    this.status.createSpan({ text: range.start === range.end ? `Source line ${range.start}` : `Source lines ${range.start}–${range.end}`, cls: 'docshelf-reference-label' });
    if (clear) this.status.createEl('button', { text: 'Clear selection' }).onclick = clear;
  }

  private async currentRange(): Promise<LineRange | null> {
    if (this.mode !== 'reading' || this.artifact?.kind !== 'html') return this.range;
    if (this.reportWebview) await this.checkSelection(this.reportWebview);
    return this.reportSelection?.range || null;
  }

  private updateRangeStatus(selection: LineSelection): void {
    this.showRangeStatus(this.range, () => selection.clear());
  }
  private saveState(): void { this.app.workspace.requestSaveLayout(); }

  async copyLink(range?: LineRange | null): Promise<void> {
    if (range === undefined) range = await this.currentRange();
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createPermalink(this.plugin.vaultIdentity(), this.artifact, range)); new Notice('DocShelf link copied.'); }
    catch { new Notice('Could not access the clipboard.'); }
  }
  async copyReference(range?: LineRange | null): Promise<void> {
    if (range === undefined) range = await this.currentRange();
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createAgentReference(this.artifact, range)); new Notice('Source reference copied.'); }
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

// Electron reserves world 0 for the page and 999 for preload scripts.
const REFERENCE_WORLD = 1001;
const MAX_HIGHLIGHT_SPANS = 500;

function reportGuest(webview: Webview): ReportGuest | null {
  try { return webContents.fromId(webview.getWebContentsId()) || null; } catch { return null; }
}

// Scripts run in an isolated world, which works with report scripts disabled
// and which report scripts cannot alter. They only read the report and return
// JSON that the host validates.
async function inReport(guest: ReportGuest, script: string): Promise<unknown> {
  return JSON.parse(String(await guest.executeJavaScriptInIsolatedWorld(REFERENCE_WORLD, [{ code: `JSON.stringify((() => { ${REPORT_LIBRARY} ${script} })())` }])));
}

// A reference cites the lines from its first block to its last. It highlights
// the outermost block-level elements within those lines, or inline ones when a
// range has no blocks.
const REPORT_LIBRARY = `
  const name = ${JSON.stringify(SOURCE_LINES_ATTRIBUTE)};
  const spanOf = element => element.getAttribute(name).split('-').map(Number);
  const inline = element => ['inline', 'contents'].includes(getComputedStyle(element).display);
  const block = node => {
    let fallback = null;
    for (let element = node && node.nodeType === 1 ? node : node && node.parentElement; element; element = element.parentElement) {
      if (!element.hasAttribute(name)) continue;
      if (!inline(element)) return element;
      fallback = fallback || element;
    }
    return fallback;
  };
  const within = ([start, end], blocks) => {
    const chosen = [];
    for (const element of document.querySelectorAll('[' + name + ']')) {
      const [a, b] = spanOf(element);
      if (a < start || b > end || chosen.at(-1)?.contains(element) || blocks && inline(element)) continue;
      chosen.push(element);
    }
    return chosen;
  };
  const reference = (first, last) => {
    const [a, b] = spanOf(first), [c, d] = spanOf(last);
    const lines = [Math.min(a, c), Math.max(b, d)];
    const elements = within(lines, true);
    return { lines, spans: [...new Set((elements.length ? elements : within(lines, false)).map(element => element.getAttribute(name)))].slice(0, ${MAX_HIGHLIGHT_SPANS}) };
  };
  // The first and last text a selection actually covers: a triple-click ends
  // at the start of the next block, which it does not select.
  const selected = () => {
    const selection = getSelection();
    const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) return null;
    let first = null, last = null;
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = root.nodeType === 3 ? root : walker.nextNode(); node; node = node === root ? null : walker.nextNode()) {
      if (!node.data.trim() || !range.intersectsNode(node)) continue;
      if (node === range.startContainer && range.startOffset >= node.data.length || node === range.endContainer && range.endOffset === 0) continue;
      first = first || node;
      last = node;
    }
    first = block(first || range.startContainer);
    last = block(last || range.endContainer);
    return first && last ? { range, first, last } : null;
  };
`;

// Also reports whether there is selected text to copy.
function reportPointScript(x: number, y: number): string {
  return `
    const text = getSelection().toString().trim() !== '';
    const selection = selected();
    if (selection && [...selection.range.getClientRects()].some(r => ${x} >= r.left && ${x} <= r.right && ${y} >= r.top && ${y} <= r.bottom)) return { text, reference: reference(selection.first, selection.last) };
    const element = block(document.elementFromPoint(${x}, ${y}));
    return { text, reference: element && reference(element, element) };
  `;
}

function reportWatchScript(token: string): string {
  return `
    if (!window.docshelfWatching) {
      const token = ${JSON.stringify(token)};
      document.addEventListener('selectionchange', () => console.debug(token));
      addEventListener('pointerdown', event => { if (event.button === 0) console.debug(token + ':down'); }, true);
      addEventListener('pointerup', event => { if (event.button === 0) console.debug(token + ':up'); }, true);
    }
    window.docshelfWatching = true;
    return null;
  `;
}

// Returns "same" while the selection's boundaries or lines are unchanged, so
// frequent checks stay cheap. The state lives in the isolated world, which
// report scripts cannot read or write.
const REPORT_SELECTION_SCRIPT = `
  const state = window.docshelfSelection || (window.docshelfSelection = { bounds: [], key: '' });
  const current = getSelection();
  const range = current && current.rangeCount ? current.getRangeAt(0) : null;
  const bounds = range && !range.collapsed ? [range.startContainer, range.startOffset, range.endContainer, range.endOffset] : [];
  if (bounds.length === state.bounds.length && bounds.every((value, index) => value === state.bounds[index])) return 'same';
  state.bounds = bounds;
  const selection = selected();
  const lines = selection && [Math.min(spanOf(selection.first)[0], spanOf(selection.last)[0]), Math.max(spanOf(selection.first)[1], spanOf(selection.last)[1])];
  const key = lines ? lines.join('-') : '';
  if (key === state.key) return 'same';
  state.key = key;
  return selection && reference(selection.first, selection.last);
`;

const REPORT_COPY_SCRIPT = `
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const holder = document.createElement('div');
  holder.append(selection.getRangeAt(0).cloneContents());
  for (const element of holder.querySelectorAll('[' + name + ']')) element.removeAttribute(name);
  return { text: selection.toString(), html: holder.innerHTML };
`;

const REPORT_CLEAR_SCRIPT = `
  getSelection().removeAllRanges();
  window.docshelfSelection = { bounds: [], key: '' };
  return null;
`;

function highlightCss(spans: string[], color: string): string {
  const targets = spans.map(span => `[${SOURCE_LINES_ATTRIBUTE}="${span}"]`).join(', ');
  return `:is(${targets}):not(:is(${targets}) *) { outline: 2px solid ${color} !important; outline-offset: 2px !important; box-shadow: inset 0 0 0 100vmax color-mix(in srgb, ${color} 14%, transparent) !important; }`;
}
