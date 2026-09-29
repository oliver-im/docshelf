export function reconcileReadState(stored: unknown, current: Iterable<string>): ReadState;
export function markRead(state: ReadState, ids: Iterable<string>): ReadState;
export function markUnread(state: ReadState, ids: Iterable<string>): ReadState;
export function unreadSources(state: ReadState, current: Iterable<string>): Set<string>;
export type ReadState = {
    version: 1;
    seen: string[];
};
