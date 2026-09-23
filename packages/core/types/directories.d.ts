export function parseDirectories(value: unknown): DirectoryEntry[];
export function excludedPath(relative: string, exclude?: string[]): boolean;
export function filenameTitle(filename: string): string;
export function distinctTitle(title: string, filename: string): string;
export function documentTitle(source: string, filename: string): string;
export const documentExtensions: string[];
export const ignoredDirectoryNames: string[];
export type DirectoryEntry = {
    id: string;
    source: string;
    project: string;
    recursive: boolean;
    exclude: string[];
};
