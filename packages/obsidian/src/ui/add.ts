import { Modal, SuggestModal } from 'obsidian';
import path from 'node:path';
import type DocShelfPlugin from '../main';
import { message } from '../core/types';

export async function pickSources(shelfPath: string, project: string): Promise<string[]> {
  const { dialog } = require('@electron/remote') as { dialog: { showOpenDialog(options: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }> } };
  const result = await dialog.showOpenDialog({ title: `Add to DocShelf: ${project}`, buttonLabel: 'Add', properties: ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles'], defaultPath: path.dirname(shelfPath) });
  return result.canceled ? [] : result.filePaths;
}

interface ProjectChoice { name: string; create: boolean }

export class ProjectPicker extends SuggestModal<ProjectChoice> {
  constructor(private plugin: DocShelfPlugin, private choose: (project: string) => void, private dismiss: () => void) {
    super(plugin.app);
    this.modalEl.addClass('docshelf-project-picker');
    this.setPlaceholder('Choose a project or type a new name…');
    this.inputEl.setAttribute('aria-label', 'Project');
    this.inputEl.maxLength = 300;
    this.emptyStateText = 'Type a name to create a project.';
    this.setInstructions([{ command: '↑↓', purpose: 'Choose project' }, { command: '↵', purpose: 'Choose files and folders' }, { command: 'esc', purpose: 'Cancel' }]);
  }

  getSuggestions(query: string): ProjectChoice[] {
    const name = query.trim();
    const projects = [...new Set([
      ...(this.plugin.catalog?.artifacts || []).map(artifact => artifact.project),
      ...(this.plugin.catalog?.directories || []).map(directory => directory.project),
    ])].sort((a, b) => a.localeCompare(b));
    const matches = projects.filter(project => project.toLocaleLowerCase().includes(name.toLocaleLowerCase())).map(project => ({ name: project, create: false }));
    if (name && name.length <= 300 && !projects.includes(name)) matches.push({ name, create: true });
    return matches;
  }

  renderSuggestion(choice: ProjectChoice, el: HTMLElement): void {
    el.dataset.docshelfProject = choice.name;
    el.setText(choice.create ? `Create project “${choice.name}”` : choice.name);
  }

  onChooseSuggestion(choice: ProjectChoice): void { this.choose(choice.name); }
  onClose(): void { super.onClose(); this.dismiss(); }
}

/** Path entry for platforms without a combined native file/folder picker. */
export class AddModal extends Modal {
  constructor(private plugin: DocShelfPlugin, private project: string) { super(plugin.app); }

  onOpen(): void {
    this.titleEl.setText('Add to shelf');
    this.contentEl.addClass('docshelf-add');
    this.contentEl.createEl('p', { text: 'Choose files, folders, or a mixture. Folders include their subfolders and update automatically.' });
    this.contentEl.createEl('label', { text: 'Files or folders', attr: { for: 'docshelf-add-sources' } });
    const sources = this.contentEl.createEl('textarea', { attr: { id: 'docshelf-add-sources', rows: '5', placeholder: 'One path per line, absolute or relative to the shelf file', 'aria-label': 'Files or folders' } });
    let pending = false;
    this.scope.register([], 'Escape', () => { if (!pending) this.close(); return false; });
    this.contentEl.createEl('p', { text: `Project: ${this.project}` });
    this.contentEl.createEl('p', { cls: 'docshelf-muted', text: 'Hidden descendants, dependencies, and generated folders are skipped. You can select a hidden folder directly.' });
    const error = this.contentEl.createDiv({ cls: 'docshelf-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'docshelf-add-actions' });
    actions.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    const action = actions.createEl('button', { text: 'Add', cls: 'mod-cta' });
    action.onclick = async () => {
      if (pending) return;
      pending = true; action.disabled = true; action.setText('Adding…'); error.setText('');
      try {
        await this.plugin.addSources(sources.value.split('\n').map(value => value.trim()).filter(Boolean), this.project);
        this.close();
      } catch (caught) { error.setText(message(caught)); }
      finally { pending = false; action.disabled = false; action.setText('Add'); }
    };
    this.onClose = () => this.contentEl.empty();
    sources.focus();
  }
}
