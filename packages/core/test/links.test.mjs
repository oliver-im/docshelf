import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserLink, createObsidianLink, createSourceReference, createViewerLocation } from '../src/links.js';
import { parseLineFragment } from '../src/line-permalinks.js';

test('browser and Obsidian links preserve one source range and reserved characters', () => {
  const range = { start: 7, end: 11 };
  const source = '/projects/한글 notes/a+b & c.md';
  const vault = 'Work + notes';
  const browser = new URL(createBrowserLink('https://shelf.localhost/docshelf', 'project/a+b.html', range));
  assert.equal(browser.pathname, '/docshelf/');
  assert.equal(browser.searchParams.get('artifact'), 'project/a+b.html');
  assert.deepEqual(parseLineFragment(browser.hash), range);
  const obsidian = new URL(createObsidianLink(vault, source, range));
  assert.equal(obsidian.protocol, 'obsidian:');
  assert.equal(obsidian.hostname, 'docshelf');
  // Simulate Obsidian's decodeURIComponent dispatch, not form decoding.
  const decoded = Object.fromEntries(obsidian.search.slice(1).split('&').map(item => item.split('=').map(decodeURIComponent)));
  assert.deepEqual(decoded, { vault, source, lines: '7-11' });
  assert.equal(createSourceReference(source, true, range), `${source}:7-11`);
  assert.equal(createSourceReference('https://github.com/a/b/blob/main/README.md', false, range), 'https://github.com/a/b/blob/main/README.md#L7-L11');
});

test('whole-document and single-line links have consistent canonical forms', () => {
  assert.equal(createBrowserLink('http://localhost:4321/', 'guide.html'), 'http://localhost:4321/?artifact=guide.html');
  assert.equal(createBrowserLink('https://shelf.localhost/', 'guide.html', { start: 3, end: 3 }), 'https://shelf.localhost/?artifact=guide.html#L3');
  assert.equal(new URL(createObsidianLink('v', '/a.md', { start: 3, end: 3 })).searchParams.get('lines'), '3');
  assert.equal(createSourceReference('/a.md', true), '/a.md');
  const location = new URL(createViewerLocation('guide.html', '?mode=plot&a=1', '#section'), 'https://shelf.localhost/');
  assert.equal(location.searchParams.get('artifact-query'), '?mode=plot&a=1');
  assert.equal(location.hash, '#section');
});

test('invalid addresses and ranges cannot produce misleading links', () => {
  for (const site of ['javascript:alert(1)', 'file:///tmp/', 'https://user:pass@example.com/', 'https://example.com/?a=b', 'https://example.com/#section']) {
    assert.throws(() => createBrowserLink(site, 'guide.html'));
  }
  for (const range of [{ start: 0, end: 1 }, { start: 7, end: 2 }, { start: 1, end: Infinity }]) {
    assert.throws(() => createBrowserLink('https://shelf.localhost/', 'guide.html', range));
    assert.throws(() => createObsidianLink('v', '/a.md', range));
    assert.throws(() => createSourceReference('/a.md', true, range));
  }
  assert.throws(() => createObsidianLink('', '/a.md'));
  assert.throws(() => createObsidianLink('v', ''));
});
