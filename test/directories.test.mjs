import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, realpath, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';
import { expandShelf, prepareAddition, addToShelf, commitAddition, prepareRemoval, removeFromShelf, assertRegisteredSource } from '../packages/local/shelf.mjs';
import { createRegistrationHandler } from '../scripts/registration.mjs';
import { SourceWatcher } from '../scripts/source-watcher.mjs';
import { loadShelfFrom, docShelfRoot } from '../scripts/artifacts.mjs';

async function fixture(t) {
  const base = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-folders-'));
  await mkdir(path.join(base, 'docs/nested'), { recursive: true });
  await writeFile(path.join(base, 'docs/one.md'), '# First document\n');
  await writeFile(path.join(base, 'docs/nested/two.html'), '<title>Second document</title>');
  const config = { version: 2, artifacts: [], directories: [{ id: 'project', source: 'docs', project: 'Project' }] };
  return { base, roots: [base], config, shelfPath: path.join(base, 'shelf.local.json') };
}

test('recursive discovery, exclusions, explicit hidden roots, and stable routes', async t => {
  const f = await fixture(t);
  for (const directory of ['.hidden', 'node_modules', 'dist', 'drafts']) {
    await mkdir(path.join(f.base, 'docs', directory));
    await writeFile(path.join(f.base, 'docs', directory, 'ignored.md'), '# Ignore');
  }
  f.config.directories[0].exclude = ['drafts'];
  const first = await expandShelf(f.config, f.base, f.roots);
  assert.equal(first.artifacts.length, 2);
  assert.deepEqual(first.artifacts.map(entry => entry.title).sort(), ['First document', 'Second document']);
  const route = first.artifacts.find(entry => entry.title === 'First document').route;
  await writeFile(path.join(f.base, 'docs/one.md'), '# Renamed heading\n');
  assert.equal((await expandShelf(f.config, f.base, f.roots)).artifacts.find(entry => entry.source.endsWith('one.md')).route, route);
  f.config.directories.push({ id: 'hidden', source: 'docs/.hidden', project: 'Hidden' });
  assert.equal((await expandShelf(f.config, f.base, f.roots)).artifacts.length, 3);
  f.config.directories = [{ ...f.config.directories[0], recursive: false }];
  assert.equal((await expandShelf(f.config, f.base, f.roots)).artifacts.length, 1);
});

test('explicit files override overlapping directories, with collision-safe paths', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'docs/ONE.md'), '# Case collision');
  // macOS may be case-insensitive. A different extension always tests slug collisions.
  await writeFile(path.join(f.base, 'docs/one.markdown'), '# Other extension');
  f.config.artifacts.push({ source: 'docs/one.md', project: 'Pinned', title: 'Kept', route: 'old/link.html', assets: ['logo.svg'], discoveryRoot: '/untrusted' });
  f.config.directories.push({ id: 'nested', source: 'docs/nested', project: 'Nested' });
  const result = await expandShelf(f.config, f.base, f.roots);
  assert.equal(result.artifacts.filter(entry => entry.source.endsWith('/two.html')).length, 1);
  assert.deepEqual(result.artifacts[0], { source: 'docs/one.md', project: 'Pinned', title: 'Kept', route: 'old/link.html', assets: ['logo.svg'] });
  assert.equal(new Set(result.artifacts.map(entry => entry.route)).size, result.artifacts.length);
});

test('folder discovery rejects escapes and skips symlinks, including cycles', async t => {
  const f = await fixture(t);
  await symlink(f.base, path.join(f.base, 'docs/cycle'));
  await symlink(path.join(f.base, 'docs/one.md'), path.join(f.base, 'docs/alias.md'));
  assert.equal((await expandShelf(f.config, f.base, f.roots)).artifacts.length, 2);
  await assert.rejects(expandShelf({ ...f.config, directories: [{ id: 'escape', source: '..', project: 'Escape' }] }, f.base, f.roots), /outside/);
  await assert.rejects(expandShelf({ ...f.config, version: 1 }, f.base, f.roots), /version 2/);
});

test('oversized discovered documents do not hide the rest of a watched folder', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'docs/large.md'), Buffer.alloc(8 * 1024 * 1024 + 1));
  const expanded = await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true });
  assert.equal(expanded.artifacts.length, 2);
  assert.match(expanded.warnings[0], /exceeds 8 MB: large.md/);
  await assert.rejects(prepareAddition({ ...f, sources: ['docs/large.md'] }), /exceeds 8 MB/);
});

test('mixed Add previews without writing, commits once, preserves entries, and rejects stale previews', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'loose.md'), '# Standalone');
  const options = { ...f, sources: ['docs', 'loose.md'], project: 'Chosen' };
  const preview = await prepareAddition(options);
  assert.equal(preview.documents.length, 3);
  assert.equal(preview.foldersAdded, 1);
  await assert.rejects(readFile(f.shelfPath), { code: 'ENOENT' });
  await addToShelf(options, preview.revision);
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.artifacts.length, 1);
  assert.equal(saved.directories.length, 1);
  const repeated = await prepareAddition(options);
  assert.equal(repeated.documents.length, 0);
  assert.equal(repeated.foldersAdded, 0);
  await writeFile(f.shelfPath, JSON.stringify({ ...saved, custom: 'External edit' }));
  await assert.rejects(addToShelf(options, repeated.revision), /changed/);
  assert.equal(JSON.parse(await readFile(f.shelfPath, 'utf8')).custom, 'External edit');
  const changedPaths = await prepareAddition({ ...options, sources: ['docs/nested'] });
  await rename(path.join(f.base, 'docs/nested'), path.join(f.base, 'docs/renamed'));
  await mkdir(path.join(f.base, 'docs/nested'));
  await assert.rejects(addToShelf({ ...options, sources: ['docs/nested'] }, changedPaths.revision), /changed/);
});

test('web expands relative directory registrations and retains missing folders', async t => {
  const f = await fixture(t);
  f.config.directories[0].source = path.relative(docShelfRoot, path.join(f.base, 'docs'));
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const shelf = await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base });
  assert.equal(shelf.artifacts.length, 2);
  await rm(path.join(f.base, 'docs'), { recursive: true });
  const missing = await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base });
  assert.equal(missing.artifacts.length, 0);
  assert.equal(missing.directories.length, 1);
  assert.match(missing.warnings[0], /unavailable/);
});

test('immediate addition commits its preparation while protecting concurrent shelf edits', async t => {
  const f = await fixture(t);
  const options = { ...f, sources: ['docs'], project: 'Chosen' };
  assert.deepEqual(await commitAddition(await prepareAddition(options)), { documentsAdded: 2, foldersAdded: 1 });
  assert.deepEqual(await commitAddition(await prepareAddition(options)), { documentsAdded: 0, foldersAdded: 0 });
  const prepared = await prepareAddition(options);
  const edited = JSON.stringify({ ...JSON.parse(await readFile(f.shelfPath, 'utf8')), custom: 'External edit' });
  await writeFile(f.shelfPath, edited);
  await assert.rejects(commitAddition(prepared), /shelf changed/);
  assert.equal(await readFile(f.shelfPath, 'utf8'), edited);
  assert.equal(await readFile(path.join(f.base, 'docs/one.md'), 'utf8'), '# First document\n');
});

test('folder watches detect membership changes, empty folders, and restoration', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const events = [];
  const watcher = new SourceWatcher(event => events.push(event), error => { throw error; });
  t.after(() => watcher.close());
  const expanded = await expandShelf(f.config, f.base, f.roots);
  await watcher.update([], expanded.directories);
  const waitFor = async predicate => { const deadline = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < deadline, events.join('\n')); await delay(25); } };
  await waitFor(() => events.includes('registered source watches ready'));
  events.length = 0;
  await writeFile(path.join(f.base, 'docs/types.d.ts'), 'export {};');
  await writeFile(path.join(f.base, 'docs/schema.json'), '{}');
  await delay(600);
  assert.deepEqual(events, [], 'Generated non-document files inside a selected folder must not trigger rebuild loops.');
  for (const name of ['new.md', 'later/inside.md']) {
    events.length = 0;
    await mkdir(path.dirname(path.join(f.base, 'docs', name)), { recursive: true });
    await writeFile(path.join(f.base, 'docs', name), '# Newly discovered');
    await waitFor(() => events.some(event => event.endsWith(name)));
  }
  await rm(path.join(f.base, 'docs'), { recursive: true });
  await waitFor(() => events.some(event => event.startsWith('unlinkDir')));
  await watcher.update([], (await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true })).directories);
  await delay(100);
  events.length = 0;
  await mkdir(path.join(f.base, 'docs'));
  await writeFile(path.join(f.base, 'docs/returned.md'), '# Returned');
  await waitFor(() => events.some(event => event.endsWith('returned.md')));
});

test('removing an explicit document preserves originals and excludes overlapping folders exactly', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'docs/nested/one.md'), '# Different document with the same name');
  f.config.artifacts.push({ source: 'docs/one.md', route: 'pinned.html', title: 'Pinned', project: 'Pinned', assets: ['logo.svg'] });
  f.config.directories.push({ id: 'parent', source: '.', project: 'Parent' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const before = await readFile(f.shelfPath, 'utf8');
  const source = await readFile(path.join(f.base, 'docs/one.md'), 'utf8');
  const options = { ...f, route: 'pinned.html', source: 'docs/one.md' };
  const prepared = await prepareRemoval(options);
  assert.equal(prepared.foldersExcluded, 2);
  assert.equal(await readFile(f.shelfPath, 'utf8'), before, 'Preparing or cancelling must not write.');
  await removeFromShelf(options, prepared.revision);
  assert.equal(await readFile(path.join(f.base, 'docs/one.md'), 'utf8'), source);
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.deepEqual(saved.directories[0].exclude, ['./one.md']);
  assert.deepEqual(saved.directories[1].exclude, ['./docs/one.md']);
  const after = await expandShelf(saved, f.base, f.roots);
  assert.equal(after.artifacts.length, 2);
  assert.ok(after.artifacts.some(entry => entry.source === 'docs/nested/one.md'));
  // Selecting the original explicitly again restores it without removing other exclusions.
  const addition = { ...f, sources: ['docs/one.md'], project: 'Restored' };
  await addToShelf(addition, (await prepareAddition(addition)).revision);
  assert.equal((await expandShelf(JSON.parse(await readFile(f.shelfPath, 'utf8')), f.base, f.roots)).artifacts.length, 3);
});

test('removing discovered files blocks stale native saves and accepts literal filename punctuation', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'docs/question?.md'), '# Literal filename');
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const artifact = (await expandShelf(f.config, f.base, f.roots)).artifacts.find(entry => entry.source.endsWith('question?.md'));
  const options = { ...f, route: artifact.route, source: artifact.source };
  await removeFromShelf(options, (await prepareRemoval(options)).revision);
  assert.throws(() => assertRegisteredSource(f.shelfPath, { ...artifact, sourcePath: path.join(f.base, artifact.source) }), /no longer included/);
  assert.equal(await readFile(path.join(f.base, artifact.source), 'utf8'), '# Literal filename');
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.equal((await expandShelf(saved, f.base, f.roots)).artifacts.length, 2);
});

test('removal rejects changed registrations, stale confirmations, and concurrent shelf updates', async t => {
  const f = await fixture(t);
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const artifact = (await expandShelf(f.config, f.base, f.roots)).artifacts[0];
  const options = { ...f, route: artifact.route, source: artifact.source };
  await assert.rejects(prepareRemoval({ ...options, source: 'different.md' }), /changed/);
  await assert.rejects(prepareRemoval({ ...options, route: '../../outside.html' }), /no longer/);
  const prepared = await prepareRemoval(options);
  const edited = JSON.stringify({ ...f.config, userNote: 'Keep this external edit' });
  await writeFile(f.shelfPath, edited);
  await assert.rejects(removeFromShelf(options, prepared.revision), /changed/);
  assert.equal(await readFile(f.shelfPath, 'utf8'), edited);
  const current = await prepareRemoval(options);
  const results = await Promise.allSettled([removeFromShelf(options, current.revision), removeFromShelf(options, current.revision)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
});

test('web removal accepts registered routes only and leaves version 1 compatible', async t => {
  const f = await fixture(t);
  const config = { version: 1, custom: 'preserved', artifacts: [{ source: 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', route: 'remote.html', title: 'Remote', project: 'Remote' }] };
  await writeFile(f.shelfPath, JSON.stringify(config));
  const handler = createRegistrationHandler({ root: f.base, getShelfPath: async () => f.shelfPath, getRoots: async () => ({ workspace: f.base, checkout: f.base }) });
  const preview = await handler({ action: 'remove-preview', route: 'remote.html' });
  assert.deepEqual(Object.keys(preview).sort(), ['foldersExcluded', 'revision', 'title']);
  await assert.rejects(handler({ action: 'remove', route: 'remote.html', source: '/unregistered.md', revision: preview.revision }), /registration request/);
  await assert.rejects(handler({ action: 'remove', route: 'remote.html' }), /changed/);
  assert.deepEqual(await handler({ action: 'remove', route: 'remote.html', revision: preview.revision }), { removed: true });
  assert.deepEqual(JSON.parse(await readFile(f.shelfPath, 'utf8')), { version: 1, custom: 'preserved', artifacts: [] });
});
