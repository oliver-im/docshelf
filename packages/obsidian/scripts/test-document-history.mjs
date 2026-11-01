import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

// Use the real host's header buttons and history, not a mocked navigation stack.
export async function testDocumentHistory({ page, poll, workspace, shelfPath }) {
  const baseline = await readFile(shelfPath, 'utf8');
  const folder = path.join(workspace, 'navigation');
  await mkdir(folder);
  const notes = '# Citation notes\n\nFirst cited line.\nSecond cited line.\n\n[Next note](notes-b.md#next)\n[Other report](report-b.html#section)\n';
  const fixtures = {
    'report-a.html': '<h1 id="summary">Report A</h1><a id="report" href="report-b.html?session=2026-10-17&filter=a%26b#section">Other report</a><a id="plain" href="report-b.html#section">Default report</a><a id="session" href="?session=2026-10-28#summary">Next session</a><button id="script" onclick="location.search=\'?session=2026-10-31\'">Script session</button><a id="notes" href="notes-a.md#L3-L4">Cited notes</a>',
    'report-b.html': '<h1 id="section">Report B</h1><a id="return" href="report-a.html?session=2026-10-17#summary">Return to the earlier session</a>',
    'notes-a.md': notes,
    'notes-b.md': '# Next\n\nSecond note.\n',
  };
  const artifacts = [];
  for (const [name, text] of Object.entries(fixtures)) {
    const source = path.join(folder, name);
    await writeFile(source, text);
    artifacts.push({ source, route: `navigation/${name.replace(/\.md$/, '.html')}`, project: 'Navigation', title: name });
  }
  const reportA = artifacts[0].route, reportB = artifacts[1].route;
  const notesA = artifacts[2].route, notesB = artifacts[3].route;
  let leaf;
  const state = () => page.evaluate(leaf => ({
    id: leaf.id, type: leaf.view.getViewType(), ...leaf.view.getState(),
    back: leaf.history.backHistory.length, forward: leaf.history.forwardHistory.length,
  }), leaf);
  const guest = script => page.evaluate(({ leaf, script }) => leaf.view.contentEl.querySelector('webview').executeJavaScript(script), { leaf, script });
  const ready = async route => {
    await poll(async () => {
      const current = await state();
      return current.route === route && !await page.evaluate(leaf => leaf.working, leaf);
    }, `Navigation did not reach ${route}.`);
    if (route === reportA || route === reportB) {
      await poll(() => guest(`document.querySelector('h1')?.textContent === ${JSON.stringify(route === reportA ? 'Report A' : 'Report B')}`), 'The report did not finish loading.');
    }
  };
  const navigate = async (direction, route) => {
    const button = page.locator('[data-docshelf-history-test] .view-header-nav-buttons button').nth(direction === 'back' ? 0 : 1);
    assert.equal(await button.getAttribute('aria-disabled'), 'false', `Obsidian's ${direction} button must be available.`);
    await button.click();
    await ready(route);
  };
  const history = async () => { const { back, forward } = await state(); return { back, forward }; };
  try {
    await writeFile(shelfPath, JSON.stringify({ ...JSON.parse(baseline), artifacts: [...JSON.parse(baseline).artifacts, ...artifacts] }));
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    leaf = await page.evaluateHandle(async route => {
      const plugin = app.plugins.getPlugin('docshelf');
      const leaf = app.workspace.getLeaf('tab');
      leaf.containerEl.setAttribute('data-docshelf-history-test', '');
      await plugin.openArtifact(plugin.catalog.artifacts.find(item => item.route === route), null, '#summary', leaf, '?session=2026-10-17');
      return leaf;
    }, reportA);
    await ready(reportA);
    const leafId = (await state()).id;
    const leafCount = () => page.evaluate(() => {
      let count = 0;
      app.workspace.iterateRootLeaves(() => { count++; });
      return count;
    });
    const originalCount = await leafCount();

    // This authored link is rewritten by DocumentServer and dispatched by the
    // webview guard. It must retain the leaf and enter native history.
    await guest('document.querySelector("#report").click()');
    await ready(reportB);
    assert.equal((await state()).id, leafId);
    assert.equal(await guest('location.hash'), '#section');
    assert.equal(await guest('location.search'), '?session=2026-10-17&filter=a%26b');
    for (let pass = 0; pass < 2; pass++) {
      await navigate('back', reportA);
      assert.equal(await guest('location.hash'), '#summary');
      assert.equal(await guest('location.search'), '?session=2026-10-17');
      await navigate('forward', reportB);
      assert.equal(await guest('location.search'), '?session=2026-10-17&filter=a%26b');
    }
    await guest('document.querySelector("#return").click()');
    await ready(reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-17');
    const beforeSession = await history();
    await guest('document.querySelector("#session").click()');
    await poll(() => guest('location.search === "?session=2026-10-28"'), 'A query-only report link did not select its session.');
    assert.equal((await history()).back, beforeSession.back + 1, 'A different query on the same report needs a Back entry.');
    await navigate('back', reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-17');
    await navigate('forward', reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-28');
    await navigate('back', reportA);
    await guest('document.querySelector("#plain").click()');
    await ready(reportB);
    assert.equal(await guest('location.search'), '', 'A link without a query must not inherit another report’s session.');
    await navigate('back', reportA);
    const beforeReload = await history();
    await page.evaluate(async leaf => {
      await leaf.view.loadDocument();
      await leaf.setViewState(leaf.getViewState());
    }, leaf);
    await ready(reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-17', 'Reloads and restored view state must retain the query.');
    assert.deepEqual(await history(), beforeReload, 'A reload or no-op state must preserve the Forward entry.');

    // Script-driven reloads use the document URL rather than a rewritten link.
    await guest('document.querySelector("#script").click()');
    await poll(() => guest('location.search === "?session=2026-10-31"'), 'The report script did not select its session.');
    assert.equal((await state()).query, '?session=2026-10-31', 'Script-driven query changes must persist in the host state.');
    assert.equal((await history()).back, beforeReload.back + 1);
    await page.evaluate(leaf => leaf.view.loadDocument(), leaf);
    await ready(reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-31');
    await navigate('back', reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-17');
    await navigate('forward', reportA);
    assert.equal(await guest('location.search'), '?session=2026-10-31');
    await navigate('back', reportA);

    await guest('document.querySelector("#notes").click()');
    await ready(notesA);
    assert.equal((await state()).type, 'docshelf-markdown');
    assert.deepEqual(await page.evaluate(leaf => [leaf.view.editor.getCursor('from').line, leaf.view.editor.getCursor('to').line], leaf), [2, 3]);
    assert.equal((await state()).referenceLines, '3-4');
    const beforeSelection = await history();
    await page.evaluate(async leaf => {
      await leaf.setViewState({ type: 'docshelf-markdown', state: { ...leaf.view.getState(), lines: '4-4' } });
      await leaf.setViewState(leaf.getViewState());
      await leaf.view.refreshSource();
      leaf.view.editor.setCursor({ line: 3, ch: 2 });
    }, leaf);
    assert.deepEqual(await history(), beforeSelection, 'Selection and refresh must not create document history.');
    const nativePosition = await page.evaluate(leaf => ({ draftId: leaf.view.draftId, cursor: leaf.view.editor.getCursor(), reference: leaf.view.getState().referenceLines }), leaf);
    await page.evaluate(leaf => leaf.view.openShelfLink('notes-b.md#next'), leaf);
    await ready(notesB);
    for (let pass = 0; pass < 2; pass++) {
      await navigate('back', notesA);
      assert.deepEqual(await page.evaluate(leaf => ({ draftId: leaf.view.draftId, cursor: leaf.view.editor.getCursor(), reference: leaf.view.getState().referenceLines }), leaf), nativePosition);
      await navigate('back', reportA);
      assert.equal(await guest('location.hash'), '#summary');
      await navigate('forward', notesA);
      assert.deepEqual(await page.evaluate(leaf => ({ draftId: leaf.view.draftId, cursor: leaf.view.editor.getCursor(), reference: leaf.view.getState().referenceLines }), leaf), nativePosition);
      await navigate('forward', notesB);
    }
    assert.equal((await state()).id, leafId);
    assert.equal(await leafCount(), originalCount, 'Citation navigation and Back/Forward must reuse the leaf.');

    // A new Markdown-to-HTML navigation also needs the report to participate
    // in history; restoring an old HTML entry alone does not exercise this.
    await navigate('back', notesA);
    await page.evaluate(leaf => leaf.view.openShelfLink('report-b.html?session=2026-10-17#section'), leaf);
    await ready(reportB);
    assert.equal(await guest('location.search'), '?session=2026-10-17', 'Markdown links must preserve HTML queries too.');
    await navigate('back', notesA);
    await navigate('forward', reportB);
    assert.equal(await guest('location.search'), '?session=2026-10-17');

    // Back from Markdown to HTML closes the editor. An unsaved conflict must
    // be checkpointed and adopted again on Forward, without writing the source.
    await navigate('back', notesA);
    // A temporary storage failure must not leave saving permanently blocked
    // after storage returns, when the source has not changed outside the editor.
    const recoveryDirectory = await page.evaluate(() => app.plugins.getPlugin('docshelf').recovery.directory);
    const backup = `${recoveryDirectory}-history-test`;
    const retryText = `${notes}\nSave after storage recovers.\n`;
    await mkdir(recoveryDirectory, { recursive: true });
    await rename(recoveryDirectory, backup);
    try {
      await writeFile(recoveryDirectory, 'Recovery storage unavailable');
      await page.evaluate(({ leaf, text }) => leaf.view.editor.setValue(text), { leaf, text: retryText });
      await page.evaluate(async ({ leaf, route }) => {
        const plugin = app.plugins.getPlugin('docshelf');
        await plugin.openArtifact(plugin.catalog.artifacts.find(item => item.route === route), null, '', leaf);
      }, { leaf, route: reportA });
      assert.equal((await state()).route, notesA);
      assert.match(await page.locator('[data-docshelf-history-test] .docshelf-editor-status').innerText(), /Could not verify a recovery copy/);
      assert.equal(await readFile(artifacts[2].source, 'utf8'), notes);
    } finally {
      await rm(recoveryDirectory, { recursive: true, force: true });
      await rename(backup, recoveryDirectory);
    }
    await page.evaluate(leaf => leaf.view.save(), leaf);
    assert.equal(await readFile(artifacts[2].source, 'utf8'), retryText, 'Saving must resume after recovery storage returns.');
    await page.evaluate(async ({ leaf, text }) => { leaf.view.editor.setValue(text); await leaf.view.save(); }, { leaf, text: notes });

    const mine = `${notes}\nUnsaved citation edit.\n`, theirs = `${notes}\nExternal change.\n`;
    await page.evaluate(({ leaf, mine }) => leaf.view.editor.setValue(mine), { leaf, mine });
    await writeFile(artifacts[2].source, theirs);
    await page.evaluate(leaf => leaf.view.save(), leaf);
    assert.equal(await readFile(artifacts[2].source, 'utf8'), theirs);
    const draftId = (await state()).draftId;
    for (let pass = 0; pass < 2; pass++) {
      await navigate('back', reportA);
      assert.deepEqual(await page.evaluate(id => {
        const draft = app.plugins.getPlugin('docshelf').recovery.read(id);
        return { pending: draft?.pending, text: draft?.text };
      }, draftId), { pending: true, text: mine });
      await navigate('forward', notesA);
      assert.equal((await state()).draftId, draftId);
      assert.equal(await page.evaluate(leaf => leaf.view.getViewData(), leaf), mine);
      assert.match(await page.locator('[data-docshelf-history-test] .docshelf-editor-status').innerText(), /Recovered unsaved edits/);
      await page.evaluate(leaf => leaf.view.save(), leaf);
      assert.equal(await readFile(artifacts[2].source, 'utf8'), theirs, 'Returning to a draft must not approve overwriting an external change.');
    }
    // A pending draft can also leave through a same-view route change. Both
    // documents then have conflicts; Back/Forward must restore each exact draft.
    await page.evaluate(async ({ leaf, route }) => {
      const plugin = app.plugins.getPlugin('docshelf');
      await plugin.openArtifact(plugin.catalog.artifacts.find(item => item.route === route), null, '', leaf);
    }, { leaf, route: notesB });
    await ready(notesB);
    const secondMine = `${fixtures['notes-b.md']}Unsaved second note.\n`;
    const secondTheirs = `${fixtures['notes-b.md']}External second change.\n`;
    await page.evaluate(({ leaf, text }) => leaf.view.editor.setValue(text), { leaf, text: secondMine });
    await writeFile(artifacts[3].source, secondTheirs);
    await page.evaluate(leaf => leaf.view.save(), leaf);
    const secondDraftId = (await state()).draftId;
    for (let pass = 0; pass < 3; pass++) {
      for (const [direction, route, id, text] of [['back', notesA, draftId, mine], ['forward', notesB, secondDraftId, secondMine]]) {
        await navigate(direction, route);
        assert.equal((await state()).draftId, id);
        assert.equal(await page.evaluate(leaf => leaf.view.getViewData(), leaf), text);
        assert.match(await page.locator('[data-docshelf-history-test] .docshelf-editor-status').innerText(), /Recovered unsaved edits/);
        await page.evaluate(leaf => leaf.view.save(), leaf);
        assert.deepEqual(await page.evaluate(id => {
          const draft = app.plugins.getPlugin('docshelf').recovery.read(id);
          return { pending: draft?.pending, text: draft?.text };
        }, id), { pending: true, text });
        assert.equal(await readFile(artifacts[2].source, 'utf8'), theirs);
        assert.equal(await readFile(artifacts[3].source, 'utf8'), secondTheirs);
      }
    }

    // A genuine recovery-storage failure must keep the live editor and newest
    // text. The host has already moved history on Back; there is no public API
    // to undo that movement. Do not repair it by mutating private host stacks.
    await rename(recoveryDirectory, backup);
    try {
      await writeFile(recoveryDirectory, 'Recovery storage unavailable');
      const latest = `${secondMine}Not checkpointed yet.\n`;
      await page.evaluate(({ leaf, text }) => leaf.view.editor.setValue(text), { leaf, text: latest });
      await page.locator('[data-docshelf-history-test] .view-header-nav-buttons button').nth(0).click();
      await poll(async () => /Could not verify a recovery copy/.test(await page.locator('[data-docshelf-history-test] .docshelf-editor-status').innerText()), 'Failed recovery storage did not stop navigation.');
      assert.equal((await state()).route, notesB);
      assert.equal((await state()).draftId, secondDraftId);
      assert.equal(await page.evaluate(leaf => leaf.view.getViewData(), leaf), latest);
      // Cross-view transitions must verify the checkpoint before the host closes
      // the native editor, where its same-view setState guard cannot run.
      await page.evaluate(async ({ leaf, route }) => {
        const plugin = app.plugins.getPlugin('docshelf');
        await plugin.openArtifact(plugin.catalog.artifacts.find(item => item.route === route), null, '', leaf);
      }, { leaf, route: reportA });
      assert.equal((await state()).route, notesB);
      assert.equal((await state()).draftId, secondDraftId);
      assert.equal(await page.evaluate(leaf => leaf.view.getViewData(), leaf), latest);
      assert.equal(await readFile(artifacts[2].source, 'utf8'), theirs);
      assert.equal(await readFile(artifacts[3].source, 'utf8'), secondTheirs);
    } finally {
      await rm(recoveryDirectory, { recursive: true, force: true });
      await rename(backup, recoveryDirectory);
      await page.evaluate(leaf => leaf.view.save(), leaf);
    }
    console.log('Native history: HTML and Markdown citations, repeated Back/Forward, no-op states, and conflicted draft recovery passed.');
  } finally {
    if (leaf) {
      await page.evaluate(async leaf => { await leaf.setViewState({ type: 'empty' }); leaf.detach(); }, leaf);
      await leaf.dispose();
    }
    await writeFile(shelfPath, baseline);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await rm(folder, { recursive: true, force: true });
  }
}
