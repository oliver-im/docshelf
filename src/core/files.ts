import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function canonicalFile(file: string, roots: string[]): Promise<string> {
  const resolved = await realpath(file);
  if (!roots.some(root => within(root, resolved))) throw new Error('File is outside the configured workspace.');
  if (!(await stat(resolved)).isFile()) throw new Error('Source is not a regular file.');
  return resolved;
}

/** Open a checked target and read a bounded snapshot. Never open sources for writing. */
export async function readBoundedFile(file: string, roots: string[], limit: number): Promise<Buffer> {
  const resolved = await canonicalFile(file, roots);
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    const currentPath = await canonicalFile(file, roots);
    const current = await stat(currentPath);
    if (currentPath !== resolved || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error('Source changed while opening it. Try again.');
    }
    if (!opened.isFile() || opened.size > limit) throw new Error(`File exceeds the ${limit / 1024 / 1024} MB limit.`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error(`File exceeds the ${limit / 1024 / 1024} MB limit.`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}
