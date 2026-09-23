import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment, serialize } from 'parse5';
import { sitePath } from './site-path.mjs';
import { createViewerLocation } from '@docshelf/core/links';

export const artifactRevisionFile = '.docshelf-revisions.json';
const defaultPublicRoot = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * Rewrite registered document links, external link targets, and references to
 * images already published by DocShelf's public directory.
 * Only the generated DocShelf copy is changed.
 *
 * @param {string} html
 * @param {import('./artifacts.mjs').Artifact} artifact
 * @param {import('./artifacts.mjs').Shelf} shelf
 * @param {{ basePath?: string, publicRoot?: string }} [options]
 */
export async function rewriteArtifactLinks(html, artifact, shelf, options = {}) {
  if (!artifact.sourcePath) return html;

  const artifactsBySource = new Map(
    shelf.artifacts.flatMap((candidate) =>
      candidate.sourcePath ? [[candidate.sourcePath, candidate]] : [],
    ),
  );
  const document = parse(html);
  const links = [];
  collectElements(document, 'a', links);

  for (const link of links) {
    const hrefAttribute = link.attrs.find((attribute) => attribute.name === 'href');
    if (!hrefAttribute) continue;

    // Ordinary website links must leave the document frame. Keep authored
    // top-level or named targets, and preserve the browser's native link behavior.
    if (/^(?:https?:)?\/\//i.test(hrefAttribute.value.trim())) {
      const target = link.attrs.find((attribute) => attribute.name === 'target')?.value.toLowerCase();
      if (!target || target === '_self' || target === '_blank') {
        setAttribute(link, 'target', '_blank');
        const rel = link.attrs.find((attribute) => attribute.name === 'rel')?.value || '';
        const tokens = rel.split(/\s+/).filter((token) => token && token.toLowerCase() !== 'opener');
        setAttribute(link, 'rel', [...new Set([...tokens, 'noopener', 'noreferrer'])].join(' '));
      }
      continue;
    }

    const reference = splitLocalReference(hrefAttribute.value);
    if (!reference) continue;

    const target = await registeredTarget(
      artifact.sourcePath,
      reference.path,
      artifactsBySource,
    );
    if (!target) continue;

    hrefAttribute.value = artifactViewerUrl(
      target.route,
      reference.query,
      reference.hash,
      options.basePath,
    );
    setAttribute(link, 'data-docshelf-artifact', target.route);

    const targetAttribute = link.attrs.find((attribute) => attribute.name === 'target');
    if (!targetAttribute) {
      link.attrs.push({ name: 'target', value: '_top' });
    } else if (targetAttribute.value.toLowerCase() === '_self') {
      targetAttribute.value = '_top';
    }
  }

  const images = [];
  collectElements(document, 'img', images);
  if (images.length > 0) {
    const publicRoot = path.resolve(options.publicRoot || defaultPublicRoot);
    const resolvedPublicRoot = await realpath(publicRoot).catch(() => null);
    for (const image of images) {
      const src = image.attrs.find((attribute) => attribute.name === 'src');
      const reference = src && splitLocalReference(src.value);
      if (!reference || !resolvedPublicRoot) continue;
      let candidate;
      try {
        candidate = path.resolve(path.dirname(artifact.sourcePath), decodeURIComponent(reference.path));
      } catch {
        continue;
      }
      if (!isWithin(publicRoot, candidate)) continue;
      const resolvedImage = await realpath(candidate).catch(() => null);
      if (!resolvedImage || !isWithin(resolvedPublicRoot, resolvedImage)) continue;
      if (!(await stat(resolvedImage).catch(() => null))?.isFile()) continue;

      // Only rebase files already served as public assets. Never copy or expose
      // neighboring project images, including through a public symlink.
      const assetPath = path.relative(publicRoot, candidate).split(path.sep).map(encodeURIComponent).join('/');
      src.value = sitePath(`/${assetPath}`, options.basePath) +
        (reference.query ? `?${reference.query}` : '') + reference.hash;
    }
  }

  if (artifact.format === 'html') {
    const htmlFrameBridge = await readFile(new URL('../src/lib/html-frame-bridge.js', import.meta.url), 'utf8');
    const head = document.childNodes.find(node => node.tagName === 'html')?.childNodes.find(node => node.tagName === 'head');
    if (head) {
      const bridge = parseFragment(`<script>${htmlFrameBridge}</script>`).childNodes[0];
      bridge.parentNode = head;
      head.childNodes.unshift(bridge);
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
 * @param {string} [basePath]
 */
export function artifactViewerUrl(route, query = '', hash = '', basePath = '/') {
  return `${sitePath('/', basePath)}${createViewerLocation(route, query, hash)}`;
}

/** @param {unknown} node @param {string} tagName @param {Array<{ attrs: Array<{ name: string, value: string }> }>} elements */
function collectElements(node, tagName, elements) {
  if (!node || typeof node !== 'object') return;
  if (node.tagName === tagName && Array.isArray(node.attrs)) elements.push(node);
  if (!Array.isArray(node.childNodes)) return;
  for (const child of node.childNodes) collectElements(child, tagName, elements);
}

/** @param {string} root @param {string} candidate */
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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
