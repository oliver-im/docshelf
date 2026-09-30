import * as fs from 'node:fs/promises';
import path from 'node:path';

const files = ['main.js', 'manifest.json', 'styles.css'];

export async function replacePluginFiles(source, target, io = fs) {
  const staging = await io.mkdtemp(path.join(target, '.docshelf-install-'));
  const replaced = [];
  let keepBackup = false;
  try {
    // Copy failures must only damage staged files, never the installed build.
    // Keep both sets on the target filesystem so replacement and rollback use rename.
    for (const name of files) {
      await io.copyFile(path.join(source, name), path.join(staging, `new-${name}`));
      await io.copyFile(path.join(target, name), path.join(staging, `old-${name}`));
    }
    for (const name of files) {
      await io.rename(path.join(staging, `new-${name}`), path.join(target, name));
      replaced.push(name);
    }
  } catch (error) {
    const failures = [];
    for (const name of replaced.reverse()) {
      try { await io.rename(path.join(staging, `old-${name}`), path.join(target, name)); }
      catch (failure) { failures.push(failure); }
    }
    if (failures.length) {
      keepBackup = true;
      throw new AggregateError([error, ...failures], `Plugin replacement and rollback failed. Original files remain in ${staging}.`);
    }
    throw error;
  } finally {
    if (!keepBackup) await io.rm(staging, { recursive: true, force: true });
  }
}
