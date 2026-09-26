import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { checkReleaseMetadata } from './release-metadata.mjs';

const manifest = await checkReleaseMetadata();
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const destination = `dist/${manifest.id}`;
const release = 'dist/release';
// Recreate only generated package directories so stale/private files cannot ship.
for (const directory of [destination, release]) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}
const archive = {};
const sums = [];
const attach = async (name, contents) => {
  await writeFile(`${release}/${name}`, contents);
  sums.push(`${createHash('sha256').update(contents).digest('hex')}  ${name}`);
};
for (const name of ['manifest.json', 'main.js', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  const contents = await readFile(name);
  await writeFile(`${destination}/${name}`, contents);
  archive[`${manifest.id}/${name}`] = contents;
  await attach(name, contents);
}
const instructions = `DocShelf for Obsidian ${manifest.version}\n\nRequires desktop Obsidian ${manifest.minAppVersion} or later.\nTested on macOS with Obsidian 1.13.7; Windows, Linux, and Obsidian 1.14.2 are not yet verified.\n\nFresh install\n1. Extract this ZIP.\n2. Copy the docshelf folder into <vault>/.obsidian/plugins/.\n3. Enable DocShelf in Obsidian's Community plugins settings.\n4. Run DocShelf: Open shelf and choose Add files or folders, or use an existing shelf.\n\nUpdate\n1. Save or review pending Markdown edits, then disable DocShelf.\n2. Copy the files inside docshelf into the existing plugin folder.\n3. Keep data.json and recovery/; do not replace or delete the existing folder.\n4. Re-enable DocShelf.\n\nNo Node.js, Git, or web server is needed to install this build.\nLicense and dependency notices are embedded in main.js and provided as separate files.\nGuide: https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md\n`;
await writeFile('dist/INSTALL.txt', instructions);
archive['INSTALL.txt'] = Buffer.from(instructions);
// Fixed ZIP timestamps make repeat builds comparable across machines and timezones.
const zip = zipSync(archive, { level: 9, mtime: new Date(2000, 0, 1) });
await attach(`docshelf-${manifest.version}.zip`, zip);
await writeFile(`${release}/SHA256SUMS`, sums.sort().join('\n') + '\n');
console.log(`Installable plugin: ${destination}\nRelease assets: ${release}/\nZIP: ${release}/docshelf-${manifest.version}.zip`);
