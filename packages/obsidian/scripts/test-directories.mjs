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
  // Folder documents nest as they sit on disk, while the loose file stays at the project root.
  const outline = () => page.evaluate(() => {
    const group = [...document.querySelectorAll('.docshelf-project')].find(group => group.querySelector('.docshelf-project-name')?.textContent === 'Watched project');
    const walk = parent => [...parent.children].map(child => child.matches('.docshelf-folder')
      ? { [child.querySelector(':scope > .docshelf-folder-toggle').textContent]: walk(child.querySelector(':scope > .docshelf-folder-items')) }
      : child.querySelector('.docshelf-item-title').textContent);
    return group && walk(group.querySelector('.docshelf-project-items'));
  });
  const expectedOutline = JSON.stringify([{ 'watched-documents': [{ nested: ['second.md'] }, 'first.md'] }, 'loose-document.md']);
  await poll(async () => JSON.stringify(await outline()) === expectedOutline, 'Folder documents did not nest as they sit on disk.');
  await page.screenshot({ path: '.local/runtime/directories-added.png' });
  const folderToggle = page.locator('.docshelf-folder-toggle[data-project="Watched project"]').filter({ has: page.getByText('watched-documents', { exact: true }) });
  const folderId = await folderToggle.getAttribute('data-folder');
  await folderToggle.click();
  assert.equal(await folderToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.docshelf-item').filter({ hasText: 'Folder second' }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => app.workspace.getLeavesOfType('docshelf-shelf')[0].view.getState().collapsedFolders), [JSON.stringify(['Watched project', folderId])]);
  await folderToggle.click();
  assert.equal(await page.locator('.docshelf-item').filter({ hasText: 'Folder second' }).isVisible(), true);
  // Reordering stays within a folder, so a document alone in its folder cannot move.
  await page.locator('.docshelf-item').filter({ hasText: 'Folder first' }).click({ button: 'right' });
  assert.deepEqual(await page.locator('.menu-item').filter({ hasText: /^Move (up|down)$/ }).evaluateAll(items => items.map(item => item.classList.contains('is-disabled'))), [true, true]);
  await page.keyboard.press('Escape');
  await page.getByLabel('Add…', { exact: true }).first().click();
  await chooseProject();
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').pickingSources), 'Repeated selection did not finish.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), saved, 'Repeated selections must not duplicate registrations.');

  await page.evaluate(() => { window.docshelfPickerTest.paths = []; });
  await page.getByLabel('Add…', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Project', exact: true }).fill('Watched');
  await page.getByRole('textbox', { name: 'Project', exact: true }).press('Enter');
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').pickingSources), 'Typed project selection did not finish.');
  assert.equal(await page.evaluate(() => window.docshelfPickerTest.calls.at(-1).options.title), 'Add to DocShelf: Watched');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), saved, 'An empty picker must leave the shelf unchanged.');

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
  assert.equal(await page.locator('.docshelf-search-result').filter({ hasText: 'Live discovery' }).locator('.docshelf-item-project').textContent(), 'Watched project › watched-documents/nested');
  await page.locator('.docshelf-search-result').filter({ hasText: 'Live discovery' }).click({ button: 'right' });
  assert.equal(await page.locator('.menu-item').filter({ hasText: /^Move (up|down)$/ }).count(), 0, 'Search rows must not reorder the hidden project list.');
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
  const removedRoute = await page.evaluate(file => app.plugins.getPlugin('docshelf').nativeViews().find(view => view.artifact?.sourcePath === file).route, first);
  await page.evaluate(file => app.plugins.getPlugin('docshelf').addSources([file], 'Watched project'), first);
  await poll(() => page.evaluate(({ file, removedRoute }) => {
    const plugin = app.plugins.getPlugin('docshelf');
    const view = plugin.nativeViews().find(view => view.artifact?.sourcePath === file);
    return view?.route !== removedRoute && view?.route === plugin.catalog.artifacts.find(artifact => artifact.sourcePath === file)?.route;
  }, { file: first, removedRoute }), 'The open draft did not reconnect to the re-added source.');
  await page.evaluate(file => app.plugins.getPlugin('docshelf').nativeViews().find(view => view.artifact?.sourcePath === file).save(), first);
  assert.equal(await readFile(first, 'utf8'), '# Folder first externally updated\n', 'Re-registration must not bypass an external conflict.');
  // Once the original baseline returns, the same open draft can resume saving.
  await writeFile(first, '# Folder first\n');
  await poll(async () => (await readFile(first, 'utf8')) === '# Kept removal draft', 'The reconnected draft could not save after its conflict cleared.');
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

  // A closed draft must also recover when the new registration has a different route.
  await page.evaluate(file => app.plugins.getPlugin('docshelf').nativeViews().find(view => view.artifact?.sourcePath === file).leaf.detach(), live);
  await page.evaluate(async file => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.addSources([file], 'Restored');
    await plugin.openArtifact(plugin.catalog.artifacts.find(artifact => artifact.sourcePath === file));
  }, live);
  await poll(() => page.evaluate(file => {
    const view = app.plugins.getPlugin('docshelf').nativeViews().find(view => view.artifact?.sourcePath === file);
    return view?.editor.getValue() === '# Unsaved folder draft' && view.recoveryReviewRequired;
  }, live), 'A closed draft was not recovered through the new registration.');
  assert.match(await readFile(live, 'utf8'), /updatedfromoutside/);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = await poll(async () => {
    for (const candidate of page.context().pages()) {
      if (await candidate.getByRole('textbox', { name: 'Your edits', exact: true }).isVisible()) return candidate;
    }
  }, 'Recovered draft review did not open.');
  assert.equal(await review.getByRole('textbox', { name: 'Your edits', exact: true }).inputValue(), '# Unsaved folder draft');
  await review.getByRole('button', { name: 'Save edited version', exact: true }).click();
  await poll(async () => (await readFile(live, 'utf8')) === '# Unsaved folder draft', 'The recovered draft could not save after review.');
  // Folder rows reorder among themselves, and removing one keeps files added to it later off the shelf.
  const alphaNote = path.join(directory, 'alpha/alpha-note.md');
  await mkdir(path.dirname(alphaNote));
  await writeFile(alphaNote, '# Alpha note\n');
  await page.evaluate(folder => app.plugins.getPlugin('docshelf').addSources([folder], 'Removable project'), directory);
  const folderRow = name => page.locator('.docshelf-folder-toggle[data-project="Removable project"]').filter({ has: page.getByText(name, { exact: true }) });
  const folderNames = () => page.evaluate(() => [...document.querySelectorAll('.docshelf-folder-toggle[data-project="Removable project"]')].map(toggle => toggle.querySelector('.docshelf-folder-name').textContent).slice(1));
  const moveFolder = async (name, direction) => {
    await folderRow(name).click({ button: 'right' });
    await page.locator('.menu-item').filter({ hasText: new RegExp(`^Move ${direction}$`) }).click();
  };
  const savedFolderOrder = () => page.evaluate(() => app.workspace.getLeavesOfType('docshelf-shelf')[0].view.getState().folderOrder);
  await poll(async () => JSON.stringify(await folderNames()) === JSON.stringify(['alpha', 'nested']), 'Project folders did not render alphabetically.');
  const parentId = await folderRow('watched-documents').getAttribute('data-folder');
  const alphaId = await folderRow('alpha').getAttribute('data-folder');
  const nestedId = await folderRow('nested').getAttribute('data-folder');
  await moveFolder('nested', 'up');
  assert.deepEqual(await folderNames(), ['nested', 'alpha']);
  assert.equal(await folderRow('nested').evaluate(el => el === document.activeElement), true);
  assert.deepEqual(await savedFolderOrder(), { [JSON.stringify(['Removable project', parentId])]: [nestedId, alphaId] });
  await folderRow('alpha').dragTo(folderRow('nested'), { targetPosition: { x: 30, y: 2 } });
  assert.deepEqual(await folderNames(), ['alpha', 'nested']);
  await moveFolder('alpha', 'down');
  assert.deepEqual(await folderNames(), ['nested', 'alpha']);
  await page.locator('.docshelf-project-toggle').filter({ hasText: 'Removable project' }).click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Reset to alphabetical' }).click();
  assert.deepEqual(await folderNames(), ['alpha', 'nested']);
  assert.deepEqual(await savedFolderOrder(), {});
  await folderRow('alpha').click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Remove from shelf…' }).click();
  await page.waitForSelector('.docshelf-remove');
  await poll(() => page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).isEnabled(), 'Folder removal confirmation did not become ready.');
  assert.match(await page.locator('.docshelf-remove').textContent(), /“watched-documents\/alpha” folder[\s\S]*1 document from the shelf\. Files added to this folder later will stay off the shelf too\./);
  await page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).click();
  await poll(() => page.evaluate(file => !app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), alphaNote), 'Removing a folder left its document on the shelf.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')).directories.find(entry => entry.project === 'Removable project').exclude, ['./alpha']);
  assert.equal(await readFile(alphaNote, 'utf8'), '# Alpha note\n');
  const laterAlpha = path.join(directory, 'alpha/later.md');
  await writeFile(laterAlpha, '# Later alpha\n');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  assert.equal(await page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.sourcePath === file), laterAlpha), false, 'A file added to a removed folder reappeared.');
  await poll(async () => JSON.stringify(await folderNames()) === JSON.stringify(['nested']), 'The removed folder row did not disappear.');

  // A project heading removes its watched folder and documents from the shelf only.
  await page.locator('.docshelf-project-toggle').filter({ hasText: 'Removable project' }).click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Remove from shelf…' }).click();
  await page.waitForSelector('.docshelf-remove');
  await poll(() => page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).isEnabled(), 'Project removal confirmation did not become ready.');
  assert.match(await page.locator('.docshelf-remove').textContent(), /“Removable project” project[\s\S]*1 watched folder/);
  await page.screenshot({ path: '.local/runtime/remove-project-confirmation.png' });
  await page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).click();
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').catalog.artifacts.some(entry => entry.project === 'Removable project')), 'Removing a project left its documents on the shelf.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')).directories, []);
  assert.equal(await readFile(path.join(directory, 'nested/second.md'), 'utf8'), '# Folder second\n');

  // Explicit empty registrations remain in the same tree, preserving identity and collapse state.
  const emptyRoot = path.join(workspace, 'empty-watched');
  await mkdir(path.join(emptyRoot, 'unregistered'), { recursive: true });
  await page.evaluate(folder => app.plugins.getPlugin('docshelf').addSources([folder], 'Empty project'), emptyRoot);
  const emptyProject = page.locator('.docshelf-project-toggle[data-project="Empty project"]');
  const emptyRow = page.locator('.docshelf-folder-toggle[data-project="Empty project"]');
  await poll(() => emptyRow.isVisible(), 'An empty watched folder was hidden.');
  assert.equal(await emptyRow.count(), 1, 'Unregistered empty descendants must remain hidden.');
  assert.equal(await emptyRow.locator('.docshelf-folder-empty').textContent(), 'No documents');
  assert.equal(await emptyProject.locator('.docshelf-project-count').textContent(), '0');
  const emptyKey = await emptyRow.getAttribute('data-folder');
  await emptyRow.click();
  assert.equal(await emptyRow.getAttribute('aria-expanded'), 'false');
  await poll(() => page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf');
    return plugin.watcher?._readyEmitted && !plugin.loading && !plugin.refreshPending && plugin.timer === null;
  }), 'The empty folder watch did not finish starting.');
  const newNote = path.join(emptyRoot, 'arrived.md');
  await writeFile(newNote, '# Arrived later\n');
  await poll(() => page.evaluate(file => {
    const plugin = app.plugins.getPlugin('docshelf');
    return plugin.catalog.artifacts.some(artifact => artifact.sourcePath === file) && !plugin.loading && !plugin.refreshPending && plugin.timer === null && plugin.watcher._pendingWrites.size === 0;
  }, newNote), 'An empty folder stopped watching for documents.');
  await poll(async () => await emptyRow.locator('.docshelf-folder-empty').count() === 0, 'The empty-folder label remained after discovery.');
  assert.equal(await emptyRow.getAttribute('data-folder'), emptyKey);
  assert.equal(await emptyRow.getAttribute('aria-expanded'), 'false', 'Discovery must preserve folder collapse state.');
  await rm(newNote);
  await poll(() => emptyRow.locator('.docshelf-folder-empty').isVisible(), 'The folder disappeared when its last document was removed.');
  assert.equal(await emptyRow.getAttribute('data-folder'), emptyKey);
  await page.screenshot({ path: '.local/runtime/empty-watched-folder.png' });
  await emptyRow.press('Shift+F10');
  await page.locator('.menu-item').filter({ hasText: 'Remove from shelf…' }).click();
  await poll(() => page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).isEnabled(), 'Empty folder removal did not become ready.');
  assert.match(await page.locator('.docshelf-remove').textContent(), /1 watched folder/);
  await page.locator('.docshelf-remove button').filter({ hasText: /^Remove$/ }).click();
  await poll(async () => await emptyProject.count() === 0, 'The last registration left an empty project behind.');
  assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')).directories, []);
  await writeFile(newNote, '# After removal\n');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  assert.equal(await page.evaluate(file => app.plugins.getPlugin('docshelf').catalog.artifacts.some(artifact => artifact.sourcePath === file), newNote), false);

  await rm(live);
  await writeFile(shelfPath, JSON.stringify(baseline));
  await poll(() => page.evaluate(count => app.plugins.getPlugin('docshelf').catalog.artifacts.length === count, baseline.artifacts.length), 'Removing a folder left discovered documents in the catalog.');
  console.log('Project selection/creation, immediate mixed-picker registration, cancellation, deduplication, invalid selections, contextual Add, recursive discovery, live edits, nested folder rows, folder and document ordering, confirmed document, folder, and project removal/cancellation, exact folder exclusions, source preservation, and unsaved draft protection passed.');
}
