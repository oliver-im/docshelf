// Shared Node access to a shelf's event log. The format lives in @docshelf/core/events; see docs/events.md.
import path from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { MAX_EVENT_BYTES, parseEvent, serializeEvent } from '@docshelf/core/events';
import { acquireEventsLock } from './locks.mjs';

/** Largest amount of the log read at once; readers catch up over several reads. */
const MAX_READ_BYTES = 1024 * 1024;
const newline = 0x0a;

/**
 * A reader's position: the byte offset after the last line it consumed, and that line's
 * event ID, which reveals a log that was replaced by one of similar length.
 * @typedef {{ offset: number, lastId: string | null }} EventCursor
 */

/** Each shelf has its own log beside it: `shelf.local.json` logs to `shelf.local.events.jsonl`.
 * @param {string} shelfPath */
export function eventLogPath(shelfPath) {
  return path.join(path.dirname(shelfPath), `${path.basename(shelfPath).replace(/\.json$/i, '')}.events.jsonl`);
}

/** @param {unknown} value @returns {value is EventCursor} */
export function isEventCursor(value) {
  if (!value || typeof value !== 'object') return false;
  const { offset, lastId } = /** @type {Record<string, unknown>} */ (value);
  return Number.isSafeInteger(offset) && /** @type {number} */ (offset) >= 0 && (lastId === null || typeof lastId === 'string');
}

/** Append one event under the log lock, as a single line.
 * @param {string} shelfPath @param {import('@docshelf/core/events').DocShelfEvent} event */
export async function appendEvent(shelfPath, event) {
  let line = Buffer.from(serializeEvent(event));
  const lock = await acquireEventsLock(shelfPath);
  try {
    const handle = await open(eventLogPath(shelfPath), constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('The event log must be a regular file.');
      // A writer that stopped mid-line leaves it unterminated; start this event on its own line.
      if (info.size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, info.size - 1);
        if (last[0] !== newline) line = Buffer.concat([Buffer.from('\n'), line]);
      }
      for (let written = 0; written < line.length;) written += (await handle.write(line, written)).bytesWritten;
    } finally { await handle.close(); }
  } finally { lock.release(); }
}

/**
 * The position after the log's last complete line. Readers start there, so events
 * written before an app first ran are not replayed.
 * @param {string} logPath @returns {Promise<EventCursor>}
 */
export async function endCursor(logPath) {
  const handle = await openLog(logPath);
  if (!handle) return { offset: 0, lastId: null };
  try { return await endOf(handle); } finally { await handle.close(); }
}

/**
 * Read the complete lines after a cursor. Invalid lines are skipped with a warning and
 * lines from a newer format version are skipped silently. A log that is now shorter
 * than the cursor, or whose line before the cursor has another ID, was replaced: the
 * cursor moves to its end without replaying it.
 *
 * @param {string} logPath
 * @param {EventCursor} cursor
 * @returns {Promise<{ events: import('@docshelf/core/events').DocShelfEvent[], cursor: EventCursor, warnings: string[], reset: boolean }>}
 */
export async function readEvents(logPath, cursor) {
  const handle = await openLog(logPath);
  if (!handle) return { events: [], cursor: { offset: 0, lastId: null }, warnings: [], reset: cursor.offset > 0 };
  try {
    const { size } = await handle.stat();
    if (cursor.offset > size || cursor.lastId !== null && lineId(await lineEndingAt(handle, cursor.offset)) !== cursor.lastId) {
      return { events: [], cursor: await endOf(handle), warnings: [], reset: true };
    }
    const chunk = await readRange(handle, cursor.offset, Math.min(size, cursor.offset + MAX_READ_BYTES));
    const end = chunk.lastIndexOf(newline);
    if (end === -1) {
      if (chunk.length < MAX_READ_BYTES) return { events: [], cursor, warnings: [], reset: false };
      // No line this long can be an event; move on so it cannot stall the reader.
      return { events: [], cursor: { offset: cursor.offset + chunk.length, lastId: null }, warnings: ['Skipped an event log line longer than 1 MiB.'], reset: false };
    }
    const events = [];
    const warnings = [];
    const lines = chunk.subarray(0, end).toString('utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = parseEvent(line);
        if (event) events.push(event);
      } catch (error) {
        warnings.push(`Skipped an invalid event: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { events, cursor: { offset: cursor.offset + end + 1, lastId: lineId(Buffer.from(lines.at(-1) ?? '')) }, warnings, reset: false };
  } finally { await handle.close(); }
}

/** @param {string} logPath */
async function openLog(logPath) {
  let handle;
  try { handle = await open(logPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null; throw error; }
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error('The event log must be a regular file.');
  }
  return handle;
}

/** @param {import('node:fs/promises').FileHandle} handle @returns {Promise<EventCursor>} */
async function endOf(handle) {
  const { size } = await handle.stat();
  const start = Math.max(0, size - MAX_READ_BYTES);
  const tail = await readRange(handle, start, size);
  const end = tail.lastIndexOf(newline);
  if (end === -1) return { offset: start === 0 ? 0 : size, lastId: null };
  const offset = start + end + 1;
  return { offset, lastId: lineId(await lineEndingAt(handle, offset)) };
}

/** The line that ends just before `offset`, or null when no event-sized line ends there.
 * @param {import('node:fs/promises').FileHandle} handle @param {number} offset */
async function lineEndingAt(handle, offset) {
  if (offset === 0) return null;
  const start = Math.max(0, offset - MAX_EVENT_BYTES - 2);
  const window = await readRange(handle, start, offset);
  if (window.at(-1) !== newline) return null;
  const previous = window.lastIndexOf(newline, window.length - 2);
  if (previous === -1 && start > 0) return null;
  return window.subarray(previous + 1, window.length - 1);
}

/** @param {Buffer | null} line */
function lineId(line) {
  if (!line) return null;
  try {
    /** @type {unknown} */
    const value = JSON.parse(line.toString('utf8'));
    const id = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value).id : undefined;
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

/** @param {import('node:fs/promises').FileHandle} handle @param {number} start @param {number} end */
async function readRange(handle, start, end) {
  const buffer = Buffer.alloc(Math.max(0, end - start));
  let read = 0;
  while (read < buffer.length) {
    const { bytesRead } = await handle.read(buffer, read, buffer.length - read, start + read);
    if (!bytesRead) break;
    read += bytesRead;
  }
  return buffer.subarray(0, read);
}
