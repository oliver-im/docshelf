import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCatalog } from '../src/core/catalog';
import { prepareRemoval, removeFromShelf } from '../../local/shelf.mjs';

test('plugin directory catalog preserves explicit routes and removes deleted discovered files', async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'docshelf-folder-catalog-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(path.join(base, 'docs/nested'), { recursive: true });
  await writeFile(path.join(base, 'docs/one.md'), '# One');
  await writeFile(path.join(base, 'docs/nested/two.md'), '# Two');
  const shelfPath = path.join(base, 'shelf.json');
  await writeFile(shelfPath, JSON.stringify({ version: 2, artifacts: [{ source: 'docs/one.md', project: 'Pinned', title: 'Pinned', route: 'old/link.html' }], directories: [{ id: 'project', source: 'docs', project: 'Project' }] }));
  const catalog = await loadCatalog(shelfPath, base);
  assert.equal(catalog.artifacts.length, 2);
  assert.equal(catalog.artifacts[0].route, 'old/link.html');
  assert.equal(catalog.artifacts[1].discoveryRoot, path.join(base, 'docs'));
  await rm(path.join(base, 'docs/nested/two.md'));
  assert.equal((await loadCatalog(shelfPath, base)).artifacts.length, 1);
});

test('removal accepts catalog-normalized remote sources and still rejects a different document', async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'docshelf-remote-removal-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const shelfPath = path.join(base, 'shelf.json');
  for (const source of [
    'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789ABC/embed/',
    ' https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc/embed ',
    'https://github.com/Owner/Repo/blob/main/README.md#heading',
  ]) {
    const registration = { source, route: 'remote.html', title: 'Remote', project: 'Remote' };
    await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [registration] }));
    const artifact = (await loadCatalog(shelfPath, base)).artifacts[0];
    assert.notEqual(artifact.source, source);
    const options = { shelfPath, roots: [base], route: artifact.route, source: artifact.source };
    await assert.rejects(prepareRemoval({ ...options, source: 'https://github.com/other/repo/blob/main/README.md' }), /changed/);
    await removeFromShelf(options, (await prepareRemoval(options)).revision);
    assert.deepEqual(JSON.parse(await readFile(shelfPath, 'utf8')), { version: 1, artifacts: [] });
  }
});
