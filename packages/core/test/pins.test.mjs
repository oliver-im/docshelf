import assert from 'node:assert/strict';
import test from 'node:test';
import { readPins, setPinned, setFolderPinned, folderPinIdentity, setPin, pinnedIdentities, pinStorageKey } from '../src/pins.js';

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
  assert.deepEqual(pinned, { version: 1, sources: ['source'], folders: [folder], projects: [] });
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


test('generic pin actions preserve every other kind, ordering, absent entries and legacy wrappers', () => {
  const original = { version: 1, sources: ['document'], folders: ['folder'], projects: ['absent', 'Project'] };
  for (const kind of ['document', 'folder', 'project']) {
    const next = setPin(original, kind, 'new', true);
    assert.deepEqual(pinnedIdentities(next, kind), [...pinnedIdentities(original, kind), 'new']);
    assert.deepEqual(setPin(next, kind, 'new', true), next);
    assert.deepEqual(setPin(next, kind, 'new', false), original);
    assert.deepEqual(setPin(original, kind, '', true), original);
    for (const other of ['document', 'folder', 'project'].filter(value => value !== kind)) {
      assert.deepEqual(pinnedIdentities(next, other), pinnedIdentities(original, other));
    }
  }
  assert.deepEqual(setPinned(original, 'next', true), setPin(original, 'document', 'next', true));
  assert.deepEqual(setFolderPinned(original, 'next', true), setPin(original, 'folder', 'next', true));
  assert.deepEqual(original.projects, ['absent', 'Project']);
});

test('project identities validate independently and do not collide with other kinds', () => {
  assert.deepEqual(readPins({ version: 1, sources: ['source'], folders: ['folder'], projects: ['Project', null, '', 'Project', 'Absent'] }), {
    version: 1, sources: ['source'], folders: ['folder'], projects: ['Project', 'Absent'],
  });
  assert.deepEqual(readPins({ version: 1, sources: ['legacy'], folders: ['legacy-folder'] }).projects, []);
  assert.deepEqual(readPins({ version: 1, projects: 'Project' }).projects, []);
  assert.deepEqual(readPins({ version: 2, projects: ['Project'] }).projects, []);
  const identical = setPin(setPin(setPin(null, 'project', 'same', true), 'folder', 'same', true), 'document', 'same', true);
  assert.deepEqual(setPin(identical, 'project', 'same', false), { version: 1, sources: ['same'], folders: ['same'], projects: [] });
});

test('storage keys preserve legacy records and isolate pin kinds and shelves', () => {
  assert.equal(pinStorageKey('shelf', 'document'), 'shelf');
  assert.equal(pinStorageKey('shelf', 'folder'), 'shelf:folders');
  assert.equal(pinStorageKey('shelf', 'project'), 'shelf:projects');
  const stored = new Map();
  for (const kind of ['document', 'folder', 'project']) stored.set(pinStorageKey('shelf', kind), setPin(null, kind, kind, true));
  stored.set(pinStorageKey('shelf', 'document'), { version: 1, sources: ['legacy-write'] });
  stored.set(pinStorageKey('shelf', 'folder'), { version: 1, sources: [], folders: ['old-folder-write'] });
  assert.deepEqual(pinnedIdentities(stored.get(pinStorageKey('shelf', 'project')), 'project'), ['project']);
  assert.deepEqual(pinnedIdentities(stored.get(pinStorageKey('another-shelf', 'project')), 'project'), []);
});
