import assert from 'node:assert/strict';
import test from 'node:test';
import DOMPurify from 'dompurify';
import { fetchRemoteMarkdown, remoteMarkdownSizeLimit, renderRemoteMarkdownDocument } from '../src/lib/remote-markdown.js';

test('generated Markdown authorizes only its own scripts with a fresh nonce', async (t) => {
  // Node has no DOM. Stub only DOM-dependent transformation here: this test
  // exercises the generated document's CSP wiring, not DOMPurify itself.
  const originalSanitize = Object.getOwnPropertyDescriptor(DOMPurify, 'sanitize');
  const originalParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  t.after(() => {
    if (originalSanitize) Object.defineProperty(DOMPurify, 'sanitize', originalSanitize);
    else delete DOMPurify.sanitize;
    if (originalParser) Object.defineProperty(globalThis, 'DOMParser', originalParser);
    else delete globalThis.DOMParser;
  });
  DOMPurify.sanitize = (html) => html;
  globalThis.DOMParser = class {
    parseFromString() {
      const content = { innerHTML: '<p>Fixture</p>', querySelector: () => null, querySelectorAll: () => [] };
      return { querySelector: () => content };
    }
  };
  const options = {
    fallbackTitle: 'Fixture',
    sourceUrl: 'https://github.com/owner/repo/blob/main/a.md',
    assetBaseUrl: 'https://raw.githubusercontent.com/owner/repo/main/a.md',
    linkBaseUrl: 'https://github.com/owner/repo/blob/main/a.md',
    stylesheetUrl: 'https://shelf.example/docshelf/markdown-tokyo-night.css',
    lineLinksScriptUrl: 'https://shelf.example/docshelf/markdown-line-links.js',
  };
  const first = await renderRemoteMarkdownDocument('Fixture', options);
  const second = await renderRemoteMarkdownDocument('Fixture', options);
  const nonce = first.html.match(/script-src 'nonce-([a-f0-9]{48})';/)?.[1];
  assert.ok(nonce);
  assert.doesNotMatch(first.html, /unsafe-inline|unsafe-eval/);
  const scripts = Array.from(first.html.matchAll(/<script\b([^>]*)>/g));
  assert.equal(scripts.length, 2);
  for (const [, attributes] of scripts) assert.ok(attributes.includes(`nonce="${nonce}"`));
  assert.doesNotMatch(second.html, new RegExp(nonce));
  assert.match(first.html, /src="https:\/\/shelf.example\/docshelf\/markdown-line-links.js"/);
});

test('remote Markdown fetch decodes UTF-8 split across network chunks', async (t) => {
  const bytes = new TextEncoder().encode('# 안녕하세요\n');
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    }));
  });
  const result = await fetchRemoteMarkdown('https://raw.githubusercontent.com/owner/repo/main/a.md');
  assert.equal(result.markdown, '# 안녕하세요\n');
});

test('remote Markdown fetch cancels an oversized stream without content-length', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(remoteMarkdownSizeLimit + 1));
    },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(fetchRemoteMarkdown('https://raw.githubusercontent.com/owner/repo/main/a.md'), /2 MB limit/);
  assert.equal(cancelled, true);
});
