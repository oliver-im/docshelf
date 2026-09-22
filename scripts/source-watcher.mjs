import { watchScope } from '../packages/local/watch-scope.mjs';
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

  signature = '';
  /** @param {string[]} sources @param {Array<any>} [directories] */
  async update(sources, directories = []) {
    const scope = await watchScope(sources, directories);
    if (this.closed || this.watcher && this.signature === scope.signature) return;
    await this.watcher?.close();
    if (this.closed) return;
    this.paths = scope.paths;
    this.signature = scope.signature;
    const watcher = chokidar.watch(scope.parents, {
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      depth: 34,
      ignored: scope.ignored,
    });
    this.watcher = watcher;
    watcher.on('all', (event, file) => {
      if (!this.closed && this.watcher === watcher && scope.relevantChange(event, file)) this.onChange(`${event} ${file}`);
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
