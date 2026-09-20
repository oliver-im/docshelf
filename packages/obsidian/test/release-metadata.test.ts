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
  for (const file of ['README.md', 'packages/obsidian/README.md']) {
    await writeFile(path.join(root, file), await readFile(new URL(`../../../${file}`, import.meta.url)));
  }
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

test('a plugin version bump synchronizes both README links and checks reject stale links without rewriting', async t => {
  const { root, write, manifest } = await fixture(t);
  await checkReleaseMetadata(root, { sync: true });
  const files = ['README.md', 'packages/obsidian/README.md'];
  const before = await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')));
  await write('packages/obsidian/manifest.json', { ...manifest, version: '0.2.0' });
  await write('packages/obsidian/package.json', { version: '0.2.0' });
  await write('package-lock.json', { packages: { 'packages/obsidian': { version: '0.2.0' } } });
  await write('packages/obsidian/versions.json', { '0.1.0': '1.13.7', '0.2.0': '1.13.7' });
  await checkReleaseMetadata(root, { sync: true });
  await checkReleaseMetadata(root, { version: '0.2.0' });
  const withoutDefinitions = (source: string) => source.split('\n').filter(line => !line.startsWith('[obsidian-')).join('\n');
  for (const [index, file] of files.entries()) {
    const updated = await readFile(path.join(root, file), 'utf8');
    assert.ok(updated.includes('[obsidian-download]: https://github.com/oliver-im/docshelf/releases/download/0.2.0/docshelf-0.2.0.zip'));
    assert.ok(updated.includes('[obsidian-release]: https://github.com/oliver-im/docshelf/releases/tag/0.2.0'));
    assert.equal(withoutDefinitions(updated), withoutDefinitions(before[index]));
    const stale = updated.replace('/download/0.2.0/docshelf-0.2.0.zip', '/download/0.1.0/docshelf-0.1.0.zip');
    await writeFile(path.join(root, file), stale);
    await assert.rejects(checkReleaseMetadata(root), /release links differ from the plugin version/);
    assert.equal(await readFile(path.join(root, file), 'utf8'), stale);
    await checkReleaseMetadata(root, { sync: true });
  }
});

test('missing or duplicate README release definitions fail instead of silently skipping link updates', async t => {
  const { root } = await fixture(t);
  await checkReleaseMetadata(root, { sync: true });
  const file = path.join(root, 'README.md');
  const source = await readFile(file, 'utf8');
  for (const broken of [
    source.replace(/^\[obsidian-download\]:.*$/m, ''),
    `${source}\n[obsidian-release]: https://example.com/\n`,
  ]) {
    await writeFile(file, broken);
    await assert.rejects(checkReleaseMetadata(root, { sync: true }), /must contain exactly one/);
    assert.equal(await readFile(file, 'utf8'), broken);
  }
});
