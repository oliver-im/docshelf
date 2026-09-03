import { execFile as execFileWithCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

/**
 * Single-instance locks for DocShelf processes.
 *
 * A lock is a directory (`watch.lock` or `sync.lock` beneath the runtime root) that holds an
 * `owner.json` describing the process that took it. It becomes visible atomically: the owner file
 * is written into a hidden candidate directory that is then renamed onto the lock path, and a
 * rename onto a non-empty directory fails on every platform. A lock whose owner is gone is
 * reclaimed by renaming it aside to a tombstone whose name is derived from the directory's own
 * identity, so two processes that judged the same stale lock cannot both "remove" it and the
 * tombstone blocks a slow rival from moving the successor's live lock. Nothing is ever deleted
 * in place while it sits at the lock path.
 */

const execFile = promisify(execFileWithCallback);
const ownerFileName = 'owner.json';
const ownerFormatVersion = 1;
const maxPid = 0x7f_ff_ff_ff;
const startTimeToleranceMs = 15_000;
const transitionGraceMs = 1_000;
const tombstoneLifetimeMs = 10 * 60_000;
const maxReclaims = 25;
const defaultTimeoutMs = 10_000;
const syncLockTimeoutMs = 120_000;
const rmOptions = { recursive: true, force: true, maxRetries: 10, retryDelay: 20 };
const occupiedRenameCodes = new Set([
  'EEXIST',
  'ENOTEMPTY',
  'EPERM',
  'EACCES',
  'ENOTDIR',
  'EISDIR',
  'EBUSY',
]);
const transientRenameCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Tokens this process has registered per lock path, so a lock held here is never "stale". */
const ownTokens = new Map();
/** Candidate directories this process is currently using, so the sweep leaves them alone. */
const activeTemporaries = new Set();

const kinds = {
  watcher: { fileName: 'watch.lock', label: 'DocShelf watcher', wait: false },
  sync: { fileName: 'sync.lock', label: 'DocShelf artifact sync', wait: true },
};

/** @param {string} runtimeRoot */
export function watcherLockPath(runtimeRoot) {
  return path.join(runtimeRoot, kinds.watcher.fileName);
}

/** @param {string} runtimeRoot */
export function syncLockPath(runtimeRoot) {
  return path.join(runtimeRoot, kinds.sync.fileName);
}

/**
 * Take the watcher lock or fail if a live DocShelf watcher already holds it.
 *
 * @param {string} runtimeRoot
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 */
export function acquireWatcherLock(runtimeRoot, options = {}) {
  return acquireLock('watcher', watcherLockPath(runtimeRoot), options);
}

/**
 * Take the artifact-sync lock, waiting for a live holder to finish.
 *
 * @param {string} runtimeRoot
 * @param {{ timeoutMs?: number, onWait?: (owner: LockOwner) => void, signal?: AbortSignal }} [options]
 */
export function acquireSyncLock(runtimeRoot, options = {}) {
  return acquireLock('sync', syncLockPath(runtimeRoot), { timeoutMs: syncLockTimeoutMs, ...options });
}

/** @param {string} runtimeRoot */
export function inspectWatcherLock(runtimeRoot) {
  return inspectLock(watcherLockPath(runtimeRoot));
}

/**
 * @typedef {object} LockOwner
 * @property {number} pid
 * @property {string} token
 * @property {number | null} startedAt
 * @property {string | null} hostname
 * @property {string | null} script
 * @property {string | null} launchdService
 */

/**
 * @typedef {object} LockHandle
 * @property {string} path
 * @property {LockOwner} owner
 * @property {() => boolean} release Synchronous and idempotent; safe from an 'exit' handler.
 */

/**
 * @param {'watcher' | 'sync'} kind
 * @param {string} lockPath
 * @param {{ timeoutMs?: number, onWait?: (owner: LockOwner) => void, signal?: AbortSignal }} options
 *   `signal` cancels a pending wait; the rejection carries the code DOCSHELF_LOCK_ABORTED.
 * @returns {Promise<LockHandle>}
 */
async function acquireLock(kind, lockPath, options) {
  const { wait } = kinds[kind];
  const { signal } = options;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (signal?.aborted) throw abortError(kind, lockPath, signal);
  await mkdir(path.dirname(lockPath), { recursive: true });

  // Read-only pre-check: the refused path must not touch the filesystem.
  const first = await inspectLock(lockPath);
  throwIfUnusable(kind, lockPath, first);
  if (first.state === 'live' && !wait) throw heldError(kind, lockPath, first);

  await sweepLeftovers(lockPath);

  const owner = createOwner();
  const candidatePath = temporaryPath(lockPath);
  registerToken(lockPath, owner.token);
  activeTemporaries.add(candidatePath);

  try {
    await mkdir(candidatePath);
    await writeFile(path.join(candidatePath, ownerFileName), `${JSON.stringify(owner)}\n`, {
      mode: 0o600,
    });

    const deadline = Date.now() + timeoutMs;
    let transitionSince = null;
    let reclaims = 0;
    let lastReclaimError = null;
    let waitReported = false;

    for (;;) {
      if (signal?.aborted) throw abortError(kind, lockPath, signal);
      if (await claim(candidatePath, lockPath)) {
        return createHandle(lockPath, owner);
      }

      const inspection = await inspectLock(lockPath);
      throwIfUnusable(kind, lockPath, inspection);

      if (inspection.state === 'free') {
        if (Date.now() > deadline) throw timeoutError(kind, lockPath, timeoutMs, null);
        await backoff(signal);
        continue;
      }

      if (inspection.state === 'live') {
        if (!wait) throw heldError(kind, lockPath, inspection);
        if (Date.now() > deadline) throw timeoutError(kind, lockPath, timeoutMs, inspection.owner);
        if (!waitReported) {
          waitReported = true;
          options.onWait?.(inspection.owner);
        }
        await backoff(signal, 150, 150);
        continue;
      }

      if (inspection.state === 'transition') {
        transitionSince ??= Date.now();
        if (Date.now() - transitionSince < transitionGraceMs && Date.now() < deadline) {
          await backoff(signal);
          continue;
        }
      }

      // The lock is stale, or an owner-less directory outlived the grace period. A removal is
      // always followed by a fresh claim; the deadline only bounds waiting.
      reclaims += 1;
      if (reclaims > maxReclaims) {
        throw lockError(
          'DOCSHELF_LOCK_RECLAIM',
          `Could not reclaim the stale ${kinds[kind].label} lock at ${lockPath} after ${maxReclaims} attempts` +
            `${lastReclaimError ? `: ${lastReclaimError.message}` : '.'} ${remedy(lockPath)}`,
        );
      }
      const result = await reclaim(lockPath, inspection);
      lastReclaimError = result.error ?? lastReclaimError;
      transitionSince = null;
      if (result.outcome === 'retry') await backoff(signal);
    }
  } catch (error) {
    unregisterToken(lockPath, owner.token);
    // A backoff interrupted by the signal rejects with an AbortError; report it as a lock error.
    throw signal?.aborted && error?.name === 'AbortError' ? abortError(kind, lockPath, signal) : error;
  } finally {
    activeTemporaries.delete(candidatePath);
    await rm(candidatePath, rmOptions);
  }
}

/** @param {string} candidatePath @param {string} lockPath */
async function claim(candidatePath, lockPath) {
  try {
    await rename(candidatePath, lockPath);
    return true;
  } catch (error) {
    if (occupiedRenameCodes.has(error?.code)) return false;
    throw error;
  }
}

/**
 * Move a stale lock aside. The tombstone name comes from the inspected directory's identity, so
 * rivals that judged the same directory stale collide on the same name and only one rename can
 * succeed; the moved directory is then verified to be the one that was inspected.
 *
 * @param {string} lockPath
 * @param {LockInspection} inspection
 * @returns {Promise<{ outcome: 'reclaimed' | 'lost' | 'retry', error?: Error }>}
 */
async function reclaim(lockPath, inspection) {
  const { stats } = inspection;
  if (inspection.state === 'transition' && inspection.empty) {
    // An empty directory has no owner to protect; rmdir fails if a rival has since claimed it.
    try {
      await rmdir(lockPath);
      return { outcome: 'reclaimed' };
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY') return { outcome: 'lost' };
      if (transientRenameCodes.has(error?.code)) return { outcome: 'retry', error };
      throw error;
    }
  }

  const tombstonePath = tombstonePathFor(lockPath, stats);
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { outcome: 'lost' };
    if (occupiedRenameCodes.has(error?.code)) return { outcome: 'retry', error };
    throw error;
  }

  const moved = await lstat(tombstonePath).catch(() => null);
  if (moved && moved.ino === stats.ino) return { outcome: 'reclaimed' };

  // A rival's lock replaced the stale one between the inspection and the rename. Put it back.
  try {
    await rename(tombstonePath, lockPath);
  } catch (error) {
    throw lockError(
      'DOCSHELF_LOCK_DISPLACED',
      `Moved a live lock aside by mistake and could not restore it: ${tombstonePath} belongs at ${lockPath}. ` +
        'Stop every DocShelf process, move it back, then retry.',
      { cause: error },
    );
  }
  return { outcome: 'lost' };
}

/** @param {string} lockPath @param {LockOwner} owner @returns {LockHandle} */
function createHandle(lockPath, owner) {
  return {
    path: lockPath,
    owner,
    release() {
      if (!ownsToken(lockPath, owner.token)) return false;
      try {
        const record = readLockRecord(lockPath);
        if (record.state !== 'owned' || record.owner.token !== owner.token) return false;
        return removeLockDirectorySync(lockPath);
      } finally {
        unregisterToken(lockPath, owner.token);
      }
    },
  };
}

/**
 * Remove a lock this process owns without ever leaving a half-deleted directory at the lock path.
 *
 * @param {string} lockPath
 */
function removeLockDirectorySync(lockPath) {
  const asidePath = temporaryPath(lockPath);
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(lockPath, asidePath);
      break;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      if (!transientRenameCodes.has(error?.code) || attempt >= 5) {
        rmSync(lockPath, rmOptions);
        return true;
      }
      sleepSync(20);
    }
  }
  rmSync(asidePath, rmOptions);
  return true;
}

/**
 * @typedef {object} LockInspection
 * @property {'free' | 'unexpected' | 'transition' | 'unreadable' | 'invalid' | 'stale' | 'live'} state
 * @property {LockOwner | null} [owner]
 * @property {import('node:fs').Stats} [stats]
 * @property {boolean} [empty]
 * @property {boolean} [verified] Whether a live owner was confirmed to be the recorded process.
 * @property {string} [reason]
 * @property {Error} [error]
 */

/**
 * Describe what is at the lock path and whether its owner is alive.
 *
 * @param {string} lockPath
 * @returns {Promise<LockInspection>}
 */
export async function inspectLock(lockPath) {
  const record = readLockRecord(lockPath);
  if (record.state === 'malformed') {
    return { ...record, state: 'stale', owner: null, reason: 'its owner file is not valid JSON' };
  }
  if (record.state !== 'owned') return record;
  const assessment = await assessOwner(lockPath, record.owner);
  return { ...record, ...assessment };
}

/**
 * The one owner-reading routine. Synchronous so the 'exit' handler can share it.
 *
 * @param {string} lockPath
 */
function readLockRecord(lockPath) {
  let stats;
  try {
    stats = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { state: 'free' };
    return { state: 'unreadable', error };
  }
  if (!stats.isDirectory()) return { state: 'unexpected', stats };

  let contents;
  try {
    contents = readFileSync(path.join(lockPath, ownerFileName), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { state: 'transition', stats, empty: directoryIsEmpty(lockPath) };
    }
    return { state: 'unreadable', stats, error };
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { state: 'malformed', stats };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Number.isInteger(parsed.pid) ||
    typeof parsed.token !== 'string' ||
    parsed.token === ''
  ) {
    return { state: 'invalid', stats };
  }

  return {
    state: 'owned',
    stats,
    owner: {
      pid: parsed.pid,
      token: parsed.token,
      startedAt: Number.isFinite(parsed.startedAt) ? parsed.startedAt : null,
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : null,
      script: typeof parsed.script === 'string' ? parsed.script : null,
      launchdService: typeof parsed.launchdService === 'string' ? parsed.launchdService : null,
    },
  };
}

/**
 * @param {string} lockPath
 * @param {LockOwner} owner
 * @returns {Promise<{ state: 'live' | 'stale', verified: boolean, reason: string }>}
 */
async function assessOwner(lockPath, owner) {
  const stale = (reason) => ({ state: 'stale', verified: false, reason });

  if (owner.pid === process.pid) {
    return ownsToken(lockPath, owner.token)
      ? { state: 'live', verified: true, reason: 'held by this process' }
      : stale(`PID ${owner.pid} is this process, which does not hold it`);
  }
  if (owner.pid < 1 || owner.pid > maxPid) return stale(`PID ${owner.pid} is out of range`);

  const signal = signalProcess(owner.pid);
  if (signal === 'dead') return stale(`PID ${owner.pid} is not running`);

  const identity = await describeProcess(owner.pid);
  if (identity?.zombie) return stale(`PID ${owner.pid} is a zombie`);

  const scriptName = owner.script ? path.basename(owner.script) : null;
  const scriptMatches = Boolean(scriptName && identity?.args?.includes(scriptName));
  const startKnown = identity?.startedAt !== null && identity?.startedAt !== undefined;
  const startMatches =
    startKnown &&
    owner.startedAt !== null &&
    Math.abs(identity.startedAt - owner.startedAt) <= startTimeToleranceMs;
  if (scriptMatches || startMatches) {
    return { state: 'live', verified: true, reason: `PID ${owner.pid} is running` };
  }
  if (startKnown && owner.startedAt !== null) {
    return stale(`PID ${owner.pid} now belongs to a different process`);
  }
  if (signal === 'protected') {
    return stale(`PID ${owner.pid} belongs to another user and is not a DocShelf process`);
  }
  return { state: 'live', verified: false, reason: `PID ${owner.pid} is running` };
}

/** @param {number} pid @returns {'alive' | 'dead' | 'protected'} */
function signalProcess(pid) {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'EPERM') return 'protected';
    return 'dead';
  }
}

/**
 * Whether a PID belongs to a running process. Processes owned by other users count as alive.
 *
 * @param {number} pid
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid > maxPid) return false;
  return pid === process.pid || signalProcess(pid) !== 'dead';
}

/**
 * Best-effort identity of a running process: its start time and command line.
 *
 * @param {number} pid
 * @returns {Promise<{ zombie: boolean, startedAt: number | null, args: string } | null>}
 */
async function describeProcess(pid) {
  if (process.platform === 'win32') return null;
  if (process.platform === 'linux') {
    const fromProc = await describeProcessFromProc(pid);
    if (fromProc) return fromProc;
  }
  return describeProcessWithPs(pid);
}

/** @param {number} pid */
async function describeProcessWithPs(pid) {
  let stdout;
  try {
    ({ stdout } = await execFile('ps', ['-o', 'etime=', '-o', 'stat=', '-o', 'args=', '-p', String(pid)], {
      timeout: 5_000,
    }));
  } catch {
    return null;
  }
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  const match = line ? /^(\S+)\s+(\S+)\s*(.*)$/s.exec(line) : null;
  if (!match) return null;
  const elapsedMs = parseElapsedTime(match[1]);
  return {
    zombie: match[2].startsWith('Z'),
    startedAt: elapsedMs === null ? null : Date.now() - elapsedMs,
    args: match[3],
  };
}

/** @param {number} pid */
async function describeProcessFromProc(pid) {
  try {
    const [stat, cmdline, systemStat] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/cmdline`, 'utf8'),
      readFile('/proc/stat', 'utf8'),
    ]);
    // Fields after the parenthesised command name: state is field 3, starttime field 22.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(' ');
    const startTicks = Number(fields[19]);
    const bootTime = Number(/^btime (\d+)/m.exec(systemStat)?.[1]);
    if (!Number.isFinite(startTicks) || !Number.isFinite(bootTime)) return null;
    return {
      zombie: fields[0] === 'Z',
      startedAt: (bootTime + startTicks / 100) * 1000,
      args: cmdline.split('\0').filter(Boolean).join(' '),
    };
  } catch {
    return null;
  }
}

/** Parse ps' `[[dd-]hh:]mm:ss` elapsed time into milliseconds. @param {string} value */
function parseElapsedTime(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const [, days = '0', hours = '0', minutes, seconds] = match;
  return (
    (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000
  );
}

/**
 * Remove leftovers from processes that died mid-operation: candidate and aside directories
 * whose embedded PID is gone, and tombstones older than their protective lifetime.
 *
 * @param {string} lockPath
 */
async function sweepLeftovers(lockPath) {
  const directory = path.dirname(lockPath);
  const base = escapeRegExp(path.basename(lockPath));
  const temporaryPattern = new RegExp(`^\\.${base}-(\\d+)-[0-9a-f-]+\\.tmp$`);
  const tombstonePattern = new RegExp(`^\\.${base}\\.stale-\\d+-\\d+$`);
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const temporary = temporaryPattern.exec(entry);
    if (temporary) {
      if (activeTemporaries.has(entryPath)) continue;
      const pid = Number(temporary[1]);
      if (pid !== process.pid && isProcessAlive(pid)) continue;
      await rm(entryPath, rmOptions).catch(() => {});
      continue;
    }
    if (tombstonePattern.test(entry)) {
      const stats = await lstat(entryPath).catch(() => null);
      if (!stats || Date.now() - stats.ctimeMs < tombstoneLifetimeMs) continue;
      // Move it to a unique name first so a straggler never finds a half-deleted tombstone.
      const asidePath = temporaryPath(lockPath);
      await rename(entryPath, asidePath)
        .then(() => rm(asidePath, rmOptions))
        .catch(() => {});
    }
  }
}

/** @param {string} lockPath */
function temporaryPath(lockPath) {
  return path.join(
    path.dirname(lockPath),
    `.${path.basename(lockPath)}-${process.pid}-${randomUUID()}.tmp`,
  );
}

/** @param {string} lockPath @param {import('node:fs').Stats} stats */
function tombstonePathFor(lockPath, stats) {
  return path.join(
    path.dirname(lockPath),
    `.${path.basename(lockPath)}.stale-${stats.ino}-${Math.round(stats.ctimeMs)}`,
  );
}

function createOwner() {
  return {
    version: ownerFormatVersion,
    pid: process.pid,
    token: randomUUID(),
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
    hostname: hostname(),
    script: process.argv[1] ? path.resolve(process.argv[1]) : null,
    launchdService: launchdServiceName(),
  };
}

/**
 * The launchd job label when this process was started from a launchd plist. Interactive shells
 * carry `XPC_SERVICE_NAME=0` and GUI-app terminals `application.<bundle>...`, neither of which
 * is a job that `launchctl` would relaunch.
 */
function launchdServiceName() {
  const name = process.env.XPC_SERVICE_NAME;
  if (!name || name === '0' || name.startsWith('application.')) return null;
  return name;
}

/** @param {'watcher' | 'sync'} kind @param {string} lockPath @param {LockInspection} inspection */
function throwIfUnusable(kind, lockPath, inspection) {
  const { label } = kinds[kind];
  switch (inspection.state) {
    case 'unexpected':
      throw lockError(
        'DOCSHELF_LOCK_UNEXPECTED',
        `Refusing to replace an unexpected ${kind} lock: ${lockPath} is not a directory. ` +
          'Delete it if it does not belong to DocShelf, then retry.',
      );
    case 'unreadable':
      throw lockError(
        'DOCSHELF_LOCK_UNREADABLE',
        `Could not read the ${label} lock at ${lockPath}: ${inspection.error?.message ?? 'unknown error'}. ` +
          'Fix its permissions or delete it, then retry.',
        { cause: inspection.error },
      );
    case 'invalid':
      throw lockError(
        'DOCSHELF_LOCK_INVALID',
        `Refusing to replace an invalid ${kind} lock: ${lockPath}/${ownerFileName} does not describe a process. ` +
          'Delete the lock if it does not belong to DocShelf, then retry.',
      );
    default:
  }
}

/** @param {'watcher' | 'sync'} kind @param {string} lockPath @param {LockInspection} inspection */
function heldError(kind, lockPath, inspection) {
  const { label } = kinds[kind];
  const owner = inspection.owner;
  const where = owner.hostname && owner.hostname !== hostname() ? ` on ${owner.hostname}` : '';
  const lines = [`${label} is already running (PID ${owner.pid}${where}).`];
  if (owner.launchdService) {
    lines.push(
      `It runs under launchd as ${owner.launchdService}; stop it with \`npm run daemon:uninstall\` ` +
        '(killing it alone lets launchd restart it).',
    );
  } else {
    lines.push('Stop it before starting another instance.');
  }
  lines.push(
    inspection.verified
      ? `Lock: ${lockPath}`
      : `If PID ${owner.pid} is not a DocShelf process, delete ${lockPath} and retry.`,
  );
  return lockError('DOCSHELF_LOCK_HELD', lines.join(' '), { owner });
}

/**
 * @param {'watcher' | 'sync'} kind
 * @param {string} lockPath
 * @param {number} timeoutMs
 * @param {LockOwner | null} owner
 */
function timeoutError(kind, lockPath, timeoutMs, owner) {
  const holder = owner ? ` for ${describeLockOwner(owner)} to release it` : ' to take it';
  return lockError(
    'DOCSHELF_LOCK_TIMEOUT',
    `Timed out after ${Math.round(timeoutMs / 1000)} s waiting${holder}: ${kinds[kind].label} lock at ${lockPath}. ${remedy(lockPath)}`,
    { owner },
  );
}

/** @param {'watcher' | 'sync'} kind @param {string} lockPath @param {AbortSignal} signal */
function abortError(kind, lockPath, signal) {
  return lockError(
    'DOCSHELF_LOCK_ABORTED',
    `Stopped waiting for the ${kinds[kind].label} lock at ${lockPath}.`,
    { cause: signal.reason },
  );
}

/** @param {LockOwner} owner */
export function describeLockOwner(owner) {
  const script = owner.script ? path.basename(owner.script) : null;
  if (script === 'watch.mjs') return `the DocShelf watcher (PID ${owner.pid})`;
  return `DocShelf process ${owner.pid}${script ? ` (${script})` : ''}`;
}

/** @param {string} lockPath */
function remedy(lockPath) {
  return `If no DocShelf process is running, delete ${lockPath} and retry.`;
}

/**
 * Route SIGHUP, SIGINT, and SIGTERM into one graceful shutdown. The first signal starts it;
 * repeats within `absorbRepeatsForMs` are ignored because npm forwards its own copy of a terminal
 * Ctrl-C to the child; a later repeat forces `process.exit(1)`, which still runs 'exit' handlers.
 *
 * @param {(signal: NodeJS.Signals) => Promise<void> | void} shutdown
 * @param {{ absorbRepeatsForMs?: number, onError?: (error: unknown) => void }} [options]
 * @returns {() => void} Removes the listeners again.
 */
export function installShutdownSignals(shutdown, options = {}) {
  const { absorbRepeatsForMs = 1_000, onError } = options;
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'];
  let startedAt = null;

  const listener = (signal) => {
    if (startedAt === null) {
      startedAt = Date.now();
      Promise.resolve()
        .then(() => shutdown(signal))
        .catch((error) => {
          onError?.(error);
          process.exit(1);
        });
      return;
    }
    if (Date.now() - startedAt >= absorbRepeatsForMs) process.exit(1);
  };

  for (const signal of signals) process.on(signal, listener);
  return () => {
    for (const signal of signals) process.off(signal, listener);
  };
}

/** @param {string} lockPath @param {string} token */
function registerToken(lockPath, token) {
  let tokens = ownTokens.get(lockPath);
  if (!tokens) {
    tokens = new Set();
    ownTokens.set(lockPath, tokens);
  }
  tokens.add(token);
}

/** @param {string} lockPath @param {string} token */
function unregisterToken(lockPath, token) {
  const tokens = ownTokens.get(lockPath);
  if (!tokens) return;
  tokens.delete(token);
  if (tokens.size === 0) ownTokens.delete(lockPath);
}

/** @param {string} lockPath @param {string} token */
function ownsToken(lockPath, token) {
  return ownTokens.get(lockPath)?.has(token) ?? false;
}

/** @param {string} directory */
function directoryIsEmpty(directory) {
  try {
    return readdirSync(directory).length === 0;
  } catch {
    return false;
  }
}

/** @param {AbortSignal | undefined} signal @param {number} [baseMs] @param {number} [jitterMs] */
function backoff(signal, baseMs = 10, jitterMs = 40) {
  return delay(baseMs + Math.random() * jitterMs, undefined, { signal });
}

/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} code @param {string} message @param {object} [extra] */
function lockError(code, message, extra = {}) {
  const { cause, ...properties } = extra;
  const error = cause ? new Error(message, { cause }) : new Error(message);
  return Object.assign(error, { code }, properties);
}
