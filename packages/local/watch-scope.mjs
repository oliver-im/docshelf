import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { documentExtensions, excludedPath } from '@docshelf/core/directories';
import { within } from './shelf.mjs';

/** Build a bounded watch set for explicit files and selected directory trees.
 * Host-owned output roots in `ignore` take precedence over all registered inputs.
 */
export async function watchScope(sources, directories = [], { ignore = [] } = {}) {
  const ignoredRoots = [...new Set(await Promise.all(ignore.map(async root => {
    const absolute = path.resolve(root);
    return path.join(await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute)), path.basename(absolute));
  })))].sort();
  const inIgnoredRoot = file => ignoredRoots.some(root => within(root, file));
  const candidates = new Set(sources);
  const trees = [];
  for (const directory of directories) {
    for (const source of [directory.sourcePath, directory.canonicalPath].filter(Boolean)) {
      candidates.add(source);
      trees.push({ path: path.join(await realpath(path.dirname(source)).catch(() => path.dirname(source)), path.basename(source)), recursive: directory.recursive, exclude: directory.exclude });
    }
  }
  const inspected = new Set();
  for (const source of [...candidates]) {
    let missing = !(await lstat(source).catch(() => null));
    for (let candidate = path.dirname(source); !inspected.has(candidate); candidate = path.dirname(candidate)) {
      inspected.add(candidate);
      const info = await lstat(candidate).catch(() => null);
      if (info?.isSymbolicLink() || missing) candidates.add(candidate);
      if (info) missing = false;
      if (candidate === path.dirname(candidate)) break;
    }
  }
  const paths = new Set(await Promise.all([...candidates].map(async source => path.join(await realpath(path.dirname(source)).catch(() => path.dirname(source)), path.basename(source)))));
  for (const file of paths) if (inIgnoredRoot(file)) paths.delete(file);
  const parents = [...new Set([...paths].map(file => path.dirname(file)))];
  const ignored = file => {
    if (inIgnoredRoot(file)) return true;
    if (paths.has(file) || parents.some(parent => parent === file || parent.startsWith(`${file}${path.sep}`))) return false;
    return !trees.some(tree => {
      if (!within(tree.path, file)) return false;
      const relative = path.relative(tree.path, file).split(path.sep).join('/');
      return !excludedPath(relative, tree.exclude) && (tree.recursive || !relative.includes('/'));
    });
  };
  // Folder discovery only consumes documents. Generated metadata and other non-document
  // files must not trigger rebuilds, while explicitly registered files/assets still do.
  const relevantChange = (event, file) => !inIgnoredRoot(file) && (paths.has(file) || event === 'addDir' || event === 'unlinkDir' || documentExtensions.includes(path.extname(file).slice(1).toLowerCase()));
  return { paths, parents, ignored, relevantChange, signature: JSON.stringify([[...paths].sort(), trees, ignoredRoots]) };
}
