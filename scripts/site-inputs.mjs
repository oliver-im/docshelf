import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Files that shape Astro output besides the generated shelf and artifact snapshots. */
const siteInputs = ['astro.config.mjs', 'package-lock.json', 'tsconfig.json', 'public', 'scripts', 'src'];
const ignoredSiteInputs = new Set(['public/artifacts', 'src/generated']);

/**
 * Fingerprint DocShelf-owned build inputs by path and contents. The watcher compares this before
 * and after Astro runs so it never publishes output assembled from changing site files.
 *
 * @param {string} docShelfRoot
 */
export async function siteInputsSignature(docShelfRoot) {
  const hash = createHash('sha256');
  for (const input of siteInputs) {
    await hashSiteInput(hash, docShelfRoot, input);
  }
  return hash.digest('hex');
}

/** @param {import('node:crypto').Hash} hash @param {string} docShelfRoot @param {string} input */
async function hashSiteInput(hash, docShelfRoot, input) {
  if (ignoredSiteInputs.has(input)) return;

  const inputPath = path.join(docShelfRoot, input);
  const stats = await stat(inputPath).catch(() => null);
  if (!stats) return;

  if (stats.isDirectory()) {
    const entries = await readdir(inputPath);
    for (const entry of entries.sort()) {
      await hashSiteInput(hash, docShelfRoot, `${input}/${entry}`);
    }
    return;
  }

  // A file removed since the directory listing is left out, as if it had never existed.
  const contents = stats.isFile() ? await readFile(inputPath).catch(() => null) : null;
  if (contents === null) return;

  hash.update(`${input}\0${contents.length}\0`);
  hash.update(contents);
}
