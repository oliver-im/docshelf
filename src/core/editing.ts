import { constants, closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
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

/** Private recovery records, separate from the shelf and Obsidian's layout. */
export class RecoveryStore {
  constructor(readonly directory: string) {}

  private file(id: string): string {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('Invalid recovery identifier.');
    return path.join(this.directory, `${id}.json`);
  }

  record(id: string, source: string, route: string, snapshot: FileSnapshot, text: string, pending: boolean): void {
    const recovery: Recovery = { version: 1, id, source, route, canonicalPath: snapshot.canonicalPath, baseline: snapshot.bytes.toString('base64'), text, pending, updated: Date.now() };
    const serialized = JSON.stringify(recovery);
    if (Buffer.byteLength(serialized) > MAX_DOCUMENT_BYTES * 8) throw new Error('Recovery record exceeds 64 MB. Reduce the document size before saving.');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = this.file(id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeFileSync(fd, serialized); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, target);
  }

  read(id: string): Recovery | null {
    try {
      const file = this.file(id);
      if (statSync(file).size > MAX_DOCUMENT_BYTES * 8) return null;
      const value = JSON.parse(readFileSync(file, 'utf8')) as Recovery;
      if (value.version !== 1 || value.id !== id || typeof value.source !== 'string' || typeof value.route !== 'string' || typeof value.canonicalPath !== 'string' || typeof value.baseline !== 'string' || typeof value.text !== 'string' || typeof value.pending !== 'boolean') return null;
      if (Buffer.from(value.baseline, 'base64').length > MAX_DOCUMENT_BYTES) return null;
      return value;
    } catch { return null; }
  }

  pending(source: string, route: string, excluded: Set<string>): Recovery | undefined {
    let names: string[];
    try { names = readdirSync(this.directory); } catch { return undefined; }
    return names.filter(name => name.endsWith('.json')).map(name => this.read(name.slice(0, -5)))
      .filter((value): value is Recovery => !!value?.pending && value.source === source && value.route === route && !excluded.has(value.id))
      .sort((a, b) => b.updated - a.updated)[0];
  }
}
