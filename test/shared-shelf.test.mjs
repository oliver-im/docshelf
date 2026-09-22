import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { docShelfRoot } from '../scripts/artifacts.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

const run = promisify(execFile);

test('one shelf validates in both apps and the CLI emits equivalent document links', async t => {
  const root = await temporaryDirectory(t, path.join(docShelfRoot, '.docshelf-runtime'), 'shared-shelf-');
  for (const entry of ['packages/local', 'scripts', '.agents/skills/docshelf/assets', 'package.json']) {
    await cp(path.join(docShelfRoot, entry), path.join(root, entry), { recursive: true });
  }
  await symlink(path.join(docShelfRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await mkdir(path.join(root, 'notes'));
  await writeFile(path.join(root, 'notes/review + 한글.markdown'), '# Review\n\nA source paragraph.\n');
  await writeFile(path.join(root, 'notes/report.htm'), '<h1>Report</h1>');
  const shelfPath = path.join(root, 'shelf.local.json');
  await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [
    { project: 'Fixture', source: 'notes/review + 한글.markdown', title: 'Review', route: 'fixture/review.html' },
    { project: 'Fixture', source: 'notes/report.htm', title: 'Report', route: 'fixture/report.html', description: '' },
  ] }));
  const args = ['scripts/links.mjs', 'fixture/review.html', '--site', 'https://shelf.localhost/base/', '--vault', 'Work + notes', '--lines', '1-3'];
  const { stdout } = await run(process.execPath, args, { cwd: root });
  const links = JSON.parse(stdout);
  assert.equal(links.browser, 'https://shelf.localhost/base/?artifact=fixture%2Freview.html#L1-L3');
  assert.equal(new URL(links.obsidian).searchParams.get('lines'), '1-3');
  assert.equal(links.source, `${path.join(root, 'notes/review + 한글.markdown')}:1-3`);

  const validation = await run(path.join(docShelfRoot, 'node_modules/.bin/tsx'), [
    'packages/obsidian/scripts/validate-shelf.ts', shelfPath, '--vault', 'Work + notes',
  ], { cwd: docShelfRoot });
  const documents = JSON.parse(validation.stdout).documents;
  assert.deepEqual(documents.map(d => d.kind), ['markdown', 'html']);
  const obsidian = new URL(links.obsidian);
  obsidian.searchParams.delete('lines');
  assert.equal(obsidian.searchParams.get('source'), new URL(documents[0].url).searchParams.get('source'));

  await assert.rejects(run(process.execPath, [...args.slice(0, 2), '--site', 'https://shelf.localhost/', '--lines', '3-1'], { cwd: root }), /Line range/);
  await assert.rejects(run(process.execPath, ['scripts/links.mjs', 'missing.html', '--site', 'https://shelf.localhost/'], { cwd: root }), /not registered/);
  await assert.rejects(run(process.execPath, ['scripts/links.mjs', 'fixture/report.html', '--site', 'https://shelf.localhost/', '--lines', '1'], { cwd: root }), /require a Markdown/);
});
