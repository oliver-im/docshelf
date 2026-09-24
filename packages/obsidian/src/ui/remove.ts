import { Modal, Notice } from 'obsidian';
import type DocShelfPlugin from '../main';
import { message, type Artifact } from '../core/types';

/** A document, a project heading, or a folder row inside a project named by its folder path. */
export type RemovalTarget = { artifact: Artifact } | { project: string; folder?: string[] };

export class RemoveModal extends Modal {
  private closed = false;
  constructor(private plugin: DocShelfPlugin, private target: RemovalTarget) { super(plugin.app); }

  onOpen(): void {
    const target = this.target;
    const kind = 'artifact' in target ? 'document' : target.folder ? 'folder' : 'project';
    this.titleEl.setText('Remove from shelf?');
    this.contentEl.addClass('docshelf-remove');
    this.contentEl.createEl('p', { text: 'artifact' in target
      ? `Remove “${target.artifact.title}” from DocShelf? The original file or remote document will stay untouched.`
      : target.folder
        ? `Remove the “${target.folder.join('/')}” folder from DocShelf? Its original files will stay untouched.`
        : `Remove the “${target.project}” project from DocShelf? Its original files and folders will stay untouched.` });
    const detail = this.contentEl.createEl('p', { cls: 'docshelf-muted', text: 'Checking registration…' });
    const folders = this.plugin.documentFolders();
    const affected = (artifact: Artifact) => {
      if ('artifact' in target) return artifact.source === target.artifact.source;
      const placed = folders.get(artifact.route) || [];
      return artifact.project === target.project && (!target.folder || target.folder.every((part, index) => placed[index] === part));
    };
    if (this.plugin.nativeViews().some(view => view.hasUnsavedEdits && view.artifact && affected(view.artifact))) {
      this.contentEl.createEl('p', { text: kind === 'document'
        ? 'Your open unsaved draft will be kept, but you will need to add the document again before saving it to the original.'
        : 'Open unsaved drafts will be kept, but you will need to add their documents again before saving them to the originals.' });
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
      detail.setText(kind === 'document'
        ? prepared.foldersExcluded ? 'This document will also be excluded from its watched folders so it stays off the shelf.' : 'You can add it again later.'
        : groupRemovalDetail(kind, prepared.documents, prepared.folders, prepared.foldersExcluded));
      remove.disabled = false;
      remove.onclick = async () => {
        remove.disabled = true;
        remove.setText('Removing…');
        try {
          await prepared.commit();
          this.close();
          new Notice(`${kind[0].toUpperCase()}${kind.slice(1)} removed from shelf.`);
        } catch (caught) {
          if (!this.closed) { error.setText(message(caught)); remove.setText('Remove'); }
        }
      };
    }).catch(caught => { if (!this.closed) { detail.setText(''); error.setText(message(caught)); } });
  }

  onClose(): void { this.closed = true; this.contentEl.empty(); }
}

function groupRemovalDetail(kind: 'project' | 'folder', documents: number, folders: number, foldersExcluded: number): string {
  const count = (value: number, noun: string) => value ? [`${value} ${noun}${value === 1 ? '' : 's'}`] : [];
  const removed = [...count(documents, 'document'), ...count(folders, 'watched folder')].join(' and ');
  const after = kind === 'folder'
    ? foldersExcluded ? 'Files added to this folder later will stay off the shelf too.' : 'You can add it again later.'
    : foldersExcluded ? 'Its documents will also be excluded from other watched folders so they stay off the shelf.' : 'You can add them again later.';
  return `This removes ${removed} from the shelf. ${after}`;
}
