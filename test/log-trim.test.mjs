import assert from 'node:assert/strict';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { standardStreamIs, trimLog, watcherLogPaths } from '../scripts/log-trim.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

test('logs below the limit are left alone', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-log-');
  const logPath = path.join(root, 'small.log');
  await writeFile(logPath, 'first line\nsecond line\n');

  assert.equal(trimLog(logPath, { maxBytes: 1000, keepBytes: 100 }), 0);
  assert.equal(trimLog(path.join(root, 'missing.log'), { maxBytes: 1000, keepBytes: 100 }), 0);
  assert.equal(await readFile(logPath, 'utf8'), 'first line\nsecond line\n');
});

test('trimming keeps whole recent lines and an append-mode writer continues after them', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-log-');
  const logPath = path.join(root, 'grown.log');
  const lines = Array.from({ length: 200 }, (_, index) => `line ${String(index).padStart(4, '0')}\n`);
  await writeFile(logPath, lines.join(''));
  const writer = await open(logPath, 'a');
  t.after(() => writer.close());
  const originalSize = (await stat(logPath)).size;

  const removed = trimLog(logPath, { maxBytes: 1000, keepBytes: 100 });
  await writer.write('after trim\n');

  const contents = await readFile(logPath, 'utf8');
  const [note, ...kept] = contents.split('\n');
  assert.match(note, /^\[log\] Trimmed \d+ earlier bytes from this log\.$/);
  assert.equal(removed, originalSize - kept.slice(0, -2).join('\n').length - 1);
  assert.equal(kept.at(-1), '');
  assert.equal(kept.at(-2), 'after trim');
  assert.ok(kept.slice(0, -2).every((line) => /^line \d{4}$/.test(line)), contents);
  assert.equal(kept.slice(0, -2).at(-1), 'line 0199');
  assert.ok(kept.length - 2 <= 100 / 'line 0000\n'.length);
  assert.ok(!contents.includes('\0'));
});

test('trimming is synchronous so a queued watcher append cannot race with compaction', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-log-');
  const logPath = path.join(root, 'racing.log');
  await writeFile(logPath, 'old line\n'.repeat(200));
  const writer = await open(logPath, 'a');
  t.after(() => writer.close());

  let appendStarted = false;
  const append = Promise.resolve().then(async () => {
    appendStarted = true;
    await writer.write('append queued before trim\n');
  });

  const removed = trimLog(logPath, { maxBytes: 1000, keepBytes: 100 });
  assert.equal(typeof removed, 'number');
  assert.equal(appendStarted, false);
  await append;

  assert.match(await readFile(logPath, 'utf8'), /append queued before trim\n$/);
});

test('trimming rejects limits that would keep the whole log', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-log-');
  const logPath = path.join(root, 'any.log');
  await writeFile(logPath, 'x\n');

  assert.throws(() => trimLog(logPath, { maxBytes: 100, keepBytes: 100 }), {
    message: /keep fewer bytes/,
  });
});

test('a standard stream is recognized by the file behind its descriptor', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-log-');
  const logPath = path.join(root, 'stream.log');
  const otherPath = path.join(root, 'other.log');
  await writeFile(logPath, '');
  await writeFile(otherPath, '');
  const handle = await open(logPath, 'a');

  assert.equal(standardStreamIs(handle.fd, logPath), true);
  assert.equal(standardStreamIs(handle.fd, otherPath), false);
  assert.equal(standardStreamIs(handle.fd, path.join(root, 'missing.log')), false);
  await handle.close();
  assert.equal(standardStreamIs(handle.fd, logPath), false);
});

test('the watcher log paths live in the runtime directory', () => {
  assert.deepEqual(watcherLogPaths('/shelf/.docshelf-runtime'), {
    stdout: '/shelf/.docshelf-runtime/docshelf.stdout.log',
    stderr: '/shelf/.docshelf-runtime/docshelf.stderr.log',
  });
});
