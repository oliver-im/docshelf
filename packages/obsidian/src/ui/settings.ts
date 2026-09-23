import { Modal, Notice, PluginSettingTab, Setting, type SettingDefinitionRender } from 'obsidian';
import type DocShelfPlugin from '../main';
import type { Settings } from '../core/types';

type SettingRow = Omit<SettingDefinitionRender, 'render'> & { render: (setting: Setting) => void };

function settingsRows(plugin: DocShelfPlugin, close?: () => void): SettingRow[] {
  // Keep edits as a draft until Save and reload, including in search results.
  const draft: Settings = { ...plugin.settings };
  const preferences = plugin.app.vault as typeof plugin.app.vault & {
    getConfig(key: 'readableLineLength'): boolean;
    setConfig(key: 'readableLineLength', value: boolean): void;
  };
  return [
    { name: 'Shelf file', desc: 'Absolute path, or a path relative to this vault. Source paths are resolved relative to this file.',
      render: setting => { setting.addText(text => text.setValue(draft.shelfPath).setPlaceholder('shelf.local.json').onChange(value => { draft.shelfPath = value.trim(); })); } },
    { name: 'Workspace root', desc: 'Sources and assets must stay inside this folder or the shelf’s folder. Defaults to the parent of the shelf’s folder.',
      render: setting => { setting.addText(text => text.setValue(draft.workspaceRoot).setPlaceholder('Default workspace').onChange(value => { draft.workspaceRoot = value.trim(); })); } },
    { name: 'Vault ID for links', desc: 'Optional. Use the ID from the vault switcher when multiple vaults have the same name. Otherwise links use this vault’s name.',
      render: setting => { setting.addText(text => text.setValue(draft.vaultId).setPlaceholder('Use vault name').onChange(value => { draft.vaultId = value.trim(); })); } },
    { name: 'Run HTML scripts', desc: 'Enable interactive reports in the isolated viewer. Reports may load HTTPS resources and contact remote services.',
      render: setting => { setting.addToggle(toggle => toggle.setValue(draft.runHtmlScripts).onChange(value => { draft.runHtmlScripts = value; })); } },
    { name: 'Apply shelf settings', desc: 'Save changes to the shelf file, workspace root, link identity, and HTML scripts together.',
      // Keep this action next to every search result that edits a draft setting.
      aliases: ['shelf file', 'workspace root', 'vault ID for links', 'run HTML scripts'],
      render: setting => { setting.addButton(button => button.setButtonText('Save and reload').setCta().onClick(async () => {
        button.setDisabled(true);
        try {
          if (!draft.shelfPath) throw new Error('Enter a shelf file path.');
          await plugin.configure({ ...draft });
          if (plugin.error) new Notice(plugin.error);
          else { new Notice('DocShelf settings saved.'); close?.(); }
        } catch (error) { new Notice(String(error)); }
        finally { button.setDisabled(false); }
      })); } },
    { name: 'Readable line length', desc: 'Limit the text column to a comfortable reading width. Applies immediately and also affects ordinary Markdown notes in this vault.',
      render: setting => { setting.addToggle(toggle => toggle.setValue(preferences.getConfig('readableLineLength')).onChange(value => preferences.setConfig('readableLineLength', value))); } },
  ];
}

function fields(container: HTMLElement, plugin: DocShelfPlugin, close?: () => void): void {
  for (const row of settingsRows(plugin, close)) {
    const setting = new Setting(container).setName(row.name).setDesc(row.desc || '');
    row.render(setting);
  }
}

export class ShelfSettingsTab extends PluginSettingTab {
  constructor(private shelf: DocShelfPlugin) { super(shelf.app, shelf); }
  getSettingDefinitions(): SettingDefinitionRender[] { return settingsRows(this.shelf); }
}

export class ConfigureModal extends Modal {
  constructor(private shelf: DocShelfPlugin) { super(shelf.app); }
  onOpen(): void { this.titleEl.setText('Configure DocShelf'); fields(this.contentEl, this.shelf, () => this.close()); }
  onClose(): void { this.contentEl.empty(); }
}
