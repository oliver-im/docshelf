import assert from 'node:assert/strict';
import test from 'node:test';
import { announcedUpdates, createEvent, parseEvent, serializeEvent } from '../src/events.js';

const valid = {
  v: 1,
  id: '6f1c2d4e-0000-4000-8000-000000000001',
  at: '2026-09-28T11:40:00Z',
  from: { role: 'agent', name: 'claude-code' },
  type: 'document.updated',
  subject: { source: '/Users/me/projects/app/docs/plan.md', revision: `sha256:${'a'.repeat(64)}` },
  body: { text: 'Reordered the rollout steps.' },
};

test('events follow the documented format, and readers skip what they cannot trust', () => {
  assert.deepEqual(parseEvent(JSON.stringify(valid)), valid);
  // Comments are not implemented, but their documented shape must already read as valid.
  const comment = { ...valid, from: { role: 'user', app: 'obsidian' }, type: 'comment.created', subject: { ...valid.subject, lines: { start: 7, end: 11 } }, body: { text: 'Why this order?', quote: '1. Migrate' } };
  assert.deepEqual(parseEvent(JSON.stringify(comment)), comment);
  assert.deepEqual(parseEvent(JSON.stringify({ ...valid, later: { field: true } })).later, { field: true }, 'Fields added later in version 1 are kept, not rejected.');
  assert.equal(parseEvent(JSON.stringify({ ...valid, v: 2, type: 'anything' })), null, 'A newer format version is skipped, not reported as invalid.');

  const invalid = {
    'not JSON': '{"v":1,',
    'an array': '[]',
    'version 0': JSON.stringify({ ...valid, v: 0 }),
    'no ID': JSON.stringify({ ...valid, id: undefined }),
    'an ID with spaces': JSON.stringify({ ...valid, id: 'a b' }),
    'an unparseable time': JSON.stringify({ ...valid, at: 'yesterday' }),
    'an unknown role': JSON.stringify({ ...valid, from: { role: 'system' } }),
    'a control character in the sender name': JSON.stringify({ ...valid, from: { role: 'agent', name: 'a\nb' } }),
    'an undotted type': JSON.stringify({ ...valid, type: 'updated' }),
    'an update without a source': JSON.stringify({ ...valid, subject: { revision: valid.subject.revision } }),
    'reversed lines': JSON.stringify({ ...valid, subject: { ...valid.subject, lines: { start: 11, end: 7 } } }),
    'line zero': JSON.stringify({ ...valid, subject: { ...valid.subject, lines: { start: 0, end: 1 } } }),
    'a revision without its algorithm': JSON.stringify({ ...valid, subject: { ...valid.subject, revision: 'a'.repeat(64) } }),
    'a NUL in the text': JSON.stringify({ ...valid, body: { text: 'a\0b' } }),
    'text over 8,192 characters': JSON.stringify({ ...valid, body: { text: 'x'.repeat(8193) } }),
    'a line over 16 KiB': JSON.stringify({ ...valid, body: { text: 'x'.repeat(8192), quote: 'y'.repeat(8192) } }),
  };
  for (const [name, line] of Object.entries(invalid)) assert.throws(() => parseEvent(line), Error, name);
});

test('each serialized event is exactly one line that reads back unchanged', () => {
  const event = createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source: '/tmp/문서.md' }, body: { text: 'First line\nsecond line' } }, { id: 'fixed-id', at: new Date('2026-09-28T00:00:00Z') });
  const line = serializeEvent(event);
  assert.equal(line.indexOf('\n'), line.length - 1, 'A newline in the text must not split the event across lines.');
  assert.deepEqual(parseEvent(line.slice(0, -1)), { v: 1, id: 'fixed-id', at: '2026-09-28T00:00:00.000Z', from: { role: 'agent' }, type: 'document.updated', subject: { source: '/tmp/문서.md' }, body: { text: 'First line\nsecond line' } });
  assert.notEqual(createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source: '/a.md' } }).id, createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source: '/a.md' } }).id);
  // Text within its character limit can still exceed the line's byte limit.
  assert.throws(() => serializeEvent(createEvent({ from: { role: 'agent' }, type: 'document.updated', subject: { source: '/a.md' }, body: { text: '한'.repeat(8192) } })), /16 KiB/);
  assert.throws(() => createEvent({ from: { role: 'agent' }, type: 'document.updated' }), /subject.source/);
});

test('only agents announce updates; the reader’s own events and other types never mark documents unread', () => {
  const event = (fields) => ({ ...valid, ...fields });
  assert.deepEqual(announcedUpdates([
    event({ subject: { source: '/a.md' } }),
    event({ from: { role: 'user', app: 'obsidian' }, subject: { source: '/b.md' } }),
    event({ type: 'comment.created', subject: { source: '/c.md' } }),
    event({ subject: { source: '/d.md' } }),
  ]), ['/a.md', '/d.md']);
});
