import { rm } from 'node:fs/promises';
import path from 'node:path';
import * as pagefind from 'pagefind';

/**
 * Replace the Pagefind output beneath a built site with one English-base index of every HTML file
 * in it. A full build has already produced Starlight's default language-detected index at this
 * point; rebuilding it as a single index lets the same search UI find mixed-language artifact
 * content instead of loading only the page's detected language.
 *
 * @param {string} outputRoot
 * @returns {Promise<number>} the number of indexed HTML files
 */
export async function writeSearchIndex(outputRoot) {
  const searchOutput = path.join(outputRoot, 'pagefind');

  try {
    const response = await pagefind.createIndex({ forceLanguage: 'en' });
    if (!response.index || response.errors.length > 0) {
      throw new Error(response.errors.join('\n') || 'Pagefind did not create an index.');
    }

    const indexed = await response.index.addDirectory({ path: outputRoot });
    if (indexed.errors.length > 0) {
      throw new Error(indexed.errors.join('\n'));
    }

    await rm(searchOutput, { recursive: true, force: true });
    const written = await response.index.writeFiles({ outputPath: searchOutput });
    if (written.errors.length > 0) {
      throw new Error(written.errors.join('\n'));
    }

    return indexed.page_count ?? 0;
  } finally {
    await pagefind.close();
  }
}
