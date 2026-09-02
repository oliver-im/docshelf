import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lockName = 'watch.lock';
const ownerName = 'owner.json';

/**
 * Prevent multiple watcher processes from publishing and cleaning the same runtime roots.
 *
 * @param {string} runtimeRoot
 * @param {{ pid?: number, processIsRunning?: (pid: number) => boolean }} [options]
 */
export async function acquireWatcherLock(runtimeRoot, options = {}) {
  const pid = options.pid ?? process.pid;
  const processIsRunning = options.processIsRunning ?? isProcessRunning;
  const token = randomUUID();
  const lockPath = path.join(runtimeRoot, lockName);
  const candidatePath = path.join(runtimeRoot, `.watch-lock-${pid}-${token}.tmp`);
  const owner = { pid, token };

  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(candidatePath);

  try {
    await writeFile(path.join(candidatePath, ownerName), `${JSON.stringify(owner)}\n`, {
      mode: 0o600,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await rename(candidatePath, lockPath);
        return createLockHandle(lockPath, owner);
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      }

      const existingOwner = await readLockOwner(lockPath);
      if (!existingOwner) continue;
      if (processIsRunning(existingOwner.pid)) {
        throw new Error(
          `DocShelf watcher is already running (PID ${existingOwner.pid}). ` +
            'Stop it before starting another instance.',
        );
      }

      const confirmedOwner = await readLockOwner(lockPath);
      if (!confirmedOwner || confirmedOwner.token !== existingOwner.token) continue;
      await rm(lockPath, { recursive: true });
    }

    throw new Error('Could not acquire the DocShelf watcher lock.');
  } finally {
    await rm(candidatePath, { recursive: true, force: true });
  }
}

/** @param {string} lockPath @param {{ pid: number, token: string }} owner */
function createLockHandle(lockPath, owner) {
  return {
    async release() {
      const currentOwner = await readLockOwner(lockPath).catch(() => null);
      if (currentOwner?.token !== owner.token) return;
      await rm(lockPath, { recursive: true, force: true });
    },
    releaseSync() {
      try {
        const stats = lstatSync(lockPath);
        if (!stats.isDirectory() || stats.isSymbolicLink()) return;
        const currentOwner = JSON.parse(readFileSync(path.join(lockPath, ownerName), 'utf8'));
        if (currentOwner?.token !== owner.token) return;
        rmSync(lockPath, { recursive: true, force: true });
      } catch {
        // A missing or replaced lock no longer belongs to this process.
      }
    },
  };
}

/** @param {string} lockPath @returns {Promise<{ pid: number, token: string } | null>} */
async function readLockOwner(lockPath) {
  const stats = await lstat(lockPath).catch(() => null);
  if (!stats) return null;
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to replace an unexpected watcher lock: ${lockPath}`);
  }

  const owner = JSON.parse(await readFile(path.join(lockPath, ownerName), 'utf8'));
  if (!Number.isInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== 'string') {
    throw new Error(`Refusing to replace an invalid watcher lock: ${lockPath}`);
  }
  return owner;
}

/** @param {number} pid */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
