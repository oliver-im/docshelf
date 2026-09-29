import assert from 'node:assert/strict';
import test from 'node:test';
import { markRead, markUnread, reconcileReadState, unreadSources } from '../src/read-state.js';

test('documents already on the shelf start read, and only later arrivals are unread until opened', () => {
  for (const stored of [null, 'corrupted', [], { version: 2, seen: [] }, { version: 1, seen: [1] }]) {
    const state = reconcileReadState(stored, ['a', 'b']);
    assert.deepEqual([...unreadSources(state, ['a', 'b'])], [], `stored ${JSON.stringify(stored)}`);
  }
  const state = reconcileReadState(reconcileReadState(null, ['a', 'b']), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...unreadSources(state, ['a', 'b', 'c', 'd'])], ['c', 'd']);
  const opened = markRead(state, ['c']);
  assert.deepEqual([...unreadSources(opened, ['a', 'b', 'c', 'd'])], ['d']);
});

test('a document that leaves the shelf stays read when it returns, within the retention limit', () => {
  const returning = reconcileReadState(reconcileReadState(null, ['a', 'b']), ['a']);
  assert.deepEqual([...unreadSources(reconcileReadState(returning, ['a', 'b']), ['a', 'b'])], []);

  // 1,001 absent documents exceed the limit of 1,000 by one; the oldest goes, and present ones are never dropped.
  const absent = Array.from({ length: 1001 }, (_, index) => `gone-${index}`);
  const trimmed = reconcileReadState({ version: 1, seen: ['present', ...absent] }, ['present']);
  const current = ['present', 'gone-0', 'gone-1', 'gone-1000'];
  assert.deepEqual([...unreadSources(trimmed, current)], ['gone-0']);
});

test('an announced update makes a read document unread until it is opened again', () => {
  const read = reconcileReadState(null, ['a', 'b']);
  const updated = markUnread(markUnread(read, ['b', 'not-on-shelf']), ['b']);
  // The next shelf load must not treat the document as already read.
  const reloaded = reconcileReadState(updated, ['a', 'b']);
  assert.deepEqual([...unreadSources(reloaded, ['a', 'b'])], ['b']);
  assert.deepEqual([...unreadSources(markRead(reloaded, ['b']), ['a', 'b'])], []);
});
