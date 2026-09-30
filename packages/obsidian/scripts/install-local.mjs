import { copyFile, readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

// Replaces the DocShelf build in the developer's own vault and reloads it in
// the running Obsidian, so a change can be tried at once. The vault comes from
// DOCSHELF_DEV_VAULT or the first line of the ignored .local/dev-vault. This
// is the only script that writes to that vault; runtime tests never use it.
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const configured = process.env.DOCSHELF_DEV_VAULT || (await readFile('.local/dev-vault', 'utf8').catch(() => '')).split('\n')[0].trim();
if (!configured) throw new Error('Set DOCSHELF_DEV_VAULT, or write your vault path to packages/obsidian/.local/dev-vault.');
const vault = await realpath(configured);
const target = path.join(vault, '.obsidian', 'plugins', manifest.id);
// Replace an existing installation only; never install into a new vault.
const installed = await readFile(path.join(target, 'manifest.json'), 'utf8').then(JSON.parse, () => null);
if (installed?.id !== manifest.id) throw new Error(`${target} has no installed ${manifest.id} plugin to replace.`);
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(name, path.join(target, name));
console.log(`Installed ${manifest.id} ${manifest.version} in ${vault}.`);

// Obsidian's command line interface opens a vault that is not already open,
// and launching its CLI can start Obsidian, so only ask a running app to
// reload a vault it has open.
const configDirectory = process.env.OBSIDIAN_BUNDLE_DIRECTORY || (
  process.platform === 'darwin' ? path.join(homedir(), 'Library/Application Support/obsidian')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'obsidian')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'obsidian'));
const vaults = await readFile(path.join(configDirectory, 'obsidian.json'), 'utf8').then(text => JSON.parse(text).vaults || {}, () => ({}));
let id = '';
for (const [key, entry] of Object.entries(vaults)) {
  if (entry.open && await realpath(entry.path).catch(() => '') === vault) id = key;
}
const socket = process.platform === 'win32' ? `\\\\.\\pipe\\obsidian-cli-${userInfo().username}` : path.join(process.platform !== 'darwin' && process.env.XDG_RUNTIME_DIR || homedir(), '.obsidian-cli.sock');
const running = id && await new Promise(resolve => {
  const connection = createConnection(socket);
  connection.once('connect', () => { connection.destroy(); resolve(true); });
  connection.once('error', () => resolve(false));
});
if (!running) {
  console.log('Obsidian does not have this vault open. Reload DocShelf there to use the new build.');
  process.exit(0);
}
const cli = process.env.OBSIDIAN_CLI || (process.platform === 'darwin' ? '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli' : 'obsidian');
const reload = spawnSync(cli, [`vault=${id}`, 'plugin:reload', `id=${manifest.id}`], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
const output = `${reload.stdout || ''}${reload.stderr || ''}`.trim();
if (reload.status !== 0 || !output.startsWith('Reloaded')) {
  console.log(`Could not reload ${manifest.id} (${output || reload.error?.message || `exit ${reload.status}`}). Turn on Settings > General > Advanced > Command line interface, or reload it by hand.`);
  process.exit(0);
}
console.log(`${output} in the running Obsidian.`);
