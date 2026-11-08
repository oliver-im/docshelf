// @ts-check

/**
 * Pins follow source identities, not titles or routes. Absent sources stay in
 * the list so a temporary removal (for example a branch switch) keeps the pin.
 * Each app stores this state per shelf and device, outside the shared shelf.
 * Folder identities are separate so document and folder actions preserve each other.
 * @typedef {{ version: 1, sources: string[], folders: string[] }} PinState
 */

/** @param {unknown} value @returns {string[]} */
const identities = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0))] : [];

/** @param {unknown} stored @returns {PinState} */
export function readPins(stored) {
  if (!stored || typeof stored !== 'object') return { version: 1, sources: [], folders: [] };
  const { version, sources, folders } = /** @type {Partial<PinState>} */ (stored);
  if (version !== 1) return { version: 1, sources: [], folders: [] };
  return { version: 1, sources: identities(sources), folders: identities(folders) };
}

/** @param {string[]} values @param {string} identity @param {boolean} pinned */
function toggle(values, identity, pinned) {
  if (!identity) return values;
  return pinned ? (values.includes(identity) ? values : [...values, identity]) : values.filter(id => id !== identity);
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
  return { ...state, sources: toggle(state.sources, source, pinned) };
}

/** @param {unknown} stored @param {string} identity @param {boolean} pinned @returns {PinState} */
export function setFolderPinned(stored, identity, pinned) {
  const state = readPins(stored);
  return { ...state, folders: toggle(state.folders, identity, pinned) };
}

/** Use stable tree keys, never folder labels, so duplicate names stay distinct.
 * @param {string} project @param {string} key */
export function folderPinIdentity(project, key) { return JSON.stringify([project, key]); }
