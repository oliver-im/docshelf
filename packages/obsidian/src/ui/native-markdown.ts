import { editorInfoField, FileView, MarkdownView, Menu, Modal, Notice, Platform, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type DocShelfPlugin from '../main';
import { editorText, readEditableFile, saveEditableFile, type FileSnapshot } from '../core/editing';
import { checkRange, createAgentReference, createPermalink, parseRange } from '../core/protocol';
import { parseLineFragment } from '../core/line-permalinks.js';
import { message, type Artifact, type LineRange } from '../core/types';
import { markdownHeadingLine, markdownLink } from '../core/markdown';
import { applyExternalText, nativeSourceControls, setSourceReference, sourceReference, sourceReferenceAt } from './native-lines';

export const NATIVE_MARKDOWN_VIEW = 'docshelf-markdown';

export const nativeMarkdownExtension = [
  nativeSourceControls(owner => owner instanceof NativeMarkdownView, owner => (owner as NativeMarkdownView).onSourceReferenceChanged()),
  EditorState.changeFilter.of(transaction => {
    const owner = transaction.startState.field(editorInfoField, false);
    return !(owner instanceof NativeMarkdownView) || owner.acceptsEditorChanges;
  }),
  Prec.highest(EditorView.domEventHandlers({
    click(event, editor) {
      const owner = editor.state.field(editorInfoField, false);
      if (!(owner instanceof NativeMarkdownView)) return false;
      const anchor = (event.target as HTMLElement).closest<HTMLElement>('.cm-link, .cm-hmd-internal-link, .cm-url');
      if (!anchor) return false;
      // Raw source mode keeps plain clicks available for editing link text.
      // Never fall through to a vault-file link handler in this external view.
      if (owner.getState().source === true && !(event.metaKey || event.ctrlKey)) { event.preventDefault(); return true; }
      const offset = editor.posAtCoords({ x: event.clientX, y: event.clientY });
      if (offset === null) { event.preventDefault(); return true; }
      const line = editor.state.doc.lineAt(offset);
      const href = markdownLink(editor.state.doc.toString(), line.number - 1, offset - line.from, anchor.textContent || undefined);
      if (href) owner.openShelfLink(href);
      else new Notice('Open this link from reading mode.');
      event.preventDefault();
      return true;
    },
  })),
];

/** The host's real MarkdownView, with external-file persistence instead of a TFile.
 * No fake vault entries, folder links, copied notes, or patched host prototypes.
 */
export class NativeMarkdownView extends MarkdownView {
  artifact: Artifact | null = null;
  route = '';
  draftId: string = randomUUID();
  private externalSnapshot?: FileSnapshot;
  private externalBaseline = '';
  private applyingExternal = false;
  private externalClosed = false;
  private unsubscribeShelf?: () => void;
  private saveStatusEl?: HTMLElement;
  private saveStatusKey = '';
  private saveProblem = '';
  private recoveryReviewRequired = false;
  private shelfRevision = '';
  private loadGeneration = 0;
  private recoveryRoute: string | null = null;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private draftChanged = false;

  constructor(leaf: WorkspaceLeaf, private plugin: DocShelfPlugin) {
    super(leaf);
    this.allowNoFile = true;
    const requestSave = this.requestSave;
    this.requestSave = () => {
      if (this.applyingExternal || !this.externalSnapshot || this.externalClosed) return;
      // MarkdownView transfers this public TextFileView buffer between modes.
      // Keep it current even while saving is delayed or blocked by a conflict.
      this.data = this.getViewData();
      this.scheduleDraft();
      this.updateSaveStatus();
      requestSave();
    };
  }

  getViewType(): string { return NATIVE_MARKDOWN_VIEW; }
  // Only registered routes belong here. Let vault-file navigation choose
  // Obsidian's ordinary view instead of reusing this MarkdownView subclass.
  canAcceptExtension(): boolean { return false; }
  getDisplayText(): string { return this.artifact?.title || 'DocShelf document'; }
  getIcon(): string { return 'file-text'; }
  getState(): Record<string, unknown> {
    const reference = sourceReference(this);
    return { ...super.getState(), route: this.route, draftId: this.draftId, referenceLines: reference ? `${reference.start}-${reference.end}` : undefined };
  }
  onSourceReferenceChanged(): void { this.updateSaveStatus(); this.app.workspace.requestSaveLayout(); }
  get hasUnsavedEdits(): boolean { return !!this.externalSnapshot && this.getViewData() !== this.externalBaseline; }
  get acceptsEditorChanges(): boolean { return this.applyingExternal || (!!this.externalSnapshot && !this.recoveryRoute); }

  async onOpen(): Promise<void> {
    await super.onOpen();
    // Native source-mode commands request a vault Markdown view even when
    // acting on this subclass. Keep fileless transitions for this route here;
    // opening a real vault file must still use the host's normal view.
    const leaf = this.leaf, original = leaf.setViewState;
    const setViewState: typeof leaf.setViewState = (state, ephemeral) => {
      if (leaf.view === this && state.type === 'markdown' && !state.state?.file && state.state?.route === this.route) {
        state = { ...state, type: NATIVE_MARKDOWN_VIEW };
      }
      return original.call(leaf, state, ephemeral);
    };
    leaf.setViewState = setViewState;
    this.register(() => { if (leaf.setViewState === setViewState) leaf.setViewState = original; });
    // The native toolbar control assumes a vault file (including Mod-click
    // splits). Mode changes belong in our pane menu instead. Keep its object
    // alive so the host can still update its icon while changing modes.
    (this as this & { modeButtonEl?: HTMLElement }).modeButtonEl?.remove();
    this.contentEl.addClass('docshelf-native');
    this.saveStatusEl = this.contentEl.createDiv({ cls: 'docshelf-editor-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.addAction('settings', 'Configure DocShelf', () => this.plugin.showSettings());
    this.addAction('link', 'Copy DocShelf link', () => { void this.copyLink(); });
    this.addAction('quote', 'Copy source reference', () => { void this.copyReference(); });
    this.addAction('folder-open', 'Reveal source', () => { if (this.artifact) void this.plugin.revealArtifact(this.artifact); });
    this.registerDomEvent(this.contentEl, 'click', event => this.followShelfLink(event), true);
    // Stop the native editor/table from moving the cursor before contextmenu.
    for (const name of ['pointerdown', 'mousedown'] as const) this.registerDomEvent(this.contentEl, name, event => {
      if ((event.button === 2 || Platform.isMacOS && event.button === 0 && event.ctrlKey) && sourceReferenceAt(this, event)) {
        event.preventDefault(); event.stopPropagation();
      }
    }, true);
    this.registerDomEvent(this.contentEl, 'contextmenu', event => {
      if (!this.showReferenceMenu(event)) this.suppressMarginMenu(event);
    }, true);
    this.scope?.register(['Mod'], 'Enter', () => {
      const cursor = this.editor.getCursor();
      const href = markdownLink(this.editor.getValue(), cursor.line, cursor.ch);
      if (href) this.openShelfLink(href);
      return false;
    });
    const observer = new MutationObserver(() => this.resolveShelfImages());
    observer.observe(this.contentEl, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    this.unsubscribeShelf = this.plugin.subscribe(() => {
      if (!this.plugin.loading && this.shelfRevision !== this.plugin.documentRevision(this.route)) void this.refreshSource();
    });
  }

  onPaneMenu(menu: Menu, source: string): void {
    // Retain native pane actions, but build Markdown actions for our external
    // view instead of inheriting vault-only modes, properties, and PDF export.
    FileView.prototype.onPaneMenu.call(this, menu, source);
    const editing = this.getMode() === 'source';
    const changeMode = (mode: 'source' | 'preview', raw = this.getState().source === true) => this.leaf.setViewState({
      type: NATIVE_MARKDOWN_VIEW, state: { ...this.getState(), mode, source: raw },
    }, { focus: true });
    menu.addItem(item => item.setSection('pane').setTitle('Reading view').setIcon('book-open').setChecked(!editing)
      .onClick(() => changeMode(editing ? 'preview' : 'source')));
    if (editing) menu.addItem(item => item.setSection('pane').setTitle('Source mode').setIcon('code-2').setChecked(this.getState().source === true)
      .onClick(() => changeMode('source', this.getState().source !== true)));
    menu.addItem(item => item.setSection('find').setTitle('Find').setIcon('file-search').onClick(() => this.showSearch()));
    menu.addItem(item => item.setSection('find').setTitle('Replace').setIcon('file-search').setDisabled(!editing).onClick(() => this.showSearch(true)));
  }

  private showReferenceMenu(event: MouseEvent): boolean {
    const range = sourceReferenceAt(this, event);
    if (!range) return false;
    event.preventDefault(); event.stopPropagation();
    const menu = new Menu()
      .addItem(item => item.setTitle('Copy source reference').setIcon('quote').onClick(() => this.copyReference(range)))
      .addItem(item => item.setTitle('Copy DocShelf link').setIcon('link').onClick(() => this.copyLink(range)))
      .addItem(item => item.setTitle('Reveal source').setIcon('folder-open').onClick(() => {
        if (this.artifact) void this.plugin.revealArtifact(this.artifact);
      }));
    menu.showAtMouseEvent(event);
    return true;
  }

  private suppressMarginMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.defaultPrevented || !target || (!target.matches('.cm-scroller, .cm-sizer, .cm-contentContainer, .markdown-preview-view') && !target.closest('.cm-gutters'))) return;
    event.preventDefault();
    event.stopPropagation();
    // Display preferences live in configuration. The host's margin menu also
    // offers line-number/title controls that do not apply to DocShelf views.
  }

  async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = (value || {}) as Record<string, unknown>;
    const route = typeof state.route === 'string' ? state.route : this.route;
    if (this.route && route !== this.route) {
      await this.save();
      if (this.hasUnsavedEdits) { new Notice('Resolve the unsaved edits before changing this tab’s document.'); return; }
    }
    const changed = route !== this.route || !this.externalSnapshot;
    this.route = route;
    if (changed) {
      this.cancelDraftTimer();
      this.plugin.recovery.release(this.draftId);
      this.draftChanged = false;
      this.artifact = null;
      this.externalSnapshot = undefined;
      this.externalBaseline = '';
      this.recoveryReviewRequired = false;
      const occupied = this.plugin.nativeViews().filter(view => view !== this).map(view => view.draftId);
      this.draftId = typeof state.draftId === 'string' && /^[a-f\d-]{36}$/.test(state.draftId) && !occupied.includes(state.draftId) ? state.draftId : randomUUID();
    }
    // Only pass native display settings. A persisted `file` must never bind this
    // external view to a vault note or invoke the host's vault save path.
    await super.setState({ mode: state.mode === 'preview' ? 'preview' : 'source', source: state.source === true }, result);
    if (changed) await this.refreshSource(true);
    try {
      const range = parseRange(state.lines ?? state.referenceLines);
      if (range && this.externalSnapshot) {
        checkRange(range, this.editor.lineCount());
        if (state.lines) this.editor.setSelection({ line: range.start - 1, ch: 0 }, { line: range.end - 1, ch: this.editor.getLine(range.end - 1).length });
        setSourceReference(this, range);
        this.editor.scrollIntoView({ from: { line: range.start - 1, ch: 0 }, to: { line: range.end - 1, ch: 0 } }, true);
      } else if (typeof state.hash === 'string' && state.hash && this.externalSnapshot) {
        const line = markdownHeadingLine(this.getViewData(), state.hash);
        if (line !== undefined) { this.editor.setCursor({ line, ch: 0 }); this.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
      }
    } catch (error) { new Notice(message(error)); }
  }

  async onClose(): Promise<void> {
    await this.save();
    this.cancelDraftTimer();
    this.plugin.recovery.release(this.draftId);
    this.externalClosed = true;
    this.loadGeneration++;
    this.unsubscribeShelf?.();
    await super.onClose();
  }

  private registered(): Artifact {
    const artifact = this.plugin.catalog?.artifacts.find(item => item.route === this.route);
    if (!artifact || artifact.kind !== 'markdown' || !artifact.sourcePath || (this.artifact && artifact.sourcePath !== this.artifact.sourcePath)) throw new Error('This Markdown source is no longer registered. Your edits have been kept.');
    return artifact;
  }

  private setExternalContents(text: string, clear: boolean): void {
    this.applyingExternal = true;
    try {
      this.data = text;
      if (clear || !applyExternalText(this, text)) this.setViewData(text, true);
      else this.setViewData(text, false);
    }
    finally { this.applyingExternal = false; }
  }

  async refreshSource(recover = false): Promise<void> {
    // Catalog notifications can supersede the initial load while ready is
    // pending. Recovery belongs to the route, not the superseded invocation.
    if (recover) this.recoveryRoute = this.route;
    const generation = ++this.loadGeneration;
    await this.plugin.ready;
    if (this.externalClosed || generation !== this.loadGeneration) return;
    this.shelfRevision = this.plugin.documentRevision(this.route);
    try {
      const artifact = this.registered();
      this.artifact = artifact;
      const title = this.containerEl.querySelector<HTMLElement>('.view-header-title');
      if (title) {
        title.setText(artifact.title);
        // Shelf titles belong to registrations; the host's filename-renaming
        // control requires a TFile and must not run for an external document.
        title.contentEditable = 'false';
        title.removeAttribute('tabindex');
      }
      if (this.recoveryRoute === this.route) {
        const occupied = new Set(this.plugin.nativeViews().filter(view => view !== this).map(view => view.draftId));
        const exact = this.plugin.recovery.read(this.draftId);
        const draft = exact?.pending && exact.source === artifact.sourcePath && exact.route === this.route ? exact : this.plugin.recovery.pending(artifact.sourcePath!, this.route, occupied);
        if (draft) {
          this.plugin.recovery.adopt(draft);
          this.draftId = draft.id;
          this.externalSnapshot = { canonicalPath: draft.canonicalPath, bytes: Buffer.from(draft.baseline, 'base64') };
          this.externalBaseline = editorText(this.externalSnapshot.bytes);
          this.setExternalContents(draft.text, true);
          this.recoveryReviewRequired = true;
          this.saveProblem = 'Recovered unsaved edits. Review them before saving.';
          this.recoveryRoute = null;
          this.contentEl.removeClass('docshelf-native-unavailable');
          this.updateSaveStatus();
          return;
        }
        this.recoveryRoute = null;
      }
      const current = readEditableFile(artifact.sourcePath!, this.plugin.catalog!.roots);
      if (this.hasUnsavedEdits) {
        if (!current.bytes.equals(this.externalSnapshot!.bytes) || current.canonicalPath !== this.externalSnapshot!.canonicalPath) this.saveProblem = 'The file changed outside this editor. Your edits have been kept.';
        else {
          const retry = !!this.saveProblem && !this.recoveryReviewRequired;
          this.saveProblem = this.recoveryReviewRequired ? 'Recovered unsaved edits. Review them before saving.' : '';
          // A temporarily missing file/registration can recover after the host's
          // delayed save has already fired. Resume even without another edit.
          if (retry) this.requestSave();
        }
      } else {
        const text = editorText(current.bytes);
        const first = !this.externalSnapshot;
        this.externalSnapshot = current;
        this.externalBaseline = text;
        this.recoveryReviewRequired = false;
        this.saveProblem = '';
        if (first || this.getViewData() !== text) this.setExternalContents(text, first);
      }
    } catch (error) { this.saveProblem = message(error); }
    this.contentEl.toggleClass('docshelf-native-unavailable', !this.externalSnapshot);
    this.updateSaveStatus();
  }

  private preserveDraft(): boolean {
    if (this.recoveryRoute || !this.externalSnapshot || !this.artifact?.sourcePath) return false;
    try {
      this.plugin.recovery.record(this.draftId, this.artifact.sourcePath, this.route, this.externalSnapshot, this.getViewData(), this.hasUnsavedEdits);
      this.draftChanged = false;
      return true;
    } catch (error) { this.saveProblem = `Could not keep a recovery copy: ${message(error)}`; return false; }
  }

  private cancelDraftTimer(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  private scheduleDraft(): void {
    this.draftChanged = true;
    // A short checkpoint interval bounds crash exposure even while typing
    // continuously; never serialize/fsync a full document on each keystroke.
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      this.preserveDraft();
      this.updateSaveStatus();
    }, 150);
  }

  async save(): Promise<void> {
    if (this.applyingExternal || this.externalClosed) return;
    this.cancelDraftTimer();
    this.data = this.getViewData();
    if (!this.externalSnapshot) return;
    if (!this.hasUnsavedEdits) { if (this.draftChanged) this.preserveDraft(); this.updateSaveStatus(); return; }
    if (!this.preserveDraft()) { this.updateSaveStatus(); return; }
    if (this.saveProblem || this.recoveryReviewRequired) { this.updateSaveStatus(); return; }
    try {
      const artifact = this.registered();
      const text = this.getViewData();
      const before = this.externalSnapshot;
      this.externalSnapshot = saveEditableFile(artifact.sourcePath!, this.plugin.catalog!.roots, before, text);
      this.externalBaseline = editorText(this.externalSnapshot.bytes);
      // Keep the pre-save version and edited text for recovery after a successful
      // write too; the next edit replaces this pane's bounded recovery record.
      this.plugin.recovery.record(this.draftId, artifact.sourcePath!, this.route, before, text, false);
      this.saveProblem = '';
      this.plugin.scheduleRefresh();
    } catch (error) { this.saveProblem = message(error); }
    this.updateSaveStatus();
  }

  private updateSaveStatus(): void {
    if (!this.saveStatusEl) return;
    const text = this.saveProblem || (this.hasUnsavedEdits ? 'Saving…' : '');
    const reference = sourceReference(this);
    const key = `${text}:${!!this.externalSnapshot && this.hasUnsavedEdits}:${JSON.stringify(reference)}`;
    if (key === this.saveStatusKey) return;
    this.saveStatusKey = key;
    this.saveStatusEl.empty();
    this.saveStatusEl.toggleClass('docshelf-editor-problem', !!this.saveProblem);
    if (text) this.saveStatusEl.createSpan({ text });
    if (reference) {
      const label = reference.start === reference.end ? `Source line ${reference.start}` : `Source lines ${reference.start}–${reference.end}`;
      this.saveStatusEl.createSpan({ text: label, cls: 'docshelf-reference-label' });
      this.saveStatusEl.createEl('button', { text: 'Clear selection' }).onclick = () => setSourceReference(this, null);
    }
    this.saveStatusEl.title = this.artifact?.sourcePath || '';
    if (this.saveProblem) {
      this.saveStatusEl.createEl('button', { text: this.externalSnapshot && this.hasUnsavedEdits ? 'Review changes' : 'Try again' }).onclick = () => {
        if (this.externalSnapshot && this.hasUnsavedEdits) this.reviewChanges(); else void this.refreshSource();
      };
      this.saveStatusEl.createEl('button', { text: 'Recovery files' }).onclick = () => this.plugin.revealRecovery();
    }
  }

  private reviewChanges(): void {
    try {
      const artifact = this.registered();
      const disk = readEditableFile(artifact.sourcePath!, this.plugin.catalog!.roots);
      new ReviewChangesModal(this.plugin, editorText(disk.bytes), this.getViewData(), (text, useDisk) => {
        if (!this.preserveDraft()) { this.updateSaveStatus(); return; }
        // Keep the previous draft independently when the user chooses the disk
        // version; it must not disappear when they start a new edit afterward.
        if (useDisk) {
          this.plugin.recovery.record(this.draftId, artifact.sourcePath!, this.route, this.externalSnapshot!, this.getViewData(), false);
          this.plugin.recovery.release(this.draftId);
          this.draftId = randomUUID();
        }
        this.externalSnapshot = disk;
        this.externalBaseline = editorText(disk.bytes);
        this.recoveryReviewRequired = false;
        this.saveProblem = '';
        this.setExternalContents(text, false);
        if (!useDisk) void this.save();
        this.updateSaveStatus();
      }).open();
    } catch (error) { this.saveProblem = message(error); this.updateSaveStatus(); }
  }

  private selectedRange(): LineRange | null {
    const reference = sourceReference(this);
    if (reference) return reference;
    if (!this.editor.somethingSelected()) return null;
    const from = this.editor.getCursor('from');
    const to = this.editor.getCursor('to');
    return { start: from.line + 1, end: to.ch === 0 && to.line > from.line ? to.line : to.line + 1 };
  }
  async copyLink(range: LineRange | null = this.selectedRange()): Promise<void> {
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createPermalink(this.plugin.vaultIdentity(), this.artifact, range)); new Notice('DocShelf link copied.'); }
    catch { new Notice('Could not access the clipboard.'); }
  }
  async copyReference(range: LineRange | null = this.selectedRange()): Promise<void> {
    if (!this.artifact) return;
    try { await navigator.clipboard.writeText(createAgentReference(this.artifact, range)); new Notice('Source reference copied.'); }
    catch { new Notice('Could not access the clipboard.'); }
  }

  private followShelfLink(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement)?.closest<HTMLElement>('a.internal-link');
    const href = anchor?.getAttribute('data-href') || anchor?.getAttribute('href');
    if (!href || !this.artifact?.sourcePath) return;
    if (/^https?:/i.test(href)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.openShelfLink(href);
  }

  openShelfLink(href: string): void {
    if (!this.artifact?.sourcePath) return;
    if (/^https?:/i.test(href)) { this.plugin.openExternal(href); return; }
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) { new Notice('This link type is not supported.'); return; }
    try {
      const [relative, fragment = ''] = href.split('#');
      const candidate = path.resolve(path.dirname(this.artifact.sourcePath), decodeURIComponent(relative.split('?')[0]));
      const target = relative ? this.plugin.catalog?.artifacts.find(item => item.sourcePath === candidate || item.canonicalPath === candidate || item.kind === 'markdown' && item.sourcePath === `${candidate}.md`) : this.artifact;
      if (!target) { new Notice('Register this document in DocShelf to open it.'); return; }
      const hash = fragment ? `#${fragment}` : '';
      void this.plugin.openArtifact(target, parseLineFragment(hash), hash, this.hasUnsavedEdits ? undefined : this.leaf);
    } catch { new Notice('Could not resolve this document link.'); }
  }

  private resolveShelfImages(): void {
    if (!this.artifact) return;
    for (const embed of this.contentEl.querySelectorAll<HTMLElement>('.internal-embed[src]')) {
      const source = embed.getAttribute('src')!;
      if (embed.dataset.docshelfResolved === source) continue;
      embed.dataset.docshelfResolved = source;
      embed.empty();
      if (this.artifact.assets?.includes(source) && /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(source)) embed.createEl('img', { attr: { src: this.plugin.server.assetUrl(this.artifact, source), alt: embed.getAttribute('alt') || source } });
      else embed.createSpan({ text: `Unregistered embed: ${source}`, cls: 'docshelf-empty' });
    }
  }
}

class ReviewChangesModal extends Modal {
  constructor(plugin: DocShelfPlugin, private disk: string, private draft: string, private resolve: (text: string, useDisk: boolean) => void) { super(plugin.app); }
  onOpen(): void {
    this.setTitle('Review document changes');
    this.contentEl.createEl('p', { text: 'Compare the current file with your edits. You can merge changes below before saving. Recovery copies are kept.' });
    const columns = this.contentEl.createDiv({ cls: 'docshelf-review-columns' });
    const current = columns.createDiv();
    current.createEl('label', { text: 'Current file' });
    const disk = current.createEl('textarea', { attr: { 'aria-label': 'Current file', readonly: '' } });
    disk.value = this.disk;
    const yours = columns.createDiv();
    yours.createEl('label', { text: 'Your edits' });
    const edits = yours.createEl('textarea', { attr: { 'aria-label': 'Your edits' } });
    edits.value = this.draft;
    const actions = this.contentEl.createDiv({ cls: 'docshelf-toolbar' });
    actions.createEl('button', { text: 'Keep editing' }).onclick = () => this.close();
    actions.createEl('button', { text: 'Use disk version' }).onclick = () => { this.resolve(this.disk, true); this.close(); };
    actions.createEl('button', { text: 'Save edited version', cls: 'mod-cta' }).onclick = () => { this.resolve(edits.value, false); this.close(); };
  }
  onClose(): void { this.contentEl.empty(); }
}
