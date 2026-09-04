import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  BuildStatusReporter,
  buildStatusFileName,
  buildStatusRoute,
  describeBuildError,
} from '../scripts/build-status.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

test('build status follows attempts across starting, ready, and failed states', async (t) => {
  const runtimeRoot = await temporaryDirectory(t, tmpdir(), 'docshelf-status-');
  const times = [
    '2026-09-04T00:00:00.000Z',
    '2026-09-04T00:00:01.000Z',
    '2026-09-04T00:00:02.000Z',
    '2026-09-04T00:00:03.000Z',
    '2026-09-04T00:00:04.000Z',
    '2026-09-04T00:00:05.000Z',
    '2026-09-04T00:00:06.000Z',
    '2026-09-04T00:00:07.000Z',
    '2026-09-04T00:00:08.000Z',
  ];
  const reporter = new BuildStatusReporter(runtimeRoot, {
    instanceId: 'watcher-one',
    now: () => new Date(times.shift()),
  });

  await reporter.starting(false);
  assert.deepEqual(await readStatus(runtimeRoot), {
    version: 1,
    instanceId: 'watcher-one',
    generation: 0,
    state: 'starting',
    updatedAt: '2026-09-04T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    reasons: [],
    serving: false,
    error: null,
  });

  await reporter.building(['startup'], false);
  await reporter.ready(true);
  assert.deepEqual(await readStatus(runtimeRoot), {
    version: 1,
    instanceId: 'watcher-one',
    generation: 1,
    state: 'ready',
    updatedAt: '2026-09-04T00:00:04.000Z',
    startedAt: '2026-09-04T00:00:01.000Z',
    finishedAt: '2026-09-04T00:00:03.000Z',
    reasons: ['startup'],
    serving: true,
    error: null,
  });

  await reporter.building(['change artifacts.local.json'], true);
  const error = Object.assign(new Error('Astro exited with code 1.'), {
    details: '\u001b[31mfirst line\u001b[0m\nlast line',
  });
  await reporter.failed(error, true);
  assert.deepEqual(await readStatus(runtimeRoot), {
    version: 1,
    instanceId: 'watcher-one',
    generation: 2,
    state: 'failed',
    updatedAt: '2026-09-04T00:00:08.000Z',
    startedAt: '2026-09-04T00:00:05.000Z',
    finishedAt: '2026-09-04T00:00:07.000Z',
    reasons: ['change artifacts.local.json'],
    serving: true,
    error: {
      message: 'Astro exited with code 1.',
      details: 'first line\nlast line',
    },
  });

  assert.equal(buildStatusRoute, '/__docshelf/status');
  assert.deepEqual(await readdir(runtimeRoot), [buildStatusFileName]);
});

test('build status bounds diagnostic output and follows error causes', () => {
  const detailed = Object.assign(new Error('failed'), { details: 'x'.repeat(9_000) });
  assert.equal(describeBuildError(detailed).details.length, 8 * 1_024);

  const caused = new Error('Could not parse manifest', {
    cause: new SyntaxError('Unexpected token'),
  });
  assert.deepEqual(describeBuildError(caused), {
    message: 'Could not parse manifest',
    details: 'Unexpected token',
  });
});

async function readStatus(runtimeRoot) {
  return JSON.parse(await readFile(`${runtimeRoot}/${buildStatusFileName}`, 'utf8'));
}
