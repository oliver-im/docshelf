import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkReleaseMetadata } from '../scripts/release-metadata.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { id: 'docshelf', version: '0.1.0', minAppVersion: '1.13.7', isDesktopOnly: true };
  await mkdir(path.join(root, 'packages/obsidian'), { recursive: true });
  const write = (file: string, value: unknown) => writeFile(path.join(root, file), JSON.stringify(value));
  await write('packages/obsidian/manifest.json', manifest);
  await write('packages/obsidian/versions.json', { '0.0.9': '1.13.7', '0.1.0': '1.13.7' });
  await write('packages/obsidian/package.json', { version: '0.1.0' });
  await write('package-lock.json', { version: '0.0.1', packages: { 'packages/obsidian': { version: '0.1.0' } } });
  return { root, write, manifest };
}

test('root metadata is synchronized explicitly and drift is rejected without rewriting it', async t => {
  const { root, write, manifest } = await fixture(t);
  await checkReleaseMetadata(root, { sync: true });
  assert.deepEqual(await checkReleaseMetadata(root, { version: '0.1.0' }), manifest);
  assert.equal(JSON.parse(await readFile(path.join(root, 'versions.json'), 'utf8'))['0.0.9'], '1.13.7');
  await write('manifest.json', { ...manifest, version: '0.2.0' });
  await assert.rejects(checkReleaseMetadata(root), /differs from the plugin metadata/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')).version, '0.2.0');
});

test('release metadata rejects the wrong requested version, stale lockfile, and missing compatibility entry', async t => {
  const { root, write } = await fixture(t);
  await checkReleaseMetadata(root, { sync: true });
  await assert.rejects(checkReleaseMetadata(root, { version: 'v0.1.0' }), /Requested release/);
  await assert.rejects(checkReleaseMetadata(root, { version: '0.2.0' }), /Requested release/);
  await write('package-lock.json', { packages: { 'packages/obsidian': { version: '0.0.9' } } });
  await assert.rejects(checkReleaseMetadata(root), /Refresh the root lockfile/);
  await write('package-lock.json', { packages: { 'packages/obsidian': { version: '0.1.0' } } });
  await write('packages/obsidian/versions.json', {});
  await assert.rejects(checkReleaseMetadata(root), /current minimum Obsidian version/);
});
