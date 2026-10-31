import assert from 'node:assert/strict';
import { appendEvent, endCursor, eventLogPath } from '../../local/events.mjs';
import { createEvent } from '@docshelf/core/events';

export async function testSharedReadState({ page, poll, shelfPath, openSecondVault }) {
  const sources = await page.evaluate(() => app.plugins.getPlugin('docshelf').catalog.artifacts.map(artifact => artifact.canonicalPath || artifact.sourcePath));
  assert.equal(sources.length, 2);
  const announce = source => appendEvent(shelfPath, createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source } }));
  const before = await endCursor(eventLogPath(shelfPath));
  await announce(sources[0]);
  await announce(sources[1]);
  const after = await endCursor(eventLogPath(shelfPath));
  // Simulate an upgrade with two real vault namespaces, one of which has not
  // consumed the latest events. The newer vault has read only the first update.
  await page.evaluate(async ({ shelfPath, sources, before, after }) => {
    await app.plugins.disablePlugin('docshelf');
    localStorage.removeItem(`docshelf:obsidian:read-state:${shelfPath}`);
    for (const [vault, seen, cursor] of [['d0c5he1f00000001', sources, before], ['d0c5he1f00000002', [sources[0]], after]]) {
      localStorage.setItem(`${vault}-docshelf-read-state:${shelfPath}`, JSON.stringify({ version: 1, seen }));
      localStorage.setItem(`${vault}-docshelf-event-cursor:${shelfPath}`, JSON.stringify(cursor));
    }
    document.hasFocus = () => false;
    await app.plugins.enablePlugin('docshelf');
    await app.plugins.getPlugin('docshelf').ready;
    await app.plugins.getPlugin('docshelf').openShelf();
  }, { shelfPath, sources, before, after });
  const second = await openSecondVault();
  try {
    await second.evaluate(async () => {
      document.hasFocus = () => false;
      await app.plugins.getPlugin('docshelf').openShelf();
    });
    const unread = window => window.evaluate(() => {
      const p = app.plugins.getPlugin('docshelf');
      return p.catalog.artifacts.filter(artifact => p.isUnread(artifact)).map(artifact => artifact.canonicalPath || artifact.sourcePath);
    });
    const expectBoth = async expected => {
      for (const window of [page, second]) await poll(async () => JSON.stringify(await unread(window)) === JSON.stringify(expected), 'Vault windows disagree on the shelf read status.');
    };
    await expectBoth([sources[1]]);
    const mark = (window, source) => window.evaluate(async source => {
      const p = app.plugins.getPlugin('docshelf');
      await p.markArtifactsRead(p.catalog.artifacts.filter(artifact => artifact.canonicalPath === source || artifact.sourcePath === source));
    }, source);
    await mark(page, sources[1]);
    await expectBoth([]);
    assert.equal(await second.locator('.docshelf-unread-dot').count(), 0, 'The other vault sidebar must update without a manual refresh.');

    await announce(sources[0]);
    await announce(sources[1]);
    await expectBoth(sources);
    await Promise.all([mark(page, sources[0]), mark(second, sources[1])]);
    await expectBoth([]);
    // A background window can consume an event first; the focused window still
    // clears the document it is showing, and broadcasts that read back.
    await page.evaluate(async source => {
      const p = app.plugins.getPlugin('docshelf');
      await p.openArtifact(p.catalog.artifacts.find(artifact => artifact.canonicalPath === source || artifact.sourcePath === source));
    }, sources[0]);
    await announce(sources[0]);
    await expectBoth([sources[0]]);
    await page.evaluate(async () => {
      document.hasFocus = () => true;
      await app.plugins.getPlugin('docshelf').readAnnouncements();
    });
    await expectBoth([]);

    await second.evaluate(async () => {
      await app.plugins.disablePlugin('docshelf');
      await app.plugins.enablePlugin('docshelf');
      await app.plugins.getPlugin('docshelf').ready;
      await app.plugins.getPlugin('docshelf').refresh();
      await app.plugins.getPlugin('docshelf').readAnnouncements();
    });
    await expectBoth([]);
    console.log('Shared read status migrated vault histories, synchronized two vault windows, preserved concurrent reads, and survived reload without replaying updates.');
    const pin = (window, index, pinned) => window.evaluate(async ({ index, pinned }) => {
      const p = app.plugins.getPlugin('docshelf');
      await p.pinDocument(p.catalog.artifacts[index], pinned);
    }, { index, pinned });
    await Promise.all([pin(page, 0, true), pin(second, 1, true)]);
    for (const window of [page, second]) {
      await poll(async () => await window.locator('.docshelf-pinned .docshelf-item').count() === 2, 'Concurrent pins were lost or did not reach the other vault window.');
    }
    await Promise.all([pin(second, 0, false), pin(page, 1, false)]);
    for (const window of [page, second]) {
      await poll(async () => await window.locator('.docshelf-pinned').count() === 0, 'Unpinning did not reach the other vault window.');
    }
    console.log('Document pins synchronized between vault windows without losing concurrent changes.');
  } finally {
    await page.evaluate(() => { delete document.hasFocus; });
    await second.close();
  }
}
