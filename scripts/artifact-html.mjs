import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse, serialize } from 'parse5';

export const artifactRevisionFile = '.docshelf-revisions.json';

/**
 * Rewrite links whose source-relative target is another registered artifact.
 * Only the generated DocShelf copy is changed.
 *
 * @param {string} html
 * @param {import('./artifacts.mjs').Artifact} artifact
 * @param {import('./artifacts.mjs').ArtifactManifest} manifest
 */
export async function rewriteArtifactLinks(html, artifact, manifest) {
  const artifactsBySource = new Map(
    manifest.artifacts.map((candidate) => [candidate.sourcePath, candidate]),
  );
  const document = parse(html);
  const links = [];
  collectLinks(document, links);

  for (const link of links) {
    const hrefAttribute = link.attrs.find((attribute) => attribute.name === 'href');
    if (!hrefAttribute) continue;

    const reference = splitLocalReference(hrefAttribute.value);
    if (!reference) continue;

    const target = await registeredTarget(
      artifact.sourcePath,
      reference.path,
      artifactsBySource,
    );
    if (!target) continue;

    hrefAttribute.value = artifactViewerUrl(target.route, reference.query, reference.hash);
    setAttribute(link, 'data-docshelf-artifact', target.route);

    const targetAttribute = link.attrs.find((attribute) => attribute.name === 'target');
    if (!targetAttribute) {
      link.attrs.push({ name: 'target', value: '_top' });
    } else if (targetAttribute.value.toLowerCase() === '_self') {
      targetAttribute.value = '_top';
    }
  }

  return serialize(document);
}

/** @param {string | Buffer} contents */
export function contentRevision(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * @param {string} route
 * @param {string} query Query without its leading question mark.
 * @param {string} hash Hash including its leading number sign.
 */
export function artifactViewerUrl(route, query = '', hash = '') {
  const parameters = new URLSearchParams({ artifact: route });
  if (query) parameters.set('artifact-query', query);
  return `/?${parameters}${hash}`;
}

/** @param {unknown} node @param {Array<{ attrs: Array<{ name: string, value: string }> }>} links */
function collectLinks(node, links) {
  if (!node || typeof node !== 'object') return;
  if (node.tagName === 'a' && Array.isArray(node.attrs)) links.push(node);
  if (!Array.isArray(node.childNodes)) return;
  for (const child of node.childNodes) collectLinks(child, links);
}

/**
 * @param {string} sourcePath
 * @param {string} referencePath
 * @param {Map<string, import('./artifacts.mjs').Artifact>} artifactsBySource
 */
async function registeredTarget(sourcePath, referencePath, artifactsBySource) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(referencePath);
  } catch {
    return null;
  }

  const candidatePath = decodedPath
    ? path.resolve(path.dirname(sourcePath), decodedPath)
    : sourcePath;
  const directTarget = artifactsBySource.get(candidatePath);
  if (directTarget) return directTarget;

  const resolvedTarget = await realpath(candidatePath).catch(() => null);
  return resolvedTarget ? artifactsBySource.get(resolvedTarget) || null : null;
}

/** @param {string} href */
function splitLocalReference(href) {
  if (
    !href ||
    href.startsWith('#') ||
    href.startsWith('/') ||
    href.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return null;
  }

  const hashIndex = href.indexOf('#');
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');

  return {
    path: queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex),
    query: queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1),
    hash,
  };
}

/** @param {{ attrs: Array<{ name: string, value: string }> }} node */
function setAttribute(node, name, value) {
  const attribute = node.attrs.find((candidate) => candidate.name === name);
  if (attribute) {
    attribute.value = value;
  } else {
    node.attrs.push({ name, value });
  }
}
