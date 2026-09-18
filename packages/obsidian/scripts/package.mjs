import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const destination = `dist/${manifest.id}`;
await mkdir(destination, { recursive: true });
for (const name of ['manifest.json', 'main.js', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(name, `${destination}/${name}`);
await writeFile('dist/INSTALL.txt', 'Copy the docshelf folder into <vault>/.obsidian/plugins/, then enable DocShelf in Community plugins.\nKeep LICENSE and THIRD_PARTY_NOTICES.txt with main.js when copying or redistributing the plugin.\n');
console.log(`Installable plugin: ${destination}`);
