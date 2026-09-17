import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeLines({ page, poll, workspace }) {
  const file = path.join(workspace, 'guide.md');
  const original = await readFile(file, 'utf8');
  const gutter = page.locator('.docshelf-native .docshelf-source-gutter:visible');
  const line = number => gutter.locator(`button[data-start="${number}"]`);
  const reference = () => page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getState().referenceLines);
  const clear = () => page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setCursor({ line: 0, ch: 0 });
    view.editor.scrollTo(0, 0);
  });
  await line(7).waitFor();
  const before = await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections());
  await line(7).click();
  await line(9).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '7-9');
  assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections()), before, 'Gutter selection must leave the native text cursor unchanged.');
  assert.equal(await page.locator('.docshelf-referenced-line').count(), 3);
  assert.equal(await line(7).getAttribute('aria-pressed'), 'true');
  assert.equal(await line(9).getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-reference'));
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:7-9$/);
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-link'));
  assert.equal(new URL(await page.evaluate(() => require('electron').clipboard.readText())).searchParams.get('lines'), '7-9');
  assert.equal(await readFile(file, 'utf8'), original, 'Review controls must not change source bytes.');
  await page.screenshot({ path: '.local/runtime/native-source-lines.png' });

  // Inserting a line above the reference moves its source positions with it.
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.replaceRange('\n', { line: 0, ch: 0 }));
  assert.equal(await reference(), '8-10');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.undo());
  await clear();
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  assert.equal(await readFile(file, 'utf8'), original);

  await line(7).focus();
  await page.keyboard.press('Space');
  assert.equal(await reference(), '7-7');
  assert.equal(await line(7).evaluate(el => el === document.activeElement), true, 'Selecting a source line must preserve keyboard focus.');
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await reference(), '7-8');
  await page.keyboard.press('Escape');
  assert.equal(await reference(), undefined);
  assert.equal(await page.getByRole('group', { name: 'DocShelf source lines' }).count(), 1);

  // Block widgets must identify their real source range, not a screen-row count.
  await page.evaluate(() => {
    const editor = app.plugins.getPlugin('docshelf').nativeViews()[0].editor;
    editor.scrollIntoView({ from: { line: 16, ch: 0 }, to: { line: 19, ch: 0 } }, true);
  });
  await poll(async () => (await line(17).getAttribute('data-end')) === '20', 'The rendered table did not expose its true source range.');
  await line(17).click();
  assert.equal(await reference(), '17-20');
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-reference'));
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:17-20$/);
  await poll(() => page.locator('.docshelf-referenced-block table').count(), 'The selected table was not highlighted.');
  await page.screenshot({ path: '.local/runtime/native-table-reference.png' });
  await clear();

  // Persist a reference independently of the editing cursor and restore it.
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.scrollTo(0, 0));
  await line(7).click();
  await line(9).click({ modifiers: ['Shift'] });
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    const state = JSON.parse(JSON.stringify(view.leaf.getViewState()));
    const leaf = view.leaf;
    await leaf.setViewState({ type: 'empty' });
    await leaf.setViewState(state);
    await app.workspace.revealLeaf(leaf);
  });
  assert.equal(await reference(), '7-9');
  await clear();
  // Selecting text in the body replaces a gutter reference normally.
  await line(7).click();
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.setSelection({ line: 10, ch: 0 }, { line: 10, ch: 10 }));
  assert.equal(await reference(), undefined);

  // Native source mode exposes exact individual lines, including frontmatter
  // and table rows that Live Preview displays as one rendered block.
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    await view.setState({ ...view.getState(), source: true }, {});
    view.editor.scrollTo(0, 0);
  });
  await line(2).click();
  assert.equal(await reference(), '2-2');
  await clear();
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.scrollIntoView({ from: { line: 18, ch: 0 }, to: { line: 18, ch: 0 } }, true));
  await line(19).click();
  assert.equal(await reference(), '19-19');
  await clear();
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    await view.setState({ ...view.getState(), source: false }, {});
  });
  assert.equal(await readFile(file, 'utf8'), original);
  console.log('Unified Live Preview: clickable source lines, ranges, clipboard references, keyboard controls, edit mapping, table ranges, and restoration passed.');
}
