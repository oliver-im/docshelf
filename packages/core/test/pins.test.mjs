import assert from 'node:assert/strict';
import test from 'node:test';
import { readPins, setPinned, setFolderPinned, folderPinIdentity } from '../src/pins.js';

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

test('folder pins migrate old document state and document actions preserve folders', () => {
  const folder = folderPinIdentity('Project', 'directory-key');
  const original = { version: 1, sources: ['source'] };
  const pinned = setFolderPinned(original, folder, true);
  assert.deepEqual(pinned, { version: 1, sources: ['source'], folders: [folder] });
  assert.deepEqual(setPinned(pinned, 'other', true).folders, [folder]);
  assert.deepEqual(setFolderPinned(pinned, folder, false).sources, ['source']);
  assert.deepEqual(setFolderPinned(pinned, folder, true), pinned);
  assert.deepEqual(original, { version: 1, sources: ['source'] });
  assert.notEqual(folderPinIdentity('Other', 'directory-key'), folder);
});

test('folder state is independently validated and keeps absent identities', () => {
  assert.deepEqual(readPins({ version: 1, sources: [], folders: ['a', null, '', 'a', 'absent'] }).folders, ['a', 'absent']);
  assert.deepEqual(readPins({ version: 1, sources: ['source'], folders: false }).folders, []);
  assert.deepEqual(setFolderPinned({ version: 1, sources: [], folders: ['absent'] }, 'next', true).folders, ['absent', 'next']);
});
