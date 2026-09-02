import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireWatcherLock } from '../scripts/watcher-lock.mjs';

test('watcher lock rejects a second live process and can be released', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const first = await acquireWatcherLock(runtimeRoot);

  await assert.rejects(acquireWatcherLock(runtimeRoot), {
    message: new RegExp(`already running \\(PID ${process.pid}\\)`),
  });

  await first.release();
  const second = await acquireWatcherLock(runtimeRoot);
  await second.release();
});

test('watcher lock recovers from a dead owner without releasing its successor', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const stale = await acquireWatcherLock(runtimeRoot, { pid: 999_999 });
  const current = await acquireWatcherLock(runtimeRoot, {
    processIsRunning: () => false,
  });

  await stale.release();
  await assert.rejects(acquireWatcherLock(runtimeRoot), {
    message: new RegExp(`already running \\(PID ${process.pid}\\)`),
  });

  await current.release();
});

async function temporaryRuntime(t) {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'docshelf-watch-lock-'));
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  return runtimeRoot;
}
