/** @typedef {{ id: string, source: string, project: string, recursive: boolean, exclude: string[] }} DirectoryEntry */
export const documentExtensions = ['md', 'markdown', 'html', 'htm'];
export const ignoredDirectoryNames = ['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '_build', 'site', 'htmlcov'];

/** @param {unknown} value @returns {DirectoryEntry[]} */
export function parseDirectories(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Use an array of at most 100 folders.');
  const ids = new Set();
  const entries = /** @type {unknown[]} */ (value);
  return entries.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Folder IDs must be unique lowercase names.');
    const entry = /** @type {Record<string, unknown>} */ (value);
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Folder IDs must be unique lowercase names.');
    ids.add(entry.id);
    const source = directoryString(entry.source, 'source');
    const project = directoryString(entry.project, 'project');
    if (entry.recursive !== undefined && typeof entry.recursive !== 'boolean') throw new Error('Folder recursive must be true or false.');
    const rawExclude = entry.exclude ?? [];
    const error = 'Exclusions must be relative paths without traversal; use ./ for an exact file path.';
    if (!Array.isArray(rawExclude) || rawExclude.length > 2000) throw new Error(error);
    /** @type {string[]} */
    const exclude = [];
    for (const item of /** @type {unknown[]} */ (rawExclude)) {
      if (typeof item !== 'string' || !item || item.length > 8192 || /[\\\0]/.test(item)) throw new Error(error);
      const exact = item.startsWith('./');
      if (!exact && /[*?:]/.test(item) || (exact ? item.slice(2) : item).split('/').some(part => !part || part === '.' || part === '..')) throw new Error(error);
      exclude.push(item);
    }
    return { id: entry.id, source, project, recursive: entry.recursive !== false, exclude };
  });
}

/** @param {unknown} value @param {string} field */
function directoryString(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\0')) throw new Error(`Folder ${field} must be a nonempty string.`);
  return value.trim();
}

/** Relative paths use forward slashes. The explicitly selected root is never excluded.
 * A `./` rule names one exact path from the root; when that path is a folder, it covers everything inside it.
 * @param {string} relative @param {string[]} [exclude] */
export function excludedPath(relative, exclude = []) {
  if (!relative) return false;
  const parts = relative.split('/');
  const within = (/** @type {string} */ rule) => relative === rule || relative.startsWith(`${rule}/`);
  return parts.some(part => part.startsWith('.') || ignoredDirectoryNames.includes(part)) || exclude.some(rule => rule.startsWith('./') ? within(rule.slice(2)) : rule.includes('/') ? within(rule) : parts.includes(rule));
}

/**
 * @template T
 * @typedef {{ type: 'folder', name: string, key: string, children: DocumentTreeNode<T>[] } | { type: 'document', item: T }} DocumentTreeNode
 */

/**
 * @template T
 * @typedef {{ folders: Map<string, TreeBranch<T>>, documents: T[] }} TreeBranch
 */

/** Nest documents by folder. Folders come first alphabetically, and documents keep their given order.
 * A folder whose only content is one subfolder merges with it into a single `a/b` row.
 * A folder's key is `JSON.stringify` of its full path, which equals that of its own documents' `folders`.
 * @template T
 * @param {Array<{ item: T, folders: string[] }>} entries
 * @returns {DocumentTreeNode<T>[]} */
export function documentTree(entries) {
  /** @type {TreeBranch<T>} */
  const root = { folders: new Map(), documents: [] };
  for (const { item, folders } of entries) {
    let branch = root;
    for (const name of folders) {
      let next = branch.folders.get(name);
      if (!next) branch.folders.set(name, next = { folders: new Map(), documents: [] });
      branch = next;
    }
    branch.documents.push(item);
  }
  /** @param {TreeBranch<T>} branch @param {string[]} parent @returns {DocumentTreeNode<T>[]} */
  const nodes = (branch, parent) => [
    ...[...branch.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, folder]) => {
      const path = [...parent, name];
      while (!folder.documents.length && folder.folders.size === 1) {
        const [[child, only]] = folder.folders;
        path.push(child);
        folder = only;
      }
      return { type: /** @type {const} */ ('folder'), name: path.slice(parent.length).join('/'), key: JSON.stringify(path), children: nodes(folder, path) };
    }),
    ...branch.documents.map(item => ({ type: /** @type {const} */ ('document'), item })),
  ];
  return nodes(root, []);
}

/** @param {string} filename */
export function filenameTitle(filename) {
  return filename.replace(/\.(?:md|markdown|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Document';
}

/** Return a title only when it says more than its filename, so a label can show both without repeating itself.
 * Only filename separators are ignored; other punctuation, as in C++ or Q&A, can distinguish a title.
 * @param {string} title @param {string} filename */
export function distinctTitle(title, filename) {
  const key = (/** @type {string} */ value) => value.toLowerCase().replace(/[\s._-]+/gu, '');
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
