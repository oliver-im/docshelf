import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createThirdPartyNotices, embeddedLicenses } from '../scripts/third-party-notices.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-notices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (file: string, contents: string) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  const bundle = () => build({
    absWorkingDir: root, entryPoints: ['entry.js'], bundle: true, write: false,
    metafile: true, platform: 'node', format: 'cjs', external: ['host-api'], logLevel: 'silent',
  });
  return { root, write, bundle };
}

test('bundle notices include scoped and nested dependencies, full license texts, and notices', async t => {
  const { root, write, bundle } = await fixture(t);
  await write('entry.js', `
    import { first } from '@fixture/report';
    import { second } from 'leaf';
    import { extra } from 'leaf/extra.js';
    import { unused } from 'discarded';
    import 'host-api';
    console.log(first, second, extra);
  `);
  await write('node_modules/@fixture/report/package.json', JSON.stringify({ name: '@fixture/report', version: '1.0.0', main: 'esm/index.js', license: 'MIT' }));
  await write('node_modules/@fixture/report/esm/package.json', '{"type":"module"}');
  await write('node_modules/@fixture/report/esm/index.js', "import { second } from 'leaf'; export const first = second;");
  await write('node_modules/@fixture/report/LICENSE.md', 'Report copyright\nFull report license text.\n');
  await write('node_modules/@fixture/report/NOTICE', 'Report attribution notice.\n');
  for (const [directory, version] of [['leaf', '1.0.0'], ['@fixture/report/node_modules/leaf', '2.0.0']]) {
    const prefix = `node_modules/${directory}`;
    await write(`${prefix}/package.json`, JSON.stringify({ name: 'leaf', version, main: 'index.js', license: 'BSD-2-Clause' }));
    await write(`${prefix}/index.js`, `export const second = '${version}';`);
    await write(`${prefix}/LICENCE.txt`, `Leaf ${version} copyright\nFull leaf license text.\n`);
  }
  await write('node_modules/leaf/extra.js', 'export const extra = 42;');
  await write('node_modules/leaf/COPYRIGHT', 'Additional leaf attribution.\n');
  // A package with no license file is harmless when none of its code is emitted.
  await write('node_modules/discarded/package.json', '{"name":"discarded","version":"1.0.0","main":"index.js","sideEffects":false}');
  await write('node_modules/discarded/index.js', 'export const unused = 1;');

  const result = await bundle();
  const notices = await createThirdPartyNotices(result.metafile!, root);
  assert.deepEqual(notices.match(/^## .+$/gm), ['## @fixture/report@1.0.0', '## leaf@1.0.0', '## leaf@2.0.0']);
  assert.ok(notices.includes('Report copyright\nFull report license text.\n'));
  assert.ok(notices.includes('Report attribution notice.\n'));
  assert.ok(notices.includes('Leaf 1.0.0 copyright\nFull leaf license text.\n'));
  assert.ok(notices.includes('Leaf 2.0.0 copyright\nFull leaf license text.\n'));
  assert.ok(notices.includes('Additional leaf attribution.\n'));
  assert.ok(!notices.includes('discarded'));
  assert.ok(!notices.includes('host-api'));
  assert.ok(!notices.includes(root));
  const reversed = structuredClone(result.metafile!);
  for (const output of Object.values(reversed.outputs)) output.inputs = Object.fromEntries(Object.entries(output.inputs).reverse());
  assert.equal(await createThirdPartyNotices(reversed, root), notices);
});

test('bundle notices reject missing or empty license texts instead of silently omitting dependencies', async t => {
  const { root, write, bundle } = await fixture(t);
  await write('entry.js', "import 'dependency';");
  await write('node_modules/dependency/package.json', '{"name":"dependency","version":"1.0.0","main":"index.js","license":"MIT"}');
  await write('node_modules/dependency/index.js', "console.log('bundled');");
  await write('node_modules/dependency/NOTICE.txt', 'Attribution alone is not a license.');
  const result = await bundle();
  await assert.rejects(createThirdPartyNotices(result.metafile!, root), /No license text.*dependency@1.0.0/);
  await write('node_modules/dependency/LICENSE', ' \n');
  await assert.rejects(createThirdPartyNotices(result.metafile!, root), /Empty LICENSE.*dependency@1.0.0/);
});

test('embedded license text stays inert even with comment delimiters and Unicode line separators', () => {
  const text = '*/ globalThis.injected = true;\rglobalThis.injected = true;\u2028globalThis.injected = true;\u2029globalThis.injected = true;';
  const context = { injected: false, result: 0 };
  runInNewContext('result = 42;' + embeddedLicenses('MIT license', text), context);
  assert.equal(context.result, 42);
  assert.equal(context.injected, false);
});
