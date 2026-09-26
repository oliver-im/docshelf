import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, lstat, mkdir, realpath, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';
import { expandShelf, documentFolders, documentLayout, prepareAddition, addToShelf, commitAddition, prepareRemoval, removeFromShelf, prepareProjectRemoval, removeProjectFromShelf, prepareFolderRemoval, removeFolderFromShelf, assertRegisteredSource } from '../packages/local/shelf.mjs';
import { createRegistrationHandler } from '../scripts/registration.mjs';
import { watchScope } from '../packages/local/watch-scope.mjs';
import { SourceWatcher } from '../scripts/source-watcher.mjs';
import { loadShelfFrom, docShelfRoot, shelfSidebar, shelfFolderGroups } from '../scripts/artifacts.mjs';

async function fixture(t) {
  const base = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-folders-'));
  await mkdir(path.join(base, 'docs/nested'), { recursive: true });
  await writeFile(path.join(base, 'docs/one.md'), '# First document\n');
  await writeFile(path.join(base, 'docs/nested/two.html'), '<title>Second document</title>');
  const config = { version: 2, artifacts: [], directories: [{ id: 'project', source: 'docs', project: 'Project' }] };
  return { base, roots: [base], config, shelfPath: path.join(base, 'shelf.local.json') };
}

async function layoutFor(f, project = 'Project') {
  const config = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  const expanded = await expandShelf(config, f.base, f.roots, { allowUnavailable: true });
  const artifacts = expanded.artifacts.filter(entry => entry.project.trim() === project);
  return documentLayout(artifacts.map(entry => ({ project: entry.project, path: /^https?:/.test(entry.source) ? undefined : path.resolve(f.base, entry.source) })), expanded.directories.filter(entry => entry.project === project));
}

async function folderKey(f, source, project = 'Project') {
  const layout = await layoutFor(f, project);
  const target = path.resolve(f.base, source);
  const key = [...layout.paths].find(([, file]) => file === target)?.[0];
  assert.ok(key, `Folder ${source} must be represented in the tree.`);
  return key;
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
  // A missing folder stays registered only while its nearest existing ancestor is inside the workspace.
  const missing = { id: 'missing', source: `../${path.basename(f.base)}-missing/docs`, project: 'Missing' };
  await assert.rejects(expandShelf({ ...f.config, directories: [missing] }, f.base, f.roots, { allowUnavailable: true }), /outside/);
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

test('absolute folder sources stay Obsidian-only; the web loader and shelf actions reject them', async t => {
  const f = await fixture(t);
  f.config.directories[0].source = path.join(f.base, 'docs');
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  assert.equal((await expandShelf(f.config, f.base, f.roots)).artifacts.length, 2);
  await assert.rejects(loadShelfFrom(f.shelfPath, { workspaceRoot: f.base }), /relative paths/);
  const handler = createRegistrationHandler({ root: f.base, getShelfPath: async () => f.shelfPath, getRoots: async () => ({ workspace: f.base, checkout: f.base }) });
  await assert.rejects(handler({ action: 'remove-preview', project: 'Project' }), /relative paths/);
});

test('documents nest under the outermost folder of their own project, as on disk', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'docs/nested/deeper'), { recursive: true });
  await mkdir(path.join(f.base, 'other/docs'), { recursive: true });
  await writeFile(path.join(f.base, 'docs/nested/deeper/three.md'), '# Three\n');
  await writeFile(path.join(f.base, 'other/docs/four.md'), '# Four\n');
  await writeFile(path.join(f.base, 'loose.md'), '# Loose\n');
  const place = async config => {
    const expanded = await expandShelf(config, f.base, f.roots);
    const folders = documentFolders(expanded.artifacts.map(entry => ({ project: entry.project, path: /^https?:/.test(entry.source) ? undefined : path.join(f.base, entry.source) })), expanded.directories);
    return Object.fromEntries(expanded.artifacts.map((entry, index) => [path.basename(entry.source), folders[index]]));
  };
  // Registered roots remain visible, including when all documents sit inside one root.
  f.config.artifacts.push({ source: 'docs/nested/deeper/three.md', route: 'three.html', title: 'Three', project: ' Project ' });
  assert.deepEqual(await place(f.config), { 'three.md': ['docs', 'nested', 'deeper'], 'one.md': ['docs'], 'two.html': ['docs', 'nested'] });
  // Remote documents and files outside the folder sit at the project root beside the named folder.
  f.config.artifacts.push({ source: 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', route: 'remote.html', title: 'Remote', project: 'Project' });
  f.config.artifacts.push({ source: 'loose.md', route: 'loose.html', title: 'Loose', project: 'Project' });
  const mixed = await place(f.config);
  assert.deepEqual([mixed['one.md'], mixed['three.md'], mixed['12345678-1234-1234-1234-123456789abc'], mixed['loose.md']], [['docs'], ['docs', 'nested', 'deeper'], [], []]);
  // Same-named folders are told apart by their registered sources; another project's folder keeps its own documents.
  f.config.directories.push({ id: 'other', source: 'other/docs', project: 'Project' }, { id: 'nested', source: 'docs/nested', project: 'Nested' });
  const named = await place(f.config);
  assert.deepEqual([named['one.md'], named['four.md'], named['two.html'], named['three.md']], [['docs'], ['other/docs'], ['nested'], ['docs', 'nested', 'deeper']]);
});

test('web sidebar nests project folders and names a symlinked folder as selected', async t => {
  const f = await fixture(t);
  await symlink(path.join(f.base, 'docs'), path.join(f.base, 'alias'));
  f.config.directories[0].source = path.relative(docShelfRoot, path.join(f.base, 'alias'));
  f.config.artifacts.push({ source: 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', route: 'remote.html', title: 'Remote', project: 'Project' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const sidebar = shelfSidebar(await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base }));
  const labels = items => items.map(item => item.items ? { [item.label]: labels(item.items) } : item.label);
  assert.deepEqual(labels(sidebar), [{ Project: [{ alias: [{ nested: ['two.html'] }, 'one.md'] }, 'Remote'] }]);
  assert.match(sidebar[0].items[0].items[1].link, /^\/artifacts\/folders\/project\/.+\.html$/);
});

test('web sidebar groups explicit documents and registered folders by trimmed project labels', async t => {
  const f = await fixture(t);
  f.config.directories[0].project = ' Project ';
  f.config.directories[0].source = path.relative(docShelfRoot, path.join(f.base, 'docs'));
  f.config.artifacts.push({ source: path.relative(docShelfRoot, path.join(f.base, 'docs/one.md')), route: 'one.html', title: 'First document', project: ' Project ' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const shelf = await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base });
  const sidebar = shelfSidebar(shelf);
  assert.deepEqual(sidebar.map(group => group.label), ['Project']);
  assert.deepEqual(sidebar[0].items.map(item => item.label), ['docs']);
  assert.deepEqual(sidebar[0].items[0].items.map(item => item.label), ['nested', 'one.md']);
  assert.equal(sidebar[0].items[0].badge, undefined);
  const groups = shelfFolderGroups(shelf);
  assert.deepEqual(groups.map(group => group.project), ['Project']);
  assert.deepEqual(groups[0].folders.map(folder => folder.name), ['docs', 'nested']);
  assert.equal(new Set(groups[0].folders.map(folder => folder.key)).size, 2);
});

test('empty registrations remain visible and removable without indexing empty descendants', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'empty/unregistered'), { recursive: true });
  await mkdir(path.join(f.base, 'empty/selected'));
  f.config.directories = [
    { id: 'empty', source: path.relative(docShelfRoot, path.join(f.base, 'empty')), project: 'Empty' },
    { id: 'selected', source: path.relative(docShelfRoot, path.join(f.base, 'empty/selected')), project: 'Empty' },
  ];
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const shelf = await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base });
  const sidebar = shelfSidebar(shelf);
  assert.equal(sidebar[0].label, 'Empty');
  assert.equal(sidebar[0].items[0].label, 'empty');
  assert.equal(sidebar[0].items[0].badge.text, 'No documents');
  assert.deepEqual(sidebar[0].items[0].items.map(item => item.label), ['selected']);
  const folders = shelfFolderGroups(shelf)[0].folders;
  const handler = createRegistrationHandler({ root: docShelfRoot, getShelfPath: async () => f.shelfPath, getRoots: async () => ({ workspace: f.base, checkout: docShelfRoot }) });
  const request = { project: 'Empty', folder: folders[1].key };
  const preview = await handler({ action: 'remove-preview', ...request });
  assert.deepEqual([preview.documents, preview.folders], [0, 1]);
  await handler({ action: 'remove', ...request, revision: preview.revision });
  assert.equal((await lstat(path.join(f.base, 'empty/selected'))).isDirectory(), true);
  assert.deepEqual(JSON.parse(await readFile(f.shelfPath, 'utf8')).directories[0].exclude, ['./selected']);
  const project = await handler({ action: 'remove-preview', project: 'Empty' });
  assert.deepEqual([project.documents, project.folders], [0, 1]);
  await handler({ action: 'remove', project: 'Empty', revision: project.revision });
  assert.deepEqual(shelfSidebar(await loadShelfFrom(f.shelfPath, { workspaceRoot: f.base })), []);
});

test('folder identities survive discoveries and label changes without retargeting stale actions', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'other/docs'), { recursive: true });
  await mkdir(path.join(f.base, 'nested'));
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const original = await folderKey(f, 'docs/nested');
  f.config.directories.push({ id: 'other', source: 'other/docs', project: 'Project' }, { id: 'empty', source: 'nested', project: 'Project' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const empty = await folderKey(f, 'nested');
  assert.notEqual(empty, original);
  await writeFile(path.join(f.base, 'nested/new.md'), '# Newly discovered');
  assert.equal(await folderKey(f, 'nested'), empty);
  assert.equal(await folderKey(f, 'docs/nested'), original);
  const options = { ...f, project: 'Project', folder: original };
  const prepared = await prepareFolderRemoval(options);
  assert.equal(prepared.documents, 1);
  assert.ok(prepared.config.directories.some(directory => directory.id === 'empty'));
  await assert.rejects(prepareFolderRemoval({ ...options, project: 'Another project' }), /no longer/);
  await removeFolderFromShelf(options, prepared.revision);
  const expanded = await expandShelf(JSON.parse(await readFile(f.shelfPath, 'utf8')), f.base, f.roots);
  assert.ok(expanded.artifacts.some(artifact => artifact.source === 'nested/new.md'));
  await assert.rejects(prepareFolderRemoval(options), /no longer/);
});

test('empty-folder removal revalidates newly discovered documents before committing', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'empty'));
  f.config.directories = [{ id: 'empty', source: 'empty', project: 'Project' }];
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const options = { ...f, project: 'Project', folder: await folderKey(f, 'empty') };
  const prepared = await prepareFolderRemoval(options);
  await writeFile(path.join(f.base, 'empty/new.md'), '# New');
  await assert.rejects(removeFolderFromShelf(options, prepared.revision), /changed/);
  assert.equal(JSON.parse(await readFile(f.shelfPath, 'utf8')).directories.length, 1);
});

test('immediate addition commits its preparation while protecting concurrent shelf edits', async t => {
  const f = await fixture(t);
  const options = { ...f, sources: ['docs'], project: 'Chosen' };
  assert.deepEqual(await commitAddition(await prepareAddition(options)), { documentsAdded: 2, documentsMoved: 0, foldersAdded: 1 });
  assert.deepEqual(await commitAddition(await prepareAddition(options)), { documentsAdded: 0, documentsMoved: 0, foldersAdded: 0 });
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
  events.length = 0;
  await watcher.update([], (await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true })).directories);
  await waitFor(() => events.includes('registered source watches ready'));
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
  assert.throws(() => assertRegisteredSource(f.shelfPath, { ...artifact, sourcePath: path.join(f.base, artifact.source) }, f.roots), /no longer included/);
  assert.equal(await readFile(path.join(f.base, artifact.source), 'utf8'), '# Literal filename');
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.equal((await expandShelf(saved, f.base, f.roots)).artifacts.length, 2);
});

test('native saves follow the current shelf when an explicit route or a folder scope changes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.base, 'docs/nested/notes.md'), '# Notes\n');
  await writeFile(path.join(f.base, 'loose.md'), '# Loose\n');
  f.config.artifacts.push({ source: 'docs/one.md', route: 'one.html', title: 'One', project: 'Pinned' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const opened = (await expandShelf(f.config, f.base, f.roots)).artifacts.map(entry => ({ ...entry, sourcePath: path.join(f.base, entry.source) }));
  const explicit = opened.find(entry => entry.route === 'one.html');
  const nested = opened.find(entry => entry.source === 'docs/nested/notes.md');
  for (const artifact of [explicit, nested]) assert.doesNotThrow(() => assertRegisteredSource(f.shelfPath, artifact, f.roots));
  // Views opened before the change must not save to a file the shelf no longer lists.
  await writeFile(f.shelfPath, JSON.stringify({ ...f.config, artifacts: [{ ...f.config.artifacts[0], source: 'loose.md' }], directories: [{ ...f.config.directories[0], recursive: false }] }));
  assert.throws(() => assertRegisteredSource(f.shelfPath, explicit, f.roots), /no longer registered/);
  assert.throws(() => assertRegisteredSource(f.shelfPath, nested, f.roots), /no longer included/);
});

test('removing a project drops its folders and documents while other projects keep theirs', async t => {
  const f = await fixture(t);
  for (const file of ['loose.md', 'other.md', 'kept.md']) await writeFile(path.join(f.base, file), `# ${file}\n`);
  f.config.artifacts.push(
    { source: 'loose.md', route: 'loose.html', title: 'Loose', project: 'Project' },
    { source: 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', route: 'remote.html', title: 'Remote', project: 'Project' },
    { source: 'kept.md', route: 'kept.html', title: 'Kept', project: 'Other' },
  );
  f.config.directories.push({ id: 'parent', source: '.', project: 'Parent' }, { id: 'nested', source: 'docs/nested', project: 'Nested' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const before = await readFile(f.shelfPath, 'utf8');
  const options = { ...f, project: ' Project ' };
  const prepared = await prepareProjectRemoval(options);
  assert.deepEqual([prepared.title, prepared.documents, prepared.folders, prepared.foldersExcluded], ['Project', 3, 1, 1]);
  assert.equal(await readFile(f.shelfPath, 'utf8'), before, 'Preparing or cancelling must not write.');
  await assert.rejects(prepareProjectRemoval({ ...f, project: 'Missing' }), /no longer on the shelf/);
  await assert.rejects(removeProjectFromShelf(options, 'stale'), /changed/);
  await removeProjectFromShelf(options, prepared.revision);
  assert.equal(await readFile(path.join(f.base, 'docs/one.md'), 'utf8'), '# First document\n');
  assert.equal(await readFile(path.join(f.base, 'loose.md'), 'utf8'), '# loose.md\n');
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.deepEqual(saved.directories.map(entry => [entry.id, entry.exclude]), [['parent', ['./docs', './loose.md']], ['nested', []]]);
  assert.deepEqual(saved.artifacts.map(entry => entry.route), ['kept.html']);
  // The parent folder must not pick the removed documents back up, even ones added later, and the nested folder keeps its own documents.
  await writeFile(path.join(f.base, 'docs/later.md'), '# Later\n');
  const after = await expandShelf(saved, f.base, f.roots);
  assert.deepEqual(after.artifacts.map(entry => [entry.project, entry.source]).sort(), [['Nested', 'docs/nested/two.html'], ['Other', 'kept.md'], ['Parent', 'other.md']]);
});

test('removing a folder row drops what it lists, keeps later files out, and blocks stale saves', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'docs/nested/deeper'), { recursive: true });
  await mkdir(path.join(f.base, 'docs/nested/inner'), { recursive: true });
  await writeFile(path.join(f.base, 'docs/nested/deeper/three.md'), '# Three\n');
  await writeFile(path.join(f.base, 'docs/nested/inner/four.md'), '# Four\n');
  await writeFile(path.join(f.base, 'docs/nested/pinned.md'), '# Pinned\n');
  await writeFile(path.join(f.base, 'loose.md'), '# Loose\n');
  f.config.artifacts.push({ source: 'docs/nested/pinned.md', route: 'pinned.html', title: 'Pinned', project: 'Project' });
  f.config.directories.push(
    { id: 'deeper', source: 'docs/nested/deeper', project: 'Project' },
    { id: 'parent', source: '.', project: 'Parent' },
    { id: 'inner', source: 'docs/nested/inner', project: 'Inner' },
  );
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const discovered = (await expandShelf(f.config, f.base, f.roots)).artifacts.find(entry => entry.source === 'docs/nested/two.html');
  const before = await readFile(f.shelfPath, 'utf8');
  // Removal uses the folder's source identity, independently of its display path.
  const options = { ...f, project: 'Project', folder: await folderKey(f, 'docs/nested') };
  const prepared = await prepareFolderRemoval(options);
  assert.deepEqual([prepared.title, prepared.documents, prepared.folders, prepared.foldersExcluded], ['docs/nested', 3, 1, 2]);
  assert.equal(await readFile(f.shelfPath, 'utf8'), before, 'Preparing or cancelling must not write.');
  await assert.rejects(prepareFolderRemoval({ ...options, folder: '0'.repeat(64) }), /no longer on the shelf/);
  await assert.rejects(prepareFolderRemoval({ ...options, folder: 'nested' }), /Choose a folder/);
  await assert.rejects(removeFolderFromShelf(options, 'stale'), /changed/);
  await removeFolderFromShelf(options, prepared.revision);
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.deepEqual(saved.directories.map(entry => [entry.id, entry.exclude]), [['project', ['./nested']], ['parent', ['./docs/nested']], ['inner', []]]);
  assert.deepEqual(saved.artifacts, []);
  assert.throws(() => assertRegisteredSource(f.shelfPath, { ...discovered, sourcePath: path.join(f.base, discovered.source) }, f.roots), /no longer included/);
  await writeFile(path.join(f.base, 'docs/nested/later.md'), '# Later\n');
  const after = await expandShelf(saved, f.base, f.roots);
  assert.deepEqual(after.artifacts.map(entry => [entry.project, entry.source]).sort(), [['Inner', 'docs/nested/inner/four.md'], ['Parent', 'loose.md'], ['Project', 'docs/one.md']]);
  for (const file of ['docs/nested/two.html', 'docs/nested/pinned.md', 'docs/nested/deeper/three.md']) assert.ok(await readFile(path.join(f.base, file), 'utf8'));

  // With a loose file beside it, the watched folder is its own named row, and removing that row drops the registration.
  saved.artifacts.push({ source: 'loose.md', route: 'loose.html', title: 'Loose', project: 'Project' });
  await writeFile(f.shelfPath, JSON.stringify(saved));
  const named = { ...f, project: 'Project', folder: await folderKey(f, 'docs') };
  const whole = await prepareFolderRemoval(named);
  assert.deepEqual([whole.title, whole.documents, whole.folders, whole.foldersExcluded], ['docs', 1, 1, 1]);
  await removeFolderFromShelf(named, whole.revision);
  const final = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.deepEqual(final.directories.map(entry => [entry.id, entry.exclude]), [['parent', ['./docs/nested', './docs']], ['inner', []]]);
  assert.deepEqual(final.artifacts.map(entry => entry.route), ['loose.html']);
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

test('web folder removal requires its project and previews counts', async t => {
  const f = await fixture(t);
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const handler = createRegistrationHandler({ root: f.base, getShelfPath: async () => f.shelfPath, getRoots: async () => ({ workspace: f.base, checkout: f.base }) });
  await assert.rejects(handler({ action: 'remove-preview', folder: ['nested'] }), /registration request/);
  await assert.rejects(handler({ action: 'remove-preview', route: 'x.html', folder: ['nested'] }), /registration request/);
  await assert.rejects(handler({ action: 'remove-preview', project: 'Project', folder: [''] }), /Choose a folder/);
  const folder = await folderKey(f, 'docs/nested');
  const preview = await handler({ action: 'remove-preview', project: 'Project', folder });
  assert.deepEqual({ ...preview, revision: typeof preview.revision }, { revision: 'string', title: 'docs/nested', documents: 1, folders: 0, foldersExcluded: 1 });
  assert.deepEqual(await handler({ action: 'remove', project: 'Project', folder, revision: preview.revision }), { removed: true });
  assert.deepEqual(JSON.parse(await readFile(f.shelfPath, 'utf8')).directories[0].exclude, ['./nested']);
});

test('web project removal previews counts and accepts a route or a project, never both', async t => {
  const f = await fixture(t);
  f.config.artifacts.push({ source: 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', route: 'remote.html', title: 'Remote', project: 'Other' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const handler = createRegistrationHandler({ root: f.base, getShelfPath: async () => f.shelfPath, getRoots: async () => ({ workspace: f.base, checkout: f.base }) });
  await assert.rejects(handler({ action: 'remove-preview', route: 'remote.html', project: 'Project' }), /registration request/);
  await assert.rejects(handler({ action: 'remove-preview' }), /registration request/);
  const preview = await handler({ action: 'remove-preview', project: 'Project' });
  assert.deepEqual({ ...preview, revision: typeof preview.revision }, { revision: 'string', title: 'Project', documents: 2, folders: 1, foldersExcluded: 0 });
  assert.deepEqual(await handler({ action: 'remove', project: 'Project', revision: preview.revision }), { removed: true });
  const saved = JSON.parse(await readFile(f.shelfPath, 'utf8'));
  assert.deepEqual([saved.directories, saved.artifacts.map(entry => entry.route)], [[], ['remote.html']]);
});


test('an overflowing folder rolls back its documents without blocking other folders or shelf actions', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'huge'));
  await Promise.all(Array.from({ length: 2001 }, (_, i) => writeFile(path.join(f.base, 'huge', `${i}.html`), '<title>Generated</title>')));
  f.config.directories.unshift({ id: 'a-huge', source: 'huge', project: 'Huge' });
  f.config.artifacts.push({ source: 'docs/one.md', route: 'pinned.html', title: 'Pinned', project: 'Pinned' });
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const expanded = await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true });
  assert.equal(expanded.artifacts.length, 2);
  assert.equal(expanded.directories.length, 2);
  assert.match(expanded.warnings[0], /Huge: folder skipped: huge.*2,000/);
  await assert.rejects(expandShelf(f.config, f.base, f.roots), /2,000/);
  await writeFile(path.join(f.base, 'added.md'), '# Added');
  const addition = { ...f, sources: ['added.md'] };
  await addToShelf(addition, (await prepareAddition(addition)).revision);
  const removal = { ...f, route: 'pinned.html' };
  await removeFromShelf(removal, (await prepareRemoval(removal)).revision);
  assert.equal(JSON.parse(await readFile(f.shelfPath, 'utf8')).directories.length, 2);
});

test('nesting overruns also roll back just the affected folder', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.base, 'deep', ...Array(33).fill('sub')), { recursive: true });
  await writeFile(path.join(f.base, 'deep/first.md'), '# Partial');
  f.config.directories.unshift({ id: 'a-deep', source: 'deep', project: 'Deep' });
  const result = await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true });
  assert.equal(result.artifacts.length, 2);
  assert.match(result.warnings[0], /32-level/);
});

test('unreadable subfolders and broken registered symlinks preserve healthy siblings', async t => {
  const f = await fixture(t);
  const denied = path.join(f.base, 'docs/m-volume');
  await mkdir(denied);
  await writeFile(path.join(f.base, 'docs/z.md'), '# Last');
  await symlink(path.join(f.base, 'gone'), path.join(f.base, 'broken'));
  f.config.directories.push({ id: 'broken', source: 'broken', project: 'Broken' });
  await chmod(denied, 0);
  const expanded = await expandShelf(f.config, f.base, f.roots, { allowUnavailable: true }).finally(() => chmod(denied, 0o700));
  assert.equal(expanded.artifacts.length, 3);
  assert.equal(expanded.directories.length, 2);
  assert.ok(expanded.warnings.some(warning => /Broken: folder unavailable: broken/.test(warning)));
  if (process.getuid?.() !== 0) assert.ok(expanded.warnings.some(warning => /folder unavailable: docs\/m-volume/.test(warning)));
});

test('a parent addition preserves existing routes, while a child addition reports moves', async t => {
  const f = await fixture(t);
  f.config.directories = [{ id: 'z-notes', source: 'docs/nested', project: 'Notes' }];
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const before = (await expandShelf(f.config, f.base, f.roots)).artifacts[0];
  const parent = await prepareAddition({ ...f, sources: ['docs'], project: 'Everything' });
  assert.equal(parent.documents.length, 1);
  assert.deepEqual(parent.moved, []);
  await commitAddition(parent);
  const after = (await expandShelf(JSON.parse(await readFile(f.shelfPath, 'utf8')), f.base, f.roots)).artifacts.find(entry => entry.source === before.source);
  assert.equal(after.route, before.route);
  assert.equal(after.project, 'Notes');
  f.config.directories = [{ id: 'a-all', source: 'docs', project: 'Everything' }];
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  const child = await prepareAddition({ ...f, sources: ['docs/nested'], project: 'Notes' });
  assert.deepEqual(child.documents, []);
  assert.equal(child.moved.length, 1);
  assert.equal(child.moved[0].previousProject, 'Everything');
  assert.equal((await commitAddition(child)).documentsMoved, 1);
});

test('unrelated folder changes leave a preview valid; selected additions still revalidate', async t => {
  const f = await fixture(t);
  await writeFile(f.shelfPath, JSON.stringify(f.config));
  await mkdir(path.join(f.base, 'selected'));
  await writeFile(path.join(f.base, 'selected/one.md'), '# Selected');
  const options = { ...f, sources: ['selected'] };
  const preview = await prepareAddition(options);
  await writeFile(path.join(f.base, 'docs/unrelated.md'), '# Unrelated');
  assert.equal((await prepareAddition(options)).revision, preview.revision);
  await writeFile(path.join(f.base, 'selected/another.md'), '# Another');
  await assert.rejects(addToShelf(options, preview.revision), /changed/);
});

test('symlinked shelves support membership checks and additions within configured roots', async t => {
  const f = await fixture(t);
  const target = path.join(f.base, 'real-shelf.json');
  await writeFile(target, JSON.stringify(f.config));
  await symlink(target, f.shelfPath);
  const entry = (await expandShelf(f.config, f.base, f.roots)).artifacts.find(entry => entry.source.endsWith('one.md'));
  const artifact = { ...entry, sourcePath: path.join(f.base, entry.source) };
  assert.doesNotThrow(() => assertRegisteredSource(f.shelfPath, artifact, f.roots));
  await writeFile(path.join(f.base, 'new.md'), '# New');
  await commitAddition(await prepareAddition({ ...f, sources: ['new.md'] }));
  assert.equal((await lstat(f.shelfPath)).isSymbolicLink(), true);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).artifacts.length, 1);
  await rm(f.shelfPath);
  const outside = await fixture(t);
  await writeFile(outside.shelfPath, JSON.stringify(f.config));
  await symlink(outside.shelfPath, f.shelfPath);
  assert.throws(() => assertRegisteredSource(f.shelfPath, artifact, f.roots), /outside/);
});

test('directory-only watch scopes remain stable when discovered membership changes', async t => {
  const f = await fixture(t);
  const before = await expandShelf(f.config, f.base, f.roots);
  const first = await watchScope([f.shelfPath], before.directories);
  await writeFile(path.join(f.base, 'docs/new.md'), '# New');
  const after = await expandShelf(f.config, f.base, f.roots);
  const next = await watchScope([f.shelfPath], after.directories);
  assert.equal(next.signature, first.signature);
  assert.equal(next.paths.size, 3, 'The missing shelf adds its existing parent to the bounded watch set.');
  assert.equal(next.ignored(path.join(f.base, 'docs/new.md')), false);
});
