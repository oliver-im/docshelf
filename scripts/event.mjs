// Announce that an agent updated a registered document, so DocShelf shows it unread. See docs/events.md.
//
//   node scripts/event.mjs updated <file> [--summary text] [--agent name] [--strict] [--shelf file] [--workspace dir]
//   node scripts/event.mjs updated --from-hook claude-code     (reads a Claude Code PostToolUse hook's JSON input)
//
// Files that are not on the shelf are skipped quietly, because a hook runs after every edit. `--strict`
// reports them. In hook mode nothing is printed and the exit status is always 0, so a hook never
// interrupts the agent.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createEvent } from '@docshelf/core/events';
import { appendEvent } from '../packages/local/events.mjs';
import { findRegisteredFile } from '../packages/local/shelf.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/event.mjs updated <file> [--summary text] [--agent name] [--strict] [--shelf file] [--workspace dir]';
const maxHookInput = 32 * 1024 * 1024;

let options;
try {
  options = parseArgs({ allowPositionals: true, options: {
    shelf: { type: 'string' }, workspace: { type: 'string' }, summary: { type: 'string' },
    agent: { type: 'string' }, 'from-hook': { type: 'string' }, strict: { type: 'boolean' },
  } });
} catch (error) {
  fail(`${error.message}\n${usage}`, 2);
}
const { values, positionals } = options;
const hook = values['from-hook'];

try {
  if (positionals[0] !== 'updated') throw usageError(`Unknown or missing event type.\n${usage}`);
  const file = hook === undefined ? positionals[1] : await hookFile();
  if (hook === undefined && (typeof file !== 'string' || !file || positionals.length > 2)) throw usageError(usage);
  const announced = file ? await announce(path.resolve(file)) : null;
  if (hook === undefined && announced) console.log(`Announced an update to ${announced}.`);
} catch (error) {
  // A hook must never interrupt the agent's edit, whatever went wrong.
  if (hook !== undefined) process.exit(0);
  fail(error.message, error.exitCode || 1);
}

async function announce(file) {
  const shelfPath = values.shelf ? path.resolve(values.shelf) : ['shelf.local.json', 'artifacts.local.json'].map(name => path.join(checkout, name)).find(candidate => existsSync(candidate));
  if (!shelfPath) return skipped(file, 'there is no local shelf in this checkout');
  const shelfDirectory = path.dirname(shelfPath);
  // Match each app's containment: the shelf's directory and the workspace root, which the web app reads from
  // DOCSHELF_WORKSPACE relative to its checkout and Obsidian from its settings, defaulting to the home directory.
  const configured = values.workspace ? path.resolve(values.workspace) : !values.shelf && process.env.DOCSHELF_WORKSPACE?.trim() ? path.resolve(checkout, process.env.DOCSHELF_WORKSPACE.trim()) : homedir();
  const roots = [...new Set(await Promise.all([realpath(shelfDirectory), realpath(configured)]))];
  const source = await findRegisteredFile({ shelfPath, roots, file });
  if (!source) return skipped(file, `it is not a document on ${shelfPath}`);
  const info = await stat(source);
  // The revision is optional, so a document too large for either app to show is announced without one.
  const revision = info.size <= 8 * 1024 * 1024 ? `sha256:${createHash('sha256').update(await readFile(source)).digest('hex')}` : undefined;
  const name = hook ?? values.agent;
  await appendEvent(shelfPath, createEvent({
    from: { role: 'agent', ...(name ? { name } : {}) },
    type: 'document.updated',
    subject: { source, ...(revision ? { revision } : {}) },
    ...(values.summary ? { body: { text: values.summary } } : {}),
  }));
  return source;
}

async function hookFile() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > maxHookInput) return null;
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || !file) return null;
  return typeof input.cwd === 'string' ? path.resolve(input.cwd, file) : file;
}

function skipped(file, reason) {
  if (values.strict) throw new Error(`Not announced: ${file}, because ${reason}.`);
  return null;
}

function usageError(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}
