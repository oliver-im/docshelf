import { Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { Settings } from '../core/types';

function fields(container: HTMLElement, plugin: DocShelfPlugin, close?: () => void): void {
  const draft: Settings = { ...plugin.settings };
  container.createEl('p', { text: 'Choose a shelf JSON file. Source paths are resolved relative to that file.', cls: 'docshelf-muted' });
  new Setting(container).setName('Shelf file').setDesc('Absolute path, or a path relative to this vault.').addText(text => text.setValue(draft.shelfPath).setPlaceholder('shelf.local.json').onChange(value => { draft.shelfPath = value.trim(); }));
  new Setting(container).setName('Workspace root').setDesc('Sources and assets must stay inside this folder or the shelf’s folder. Defaults to the parent of the shelf’s folder.').addText(text => text.setValue(draft.workspaceRoot).setPlaceholder('Default workspace').onChange(value => { draft.workspaceRoot = value.trim(); }));
  new Setting(container).setName('Vault ID for links').setDesc('Optional. Use the ID from the vault switcher when multiple vaults have the same name. Otherwise links use this vault’s name.').addText(text => text.setValue(draft.vaultId).setPlaceholder('Use vault name').onChange(value => { draft.vaultId = value.trim(); }));
  new Setting(container).setName('Run HTML scripts').setDesc('Enable interactive reports in the isolated viewer. Reports may load HTTPS resources and contact remote services.').addToggle(toggle => toggle.setValue(draft.runHtmlScripts).onChange(value => { draft.runHtmlScripts = value; }));
  new Setting(container).addButton(button => button.setButtonText('Save and reload').setCta().onClick(async () => {
    button.setDisabled(true);
    try {
      if (!draft.shelfPath) throw new Error('Enter a shelf file path.');
      await plugin.configure(draft);
      if (plugin.error) new Notice(plugin.error);
      else { new Notice('DocShelf settings saved.'); close?.(); }
    } catch (error) { new Notice(String(error)); }
    finally { button.setDisabled(false); }
  }));

  // Use Obsidian's existing preference so its editor settings and DocShelf
  // always agree. These native methods are not declared in the public types.
  const preferences = plugin.app.vault as typeof plugin.app.vault & {
    getConfig(key: 'readableLineLength'): boolean;
    setConfig(key: 'readableLineLength', value: boolean): void;
  };
  new Setting(container).setName('Display').setHeading();
  new Setting(container).setName('Readable line length')
    .setDesc('Limit the text column to a comfortable reading width. Applies immediately and also affects ordinary Markdown notes in this vault.')
    .addToggle(toggle => toggle.setValue(preferences.getConfig('readableLineLength')).onChange(value => preferences.setConfig('readableLineLength', value)));
}

export class ShelfSettingsTab extends PluginSettingTab {
  constructor(private shelf: DocShelfPlugin) { super(shelf.app, shelf); }
  display(): void { this.containerEl.empty(); fields(this.containerEl, this.shelf); }
}

export class ConfigureModal extends Modal {
  constructor(private shelf: DocShelfPlugin) { super(shelf.app); }
  onOpen(): void { this.titleEl.setText('Configure DocShelf'); fields(this.contentEl, this.shelf, () => this.close()); }
  onClose(): void { this.contentEl.empty(); }
}
