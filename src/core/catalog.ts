import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalFile, readBoundedFile } from './files';
import { parseClaudeArtifactUrl } from './claude-artifacts.js';
import { parseGitHubMarkdownUrl } from './github-markdown.js';
import { MAX_REMOTE_BYTES, type Artifact, type Catalog, type ShelfEntry } from './types';

export const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function required(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\0')) {
    throw new Error(`Artifact ${index + 1}: ${field} must be a nonempty string.`);
  }
  return value.trim();
}

export function safeRelative(value: string): boolean {
  return value.length > 0 && !/[\\\0?#%:]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'));
}

interface CatalogOptions { allowUnavailableFiles?: boolean }

// Runtime catalogs retain unavailable registrations so healthy documents can
// still refresh and the watcher can detect recovery. Validation stays strict.
async function registeredFile(file: string, roots: string[], options: CatalogOptions): Promise<string | undefined> {
  try { return await canonicalFile(file, roots); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (options.allowUnavailableFiles && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code || '')) return undefined;
    throw error;
  }
}

export async function loadCatalog(shelfPath: string, configuredRoot?: string, options: CatalogOptions = {}): Promise<Catalog> {
  const shelfDirectory = path.dirname(path.resolve(shelfPath));
  const workspace = configuredRoot ? path.resolve(shelfDirectory, configuredRoot) : path.dirname(shelfDirectory);
  const roots = [...new Set(await Promise.all([realpath(shelfDirectory), realpath(workspace)]))];
  for (const root of roots) if (!(await stat(root)).isDirectory()) throw new Error('Workspace must be a directory.');
  const bytes = await readBoundedFile(shelfPath, roots, MAX_REMOTE_BYTES);
  let parsed: { version?: unknown; artifacts?: unknown };
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Shelf is not valid JSON.'); }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.artifacts)) throw new Error('Shelf must contain version 1 and an artifacts array.');
  if (parsed.artifacts.length > 2000) throw new Error('A shelf supports at most 2,000 registered documents.');
  const routes = new Set<string>();
  const sources = new Set<string>();
  const artifacts: Artifact[] = [];
  for (const [index, input] of parsed.artifacts.entries()) {
    if (!input || typeof input !== 'object') throw new Error(`Artifact ${index + 1} must be an object.`);
    const entry: ShelfEntry = {
      project: required(input.project, 'project', index), source: required(input.source, 'source', index),
      route: required(input.route, 'route', index), title: required(input.title, 'title', index),
      description: required(input.description, 'description', index),
    };
    if (!safeRelative(entry.route) || !/\.html$/i.test(entry.route)) throw new Error(`Artifact ${index + 1}: route must be a relative .html path without traversal.`);
    if (routes.has(entry.route)) throw new Error(`Duplicate route: ${entry.route}`);
    routes.add(entry.route);
    const id = createHash('sha256').update(entry.route).digest('hex').slice(0, 24);
    const claude = parseClaudeArtifactUrl(entry.source);
    const github = parseGitHubMarkdownUrl(entry.source);
    let artifact: Artifact;
    let identity: string;
    if (claude) {
      artifact = { ...entry, id, source: claude.publicUrl, kind: 'claude' };
      identity = artifact.source;
    } else if (github) {
      artifact = { ...entry, id, source: github.sourceUrl, kind: 'github', rawUrl: github.rawUrl, linkBaseUrl: github.linkBaseUrl };
      identity = github.rawUrl;
    } else {
      if ((!path.isAbsolute(entry.source) && /^[a-z][a-z\d+.-]*:/i.test(entry.source)) || /^https?:/i.test(entry.source) || entry.source.startsWith('//') || entry.source.startsWith('\\\\')) {
        throw new Error(`Artifact ${index + 1}: only public GitHub Markdown and published Claude Artifact URLs are accepted.`);
      }
      const extension = path.extname(entry.source).toLowerCase();
      if (!['.md', '.markdown', '.html', '.htm'].includes(extension)) throw new Error(`Artifact ${index + 1}: source must be Markdown or HTML.`);
      const sourcePath = path.resolve(shelfDirectory, entry.source);
      const canonicalPath = await registeredFile(sourcePath, roots, options);
      artifact = { ...entry, id, sourcePath, canonicalPath, kind: ['.md', '.markdown'].includes(extension) ? 'markdown' : 'html' };
      identity = canonicalPath || sourcePath;
    }
    if (sources.has(identity)) throw new Error(`Duplicate source: ${entry.source}`);
    sources.add(identity);
    if (input.assets !== undefined) {
      if (!artifact.sourcePath || !Array.isArray(input.assets) || input.assets.length > 500) throw new Error(`Artifact ${index + 1}: assets require a local source and an array of at most 500 paths.`);
      const assets = new Set<string>();
      for (const value of input.assets) {
        if (typeof value !== 'string' || !safeRelative(value) || !ASSET_TYPES[path.extname(value).toLowerCase()]) throw new Error(`Artifact ${index + 1}: invalid asset path.`);
        await registeredFile(path.resolve(path.dirname(artifact.sourcePath), value), roots, options);
        assets.add(value);
      }
      artifact.assets = [...assets];
    }
    artifacts.push(artifact);
  }
  return { shelfPath: path.resolve(shelfPath), roots, artifacts };
}

export function findSource(catalog: Catalog, source: string): Artifact | undefined {
  return catalog.artifacts.find(artifact => artifact.sourcePath === source || artifact.canonicalPath === source || artifact.source === source);
}
