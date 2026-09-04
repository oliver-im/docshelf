import assert from 'node:assert/strict';
import { mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { siteInputsSignature } from '../scripts/site-inputs.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

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
