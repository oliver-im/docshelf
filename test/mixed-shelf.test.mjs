import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { docShelfRoot } from '../scripts/artifacts.mjs';
import { artifactRevisionFile, contentRevision } from '../scripts/artifact-html.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

test('mixed shelves sync and pass the build hook without emitting Claude files', async (t) => {
  // Copy the implementation into an isolated checkout so sync cannot touch the
  // developer's registrations, generated output, or running watcher.
  const fixture = await temporaryDirectory(t, path.join(docShelfRoot, '.docshelf-runtime'), 'mixed-shelf-');
  for (const entry of ['scripts', 'src/lib', '.agents/skills/docshelf/assets', 'package.json']) {
    await cp(path.join(docShelfRoot, entry), path.join(fixture, entry), { recursive: true });
  }
  await symlink(path.join(docShelfRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const implementation = await import(pathToFileURL(path.join(fixture, 'scripts/artifacts.mjs')).href);
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
