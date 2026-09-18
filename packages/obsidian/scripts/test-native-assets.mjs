import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeAssets({ page, poll, workspace, shelfPath, shelf }) {
  const assetPath = path.join(workspace, 'assets/mark.svg');
  const documentPath = path.join(workspace, 'guide.md');
  const asset = await readFile(assetPath, 'utf8');
  const original = await readFile(documentPath, 'utf8');
  const image = page.locator('.docshelf-native .markdown-preview-view:visible img');
  const hasWidth = width => image.evaluateAll((images, width) => images.some(image => image.naturalWidth === width), width);
  const refresh = () => page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  try {
    await writeFile(assetPath, asset.replace('width="36"', 'width="72"'));
    await poll(() => hasWidth(72), 'An edited asset did not refresh while Markdown text was unchanged.');
    assert.equal(await readFile(documentPath, 'utf8'), original);

    const withoutAsset = { ...shelf, artifacts: shelf.artifacts.map((entry, index) => index === 0 ? { ...entry, assets: [] } : entry) };
    await writeFile(shelfPath, JSON.stringify(withoutAsset));
    await refresh();
    await poll(() => page.locator('.docshelf-native .markdown-preview-view:visible .internal-embed')
      .evaluateAll(embeds => embeds.some(embed => embed.textContent === 'Unregistered embed: assets/mark.svg')), 'Removing an asset registration did not invalidate its embed.');
    await writeFile(shelfPath, JSON.stringify(shelf));
    await refresh();
    await poll(() => hasWidth(72), 'Registering the asset again did not resolve its placeholder.');

    // Keep a deliberate external-edit conflict open while updating the image.
    // Refresh must not rewrite the editor buffer or save over the disk version.
    const draft = `${original}\nUnsaved asset-refresh draft.\n`;
    const external = `${original}\nExternal asset-refresh change.\n`;
    await page.evaluate(draft => {
      const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
      view.setExternalContents(draft, false);
    }, draft);
    await writeFile(documentPath, external);
    await refresh();
    await poll(() => page.locator('.docshelf-editor-problem').innerText().then(text => text.includes('changed outside')), 'The test conflict did not become visible.');
    await writeFile(assetPath, asset.replace('width="36"', 'width="108"'));
    await poll(() => hasWidth(108), 'An asset change did not refresh in a dirty native view.');
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getViewData()), draft);
    assert.equal(await readFile(documentPath, 'utf8'), external);
    console.log('Native assets refresh on edits and registration changes without replacing unsaved Markdown.');
  } finally {
    // Discard only this disposable test draft, then restore its source fixtures.
    await page.evaluate(() => {
      const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
      view.setExternalContents(view.externalBaseline, false);
    });
    await writeFile(documentPath, original);
    await writeFile(assetPath, asset);
    await writeFile(shelfPath, JSON.stringify(shelf));
    await refresh();
    await poll(() => hasWidth(36), 'The original asset did not restore.');
  }
}
