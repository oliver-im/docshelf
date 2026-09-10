import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const script = (await readFile(new URL('../scripts/launchd.mjs', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const currentRoot = '/workspace/new checkout';
const oldRoot = '/workspace/old & renamed checkout';
const watchPath = (root) => path.join(root, 'scripts/watch.mjs');
const xml = (value) => value.replaceAll('&', '&amp;');

// Run the command dispatcher with in-memory service state; never call the real launchctl.
async function runLaunchd(args, { installed = oldRoot, loaded = installed } = {}) {
  let plist = installed && `<key>ProgramArguments</key><array><string>/node</string><string>${xml(watchPath(installed))}</string></array>`;
  const calls = [];
  const removed = [];
  const messages = [];
  const context = {
    path, docShelfRoot: currentRoot, runtimeRoot: path.join(currentRoot, '.docshelf-runtime'),
    homedir: () => '/test-user', browserHost: () => 'shelf.localhost', delay: async () => {},
    process: { argv: ['/node', 'scripts/launchd.mjs', ...args], platform: 'darwin', getuid: () => 501,
      env: {}, execPath: '/node', stdout: { write() {} } },
    console: { log: (message) => messages.push(message), error: (message) => messages.push(message) },
    readFile: async () => { if (plist) return plist; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    unlink: async (file) => { removed.push(file); plist = null; },
    inspectWatcherLock: async () => ({ state: 'missing' }),
    spawn: (executable, args) => {
      assert.equal(executable, '/bin/launchctl');
      calls.push(args);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = child.stderr.setEncoding = () => {};
      queueMicrotask(() => {
        if (args[0] === 'print') {
          if (loaded) child.stdout.emit('data', `service = {\n\targuments = {\n\t\t/node\n\t\t${watchPath(loaded)}\n\t}\n}`);
          child.emit('exit', loaded ? 0 : 113);
        } else if (args[0] === 'bootout') {
          assert.deepEqual(Array.from(args), ['bootout', 'gui/501/local.docshelf.watch']);
          loaded = null;
          child.emit('exit', 0);
        } else {
          child.emit('error', new Error(`Unexpected launchctl ${args.join(' ')}`));
        }
      });
      return child;
    },
  };
  let error;
  try { await vm.runInNewContext(`(async () => {\n${script}\n})()`, context); }
  catch (caught) { error = caught; }
  return { error, calls, removed, messages, plist, loaded };
}

test('a moved checkout can explicitly uninstall the service at its old path', async () => {
  const result = await runLaunchd(['uninstall', '--from', oldRoot]);
  assert.equal(result.error, undefined);
  assert.equal(result.loaded, null);
  assert.equal(result.plist, null);
  assert.deepEqual(result.removed, ['/test-user/Library/LaunchAgents/local.docshelf.watch.plist']);
  assert.equal(result.calls.filter((args) => args[0] === 'bootout').length, 1);
  assert.ok(result.messages.some((message) => message.includes(path.join(oldRoot, '.docshelf-runtime'))));
});

test('other checkouts remain protected from implicit or incorrectly targeted service changes', async () => {
  for (const args of [['preflight'], ['install'], ['uninstall'], ['uninstall', '--from', '/wrong/checkout']]) {
    const result = await runLaunchd(args);
    assert.match(result.error?.message || '', /belongs to another checkout/);
    assert.match(result.error.message, /--from/);
    assert.deepEqual(result.removed, []);
    assert.ok(!result.calls.some((args) => args[0] === 'bootout'));
  }
  // Check the loaded definition too, even if the on-disk plist matches.
  const result = await runLaunchd(['uninstall', '--from', oldRoot], { loaded: `${oldRoot}-other` });
  assert.match(result.error?.message || '', /loaded.*another checkout/);
  assert.deepEqual(result.removed, []);
});

test('uninstall handles services owned by this checkout and old unloaded services', async () => {
  for (const [args, options] of [
    [['uninstall'], { installed: currentRoot }],
    [['uninstall', '--from', oldRoot], { loaded: null }],
    [['uninstall', '--from', oldRoot], { installed: null, loaded: oldRoot }],
  ]) {
    const result = await runLaunchd(args, options);
    assert.equal(result.error, undefined);
    assert.equal(result.loaded, null);
    assert.equal(result.plist, null);
  }
});

test('the old-checkout option is limited to uninstall and requires an absolute path', async () => {
  for (const args of [
    ['install', '--from', oldRoot], ['preflight', '--from', oldRoot],
    ['uninstall', '--from'], ['uninstall', '--from', '../old'], ['uninstall', '--force'],
  ]) {
    const result = await runLaunchd(args);
    assert.match(result.error?.message || '', /Usage:/);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.removed, []);
  }
});
