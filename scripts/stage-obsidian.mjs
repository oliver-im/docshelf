import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, unlink } from 'node:fs/promises';

// The community scanner looks for build/main.js after running the root build.
// Keep this separate from Astro's dist and the authoritative plugin workspace.
const destination = new URL('../build/', import.meta.url);
await mkdir(destination, { recursive: true });
if (!(await lstat(destination)).isDirectory()) throw new Error('Obsidian staging output must be a real directory.');
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const target = new URL(name, destination);
  const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && !existing.isFile()) throw new Error(`Refusing to replace non-file Obsidian staging output: ${name}`);
  if (existing) await unlink(target);
  await copyFile(new URL(`../packages/obsidian/${name}`, import.meta.url), target, constants.COPYFILE_EXCL);
}
