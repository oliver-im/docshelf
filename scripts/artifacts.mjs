import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pagefind from 'pagefind';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const atlasRoot = path.resolve(scriptsDirectory, '..');
const workspaceRoot = path.resolve(atlasRoot, '..');
export const defaultManifestPath = path.join(atlasRoot, 'artifacts.json');
export const localManifestPath = path.join(atlasRoot, 'artifacts.local.json');
const generatedRoot = path.join(atlasRoot, 'public', 'artifacts');
const generatedManifestPath = path.join(atlasRoot, 'src', 'generated', 'artifacts.json');

/**
 * @typedef {object} Artifact
 * @property {string} project
 * @property {string} source
 * @property {string} route
 * @property {string} title
 * @property {string} description
 * @property {string} sourcePath
 */

/**
 * @typedef {object} ArtifactManifest
 * @property {1} version
 * @property {Artifact[]} artifacts
 */

/** @returns {Promise<ArtifactManifest>} */
export async function loadArtifactManifest() {
  const localManifestStats = await stat(localManifestPath).catch(() => null);
  const manifestPath = localManifestStats ? localManifestPath : defaultManifestPath;
  const contents = await readFile(manifestPath, 'utf8');
  /** @type {unknown} */
  let parsed;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Could not parse ${manifestPath}`, { cause: error });
  }

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.artifacts)) {
    throw new Error(`${path.basename(manifestPath)} must contain version 1 and an artifacts array.`);
  }

  const routes = new Set();
  const sources = new Set();
  /** @type {Artifact[]} */
  const artifacts = [];

  for (const [index, entry] of parsed.artifacts.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Artifact ${index + 1} must be an object.`);
    }

    const project = requiredString(entry, 'project', index);
    const source = requiredString(entry, 'source', index);
    const route = requiredString(entry, 'route', index);
    const title = requiredString(entry, 'title', index);
    const description = requiredString(entry, 'description', index);

    validateSource(source, index);
    validateRoute(route, index);

    if (routes.has(route)) {
      throw new Error(`Artifact ${index + 1} duplicates route ${route}.`);
    }

    const sourcePath = path.resolve(atlasRoot, source);
    const resolvedSource = await realpath(sourcePath).catch(() => null);

    if (!resolvedSource) {
      throw new Error(`Artifact ${index + 1} source does not exist: ${source}`);
    }

    const sourceStats = await stat(resolvedSource);
    if (!sourceStats.isFile()) {
      throw new Error(`Artifact ${index + 1} source is not a file: ${source}`);
    }

    if (!isWithin(workspaceRoot, resolvedSource)) {
      throw new Error(`Artifact ${index + 1} source is outside the hhe workspace: ${source}`);
    }

    if (sources.has(resolvedSource)) {
      throw new Error(`Artifact ${index + 1} duplicates source ${source}.`);
    }

    routes.add(route);
    sources.add(resolvedSource);
    artifacts.push({ project, source, route, title, description, sourcePath: resolvedSource });
  }

  return { version: 1, artifacts };
}

/** @param {Artifact} artifact */
export function artifactUrl(artifact) {
  return `/artifacts/${artifact.route}`;
}

/** @param {ArtifactManifest} manifest */
export async function syncArtifacts(manifest) {
  const publicRoot = path.join(atlasRoot, 'public');
  const stagingRoot = path.join(publicRoot, `.artifacts-${process.pid}.tmp`);

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  try {
    for (const artifact of manifest.artifacts) {
      const destination = path.join(stagingRoot, ...artifact.route.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      const target = path.relative(path.dirname(destination), artifact.sourcePath);
      await symlink(target, destination, 'file');
    }

    await assertSymlinkTree(generatedRoot);
    await rm(generatedRoot, { recursive: true, force: true });
    await rename(stagingRoot, generatedRoot);
    await writeGeneratedManifest(manifest);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

/** @param {ArtifactManifest} manifest */
async function writeGeneratedManifest(manifest) {
  const generatedManifest = {
    version: manifest.version,
    artifacts: manifest.artifacts.map(({ project, route, title, description }) => ({
      project,
      route,
      title,
      description,
    })),
  };

  await mkdir(path.dirname(generatedManifestPath), { recursive: true });
  await writeFile(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);
}

/**
 * Inject Pagefind's content marker into generated build output without changing
 * the source artifacts owned by other projects.
 *
 * @param {ArtifactManifest} manifest
 */
export function artifactBuildIntegration(manifest) {
  return {
    name: 'atlas-artifacts',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const outputRoot = fileURLToPath(dir);

        for (const artifact of manifest.artifacts) {
          const outputPath = path.join(outputRoot, 'artifacts', ...artifact.route.split('/'));
          const html = await readFile(outputPath, 'utf8');

          if (html.includes('data-pagefind-body')) continue;
          if (!/<body(?:\s|>)/i.test(html)) {
            throw new Error(`Cannot mark artifact for search because it has no body: ${artifact.route}`);
          }

          const searchableHtml = html.replace(/<body(?=\s|>)/i, '<body data-pagefind-body');
          await writeFile(outputPath, searchableHtml);
        }
      },
    },
  };
}

export function artifactSearchIntegration() {
  return {
    name: 'atlas-artifact-search',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const outputRoot = fileURLToPath(dir);
        const searchOutput = path.join(outputRoot, 'pagefind');

        try {
          const response = await pagefind.createIndex({ forceLanguage: 'en' });
          if (!response.index || response.errors.length > 0) {
            throw new Error(response.errors.join('\n') || 'Pagefind did not create an index.');
          }

          const indexed = await response.index.addDirectory({ path: outputRoot });
          if (indexed.errors.length > 0) {
            throw new Error(indexed.errors.join('\n'));
          }

          await rm(searchOutput, { recursive: true, force: true });
          const written = await response.index.writeFiles({ outputPath: searchOutput });
          if (written.errors.length > 0) {
            throw new Error(written.errors.join('\n'));
          }

          logger.info(`Built one search index for ${indexed.page_count ?? 0} HTML files.`);
        } finally {
          await pagefind.close();
        }
      },
    },
  };
}

/** @param {string} root */
async function assertSymlinkTree(root) {
  const rootStats = await lstat(root).catch(() => null);
  if (!rootStats) return;
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${root} must be a generated directory.`);
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      await assertSymlinkTree(entryPath);
      continue;
    }

    if (!entry.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink content in ${generatedRoot}: ${entryPath}`);
    }
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} key
 * @param {number} index
 */
function requiredString(entry, key, index) {
  const value = entry[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Artifact ${index + 1} requires a non-empty ${key}.`);
  }
  return value;
}

/** @param {string} source @param {number} index */
function validateSource(source, index) {
  if (path.isAbsolute(source)) {
    throw new Error(`Artifact ${index + 1} source must be relative to Atlas.`);
  }
  if (path.extname(source).toLowerCase() !== '.html') {
    throw new Error(`Artifact ${index + 1} source must be an HTML file.`);
  }
}

/** @param {string} route @param {number} index */
function validateRoute(route, index) {
  if (route.startsWith('/') || route.includes('\\')) {
    throw new Error(`Artifact ${index + 1} route must be relative and use forward slashes.`);
  }

  const segments = route.split('/');
  if (
    segments.some((segment) => !/^[a-z0-9][a-z0-9._-]*$/.test(segment)) ||
    path.posix.normalize(route) !== route ||
    !route.endsWith('.html')
  ) {
    throw new Error(`Artifact ${index + 1} has an invalid route: ${route}`);
  }
}

/** @param {string} root @param {string} candidate */
function isWithin(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath !== '' && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..';
}
