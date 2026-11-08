export function readPins(stored: unknown): PinState;
export function setPinned(stored: unknown, source: string, pinned: boolean): PinState;
export function setFolderPinned(stored: unknown, identity: string, pinned: boolean): PinState;
export function folderPinIdentity(project: string, key: string): string;
export type PinState = {
    version: 1;
    sources: string[];
    folders: string[];
};
