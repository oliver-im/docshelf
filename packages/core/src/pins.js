// @ts-check

/**
 * Pins follow source identities, not titles or routes. Absent sources stay in
 * the list so a temporary removal (for example a branch switch) keeps the pin.
 * Each app stores this state per shelf and device, outside the shared shelf.
 * @typedef {{ version: 1, sources: string[] }} PinState
 */

/** @param {unknown} stored @returns {PinState} */
export function readPins(stored) {
  if (!stored || typeof stored !== 'object') return { version: 1, sources: [] };
  const { version, sources } = /** @type {Partial<PinState>} */ (stored);
  if (version !== 1 || !Array.isArray(sources)) return { version: 1, sources: [] };
  return { version: 1, sources: [...new Set(sources.filter(id => typeof id === 'string' && id.length > 0))] };
}

/**
 * Apply an explicit pin/unpin to the latest stored state, preserving other pins.
 * @param {unknown} stored
 * @param {string} source
 * @param {boolean} pinned
 * @returns {PinState}
 */
export function setPinned(stored, source, pinned) {
  const state = readPins(stored);
  if (!source) return state;
  if (!pinned) return { version: 1, sources: state.sources.filter(id => id !== source) };
  return state.sources.includes(source) ? state : { version: 1, sources: [...state.sources, source] };
}
