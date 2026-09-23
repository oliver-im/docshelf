import assert from 'node:assert/strict';
import { mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceWatcher } from '../scripts/source-watcher.mjs';
import { watchScope } from '../packages/local/watch-scope.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

for (const kind of ['file', 'directory']) {
  test(`source watches follow a replaced ${kind} symlink and then its new target`, { timeout: 15_000 }, async t => {
    const root = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-source-watch-'));
    for (const name of ['a', 'b']) {
      await mkdir(path.join(root, name));
      await writeFile(path.join(root, name, 'report.html'), name);
    }
    const link = path.join(root, 'current');
    const suffix = kind === 'file' ? '/report.html' : '';
    await symlink(`a${suffix}`, link);
    const source = kind === 'file' ? link : path.join(link, 'report.html');
    const events = [];
    const errors = [];
    const watcher = new SourceWatcher(event => events.push(event), error => errors.push(error));
    t.after(() => watcher.close());
    const update = async () => {
      events.length = 0;
      await watcher.update([source, await realpath(source)]);
      await waitFor(() => events.includes('registered source watches ready'));
      events.length = 0;
    };
    await update();
    await rm(link);
    await symlink(`b${suffix}`, link);
    await waitFor(() => events.some(event => event.endsWith(` ${link}`)));

    await update();
    const target = path.join(root, 'b/report.html');
    await writeFile(target, 'The new target changed');
    await waitFor(() => events.some(event => event.endsWith(` ${target}`)));

    events.length = 0;
    await writeFile(path.join(root, 'a/report.html'), 'The old target is no longer registered');
    await writeFile(path.join(root, 'b/private.html'), 'Unregistered sibling');
    await delay(500);
    assert.deepEqual(events, [], 'Old targets and unregistered neighbors must not trigger rebuilds.');
    assert.deepEqual(errors, []);
  });
}

test('watch exclusions cover canonical generated roots, explicit inputs, and directory events', async t => {
  const root = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-watch-exclusions-'));
  const checkout = path.join(root, 'checkout');
  const alias = path.join(root, 'alias');
  await mkdir(path.join(checkout, 'public'), { recursive: true });
  await symlink(checkout, alias);
  const generated = path.join(checkout, 'public/artifacts');
  const document = path.join(generated, 'report.html');
  const directories = [{ sourcePath: checkout, recursive: true, exclude: [] }];
  const original = await watchScope([document], directories);
  const scope = await watchScope([document], directories, { ignore: [path.join(alias, 'public/artifacts')] });
  assert.notEqual(scope.signature, original.signature, 'Changing exclusions must replace the watch set.');
  assert.ok(!scope.paths.has(document), 'Generated inputs must not retain explicit watches.');
  for (const file of [generated, path.join(generated, 'nested'), document]) {
    assert.equal(scope.ignored(file), true, file);
    for (const event of ['addDir', 'unlinkDir', 'add', 'change', 'unlink']) {
      assert.equal(scope.relevantChange(event, file), false, `${event} ${file}`);
    }
  }
  const neighboringDocument = path.join(checkout, 'public/artifacts-source/report.html');
  assert.equal(scope.ignored(neighboringDocument), false);
  assert.equal(scope.relevantChange('change', neighboringDocument), true);
});

test('ancestor folder watches ignore generated tree replacement and still detect source changes', { timeout: 15000 }, async t => {
  const root = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-generated-watch-'));
  const checkout = path.join(root, 'checkout');
  const generatedRoots = ['public/artifacts', 'src/generated'].map(file => path.join(checkout, file));
  for (const generated of generatedRoots) {
    await mkdir(path.join(generated, 'nested'), { recursive: true });
    await writeFile(path.join(generated, 'nested/report.html'), '<h1>Generated</h1>');
  }
  const source = path.join(checkout, 'source.md');
  await writeFile(source, '# Original');
  const events = [];
  const errors = [];
  const watcher = new SourceWatcher(event => events.push(event), error => errors.push(error));
  t.after(() => watcher.close());
  await watcher.update([], [{ sourcePath: root, recursive: true, exclude: [] }], { ignore: generatedRoots });
  await waitFor(() => events.includes('registered source watches ready'));
  events.length = 0;
  for (const generated of generatedRoots) {
    const staging = path.join(path.dirname(generated), '.staging');
    await mkdir(path.join(staging, 'nested'), { recursive: true });
    await writeFile(path.join(staging, 'nested/report.html'), '<h1>Rebuilt</h1>');
    await rm(generated, { recursive: true });
    // Separate removal and publication so filesystem event coalescing cannot hide the regression.
    await delay(300);
    await rename(staging, generated);
  }
  await writeFile(source, '# Changed');
  await waitFor(() => events.some(event => event.endsWith(` ${source}`)));
  await delay(500);
  assert.ok(events.every(event => event.endsWith(` ${source}`)), events.join('\n'));
  assert.deepEqual(errors, []);
});

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Expected registered source event was not observed.');
    await delay(25);
  }
}
