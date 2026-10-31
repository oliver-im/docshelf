export function readPins(stored: unknown): PinState;
export function setPinned(stored: unknown, source: string, pinned: boolean): PinState;
export type PinState = {
    version: 1;
    sources: string[];
};
