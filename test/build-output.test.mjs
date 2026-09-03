import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { contentRevision } from '../scripts/artifact-html.mjs';
import {
  assembleIncrementalBuild,
  patchViewerRevisions,
  siteInputsSignature,
  viewerFrameUrl,
  viewerRevisionParameter,
} from '../scripts/build-output.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

const route = 'example/report.html';
const catalogRevision = 'c'.repeat(64);

test('the viewer component and the incremental build agree on frame URLs', async () => {
  const component = await readFile(
    new URL('../src/components/ArtifactViewer.astro', import.meta.url),
    'utf8',
  );

  assert.equal(viewerRevisionParameter, '__docshelf_revision');
  assert.match(component, /const revisionParameter = '__docshelf_revision'/);
  assert.match(
    component,
    /`\/artifacts\/\$\{initialArtifact\.route\}\?__docshelf_revision=\$\{initialArtifact\.revision\}`/,
  );
});

test('patching the viewer updates the embedded revisions and the initial frame only', () => {
  const before = artifact('1'.repeat(64));
  const after = artifact('2'.repeat(64));
  const html = patchViewerRevisions(viewerPage([before]), {
    catalogRevision,
    artifacts: [after],
  });

  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes(`data-artifacts="${escapeAttribute(JSON.stringify([after]))}"`));
  assert.ok(html.includes(`data-catalog-revision="${catalogRevision}"`));
  assert.ok(html.includes(`data-artifact-revision="${after.revision}"`));
  assert.ok(html.includes(`src="${escapeAttribute(viewerFrameUrl(after))}"`));
  assert.ok(html.includes(`data-artifact-url="${escapeAttribute(viewerFrameUrl(after))}"`));
  assert.doesNotMatch(html, new RegExp(before.revision));
  assert.ok(html.includes('data-frame-state="standby" data-frame-ready="false" data-artifact-route=""'));
  assert.ok(html.includes('<script>const guard = "<not html>" && 1 < 2;</script>'));
  assert.ok(html.includes('<a href="/artifacts/example/report.html">Report &amp; findings</a>'));
});

test('patching refuses pages that do not match the catalog', () => {
  const current = artifact('3'.repeat(64));
  const manifest = { catalogRevision, artifacts: [current] };

  assert.throws(
    () => patchViewerRevisions('<!DOCTYPE html><html><body><p>Not DocShelf</p></body></html>', manifest),
    { message: /no DocShelf viewer/ },
  );
  assert.throws(
    () => patchViewerRevisions('<!DOCTYPE html><div data-docshelf-viewer></div>', manifest),
    { message: /no active document frame/ },
  );
  assert.throws(
    () => patchViewerRevisions(viewerPage([{ ...current, route: 'example/other.html' }]), manifest),
    { message: /different initial artifact/ },
  );
  assert.throws(
    () => patchViewerRevisions(viewerPage([current]), { catalogRevision, artifacts: [] }),
    { message: /empty catalog/ },
  );

  const empty = patchViewerRevisions(
    '<!DOCTYPE html><div data-docshelf-viewer data-artifacts="[]" data-catalog-revision="old"><div class="empty-state"></div></div>',
    { catalogRevision, artifacts: [] },
  );
  assert.ok(empty.includes(`data-artifacts="[]" data-catalog-revision="${catalogRevision}"`));
});

test('an incremental build reuses the active build and refreshes only the artifacts', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-incremental-');
  const before = artifact(contentRevision('<p>before</p>'));
  const after = artifact(contentRevision('<p>after</p>'));
  const activeBuildRoot = await createBuild(root, 'active', before, '<p>before</p>');
  const oldMtime = new Date('2024-01-02T03:04:05Z');
  await utimes(path.join(activeBuildRoot, '404.html'), oldMtime, oldMtime);
  const { artifactsRoot, generatedManifestPath, revisionState } = await createSync(
    root,
    after,
    '<p>after</p>',
  );
  const buildRoot = path.join(root, 'next');

  await assembleIncrementalBuild({
    activeBuildRoot,
    buildRoot,
    artifactsRoot,
    generatedManifestPath,
    revisionState,
  });

  assert.equal(await readFile(path.join(buildRoot, '_astro', 'app.abc.js'), 'utf8'), 'app();');
  assert.equal(await readFile(path.join(buildRoot, 'sitemap-0.xml'), 'utf8'), '<urlset/>');
  assert.equal(
    (await stat(path.join(buildRoot, '404.html'))).mtime.toISOString(),
    oldMtime.toISOString(),
  );
  assert.equal(await stat(path.join(buildRoot, 'pagefind')).catch(() => null), null);
  const copiedArtifact = path.join(buildRoot, 'artifacts', 'example', 'report.html');
  assert.equal((await lstat(copiedArtifact)).isSymbolicLink(), false);
  assert.equal(await readFile(copiedArtifact, 'utf8'), '<p>after</p>');
  assert.deepEqual(
    JSON.parse(await readFile(path.join(buildRoot, 'artifacts', '.docshelf-revisions.json'), 'utf8')),
    revisionState,
  );
  const index = await readFile(path.join(buildRoot, 'index.html'), 'utf8');
  assert.ok(index.includes(`src="${escapeAttribute(viewerFrameUrl(after))}"`));
  assert.doesNotMatch(index, new RegExp(before.revision));
  assert.match(await readFile(path.join(activeBuildRoot, 'index.html'), 'utf8'), new RegExp(before.revision));
  assert.equal(
    await readFile(path.join(activeBuildRoot, 'artifacts', 'example', 'report.html'), 'utf8'),
    '<p>before</p>',
  );
});

test('an incremental build refuses artifacts that do not match the synchronized state', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-incremental-');
  const before = artifact(contentRevision('<p>before</p>'));
  const claimed = artifact(contentRevision('<p>claimed</p>'));
  const activeBuildRoot = await createBuild(root, 'active', before, '<p>before</p>');
  const sync = await createSync(root, claimed, '<p>actual</p>');

  await assert.rejects(
    assembleIncrementalBuild({
      activeBuildRoot,
      buildRoot: path.join(root, 'mismatch'),
      artifactsRoot: sync.artifactsRoot,
      generatedManifestPath: sync.generatedManifestPath,
      revisionState: sync.revisionState,
    }),
    { message: /does not match its synchronized revision/ },
  );
  await assert.rejects(
    assembleIncrementalBuild({
      activeBuildRoot,
      buildRoot: path.join(root, 'catalog'),
      artifactsRoot: sync.artifactsRoot,
      generatedManifestPath: sync.generatedManifestPath,
      revisionState: { ...sync.revisionState, catalogRevision: 'd'.repeat(64) },
    }),
    { message: /does not match the synchronized catalog/ },
  );
});

test('the site signature follows DocShelf files and ignores generated output', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-site-');
  await mkdir(path.join(root, 'src', 'components'), { recursive: true });
  await mkdir(path.join(root, 'src', 'generated'), { recursive: true });
  await mkdir(path.join(root, 'public', 'artifacts'), { recursive: true });
  await writeFile(path.join(root, 'astro.config.mjs'), 'export default {};\n');
  await writeFile(path.join(root, 'src', 'components', 'Viewer.astro'), '<div />\n');
  await writeFile(path.join(root, 'src', 'generated', 'artifacts.json'), '{}\n');
  await writeFile(path.join(root, 'public', 'artifacts', 'report.html'), 'v1\n');
  await writeFile(path.join(root, 'public', 'favicon.svg'), '<svg/>\n');
  const initial = await siteInputsSignature(root);

  await writeFile(path.join(root, 'src', 'generated', 'artifacts.json'), '{"changed":true}\n');
  await writeFile(path.join(root, 'public', 'artifacts', 'report.html'), 'v2 longer\n');
  assert.equal(await siteInputsSignature(root), initial);

  await writeFile(path.join(root, 'src', 'components', 'Viewer.astro'), '<div class="x" />\n');
  const edited = await siteInputsSignature(root);
  assert.notEqual(edited, initial);

  await writeFile(path.join(root, 'public', 'theme.css'), 'body {}\n');
  assert.notEqual(await siteInputsSignature(root), edited);
});

test('the site signature hashes contents rather than sizes and timestamps', async (t) => {
  const root = await temporaryDirectory(t, tmpdir(), 'docshelf-site-');
  const stylesPath = path.join(root, 'src', 'styles.css');
  const frozen = new Date('2026-01-01T00:00:00Z');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'public', '.well-known'), { recursive: true });
  await writeFile(stylesPath, 'body { color: red; }\n');
  await utimes(stylesPath, frozen, frozen);
  const initial = await siteInputsSignature(root);
  const before = await stat(stylesPath);

  await writeFile(stylesPath, 'body { color: tan; }\n');
  await utimes(stylesPath, frozen, frozen);
  const after = await stat(stylesPath);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const edited = await siteInputsSignature(root);
  assert.notEqual(edited, initial);

  await writeFile(path.join(root, 'public', '.well-known', 'security.txt'), 'Contact: x\n');
  assert.notEqual(await siteInputsSignature(root), edited);
});

/** @param {string} revision */
function artifact(revision) {
  return {
    project: 'Example',
    route,
    title: 'Report & findings',
    description: 'A report.',
    revision,
  };
}

/** @param {Array<ReturnType<typeof artifact>>} artifacts */
function viewerPage(artifacts) {
  const [initial] = artifacts;
  return `<!DOCTYPE html><html lang="en"><head><title>DocShelf</title></head><body>
<nav><a href="/artifacts/${initial.route}">${initial.title.replace('&', '&amp;')}</a></nav>
<div class="docshelf-viewer astro-x" data-docshelf-viewer data-artifacts="${escapeAttribute(JSON.stringify(artifacts))}" data-catalog-revision="old">
<section class="document-pane">
<iframe data-document-frame data-frame-state="active" data-frame-ready="loading" data-artifact-route="${initial.route}" data-artifact-revision="${initial.revision}" data-artifact-location="" data-artifact-url="${escapeAttribute(viewerFrameUrl(initial))}" src="${escapeAttribute(viewerFrameUrl(initial))}" title="Report"></iframe>
<iframe data-document-frame data-frame-state="standby" data-frame-ready="false" data-artifact-route="" data-artifact-revision="" data-artifact-location="" data-artifact-url="" title="Document preload" aria-hidden="true" tabindex="-1"></iframe>
</section></div>
<script>const guard = "<not html>" && 1 < 2;</script>
</body></html>
`;
}

/** @param {string} value */
function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** @param {ReturnType<typeof artifact>} entry @param {string} html */
function revisionStateFor(entry, html) {
  return {
    version: 1,
    revision: contentRevision(entry.revision),
    catalogRevision,
    artifacts: [{ route: entry.route, revision: entry.revision, sourceRevision: contentRevision(html) }],
  };
}

/** A build root shaped like Astro's output. */
async function createBuild(root, name, entry, html) {
  const buildRoot = path.join(root, name);
  await mkdir(path.join(buildRoot, '_astro'), { recursive: true });
  await mkdir(path.join(buildRoot, 'artifacts', 'example'), { recursive: true });
  await mkdir(path.join(buildRoot, 'pagefind'), { recursive: true });
  await writeFile(path.join(buildRoot, 'index.html'), viewerPage([entry]));
  await writeFile(path.join(buildRoot, '404.html'), '<p>404</p>');
  await writeFile(path.join(buildRoot, 'sitemap-0.xml'), '<urlset/>');
  await writeFile(path.join(buildRoot, '_astro', 'app.abc.js'), 'app();');
  await writeFile(path.join(buildRoot, 'pagefind', 'pagefind.js'), 'old();');
  await writeFile(path.join(buildRoot, 'artifacts', 'example', 'report.html'), html);
  await writeFile(
    path.join(buildRoot, 'artifacts', '.docshelf-revisions.json'),
    `${JSON.stringify(revisionStateFor(entry, html), null, 2)}\n`,
  );
  return buildRoot;
}

/** The synchronized snapshot root, symlink tree, and generated manifest that a sync produces. */
async function createSync(root, entry, html) {
  const snapshotRoot = path.join(root, 'snapshots');
  const artifactsRoot = path.join(root, 'public-artifacts');
  const generatedManifestPath = path.join(root, 'generated', 'artifacts.json');
  const revisionState = revisionStateFor(entry, html);
  await mkdir(path.join(snapshotRoot, 'example'), { recursive: true });
  await mkdir(path.join(artifactsRoot, 'example'), { recursive: true });
  await mkdir(path.dirname(generatedManifestPath), { recursive: true });
  await writeFile(path.join(snapshotRoot, 'example', 'report.html'), html);
  await writeFile(
    path.join(snapshotRoot, '.docshelf-revisions.json'),
    `${JSON.stringify(revisionState, null, 2)}\n`,
  );
  await symlink('../../snapshots/example/report.html', path.join(artifactsRoot, 'example', 'report.html'));
  await symlink('../snapshots/.docshelf-revisions.json', path.join(artifactsRoot, '.docshelf-revisions.json'));
  await writeFile(
    generatedManifestPath,
    `${JSON.stringify({ version: 1, catalogRevision, artifacts: [entry] }, null, 2)}\n`,
  );
  return { artifactsRoot, generatedManifestPath, revisionState };
}
