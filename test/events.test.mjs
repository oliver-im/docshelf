import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvent, serializeEvent } from '@docshelf/core/events';
import { docShelfRoot } from '../scripts/artifacts.mjs';
import { createAnnouncementReader } from '../scripts/announcements.mjs';
import { appendEvent, endCursor, eventLogPath, readEvents } from '../packages/local/events.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

const update = (source, fields = {}) => createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source }, ...fields });

test('concurrent writers append whole lines that readers parse in each writer’s order', async (t) => {
  const directory = await temporaryDirectory(t, tmpdir(), 'docshelf-events-');
  const shelfPath = path.join(directory, 'shelf.local.json');
  const writers = ['a', 'b', 'c', 'd'];
  await Promise.all(writers.map((writer) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(docShelfRoot, 'test/helpers/event-child.mjs'), shelfPath, writer, '15'], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${writer} exited with ${code}`))));
  })));
  const { events, warnings } = await readEvents(eventLogPath(shelfPath), { offset: 0, lastId: null });
  assert.deepEqual(warnings, []);
  assert.equal(new Set(events.map((event) => event.id)).size, 60);
  for (const writer of writers) {
    const indices = events.filter((event) => event.from.name === writer).map((event) => Number(event.body.text.split(':')[0]));
    assert.deepEqual(indices, Array.from({ length: 15 }, (_, index) => index), `writer ${writer}`);
  }
});

test('readers take complete lines only, skip invalid ones, and never replay a replaced log', async (t) => {
  const directory = await temporaryDirectory(t, tmpdir(), 'docshelf-events-');
  const shelfPath = path.join(directory, 'shelf.local.json');
  const log = eventLogPath(shelfPath);
  assert.equal(log, path.join(directory, 'shelf.local.events.jsonl'));
  const sources = async (cursor) => {
    const result = await readEvents(log, cursor);
    return { ...result, sources: result.events.map((event) => event.subject.source) };
  };

  // A first run starts after everything already logged.
  assert.deepEqual(await endCursor(log), { offset: 0, lastId: null });
  await appendEvent(shelfPath, update('/before.md'));
  let cursor = await endCursor(log);
  await appendEvent(shelfPath, update('/first.md'));
  let result = await sources(cursor);
  assert.deepEqual(result.sources, ['/first.md']);
  cursor = result.cursor;

  // A line still being written is read once it is complete.
  const line = serializeEvent(update('/split.md'));
  await appendFile(log, line.slice(0, 40));
  result = await sources(cursor);
  assert.deepEqual([result.sources, result.cursor], [[], cursor]);
  await appendFile(log, line.slice(40));
  result = await sources(cursor);
  assert.deepEqual(result.sources, ['/split.md']);
  cursor = result.cursor;

  // An invalid line is skipped with a warning without holding back later events.
  await appendFile(log, 'not an event\n');
  await appendEvent(shelfPath, update('/after-invalid.md'));
  result = await sources(cursor);
  assert.deepEqual(result.sources, ['/after-invalid.md']);
  assert.equal(result.warnings.length, 1);
  cursor = result.cursor;

  // A writer that stopped mid-line must not swallow the next event.
  await appendFile(log, '{"v":1,"id":"unfinished"');
  await appendEvent(shelfPath, update('/after-unfinished.md'));
  result = await sources(cursor);
  assert.deepEqual(result.sources, ['/after-unfinished.md']);
  cursor = result.cursor;

  // A log replaced by a longer one is not replayed; reading continues from its end.
  const replacement = path.join(directory, 'replacement.jsonl');
  await writeFile(replacement, ['/old-1.md', '/old-2.md', '/old-3.md', '/old-4.md', '/old-5.md', '/old-6.md', '/old-7.md', '/old-8.md'].map((source) => serializeEvent(update(source))).join(''));
  await rename(replacement, log);
  result = await sources(cursor);
  assert.deepEqual([result.sources, result.reset], [[], true]);
  assert.ok(result.cursor.offset > cursor.offset);
  cursor = result.cursor;
  await appendEvent(shelfPath, update('/after-replacement.md'));
  result = await sources(cursor);
  assert.deepEqual(result.sources, ['/after-replacement.md']);
  cursor = result.cursor;

  // A truncated or removed log starts over, and events written to the new one are read.
  await writeFile(log, '');
  result = await sources(cursor);
  assert.deepEqual([result.sources, result.reset, result.cursor], [[], true, { offset: 0, lastId: null }]);
  await rm(log);
  assert.deepEqual((await sources(cursor)).cursor, { offset: 0, lastId: null });
  await appendEvent(shelfPath, update('/recreated.md'));
  assert.deepEqual((await sources({ offset: 0, lastId: null })).sources, ['/recreated.md']);
});

test('the event command announces shelf documents by canonical path and skips other files quietly', async (t) => {
  const root = await realpath(await temporaryDirectory(t, tmpdir(), 'docshelf-announce-'));
  // An isolated checkout, so the default shelf and workspace resolve without touching the real one.
  const checkout = path.join(root, 'docshelf');
  for (const entry of ['scripts/event.mjs', 'packages/local']) await cp(path.join(docShelfRoot, entry), path.join(checkout, entry), { recursive: true });
  await symlink(path.join(docShelfRoot, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
  const project = path.join(root, 'project');
  await mkdir(path.join(project, 'docs/drafts'), { recursive: true });
  await mkdir(path.join(project, 'docs/.hidden'));
  const files = {
    explicit: path.join(project, 'plan.md'),
    discovered: path.join(project, 'docs/guide.md'),
    excluded: path.join(project, 'docs/drafts/draft.md'),
    hidden: path.join(project, 'docs/.hidden/note.md'),
    other: path.join(project, 'docs/notes.txt'),
    unregistered: path.join(project, 'unlisted.md'),
  };
  for (const file of Object.values(files)) await writeFile(file, `# ${path.basename(file)}\n`);
  await symlink(project, path.join(root, 'alias'), 'dir');
  const shelfPath = path.join(checkout, 'shelf.local.json');
  await writeFile(shelfPath, JSON.stringify({
    version: 2,
    artifacts: [{ project: 'Project', source: '../project/plan.md', route: 'project/plan.html', title: 'Plan' }],
    directories: [{ id: 'docs', source: '../project/docs', project: 'Project', exclude: ['drafts'] }],
  }));
  const log = eventLogPath(shelfPath);
  const logged = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const command = (args, { input, env } = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(checkout, 'scripts/event.mjs'), ...args], { cwd: root, env: { ...process.env, DOCSHELF_WORKSPACE: '', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });

  // A symlinked spelling is recorded by its canonical path, with the hash of the bytes the agent wrote.
  const manual = await command(['updated', path.join(root, 'alias/plan.md'), '--summary', 'Reordered the steps.', '--agent', 'codex']);
  assert.equal(manual.code, 0, manual.stderr);
  const hook = await command(['updated', '--from-hook', 'claude-code'], { input: JSON.stringify({ cwd: project, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'docs/guide.md' } }) });
  assert.deepEqual([hook.code, hook.stdout, hook.stderr], [0, '', '']);
  const [planned, guided] = await logged();
  assert.deepEqual(planned.from, { role: 'agent', name: 'codex' });
  assert.deepEqual(planned.subject, { source: files.explicit, revision: `sha256:${createHash('sha256').update('# plan.md\n').digest('hex')}` });
  assert.deepEqual(planned.body, { text: 'Reordered the steps.' });
  assert.deepEqual([guided.from, guided.subject.source], [{ role: 'agent', name: 'claude-code' }, files.discovered]);

  // Hooks run after every edit, so files the shelf does not list are skipped silently.
  for (const file of [files.excluded, files.hidden, files.other, files.unregistered, shelfPath, path.join(tmpdir(), 'outside.md')]) {
    const skipped = await command(['updated', '--from-hook', 'claude-code'], { input: JSON.stringify({ tool_input: { file_path: file } }) });
    assert.deepEqual([skipped.code, skipped.stdout, skipped.stderr], [0, '', ''], file);
    assert.equal((await command(['updated', file])).code, 0, file);
    const strict = await command(['updated', file, '--strict']);
    assert.equal(strict.code, 1, file);
    assert.match(strict.stderr, /Not announced/);
  }
  for (const input of ['not json', '{}', JSON.stringify({ tool_input: { command: 'sed -i s/a/b/ docs/guide.md' } })]) {
    assert.deepEqual(await command(['updated', '--from-hook', 'claude-code'], { input }), { code: 0, stdout: '', stderr: '' });
  }
  // Only the hook stays quiet about a broken shelf; a manual announcement reports it.
  await writeFile(shelfPath, '{');
  assert.equal((await command(['updated', '--from-hook', 'claude-code'], { input: JSON.stringify({ tool_input: { file_path: files.discovered } }) })).code, 0);
  assert.equal((await command(['updated', files.discovered])).code, 1);
  assert.equal((await logged()).length, 2);

  // The workspace boundary follows DOCSHELF_WORKSPACE, as in the web app.
  await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [{ project: 'Project', source: '../project/plan.md', route: 'project/plan.html', title: 'Plan' }] }));
  assert.equal((await command(['updated', files.explicit, '--strict'], { env: { DOCSHELF_WORKSPACE: '../docshelf' } })).code, 1);
  assert.equal((await command(['updated', files.explicit, '--strict'])).code, 0);
  assert.equal((await logged()).length, 3);
});

test('the web app receives announcements only as IDs of documents in the served build', async (t) => {
  const directory = await temporaryDirectory(t, tmpdir(), 'docshelf-events-');
  const shelfPath = path.join(directory, 'shelf.local.json');
  let served = null;
  const read = createAnnouncementReader({ logPath: async () => eventLogPath(shelfPath), sourceIds: () => served });
  assert.equal(await read({}), null, 'Before a build is served, the browser keeps its position.');
  served = new Map([['/served.md', 'id-served'], ['https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc', 'id-claude']]);
  await appendEvent(shelfPath, update('/served.md'));
  const start = await read({});
  assert.deepEqual(start.sources, [], 'A browser without a position starts at the end.');
  await appendEvent(shelfPath, update('/served.md'));
  await appendEvent(shelfPath, update('/not-served.md'));
  await appendEvent(shelfPath, createEvent({ from: { role: 'user', app: 'web' }, type: 'document.updated', subject: { source: '/served.md' } }));
  await appendEvent(shelfPath, update('https://claude.ai/public/artifacts/12345678-1234-1234-1234-123456789abc/'));
  await appendEvent(shelfPath, update('/served.md'));
  const result = await read({ after: start.cursor.offset, last: start.cursor.lastId });
  assert.deepEqual(result.sources, ['id-served', 'id-claude']);
  assert.doesNotMatch(JSON.stringify(result), /served\.md|\//);
  assert.deepEqual(await read({ after: result.cursor.offset, last: result.cursor.lastId }), { cursor: result.cursor, sources: [] });
});
