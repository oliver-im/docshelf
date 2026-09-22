import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { docShelfRoot } from '../scripts/artifacts.mjs';
import { artifactRevisionFile, contentRevision } from '../scripts/artifact-html.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

test('mixed shelves sync and pass the build hook without emitting Claude files', async (t) => {
  const { fixture, implementation } = await isolatedArtifacts(t);
  const source = '<!doctype html><html><head><title>Local</title></head><body><h1>Local document</h1><a href="local.html">Self</a></body></html>';
  await writeFile(path.join(fixture, 'local.html'), source);
  const claudeUrl = 'https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc';
  const entries = [
    { project: 'Mixed', source: claudeUrl, route: 'claude/example.html', title: 'Claude', description: 'Remote fixture' },
    { project: 'Mixed', source: 'local.html', route: 'local/example.html', title: 'Local', description: 'Local fixture' },
  ];
  const shelfPath = path.join(fixture, 'shelf.json');
  await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: entries }));
  const shelf = await implementation.loadShelfFrom(shelfPath);
  const revisions = await implementation.syncArtifacts(shelf);
  assert.equal(revisions.artifacts.length, 2);
  assert.equal(revisions.artifacts[0].revision, contentRevision(`${claudeUrl}/embed`));
  assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), true);
  const generated = JSON.parse(await readFile(implementation.generatedShelfPath, 'utf8'));
  assert.equal(generated.artifacts[0].embedUrl, `${claudeUrl}/embed`);
  assert.deepEqual((await readdir(implementation.generatedArtifactsRoot)).sort(), [artifactRevisionFile, 'local'].sort());
  const localOutput = await readFile(path.join(implementation.generatedArtifactsRoot, 'local/example.html'), 'utf8');
  assert.match(localOutput, /data-docshelf-artifact="local\/example.html"/);

  // Astro copies public output before invoking the integration hook.
  const output = path.join(fixture, '.docshelf-runtime/build-test');
  await mkdir(output, { recursive: true });
  await cp(implementation.generatedArtifactsRoot, path.join(output, 'artifacts'), { recursive: true, dereference: true });
  await implementation.artifactBuildIntegration(shelf).hooks['astro:build:done']({ dir: pathToFileURL(`${output}/`) });
  assert.deepEqual((await readdir(path.join(output, 'artifacts'))).sort(), [artifactRevisionFile, 'local'].sort());
  assert.equal(await readFile(path.join(fixture, 'local.html'), 'utf8'), source);
  const repeated = await implementation.syncArtifacts(shelf);
  assert.deepEqual(repeated, revisions);
});

for (const replacement of ['file', 'directory']) {
  test(`sync and revision checks reject a ${replacement} symlink escaping after shelf loading`, async t => {
    const { fixture, implementation } = await isolatedArtifacts(t);
    const outside = await temporaryDirectory(t, tmpdir(), 'docshelf-outside-');
    const source = '<!doctype html><body>Identical bytes cannot authorize a new target</body>';
    await mkdir(path.join(fixture, 'notes'));
    await writeFile(path.join(fixture, 'notes/report.html'), source);
    await writeFile(path.join(outside, 'report.html'), source);
    const shelfPath = path.join(fixture, 'shelf.json');
    await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [
      { project: 'Review', source: 'notes/report.html', route: 'report.html', title: 'Report' },
    ] }));
    const shelf = await implementation.loadShelfFrom(shelfPath, { workspaceRoot: fixture });
    const revisions = await implementation.syncArtifacts(shelf);
    const output = path.join(implementation.generatedArtifactsRoot, 'report.html');
    const before = await readFile(output, 'utf8');
    const replaced = path.join(fixture, replacement === 'file' ? 'notes/report.html' : 'notes');
    await rm(replaced, { recursive: true });
    await symlink(replacement === 'file' ? path.join(outside, 'report.html') : outside, replaced);
    assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), false);
    await assert.rejects(implementation.syncArtifacts(shelf), /outside the workspace/);
    assert.equal(await readFile(output, 'utf8'), before, 'A refused sync must retain the last valid output.');
  });
}

test('sync follows the loaded workspace setting and refuses a stale registered symlink', async t => {
  const { fixture, implementation } = await isolatedArtifacts(t);
  const workspace = await temporaryDirectory(t, tmpdir(), 'docshelf-workspace-');
  const source = '<!doctype html><body>Same bytes, different document</body>';
  for (const name of ['a.html', 'b.html']) await writeFile(path.join(workspace, name), source);
  const registered = path.join(workspace, 'current.html');
  await symlink('a.html', registered);
  const shelfPath = path.join(fixture, 'shelf.json');
  await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [
    { project: 'Review', source: path.relative(fixture, registered), route: 'report.html', title: 'Report' },
  ] }));
  const shelf = await implementation.loadShelfFrom(shelfPath, { workspaceRoot: workspace });
  const revisions = await implementation.syncArtifacts(shelf);
  assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), true);
  await rm(registered);
  await symlink('b.html', registered);
  assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), false);
  await assert.rejects(implementation.syncArtifacts(shelf), /target changed/);
  const refreshed = await implementation.loadShelfFrom(shelfPath, { workspaceRoot: workspace });
  assert.equal(await implementation.artifactSourcesMatch(refreshed, await implementation.syncArtifacts(refreshed)), true);
});

async function isolatedArtifacts(t) {
  // Copy the implementation into an isolated checkout so sync cannot touch the
  // developer's registrations, generated output, or running watcher.
  const fixture = await temporaryDirectory(t, path.join(docShelfRoot, '.docshelf-runtime'), 'mixed-shelf-');
  for (const entry of ['packages/local', 'scripts', 'src/lib', '.agents/skills/docshelf/assets', 'package.json']) {
    await cp(path.join(docShelfRoot, entry), path.join(fixture, entry), { recursive: true });
  }
  await symlink(path.join(docShelfRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const implementation = await import(pathToFileURL(path.join(fixture, 'scripts/artifacts.mjs')).href);
  return { fixture, implementation };
}

test('a folder membership change during a build prevents publishing the stale snapshot', async t => {
  const { fixture, implementation } = await isolatedArtifacts(t);
  await mkdir(path.join(fixture, 'notes'));
  await writeFile(path.join(fixture, 'notes/first.md'), '# First');
  const shelfPath = path.join(fixture, 'shelf.json');
  const config = { version: 2, artifacts: [], directories: [{ id: 'notes', project: 'Notes', source: 'notes' }] };
  await writeFile(shelfPath, JSON.stringify(config));
  const shelf = await implementation.loadShelfFrom(shelfPath);
  const revisions = await implementation.syncArtifacts(shelf);
  assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), true);
  await writeFile(path.join(fixture, 'notes/second.md'), '# Second');
  assert.equal(await implementation.artifactSourcesMatch(shelf, revisions), false);
  const current = await implementation.loadShelfFrom(shelfPath);
  const updated = await implementation.syncArtifacts(current);
  assert.equal(await implementation.artifactSourcesMatch(current, updated), true);
  await writeFile(shelfPath, JSON.stringify({ ...config, directories: [] }));
  assert.equal(await implementation.artifactSourcesMatch(current, updated), false);
});
