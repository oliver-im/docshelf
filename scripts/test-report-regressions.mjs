import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export async function testReportRegressions({ page, poll, workspace, shelfPath, shelf, guest }) {
  const otherPath = path.join(workspace, 'other.html');
  const other = { project: 'Reports', title: 'Other report', source: otherPath, route: 'examples/other.html' };
  await writeFile(otherPath, '<p>Private report body</p>');
  const expanded = { ...shelf, artifacts: [...shelf.artifacts, other] };
  const refresh = () => page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  const state = () => page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf');
    const webview = document.querySelector('webview.docshelf-webview');
    const view = app.workspace.getLeavesOfType('docshelf-document').map(leaf => leaf.view).find(view => view.containerEl.contains(webview));
    return { generation: view.generation, revision: plugin.documentRevision(view.artifact.route) };
  });
  const before = await state();
  const preserved = async () => {
    assert.deepEqual(await state(), before, 'An unrelated shelf failure must not reload the report.');
    assert.equal(await guest('document.querySelector("#checks").textContent'), '1', 'Report interaction state must survive unrelated failures and recovery.');
  };
  try {
    await writeFile(shelfPath, JSON.stringify(expanded));
    await refresh();
    await preserved();
    await rm(otherPath);
    await refresh();
    assert.match(await page.evaluate(() => app.plugins.getPlugin('docshelf').error), /ENOENT/);
    await preserved();
    await writeFile(otherPath, '<p>Private report body</p>');
    await refresh();
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').error), '');
    await preserved();
    await page.evaluate(() => app.plugins.getPlugin('docshelf').watcher.emit('error', new Error('Temporary watcher failure')));
    await preserved();
    await refresh();
    await preserved();
    await writeFile(shelfPath, '{invalid');
    await refresh();
    await preserved();
    await writeFile(shelfPath, JSON.stringify(expanded));
    await refresh();
    await preserved();

    const urls = await page.evaluate(() => {
      const plugin = app.plugins.getPlugin('docshelf');
      const other = plugin.catalog.artifacts.find(item => item.title === 'Other report');
      const own = new URL(plugin.server.documentUrl(plugin.catalog.artifacts[1]));
      const crossRead = new URL(plugin.server.documentUrl(other));
      crossRead.pathname = crossRead.pathname.replace(crossRead.pathname.split('/')[1], own.pathname.split('/')[1]);
      const navigation = plugin.server.navigationUrl(other);
      return { crossRead: crossRead.href, navigation, navigationRead: navigation.replace(`/open/${other.id}`, `/d/${other.id}/other.html`) };
    });
    const probes = await guest(`(async () => {
      const result = {};
      for (const [name, url] of Object.entries(${JSON.stringify(urls)})) {
        const response = await fetch(url);
        result[name] = { status: response.status, body: await response.text() };
      }
      return result;
    })()`);
    assert.equal(probes.crossRead.status, 404);
    assert.equal(probes.navigationRead.status, 404);
    assert.equal(probes.navigation.status, 200);
    assert.ok(Object.values(probes).every(result => !result.body.includes('Private report body')));

    await page.evaluate(() => {
      const plugin = app.plugins.getPlugin('docshelf');
      window.docshelfOriginalOpenExternal = plugin.openExternal;
      window.docshelfExternalLinks = [];
      plugin.openExternal = url => window.docshelfExternalLinks.push(url);
    });
    const originalUrl = await guest('location.href');
    await guest(`(() => { const a = document.createElement('a'); a.href = 'https://example.com/docshelf-navigation'; document.body.append(a); a.click(); })()`);
    await poll(() => page.evaluate(() => window.docshelfExternalLinks.includes('https://example.com/docshelf-navigation')), 'External links were not sent to the system-browser action.');
    assert.equal(await guest('location.href'), originalUrl);
    await preserved();
    await guest(`location.href = 'https://example.com/docshelf-redirect'`);
    await poll(() => page.evaluate(() => window.docshelfExternalLinks.includes('https://example.com/docshelf-redirect')), 'A scripted redirect escaped the report navigation guard.');
    assert.equal(await guest('location.href'), originalUrl);
    await preserved();
    await guest(`location.href = '#checks'`);
    await poll(() => guest('location.hash === "#checks"'), 'Same-report anchors should keep working.');
    await preserved();
    console.log('Report state survives unrelated failures; cross-report reads are blocked and external navigation preserves the report.');
  } finally {
    await page.evaluate(() => {
      const plugin = app.plugins.getPlugin('docshelf');
      if (window.docshelfOriginalOpenExternal) plugin.openExternal = window.docshelfOriginalOpenExternal;
      delete window.docshelfOriginalOpenExternal;
      delete window.docshelfExternalLinks;
    });
    await writeFile(shelfPath, JSON.stringify(shelf));
    await refresh();
    await rm(otherPath, { force: true });
  }
}
