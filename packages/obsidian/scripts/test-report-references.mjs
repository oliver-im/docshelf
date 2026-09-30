import assert from 'node:assert/strict';

// Exercise document lifetimes and authored DOM changes, without reading the
// isolated world's cache or the host's private selection/menu state.
export async function testReportReferences({ page, poll, guest, reportStatus, selectReport, reportPoint, copied }) {
  const label = () => reportStatus.locator('.docshelf-reference-label').textContent();
  const copy = async expected => {
    await page.evaluate(() => require('electron').clipboard.writeText('reference-test'));
    await page.locator('.view-action[aria-label="Copy source reference"]:visible').dispatchEvent('click');
    await poll(async () => await copied() === expected, `Expected the copied report reference to be ${expected}.`);
  };
  const reload = async () => {
    await guest('window.referenceTestPage = true; true');
    // Model a watcher refresh without a host click that could dismiss a menu.
    await page.evaluate(() => {
      const webview = document.querySelector('webview.docshelf-webview');
      const leaf = app.workspace.getLeavesOfType('docshelf-document').find(leaf => leaf.view.containerEl.contains(webview));
      return leaf.view.loadDocument();
    });
    await poll(() => page.evaluate(() => {
      const webview = document.querySelector('webview.docshelf-webview');
      return webview && !webview.isLoading();
    }), 'The reloaded report did not finish loading.');
    await poll(() => guest('!window.referenceTestPage && !!document.querySelector("h1")'), 'The report did not reload.');
  };
  try {
    await selectReport('h1', '.intro', 'Source lines 13–14');
    // Reports can reload their own guest without replacing the host webview.
    await page.evaluate(() => new Promise(resolve => {
      const webview = document.querySelector('webview.docshelf-webview');
      webview.addEventListener('dom-ready', () => resolve(), { once: true });
      void webview.executeJavaScript('location.reload(); true').catch(() => {});
    }));
    assert.equal(await guest('getSelection().isCollapsed'), true);
    await poll(async () => await reportStatus.locator('.docshelf-reference-label').count() === 0, 'Guest navigation retained an old source selection.');
    await copy('report.html');

    const [x, y] = await reportPoint('h1');
    await page.mouse.click(x, y, { button: 'right' });
    await page.locator('.menu').waitFor();
    await reload();
    assert.equal(await page.locator('.menu, .docshelf-report-layer').count(), 0, 'Reload must dismiss the old report menu.');
    await selectReport('h1', '.intro', 'Source lines 13–14');

    await reload();
    await guest('getSelection().selectAllChildren(document.querySelector("h1")); true');
    await poll(async () => await label() === 'Source line 13', 'The heading selection did not appear.');
    // The selected text nodes and offsets survive this mutation. The nearest
    // remaining authored ancestor is <main>, which occupies source lines 10–22.
    await guest('document.querySelector("h1").removeAttribute("data-docshelf-lines"); true');
    await poll(async () => await label() === 'Source lines 10–22', 'Unchanged selection endpoints kept a stale source block after a DOM change.');
    await copy('report.html:10-22');

    await reload();
    await guest('getSelection().selectAllChildren(document.querySelector("h1")); true');
    await poll(async () => await label() === 'Source line 13', 'The heading selection did not appear.');
    await poll(() => guest('!!document.querySelector("docshelf-copy")'), 'The copy button did not appear.');
    const copyPoint = await guest(`(() => {
      const host = document.querySelector('docshelf-copy');
      document.addEventListener('click', event => {
        if (event.target === host) getSelection().selectAllChildren(document.querySelector('.intro'));
      }, true);
      const box = host.getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.evaluate(() => require('electron').clipboard.writeText('reference-test'));
    const copyFrame = await page.locator('webview.docshelf-webview').boundingBox();
    await page.mouse.click(copyFrame.x + copyPoint[0], copyFrame.y + copyPoint[1]);
    await poll(async () => await copied() === 'report.html:14', 'The copy button used a cached reference while a selection update was pending.');

    for (const restoreBeforeClick of [false, true]) {
      await reload();
      await selectReport('h1', '.intro', 'Source lines 13–14');
      await poll(() => guest('!!document.querySelector("docshelf-copy")'), 'The copy button did not appear.');
      // A closed shadow does not protect its host: move it over another report
      // control and hide it, then deliver a real trusted click at that control.
      // Restoring the style during capture must not authorize that same click.
      const target = await guest(`(() => {
      const host = document.querySelector('docshelf-copy');
      const originalStyle = host.getAttribute('style');
      const box = document.querySelector('#run-check').getBoundingClientRect();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      host.style.setProperty('position', 'fixed', 'important');
      host.style.setProperty('left', (x - 11) + 'px', 'important');
      host.style.setProperty('top', (y - 11) + 'px', 'important');
      host.style.setProperty('opacity', '0', 'important');
      window.referenceTestClicks = 0;
      document.addEventListener('click', event => {
        if (event.target !== host) return;
        window.referenceTestClicks++;
        if (${restoreBeforeClick}) host.setAttribute('style', originalStyle);
      }, true);
      return [x, y];
    })()`);
      await page.evaluate(() => require('electron').clipboard.writeText('reference-test'));
      const frame = await page.locator('webview.docshelf-webview').boundingBox();
      await page.mouse.click(frame.x + target[0], frame.y + target[1]);
      await poll(() => guest('window.referenceTestClicks === 1'), 'The tampering check did not hit the relocated copy button.');
      await page.waitForTimeout(200);
      assert.equal(await copied(), 'reference-test', 'An invisible relocated button must not trigger a host copy.');
    }
    console.log('Report navigation, menu teardown, DOM changes, and copy-button tampering checks passed.');
  } finally {
    await reload();
  }
}
