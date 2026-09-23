import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeLines({ page, poll, workspace }) {
  const file = path.join(workspace, 'guide.md');
  const original = await readFile(file, 'utf8');
  const gutter = page.locator('.docshelf-native .docshelf-source-gutter:visible');
  const highlight = page.locator('.docshelf-native .docshelf-source-highlight:visible');
  const line = number => gutter.locator(`button[data-start="${number}"]`);
  const reference = () => page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getState().referenceLines);
  const clear = () => page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const covers = async target => {
    await poll(async () => {
      const box = await highlight.boundingBox(), inside = await target.boundingBox();
      return box && inside && box.x <= inside.x + 1 && box.y <= inside.y + 1
        && box.x + box.width >= inside.x + inside.width - 1 && box.y + box.height >= inside.y + inside.height - 1;
    }, 'One continuous source highlight must cover the complete selected content.');
    assert.equal(await highlight.count(), 1);
  };
  const expectReferenceMenu = async expected => {
    await page.getByText('Copy DocShelf link', { exact: true }).waitFor();
    assert.equal(await reference(), expected, 'Right-click must preserve the source selection.');
    assert.deepEqual(await page.locator('.menu-item-title').allTextContents(), ['Copy DocShelf link', 'Copy source reference', 'Reveal source']);
    assert.equal(await page.locator('.menu-separator').count(), 0, 'Line menus must have no dividers.');
  };
  const nativeMenus = await page.evaluate(() => {
    const value = app.vault.getConfig('nativeMenus');
    app.vault.setConfig('nativeMenus', false);
    return value;
  });
  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setCursor({ line: 0, ch: 0 });
    view.editor.scrollTo(0, 0);
  });
  await line(7).waitFor();
  const before = await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections());
  await line(7).click();
  assert.equal(await line(7).evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)', 'A hovered selected number must not add a second highlight.');
  await line(7).click();
  assert.equal(await reference(), undefined, 'Clicking the sole selected line again must clear it.');
  await highlight.waitFor({ state: 'detached' });
  assert.equal(await line(7).getAttribute('aria-pressed'), 'false');
  assert.notEqual(await line(7).evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)', 'Unselected numbers must retain hover feedback.');
  await line(7).click();
  await line(7).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '7-7', 'Shift-clicking the selection must not toggle it off.');
  await line(9).click({ modifiers: ['Shift'] });
  await line(8).click();
  assert.equal(await reference(), '8-8', 'Clicking within a larger range must select only that line.');
  await line(8).click();
  assert.equal(await reference(), undefined);
  await line(7).click();
  await line(9).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '7-9');
  assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections()), before, 'Gutter selection must leave the native text cursor unchanged.');
  const firstText = page.locator('.docshelf-native .cm-line').filter({ hasText: 'Keep documents in their own projects' });
  const lastText = page.locator('.docshelf-native .cm-line').filter({ hasText: 'This line has an authored Markdown break' });
  await covers(firstText);
  await covers(lastText);
  assert.equal(await line(7).getAttribute('aria-pressed'), 'true');
  assert.equal(await line(9).getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-reference'));
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:7-9$/);
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-link'));
  assert.equal(new URL(await page.evaluate(() => require('electron').clipboard.readText())).searchParams.get('lines'), '7-9');
  assert.equal(await readFile(file, 'utf8'), original, 'Review controls must not change source bytes.');
  await page.screenshot({ path: '.local/runtime/native-source-lines.png' });

  await firstText.click({ button: 'right' });
  await expectReferenceMenu('7-9');
  assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections()), before, 'A reference menu must not move the editing cursor.');
  await page.getByText('Copy source reference', { exact: true }).click();
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:7-9$/);
  const textBox = await lastText.boundingBox(), band = await highlight.boundingBox();
  await page.mouse.click(band.x + band.width - 3, textBox.y + textBox.height / 2, { button: 'right' });
  await expectReferenceMenu('7-9');
  await page.getByText('Copy DocShelf link', { exact: true }).click();
  assert.equal(new URL(await page.evaluate(() => require('electron').clipboard.readText())).searchParams.get('lines'), '7-9');

  // Exercise the actual reveal path without opening Finder from the test vault.
  await page.evaluate(() => {
    const shell = require('electron').shell;
    window.docshelfRevealProbe = { original: shell.showItemInFolder, paths: [] };
    shell.showItemInFolder = file => window.docshelfRevealProbe.paths.push(file);
  });
  try {
    for (const [index, number] of [7, 10, 10].entries()) {
      if (index === 2) await clear();
      const expected = index === 2 ? undefined : '7-9';
      await line(number).click({ button: 'right' });
      await expectReferenceMenu(expected);
      const copiedRange = number === 7 ? '7-9' : '10';
      await page.locator('.menu').getByText('Copy source reference', { exact: true }).click();
      assert.equal(await page.evaluate(() => require('electron').clipboard.readText()), `${file}:${copiedRange}`);
      await line(number).click({ button: 'right' });
      await page.locator('.menu').getByText('Copy DocShelf link', { exact: true }).click();
      assert.equal(new URL(await page.evaluate(() => require('electron').clipboard.readText())).searchParams.get('lines'), copiedRange);
      await line(number).click({ button: 'right' });
      await expectReferenceMenu(expected);
      assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections()), before);
      await page.locator('.menu').getByText('Reveal source', { exact: true }).click();
      await poll(() => page.evaluate(count => window.docshelfRevealProbe.paths.length === count, index + 1), 'Reveal source did not reach the system file manager.');
      assert.equal(await page.evaluate(() => window.docshelfRevealProbe.paths.at(-1)), await realpath(file));
      assert.equal(await reference(), expected);
    }
  } finally {
    await page.evaluate(() => { require('electron').shell.showItemInFolder = window.docshelfRevealProbe.original; delete window.docshelfRevealProbe; });
  }
  await line(7).click();
  await line(9).click({ modifiers: ['Shift'] });

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
  await page.keyboard.press('Space');
  assert.equal(await reference(), undefined, 'Keyboard activation must toggle the selection too.');
  assert.equal(await line(7).evaluate(el => el === document.activeElement), true, 'Clearing a source line must preserve keyboard focus.');
  await page.keyboard.press('Enter');
  assert.equal(await reference(), '7-7');
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await reference(), '7-8');
  await page.keyboard.press('Escape');
  assert.equal(await reference(), undefined);
  assert.equal(await page.getByRole('group', { name: 'DocShelf source lines' }).count(), 1);

  // Heading section spacing belongs outside the highlight, including when
  // a heading wraps. Only the outer edges of a multi-block range are trimmed.
  const viewport = page.viewportSize();
  const readable = await page.evaluate(() => app.vault.getConfig('readableLineLength'));
  const headingPadding = () => page.evaluate(() => {
    const heading = document.querySelector('.docshelf-native .HyperMD-header-2');
    const box = heading.getBoundingClientRect(), style = getComputedStyle(heading);
    const band = document.querySelector('.docshelf-source-highlight').getBoundingClientRect();
    const top = box.top + parseFloat(style.paddingTop), bottom = box.bottom - parseFloat(style.paddingBottom);
    return { above: top - band.top, below: band.bottom - bottom, height: bottom - top, lineHeight: parseFloat(style.lineHeight) };
  });
  for (const value of [false, true]) {
    await page.evaluate(value => { app.vault.setConfig('readableLineLength', value); app.workspace.updateOptions(); }, value);
    for (const width of [1180, 600]) {
      await page.setViewportSize({ width, height: 860 });
      await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.scrollIntoView({ from: { line: 10, ch: 0 }, to: { line: 10, ch: 0 } }, true));
      await line(11).click({ modifiers: ['Shift'] });
      await poll(async () => {
        const padding = await headingPadding();
        return padding.above > 0 && padding.above <= 4.1 && Math.abs(padding.above - padding.below) < 1;
      }, 'Heading highlights should have balanced padding around their rendered line box.');
      if (width === 600) {
        const box = await headingPadding();
        assert.ok(box.height > box.lineHeight * 1.5, 'The narrow fixture must exercise a wrapped heading.');
      }
    }
  }
  await page.setViewportSize(viewport);
  await page.evaluate(value => { app.vault.setConfig('readableLineLength', value); app.workspace.updateOptions(); }, readable);
  await line(11).click({ modifiers: ['Shift'] });
  await poll(async () => Math.abs((await headingPadding()).above - 4) < 1, 'The heading highlight did not settle after resizing.');
  // Clipboard notices can cover this right edge after the preceding copy checks.
  // Wait for a real hit on the editor instead of sending the click to a toast.
  const headingPoint = await poll(() => highlight.evaluate(el => {
    const band = el.getBoundingClientRect();
    const point = { x: band.right - 3, y: band.bottom - 1 };
    const target = el.ownerDocument.elementFromPoint(point.x, point.y);
    return target?.closest('.docshelf-native .cm-scroller') ? point : null;
  }), 'A notification still covers the heading reference menu target.');
  await page.mouse.click(headingPoint.x, headingPoint.y, { button: 'right' });
  await expectReferenceMenu('11-11');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '.local/runtime/native-heading-reference.png' });
  await line(5).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '5-11');
  await covers(firstText);
  await covers(lastText);
  await poll(async () => Math.abs((await headingPadding()).below - 4) < 1, 'A range ending at a heading must use its padded content boundary.');
  await clear();

  // Block widgets must identify their real source range, not a screen-row count.
  await page.evaluate(() => {
    const editor = app.plugins.getPlugin('docshelf').nativeViews()[0].editor;
    editor.scrollIntoView({ from: { line: 16, ch: 0 }, to: { line: 19, ch: 0 } }, true);
  });
  await poll(async () => (await line(17).getAttribute('data-end')) === '20', 'The rendered table did not expose its true source range.');
  await line(17).click({ button: 'right' });
  await expectReferenceMenu(undefined);
  await page.locator('.menu').getByText('Copy DocShelf link', { exact: true }).click();
  assert.equal(new URL(await page.evaluate(() => require('electron').clipboard.readText())).searchParams.get('lines'), '17-20');
  assert.equal(await reference(), undefined, 'Copying an unselected block must not create a highlight.');
  await line(17).click();
  assert.equal(await reference(), '17-20');
  await line(17).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '17-20');
  await line(17).click();
  assert.equal(await reference(), undefined, 'Clicking the sole selected block again must clear its whole range.');
  await highlight.waitFor({ state: 'detached' });
  await line(17).click();
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-reference'));
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:17-20$/);
  const table = page.locator('.docshelf-native table');
  await covers(table);
  await page.screenshot({ path: '.local/runtime/native-table-reference.png' });
  const tableCursor = await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections());
  await table.locator('td').first().click({ button: 'right' });
  await expectReferenceMenu('17-20');
  assert.deepEqual(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.listSelections()), tableCursor, 'Right-clicking a table must not enter cell editing.');
  await page.keyboard.press('Escape');
  await line(17).click({ button: 'right' });
  await expectReferenceMenu('17-20');
  await page.keyboard.press('Escape');

  // A range across a list item, blank line, and rendered table is one band.
  await line(15).click({ modifiers: ['Shift'] });
  assert.equal(await reference(), '15-20');
  await covers(table);
  await covers(page.locator('.docshelf-native .cm-line').filter({ hasText: 'Copy a link for Obsidian' }));
  const blank = await line(16).boundingBox();
  const combined = await highlight.boundingBox();
  await page.mouse.click(combined.x + combined.width - 3, blank.y + blank.height / 2, { button: 'right' });
  await expectReferenceMenu('15-20');
  await page.keyboard.press('Escape');
  const tableBox = await table.boundingBox();
  await page.mouse.click(tableBox.x - 10, tableBox.y + 10, { button: 'right' });
  await expectReferenceMenu('15-20');
  await page.keyboard.press('Escape');
  await clear();
  await highlight.waitFor({ state: 'detached' });
  assert.equal(await reference(), undefined);

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
  await firstText.click();
  assert.equal(await reference(), undefined);
  await highlight.waitFor({ state: 'detached' });

  // Native source mode exposes exact individual lines, including frontmatter
  // and table rows that Live Preview displays as one rendered block.
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    await view.setState({ ...view.getState(), source: true }, {});
    view.editor.scrollTo(0, 0);
  });
  // The host defers its DOM-selection restore after switching source modes.
  // Let that finish before simulating another user selection.
  await page.waitForTimeout(100);
  await line(2).click();
  assert.equal(await reference(), '2-2');
  await clear();
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.scrollIntoView({ from: { line: 18, ch: 0 }, to: { line: 18, ch: 0 } }, true));
  await line(19).click();
  assert.equal(await reference(), '19-19');
  await page.locator('.docshelf-native .cm-line').filter({ hasText: '| Preserve original files | Ready |' }).click({ button: 'right' });
  await expectReferenceMenu('19-19');
  await page.keyboard.press('Escape');
  await clear();
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    await view.setState({ ...view.getState(), source: false }, {});
  });
  await page.evaluate(value => app.vault.setConfig('nativeMenus', value), nativeMenus);
  assert.equal(await readFile(file, 'utf8'), original);
  console.log('Unified Live Preview: continuous source highlights, context menus on text/tables/whitespace/gutters, clipboard ranges, keyboard controls, edit mapping, and restoration passed.');
}
