import { Modal, Notice } from 'obsidian';
import type DocShelfPlugin from '../main';
import { message, type Artifact } from '../core/types';

export type RemovalTarget = { artifact: Artifact } | { project: string };

export class RemoveModal extends Modal {
  private closed = false;
  constructor(private plugin: DocShelfPlugin, private target: RemovalTarget) { super(plugin.app); }

  onOpen(): void {
    const target = this.target;
    const project = 'project' in target;
    this.titleEl.setText('Remove from shelf?');
    this.contentEl.addClass('docshelf-remove');
    this.contentEl.createEl('p', { text: 'project' in target
      ? `Remove the “${target.project}” project from DocShelf? Its original files and folders will stay untouched.`
      : `Remove “${target.artifact.title}” from DocShelf? The original file or remote document will stay untouched.` });
    const detail = this.contentEl.createEl('p', { cls: 'docshelf-muted', text: 'Checking registration…' });
    if (this.plugin.nativeViews().some(view => view.hasUnsavedEdits && ('project' in target ? view.artifact?.project === target.project : view.artifact?.source === target.artifact.source))) {
      this.contentEl.createEl('p', { text: project
        ? 'Open unsaved drafts will be kept, but you will need to add their documents again before saving them to the originals.'
        : 'Your open unsaved draft will be kept, but you will need to add the document again before saving it to the original.' });
    }
    const error = this.contentEl.createDiv({ cls: 'docshelf-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'docshelf-add-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const remove = actions.createEl('button', { text: 'Remove', cls: 'mod-warning' });
    remove.disabled = true;
    cancel.focus();
    void this.plugin.prepareRemove(target).then(prepared => {
      if (this.closed) return;
      detail.setText(project
        ? projectRemovalDetail(prepared.documents, prepared.folders, prepared.foldersExcluded)
        : prepared.foldersExcluded ? 'This document will also be excluded from its watched folders so it stays off the shelf.' : 'You can add it again later.');
      remove.disabled = false;
      remove.onclick = async () => {
        remove.disabled = true;
        remove.setText('Removing…');
        try {
          await prepared.commit();
          this.close();
          new Notice(`${project ? 'Project' : 'Document'} removed from shelf.`);
        } catch (caught) {
          if (!this.closed) { error.setText(message(caught)); remove.setText('Remove'); }
        }
      };
    }).catch(caught => { if (!this.closed) { detail.setText(''); error.setText(message(caught)); } });
  }

  onClose(): void { this.closed = true; this.contentEl.empty(); }
}

function projectRemovalDetail(documents: number, folders: number, foldersExcluded: number): string {
  const count = (value: number, noun: string) => value ? [`${value} ${noun}${value === 1 ? '' : 's'}`] : [];
  const removed = [...count(documents, 'document'), ...count(folders, 'watched folder')].join(' and ');
  return `This removes ${removed} from the shelf. ${foldersExcluded ? 'Its documents will also be excluded from other watched folders so they stay off the shelf.' : 'You can add them again later.'}`;
}
