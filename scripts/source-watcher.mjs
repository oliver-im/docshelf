import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';

/** Watch only registered paths, their targets, and symlinks along those paths.
 * Parent-directory watches see symlink replacement without following the old
 * target forever. Replacing the watch set avoids unwatching overlapping aliases.
 */
export class SourceWatcher {
  /** @type {import('chokidar').FSWatcher | null} */
  watcher = null;
  /** @type {Set<string>} */
  paths = new Set();
  closed = false;

  /** @param {(reason: string) => void} onChange @param {(error: unknown) => void} onError */
  constructor(onChange, onError) {
    this.onChange = onChange;
    this.onError = onError;
  }

  /** @param {string[]} sources */
  async update(sources) {
    const candidates = new Set(sources);
    const inspected = new Set();
    for (const source of sources) {
      for (let candidate = path.dirname(source); !inspected.has(candidate); candidate = path.dirname(candidate)) {
        inspected.add(candidate);
        if ((await lstat(candidate).catch(() => null))?.isSymbolicLink()) candidates.add(candidate);
        if (candidate === path.dirname(candidate)) break;
      }
    }
    // Normalize parent aliases such as /var, but retain each final symlink so
    // replacing it remains observable. Its old and new targets are separate.
    const paths = new Set(await Promise.all([...candidates].map(async source =>
      path.join(await realpath(path.dirname(source)).catch(() => path.dirname(source)), path.basename(source)),
    )));
    if (this.closed || paths.size === this.paths.size && [...paths].every(file => this.paths.has(file))) return;
    await this.watcher?.close();
    if (this.closed) return;
    this.paths = paths;
    const parents = new Set([...paths].map(file => path.dirname(file)));
    const watcher = chokidar.watch([...parents], {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: file => !paths.has(file) && ![...parents].some(parent => parent === file || parent.startsWith(`${file}${path.sep}`)),
    });
    this.watcher = watcher;
    watcher.on('all', (event, file) => {
      if (!this.closed && this.watcher === watcher) this.onChange(`${event} ${file}`);
    });
    // Cover changes during watch-set replacement, including a newly selected
    // target changing after the build's last source check.
    watcher.once('ready', () => {
      if (!this.closed && this.watcher === watcher) this.onChange('registered source watches ready');
    });
    watcher.on('error', error => {
      if (!this.closed && this.watcher === watcher) this.onError(error);
    });
  }

  async close() {
    this.closed = true;
    await this.watcher?.close();
  }
}
