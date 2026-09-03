import { fstatSync, statSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';

/** Trim a log once it exceeds `maxBytes`, keeping its last `keepBytes`. */
export const defaultLogLimits = { maxBytes: 1024 * 1024, keepBytes: 256 * 1024 };

/** The files launchd redirects the watcher's standard streams into. @param {string} runtimeRoot */
export function watcherLogPaths(runtimeRoot) {
  return {
    stdout: path.join(runtimeRoot, 'docshelf.stdout.log'),
    stderr: path.join(runtimeRoot, 'docshelf.stderr.log'),
  };
}

/**
 * Whether a standard stream descriptor is the file at `filePath`: true when launchd redirected the
 * stream into that log, false in a terminal or when the file does not exist.
 *
 * @param {number} fd
 * @param {string} filePath
 */
export function standardStreamIs(fd, filePath) {
  try {
    const streamStats = fstatSync(fd);
    if (!streamStats.isFile()) return false;
    const fileStats = statSync(filePath);
    return streamStats.dev === fileStats.dev && streamStats.ino === fileStats.ino;
  } catch {
    return false;
  }
}

/**
 * Keep a log bounded. Once it is larger than `maxBytes`, only its last `keepBytes` survive,
 * starting at a line boundary and preceded by a note about the cut. The file is truncated in
 * place, so a writer that holds it open in append mode, which is how launchd opens
 * StandardOutPath and StandardErrorPath, continues after the retained tail.
 *
 * @param {string} filePath
 * @param {{ maxBytes: number, keepBytes: number }} [limits]
 * @returns {Promise<number>} the number of bytes removed
 */
export async function trimLog(filePath, limits = defaultLogLimits) {
  if (limits.keepBytes >= limits.maxBytes) {
    throw new Error('Log trimming must keep fewer bytes than it allows before trimming.');
  }

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.size <= limits.maxBytes) return 0;

  const handle = await open(filePath, 'r+');
  try {
    const start = stats.size - limits.keepBytes;
    const { bytesRead, buffer } = await handle.read({
      buffer: Buffer.alloc(limits.keepBytes),
      position: start,
    });
    let tail = buffer.subarray(0, bytesRead);
    const newline = tail.indexOf('\n');
    if (newline !== -1) tail = tail.subarray(newline + 1);

    const removed = stats.size - tail.length;
    const note = Buffer.from(`[log] Trimmed ${removed} earlier bytes from this log.\n`);
    await handle.truncate(0);
    await handle.write(Buffer.concat([note, tail]), 0, note.length + tail.length, 0);
    return removed;
  } finally {
    await handle.close();
  }
}
