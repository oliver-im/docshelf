import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Keep root metadata and README release links aligned with the plugin's maintained files.
 * @param {string} root
 * @param {{ sync?: boolean, version?: string }} options
 */
export async function checkReleaseMetadata(root = repository, { sync = false, version } = {}) {
  const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
  const manifest = await read('packages/obsidian/manifest.json');
  const versions = await read('packages/obsidian/versions.json');
  const pkg = await read('packages/obsidian/package.json');
  const lock = await read('package-lock.json');
  assert.equal(manifest.id, 'docshelf', 'The installed plugin ID must stay docshelf.');
  assert.match(manifest.version, semver, 'Plugin versions must be plain X.Y.Z.');
  assert.match(manifest.minAppVersion, semver, 'Use a plain minimum Obsidian version.');
  assert.equal(manifest.isDesktopOnly, true, 'DocShelf requires desktop filesystem and Electron APIs.');
  assert.equal(pkg.version, manifest.version, 'Plugin package and manifest versions differ.');
  assert.equal(lock.packages['packages/obsidian'].version, manifest.version, 'Refresh the root lockfile after changing the plugin version.');
  assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json must include the current minimum Obsidian version.');
  for (const [release, minimum] of Object.entries(versions)) {
    assert.match(release, semver);
    assert.match(minimum, semver);
  }
  if (version !== undefined) assert.equal(version, manifest.version, 'Requested release must match the checked-out plugin version.');
  for (const [name, value] of [['manifest.json', manifest], ['versions.json', versions]]) {
    if (sync) await writeFile(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
    else assert.deepEqual(await read(name), value, `${name} differs from the plugin metadata. Run npm run sync:obsidian-metadata.`);
  }
  const releases = 'https://github.com/oliver-im/docshelf/releases';
  const links = {
    'obsidian-download': `${releases}/download/${manifest.version}/docshelf-${manifest.version}.zip`,
    'obsidian-release': `${releases}/tag/${manifest.version}`,
  };
  for (const name of ['README.md', 'packages/obsidian/README.md']) {
    const file = path.join(root, name);
    const source = await readFile(file, 'utf8');
    let updated = source;
    for (const [label, url] of Object.entries(links)) {
      const definition = new RegExp(`^\\[${label}\\]:[^\\r\\n]*`, 'gm');
      assert.equal([...source.matchAll(definition)].length, 1, `${name} must contain exactly one [${label}] link definition.`);
      updated = updated.replace(definition, `[${label}]: ${url}`);
    }
    if (sync) {
      if (updated !== source) await writeFile(file, updated);
    } else {
      assert.equal(source, updated, `${name} release links differ from the plugin version. Run npm run sync:obsidian-metadata.`);
    }
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const sync = args[0] === '--sync';
    if (args.length > 1 || (args[0]?.startsWith('--') && !sync)) throw new Error('Usage: release-metadata.mjs [--sync | X.Y.Z]');
    const manifest = await checkReleaseMetadata(repository, { sync, version: sync ? undefined : args[0] });
    console.log(`Obsidian metadata ${sync ? 'synchronized' : 'verified'}: ${manifest.version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
