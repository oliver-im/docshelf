import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEvent, serializeEvent } from '@docshelf/core/events';
import { unreadSources } from '@docshelf/core/read-state';
import { appendEvent, endCursor, eventLogPath } from '../../local/events.mjs';
import { ShelfReadState } from '../src/core/read-state';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-read-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shelf = path.join(root, 'shelf.json');
  const storage = new MemoryStorage();
  // The lock is an external browser primitive. Model its FIFO exclusion here;
  // the runtime suite uses real Web Locks in separate windows.
  const pending = new Map<string, Promise<unknown>>();
  const exclusive = <T>(name: string, update: () => Promise<T>) => {
    const result = (pending.get(name) || Promise.resolve()).then(update, update);
    pending.set(name, result.catch(() => {}));
    return result;
  };
  const reader = (file = shelf) => new ShelfReadState(file, storage, exclusive);
  const announce = (source: string) => appendEvent(shelf, createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source } }));
  return { shelf, storage, reader, announce };
}

test('migration merges vault histories without letting an older read erase a newer update', async t => {
  const { shelf, storage, reader, announce } = await fixture(t);
  const current = ['/unread-update.md', '/read-update.md', '/already-read.md', '/new.md'];
  const legacy = (vault: string, seen: string[], cursor?: unknown) => {
    storage.setItem(`${vault}-docshelf-read-state:${shelf}`, JSON.stringify({ version: 1, seen }));
    if (cursor) storage.setItem(`${vault}-docshelf-event-cursor:${shelf}`, JSON.stringify(cursor));
  };
  legacy('older', current.slice(0, 3), await endCursor(eventLogPath(shelf)));
  legacy('no-cursor', current.slice(0, 3));
  await announce('/unread-update.md');
  await announce('/read-update.md');
  legacy('newer', ['/read-update.md'], await endCursor(eventLogPath(shelf)));
  storage.setItem(`broken-docshelf-read-state:${shelf}`, '{bad');
  const before = new Map(storage.values);
  const first = reader();
  assert.deepEqual([...unreadSources(await first.sync(current), current)], ['/unread-update.md', '/new.md']);
  for (const [key, value] of before) assert.equal(storage.getItem(key), value, 'Migration must retain the legacy records.');
  await first.sync(current, ['/unread-update.md']);
  assert.deepEqual([...unreadSources(await reader().sync(current), current)], ['/new.md'], 'Restarting must use the shared record, not remigrate an old unread flag.');
  const other = reader(path.join(path.dirname(shelf), 'other.json'));
  assert.deepEqual([...unreadSources(await other.sync(current), current)], [], 'Different shelves retain independent histories.');
});

test('concurrent vaults preserve both reads and consume announcements with the shared state', async t => {
  const { reader, announce } = await fixture(t);
  const one = reader(), two = reader();
  const current = ['/a.md', '/b.md'];
  await announce('/a.md');
  assert.deepEqual([...unreadSources(await one.sync(current), current)], [], 'A fresh shelf starts read without replaying old announcements.');
  await two.sync(current);
  await announce('/a.md');
  await announce('/b.md');
  await Promise.all([one.sync(current, ['/a.md']), two.sync(current, ['/b.md'])]);
  assert.deepEqual([...unreadSources(await reader().sync([...current, '/new.md']), [...current, '/new.md'])], ['/new.md']);
  await announce('/a.md');
  assert.deepEqual([...unreadSources(await two.sync(current), current)], ['/a.md'], 'A later announcement must still mark a read document unread.');
  await one.sync(current, [], ['/a.md']);
  assert.deepEqual([...unreadSources(await two.sync(current), current)], [], 'A focused window seeing the document clears it for other vaults too.');
});

test('failed storage writes preserve the cursor so an update is retried, and corrupt shared state is not overwritten', async t => {
  const { reader, storage, announce } = await fixture(t);
  const store = reader();
  await store.sync(['/a.md']);
  const before = storage.getItem(store.key);
  await announce('/a.md');
  const failure = t.mock.method(storage, 'setItem', () => { throw new Error('Quota exceeded'); });
  await assert.rejects(store.sync(['/a.md']), /Quota exceeded/);
  assert.equal(storage.getItem(store.key), before);
  failure.mock.restore();
  assert.deepEqual([...unreadSources(await reader().sync(['/a.md']), ['/a.md'])], ['/a.md']);
  storage.setItem(store.key, '{"version":2}');
  await assert.rejects(reader().sync(['/a.md']), /invalid/);
  assert.equal(storage.getItem(store.key), '{"version":2}');
});

test('migration catches up across log chunks and normalizes remote identities, including absent documents', async t => {
  const { shelf, storage, reader } = await fixture(t);
  const remote = 'https://raw.githubusercontent.com/example/repo/main/guide.md';
  const seen = ['/old.md', '/last.md', remote, '/absent.md'];
  storage.setItem(`old-docshelf-read-state:${shelf}`, JSON.stringify({ version: 1, seen }));
  const event = (source: string, padding = '') => serializeEvent(createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source }, body: { text: padding } }));
  const log = event('/old.md', 'x'.repeat(8192)).repeat(130)
    + event('https://github.com/Example/Repo/blob/main/guide.md') + event('/absent.md') + event('/last.md');
  assert.ok(Buffer.byteLength(log) > 1024 * 1024);
  await writeFile(eventLogPath(shelf), log);
  const current = ['/old.md', '/last.md', remote];
  const state = await reader().sync(current);
  assert.deepEqual([...unreadSources(state, seen)], seen, 'Updates beyond the first chunk, and to temporarily absent sources, must survive migration.');
});
