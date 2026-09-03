import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireSyncLock,
  acquireWatcherLock,
  installShutdownSignals,
} from '../../scripts/watcher-lock.mjs';

/**
 * Child process used by the watcher-lock tests. It takes a lock the way `scripts/watch.mjs`
 * does: releases it from an 'exit' handler and routes signals through installShutdownSignals.
 *
 *   node lock-child.mjs <hold|exit|signals|sync-hold> <runtimeRoot> [--gate] [--timeoutMs=N]
 *                       [--absorbMs=N] [--shutdownMs=N] [--hang]
 *
 * `hold` and `sync-hold` keep the lock until a line arrives on stdin (or stdin closes).
 * `--gate` waits for a stdin line before acquiring so several children can race.
 */
const [mode, runtimeRoot, ...rest] = process.argv.slice(2);
const options = Object.fromEntries(
  rest.map((argument) => {
    const [key, value = 'true'] = argument.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

if (!['hold', 'exit', 'signals', 'sync-hold'].includes(mode) || !runtimeRoot) {
  console.error('usage: node lock-child.mjs <hold|exit|signals|sync-hold> <runtimeRoot> [options]');
  process.exit(2);
}

const stdinLines = [];
const stdinWaiters = [];
let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() ?? '';
  for (const line of lines) deliverStdin(line);
});
process.stdin.on('end', () => deliverStdin(null));

function deliverStdin(line) {
  const waiter = stdinWaiters.shift();
  if (waiter) waiter(line);
  else stdinLines.push(line);
}

function nextStdinLine() {
  if (stdinLines.length > 0) return Promise.resolve(stdinLines.shift());
  return new Promise((resolve) => stdinWaiters.push(resolve));
}

function stopReadingStdin() {
  process.stdin.pause();
  process.stdin.unref?.();
}

if (options.gate) {
  console.log('waiting');
  await nextStdinLine();
}

let lock;
try {
  lock =
    mode === 'sync-hold'
      ? await acquireSyncLock(runtimeRoot, { timeoutMs: Number(options.timeoutMs ?? 5_000) })
      : await acquireWatcherLock(runtimeRoot, { timeoutMs: Number(options.timeoutMs ?? 10_000) });
} catch (error) {
  console.error(error.message);
  const exitCodes = { DOCSHELF_LOCK_HELD: 3, DOCSHELF_LOCK_TIMEOUT: 4 };
  process.exit(exitCodes[error.code] ?? 1);
}

process.on('exit', () => {
  try {
    lock.release();
  } catch (error) {
    console.error(error.message);
  }
});
console.log(`acquired ${process.pid}`);

if (mode === 'hold' || mode === 'sync-hold') {
  await nextStdinLine();
  lock.release();
  console.log('released');
  stopReadingStdin();
} else if (mode === 'exit') {
  stopReadingStdin();
} else if (mode === 'signals') {
  stopReadingStdin();
  const keepAlive = setInterval(() => {}, 1_000);
  installShutdownSignals(
    async (signal) => {
      console.log(`shutdown ${signal}`);
      if (options.hang) await new Promise(() => {});
      await delay(Number(options.shutdownMs ?? 50));
      clearInterval(keepAlive);
      lock.release();
      console.log('shutdown complete');
    },
    { absorbRepeatsForMs: Number(options.absorbMs ?? 1_000) },
  );
  console.log('ready');
}
