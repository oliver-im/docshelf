import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
 * StandardOutPath and StandardErrorPath, continues after the retained tail. The compacting I/O is
 * synchronous because the watcher itself owns those streams: keeping it in one event-loop turn
 * prevents another watcher log write from being appended and then lost between the read and
 * truncate operations.
 *
 * @param {string} filePath
 * @param {{ maxBytes: number, keepBytes: number }} [limits]
 * @returns {number} the number of bytes removed
 */
export function trimLog(filePath, limits = defaultLogLimits) {
  if (limits.keepBytes >= limits.maxBytes) {
    throw new Error('Log trimming must keep fewer bytes than it allows before trimming.');
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return 0;
  }
  if (!stats?.isFile() || stats.size <= limits.maxBytes) return 0;

  const descriptor = openSync(filePath, 'r+');
  try {
    // Recheck through the opened descriptor in case the path changed after the initial stat.
    stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size <= limits.maxBytes) return 0;

    const start = stats.size - limits.keepBytes;
    const buffer = Buffer.alloc(limits.keepBytes);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, start);
    let tail = buffer.subarray(0, bytesRead);
    const newline = tail.indexOf('\n');
    if (newline !== -1) tail = tail.subarray(newline + 1);

    const removed = stats.size - tail.length;
    const note = Buffer.from(`[log] Trimmed ${removed} earlier bytes from this log.\n`);
    const compacted = Buffer.concat([note, tail]);
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, compacted);
    return removed;
  } finally {
    closeSync(descriptor);
  }
}
