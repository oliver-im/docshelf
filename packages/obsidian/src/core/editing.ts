import { constants, closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { within } from './files';
import { MAX_DOCUMENT_BYTES } from './types';

export interface FileSnapshot { canonicalPath: string; bytes: Buffer }
export interface Recovery {
  version: 1;
  id: string;
  source: string;
  route: string;
  canonicalPath: string;
  baseline: string;
  text: string;
  pending: boolean;
  updated: number;
}

function checkedPath(file: string, roots: string[]): string {
  const canonical = realpathSync(file);
  if (!roots.some(root => within(root, canonical))) throw new Error('File is outside the configured workspace.');
  return canonical;
}

function checkHandle(fd: number, file: string, canonical: string, roots: string[]): void {
  const opened = fstatSync(fd);
  const currentPath = checkedPath(file, roots);
  const current = statSync(currentPath);
  if (currentPath !== canonical || opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('The source file was replaced. Reload it before saving.');
  if (!opened.isFile() || opened.size > MAX_DOCUMENT_BYTES) throw new Error('Source must be a regular file of at most 8 MB.');
}

function readHandle(fd: number): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset <= MAX_DOCUMENT_BYTES) {
    const part = Buffer.alloc(Math.min(64 * 1024, MAX_DOCUMENT_BYTES + 1 - offset));
    const size = readSync(fd, part, 0, part.length, offset);
    if (!size) return Buffer.concat(parts, offset);
    offset += size;
    if (offset > MAX_DOCUMENT_BYTES) throw new Error('Source exceeds the 8 MB limit.');
    parts.push(part.subarray(0, size));
  }
  throw new Error('Source exceeds the 8 MB limit.');
}

export function editorText(bytes: Buffer): string {
  // Reject invalid UTF-8 instead of silently writing replacement characters.
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
}

function encodeText(text: string, baseline: Buffer): Buffer {
  const original = baseline.toString('utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const bytes = Buffer.from(bom + text.replace(/\r\n?/g, '\n').replace(/\n/g, newline));
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 8 MB limit.');
  return bytes;
}

export function readEditableFile(file: string, roots: string[]): FileSnapshot {
  const canonicalPath = checkedPath(file, roots);
  const fd = openSync(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    checkHandle(fd, file, canonicalPath, roots);
    const bytes = readHandle(fd);
    checkHandle(fd, file, canonicalPath, roots);
    editorText(bytes);
    return { canonicalPath, bytes };
  } finally { closeSync(fd); }
}

/** A guarded, in-place write: never recreate a deleted file or follow a new target.
 * The caller persists recovery before calling this. Other applications do not
 * share a lock with us; the checks are conflict detection, not a filesystem CAS.
 */
export function saveEditableFile(file: string, roots: string[], baseline: FileSnapshot, text: string): FileSnapshot {
  const canonicalPath = checkedPath(file, roots);
  if (canonicalPath !== baseline.canonicalPath) throw new Error('The source target changed. Reload it before saving.');
  const bytes = encodeText(text, baseline.bytes);
  const fd = openSync(canonicalPath, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    checkHandle(fd, file, canonicalPath, roots);
    const current = readHandle(fd);
    if (!current.equals(baseline.bytes) && !current.equals(bytes)) throw new Error('The file changed outside this editor. Your edits have been kept.');
    if (!current.equals(bytes)) {
      checkHandle(fd, file, canonicalPath, roots);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!written) throw new Error('Could not finish writing the source file. Your edits have been kept.');
        offset += written;
      }
      ftruncateSync(fd, bytes.length);
      fsyncSync(fd);
    }
    checkHandle(fd, file, canonicalPath, roots);
    if (!readHandle(fd).equals(bytes)) throw new Error('The file changed while saving. Your edits have been kept.');
    return { canonicalPath, bytes };
  } finally { closeSync(fd); }
}

interface RecoveryPointer extends Omit<Recovery, 'version' | 'baseline' | 'text'> {
  version: 2;
  baselineFile: string;
  textFile: string;
}
type StoredRecovery = Recovery | RecoveryPointer;
interface OwnedRecovery { stored?: StoredRecovery; bytes?: Buffer; text?: string }

/** Private checkpoints. Version 2 keeps immutable baseline/text blobs behind an
 * atomically replaced metadata record. Older, self-contained records still load. */
export class RecoveryStore {
  private owned = new Map<string, OwnedRecovery>();
  constructor(readonly directory: string) {}

  adopt(draft: Recovery): void {
    const current = this.read(draft.id);
    if (!current || current.source !== draft.source || current.route !== draft.route || current.updated !== draft.updated || current.text !== draft.text || current.baseline !== draft.baseline) throw new Error('The recovery draft changed. Reopen the document to review it.');
    this.owned.set(draft.id, { stored: this.metadata(draft.id) || undefined, bytes: Buffer.from(draft.baseline, 'base64'), text: draft.text });
  }

  release(id: string): void { this.owned.delete(id); }

  private file(id: string): string {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('Invalid recovery identifier.');
    return path.join(this.directory, `${id}.json`);
  }

  private write(name: string, contents: string | Buffer): void {
    const target = path.join(this.directory, name);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
  }

  record(id: string, source: string, route: string, snapshot: FileSnapshot, text: string, pending: boolean): void {
    this.file(id);
    let owned = this.owned.get(id);
    if (!owned) {
      const stored = this.metadata(id) || undefined;
      if (stored?.pending) throw new Error('A pending recovery draft must be adopted before it can be replaced.');
      owned = { stored };
    }
    const previous = owned.stored;
    // A re-registration can change the shelf route; the draft still belongs to its source.
    if (previous?.pending && previous.source !== source) throw new Error('A pending recovery draft belongs to another document.');
    if (snapshot.bytes.length > MAX_DOCUMENT_BYTES || Buffer.byteLength(text) + snapshot.bytes.length > MAX_DOCUMENT_BYTES * 8) throw new Error('Recovery record exceeds 64 MB. Reduce the document size before saving.');
    const sameBaseline = !!owned.bytes?.equals(snapshot.bytes) && previous?.canonicalPath === snapshot.canonicalPath;
    const sameText = owned.text === text;
    if (previous && sameBaseline && sameText && previous.pending === pending && previous.source === source && previous.route === route) return;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const created: string[] = [];
    const blob = (suffix: string, content: string | Buffer): string => {
      const name = `${id}.${randomUUID()}.${suffix}`;
      this.write(name, content);
      created.push(name);
      return name;
    };
    let stored: RecoveryPointer;
    try {
      const baselineFile = sameBaseline && previous?.version === 2 ? previous.baselineFile : blob('baseline', snapshot.bytes);
      const textFile = sameText && previous?.version === 2 ? previous.textFile : blob('text', text);
      stored = { version: 2, id, source, route, canonicalPath: snapshot.canonicalPath, baselineFile, textFile, pending, updated: Date.now() };
      // Both blobs are fsynced before the metadata can refer to them, and the
      // caller waits for this checkpoint before touching the original source.
      this.write(`${id}.json`, JSON.stringify(stored));
    } catch (error) {
      for (const name of created) rmSync(path.join(this.directory, name), { force: true });
      throw error;
    }
    this.owned.set(id, { stored, bytes: snapshot.bytes, text });
    if (previous?.version === 2) {
      for (const name of [previous.baselineFile, previous.textFile]) if (name !== stored.baselineFile && name !== stored.textFile) {
        // The previous pointer is already replaced. Cleanup failure must not
        // turn a successfully persisted checkpoint into a save failure.
        try { rmSync(path.join(this.directory, name), { force: true }); } catch { /* Leave an unreferenced blob. */ }
      }
    }
  }

  private metadata(id: string): StoredRecovery | null {
    try {
      const file = this.file(id);
      if (statSync(file).size > MAX_DOCUMENT_BYTES * 8) return null;
      const value = JSON.parse(readFileSync(file, 'utf8')) as StoredRecovery;
      if (value.id !== id || typeof value.source !== 'string' || typeof value.route !== 'string' || typeof value.canonicalPath !== 'string' || typeof value.pending !== 'boolean' || !Number.isFinite(value.updated)) return null;
      if (value.version === 1) {
        if (typeof value.baseline !== 'string' || typeof value.text !== 'string' || Buffer.from(value.baseline, 'base64').length > MAX_DOCUMENT_BYTES) return null;
      } else if (value.version === 2) {
        const valid = (name: string, suffix: string) => typeof name === 'string' && name.startsWith(`${id}.`) && new RegExp(`^[a-f0-9-]{36}\\.[a-f0-9-]{36}\\.${suffix}$`).test(name);
        if (!valid(value.baselineFile, 'baseline') || !valid(value.textFile, 'text')) return null;
      } else return null;
      return value;
    } catch { return null; }
  }

  read(id: string): Recovery | null {
    try {
      const stored = this.metadata(id);
      if (!stored || stored.version === 1) return stored;
      const baseline = path.join(this.directory, stored.baselineFile), text = path.join(this.directory, stored.textFile);
      if (statSync(baseline).size > MAX_DOCUMENT_BYTES || statSync(text).size > MAX_DOCUMENT_BYTES * 8) return null;
      return { ...stored, version: 1, baseline: readFileSync(baseline).toString('base64'), text: readFileSync(text, 'utf8') };
    } catch { return null; }
  }

  pending(source: string, excluded: Set<string>): Recovery | undefined {
    let names: string[];
    try { names = readdirSync(this.directory); } catch { return undefined; }
    // Completed v2 records require only a small metadata read, never loading
    // their document contents just to discover that they aren't pending.
    const candidates = names.filter(name => name.endsWith('.json')).map(name => this.metadata(name.slice(0, -5)))
      .filter((value): value is StoredRecovery => !!value?.pending && value.source === source && !excluded.has(value.id))
      .sort((a, b) => b.updated - a.updated);
    for (const candidate of candidates) { const draft = this.read(candidate.id); if (draft) return draft; }
    return undefined;
  }
}
