import assert from 'node:assert/strict';
import test from 'node:test';
import { readPins, setPinned } from '../src/pins.js';

test('stored pins ignore malformed entries and keep the first position of duplicate sources', () => {
  assert.deepEqual(readPins({ version: 1, sources: ['one', null, 'two', '', 'one', 3] }).sources, ['one', 'two']);
  for (const value of [null, [], 'one', { version: 2, sources: ['one'] }, { version: 1, sources: 'one' }]) {
    assert.deepEqual(readPins(value).sources, []);
  }
});

test('explicit pin actions preserve other and temporarily absent sources without reordering existing pins', () => {
  const stored = { version: 1, sources: ['/work/absent.md', '/work/guide.md'] };
  const pinned = setPinned(stored, '/work/report.md', true);
  assert.deepEqual(pinned.sources, ['/work/absent.md', '/work/guide.md', '/work/report.md']);
  assert.deepEqual(setPinned(pinned, '/work/guide.md', true).sources, pinned.sources);
  assert.deepEqual(setPinned(pinned, '/work/guide.md', false).sources, ['/work/absent.md', '/work/report.md']);
  assert.deepEqual(stored.sources, ['/work/absent.md', '/work/guide.md']);
});
