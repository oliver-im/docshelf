// @ts-check

/**
 * Pins follow source identities, not titles or routes. Absent sources stay in
 * the list so a temporary removal (for example a branch switch) keeps the pin.
 * Each app stores this state per shelf and device, outside the shared shelf.
 * Each kind has independent identities so pin actions preserve the other kinds.
 * @typedef {'document' | 'folder' | 'project'} PinKind
 * @typedef {{ version: 1, sources: string[], folders: string[], projects: string[] }} PinState
 */

const fields = /** @type {const} */ ({ document: 'sources', folder: 'folders', project: 'projects' });

/** @param {unknown} value @returns {string[]} */
const identities = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0))] : [];

/** @param {unknown} stored @returns {PinState} */
export function readPins(stored) {
  if (!stored || typeof stored !== 'object') return { version: 1, sources: [], folders: [], projects: [] };
  const { version, sources, folders, projects } = /** @type {Partial<PinState>} */ (stored);
  if (version !== 1) return { version: 1, sources: [], folders: [], projects: [] };
  return { version: 1, sources: identities(sources), folders: identities(folders), projects: identities(projects) };
}

/** @param {string[]} values @param {string} identity @param {boolean} pinned */
function toggle(values, identity, pinned) {
  if (!identity) return values;
  return pinned ? (values.includes(identity) ? values : [...values, identity]) : values.filter(id => id !== identity);
}

/** Return validated identities for any supported pin kind.
 * @param {unknown} stored @param {PinKind} kind @returns {string[]} */
export function pinnedIdentities(stored, kind) { return readPins(stored)[fields[kind]]; }

/** Keep kinds in separate records: older clients replace records without preserving unknown fields.
 * All records for a shelf must still share the base key's write lock.
 * @param {string} base @param {PinKind} kind */
export function pinStorageKey(base, kind) { return kind === 'document' ? base : `${base}:${fields[kind]}`; }

/** Apply an explicit action to the latest stored state without changing other kinds or their order.
 * @param {unknown} stored @param {PinKind} kind @param {string} identity @param {boolean} pinned @returns {PinState} */
export function setPin(stored, kind, identity, pinned) {
  const state = readPins(stored);
  const field = fields[kind];
  return { ...state, [field]: toggle(state[field], identity, pinned) };
}

/** @param {unknown} stored @param {string} source @param {boolean} pinned @returns {PinState} */
export function setPinned(stored, source, pinned) { return setPin(stored, 'document', source, pinned); }

/** @param {unknown} stored @param {string} identity @param {boolean} pinned @returns {PinState} */
export function setFolderPinned(stored, identity, pinned) { return setPin(stored, 'folder', identity, pinned); }

/** Use stable tree keys, never folder labels, so duplicate names stay distinct.
 * @param {string} project @param {string} key */
export function folderPinIdentity(project, key) { return JSON.stringify([project, key]); }
