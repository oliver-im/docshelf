import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const destination = `dist/${manifest.id}`;
await mkdir(destination, { recursive: true });
for (const name of ['manifest.json', 'main.js', 'styles.css', 'LICENSE']) await copyFile(name, `${destination}/${name}`);
await writeFile('dist/INSTALL.txt', 'Copy the docshelf folder into <vault>/.obsidian/plugins/, then enable DocShelf in Community plugins.\n');
console.log(`Installable plugin: ${destination}`);
