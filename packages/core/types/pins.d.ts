export function readPins(stored: unknown): PinState;
export function pinnedIdentities(stored: unknown, kind: PinKind): string[];
export function pinStorageKey(base: string, kind: PinKind): string;
export function setPin(stored: unknown, kind: PinKind, identity: string, pinned: boolean): PinState;
export function setPinned(stored: unknown, source: string, pinned: boolean): PinState;
export function setFolderPinned(stored: unknown, identity: string, pinned: boolean): PinState;
export function folderPinIdentity(project: string, key: string): string;
export type PinKind = "document" | "folder" | "project";
export type PinState = {
    version: 1;
    sources: string[];
    folders: string[];
    projects: string[];
};
