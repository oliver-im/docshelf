import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readPins, setPin, pinnedIdentities, pinStorageKey } from '../packages/core/src/pins.js';

const source = await readFile(new URL('../src/components/ArtifactViewer.astro', import.meta.url), 'utf8');
const readStoredPins = source.slice(source.indexOf('    function readStoredPins()'), source.indexOf('    let pins = readStoredPins();'));
const body = readStoredPins + source.slice(source.indexOf('    function groupPinKind('), source.indexOf('    function showPins()'));
const script = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('web folder toggle rereads storage under the shared lock, and removes all collapsed aliases without dropping document pins', async () => {
  const heading = { dataset: { docshelfFolderIdentity: 'deep' } };
  const documents = { version: 1, sources: ['concurrent-document'] };
  let stored = { version: 1, sources: [], folders: ['outer', 'deep', 'other'] };
  let renders = 0;
  let locked = false;
  const context = vm.createContext({
    folderHeadings: new Map([['outer', heading], ['deep', heading]]),
    pins: readPins(null), pinsKey: 'shelf-pins', folderPinsKey: 'shelf-pins:folders', projectPinsKey: 'shelf-pins:projects', projectHeadings: new Map(), readPins, setPin, pinnedIdentities, pinStorageKey,
    navigator: { locks: { request: async (key, update) => { assert.equal(key, 'shelf-pins'); locked = true; update(); locked = false; } } },
    readStoredValue: key => { assert.equal(locked, true); return key === 'shelf-pins' ? documents : stored; },
    writeStoredValue: (key, next) => { assert.equal(key, 'shelf-pins:folders'); stored = next; return true; },
    showPins: () => renders++,
  });
  const toggle = vm.runInContext(`${script}\ntoggleGroupPin`, context);
  await toggle(heading, false);
  assert.equal(JSON.stringify(stored), JSON.stringify({ version: 1, sources: [], folders: ['other'] }));
  assert.deepEqual(documents.sources, ['concurrent-document']);
  documents.sources = ['legacy-writer'];
  await toggle(heading, true);
  assert.deepEqual(stored.folders, ['other', 'deep']);
  assert.deepEqual(context.pins.sources, ['legacy-writer']);
  assert.equal(renders, 2);
});

test('web folder pin storage failures preserve the current UI state', async () => {
  const initial = readPins(null);
  const context = vm.createContext({
    folderHeadings: new Map(), pins: initial, pinsKey: 'shelf-pins', folderPinsKey: 'shelf-pins:folders', projectPinsKey: 'shelf-pins:projects', projectHeadings: new Map(), readPins, setPin, pinnedIdentities, pinStorageKey,
    navigator: { locks: { request: async (_key, update) => update() } },
    readStoredValue: () => initial, writeStoredValue: () => false,
    showPins: () => assert.fail('must not render unsaved pins'),
  });
  const toggle = vm.runInContext(`${script}\ntoggleGroupPin`, context);
  await assert.rejects(toggle({ dataset: { docshelfFolderIdentity: 'folder' } }, true), /could not be saved/);
  assert.equal(context.pins, initial);
});


test('web project pins reread concurrent state, preserve other kinds and reject unavailable locks', async () => {
  const heading = { dataset: { docshelfProjectIdentity: 'Project [one]' } };
  const records = new Map([
    ['shelf-pins', { version: 1, sources: ['document'] }],
    ['shelf-pins:folders', { version: 1, sources: [], folders: ['folder'] }],
    ['shelf-pins:projects', { version: 1, sources: [], projects: ['Existing'] }],
  ]);
  let locked = false;
  const context = vm.createContext({
    folderHeadings: new Map(), projectHeadings: new Map([['Project [one]', heading]]),
    pins: readPins(null), pinsKey: 'shelf-pins', folderPinsKey: 'shelf-pins:folders', projectPinsKey: 'shelf-pins:projects',
    readPins, setPin, pinnedIdentities, pinStorageKey,
    navigator: { locks: { request: async (key, update) => { assert.equal(key, 'shelf-pins'); locked = true; update(); locked = false; } } },
    readStoredValue: key => { assert.equal(locked, true); return records.get(key); },
    writeStoredValue: (key, next) => { assert.equal(key, 'shelf-pins:projects'); records.set(key, next); return true; },
    showPins: () => {},
  });
  const toggle = vm.runInContext(`${script}\ntoggleGroupPin`, context);
  await toggle(heading, true);
  assert.deepEqual(records.get('shelf-pins:projects').projects, ['Existing', 'Project [one]']);
  assert.deepEqual(context.pins.sources, ['document']);
  assert.deepEqual(context.pins.folders, ['folder']);
  records.set('shelf-pins:projects', { version: 1, projects: ['Existing', 'Project [one]', 'Concurrent'] });
  await toggle(heading, false);
  assert.deepEqual(records.get('shelf-pins:projects').projects, ['Existing', 'Concurrent']);
  context.navigator.locks = undefined;
  await assert.rejects(toggle(heading, true), /HTTPS or localhost/);
  assert.deepEqual(records.get('shelf-pins:projects').projects, ['Existing', 'Concurrent']);
});
