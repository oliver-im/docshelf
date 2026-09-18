import type { LineRange } from '../core/types';

export class LineSelection {
  range: LineRange | null;
  private anchor: number | null;
  private buttons = new Map<number, HTMLButtonElement>();
  private focused: number | null = null;

  constructor(range: LineRange | null, private onChange: (range: LineRange | null) => void) {
    this.range = range;
    this.anchor = range?.start || null;
  }

  addButton(parent: HTMLElement, line: number): HTMLButtonElement {
    const button = parent.createEl('button', { text: String(line), cls: 'docshelf-line-button', attr: { 'aria-label': `Select source line ${line}`, 'data-line': String(line), type: 'button' } });
    this.buttons.set(line, button);
    button.addEventListener('focus', () => {
      this.focused = line;
      for (const [number, control] of this.buttons) control.tabIndex = number === line ? 0 : -1;
    });
    button.addEventListener('click', event => this.select(line, event.shiftKey));
    button.addEventListener('keydown', event => {
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = line + 1;
      if (event.key === 'ArrowUp') next = line - 1;
      if (event.key === 'Home') next = Math.min(...this.buttons.keys());
      if (event.key === 'End') next = Math.max(...this.buttons.keys());
      if (event.key === 'Escape') { event.preventDefault(); this.clear(); }
      if (next !== undefined && this.buttons.has(next)) {
        event.preventDefault();
        this.buttons.get(next)!.focus();
        if (event.shiftKey) { if (this.anchor === null) this.anchor = line; this.select(next, true); }
      }
    });
    this.updateButton(button, line);
    return button;
  }

  select(line: number, extend = false): void {
    if (!extend || this.anchor === null) this.anchor = line;
    this.range = { start: Math.min(line, this.anchor), end: Math.max(line, this.anchor) };
    this.update();
    this.onChange(this.range);
  }

  clear(): void {
    this.range = null;
    this.anchor = null;
    this.update();
    this.onChange(null);
  }

  private update(): void { for (const [line, button] of this.buttons) this.updateButton(button, line); }

  private updateButton(button: HTMLButtonElement, line: number): void {
    const selected = !!this.range && line >= this.range.start && line <= this.range.end;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
    button.tabIndex = line === (this.focused || this.range?.start || this.buttons.keys().next().value) ? 0 : -1;
    button.closest('.docshelf-source-row')?.classList.toggle('is-selected', selected);
  }

  scrollToSelection(): void { if (this.range) this.buttons.get(this.range.start)?.scrollIntoView({ block: 'center' }); }
}
