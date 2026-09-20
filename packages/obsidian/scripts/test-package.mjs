import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Script } from 'node:vm';
import { unzipSync } from 'fflate';
import { checkReleaseMetadata } from './release-metadata.mjs';

test('release assets install independently and include only intended files, matching licenses, and valid checksums', async () => {
  const manifest = await checkReleaseMetadata();
  const files = ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'main.js', 'manifest.json', 'styles.css'];
  const zipName = `docshelf-${manifest.version}.zip`;
  const directory = 'dist/release';
  assert.deepEqual((await readdir(directory)).sort(), [...files, zipName, 'SHA256SUMS'].sort());
  const zip = unzipSync(await readFile(`${directory}/${zipName}`));
  assert.deepEqual(Object.keys(zip).sort(), ['INSTALL.txt', ...files.map(name => `docshelf/${name}`)].sort());
  for (const name of files) {
    const attachment = await readFile(`${directory}/${name}`);
    assert.deepEqual(Buffer.from(zip[`docshelf/${name}`]), attachment, `${name} differs between ZIP and standalone attachment.`);
    assert.deepEqual(await readFile(`dist/docshelf/${name}`), attachment);
  }
  assert.deepEqual(JSON.parse(Buffer.from(zip['docshelf/manifest.json']).toString()), manifest);
  const source = await readFile(`${directory}/main.js`, 'utf8');
  new Script(source, { filename: 'main.js' });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    const text = await readFile(`${directory}/${name}`, 'utf8');
    const commented = text.split(/\r\n|[\n\r\u2028\u2029]/u).map(line => `// ${line}`).join('\n');
    assert.ok(source.includes(commented), `The three-file Obsidian installation needs embedded ${name}.`);
  }
  const sums = (await readFile(`${directory}/SHA256SUMS`, 'utf8')).trim().split('\n');
  assert.equal(sums.length, files.length + 1);
  assert.deepEqual(sums.map(line => line.split('  ')[1]).sort(), [...files, zipName].sort());
  for (const line of sums) {
    const [expected, name] = line.split('  ');
    assert.match(expected, /^[a-f\d]{64}$/);
    assert.equal(createHash('sha256').update(await readFile(`${directory}/${name}`)).digest('hex'), expected);
  }
});
