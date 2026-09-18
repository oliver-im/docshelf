import { Compartment, EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, ViewPlugin, type BlockInfo, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { LineRange } from '../core/types';

interface Span { from: number; to: number }
interface ReferenceSelection { anchor: Span; head: Span }
const setReference = StateEffect.define<ReferenceSelection | null>();
const references = StateField.define<ReferenceSelection | null>({
  create: () => null,
  update(selection, transaction) {
    if (selection && transaction.docChanged) {
      const map = (span: Span): Span => ({ from: transaction.changes.mapPos(span.from, 1), to: transaction.changes.mapPos(span.to, -1) });
      selection = { anchor: map(selection.anchor), head: map(selection.head) };
    }
    // Ordinary text selection takes precedence when the user returns to editing.
    if (transaction.selection && !transaction.docChanged) selection = null;
    for (const effect of transaction.effects) if (effect.is(setReference)) selection = effect.value;
    return selection;
  },
});

const editors = new WeakMap<object, EditorView>();

/** Map existing selections/history through a disk change, without making that
 * change a local Undo step. Keep unchanged text outside the replacement. */
export function applyExternalText(owner: object, text: string): boolean {
  const view = editors.get(owner);
  if (!view) return false;
  const before = view.state.doc.toString();
  if (before === text) return true;
  let from = 0, oldEnd = before.length, newEnd = text.length;
  while (from < oldEnd && from < newEnd && before[from] === text[from]) from++;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
  view.dispatch({ changes: { from, to: oldEnd, insert: text.slice(from, newEnd) }, annotations: Transaction.addToHistory.of(false) });
  return true;
}

function rangeIn(state: EditorState): LineRange | null {
  const selected = state.field(references, false);
  if (!selected) return null;
  const start = Math.min(selected.anchor.from, selected.anchor.to, selected.head.from, selected.head.to);
  const end = Math.max(selected.anchor.from, selected.anchor.to, selected.head.from, selected.head.to);
  return { start: state.doc.lineAt(start).number, end: state.doc.lineAt(end).number };
}

export function sourceReference(owner: object): LineRange | null {
  const view = editors.get(owner);
  return view ? rangeIn(view.state) : null;
}

export function setSourceReference(owner: object, range: LineRange | null): void {
  const view = editors.get(owner);
  if (!view) return;
  const span = range ? { from: view.state.doc.line(range.start).from, to: view.state.doc.line(range.end).to } : null;
  view.dispatch({ effects: setReference.of(span ? { anchor: span, head: span } : null) });
}

function select(view: EditorView, start: number, end: number, extend: boolean): void {
  const span = { from: view.state.doc.line(start).from, to: view.state.doc.line(end).to };
  const previous = view.state.field(references);
  const focused = view.dom.ownerDocument.activeElement;
  const restoreFocus = focused?.matches('.docshelf-source-control');
  view.dispatch({ effects: setReference.of({ anchor: extend && previous ? previous.anchor : span, head: span }) });
  if (restoreFocus) view.scrollDOM.querySelector<HTMLButtonElement>(`.docshelf-source-gutter button[data-start="${start}"]`)?.focus();
}

class SourceMarker extends GutterMarker {
  constructor(readonly start: number, readonly end: number, readonly selected: boolean) { super(); }
  eq(other: SourceMarker): boolean { return this.start === other.start && this.end === other.end && this.selected === other.selected; }
  toDOM(view: EditorView): HTMLElement {
    const button = view.dom.ownerDocument.createElement('button');
    const label = this.start === this.end ? String(this.start) : `${this.start}–${this.end}`;
    button.type = 'button';
    button.className = 'docshelf-source-control';
    button.textContent = label;
    button.dataset.start = String(this.start);
    button.dataset.end = String(this.end);
    button.setAttribute('aria-label', `Select source ${this.start === this.end ? 'line' : 'lines'} ${label}`);
    button.setAttribute('aria-pressed', String(this.selected));
    button.title = `Source ${this.start === this.end ? 'line' : 'lines'} ${label} · Shift-click to extend`;
    button.tabIndex = -1;
    // Keep the native text cursor where it is so a review selection doesn't
    // expose Markdown syntax or change the editor's undo/selection history.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); select(view, this.start, this.end, event.shiftKey); });
    button.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); view.dispatch({ effects: setReference.of(null) }); view.focus(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(view.scrollDOM.querySelectorAll<HTMLButtonElement>('.docshelf-source-gutter button'));
      const index = buttons.indexOf(button);
      const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : buttons[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!next) return;
      event.preventDefault();
      if (event.shiftKey) {
        if (!view.state.field(references)) select(view, this.start, this.end, false);
        select(view, Number(next.dataset.start), Number(next.dataset.end), true);
      }
      const target = view.scrollDOM.querySelector<HTMLButtonElement>(`.docshelf-source-gutter button[data-start="${next.dataset.start}"]`);
      target?.focus();
    });
    return button;
  }
}

export function nativeSourceControls(applies: (owner: unknown) => boolean, changed: (owner: unknown) => void): Extension {
  function marker(view: EditorView, block: BlockInfo): GutterMarker | null {
    if (!applies(view.state.field(editorInfoField, false))) return null;
    const start = view.state.doc.lineAt(block.from).number;
    const end = view.state.doc.lineAt(Math.max(block.from, block.to - 1)).number;
    const selected = rangeIn(view.state);
    return new SourceMarker(start, end, !!selected && selected.start <= end && selected.end >= start);
  }
  const gutterScope = new Compartment();
  const noGutter: Extension = [];
  const sourceGutter = gutter({
    class: 'docshelf-source-gutter',
    // Obsidian also calls lineMarker for block widgets. Let widgetMarker
    // handle those once, including on upstream CodeMirror implementations.
    lineMarker: (view, block) => block.widget ? null : marker(view, block),
    widgetMarker: (view, _widget, block) => marker(view, block),
    lineMarkerChange: update => update.startState.field(references) !== update.state.field(references),
  });
  const gutterFor = (state: EditorState): Extension => applies(state.field(editorInfoField, false)) ? sourceGutter : noGutter;
  return [
    references,
    gutterScope.of(noGutter),
    // An empty gutter still adds the host's gutter margin to ordinary notes.
    // Mount it only in DocShelf editors, including when the owner changes.
    EditorState.transactionExtender.of(transaction => {
      const wanted = gutterFor(transaction.state);
      return gutterScope.get(transaction.state) === wanted ? null : { effects: gutterScope.reconfigure(wanted) };
    }),
    EditorView.decorations.compute([references, 'doc', editorInfoField], state => {
      if (!applies(state.field(editorInfoField, false))) return Decoration.none;
      const range = rangeIn(state);
      if (!range) return Decoration.none;
      const lines = [];
      for (let number = range.start; number <= range.end; number++) lines.push(Decoration.line({ class: 'docshelf-referenced-line' }).range(state.doc.line(number).from));
      return Decoration.set(lines);
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== 'Escape' || !rangeIn(view.state)) return false;
        view.dispatch({ effects: setReference.of(null) });
        return true;
      },
    }),
    ViewPlugin.fromClass(class {
      private owner?: object;
      private frame = 0;
      private lastRange = '';
      private destroyed = false;
      constructor(private view: EditorView) {
        this.updateOwner();
        this.accessibleGutter();
        // Initial state creation doesn't run transaction extenders. Defer until
        // construction finishes, when dispatching a configuration is allowed.
        queueMicrotask(() => {
          if (this.destroyed) return;
          const wanted = gutterFor(view.state);
          if (gutterScope.get(view.state) !== wanted) view.dispatch({ effects: gutterScope.reconfigure(wanted) });
        });
      }
      update(update: ViewUpdate): void {
        this.updateOwner();
        if (update.docChanged || update.viewportChanged || update.geometryChanged || update.startState.field(references) !== update.state.field(references)) this.accessibleGutter();
      }
      private updateOwner(): void {
        const owner = this.view.state.field(editorInfoField, false);
        if (!owner || !applies(owner)) {
          if (this.owner && editors.get(this.owner) === this.view) editors.delete(this.owner);
          this.owner = undefined;
          this.view.scrollDOM.style.removeProperty('--docshelf-gutter-width');
          return;
        }
        this.owner = owner;
        editors.set(owner, this.view);
        const key = JSON.stringify(rangeIn(this.view.state));
        if (key !== this.lastRange) { this.lastRange = key; changed(owner); }
      }
      private accessibleGutter(): void {
        if (!this.owner) return;
        if (this.frame) this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
        this.frame = this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(() => {
          this.frame = 0;
          const gutter = this.view.scrollDOM.querySelector<HTMLElement>('.docshelf-source-gutter');
          if (!gutter) return;
          // The text column stays centered while the gutter hangs into its
          // left margin. Measure actual labels so ranges and font changes fit.
          this.view.requestMeasure({
            key: this,
            read: () => gutter.parentElement?.offsetWidth || 0,
            write: width => {
              if (!width || this.destroyed || !this.owner) return;
              const value = `${width}px`;
              if (this.view.scrollDOM.style.getPropertyValue('--docshelf-gutter-width') !== value) this.view.scrollDOM.style.setProperty('--docshelf-gutter-width', value);
            },
          });
          // CodeMirror hides decorative gutters from accessibility APIs. These
          // are interactive controls, so expose their group with one tab stop.
          gutter.parentElement?.removeAttribute('aria-hidden');
          gutter.setAttribute('role', 'group');
          gutter.setAttribute('aria-label', 'DocShelf source lines');
          const buttons = Array.from(gutter.querySelectorAll<HTMLButtonElement>('button'));
          const current = buttons.find(button => button === gutter.ownerDocument.activeElement) || buttons.find(button => button.getAttribute('aria-pressed') === 'true') || buttons[0];
          for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
          const range = rangeIn(this.view.state);
          for (const element of this.view.contentDOM.querySelectorAll('.docshelf-referenced-block')) element.classList.remove('docshelf-referenced-block');
          for (const block of this.view.viewportLineBlocks.flatMap(block => Array.isArray(block.type) ? block.type : [block])) {
            if (!block.widget) continue;
            const from = this.view.state.doc.lineAt(block.from).number;
            const to = this.view.state.doc.lineAt(Math.max(block.from, block.to - 1)).number;
            const selected = !!range && range.start <= to && range.end >= from;
            if (!selected) continue;
            const position = this.view.domAtPos(block.from);
            const node = position.node.childNodes[position.offset] || position.node;
            const element = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
            element?.closest<HTMLElement>('.cm-embed-block')?.classList.add('docshelf-referenced-block');
          }
        });
      }
      destroy(): void {
        this.destroyed = true;
        if (this.frame) this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
        this.view.scrollDOM.style.removeProperty('--docshelf-gutter-width');
        if (this.owner && editors.get(this.owner) === this.view) editors.delete(this.owner);
      }
    }),
  ];
}
