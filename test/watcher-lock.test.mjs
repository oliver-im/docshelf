import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  acquireSyncLock,
  acquireWatcherLock,
  inspectLock,
  inspectWatcherLock,
  syncLockPath,
  watcherLockPath,
} from '../scripts/watcher-lock.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

const childScript = fileURLToPath(new URL('./helpers/lock-child.mjs', import.meta.url));
const isWindows = process.platform === 'win32';
const isRoot = process.getuid?.() === 0;

test('watcher lock rejects a second acquisition in the same process and can be released', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const first = await acquireWatcherLock(runtimeRoot);

  await assert.rejects(acquireWatcherLock(runtimeRoot), {
    code: 'DOCSHELF_LOCK_HELD',
    message: new RegExp(`already running \\(PID ${process.pid}\\)`),
  });

  assert.equal(first.release(), true);
  assert.equal(first.release(), false, 'a second release is a no-op');
  assert.equal(await lockExists(runtimeRoot), false);

  const second = await acquireWatcherLock(runtimeRoot);
  second.release();
});

test('same-process contention yields exactly one holder', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireWatcherLock(runtimeRoot)),
  );

  const winners = results.filter((result) => result.status === 'fulfilled');
  assert.equal(winners.length, 1);
  for (const result of results) {
    if (result.status === 'rejected') assert.equal(result.reason.code, 'DOCSHELF_LOCK_HELD');
  }

  winners[0].value.release();
  assert.equal(await lockExists(runtimeRoot), false);
  assert.deepEqual(await leftovers(runtimeRoot), []);
});

test('a lock whose owner has died is reclaimed', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  await seedLock(runtimeRoot, { pid: await deadPid(), token: 'dead-owner' });

  const lock = await acquireWatcherLock(runtimeRoot);
  assert.equal((await readOwner(runtimeRoot)).token, lock.owner.token);
  lock.release();
  assert.equal(await lockExists(runtimeRoot), false);
});

test('a lock recorded under this PID but not held by this process is reclaimed', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  await seedLock(runtimeRoot, { pid: process.pid, token: 'previous-incarnation' });

  const lock = await acquireWatcherLock(runtimeRoot);
  assert.notEqual((await readOwner(runtimeRoot)).token, 'previous-incarnation');
  lock.release();
});

test(
  'a live process that merely reused the PID does not count as a running watcher',
  { skip: isWindows && 'process identity is not inspected on Windows' },
  async (t) => {
    const runtimeRoot = await temporaryRuntime(t);
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    t.after(() => bystander.kill('SIGKILL'));
    await delay(100);

    await seedLock(runtimeRoot, {
      pid: bystander.pid,
      token: 'reused-pid',
      startedAt: Date.now() - 3_600_000,
      script: '/somewhere/scripts/watch.mjs',
    });
    const inspection = await inspectWatcherLock(runtimeRoot);
    assert.equal(inspection.state, 'stale');
    const lock = await acquireWatcherLock(runtimeRoot);
    lock.release();

    // The same process with a matching start time is a live owner.
    await seedLock(runtimeRoot, {
      pid: bystander.pid,
      token: 'live-bystander',
      startedAt: Date.now() - 100,
    });
    assert.equal((await inspectWatcherLock(runtimeRoot)).state, 'live');
    await assert.rejects(acquireWatcherLock(runtimeRoot), {
      code: 'DOCSHELF_LOCK_HELD',
      message: new RegExp(`PID ${bystander.pid}`),
    });
    assert.deepEqual(await leftovers(runtimeRoot), ['watch.lock'], 'the refused path mutates nothing');
  },
);

test('multi-process contention over a stale lock has exactly one winner', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const rounds = 12;
  const starters = 6;

  for (let round = 0; round < rounds; round += 1) {
    await seedLock(runtimeRoot, { pid: await deadPid(), token: `stale-${round}` });
    const children = Array.from({ length: starters }, () =>
      spawnLockChild('hold', runtimeRoot, ['--gate']),
    );
    await Promise.all(children.map((child) => child.waitFor('waiting')));
    for (const child of children) child.process.stdin.write('go\n');

    const outcomes = await Promise.all(
      children.map(async (child) => {
        const acquired = await child.waitFor('acquired').then(
          () => true,
          () => false,
        );
        if (!acquired) await child.exited;
        return { child, acquired };
      }),
    );

    const winners = outcomes.filter((outcome) => outcome.acquired);
    assert.equal(winners.length, 1, `round ${round}: ${describeChildren(children)}`);
    for (const { child, acquired } of outcomes) {
      if (acquired) continue;
      const { code } = await child.exited;
      assert.equal(code, 3, `round ${round}: loser exited with ${code}: ${child.stderr}`);
      assert.match(child.stderr, /already running/);
      assert.doesNotMatch(child.stderr, /ENOENT|ENOTEMPTY|EPERM|EEXIST/);
    }

    const winner = winners[0].child;
    assert.equal((await readOwner(runtimeRoot)).pid, winner.process.pid);
    winner.process.stdin.write('release\n');
    const { code } = await winner.exited;
    assert.equal(code, 0, winner.stderr);
    assert.equal(await lockExists(runtimeRoot), false, `round ${round}`);
  }

  assert.deepEqual(await leftovers(runtimeRoot), []);
});

test('the lock is released when the process exits normally', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const child = spawnLockChild('exit', runtimeRoot);
  const { code } = await child.exited;
  assert.equal(code, 0, child.stderr);
  assert.match(child.stdout, /acquired/);
  assert.equal(await lockExists(runtimeRoot), false);
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`the lock is released on ${signal}`, { skip: isWindows && 'POSIX signals' }, async (t) => {
    const runtimeRoot = await temporaryRuntime(t);
    const child = spawnLockChild('signals', runtimeRoot);
    await child.waitFor('ready');
    assert.equal(await lockExists(runtimeRoot), true);

    child.process.kill(signal);
    const { code } = await child.exited;
    assert.equal(code, 0, child.stderr);
    assert.match(child.stdout, new RegExp(`shutdown ${signal}[\\s\\S]*shutdown complete`));
    assert.equal(await lockExists(runtimeRoot), false);
  });
}

test(
  'a duplicate SIGINT within a millisecond is absorbed and shutdown still completes',
  { skip: isWindows && 'POSIX signals' },
  async (t) => {
    const runtimeRoot = await temporaryRuntime(t);
    const child = spawnLockChild('signals', runtimeRoot, ['--shutdownMs=200']);
    await child.waitFor('ready');

    child.process.kill('SIGINT');
    child.process.kill('SIGINT');
    const { code } = await child.exited;
    assert.equal(code, 0, child.stderr);
    assert.match(child.stdout, /shutdown complete/);
    assert.equal(await lockExists(runtimeRoot), false);
  },
);

test(
  'a repeated signal after the absorb window forces exit and still releases the lock',
  { skip: isWindows && 'POSIX signals' },
  async (t) => {
    const runtimeRoot = await temporaryRuntime(t);
    const child = spawnLockChild('signals', runtimeRoot, ['--hang', '--absorbMs=100']);
    await child.waitFor('ready');

    child.process.kill('SIGTERM');
    await child.waitFor('shutdown SIGTERM');
    await delay(150);
    child.process.kill('SIGTERM');
    const { code } = await child.exited;
    assert.equal(code, 1, child.stderr);
    assert.doesNotMatch(child.stdout, /shutdown complete/);
    assert.equal(await lockExists(runtimeRoot), false);
  },
);

test('reclaiming a stale lock is always followed by a claim, even with no time budget', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  await seedLock(runtimeRoot, { pid: await deadPid(), token: 'stale' });

  const lock = await acquireWatcherLock(runtimeRoot, { timeoutMs: 0 });
  assert.equal((await readOwner(runtimeRoot)).token, lock.owner.token);
  lock.release();
});

test('malformed owner files are reclaimed', async (t) => {
  for (const contents of ['', '{"pid":12', '\0\0\0\0']) {
    const runtimeRoot = await temporaryRuntime(t);
    await mkdir(watcherLockPath(runtimeRoot));
    await writeFile(path.join(watcherLockPath(runtimeRoot), 'owner.json'), contents);

    const lock = await acquireWatcherLock(runtimeRoot);
    assert.equal((await readOwner(runtimeRoot)).token, lock.owner.token);
    lock.release();
  }
});

test('an owner file that is valid JSON but not a lock record is refused', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  await mkdir(watcherLockPath(runtimeRoot));
  await writeFile(path.join(watcherLockPath(runtimeRoot), 'owner.json'), '{"pid":"abc"}');

  await assert.rejects(acquireWatcherLock(runtimeRoot), {
    code: 'DOCSHELF_LOCK_INVALID',
    message: new RegExp(`invalid watcher lock: ${escapeRegExp(watcherLockPath(runtimeRoot))}`),
  });
  assert.deepEqual(await leftovers(runtimeRoot), ['watch.lock'], 'the refused path mutates nothing');
});

test(
  'an unreadable owner file fails with an error naming the lock path',
  { skip: (isWindows && 'POSIX permissions') || (isRoot && 'root can read anything') },
  async (t) => {
    const runtimeRoot = await temporaryRuntime(t);
    const ownerPath = path.join(watcherLockPath(runtimeRoot), 'owner.json');
    await mkdir(watcherLockPath(runtimeRoot));
    await writeFile(ownerPath, '{}');
    await chmod(ownerPath, 0o000);

    try {
      await assert.rejects(acquireWatcherLock(runtimeRoot), {
        code: 'DOCSHELF_LOCK_UNREADABLE',
        message: new RegExp(escapeRegExp(watcherLockPath(runtimeRoot))),
      });
    } finally {
      await chmod(ownerPath, 0o600);
    }
  },
);

test('a regular file or a symlink at the lock path is refused', async (t) => {
  const fileRoot = await temporaryRuntime(t);
  await writeFile(watcherLockPath(fileRoot), 'not a lock');
  await assert.rejects(acquireWatcherLock(fileRoot), {
    code: 'DOCSHELF_LOCK_UNEXPECTED',
    message: /Refusing to replace an unexpected watcher lock/,
  });
  assert.deepEqual(await leftovers(fileRoot), ['watch.lock']);

  const linkRoot = await temporaryRuntime(t);
  await mkdir(path.join(linkRoot, 'elsewhere'));
  await symlink(path.join(linkRoot, 'elsewhere'), watcherLockPath(linkRoot), 'dir');
  await assert.rejects(acquireWatcherLock(linkRoot), {
    code: 'DOCSHELF_LOCK_UNEXPECTED',
    message: /Refusing to replace an unexpected watcher lock/,
  });
  assert.ok((await lstat(watcherLockPath(linkRoot))).isSymbolicLink(), 'the symlink is untouched');
});

test('an owner-less lock directory is treated as stale after a grace period', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  await mkdir(watcherLockPath(runtimeRoot));
  await writeFile(path.join(watcherLockPath(runtimeRoot), '.DS_Store'), 'finder droppings');

  const startedAt = Date.now();
  const lock = await acquireWatcherLock(runtimeRoot);
  assert.ok(Date.now() - startedAt >= 900, 'waited for the grace period');
  assert.equal((await readOwner(runtimeRoot)).token, lock.owner.token);
  lock.release();
});

test('the refused path leaves no temporaries and stale candidates are swept', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const holder = spawnLockChild('hold', runtimeRoot);
  await holder.waitFor('acquired');
  t.after(() => holder.process.kill('SIGKILL'));

  await assert.rejects(acquireWatcherLock(runtimeRoot), { code: 'DOCSHELF_LOCK_HELD' });
  assert.deepEqual(await leftovers(runtimeRoot), ['watch.lock']);

  holder.process.stdin.write('release\n');
  await holder.exited;

  const staleCandidate = path.join(
    runtimeRoot,
    `.watch.lock-${await deadPid()}-00000000-0000-4000-8000-000000000000.tmp`,
  );
  await mkdir(staleCandidate);
  await writeFile(path.join(staleCandidate, 'owner.json'), '{}');
  const lock = await acquireWatcherLock(runtimeRoot);
  assert.deepEqual(await leftovers(runtimeRoot), ['watch.lock']);
  lock.release();
});

test('a straggler that judged the old lock stale cannot displace its successor', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const lockPath = watcherLockPath(runtimeRoot);
  await seedLock(runtimeRoot, { pid: await deadPid(), token: 'stale' });
  const staleStats = await lstat(lockPath);
  const tombstonePath = path.join(
    runtimeRoot,
    `.watch.lock.stale-${staleStats.ino}-${Math.round(staleStats.ctimeMs)}`,
  );

  const successor = await acquireWatcherLock(runtimeRoot);
  assert.equal(JSON.parse(await readFile(path.join(tombstonePath, 'owner.json'), 'utf8')).token, 'stale');

  // A slow rival acting on the same stale inspection targets the same tombstone and fails.
  await assert.rejects(rename(lockPath, tombstonePath), (error) =>
    ['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code),
  );
  assert.equal((await readOwner(runtimeRoot)).token, successor.owner.token);
  successor.release();
});

test('a launchd-managed owner is reported with uninstall advice', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const previous = process.env.XPC_SERVICE_NAME;
  process.env.XPC_SERVICE_NAME = 'local.docshelf.watch';
  t.after(() => {
    if (previous === undefined) delete process.env.XPC_SERVICE_NAME;
    else process.env.XPC_SERVICE_NAME = previous;
  });

  const lock = await acquireWatcherLock(runtimeRoot);
  t.after(() => lock.release());
  await assert.rejects(acquireWatcherLock(runtimeRoot), {
    message: /under launchd as local\.docshelf\.watch.*npm run daemon:uninstall/,
  });
  assert.equal((await inspectWatcherLock(runtimeRoot)).owner.launchdService, 'local.docshelf.watch');
});

test('the sync lock waits for a live holder and gives up with a clear timeout', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const held = await acquireSyncLock(runtimeRoot);

  const impatient = spawnLockChild('sync-hold', runtimeRoot, ['--timeoutMs=300']);
  const { code } = await impatient.exited;
  assert.equal(code, 4, impatient.stderr);
  assert.match(impatient.stderr, /Timed out after 0 s waiting for DocShelf process/);
  assert.match(impatient.stderr, new RegExp(escapeRegExp(syncLockPath(runtimeRoot))));

  const patient = spawnLockChild('sync-hold', runtimeRoot, ['--timeoutMs=5000']);
  await delay(300);
  assert.doesNotMatch(patient.stdout, /acquired/);
  const releasedAt = Date.now();
  held.release();
  await patient.waitFor('acquired');
  assert.ok(Date.now() >= releasedAt);
  assert.equal((await inspectLock(syncLockPath(runtimeRoot))).owner.pid, patient.process.pid);

  patient.process.stdin.write('release\n');
  assert.equal((await patient.exited).code, 0, patient.stderr);
  assert.deepEqual(await leftovers(runtimeRoot), []);
});

test('two processes contending for the sync lock serialize', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const first = spawnLockChild('sync-hold', runtimeRoot);
  await first.waitFor('acquired');
  const second = spawnLockChild('sync-hold', runtimeRoot);
  await delay(250);
  assert.doesNotMatch(second.stdout, /acquired/);

  first.process.stdin.write('release\n');
  assert.equal((await first.exited).code, 0, first.stderr);
  await second.waitFor('acquired');
  second.process.stdin.write('release\n');
  assert.equal((await second.exited).code, 0, second.stderr);
  assert.equal(await lockExists(runtimeRoot, syncLockPath), false);
});

test('a pending wait for the sync lock can be aborted and leaves nothing behind', async (t) => {
  const runtimeRoot = await temporaryRuntime(t);
  const holder = await acquireSyncLock(runtimeRoot);
  t.after(() => holder.release());

  const controller = new AbortController();
  const waiting = acquireSyncLock(runtimeRoot, { signal: controller.signal });
  await delay(100);
  controller.abort();
  await assert.rejects(waiting, { code: 'DOCSHELF_LOCK_ABORTED' });
  assert.deepEqual(await leftovers(runtimeRoot), ['sync.lock'], 'the aborted wait removed its candidate');

  // An already-aborted signal is refused before anything is created.
  await assert.rejects(acquireSyncLock(runtimeRoot, { signal: AbortSignal.abort() }), {
    code: 'DOCSHELF_LOCK_ABORTED',
  });
  assert.deepEqual(await leftovers(runtimeRoot), ['sync.lock']);

  holder.release();
  const next = await acquireSyncLock(runtimeRoot);
  next.release();
  assert.equal(await lockExists(runtimeRoot, syncLockPath), false);
});

function temporaryRuntime(t) {
  return temporaryDirectory(t, tmpdir(), 'docshelf-watch-lock-');
}

async function seedLock(runtimeRoot, owner) {
  const lockPath = watcherLockPath(runtimeRoot);
  await mkdir(lockPath, { recursive: true });
  await writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({ version: 1, ...owner })}\n`);
}

async function readOwner(runtimeRoot) {
  return JSON.parse(await readFile(path.join(watcherLockPath(runtimeRoot), 'owner.json'), 'utf8'));
}

async function lockExists(runtimeRoot, lockPathFor = watcherLockPath) {
  return Boolean(await lstat(lockPathFor(runtimeRoot)).catch(() => null));
}

/** Everything in the runtime root except tombstones, which intentionally linger. */
async function leftovers(runtimeRoot) {
  const entries = await readdir(runtimeRoot);
  return entries.filter((entry) => !/\.stale-\d+-\d+$/.test(entry)).sort();
}

async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid;
}

function spawnLockChild(mode, runtimeRoot, extraArguments = []) {
  const child = spawn(process.execPath, [childScript, mode, runtimeRoot, ...extraArguments], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const handle = {
    process: child,
    stdout: '',
    stderr: '',
    exited: new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    waitFor(text) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (handle.stdout.includes(text)) {
            child.stdout.off('data', check);
            resolve();
          }
        };
        child.stdout.on('data', check);
        check();
        handle.exited.then(() => {
          child.stdout.off('data', check);
          reject(new Error(`child exited before printing "${text}": ${handle.stderr}`));
        });
      });
    },
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    handle.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    handle.stderr += chunk;
  });
  child.stdin.on('error', () => {});
  return handle;
}

function describeChildren(children) {
  return children
    .map((child) => `[${child.process.pid}] out=${JSON.stringify(child.stdout)} err=${JSON.stringify(child.stderr)}`)
    .join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
