import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, serialize } from 'parse5';
import { artifactRevisionFile, contentRevision } from './artifact-html.mjs';

/** Query parameter the viewer appends to frame URLs so a changed artifact bypasses the cache. */
export const viewerRevisionParameter = '__docshelf_revision';

/** Build-output directories that an incremental build regenerates instead of reusing. */
const regeneratedDirectories = new Set(['artifacts', 'pagefind']);

/**
 * Files that shape Astro's output besides the artifacts themselves, relative to DocShelf. The
 * generated manifest and symlink tree are excluded because every sync rewrites them.
 */
const siteInputs = ['astro.config.mjs', 'package-lock.json', 'tsconfig.json', 'public', 'scripts', 'src'];
const ignoredSiteInputs = new Set(['public/artifacts', 'src/generated']);

/**
 * Assemble a build root from the active build for a change that left the artifact catalog
 * untouched. Everything Astro produced is reused; the artifact snapshots and revision state come
 * from the freshly synchronized `public/artifacts` tree, and the viewer's embedded revisions are
 * rewritten so the result matches what a full build would have produced. The caller writes the
 * search index afterwards.
 *
 * @param {object} options
 * @param {string} options.activeBuildRoot the build currently being served
 * @param {string} options.buildRoot the new build root to create
 * @param {string} options.artifactsRoot the synchronized `public/artifacts` symlink tree
 * @param {string} options.generatedManifestPath the generated manifest written by the same sync
 * @param {import('./artifacts.mjs').ArtifactRevisionState} options.revisionState
 */
export async function assembleIncrementalBuild({
  activeBuildRoot,
  buildRoot,
  artifactsRoot,
  generatedManifestPath,
  revisionState,
}) {
  const generatedManifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));
  if (generatedManifest.catalogRevision !== revisionState.catalogRevision) {
    throw new Error('The generated manifest does not match the synchronized catalog.');
  }

  await cp(activeBuildRoot, buildRoot, {
    recursive: true,
    preserveTimestamps: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (source) => {
      const [firstSegment] = path.relative(activeBuildRoot, source).split(path.sep);
      return !regeneratedDirectories.has(firstSegment);
    },
  });

  const artifactsOutput = path.join(buildRoot, 'artifacts');
  await mkdir(artifactsOutput, { recursive: true });
  if (await stat(artifactsRoot).catch(() => null)) {
    await cp(artifactsRoot, artifactsOutput, { recursive: true, dereference: true });
  }
  await assertArtifactsMatch(artifactsOutput, revisionState);

  const indexPath = path.join(buildRoot, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, patchViewerRevisions(html, generatedManifest));
}

/**
 * @param {string} artifactsOutput
 * @param {import('./artifacts.mjs').ArtifactRevisionState} revisionState
 */
async function assertArtifactsMatch(artifactsOutput, revisionState) {
  const copiedState = await readFile(path.join(artifactsOutput, artifactRevisionFile), 'utf8').catch(
    () => null,
  );
  if (copiedState === null || JSON.stringify(JSON.parse(copiedState)) !== JSON.stringify(revisionState)) {
    throw new Error('The copied revision state does not match the synchronized artifacts.');
  }

  for (const artifact of revisionState.artifacts) {
    const html = await readFile(path.join(artifactsOutput, ...artifact.route.split('/'))).catch(
      () => null,
    );
    if (!html || contentRevision(html) !== artifact.revision) {
      throw new Error(`Copied artifact does not match its synchronized revision: ${artifact.route}`);
    }
  }
}

/**
 * Rewrite the revisions that the viewer page embeds at build time: the artifact list on the viewer
 * element and the initial document frame's URL. Throws when the page does not look like the
 * DocShelf viewer so a caller can run a full build instead of publishing a mismatch.
 *
 * @param {string} html
 * @param {{ catalogRevision: string, artifacts: Array<{ route: string, revision: string }> }} generatedManifest
 */
export function patchViewerRevisions(html, generatedManifest) {
  const document = parse(html);
  const viewer = findElement(document, (node) => hasAttribute(node, 'data-docshelf-viewer'));
  if (!viewer) throw new Error('The built index.html has no DocShelf viewer.');

  setAttribute(viewer, 'data-artifacts', JSON.stringify(generatedManifest.artifacts));
  setAttribute(viewer, 'data-catalog-revision', generatedManifest.catalogRevision);

  const [initialArtifact] = generatedManifest.artifacts;
  const activeFrame = findElement(
    viewer,
    (node) => node.tagName === 'iframe' && getAttribute(node, 'data-frame-state') === 'active',
  );

  if (!initialArtifact) {
    if (activeFrame) throw new Error('The built index.html shows a document for an empty catalog.');
    return serialize(document);
  }
  if (!activeFrame) throw new Error('The built index.html has no active document frame.');
  if (getAttribute(activeFrame, 'data-artifact-route') !== initialArtifact.route) {
    throw new Error('The built index.html opens a different initial artifact.');
  }

  const frameUrl = viewerFrameUrl(initialArtifact);
  setAttribute(activeFrame, 'data-artifact-revision', initialArtifact.revision);
  setAttribute(activeFrame, 'data-artifact-url', frameUrl);
  setAttribute(activeFrame, 'src', frameUrl);
  return serialize(document);
}

/**
 * The URL the viewer loads for an artifact at build time. ArtifactViewer.astro builds the same URL.
 * @param {{ route: string, revision: string }} artifact
 */
export function viewerFrameUrl(artifact) {
  return `/artifacts/${artifact.route}?${viewerRevisionParameter}=${artifact.revision}`;
}

/**
 * Fingerprint the files that shape Astro's output besides the artifacts. A full build is required
 * whenever it changes; while it is unchanged, a source-only change can reuse the active build.
 *
 * @param {string} docShelfRoot
 */
export async function siteInputsSignature(docShelfRoot) {
  const hash = createHash('sha256');
  for (const input of siteInputs) {
    await hashSiteInput(hash, docShelfRoot, input);
  }
  return hash.digest('hex');
}

/** @param {import('node:crypto').Hash} hash @param {string} docShelfRoot @param {string} input */
async function hashSiteInput(hash, docShelfRoot, input) {
  if (ignoredSiteInputs.has(input) || path.basename(input).startsWith('.')) return;

  const stats = await stat(path.join(docShelfRoot, input)).catch(() => null);
  if (!stats) return;

  if (stats.isDirectory()) {
    const entries = await readdir(path.join(docShelfRoot, input));
    for (const entry of entries.sort()) {
      await hashSiteInput(hash, docShelfRoot, `${input}/${entry}`);
    }
    return;
  }

  hash.update(`${input}\0${stats.size}\0${stats.mtimeMs}\n`);
}

/** @param {unknown} node @param {(node: any) => boolean} matches @returns {any} */
function findElement(node, matches) {
  if (!node || typeof node !== 'object') return null;
  if ('tagName' in node && matches(node)) return node;
  const children = 'childNodes' in node && Array.isArray(node.childNodes) ? node.childNodes : [];
  for (const child of children) {
    const found = findElement(child, matches);
    if (found) return found;
  }
  return null;
}

/** @param {{ attrs: Array<{ name: string, value: string }> }} node @param {string} name */
function hasAttribute(node, name) {
  return Array.isArray(node.attrs) && node.attrs.some((attribute) => attribute.name === name);
}

/** @param {{ attrs: Array<{ name: string, value: string }> }} node @param {string} name */
function getAttribute(node, name) {
  return node.attrs.find((attribute) => attribute.name === name)?.value;
}

/** @param {{ attrs: Array<{ name: string, value: string }> }} node @param {string} name @param {string} value */
function setAttribute(node, name, value) {
  const attribute = node.attrs.find((candidate) => candidate.name === name);
  if (attribute) {
    attribute.value = value;
  } else {
    node.attrs.push({ name, value });
  }
}
