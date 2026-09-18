import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { editorText, readEditableFile, RecoveryStore, saveEditableFile } from '../src/core/editing';

function fixture() {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'docshelf-edit-')));
  const source = path.join(directory, 'note.md');
  writeFileSync(source, '# Original\n', { mode: 0o640 });
  return { directory, source, roots: [directory], cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('native editor saves the original inode, permissions, UTF-8 BOM, and CRLF convention', () => {
  const f = fixture();
  try {
    writeFileSync(f.source, '\uFEFF# 한글\r\n\r\nBefore\r\n');
    const before = statSync(f.source);
    const snapshot = readEditableFile(f.source, f.roots);
    assert.equal(editorText(snapshot.bytes), '# 한글\n\nBefore\n');
    const saved = saveEditableFile(f.source, f.roots, snapshot, '# 한글\n\nAfter\n');
    assert.equal(readFileSync(f.source, 'utf8'), '\uFEFF# 한글\r\n\r\nAfter\r\n');
    assert.equal(statSync(f.source).ino, before.ino);
    assert.equal(statSync(f.source).mode, before.mode);
    assert.equal(editorText(saved.bytes), '# 한글\n\nAfter\n');
  } finally { f.cleanup(); }
});

test('stale edits never knowingly overwrite an external change or another pane', () => {
  const f = fixture();
  try {
    const original = readEditableFile(f.source, f.roots);
    saveEditableFile(f.source, f.roots, original, '# First pane\n');
    assert.throws(() => saveEditableFile(f.source, f.roots, original, '# Second pane\n'), /changed outside/);
    assert.equal(readFileSync(f.source, 'utf8'), '# First pane\n');
    // The same edit arriving from a second pane is already saved.
    saveEditableFile(f.source, f.roots, original, '# First pane\n');
    writeFileSync(f.source, '# Agent edit\n');
    assert.throws(() => saveEditableFile(f.source, f.roots, original, '# Mine\n'), /changed outside/);
    assert.equal(readFileSync(f.source, 'utf8'), '# Agent edit\n');
    rmSync(f.source);
    assert.throws(() => saveEditableFile(f.source, f.roots, original, '# Mine\n'), /ENOENT/);
  } finally { f.cleanup(); }
});

test('saving rechecks containment and rejects replacement symlink targets', () => {
  const f = fixture();
  const outside = fixture();
  try {
    const original = readEditableFile(f.source, f.roots);
    rmSync(f.source);
    symlinkSync(outside.source, f.source);
    assert.throws(() => saveEditableFile(f.source, f.roots, original, '# Escaped\n'), /outside/);
    assert.equal(readFileSync(outside.source, 'utf8'), '# Original\n');
    rmSync(f.source);
    const replacement = path.join(f.directory, 'replacement.md');
    writeFileSync(replacement, '# Original\n');
    symlinkSync(replacement, f.source);
    assert.throws(() => saveEditableFile(f.source, f.roots, original, '# Replaced\n'), /target changed/);
    assert.equal(readFileSync(replacement, 'utf8'), '# Original\n');
  } finally { f.cleanup(); outside.cleanup(); }
});

test('recovery retains original and edited versions independently per pane across restart', () => {
  const f = fixture();
  try {
    const directory = path.join(f.directory, 'recovery');
    const store = new RecoveryStore(directory);
    const snapshot = readEditableFile(f.source, f.roots);
    const one = randomUUID(), two = randomUUID();
    store.record(one, f.source, 'note.html', snapshot, '# First draft\n', true);
    store.record(two, f.source, 'note.html', snapshot, '# Second draft\n', true);
    const reopened = new RecoveryStore(directory);
    assert.equal(reopened.read(one)?.text, '# First draft\n');
    assert.equal(Buffer.from(reopened.read(two)!.baseline, 'base64').toString(), '# Original\n');
    assert.equal(reopened.pending(f.source, 'note.html', new Set([two]))?.id, one);
    assert.equal(reopened.pending(f.source, 'other.html', new Set()), undefined);
    assert.throws(() => reopened.record(one, f.source, 'note.html', snapshot, '# Unrelated edit\n', true), /adopted/);
    assert.equal(reopened.read(one)?.text, '# First draft\n');
    reopened.adopt(reopened.read(two)!);
    reopened.record(two, f.source, 'note.html', snapshot, '# Second recovered draft\n', true);
    assert.equal(reopened.read(two)?.text, '# Second recovered draft\n');
    store.record(one, f.source, 'note.html', snapshot, '# First draft\n', false);
    assert.equal(reopened.pending(f.source, 'note.html', new Set([two])), undefined);
    assert.equal(statSync(path.join(directory, `${one}.json`)).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test('editing rejects invalid UTF-8 and oversized writes without changing the source', () => {
  const f = fixture();
  try {
    const snapshot = readEditableFile(f.source, f.roots);
    assert.throws(() => saveEditableFile(f.source, f.roots, snapshot, 'x'.repeat(8 * 1024 * 1024 + 1)), /8 MB/);
    assert.equal(readFileSync(f.source, 'utf8'), '# Original\n');
    writeFileSync(f.source, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readEditableFile(f.source, f.roots), /encoded data/);
  } finally { f.cleanup(); }
});

test('recovery checkpoints reuse the baseline, retire superseded blobs, and load legacy drafts', () => {
  const f = fixture();
  try {
    const directory = path.join(f.directory, 'recovery');
    const store = new RecoveryStore(directory), id = randomUUID();
    const snapshot = readEditableFile(f.source, f.roots);
    const metadata = () => JSON.parse(readFileSync(path.join(directory, `${id}.json`), 'utf8'));
    store.record(id, f.source, 'note.html', snapshot, 'One', true);
    const first = metadata();
    const baselineInode = statSync(path.join(directory, first.baselineFile)).ino;
    store.record(id, f.source, 'note.html', snapshot, 'Two', true);
    const second = metadata();
    assert.equal(second.baselineFile, first.baselineFile);
    assert.equal(statSync(path.join(directory, second.baselineFile)).ino, baselineInode);
    assert.notEqual(second.textFile, first.textFile);
    assert.equal(readdirSync(directory).length, 3, 'A pane retains only its current checkpoint and two blobs.');
    store.record(id, f.source, 'note.html', snapshot, 'Two', false);
    assert.equal(metadata().textFile, second.textFile, 'Marking saved must not rewrite the document blobs.');
    assert.equal(store.read(id)?.pending, false);
    for (const name of readdirSync(directory)) assert.equal(statSync(path.join(directory, name)).mode & 0o777, 0o600);

    const legacy = randomUUID();
    writeFileSync(path.join(directory, `${legacy}.json`), JSON.stringify({ version: 1, id: legacy, source: f.source, route: 'note.html', canonicalPath: snapshot.canonicalPath, baseline: snapshot.bytes.toString('base64'), text: 'Legacy draft', pending: true, updated: Date.now() }));
    assert.equal(store.pending(f.source, 'note.html', new Set())?.text, 'Legacy draft');
    assert.throws(() => store.record(legacy, f.source, 'note.html', snapshot, 'Replacement', true), /adopted/);
    store.adopt(store.read(legacy)!);
    store.record(legacy, f.source, 'note.html', snapshot, 'Recovered legacy draft', true);
    assert.equal(new RecoveryStore(directory).read(legacy)?.text, 'Recovered legacy draft');

    // Fail before committing a replacement pointer. The previous durable draft
    // must still be readable; temporary writes must not destroy it.
    const pending = randomUUID();
    store.record(pending, f.source, 'note.html', snapshot, 'Durable draft', true);
    const failing = new RecoveryStore(directory);
    failing.adopt(failing.read(pending)!);
    const failure = new Error('Simulated metadata write failure');
    const writer = (failing as any).write.bind(failing);
    (failing as any).write = (name: string, contents: string | Buffer) => { if (name.endsWith('.json')) throw failure; writer(name, contents); };
    assert.throws(() => failing.record(pending, f.source, 'note.html', snapshot, 'Uncommitted replacement', true), /Simulated/);
    assert.equal(new RecoveryStore(directory).read(pending)?.text, 'Durable draft');
    assert.equal(readdirSync(directory).filter(name => name.startsWith(pending)).length, 3);
  } finally { f.cleanup(); }
});
