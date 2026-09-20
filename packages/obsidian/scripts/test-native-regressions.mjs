import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export async function testNativeRegressions({ page, poll, workspace, replacePluginFiles }) {
  const file = path.join(workspace, 'guide.md');
  const original = await readFile(file, 'utf8');
  const vaultFiles = await page.evaluate(() => app.vault.getMarkdownFiles().map(file => file.path).sort());
  const state = () => page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    return { text: view.getViewData(), mode: view.getMode(), draft: view.draftId, problem: view.saveProblem };
  });
  const fresh = async text => {
    await page.evaluate(async () => {
      for (const view of app.plugins.getPlugin('docshelf').nativeViews()) await view.leaf.setViewState({ type: 'empty' });
    });
    await writeFile(file, text);
    await page.evaluate(async () => {
      const plugin = app.plugins.getPlugin('docshelf');
      await plugin.refresh();
      await plugin.openArtifact(plugin.catalog.artifacts[0]);
    });
    await poll(async () => (await state()).text === text, 'The fresh editor did not load.');
  };
  const undo = async () => {
    await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.focus());
    await page.keyboard.press('Meta+z');
    await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  };
  const base = '# Notes\n\nOriginal paragraph.\n';
  await fresh(base);
  const external = base + '\nExternal append.\n';
  await writeFile(file, external);
  await poll(async () => (await state()).text === external, 'External text did not refresh.');
  await undo();
  assert.equal((await state()).text, external, 'Undo must not remove an external update.');
  assert.equal(await readFile(file, 'utf8'), external);

  // An external append must survive undoing an earlier, saved local edit.
  await fresh(base);
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.replaceRange('Local ', { line: 2, ch: 0 });
    await view.save();
  });
  await writeFile(file, (await readFile(file, 'utf8')) + '\nExternal append.\n');
  await poll(async () => (await state()).text.includes('External append.'), 'The second external update did not refresh.');
  await undo();
  assert.equal(await readFile(file, 'utf8'), external, 'Undo the local edit while keeping external text.');
  // Replacing the edited region must also invalidate overlapping old history.
  const rewritten = '# External rewrite\n\nDifferent document.\n';
  await writeFile(file, rewritten);
  await poll(async () => (await state()).text === rewritten, 'The external rewrite did not refresh.');
  await undo();
  assert.equal(await readFile(file, 'utf8'), rewritten);

  await fresh(original);
  await page.evaluate(() => {
    const editor = app.plugins.getPlugin('docshelf').nativeViews()[0].editor;
    editor.setCursor({ line: 0, ch: 0 });
    editor.scrollIntoView({ from: { line: 12, ch: 0 }, to: { line: 12, ch: 0 } }, true);
  });
  await page.locator('.docshelf-native .cm-link').filter({ hasText: 'release report' }).first().click();
  await page.locator('webview.docshelf-webview:visible').waitFor();
  assert.deepEqual(await page.evaluate(() => app.vault.getMarkdownFiles().map(file => file.path).sort()), vaultFiles, 'Plain links must never create vault notes.');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[0]);
    const view = plugin.nativeViews()[0];
    await view.setState({ ...view.getState(), mode: 'preview' }, {});
    await plugin.openArtifact(plugin.catalog.artifacts[0]);
  });
  assert.equal((await state()).mode, 'preview');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[0], { start: 13, end: 13 });
    const view = plugin.nativeViews()[0];
    await view.setState({ ...view.getState(), source: true }, {});
  });
  assert.equal((await state()).mode, 'source');
  await page.locator('.docshelf-native .cm-link').filter({ hasText: 'release report' }).first().click();
  assert.equal(await page.locator('.docshelf-native .cm-content:visible').count(), 1, 'A plain click in raw source mode should keep editing the link.');
  assert.deepEqual(await page.evaluate(() => app.vault.getMarkdownFiles().map(file => file.path).sort()), vaultFiles);

  await fresh(base);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.replaceRange('Unsaved draft\n', { line: 0, ch: 0 }));
  await writeFile(file, external);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  const conflicted = await state();
  assert.match(conflicted.problem, /changed outside/);
  await page.evaluate(() => app.plugins.disablePlugin('docshelf'));
  if (replacePluginFiles) await replacePluginFiles();
  await page.evaluate(() => app.plugins.enablePlugin('docshelf'));
  await poll(async () => (await state()).problem.includes('Recovered unsaved edits'), 'Plugin reload did not recover the pending draft.');
  assert.equal((await state()).text, conflicted.text);
  assert.equal((await state()).draft, conflicted.draft);
  // A temporary read error must not erase the recovered-draft review gate,
  // even when the restored disk contents match the original baseline.
  await rm(file);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  await poll(async () => (await state()).problem.includes('ENOENT'), 'The recovered pane did not observe the missing file.');
  await writeFile(file, base);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  await poll(async () => (await state()).problem.includes('Recovered unsaved edits'), 'Recovery review intent was lost after a transient error.');
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].save());
  assert.equal(await readFile(file, 'utf8'), base, 'A restored baseline must not silently approve a recovered draft.');
  await writeFile(file, external);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  await page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.replaceRange('More ', { line: 0, ch: 0 });
    await view.save();
  });
  assert.equal(await readFile(file, 'utf8'), external, 'Recovered edits still require review before saving.');
  assert.equal(await page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf');
    return plugin.recovery.read(plugin.nativeViews()[0].draftId).text;
  }), 'More ' + conflicted.text);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const modal = await poll(async () => {
    for (const candidate of page.context().pages()) if (await candidate.getByRole('textbox', { name: 'Your edits', exact: true }).isVisible()) return candidate;
  }, 'The recovery review did not open.');
  await modal.getByRole('button', { name: 'Use disk version', exact: true }).click();
  await fresh(original);
  // Burst refreshes share one pass; requests arriving during it need just one
  // follow-up pass, and callers must wait until that follow-up finishes.
  const refreshes = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    if (plugin.timer) { clearTimeout(plugin.timer); plugin.timer = null; }
    await plugin.refresh();
    const refresh = plugin.refreshNow.bind(plugin);
    let passes = 0, entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    plugin.refreshNow = async () => { if (++passes === 1) { entered(); await gate; } await refresh(); };
    try {
      const first = plugin.refresh();
      await started;
      const rest = Array.from({ length: 30 }, () => plugin.refresh());
      release();
      await Promise.all([first, ...rest]);
      return passes;
    } finally { plugin.refreshNow = refresh; }
  });
  assert.equal(refreshes, 2, 'Coalesce refresh requests without losing changes during an active pass.');
  const checkpoints = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf'), view = plugin.nativeViews()[0];
    const record = plugin.recovery.record.bind(plugin.recovery);
    let writes = 0;
    plugin.recovery.record = (...args) => { writes++; return record(...args); };
    try {
      for (let i = 0; i < 10; i++) view.editor.replaceRange('x', { line: 0, ch: 0 });
      const duringTyping = writes;
      await view.save();
      return { duringTyping, persisted: plugin.recovery.read(view.draftId)?.text === view.getViewData() };
    } finally { plugin.recovery.record = record; }
  });
  assert.equal(checkpoints.duringTyping, 0, 'Typing must not synchronously write recovery on each keystroke.');
  assert.equal(checkpoints.persisted, true, 'Save must flush the latest checkpoint immediately.');
  await fresh(original);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.replaceRange('Checkpoint ', { line: 0, ch: 0 }));
  await poll(() => page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf'), view = plugin.nativeViews()[0];
    const draft = plugin.recovery.read(view.draftId);
    return draft?.pending && draft.text === view.getViewData();
  }), 'Typing did not persist a pending checkpoint.');
  assert.equal(await readFile(file, 'utf8'), original, 'Recovery must checkpoint before the delayed source save.');
  // Returning to the baseline before autosave must retire the pending draft.
  await page.evaluate(text => app.plugins.getPlugin('docshelf').nativeViews()[0].editor.setValue(text), original);
  await poll(() => page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf'), view = plugin.nativeViews()[0];
    return plugin.recovery.read(view.draftId)?.pending === false;
  }), 'Returning to the baseline left a stale pending draft.');
  const closed = await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf'), view = plugin.nativeViews()[0];
    view.editor.replaceRange('Close flush ', { line: 0, ch: 0 });
    const text = view.getViewData(), id = view.draftId;
    await view.leaf.setViewState({ type: 'empty' });
    return { text, recovery: plugin.recovery.read(id)?.text };
  });
  assert.equal(closed.recovery, closed.text, 'Closing before the checkpoint timer fires must retain the latest edit.');
  assert.equal(await readFile(file, 'utf8'), closed.text);
  await fresh(original);
  console.log('Regression checks: external Undo/history, plain links, reading mode, and recovery through plugin disable/enable passed.');
}
