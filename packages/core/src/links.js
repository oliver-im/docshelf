// @ts-check
import { createLineFragment } from './line-permalinks.js';

/** @typedef {{ start: number, end: number }} LineRange */

/**
 * The viewer query is shared by generated links and the registration CLI.
 * Mount paths and the site's origin belong to the web host.
 * @param {string} route
 * @param {string} [query]
 * @param {string} [hash]
 */
export function createViewerLocation(route, query = '', hash = '') {
  const params = new URLSearchParams({ artifact: route });
  if (query) params.set('artifact-query', query);
  return `?${params}${hash}`;
}

/** @param {string} site @param {string} route @param {LineRange | null} [range] */
export function createBrowserLink(site, route, range = null) {
  const url = new URL(site);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('DocShelf site must be an HTTP(S) URL without credentials, a query, or a fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return new URL(createViewerLocation(route, '', range ? createLineFragment(range.start, range.end) : ''), url).href;
}

/** @param {string} vault @param {string} source @param {LineRange | null} [range] */
export function createObsidianLink(vault, source, range = null) {
  if (!vault.trim() || !source.trim()) throw new Error('Obsidian links require a vault and a source.');
  const params = new URLSearchParams({ vault, source });
  if (range) {
    createLineFragment(range.start, range.end);
    params.set('lines', range.start === range.end ? String(range.start) : `${range.start}-${range.end}`);
  }
  // Obsidian percent-decodes values without treating '+' as a space.
  return `obsidian://docshelf?${params.toString().replace(/\+/g, '%20')}`;
}

/** @param {string} source @param {boolean} local @param {LineRange | null} [range] */
export function createSourceReference(source, local, range = null) {
  if (!range) return source;
  const fragment = createLineFragment(range.start, range.end);
  if (!local) return `${source}${fragment}`;
  return `${source}:${range.start}${range.start === range.end ? '' : `-${range.end}`}`;
}
