import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeEditing({ page, poll, workspace, shelfPath, shelf, pluginPath }) {
  const file = path.join(workspace, 'guide.md');
  const original = await readFile(file, 'utf8');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    const leaf = plugin.nativeViews()[0].leaf;
    await leaf.setViewState({ type: 'docshelf-document', active: true, state: { route: plugin.catalog.artifacts[0].route, mode: 'reading' } });
    await app.workspace.revealLeaf(leaf);
  });
  await poll(() => page.locator('.docshelf-native .cm-content').isVisible(), 'An old reader tab did not migrate to native editing.');
  const value = () => page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.getValue());
  const setValue = text => page.evaluate(text => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.setValue(text), text);
  const problem = () => page.locator('.docshelf-editor-problem:visible').innerText();
  let review;
  const openReview = async () => {
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    review = await poll(async () => {
      for (const candidate of page.context().pages()) {
        if (await candidate.getByRole('textbox', { name: 'Your edits', exact: true }).isVisible()) return candidate;
      }
    }, 'The review dialog did not open.');
  };

  const setMode = mode => page.evaluate(async mode => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    await view.leaf.setViewState({ type: 'docshelf-markdown', active: true, state: { ...view.getState(), mode } });
  }, mode);

  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].file == null), true);
  assert.equal(await page.evaluate(() => app.vault.getMarkdownFiles().length), 0, 'Opening an external document must not create vault notes.');
  assert.equal(await value(), original);
  await page.locator('.docshelf-native .cm-content').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('\nNative keyboard editing.');
  await poll(async () => (await readFile(file, 'utf8')).includes('Native keyboard editing.'), 'Native typing did not autosave the original source.');
  await page.keyboard.press('Meta+z');
  await poll(async () => !(await readFile(file, 'utf8')).includes('Native keyboard editing.'), 'Native undo did not autosave.');
  await setValue(original);
  await poll(async () => (await readFile(file, 'utf8')) === original, 'Restoring the original failed.');

  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setSelection({ line: 6, ch: 0 }, { line: 6, ch: 4 });
    view.editor.focus();
  });
  assert.equal(await page.evaluate(() => app.commands.executeCommandById('editor:toggle-bold')), true);
  await poll(async () => (await value()).includes('**Keep** documents'), 'The native bold command did not work.');
  assert.equal(await page.evaluate(() => app.commands.executeCommandById('editor:save-file')), true);
  await poll(async () => (await readFile(file, 'utf8')).includes('**Keep** documents'), 'The native save command did not persist formatting.');
  await page.screenshot({ path: '.local/runtime/native-editing.png' });
  await setValue(original);
  await poll(async () => (await readFile(file, 'utf8')) === original, 'Formatting cleanup failed.');
  await setMode('preview');
  await page.locator('.docshelf-native .markdown-preview-view:visible h1').waitFor();
  await poll(() => page.locator('.docshelf-native .markdown-preview-view:visible img').evaluateAll(images => images.some(image => image.naturalWidth === 36)), 'Registered images did not render in native reading mode.');
  await setMode('source');
  assert.equal(await page.locator('.view-header-title:visible').last().textContent(), 'Project field notes');
  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setCursor({ line: 12, ch: 35 });
  });
  const liveLink = page.locator('.docshelf-native .cm-link').filter({ hasText: 'release report' }).first();
  await liveLink.click({ modifiers: ['Meta'] });
  await page.locator('webview.docshelf-webview').waitFor();
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[0], null, '#review-checklist');
  });
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.getCursor().line), 10);
  assert.equal(await page.evaluate(() => app.vault.getMarkdownFiles().length), 0);
  await setValue(`${original}\n- [ ] Native task\n`);
  // Switch immediately, before the autosave debounce or watcher can refresh it.
  await setMode('preview');
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getViewData()), `${original}\n- [ ] Native task\n`);
  // Native reading mode virtualizes offscreen blocks. Bring the appended task
  // into view before waiting for its checkbox to exist.
  await poll(async () => {
    await page.locator('.docshelf-native .markdown-preview-view:visible').evaluate(el => { el.scrollTop = el.scrollHeight; });
    return page.locator('.docshelf-native .markdown-preview-view:visible .task-list-item-checkbox').count();
  }, 'The appended task did not render in native reading mode.');
  await page.locator('.docshelf-native .markdown-preview-view:visible .task-list-item-checkbox').click();
  await poll(async () => (await readFile(file, 'utf8')).includes('- [x] Native task'), 'A native reading-mode checkbox did not save.');
  await setMode('source');
  await setValue(original);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  console.log('Native Live Preview, typing, formatting, undo, save, reading mode, and registered images passed.');

  // A clean view adopts external changes; a dirty view retains its own buffer.
  const outside = `${original}\nExternal writer change.\n`;
  await writeFile(file, outside);
  await poll(async () => (await value()) === outside, 'A clean native editor did not refresh from disk.');
  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setCursor({ line: 6, ch: 4 });
  });
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.getCursor()), { line: 6, ch: 4 });
  const mine = `${outside}\nMy unsaved change.\n`;
  const theirs = `${outside}\nConcurrent external change.\n`;
  await setValue(mine);
  await writeFile(file, theirs);
  await poll(async () => (await problem()).includes('changed outside'), 'A concurrent change did not show a conflict.');
  assert.equal(await value(), mine);
  assert.equal(await readFile(file, 'utf8'), theirs);
  await setMode('preview');
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getViewData()), mine, 'Reading mode must preserve the conflicted draft.');
  await setMode('source');
  assert.equal(await value(), mine);
  assert.equal(await readFile(file, 'utf8'), theirs);
  const recoveryNames = await readdir(path.join(pluginPath, 'recovery'));
  assert.ok(recoveryNames.some(name => name.endsWith('.json')));
  await page.screenshot({ path: '.local/runtime/native-conflict.png' });
  await openReview();
  const dialog = review.getByRole('textbox', { name: 'Your edits', exact: true });
  await review.screenshot({ path: '.local/runtime/native-review.png' });
  await dialog.fill(`${theirs}\nMerged native edit.\n`);
  await review.getByRole('button', { name: 'Save edited version', exact: true }).click();
  await poll(async () => (await readFile(file, 'utf8')).includes('Merged native edit.'), 'Reviewed merge did not save.');
  assert.ok((await readFile(file, 'utf8')).includes('Concurrent external change.'));

  // An external write after opening review must still be checked at save time.
  await setValue(`${await value()}Another draft.\n`);
  await writeFile(file, `${theirs}Another external write.\n`);
  await poll(async () => (await problem()).includes('changed outside'), 'The second conflict did not appear.');
  await openReview();
  const latest = `${theirs}Changed during review.\n`;
  await writeFile(file, latest);
  await review.getByRole('button', { name: 'Save edited version', exact: true }).click();
  assert.equal(await readFile(file, 'utf8'), latest);
  assert.ok((await problem()).includes('changed outside'));
  await openReview();
  await review.getByRole('button', { name: 'Use disk version', exact: true }).click();
  assert.equal(await value(), latest);
  console.log('External refresh, cursor preservation, conflicts, reviewed merges, and changes during review passed.');

  // Persist a conflicted buffer, destroy the view, and recover after reopening.
  const recoverMe = `${latest}Recover this draft.\n`;
  await setValue(recoverMe);
  await writeFile(file, original);
  await poll(async () => (await problem()).includes('changed outside'), 'The recovery conflict did not appear.');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    const view = plugin.nativeViews()[0];
    const state = JSON.parse(JSON.stringify(view.leaf.getViewState()));
    const leaf = view.leaf;
    await leaf.setViewState({ type: 'empty' });
    await leaf.setViewState(state);
  });
  assert.equal(await value(), recoverMe);
  assert.ok((await problem()).includes('Recovered unsaved edits'));
  assert.equal(await readFile(file, 'utf8'), original);
  await openReview();
  await review.getByRole('button', { name: 'Use disk version', exact: true }).click();
  assert.equal(await value(), original);

  // A removed registration prevents saves without destroying the open buffer.
  await setValue(`${original}Removed registration draft.\n`);
  await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [shelf.artifacts[1]] }));
  await poll(async () => (await problem()).includes('no longer registered'), 'Removing a registration did not stop editing saves.');
  assert.equal(await readFile(file, 'utf8'), original);
  assert.ok((await value()).includes('Removed registration draft.'));
  await writeFile(shelfPath, JSON.stringify(shelf));
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  await openReview();
  await review.getByRole('button', { name: 'Use disk version', exact: true }).click();

  // Missing sources must not be recreated by autosave.
  await setValue(`${original}Missing source draft.\n`);
  await rm(file);
  await poll(async () => (await problem()).includes('ENOENT'), 'A missing file did not stop editing saves.');
  assert.ok((await value()).includes('Missing source draft.'));
  await writeFile(file, original);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  await openReview();
  await review.getByRole('button', { name: 'Use disk version', exact: true }).click();
  assert.equal(await value(), original);
  assert.equal(await readFile(file, 'utf8'), original);
  // Two panes have independent buffers and recovery records.
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    const first = plugin.nativeViews()[0];
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'docshelf-markdown', active: true, state: first.getState() });
    await app.workspace.revealLeaf(leaf);
    const second = leaf.view;
    if (first.draftId === second.draftId) throw new Error('Editor panes shared a recovery record.');
    first.editor.setValue(first.editor.getValue() + 'First pane edit.\n');
    second.editor.setValue(second.editor.getValue() + 'Second pane edit.\n');
    await first.save();
    await second.save();
  });
  assert.ok((await readFile(file, 'utf8')).includes('First pane edit.'));
  assert.ok(!(await readFile(file, 'utf8')).includes('Second pane edit.'));
  await openReview();
  await review.getByRole('button', { name: 'Use disk version', exact: true }).click();
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    plugin.nativeViews()[1].leaf.detach();
    await plugin.openArtifact(plugin.catalog.artifacts[0]);
  });
  await setValue(original);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  assert.equal(await readFile(file, 'utf8'), original);
  console.log('Recovery across view restart, removed registrations, missing sources, and source preservation passed.');
}
