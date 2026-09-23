import { Modal, Notice } from 'obsidian';
import type DocShelfPlugin from '../main';
import { message, type Artifact } from '../core/types';

export class RemoveModal extends Modal {
  private closed = false;
  constructor(private plugin: DocShelfPlugin, private artifact: Artifact) { super(plugin.app); }

  onOpen(): void {
    this.titleEl.setText('Remove from shelf?');
    this.contentEl.addClass('docshelf-remove');
    this.contentEl.createEl('p', { text: `Remove “${this.artifact.title}” from DocShelf? The original file or remote document will stay untouched.` });
    const detail = this.contentEl.createEl('p', { cls: 'docshelf-muted', text: 'Checking registration…' });
    if (this.plugin.nativeViews().some(view => view.artifact?.source === this.artifact.source && view.hasUnsavedEdits)) {
      this.contentEl.createEl('p', { text: 'Your open unsaved draft will be kept, but you will need to add the document again before saving it to the original.' });
    }
    const error = this.contentEl.createDiv({ cls: 'docshelf-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'docshelf-add-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const remove = actions.createEl('button', { text: 'Remove', cls: 'mod-warning' });
    remove.disabled = true;
    cancel.focus();
    void this.plugin.prepareRemove(this.artifact).then(prepared => {
      if (this.closed) return;
      detail.setText(prepared.foldersExcluded ? 'This document will also be excluded from its watched folders so it stays off the shelf.' : 'You can add it again later.');
      remove.disabled = false;
      remove.onclick = async () => {
        remove.disabled = true;
        remove.setText('Removing…');
        try {
          await prepared.commit();
          this.close();
          new Notice('Document removed from shelf.');
        } catch (caught) {
          if (!this.closed) { error.setText(message(caught)); remove.setText('Remove'); }
        }
      };
    }).catch(caught => { if (!this.closed) { detail.setText(''); error.setText(message(caught)); } });
  }

  onClose(): void { this.closed = true; this.contentEl.empty(); }
}
