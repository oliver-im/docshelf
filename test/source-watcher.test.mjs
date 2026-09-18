import assert from 'node:assert/strict';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceWatcher } from '../scripts/source-watcher.mjs';
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

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Expected registered source event was not observed.');
    await delay(25);
  }
}
