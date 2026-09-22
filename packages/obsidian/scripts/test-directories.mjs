import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export async function testDirectories({ page, poll, workspace, shelfPath }) {
  const baseline = JSON.parse(await readFile(shelfPath, 'utf8'));
  const directory = path.join(workspace, 'watched-documents');
  await mkdir(path.join(directory, 'nested'), { recursive: true });
  await writeFile(path.join(directory, 'first.md'), '# Folder first\n');
  await writeFile(path.join(directory, 'nested/second.md'), '# Folder second\n');
  const loose = path.join(workspace, 'loose-document.md');
  await writeFile(loose, '# Loose document\n');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').openShelf());
  // Stub only the operating-system chooser in this disposable profile; exercise the real Add flow.
  await page.evaluate(paths => {
    const dialog = require('@electron/remote').dialog;
    window.docshelfPickerTest = { original: dialog.showOpenDialog, calls: [], paths, resolve: null, hold: true };
    dialog.showOpenDialog = options => {
      const state = window.docshelfPickerTest;
      state.calls.push({ options, modalOpen: !!document.querySelector('.docshelf-add, .docshelf-project-picker') });
      return state.hold ? new Promise(resolve => { state.resolve = resolve; }) : Promise.resolve({ canceled: false, filePaths: state.paths });
    };
  }, [directory, loose]);
  const chooseProject = async (name = 'Watched project') => {
    await page.getByRole('textbox', { name: 'Project', exact: true }).fill(name);
    await page.locator('.docshelf-project-picker [data-docshelf-project]').filter({ hasText: name }).click();
  };
  await page.getByLabel('Add…', { exact: true }).first().click();
  await page.waitForSelector('.docshelf-project-picker');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').showAdd());
  assert.equal(await page.locator('.docshelf-project-picker').count(), 1, 'Repeated Add commands must keep one project chooser.');
  assert.equal(await page.evaluate(() => window.docshelfPickerTest.calls.length), 0, 'Choose a project before opening the file picker.');
  await page.getByRole('textbox', { name: 'Project', exact: true }).press('Escape');
  assert.equal(await page.locator('.docshelf-project-picker').count(), 0);
  assert.equal(await page.evaluate(() => window.docshelfPickerTest.calls.length), 0);
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), baseline);

  await page.getByLabel('Add…', { exact: true }).first().click();
  await chooseProject();
  await page.evaluate(() => app.plugins.getPlugin('docshelf').showAdd('Watched project'));
  assert.deepEqual(await page.evaluate(() => window.docshelfPickerTest.calls.map(call => ({ properties: call.options.properties, buttonLabel: call.options.buttonLabel, title: call.options.title, modalOpen: call.modalOpen }))), [{ properties: ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles'], buttonLabel: 'Add', title: 'Add to DocShelf: Watched project', modalOpen: false }]);
  await page.evaluate(() => { window.docshelfPickerTest.resolve({ canceled: true, filePaths: [] }); window.docshelfPickerTest.hold = false; });
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').pickingSources), 'Cancel did not finish the picker.');
  assert.equal(await page.locator('.docshelf-add, .docshelf-project-picker').count(), 0, 'Cancelling the picker must not open another window.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), baseline, 'Cancelling must not create an empty project.');
  await page.getByLabel('Add…', { exact: true }).first().click();
  await chooseProject();
  await poll(() => page.evaluate(count => app.plugins.getPlugin('docshelf').catalog.artifacts.length === count && !app.plugins.getPlugin('docshelf').pickingSources, baseline.artifacts.length + 3), 'Mixed picker selection was not added immediately.');
  assert.equal(await page.locator('.docshelf-add, .docshelf-project-picker').count(), 0, 'Adding from the picker must not open a second window.');
  const saved = JSON.parse(await readFile(shelfPath, 'utf8'));
  assert.equal(saved.directories[0].project, 'Watched project');
  assert.equal(saved.artifacts.find(entry => entry.source.endsWith('loose-document.md')).project, 'Watched project');
  await page.screenshot({ path: '.local/runtime/directories-added.png' });
  await page.getByLabel('Add…', { exact: true }).first().click();
  await chooseProject();
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').pickingSources), 'Repeated selection did not finish.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), saved, 'Repeated selections must not duplicate registrations.');

  const contextual = path.join(workspace, 'context-document.md');
  await writeFile(contextual, '# Context document\n');
  await page.evaluate(file => { window.docshelfPickerTest.paths = [file]; }, contextual);
  const heading = page.locator('.docshelf-project-toggle').first();
  const project = await heading.locator('.docshelf-project-name').textContent();
  await heading.click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Add…' }).click();
  await poll(() => page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), contextual), 'Project-context selection was not added.');
  assert.equal(await page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.find(entry => entry.sourcePath === file).project, contextual), project);
  assert.equal(await page.locator('.docshelf-add').count(), 0);

  const invalid = path.join(workspace, 'unsupported.txt');
  const candidate = path.join(workspace, 'must-not-be-added.md');
  await writeFile(invalid, 'Unsupported file');
  await writeFile(candidate, '# Do not partially add');
  const beforeInvalid = await readFile(shelfPath, 'utf8');
  await page.evaluate(paths => { window.docshelfPickerTest.paths = paths; }, [candidate, invalid]);
  await page.getByLabel('Add…', { exact: true }).first().click();
  await chooseProject();
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').pickingSources), 'Invalid selection did not finish.');
  assert.equal(await readFile(shelfPath, 'utf8'), beforeInvalid, 'An invalid mixed selection must not partially add files.');
  assert.equal(await page.locator('.docshelf-add').count(), 0);
  assert.match(await page.locator('.notice').allTextContents().then(texts => texts.join('\n')), /Choose Markdown or HTML files/);
  const live = path.join(directory, 'nested/live.md');
  await writeFile(live, '# Live discovery\ninitialmarker\n');
  await poll(() => page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), live), 'A new nested document was not discovered.');
  await page.getByRole('searchbox', { name: 'Search DocShelf' }).fill('Live discovery');
  const fromSearch = path.join(workspace, 'search-context.md');
  await writeFile(fromSearch, '# Search context\n');
  await page.evaluate(file => { window.docshelfPickerTest.paths = [file]; }, fromSearch);
  await page.locator('.docshelf-search-result').filter({ hasText: 'Live discovery' }).click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Add…' }).click();
  await poll(() => page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), fromSearch), 'Search-row selection was not added.');
  assert.equal(await page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.find(entry => entry.sourcePath === file).project, fromSearch), 'Watched project');
  assert.equal(await page.locator('.docshelf-add').count(), 0);
  await page.getByRole('searchbox', { name: 'Search DocShelf' }).fill('');
  await page.evaluate(() => { require('@electron/remote').dialog.showOpenDialog = window.docshelfPickerTest.original; delete window.docshelfPickerTest; });
  const openRemove = async title => {
    await page.getByRole('searchbox', { name: 'Search DocShelf' }).fill(title);
    await page.locator('.docshelf-search-result').filter({ hasText: title }).first().click({ button: 'right' });
    await page.locator('.menu-item').filter({ hasText: 'Remove from shelf…' }).click();
    await page.waitForSelector('.docshelf-remove');
    await poll(() => page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).isEnabled(), 'Remove confirmation did not become ready.');
  };
  const beforeRemove = await readFile(shelfPath, 'utf8');
  await openRemove('Context document');
  assert.match(await page.locator('.docshelf-remove').textContent(), /original file or remote document will stay untouched/);
  await page.locator('.docshelf-remove button').filter({ hasText: 'Cancel' }).click();
  assert.equal(await readFile(shelfPath, 'utf8'), beforeRemove);
  await openRemove('Context document');
  await page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).click();
  await poll(() => page.evaluate(file => !app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), contextual), 'Confirmed removal did not remove the document.');
  assert.equal(await readFile(contextual, 'utf8'), '# Context document\n');

  const first = path.join(directory, 'first.md');
  await page.evaluate(async file => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts.find(entry => entry.sourcePath === file));
    const view = app.workspace.getLeavesOfType('docshelf-markdown').find(leaf => leaf.view.artifact?.sourcePath === file).view;
    view.editor.setValue('# Kept removal draft');
    // A real external conflict keeps the draft unsaved while the user opens the menu.
    require('node:fs').writeFileSync(file, '# Folder first externally updated\n');
    await view.save();
  }, first);
  await openRemove('Folder first');
  assert.match(await page.locator('.docshelf-remove').textContent(), /unsaved draft will be kept/);
  assert.match(await page.locator('.docshelf-remove').textContent(), /excluded from its watched folders/);
  await page.screenshot({ path: '.local/runtime/remove-confirmation.png' });
  await page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).click();
  await poll(() => page.evaluate(file => !app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), first), 'Discovered document reappeared after removal.');
  await page.evaluate(file => app.workspace.getLeavesOfType('docshelf-markdown').find(leaf => leaf.view.artifact?.sourcePath === file).view.save(), first);
  assert.equal(await readFile(first, 'utf8'), '# Folder first externally updated\n');
  assert.ok(await page.evaluate(file => app.workspace.getLeavesOfType('docshelf-markdown').some(leaf => leaf.view.artifact?.sourcePath === file && leaf.view.hasUnsavedEdits && leaf.view.editor.getValue() === '# Kept removal draft' && !!leaf.view.saveProblem), first));
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')).directories[0].exclude, ['./first.md']);
  await page.getByRole('searchbox', { name: 'Search DocShelf' }).fill('');
  await page.evaluate(async file => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts.find(entry => entry.sourcePath === file));
  }, live);
  await writeFile(live, '# Live discovery\nupdatedfromoutside\n');
  await poll(() => page.evaluate(() => app.workspace.getLeavesOfType('docshelf-markdown').some(leaf => leaf.view.editor.getValue().includes('updatedfromoutside'))), 'A discovered document did not refresh in the editor.');
  await page.screenshot({ path: '.local/runtime/directories-live.png' });
  // Check removal before the asynchronous catalog watcher can update its cache.
  await page.evaluate(({ file, shelfPath }) => {
    const plugin = app.plugins.getPlugin('docshelf');
    const view = app.workspace.getLeavesOfType('docshelf-markdown').find(leaf => leaf.view.artifact?.sourcePath === file).view;
    view.editor.setValue('# Unsaved folder draft');
    const fs = require('node:fs');
    const shelf = JSON.parse(fs.readFileSync(shelfPath, 'utf8'));
    shelf.directories = [];
    fs.writeFileSync(shelfPath, JSON.stringify(shelf));
    return view.save();
  }, { file: live, shelfPath });
  assert.match(await readFile(live, 'utf8'), /updatedfromoutside/);
  await poll(() => page.evaluate(file => {
    const view = app.workspace.getLeavesOfType('docshelf-markdown').find(leaf => leaf.view.artifact?.sourcePath === file)?.view;
    return view?.hasUnsavedEdits && /no longer registered/.test(view.saveProblem);
  }, live), 'Removing a folder did not preserve and block its unsaved draft.');
  await rm(live);
  await writeFile(shelfPath, JSON.stringify(baseline));
  await poll(() => page.evaluate(count => app.plugins.getPlugin('docshelf').catalog.artifacts.length === count, baseline.artifacts.length), 'Removing a folder left discovered documents in the catalog.');
  console.log('Project selection/creation, immediate mixed-picker registration, cancellation, deduplication, invalid selections, contextual Add, recursive discovery, live edits, confirmed removal/cancellation, exact folder exclusions, source preservation, and unsaved draft protection passed.');
}
