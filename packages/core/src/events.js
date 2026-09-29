// @ts-check

/**
 * Events are messages between agents and the reader, appended one per line to a
 * log beside the shelf. Version 1 has one type, `document.updated`, which an
 * agent writes after editing a registered document; the apps mark it unread.
 * See docs/events.md for the format.
 *
 * @typedef {{ role: 'agent' | 'user', name?: string, app?: string }} EventSender
 * @typedef {{ start: number, end: number }} EventLines
 * @typedef {{ source?: string, lines?: EventLines, revision?: string }} EventSubject
 * @typedef {{ text?: string, quote?: string, [key: string]: unknown }} EventBody
 * @typedef {{ v: 1, id: string, at: string, from: EventSender, type: string, subject?: EventSubject, re?: string, body?: EventBody }} DocShelfEvent
 */

export const EVENT_VERSION = 1;
/** Longest serialized event, in UTF-8 bytes, excluding its newline. */
export const MAX_EVENT_BYTES = 16 * 1024;
/** Longest `body.text` or `body.quote`, matching shelf descriptions. */
export const MAX_EVENT_TEXT = 8192;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const typePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const revisionPattern = /^sha256:[a-f0-9]{64}$/;

/**
 * Parse one log line. Returns null for a version this reader does not support,
 * which readers skip silently; throws for an invalid line, which they skip with a warning.
 *
 * @param {string} line
 * @returns {DocShelfEvent | null}
 */
export function parseEvent(line) {
  if (new TextEncoder().encode(line).length > MAX_EVENT_BYTES) throw new Error('Event exceeds 16 KiB.');
  /** @type {unknown} */
  let value;
  try { value = JSON.parse(line); } catch { throw new Error('Event is not valid JSON.'); }
  if (isRecord(value) && Number.isInteger(value.v) && /** @type {number} */ (value.v) > EVENT_VERSION) return null;
  return validateEvent(value);
}

/**
 * Build a new event, filling in its ID and time.
 *
 * @param {{ from: EventSender, type: string, subject?: EventSubject, re?: string, body?: EventBody }} fields
 * @param {{ id?: string, at?: Date }} [options]
 * @returns {DocShelfEvent}
 */
export function createEvent({ from, type, subject, re, body }, { id = crypto.randomUUID(), at = new Date() } = {}) {
  return validateEvent({ v: EVENT_VERSION, id, at: at.toISOString(), from, type, ...(subject ? { subject } : {}), ...(re ? { re } : {}), ...(body ? { body } : {}) });
}

/**
 * The log line for an event, including its newline.
 *
 * @param {DocShelfEvent} event
 */
export function serializeEvent(event) {
  const line = JSON.stringify(validateEvent(event));
  if (new TextEncoder().encode(line).length > MAX_EVENT_BYTES) throw new Error('Event exceeds 16 KiB.');
  return `${line}\n`;
}

/**
 * Sources that agents announced as updated, in log order. Each app decides which of
 * them are on its shelf and whether the reader is already looking at one.
 *
 * @param {Iterable<DocShelfEvent>} events
 * @returns {string[]}
 */
export function announcedUpdates(events) {
  const sources = [];
  for (const event of events) {
    if (event.type === 'document.updated' && event.from.role === 'agent' && event.subject?.source) sources.push(event.subject.source);
  }
  return sources;
}

/**
 * Check the fields this version defines. Unknown fields are kept and ignored, so a
 * later minor addition does not make older readers drop events.
 *
 * @param {unknown} value
 * @returns {DocShelfEvent}
 */
export function validateEvent(value) {
  if (!isRecord(value)) throw new Error('Event must be a JSON object.');
  if (value.v !== EVENT_VERSION) throw new Error('Event version must be 1.');
  if (typeof value.id !== 'string' || !idPattern.test(value.id)) throw new Error('Event id must be a short identifier.');
  if (typeof value.at !== 'string' || value.at.length > 64 || Number.isNaN(Date.parse(value.at))) throw new Error('Event time must be an ISO 8601 timestamp.');
  const from = value.from;
  if (!isRecord(from) || (from.role !== 'agent' && from.role !== 'user')) throw new Error('Event sender role must be agent or user.');
  for (const field of ['name', 'app']) if (from[field] !== undefined && !label(from[field])) throw new Error(`Event sender ${field} must be a short name.`);
  if (typeof value.type !== 'string' || value.type.length > 100 || !typePattern.test(value.type)) throw new Error('Event type must be a dotted lowercase name.');
  const subject = value.subject;
  if (subject !== undefined) {
    if (!isRecord(subject)) throw new Error('Event subject must be an object.');
    if (subject.source !== undefined && (typeof subject.source !== 'string' || !subject.source || subject.source.length > 8192 || subject.source.includes('\0'))) throw new Error('Event source must be a path or URL.');
    const lines = subject.lines;
    if (lines !== undefined && (!isRecord(lines) || !position(lines.start) || !position(lines.end) || /** @type {number} */ (lines.start) > /** @type {number} */ (lines.end))) throw new Error('Event lines must be an ordered positive range.');
    if (subject.revision !== undefined && (typeof subject.revision !== 'string' || !revisionPattern.test(subject.revision))) throw new Error('Event revision must be sha256:<hex>.');
  }
  if (value.type === 'document.updated' && !(isRecord(subject) && subject.source)) throw new Error('document.updated requires subject.source.');
  if (value.re !== undefined && (typeof value.re !== 'string' || !idPattern.test(value.re))) throw new Error('Event re must be an event id.');
  const body = value.body;
  if (body !== undefined) {
    if (!isRecord(body)) throw new Error('Event body must be an object.');
    for (const field of ['text', 'quote']) {
      const text = body[field];
      if (text !== undefined && (typeof text !== 'string' || text.length > MAX_EVENT_TEXT || text.includes('\0'))) throw new Error(`Event body.${field} must be text of at most 8192 characters.`);
    }
  }
  return /** @type {DocShelfEvent} */ (value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function label(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\0-\x1f\x7f]/.test(value);
}

/** @param {unknown} value */
function position(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;
}
