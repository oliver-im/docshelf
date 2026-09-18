import assert from 'node:assert/strict';

export async function selectNativeMode(page, poll, title) {
  const before = await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    window.docshelfModeMenuEvent = app.workspace.on('leaf-menu', menu => menu.setUseNativeMenu(false));
    return { mode: view.getMode(), source: view.getState().source === true };
  });
  try {
    await page.locator('.workspace-leaf-content[data-type="docshelf-markdown"]:visible').getByRole('button', { name: 'More options', exact: true }).click();
    // Obsidian can render header menus in a separate popup document.
    const menuPage = await poll(async () => {
      for (const candidate of page.context().pages()) {
        if (await candidate.locator('.menu').getByText(title, { exact: true }).isVisible()) return candidate;
      }
    }, 'The native mode menu did not open.');
    // Its screen coordinates can lie outside Playwright's virtual viewport.
    // Dispatch the item's DOM click, exercising its real registered handler.
    await menuPage.locator('.menu').getByText(title, { exact: true }).dispatchEvent('click', { button: 0 });
    await poll(() => page.evaluate(({ title, before }) => {
      const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
      return !!view && (title === 'Reading view' ? view.getMode() !== before.mode : (view.getState().source === true) !== before.source);
    }, { title, before }), `${title} must switch modes without replacing the external document.`);
  } finally {
    await page.evaluate(() => { app.workspace.offref(window.docshelfModeMenuEvent); delete window.docshelfModeMenuEvent; });
  }
}

export async function testNativeModes({ page, poll }) {
  const state = () => page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    return view && { leaf: view.leaf.id, route: view.route, draft: view.draftId, mode: view.getMode(), source: view.getState().source === true,
      text: view.getViewData(), file: view.file, reference: view.getState().referenceLines };
  });
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.scrollTo(0, 0));
  await page.locator('.docshelf-native button[data-start="7"]').click();
  const before = await state();
  for (const [title, mode, source] of [
    ['Source mode', 'source', true], ['Reading view', 'preview', true],
    ['Reading view', 'source', true], ['Source mode', 'source', false],
  ]) {
    await selectNativeMode(page, poll, title);
    assert.deepEqual(await state(), { ...before, mode, source }, 'Menu mode changes must retain the document, draft, and source reference.');
    assert.equal(await page.locator('.workspace-leaf-content[data-type="docshelf-markdown"] .view-header').getByRole('button', { name: /Current view:/ }).count(), 0);
  }
  for (const [command, mode, source] of [
    ['editor:toggle-source', 'source', true], ['editor:toggle-source', 'source', false],
    ['markdown:toggle-preview', 'preview', false], ['markdown:toggle-preview', 'source', false],
  ]) {
    await page.evaluate(() => app.workspace.setActiveLeaf(app.plugins.getPlugin('docshelf').nativeViews()[0].leaf, { focus: true }));
    assert.equal(await page.evaluate(command => app.commands.executeCommandById(command), command), true);
    await poll(async () => { const current = await state(); return current?.mode === mode && current.source === source; }, 'A native mode command replaced the DocShelf view.');
    assert.deepEqual(await state(), { ...before, mode, source });
  }
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();

  // A real vault-file navigation must bypass and remove the leaf adaptation.
  const ordinary = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf'), leaf = plugin.nativeViews()[0].leaf;
    const adapted = leaf.setViewState;
    const file = await app.vault.create('Mode navigation.md', '# Ordinary vault note\n');
    await leaf.openFile(file);
    const result = { type: leaf.view.getViewType(), file: leaf.view.file?.path, restored: leaf.setViewState !== adapted };
    await app.vault.delete(file);
    await plugin.openArtifact(plugin.catalog.artifacts[0], null, '', leaf);
    return result;
  });
  assert.deepEqual(ordinary, { type: 'markdown', file: 'Mode navigation.md', restored: true });
  console.log('Native mode menus and commands preserve external documents, drafts and references; ordinary vault navigation remains intact.');
}
