import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.DOCSHELF_TEST_BROWSER || [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(file => existsSync(file));

test('Mermaid keeps diagram labels and strips active renderer markup', { skip: !executablePath, timeout: 120000 }, async t => {
  const launching = chromium.launch({ executablePath, headless: true, timeout: 90000 });
  t.after(async () => { const browser = await launching.catch(() => null); await browser?.close(); });
  const browser = await launching;
  t.signal.throwIfAborted();
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const sanitizer = fileURLToPath(new URL('./purify.min.js', import.meta.resolve('dompurify')));
  const renderer = fileURLToPath(new URL('../public/markdown-mermaid.js', import.meta.url));
  await page.setContent('<html data-theme="light"><body><pre><code class="language-mermaid">flowchart TD\n A[First label] --&gt; B[Second label]</code></pre></body></html>');
  await page.addScriptTag({ path: sanitizer });
  await page.addScriptTag({ path: fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js')) });
  await page.addScriptTag({ path: renderer });
  await page.waitForSelector('.mermaid-diagram:not([hidden]) svg');
  assert.match(await page.locator('.mermaid-diagram').textContent(), /First label/);
  assert.match(await page.locator('.mermaid-diagram').textContent(), /Second label/);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.dispatchEvent(new Event('docshelf:themechange')); });
  await page.waitForSelector('svg[id="docshelf-mermaid-2-0"]');
  assert.match(await page.locator('.mermaid-diagram').textContent(), /First label/);

  await page.setContent('<pre><code class="language-mermaid">untrusted renderer output</code></pre>');
  await page.addScriptTag({ path: sanitizer });
  await page.evaluate(() => {
    window.mermaid = {
      initialize() {},
      async render() {
        return { svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.compromised = true"><script>window.compromised = true</script><a href="javascript:window.compromised=true"><text>Safe label</text></a><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.compromised=true"/><iframe srcdoc="unsafe"></iframe>HTML label</div></foreignObject></svg>' };
      },
    };
  });
  await page.addScriptTag({ path: renderer });
  await page.waitForSelector('.mermaid-diagram:not([hidden]) svg');
  assert.match(await page.locator('.mermaid-diagram').textContent(), /Safe label/);
  assert.match(await page.locator('.mermaid-diagram').textContent(), /HTML label/);
  assert.equal(await page.locator('.mermaid-diagram script, .mermaid-diagram iframe, .mermaid-diagram [onload], .mermaid-diagram [onerror], .mermaid-diagram [href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.compromised), undefined);

  // A missing sanitizer must preserve the readable source, never insert raw SVG.
  await page.evaluate(() => { delete window.DOMPurify; window.dispatchEvent(new Event('docshelf:themechange')); });
  await page.waitForSelector('.mermaid-render-error:not([hidden])');
  assert.equal(await page.locator('.mermaid-diagram svg').count(), 0);
  assert.equal(await page.locator('pre').isVisible(), true);
});
