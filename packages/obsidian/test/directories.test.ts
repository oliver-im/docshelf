import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCatalog } from '../src/core/catalog';

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
