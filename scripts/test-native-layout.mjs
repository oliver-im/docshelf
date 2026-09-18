import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeLayout({ page, poll, workspace }) {
  const file = path.join(workspace, 'guide.md');
  const original = await readFile(file, 'utf8');
  const viewport = page.viewportSize();
  const measure = () => page.locator('.docshelf-native .cm-scroller:visible').evaluate(scroller => {
    const pane = scroller.getBoundingClientRect();
    const content = scroller.querySelector('.cm-content').getBoundingClientRect();
    const gutter = scroller.querySelector('.docshelf-source-gutter').getBoundingClientRect();
    return {
      pane: scroller.clientWidth, width: content.width,
      left: content.left - pane.left, right: pane.left + scroller.clientWidth - content.right,
      gap: content.left - gutter.right, edge: gutter.left - pane.left,
      overflow: scroller.scrollWidth - scroller.clientWidth,
      clipped: Array.from(scroller.querySelectorAll('.docshelf-source-control')).some(button => button.scrollWidth > button.clientWidth),
    };
  });
  const balanced = async () => {
    await poll(async () => {
      const box = await measure();
      return Math.abs(box.left - box.right) < 2 && box.gap >= 16 && box.gap <= 24 && box.edge >= 8 && !box.clipped && box.overflow <= 1;
    }, 'Source labels must fit beside a centered text column without horizontal overflow.');
    return measure();
  };
  const replace = async text => {
    await writeFile(file, text);
    await poll(() => page.evaluate(expected => app.plugins.getPlugin('docshelf').nativeViews()[0].getViewData() === expected, text), 'The layout fixture did not refresh.');
  };

  try {
    await replace('# Document title\n\nA paragraph that wraps naturally as the pane gets narrower.\n\n## Section\n\nMore text.\n');
    // Split panes vary independently of window width. The native comparison
    // also catches empty plugin gutters reserving space in ordinary notes.
    await page.evaluate(async () => {
      const file = await app.vault.create('Layout comparison.md', '# Native note\n\nText.\n');
      await app.workspace.getLeaf('split').openFile(file);
    });
    const ordinary = page.locator('.workspace-leaf-content[data-type="markdown"] .cm-scroller:visible');
    await ordinary.waitFor();
    assert.equal(await ordinary.locator('.docshelf-source-gutter, .cm-gutters').count(), 0, 'DocShelf must not add gutters or margins to ordinary notes.');
    for (const width of [960, 1180, 1700, 2300]) {
      await page.setViewportSize({ width, height: 860 });
      const box = await balanced();
      assert.ok(box.width >= Math.min(700, box.pane - 100), 'Short line labels must leave the available width to the text.');
      if (width === 2300) assert.equal(Math.round(box.width), 700, 'Honor the native readable line width.');
    }
    const heading = page.locator('.docshelf-native .HyperMD-header-1');
    await heading.hover();
    const fold = heading.locator('.cm-fold-indicator .collapse-indicator');
    const foldBox = await fold.boundingBox();
    const labelBox = await page.locator('.docshelf-native button[data-start="1"]').boundingBox();
    assert.ok(labelBox.x + labelBox.width < foldBox.x, 'Source labels must leave the native heading-fold control clickable.');
    await fold.click();
    await heading.locator('.collapse-indicator.is-collapsed').waitFor();
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getState().referenceLines), undefined);
    await fold.click();
    await heading.locator('.collapse-indicator:not(.is-collapsed)').waitFor();
    await page.screenshot({ path: '.local/runtime/native-wide-layout.png' });

    // A table across a digit boundary has a much wider source-range label.
    await replace('Paragraph.\n\n'.repeat(499) + '| Column | Value |\n| --- | --- |\n| One | Two |\n| Three | Four |\n\nEnd.\n');
    await page.evaluate(() => {
      const editor = app.plugins.getPlugin('docshelf').nativeViews()[0].editor;
      editor.setCursor({ line: 1004, ch: 0 });
      editor.scrollIntoView({ from: { line: 998, ch: 0 }, to: { line: 1001, ch: 0 } }, true);
    });
    const range = page.locator('.docshelf-native button[data-start="999"][data-end="1002"]');
    await range.waitFor();
    for (const width of [960, 1700, 2300]) {
      await page.setViewportSize({ width, height: 860 });
      await balanced();
    }
    await page.setViewportSize({ width: 960, height: 860 });
    await balanced();
    await range.click();
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].getState().referenceLines), '999-1002');
    await page.screenshot({ path: '.local/runtime/native-narrow-layout.png' });
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();

    await page.evaluate(async () => {
      const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
      await view.setState({ ...view.getState(), source: true }, {});
    });
    await balanced();
    await page.setViewportSize({ width: 2300, height: 860 });
    await page.evaluate(() => { app.vault.setConfig('readableLineLength', false); app.workspace.updateOptions(); });
    await poll(async () => (await measure()).width > 700, 'Disabling readable line length should let the document use wider panes.');
    await balanced();
    await page.evaluate(() => { app.vault.setConfig('showLineNumber', true); app.workspace.updateOptions(); });
    await ordinary.locator('.cm-lineNumbers:visible').waitFor();
    assert.equal(await ordinary.locator('.docshelf-source-gutter').count(), 0);
    assert.equal(await page.locator('.docshelf-native .cm-lineNumbers:visible').count(), 0, 'Do not duplicate native and source line numbers.');
    console.log('Editor layout: balanced split panes, compact labels, four-digit table ranges, source mode, readable-width preference, and ordinary notes passed.');
  } finally {
    await page.evaluate(async () => {
      app.vault.setConfig('readableLineLength', true);
      app.vault.setConfig('showLineNumber', false);
      app.workspace.updateOptions();
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path === 'Layout comparison.md') leaf.detach();
      const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
      await view.setState({ ...view.getState(), source: false }, {});
      view.editor.scrollTo(0, 0);
    });
    await replace(original);
    await page.setViewportSize(viewport);
  }
}
