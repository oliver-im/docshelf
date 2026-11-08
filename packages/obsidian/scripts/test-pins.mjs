import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function testDocumentPins({ page, poll, shelfPath }) {
  const baseline = await readFile(shelfPath, 'utf8');
  const shelf = JSON.parse(baseline);
  const original = shelf.artifacts[0];
  const otherShelf = `${shelfPath}.pins-test.json`;
  const settings = await page.evaluate(() => ({ ...app.plugins.getPlugin('docshelf').settings }));
  const pins = page.locator('.docshelf-pinned .docshelf-item');
  try {
    const row = page.locator(`.docshelf-project .docshelf-item[data-route="${original.route}"]`);
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByText('Pin document', { exact: true }).click();
    await poll(async () => await pins.count() === 1, 'Pinning did not create a shortcut.');
    assert.equal(await row.locator('.docshelf-pin-icon').count(), 1, 'The original document must stay in its project with a pin marker.');
    assert.equal(await pins.locator('.docshelf-item-project').textContent(), original.project);
    assert.equal(await pins.getAttribute('draggable'), null, 'A shortcut must not reorder documents in their original folder.');
    await pins.focus();
    await pins.press('Shift+F10');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.menu').count(), 0, 'Escape must dismiss the pin menu.');
    await page.screenshot({ path: '.local/runtime/document-pins.png' });

    await page.evaluate(async () => {
      await app.plugins.disablePlugin('docshelf');
      await app.plugins.enablePlugin('docshelf');
      await app.plugins.getPlugin('docshelf').ready;
      await app.plugins.getPlugin('docshelf').openShelf();
    });
    await poll(async () => await pins.count() === 1, 'Pins did not survive plugin reload.');
    shelf.artifacts[0] = { ...original, route: 'renamed/guide.html', title: 'Renamed guide' };
    await writeFile(shelfPath, JSON.stringify(shelf));
    await poll(async () => await pins.getAttribute('data-route') === 'renamed/guide.html', 'A route change lost the document pin.');
    await pins.click();
    await poll(() => page.evaluate(() => app.workspace.activeLeaf?.view?.artifact?.route === 'renamed/guide.html'), 'The shortcut opened a stale route.');

    await writeFile(otherShelf, JSON.stringify(shelf));
    await page.evaluate(settings => app.plugins.getPlugin('docshelf').configure(settings), { ...settings, shelfPath: otherShelf });
    assert.equal(await pins.count(), 0, 'Pins from one shelf must not leak into another shelf containing the same document.');
    await page.evaluate(settings => app.plugins.getPlugin('docshelf').configure(settings), settings);
    await poll(async () => await pins.count() === 1, 'Returning to the shelf lost its pins.');
    const project = page.locator('.docshelf-project-toggle').filter({ hasText: original.project });
    if (await project.getAttribute('aria-expanded') === 'true') await project.click();
    await pins.click({ button: 'right' });
    await page.getByText('Unpin document', { exact: true }).click();
    await poll(async () => await pins.count() === 0, 'Unpinning the shortcut did not remove it.');
    assert.equal(await page.locator('.docshelf-project .docshelf-item[data-route="renamed/guide.html"]').count(), 1);
    assert.equal(await page.locator('.docshelf-pin-icon').count(), 0);
    assert.equal(await page.locator('.docshelf-project .docshelf-item[data-route="renamed/guide.html"]').evaluate(el => el === document.activeElement), true, 'Unpinning must restore focus even when the original project was collapsed.');
    // Storage can reject a write; never present an unsaved pin as successful.
    const failedSave = await page.evaluate(async () => {
      const plugin = app.plugins.getPlugin('docshelf');
      const key = plugin.pinsKey;
      const original = Storage.prototype.setItem;
      let attempted = false;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) { attempted = true; throw new Error('Quota exceeded'); }
        return original.call(this, name, value);
      };
      try {
        await plugin.pinDocument(plugin.catalog.artifacts[0], true);
        // Obsidian 1.14 can show notices in its active popout window.
        return { attempted, notices: [...activeWindow.document.querySelectorAll('.notice')].map(el => el.textContent) };
      } finally {
        Storage.prototype.setItem = original;
      }
    });
    assert.equal(failedSave.attempted, true, 'The storage failure must reach the real pin writer.');
    assert.match(failedSave.notices.join('\n'), /Pin could not be saved:.*Quota exceeded/, 'A failed save must explain the storage error.');
    assert.equal(await pins.count(), 0, 'A failed save must not add a shortcut.');
    assert.equal(await page.locator('.docshelf-pin-icon').count(), 0, 'A failed save must not mark the original as pinned.');
    console.log('Document pins survived reload and route changes, stayed scoped to their shelf, and unpinned without removing originals.');
  } finally {
    await writeFile(shelfPath, baseline);
    await page.evaluate(async settings => {
      const plugin = app.plugins.getPlugin('docshelf');
      await plugin.configure(settings);
      for (const artifact of plugin.catalog.artifacts) if (plugin.isPinned(artifact)) await plugin.pinDocument(artifact, false);
    }, settings);
    await rm(otherShelf, { force: true });
  }
}

export async function testFolderPins({ page, poll, shelfPath, workspace }) {
  const baseline = await readFile(shelfPath, 'utf8');
  const root = path.join(workspace, 'pin-folders');
  await mkdir(path.join(root, 'parent/child'), { recursive: true });
  await writeFile(path.join(root, 'parent/child/note.md'), '# Folder pin fixture\n');
  const project = 'Folder pin tests';
  const rows = page.locator('.docshelf-project .docshelf-folder-toggle[data-project="Folder pin tests"]');
  const shortcut = page.locator('.docshelf-pinned-folder[data-project="Folder pin tests"]');
  let folderKey;
  try {
    await page.evaluate(async ({ root, project }) => {
      const p = app.plugins.getPlugin('docshelf');
      await p.addSources([root], project);
      await p.openShelf();
    }, { root, project });
    const target = rows.filter({ has: page.getByText('parent/child', { exact: true }) });
    await poll(() => target.isVisible(), 'The compacted folder fixture did not appear.');
    folderKey = await target.getAttribute('data-folder');
    const beforePin = await readFile(shelfPath, 'utf8');
    await target.focus();
    await target.press('Shift+F10');
    await page.getByText('Pin folder', { exact: true }).click();
    await poll(async () => await shortcut.count() === 1, 'Pinning a folder did not create a shortcut.');
    assert.equal(await target.locator('.docshelf-pin-icon').count(), 1);
    assert.equal(await readFile(shelfPath, 'utf8'), beforePin, 'Pinning must not modify the shared shelf.');
    // Reveal both a collapsed project and folder from the shortcut.
    await target.click();
    await rows.filter({ has: page.getByText('pin-folders', { exact: true }) }).click();
    await page.locator('.docshelf-project-toggle[data-project="Folder pin tests"]').click();
    await shortcut.click();
    assert.equal(await target.isVisible(), true);
    assert.equal(await target.getAttribute('aria-expanded'), 'true');
    assert.equal(await target.evaluate(el => el === document.activeElement), true);
    await page.evaluate(async () => {
      await app.plugins.disablePlugin('docshelf');
      await app.plugins.enablePlugin('docshelf');
      await app.plugins.getPlugin('docshelf').ready;
      await app.plugins.getPlugin('docshelf').openShelf();
    });
    await poll(async () => await shortcut.count() === 1, 'Folder pins did not survive plugin restart.');
    await writeFile(path.join(root, 'parent/sibling.md'), '# Split compacted chain\n');
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(async () => await rows.filter({ has: page.getByText('child', { exact: true }) }).count() === 1, 'The compacted folder did not split.');
    assert.equal(await shortcut.count(), 1, 'Splitting a folder row lost its pin.');
    assert.equal(await shortcut.getAttribute('data-folder'), folderKey);
    await rm(path.join(root, 'parent/sibling.md'));
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(() => target.isVisible(), 'The folder chain did not merge again.');
    assert.equal(await shortcut.count(), 1);
    const registered = await readFile(shelfPath, 'utf8');
    await writeFile(shelfPath, baseline);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(async () => await shortcut.count() === 0, 'Absent folders must not leave dead shortcuts.');
    assert.ok(await page.evaluate(({ project, folderKey }) => app.plugins.getPlugin('docshelf').pinnedFolders.includes(JSON.stringify([project, folderKey])), { project, folderKey }));
    await writeFile(shelfPath, registered);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(async () => await shortcut.count() === 1, 'Returning a registered folder lost its saved pin.');
    await shortcut.focus();
    await shortcut.press('Shift+F10');
    await page.getByText('Unpin folder', { exact: true }).click();
    await poll(async () => await shortcut.count() === 0, 'Keyboard unpinning left a folder shortcut.');
    assert.equal(await target.locator('.docshelf-pin-icon').count(), 0);
    // Pin an ancestor while separate, then merge it into its child's row. The
    // saved ancestor key is now an alias, not the rendered row's deepest key.
    await writeFile(path.join(root, 'parent/sibling.md'), '# Separate ancestor\n');
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    const ancestor = rows.filter({ has: page.getByText('parent', { exact: true }) });
    await poll(() => ancestor.isVisible(), 'The ancestor fixture did not split.');
    folderKey = await ancestor.getAttribute('data-folder');
    await ancestor.click({ button: 'right' });
    await page.getByText('Pin folder', { exact: true }).click();
    await poll(async () => await shortcut.count() === 1, 'The separate ancestor did not pin.');
    await rm(path.join(root, 'parent/sibling.md'));
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(() => target.isVisible(), 'The pinned ancestor did not compact.');
    assert.equal(await shortcut.count(), 1, 'A pinned ancestor alias must resolve to its compacted row.');
    assert.equal(await target.locator('.docshelf-pin-icon').count(), 1);
    await shortcut.click({ button: 'right' });
    await page.getByText('Unpin folder', { exact: true }).click();
    await poll(async () => await shortcut.count() === 0, 'Unpinning a compacted row did not remove its ancestor alias.');
    assert.equal(await page.evaluate(({ project, folderKey }) => app.plugins.getPlugin('docshelf').pinnedFolders.includes(JSON.stringify([project, folderKey])), { project, folderKey }), false);
    // Registered empty folders can be pinned independently of any document.
    await rm(path.join(root, 'parent/child/note.md'));
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await poll(async () => await rows.count() === 1, 'The empty registered folder must remain.');
    folderKey = await rows.getAttribute('data-folder');
    await rows.click({ button: 'right' });
    await page.getByText('Pin folder', { exact: true }).click();
    await poll(async () => await shortcut.count() === 1, 'An empty registered folder could not be pinned.');
    assert.equal(await page.locator('.docshelf-pinned .docshelf-item').count(), 0, 'A folder shortcut must not invent documents.');
    // Syntactically corrupt browser storage must not permanently block future saves.
    await page.evaluate(async ({ project, folderKey }) => {
      const p = app.plugins.getPlugin('docshelf');
      localStorage.setItem(p.pinsKey, '{broken document JSON');
      localStorage.setItem(`${p.pinsKey}:folders`, '{broken folder JSON');
      await p.pinFolder(project, folderKey, true);
      await p.pinDocument(p.catalog.artifacts[0], true);
      await app.plugins.disablePlugin('docshelf');
      await app.plugins.enablePlugin('docshelf');
      await app.plugins.getPlugin('docshelf').ready;
      await app.plugins.getPlugin('docshelf').openShelf();
    }, { project, folderKey });
    await poll(async () => await shortcut.count() === 1 && await page.locator('.docshelf-pinned .docshelf-item').count() === 1, 'Saving after malformed JSON failed to repair document/folder storage durably.');
    await page.evaluate(() => {
      const p = app.plugins.getPlugin('docshelf');
      return p.pinDocument(p.catalog.artifacts[0], false);
    });
    await page.screenshot({ path: '.local/runtime/folder-pins.png' });
    console.log('Folder pins survived restart, chain splitting/merging and temporary absence, revealed collapsed ancestors, supported keyboard unpinning and empty registrations without changing the shelf.');
  } finally {
    if (folderKey) await page.evaluate(({ project, folderKey }) => app.plugins.getPlugin('docshelf').pinFolder(project, folderKey, false), { project, folderKey });
    await writeFile(shelfPath, baseline);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await rm(root, { recursive: true, force: true });
  }
}
