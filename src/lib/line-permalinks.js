// @ts-check

const lineFragmentPattern = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/;

/**
 * Parse a DocShelf source-line fragment.
 *
 * @param {string} hash
 * @returns {{ start: number, end: number } | null}
 */
export function parseLineFragment(hash) {
  const match = lineFragmentPattern.exec(hash);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;

  return { start, end };
}

/** @param {number} start @param {number} [end] */
export function createLineFragment(start, end = start) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start
  ) {
    throw new TypeError('Line ranges require positive, ordered safe integers.');
  }

  return end === start ? `#L${start}` : `#L${start}-L${end}`;
}
