/** @typedef {{ id: string, source: string, project: string, recursive: boolean, exclude: string[] }} DirectoryEntry */
export const documentExtensions = ['md', 'markdown', 'html', 'htm'];
export const ignoredDirectoryNames = ['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '_build', 'site', 'htmlcov'];

/** @param {unknown} value @returns {DirectoryEntry[]} */
export function parseDirectories(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Use an array of at most 100 folders.');
  const ids = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Folder IDs must be unique lowercase names.');
    ids.add(entry.id);
    for (const field of ['source', 'project']) if (typeof entry[field] !== 'string' || !entry[field].trim() || entry[field].length > 8192 || entry[field].includes('\0')) throw new Error(`Folder ${field} must be a nonempty string.`);
    if (entry.recursive !== undefined && typeof entry.recursive !== 'boolean') throw new Error('Folder recursive must be true or false.');
    const exclude = entry.exclude ?? [];
    if (!Array.isArray(exclude) || exclude.length > 2000 || exclude.some(item => {
      if (typeof item !== 'string' || !item || item.length > 8192 || /[\\\0]/.test(item)) return true;
      const exact = item.startsWith('./');
      return !exact && /[*?:]/.test(item) || (exact ? item.slice(2) : item).split('/').some(part => !part || part === '.' || part === '..');
    })) throw new Error('Exclusions must be relative paths without traversal; use ./ for an exact file path.');
    return { id: entry.id, source: entry.source.trim(), project: entry.project.trim(), recursive: entry.recursive !== false, exclude };
  });
}

/** Relative paths use forward slashes. The explicitly selected root is never excluded.
 * @param {string} relative @param {string[]} [exclude] */
export function excludedPath(relative, exclude = []) {
  if (!relative) return false;
  const parts = relative.split('/');
  return parts.some(part => part.startsWith('.') || ignoredDirectoryNames.includes(part)) || exclude.some(rule => rule.startsWith('./') ? relative === rule.slice(2) : rule.includes('/') ? relative === rule || relative.startsWith(`${rule}/`) : parts.includes(rule));
}

/** @param {string} filename */
export function filenameTitle(filename) {
  return filename.replace(/\.(?:md|markdown|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Document';
}

/** Return a title only when it says more than its filename, so a label can show both without repeating itself.
 * @param {string} title @param {string} filename */
export function distinctTitle(title, filename) {
  const key = (/** @type {string} */ value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return key(title) && key(title) !== key(filenameTitle(filename)) && key(title) !== key(filename) ? title : '';
}

/** @param {string} source @param {string} filename */
export function documentTitle(source, filename) {
  const title = /\.html?$/i.test(filename)
    ? source.match(/<title\b[^>]*>([^<]{1,300})<\/title>/i)?.[1]
    : markdownTitle(source);
  return title?.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) || filenameTitle(filename);
}

/** Infer titles without mistaking fenced code or front matter for prose.
 * @param {string} source */
function markdownTitle(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const value = /^title:\s*(.+?)\s*$/.exec(line)?.[1];
        if (!value) continue;
        // Only scalar titles; do not interpret arbitrary YAML or block values.
        if (/^".*"$/.test(value)) { try { return String(JSON.parse(value)); } catch { continue; } }
        if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
        if (!/^[|>!&*[{]/.test(value)) return value.replace(/\s+#.*$/, '');
      }
      lines.splice(0, end + 1);
    }
  }
  let fence = '';
  for (const line of lines) {
    if (fence) {
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = '';
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) { fence = opening[1]; continue; }
    const heading = /^ {0,3}#\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1];
    if (heading) return heading;
  }
}
