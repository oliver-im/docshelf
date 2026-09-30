import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { replacePluginFiles } from '../scripts/install-files.mjs';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'docshelf-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'build');
  const target = path.join(root, 'installed');
  await fs.mkdir(source);
  await fs.mkdir(path.join(target, 'recovery'), { recursive: true });
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    await fs.writeFile(path.join(source, name), `new ${name}`);
    await fs.writeFile(path.join(target, name), `old ${name}`);
  }
  await fs.writeFile(path.join(target, 'data.json'), 'private settings');
  await fs.writeFile(path.join(target, 'recovery', 'draft'), 'unsaved draft');
  async function check(version: string) {
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      assert.equal(await fs.readFile(path.join(target, name), 'utf8'), `${version} ${name}`);
    }
    assert.equal(await fs.readFile(path.join(target, 'data.json'), 'utf8'), 'private settings');
    assert.equal(await fs.readFile(path.join(target, 'recovery', 'draft'), 'utf8'), 'unsaved draft');
    assert.deepEqual((await fs.readdir(target)).sort(), ['data.json', 'main.js', 'manifest.json', 'recovery', 'styles.css']);
  }
  return { source, target, check };
}

test('a failed build copy preserves all installed files and private state', async t => {
  const f = await fixture(t);
  await assert.rejects(replacePluginFiles(f.source, f.target, {
    ...fs,
    copyFile: async (source, destination, mode) => {
      if (source === path.join(f.source, 'styles.css')) {
        // A failed copy may remove its destination after writing part of it.
        await fs.writeFile(destination, 'partial');
        await fs.unlink(destination);
        throw new Error('ENOSPC: simulated full disk');
      }
      return fs.copyFile(source, destination, mode);
    },
  }), /ENOSPC/);
  await f.check('old');
});

test('a failed replacement rolls back files already replaced', async t => {
  const f = await fixture(t);
  let failed = false;
  await assert.rejects(replacePluginFiles(f.source, f.target, {
    ...fs,
    rename: async (source, destination) => {
      if (!failed && destination === path.join(f.target, 'manifest.json')) {
        failed = true;
        throw new Error('EACCES: simulated rename failure');
      }
      return fs.rename(source, destination);
    },
  }), /EACCES/);
  await f.check('old');
});

test('a successful replacement preserves settings and recovery files', async t => {
  const f = await fixture(t);
  await replacePluginFiles(f.source, f.target);
  await f.check('new');
});

test('a rollback failure retains the original file for manual recovery', async t => {
  const f = await fixture(t);
  await assert.rejects(replacePluginFiles(f.source, f.target, {
    ...fs,
    rename: async (source, destination) => {
      if (destination === path.join(f.target, 'manifest.json') || path.basename(String(source)) === 'old-main.js') {
        throw new Error('EACCES: simulated persistent rename failure');
      }
      return fs.rename(source, destination);
    },
  }), /Original files remain in/);
  const backup = (await fs.readdir(f.target)).find(name => name.startsWith('.docshelf-install-'));
  assert.ok(backup);
  assert.equal(await fs.readFile(path.join(f.target, backup, 'old-main.js'), 'utf8'), 'old main.js');
  assert.equal(await fs.readFile(path.join(f.target, 'data.json'), 'utf8'), 'private settings');
  assert.equal(await fs.readFile(path.join(f.target, 'recovery', 'draft'), 'utf8'), 'unsaved draft');
});
