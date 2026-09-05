import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRemoteMarkdown, remoteMarkdownSizeLimit } from '../src/lib/remote-markdown.js';

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
