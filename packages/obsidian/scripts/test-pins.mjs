import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';

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
    const failingRow = page.locator('.docshelf-project .docshelf-item[data-route="renamed/guide.html"]');
    await failingRow.press('Shift+F10');
    await page.evaluate(() => {
      const key = app.plugins.getPlugin('docshelf').pinsKey;
      const original = Storage.prototype.setItem;
      window.restorePinStorage = () => { Storage.prototype.setItem = original; delete window.restorePinStorage; };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new Error('Quota exceeded');
        return original.call(this, name, value);
      };
    });
    try {
      await page.getByText('Pin document', { exact: true }).click();
      await poll(async () => await page.getByText('Document pin could not be saved: Quota exceeded', { exact: true }).count() === 1, 'A failed pin save did not show its error.');
      assert.equal(await pins.count(), 0, 'A failed save must not add a shortcut.');
      assert.equal(await failingRow.locator('.docshelf-pin-icon').count(), 0, 'A failed save must not mark the original as pinned.');
    } finally {
      await page.evaluate(() => window.restorePinStorage());
    }
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
