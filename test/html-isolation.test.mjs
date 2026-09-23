import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { artifactContentSecurityPolicy } from '../scripts/html-isolation.mjs';
import { createLocalActionsHandler } from '../scripts/local-actions.mjs';
import { rewriteArtifactLinks } from '../scripts/artifact-html.mjs';
import { htmlSandbox } from '../src/lib/html-sandbox.js';

test('HTML isolation is fail-closed and only exempts known rendered Markdown', () => {
  const markdown = new Set(['notes.html']);
  assert.match(artifactContentSecurityPolicy('artifacts/report.html', markdown), /^sandbox /);
  assert.equal(artifactContentSecurityPolicy('artifacts/notes.html', markdown), undefined);
  assert.equal(artifactContentSecurityPolicy('index.html', markdown), undefined);
  assert.match(artifactContentSecurityPolicy('artifacts/notes.html'), /^sandbox /);
  for (const route of ['ARTIFACTS/report.html', 'Artifacts/report.HTML', 'ARTIFACTS/notes.html', 'artifacts/NOTES.html']) {
    assert.match(artifactContentSecurityPolicy(route, markdown), /^sandbox /, route);
  }
  assert.ok(!htmlSandbox.includes('allow-same-origin'));
  assert.ok(!htmlSandbox.includes('allow-popups-to-escape-sandbox'));
});

const executablePath = process.env.DOCSHELF_TEST_BROWSER || [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(file => existsSync(file));

test('interactive HTML cannot read capabilities or register paths, framed or opened directly', { skip: !executablePath, timeout: 20000 }, async t => {
  const calls = [];
  const handler = createLocalActionsHandler({ listenHost: '127.0.0.1', registration: async body => { calls.push(body); return { ok: true }; } });
  const artifact = { format: 'html', sourcePath: '/fixture/report.html', route: 'report.html' };
  const target = { format: 'markdown', sourcePath: '/fixture/notes.md', route: 'notes.html' };
  const html = await rewriteArtifactLinks(`<html><head><title>Untrusted report</title></head><body>
    <a href="notes.md#example">Notes</a><button onclick="this.textContent='Working'">Interact</button>
    <script>window.probe = (async () => {
      const result = {};
      try { parent.document.body.dataset.compromised = 'yes'; result.parent = true; } catch { result.parent = false; }
      try { localStorage.setItem('compromised', 'yes'); result.storage = true; } catch { result.storage = false; }
      try {
        const capability = await (await fetch('/__docshelf/local-actions', { headers: { 'X-DocShelf-Request': 'document-actions' } })).json();
        result.capabilities = true;
        await fetch('/__docshelf/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DocShelf-Request': 'document-actions', 'X-DocShelf-Token': capability.token }, body: JSON.stringify({ action: 'preview', sources: ['private'] }) });
      } catch { result.capabilities = false; }
      return result;
    })();</script></body></html>`, artifact, { artifacts: [artifact, target] });
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (await handler(request, response, pathname)) return;
      response.setHeader('Content-Type', 'text/html');
      const policy = artifactContentSecurityPolicy(pathname.slice(1));
      if (policy) response.setHeader('Content-Security-Policy', policy);
      // Model the same file being served through differently cased URLs on macOS/Windows.
      if (/^\/artifacts\//i.test(pathname)) response.end(html);
      else response.end(`<html data-theme="light"><body><iframe sandbox="${htmlSandbox}" src="/artifacts/report.html"></iframe><script>
        window.docshelfBridgeMessages = [];
        addEventListener('message', event => {
          if (event.source !== document.querySelector('iframe').contentWindow || event.origin !== 'null') return;
          docshelfBridgeMessages.push(event.data);
          if (event.data.type === 'docshelf-theme-request') event.source.postMessage({ type: 'docshelf-theme', theme: 'light' }, '*');
        });
      </script></body></html>`);
    })().catch(error => { response.statusCode = 500; response.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(origin);
  const frame = page.frames().find(frame => frame.url().includes('/artifacts/'));
  assert.deepEqual(await frame.evaluate(() => window.probe), { parent: false, storage: false, capabilities: false });
  await frame.locator('button').click();
  assert.equal(await frame.locator('button').textContent(), 'Working');
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await frame.locator('a').click();
  await page.waitForFunction(() => window.docshelfBridgeMessages.some(message => message.type === 'docshelf-navigate' && message.route === 'notes.html' && message.hash === '#example'));
  const direct = await browser.newPage();
  for (const route of ['artifacts/report.html', 'ARTIFACTS/report.html', 'Artifacts/report.HTML']) {
    const response = await direct.goto(`${origin}/${route}`);
    assert.equal(response.headers()['content-security-policy'], `sandbox ${htmlSandbox}`, route);
    const standalone = await direct.evaluate(() => window.probe);
    assert.equal(standalone.capabilities, false, route);
    assert.equal(standalone.storage, false, route);
  }
  assert.deepEqual(calls, []);
  // The trusted interface still has access to the same endpoint.
  assert.equal(await page.evaluate(async () => (await fetch('/__docshelf/local-actions', { headers: { 'X-DocShelf-Request': 'document-actions' } })).status), 200);
});
