export function parseEvent(line: string): DocShelfEvent | null;
export function createEvent({ from, type, subject, re, body }: {
    from: EventSender;
    type: string;
    subject?: EventSubject;
    re?: string;
    body?: EventBody;
}, { id, at }?: {
    id?: string;
    at?: Date;
}): DocShelfEvent;
export function serializeEvent(event: DocShelfEvent): string;
export function announcedUpdates(events: Iterable<DocShelfEvent>): string[];
export function validateEvent(value: unknown): DocShelfEvent;
export const EVENT_VERSION: 1;
export const MAX_EVENT_BYTES: number;
export const MAX_EVENT_TEXT: 8192;
export type EventSender = {
    role: "agent" | "user";
    name?: string;
    app?: string;
};
export type EventLines = {
    start: number;
    end: number;
};
export type EventSubject = {
    source?: string;
    lines?: EventLines;
    revision?: string;
};
export type EventBody = {
    text?: string;
    quote?: string;
    [key: string]: unknown;
};
export type DocShelfEvent = {
    v: 1;
    id: string;
    at: string;
    from: EventSender;
    type: string;
    subject?: EventSubject;
    re?: string;
    body?: EventBody;
};
