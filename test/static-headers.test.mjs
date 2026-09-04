import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheControl, entityTag, isFresh } from '../scripts/static-headers.mjs';

test('only hashed Astro assets are cached without revalidation', () => {
  assert.equal(cacheControl('_astro/page.Dwipeu-R.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('_astro/ec.0vx5m.js'), 'public, max-age=31536000, immutable');
  for (const relativePath of [
    'index.html',
    'artifacts/example/report.html',
    'artifacts/.docshelf-revisions.json',
    'pagefind/pagefind.js',
    '_astro',
    '_astro/page.js',
    '_astro/vendor.bundle.js',
    'nested/_astro/page.js',
  ]) {
    assert.equal(cacheControl(relativePath), 'no-cache', relativePath);
  }
});

test('entity tags prefer the content revision and fall back to size and mtime', () => {
  const stats = { size: 4096, mtimeMs: 1_700_000_000_123.4 };
  const revision = 'a'.repeat(64);

  assert.equal(entityTag(stats, revision), `"${revision}"`);
  assert.equal(entityTag(stats), `W/"1000-${(1_700_000_000_123).toString(16)}"`);
  assert.notEqual(entityTag({ ...stats, size: 4097 }), entityTag(stats));
  assert.notEqual(entityTag({ ...stats, mtimeMs: stats.mtimeMs + 1000 }), entityTag(stats));
});

test('freshness follows If-None-Match using weak comparison', () => {
  const etag = '"abc"';

  assert.equal(isFresh({}, etag), false);
  assert.equal(isFresh({ 'if-none-match': '"abc"' }, etag), true);
  assert.equal(isFresh({ 'if-none-match': '"xyz", "abc"' }, etag), true);
  assert.equal(isFresh({ 'if-none-match': '*' }, etag), true);
  assert.equal(isFresh({ 'if-none-match': '"xyz"' }, etag), false);
  assert.equal(isFresh({ 'if-none-match': 'W/"abc"' }, etag), true);
  assert.equal(isFresh({ 'if-none-match': '"abc"' }, 'W/"abc"'), true);
});
