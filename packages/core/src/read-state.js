// @ts-check

/**
 * Read state marks a document unread when it first appears on the shelf, or when
 * an agent announces that it updated it. It is keyed by stable source identities,
 * so the reader's own edits and route changes keep it read. Each app stores it
 * per device, outside the shared shelf.
 *
 * @typedef {{ version: 1, seen: string[] }} ReadState
 */

/** Documents that leave the shelf stay read, up to this many, so one that returns, such as after a branch switch, is not new. */
const ABSENT_LIMIT = 1000;

/**
 * Bring stored read state up to date with the documents on the shelf now.
 * Without valid stored state, everything already on the shelf starts as read.
 *
 * @param {unknown} stored
 * @param {Iterable<string>} current Source identities on the shelf now.
 * @returns {ReadState}
 */
export function reconcileReadState(stored, current) {
  const present = new Set(current);
  if (!isReadState(stored)) return { version: 1, seen: [...present] };
  // Identities are appended as they are read, so the oldest absent ones come first.
  const absent = stored.seen.filter(id => !present.has(id));
  const dropped = new Set(absent.slice(0, Math.max(0, absent.length - ABSENT_LIMIT)));
  return { version: 1, seen: [...new Set(stored.seen.filter(id => !dropped.has(id)))] };
}

/**
 * @param {ReadState} state
 * @param {Iterable<string>} ids
 * @returns {ReadState}
 */
export function markRead(state, ids) {
  const seen = new Set(state.seen);
  const added = [...new Set(ids)].filter(id => !seen.has(id));
  return added.length ? { version: 1, seen: [...state.seen, ...added] } : state;
}

/**
 * Make documents unread again, as when an agent announces that it updated them.
 *
 * @param {ReadState} state
 * @param {Iterable<string>} ids
 * @returns {ReadState}
 */
export function markUnread(state, ids) {
  const removed = new Set(ids);
  const seen = state.seen.filter(id => !removed.has(id));
  return seen.length === state.seen.length ? state : { version: 1, seen };
}

/**
 * @param {ReadState} state
 * @param {Iterable<string>} current
 * @returns {Set<string>}
 */
export function unreadSources(state, current) {
  const seen = new Set(state.seen);
  return new Set([...current].filter(id => !seen.has(id)));
}

/** @param {unknown} value @returns {value is ReadState} */
function isReadState(value) {
  if (!value || typeof value !== 'object') return false;
  const { version, seen } = /** @type {{ version?: unknown, seen?: unknown }} */ (value);
  return version === 1 && Array.isArray(seen) && seen.every(id => typeof id === 'string');
}
