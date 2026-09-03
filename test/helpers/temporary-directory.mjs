import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Create a temporary directory beneath `parent` that is removed when the test finishes.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} parent
 * @param {string} prefix
 */
export async function temporaryDirectory(t, parent, prefix) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, prefix));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}
