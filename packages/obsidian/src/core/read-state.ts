import path from 'node:path';
import { markRead, markUnread, reconcileReadState, type ReadState } from '@docshelf/core/read-state';
import { announcedUpdates } from '@docshelf/core/events';
import { parseClaudeArtifactUrl } from '@docshelf/core/claude-artifacts';
import { parseGitHubMarkdownUrl } from '@docshelf/core/github-markdown';
import { endCursor, eventLogPath, isEventCursor, readEvents, type EventCursor } from '../../../local/events.mjs';

interface StoredReadState { version: 1; state: ReadState; cursor: EventCursor }
type ReadStorage = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>;
type Exclusive = <T>(name: string, update: () => Promise<T>) => Promise<T>;

/** One record per shelf in Obsidian's device-local profile, shared by every vault window. */
export class ShelfReadState {
  readonly key: string;
  private readonly log: string;

  constructor(readonly shelfPath: string, private storage: ReadStorage, private exclusive: Exclusive) {
    this.key = `docshelf:obsidian:read-state:${shelfPath}`;
    this.log = eventLogPath(shelfPath);
  }

  async sync(current: string[], read: string[] = [], shown: string[] = []): Promise<ReadState> {
    // A window must reload under the shared lock, including after waiting for log I/O.
    // Saving the cursor and read state together prevents another window replaying a consumed update.
    return this.exclusive(this.key, async () => {
      const stored = this.storage.getItem(this.key);
      const record: unknown = stored === null ? await this.migrate(current) : JSON.parse(stored);
      if (!isStoredReadState(record)) throw new Error('The saved shelf read status is invalid.');
      const next = await this.catchUp(record);
      next.state = markRead(reconcileReadState(next.state, current), [...read, ...shown]);
      const serialized = JSON.stringify(next);
      if (serialized !== stored) this.storage.setItem(this.key, serialized);
      return next.state;
    });
  }

  private async migrate(current: string[]): Promise<StoredReadState> {
    const suffix = `-docshelf-read-state:${this.shelfPath}`;
    const histories: StoredReadState[] = [];
    // Obsidian's app.loadLocalStorage prefixes keys with its vault ID. Read all
    // histories for this exact shelf once, without changing the legacy records.
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.endsWith(suffix)) continue;
      const state = parseLegacy(this.storage.getItem(key));
      if (!isReadState(state)) continue;
      const vault = key.slice(0, -suffix.length);
      const cursor = parseLegacy(this.storage.getItem(`${vault}-docshelf-event-cursor:${this.shelfPath}`));
      // A history without a cursor cannot establish that it read an announced update.
      histories.push(await this.catchUp({ version: 1, state, cursor: isEventCursor(cursor) ? cursor : { offset: 0, lastId: null } }));
    }
    if (!histories.length) return { version: 1, state: reconcileReadState(null, current), cursor: await endCursor(this.log) };
    // Catch each history up BEFORE merging: an old vault's read flag must not
    // erase an update that a newer vault has already received but not read.
    const state: ReadState = { version: 1, seen: [...new Set(histories.flatMap(history => history.state.seen))] };
    // The log can grow during migration. Replay from the earliest caught-up
    // position once more so an update arriving between histories is not lost.
    const cursor = histories.reduce((earliest, history) => history.cursor.offset < earliest.offset ? history.cursor : earliest, histories[0].cursor);
    return { version: 1, state, cursor };
  }

  private async catchUp(record: StoredReadState): Promise<StoredReadState> {
    const end = await endCursor(this.log);
    let { state, cursor } = record;
    do {
      const result = await readEvents(this.log, cursor);
      for (const warning of result.warnings) console.warn(`DocShelf event log: ${warning}`);
      const updated = announcedUpdates(result.events).flatMap(source => {
        const identity = parseClaudeArtifactUrl(source)?.publicUrl || parseGitHubMarkdownUrl(source)?.rawUrl || (path.isAbsolute(source) ? source : null);
        return identity ? [identity] : [];
      });
      state = markUnread(state, updated);
      const previous = cursor;
      cursor = result.cursor;
      if (result.reset || cursor.offset === previous.offset) break;
    } while (cursor.offset < end.offset);
    return { version: 1, state, cursor };
  }
}

function parseLegacy(text: string | null): unknown {
  try { return text === null ? null : JSON.parse(text); } catch { return null; }
}

function isReadState(value: unknown): value is ReadState {
  if (!value || typeof value !== 'object') return false;
  const { version, seen } = value as Partial<ReadState>;
  return version === 1 && Array.isArray(seen) && seen.every(id => typeof id === 'string');
}

function isStoredReadState(value: unknown): value is StoredReadState {
  if (!value || typeof value !== 'object') return false;
  const { version, state, cursor } = value as Partial<StoredReadState>;
  return version === 1 && isReadState(state) && isEventCursor(cursor);
}
