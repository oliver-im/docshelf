export function createViewerLocation(route: string, query?: string, hash?: string): string;
export function createBrowserLink(site: string, route: string, range?: LineRange | null): string;
export function createObsidianLink(vault: string, source: string, range?: LineRange | null): string;
export function createSourceReference(source: string, local: boolean, range?: LineRange | null): string;
export type LineRange = {
    start: number;
    end: number;
};
