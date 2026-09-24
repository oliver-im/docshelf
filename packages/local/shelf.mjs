// Shared Node filesystem code. Keep host APIs out of this module and all filesystem code out of core.
import path from 'node:path';
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { acquireRegistrationLock } from './locks.mjs';
import { open, readFile, realpath, stat, lstat, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { parseDirectories, excludedPath, documentExtensions, documentTitle } from '@docshelf/core/directories';
import { parseClaudeArtifactUrl } from '@docshelf/core/claude-artifacts';
import { parseGitHubMarkdownUrl } from '@docshelf/core/github-markdown';

const MAX_DOCUMENTS = 2000;
const MAX_ENTRIES = 20000;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const within = (root, file) => { const relative = path.relative(root, file); return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const portable = value => value.split(path.sep).join('/');
const unavailable = error => ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code);
const scanLimit = message => Object.assign(new Error(message), { code: 'SCAN_LIMIT' });
const regularDocument = file => documentExtensions.includes(path.extname(file).slice(1).toLowerCase());
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'document';
const normalizedSource = source => parseClaudeArtifactUrl(source)?.publicUrl || parseGitHubMarkdownUrl(source)?.sourceUrl || source;

async function readRegistration(shelfPath, roots) {
  const canonicalShelf = await checkedPath(path.dirname(shelfPath), roots);
  const requestedFile = path.join(canonicalShelf, path.basename(shelfPath));
  const shelfFile = await checkedPath(requestedFile, roots).catch(error => { if (error.code === 'ENOENT') return requestedFile; throw error; });
  const info = await lstat(shelfFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)) throw new Error('Shelf must be a regular JSON file no larger than 2 MB.');
  const baseline = info ? await readFile(shelfFile, 'utf8') : null;
  const config = shelfConfig(baseline === null ? { version: 1, artifacts: [] } : JSON.parse(baseline));
  return { shelfFile, baseline, config };
}

export function shelfConfig(value) {
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.artifacts)) throw new Error('Shelf must contain version 1 or 2 and an artifacts array.');
  if (value.version === 1 && value.directories !== undefined && (!Array.isArray(value.directories) || value.directories.length > 0)) throw new Error('Folder registrations require shelf version 2.');
  if (value.artifacts.length > MAX_DOCUMENTS) throw new Error('A shelf supports at most 2,000 documents.');
  return { ...value, directories: parseDirectories(value.directories) };
}

export async function checkedPath(file, roots) {
  const canonical = await realpath(file);
  if (!roots.some(root => within(root, canonical))) throw new Error('Path is outside the configured workspace.');
  return canonical;
}

async function titleFor(file, roots) {
  const canonical = await checkedPath(file, roots);
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    const current = await stat(await checkedPath(file, roots));
    if (!info.isFile() || info.dev !== current.dev || info.ino !== current.ino) throw new Error('Document changed while it was being read.');
    if (info.size > 8 * 1024 * 1024) throw Object.assign(new Error('Document exceeds 8 MB.'), { code: 'DOC_TOO_LARGE' });
    const buffer = Buffer.alloc(Math.min(info.size, 65536));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return documentTitle(buffer.subarray(0, bytesRead).toString('utf8'), path.basename(file));
  } finally { await handle.close(); }
}

/** Expand only explicitly selected folders. Missing folders remain watchable.
 * @returns {Promise<{ artifacts: unknown[], directories: (import('../core/src/directories.js').DirectoryEntry & { sourcePath: string, canonicalPath: string | undefined })[], warnings: string[] }>} */
export async function expandShelf(value, base, roots, { allowUnavailable = false, relativeOnly = false } = {}) {
  const config = shelfConfig(value);
  const artifacts = config.artifacts.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    const { discoveryRoot, directoryId, ...registration } = entry;
    return registration;
  });
  const identities = new Set();
  for (const entry of artifacts) if (typeof entry?.source === 'string' && !/^https?:/i.test(entry.source)) {
    const source = path.resolve(base, entry.source);
    identities.add(await realpath(source).catch(() => source));
  }
  const directories = [];
  const warnings = [];
  const routes = new Set(artifacts.map(entry => entry?.route));
  for (const directory of config.directories) {
    if (/^[a-z][a-z\d+.-]*:/i.test(directory.source) && !path.isAbsolute(directory.source) || directory.source.startsWith('//') || directory.source.startsWith('\\\\') || relativeOnly && path.isAbsolute(directory.source)) throw new Error('Folder sources must be local paths; shared shelves require relative paths.');
    const sourcePath = path.resolve(base, directory.source);
    const watch = { ...directory, sourcePath, canonicalPath: undefined };
    directories.push(watch);
    let canonicalRoot;
    try {
      // A broken symlink is unavailable too, but existing ancestors must stay contained.
      let ancestor = sourcePath;
      while (!(await lstat(ancestor).catch(error => { if (unavailable(error)) return null; throw error; }))) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      await checkedPath(ancestor, roots);
      canonicalRoot = await checkedPath(sourcePath, roots);
      if (!(await stat(canonicalRoot)).isDirectory()) throw new Error('Registered folder is not a directory.');
      watch.canonicalPath = canonicalRoot;
    } catch (error) {
      if (!allowUnavailable || !unavailable(error)) throw error;
      warnings.push(`${directory.project}: folder unavailable: ${directory.source}`);
      continue;
    }
  }
  // Canonical depth makes the most specific folder win, including symlink aliases.
  const depthOf = directory => (directory.canonicalPath || directory.sourcePath).split(path.sep).length;
  directories.sort((a, b) => depthOf(b) - depthOf(a) || a.id.localeCompare(b.id));
  for (const directory of directories) {
    const { sourcePath, canonicalPath: canonicalRoot } = directory;
    if (!canonicalRoot) continue;
    const start = artifacts.length;
    const addedIdentities = [];
    let scanned = 0;
    const walk = async (folder, depth = 0) => {
      if (depth > 32) throw scanLimit('Folder nesting exceeds the 32-level limit.');
      let entries;
      try {
        const canonical = await checkedPath(folder, [canonicalRoot]);
        entries = await readdir(canonical, { withFileTypes: true });
      } catch (error) {
        if (!allowUnavailable || !unavailable(error)) throw error;
        warnings.push(`${directory.project}: folder unavailable: ${portable(path.relative(base, folder))}`);
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++scanned > MAX_ENTRIES) throw scanLimit('Folder scan exceeds 20,000 entries. Select a smaller folder or add exclusions.');
        const file = path.join(folder, entry.name);
        const relative = portable(path.relative(sourcePath, file));
        if (excludedPath(relative, directory.exclude) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (directory.recursive) await walk(file, depth + 1); continue; }
        if (!entry.isFile() || !regularDocument(file)) continue;
        try {
          const target = await checkedPath(file, [canonicalRoot]);
          if (identities.has(target)) continue;
          if (artifacts.length >= MAX_DOCUMENTS) throw scanLimit('A shelf supports at most 2,000 documents. Select a smaller folder or add exclusions.');
          const title = await titleFor(file, [canonicalRoot]);
          const route = `folders/${directory.id}/${slug(relative)}-${digest(relative).slice(0, 16)}.html`;
          if (routes.has(route)) throw new Error(`Duplicate generated route: ${route}`);
          routes.add(route); identities.add(target); addedIdentities.push(target);
          artifacts.push({ project: directory.project, source: portable(path.relative(base, file)), route, title, description: '', discoveryRoot: canonicalRoot, directoryId: directory.id });
        } catch (error) {
          if (allowUnavailable && error.code === 'DOC_TOO_LARGE') { warnings.push(`${directory.project}: document exceeds 8 MB: ${relative}`); continue; }
          if (!allowUnavailable || !unavailable(error)) throw error;
          warnings.push(`${directory.project}: document unavailable: ${relative}`);
        }
      }
    };
    try { await walk(sourcePath); }
    catch (error) {
      if (!allowUnavailable || error.code !== 'SCAN_LIMIT') throw error;
      for (const entry of artifacts.splice(start)) routes.delete(entry.route);
      for (const identity of addedIdentities) identities.delete(identity);
      warnings.push(`${directory.project}: folder skipped: ${directory.source}. ${error.message}`);
    }
  }
  return { artifacts, directories, warnings };
}

/** @typedef {{ project: string, source: string, sourcePath: string, canonicalPath?: string }} PlacedDirectory */

/** Place each local document under the outermost watched folder of its own project that contains it, mirroring the disk.
 * Remote documents and files outside those folders stay at the project root. A project whose documents all sit in one
 * folder omits that folder's name; otherwise each folder is named by its basename, or by its source when basenames collide.
 * @template {PlacedDirectory} D
 * @param {Array<{ project: string, path?: string }>} documents Resolved local paths; remote documents omit them.
 * @param {D[]} directories Expanded folder registrations.
 * @returns {Array<{ folders: string[], directory?: D, root?: string, label?: string }>} In input order. */
function placeDocuments(documents, directories) {
  const depth = (/** @type {string} */ value) => value.split(path.sep).length;
  const placed = documents.map(({ project, path: file }) => {
    /** @type {{ directory: D, root: string } | undefined} */
    let best;
    if (typeof file === 'string') for (const directory of directories) {
      if (directory.project !== project.trim()) continue;
      for (const root of new Set([directory.canonicalPath, directory.sourcePath])) {
        if (root && file !== root && within(root, file) && (!best || depth(root) < depth(best.root))) best = { directory, root };
      }
    }
    return { project: project.trim(), ...best, parts: best && typeof file === 'string' ? path.relative(best.root, path.dirname(file)).split(path.sep).filter(Boolean) : [] };
  });
  /** @type {Map<D, string | undefined>} */
  const labels = new Map();
  for (const project of new Set(placed.map(entry => entry.project))) {
    const used = [...new Set(placed.filter(entry => entry.project === project).map(entry => entry.directory))];
    if (used.length === 1 && used[0]) { labels.set(used[0], undefined); continue; }
    const name = (/** @type {D} */ directory) => path.basename(directory.sourcePath) || directory.source;
    for (const directory of used) if (directory) labels.set(directory, used.some(other => other && other !== directory && name(other) === name(directory)) ? directory.source : name(directory));
  }
  return placed.map(({ directory, root, parts }) => {
    const label = directory && labels.get(directory);
    return { folders: label ? [label, ...parts] : parts, directory, root, label };
  });
}

/** Folder names for each document, in input order; see placeDocuments.
 * @param {Array<{ project: string, path?: string }>} documents @param {PlacedDirectory[]} directories @returns {string[][]} */
export function documentFolders(documents, directories) {
  return placeDocuments(documents, directories).map(entry => entry.folders);
}

/** The same preview/commit API is used by the Obsidian modal and loopback web interface. */
export async function prepareAddition({ shelfPath, base = path.dirname(shelfPath), roots, sources, project = '', title = '', relativeOnly = false }) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 100 || sources.some(source => typeof source !== 'string' || !source.trim() || source.length > 8192 || source.includes('\0'))) throw new Error('Enter up to 100 file or folder paths, one per line.');
  if (typeof project !== 'string' || project.length > 300 || typeof title !== 'string' || title.length > 300) throw new Error('Names must be at most 300 characters.');
  const { shelfFile, baseline, config } = await readRegistration(shelfPath, roots);
  const existing = await expandShelf(config, base, roots, { relativeOnly, allowUnavailable: true });
  const files = new Set(await Promise.all(existing.artifacts.filter(entry => typeof entry.source === 'string' && !/^https?:/.test(entry.source)).map(entry => realpath(path.resolve(base, entry.source)).catch(() => path.resolve(base, entry.source)))));
  const folders = new Set(existing.directories.map(directory => directory.canonicalPath || directory.sourcePath));
  const selected = [];
  for (const input of sources) {
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !path.isAbsolute(input) || input.startsWith('//') || input.startsWith('\\\\')) throw new Error('Enter a local file or folder path.');
    const sourcePath = path.resolve(base, input.trim());
    const canonical = await checkedPath(sourcePath, roots);
    const stats = await stat(canonical);
    const source = portable(path.relative(base, sourcePath)) || '.';
    const label = project.trim() || path.basename(stats.isDirectory() ? sourcePath : path.dirname(sourcePath));
    selected.push([source, canonical, stats.dev, stats.ino]);
    if (stats.isDirectory()) {
      if (folders.has(canonical)) continue;
      const id = `${slug(path.basename(sourcePath))}-${digest(source).slice(0, 12)}`;
      if (config.directories.some(entry => entry.id === id)) throw new Error('Another folder already uses this ID.');
      config.directories.push({ id, source, project: label, recursive: true, exclude: [] });
      config.version = 2; folders.add(canonical);
    } else {
      if (!stats.isFile() || !regularDocument(sourcePath)) throw new Error('Choose Markdown or HTML files, or folders containing them.');
      if (files.has(canonical)) continue;
      const inferred = await titleFor(sourcePath, roots);
      const route = `files/${slug(source)}-${digest(source).slice(0, 16)}.html`;
      if (config.artifacts.some(entry => entry.route === route)) throw new Error('Another document already uses this route.');
      config.artifacts.push({ source, route, title: sources.length === 1 && title.trim() || inferred, project: label });
      files.add(canonical);
    }
  }
  if (config.version === 1) delete config.directories;
  const expanded = await expandShelf(config, base, roots, { relativeOnly, allowUnavailable: true });
  const identity = async entry => /^https?:/i.test(entry.source) ? normalizedSource(entry.source) : realpath(path.resolve(base, entry.source)).catch(() => path.resolve(base, entry.source));
  const old = new Map(await Promise.all(existing.artifacts.map(async entry => [await identity(entry), entry])));
  const documents = [];
  const moved = [];
  const changedEntries = [];
  for (const entry of expanded.artifacts) {
    const previous = old.get(await identity(entry));
    const { title, source, project } = entry;
    if (!previous) documents.push({ title, source, project });
    else if (previous.route !== entry.route || previous.project !== project) moved.push({ title, source, project, previousProject: previous.project });
    else continue;
    changedEntries.push(entry);
  }
  const revision = digest(JSON.stringify([baseline, selected, config, changedEntries]));
  return { config, baseline, shelfFile, revision, documents, moved, foldersAdded: expanded.directories.length - existing.directories.length, warnings: expanded.warnings };
}

export async function addToShelf(options, expectedRevision) {
  const prepared = await prepareAddition(options);
  if (prepared.revision !== expectedRevision) throw new Error('The shelf or selected paths changed. Preview again before adding.');
  return commitAddition(prepared);
}

/** Commit a freshly prepared addition immediately; delayed previews use addToShelf to revalidate. */
export async function commitAddition(prepared) {
  await commitRegistration(prepared, 'The shelf changed. Preview again before adding.');
  return { documentsAdded: prepared.documents.length, documentsMoved: prepared.moved.length, foldersAdded: prepared.foldersAdded };
}

/** Remove registrations only; exclude the exact source from every overlapping watched folder. */
export async function prepareRemoval({ shelfPath, base = path.dirname(shelfPath), roots, route, source: expectedSource, relativeOnly = false }) {
  if (typeof route !== 'string' || !route || route.length > 8192 || expectedSource !== undefined && (typeof expectedSource !== 'string' || !expectedSource || expectedSource.length > 8192)) throw new Error('Choose a registered document to remove.');
  const { shelfFile, baseline, config } = await readRegistration(shelfPath, roots);
  const expanded = await expandShelf(config, base, roots, { relativeOnly, allowUnavailable: true });
  const artifact = expanded.artifacts.find(entry => entry.route === route);
  if (!artifact || expectedSource !== undefined && normalizedSource(artifact.source) !== normalizedSource(expectedSource)) throw new Error('This document changed or is no longer on the shelf. Close this dialog and try again.');
  const { canonical, changed } = await withoutDocuments(config, expanded.directories, base, [artifact]);
  const revision = digest(JSON.stringify([baseline, artifact, canonical, config]));
  return { shelfFile, baseline, config, revision, title: artifact.title, foldersExcluded: changed.size };
}

export async function removeFromShelf(options, expectedRevision) {
  const prepared = await prepareRemoval(options);
  if (prepared.revision !== expectedRevision) throw new Error('The shelf or document changed. Close this dialog and try again.');
  await commitRegistration(prepared, 'The shelf changed. Close this dialog and try again.');
  return { removed: true };
}

/** Remove a project's folders and every document listed under it; other projects' folders exclude those exact sources. */
export async function prepareProjectRemoval({ shelfPath, base = path.dirname(shelfPath), roots, project, relativeOnly = false }) {
  if (typeof project !== 'string' || !project.trim() || project.length > 8192) throw new Error('Choose a project to remove.');
  const name = project.trim();
  const { shelfFile, baseline, config } = await readRegistration(shelfPath, roots);
  const expanded = await expandShelf(config, base, roots, { relativeOnly, allowUnavailable: true });
  // Apps trim labels before grouping, so match the heading the same way.
  const documents = expanded.artifacts.filter(entry => typeof entry?.project === 'string' && entry.project.trim() === name);
  const folders = expanded.directories.filter(entry => entry.project === name).length;
  if (!documents.length && !folders) throw new Error('This project changed or is no longer on the shelf. Close this dialog and try again.');
  config.directories = config.directories.filter(entry => entry.project !== name);
  // Keep files added later to a removed folder off the other projects' folders too.
  const removedRoots = expanded.directories.filter(entry => entry.project === name).map(entry => entry.canonicalPath || entry.sourcePath);
  const excluded = excludeFolders(config, expanded.directories, removedRoots);
  const { canonical, changed } = await withoutDocuments(config, expanded.directories, base, documents);
  const revision = digest(JSON.stringify([baseline, name, documents, canonical, config]));
  return { shelfFile, baseline, config, revision, title: name, documents: documents.length, folders, foldersExcluded: new Set([...excluded, ...changed]).size };
}

export async function removeProjectFromShelf(options, expectedRevision) {
  const prepared = await prepareProjectRemoval(options);
  if (prepared.revision !== expectedRevision) throw new Error('The shelf or project changed. Close this dialog and try again.');
  await commitRegistration(prepared, 'The shelf changed. Close this dialog and try again.');
  return { removed: true };
}

/** Remove one folder row: this project's documents listed under it and its folders inside it. Every folder still
 * registered that contains it, whatever its project, excludes it so files added there later stay off the shelf too. */
export async function prepareFolderRemoval({ shelfPath, base = path.dirname(shelfPath), roots, project, folder, relativeOnly = false }) {
  if (typeof project !== 'string' || !project.trim() || project.length > 8192 || !Array.isArray(folder) || !folder.length || folder.length > 64 || folder.some(part => typeof part !== 'string' || !part || part.length > 8192 || part.includes('\0'))) throw new Error('Choose a folder to remove.');
  const name = project.trim();
  const { shelfFile, baseline, config } = await readRegistration(shelfPath, roots);
  const expanded = await expandShelf(config, base, roots, { relativeOnly, allowUnavailable: true });
  const local = await Promise.all(expanded.artifacts.map(async entry => {
    if (typeof entry?.source !== 'string' || /^https?:/i.test(entry.source)) return undefined;
    const source = path.resolve(base, entry.source);
    return realpath(source).catch(() => source);
  }));
  const placed = placeDocuments(expanded.artifacts.map((entry, index) => ({ project: typeof entry?.project === 'string' ? entry.project : '', path: local[index] })), expanded.directories);
  const key = JSON.stringify(folder);
  const listed = placed.flatMap((entry, index) => entry.root && entry.directory?.project === name && JSON.stringify(entry.folders.slice(0, folder.length)) === key ? [index] : []);
  const first = placed[listed[0]];
  if (!first?.root) throw new Error('This folder changed or is no longer on the shelf. Close this dialog and try again.');
  const target = path.join(first.root, ...folder.slice(first.label ? 1 : 0));
  const documents = listed.map(index => expanded.artifacts[index]);
  const inside = new Set(expanded.directories.filter(entry => entry.project === name && within(target, entry.canonicalPath || entry.sourcePath)).map(entry => entry.id));
  config.directories = config.directories.filter(entry => !inside.has(entry.id));
  const excluded = excludeFolders(config, expanded.directories, [target]);
  const { canonical, changed } = await withoutDocuments(config, expanded.directories, base, documents);
  const revision = digest(JSON.stringify([baseline, name, folder, target, documents, canonical, config]));
  return { shelfFile, baseline, config, revision, title: folder.join('/'), documents: documents.length, folders: inside.size, foldersExcluded: new Set([...excluded, ...changed]).size };
}

export async function removeFolderFromShelf(options, expectedRevision) {
  const prepared = await prepareFolderRemoval(options);
  if (prepared.revision !== expectedRevision) throw new Error('The shelf or folder changed. Close this dialog and try again.');
  await commitRegistration(prepared, 'The shelf changed. Close this dialog and try again.');
  return { removed: true };
}

/** Exclude each removed folder, by exact path, from every registered folder that strictly contains it.
 * @returns {Set<string>} IDs of the folders that gained an exclusion. */
function excludeFolders(config, directories, removed) {
  const changed = new Set();
  for (const directory of directories) {
    const registration = config.directories.find(entry => entry.id === directory.id);
    if (!registration?.recursive) continue;
    const root = directory.canonicalPath || directory.sourcePath;
    for (const folder of removed) {
      const relative = portable(path.relative(root, folder));
      if (!relative || !within(root, folder) || excludedPath(relative, registration.exclude)) continue;
      registration.exclude.push(`./${relative}`);
      changed.add(registration.id);
    }
  }
  return changed;
}

/** Drop explicit registrations of the removed documents, then exclude their exact sources from every folder still registered. */
async function withoutDocuments(config, directories, base, removed) {
  const routes = new Set();
  const canonical = [];
  for (const artifact of removed) {
    const source = normalizedSource(artifact.source);
    const sourcePath = path.resolve(base, source);
    if (/^https?:/i.test(source)) routes.add(artifact.route);
    else canonical.push(await realpath(sourcePath).catch(error => { if (unavailable(error)) return sourcePath; throw error; }));
  }
  const files = new Set(canonical);
  const keep = [];
  for (const entry of config.artifacts) {
    const same = routes.has(entry.route) || files.size > 0 && !/^https?:/i.test(entry.source) && files.has(await realpath(path.resolve(base, entry.source)).catch(() => path.resolve(base, entry.source)));
    if (!same) keep.push(entry);
  }
  config.artifacts = keep;
  const changed = new Set();
  for (const directory of directories) {
    const registration = config.directories.find(entry => entry.id === directory.id);
    if (!registration) continue;
    const root = directory.canonicalPath || directory.sourcePath;
    for (const file of files) {
      const relative = portable(path.relative(root, file));
      if (!relative || !within(root, file) || !registration.recursive && relative.includes('/') || excludedPath(relative, registration.exclude)) continue;
      registration.exclude.push(`./${relative}`);
      changed.add(registration.id);
    }
  }
  if (config.version === 1) delete config.directories;
  shelfConfig(config); // Validate generated exclusions before offering confirmation.
  return { canonical, changed };
}

async function commitRegistration(prepared, changedMessage) {
  const serialized = `${JSON.stringify(prepared.config, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error('Shelf exceeds the 2 MB limit.');
  // A cooperative lock serializes both apps; compare the original again before replacing the shelf.
  const lock = await acquireRegistrationLock(prepared.shelfFile);
  const temporary = path.join(path.dirname(prepared.shelfFile), `.${path.basename(prepared.shelfFile)}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    const current = await readFile(prepared.shelfFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (current !== prepared.baseline) throw new Error(changedMessage);
    const output = await open(temporary, 'wx', 0o600);
    try { await output.writeFile(serialized); await output.sync(); } finally { await output.close(); }
    const latest = await readFile(prepared.shelfFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (latest !== prepared.baseline) throw new Error(changedMessage);
    await rename(temporary, prepared.shelfFile);
  } finally {
    await unlink(temporary).catch(() => {});
    lock.release();
  }
}

/** Revalidate membership synchronously immediately before native editor reads/writes. */
export function assertRegisteredSource(shelfPath, artifact, roots) {
  const canonical = realpathSync(shelfPath);
  if (!roots.some(root => within(root, canonical))) throw new Error('Shelf is outside the configured workspace.');
  const handle = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let config;
  try {
    const info = fstatSync(handle);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Shelf is unavailable or exceeds 2 MB.');
    config = shelfConfig(JSON.parse(readFileSync(handle, 'utf8')));
  } finally { closeSync(handle); }
  const base = path.dirname(shelfPath);
  const explicit = config.artifacts.find(entry => entry?.route === artifact.route);
  if (explicit && path.resolve(base, explicit.source) === artifact.sourcePath) return;
  if (!artifact.directoryId || explicit) throw new Error('This Markdown source is no longer registered. Your edits have been kept.');
  const directory = config.directories.find(entry => entry.id === artifact.directoryId);
  if (!directory) throw new Error('This folder is no longer registered. Your edits have been kept.');
  const root = path.resolve(base, directory.source);
  const relative = portable(path.relative(root, artifact.sourcePath));
  if (!relative || !within(root, artifact.sourcePath) || excludedPath(relative, directory.exclude) || !directory.recursive && relative.includes('/') || realpathSync(root) !== artifact.discoveryRoot) throw new Error('This source is no longer included in its folder. Your edits have been kept.');
}
