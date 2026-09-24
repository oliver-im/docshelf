export function parseDirectories(value: unknown): DirectoryEntry[];
export function excludedPath(relative: string, exclude?: string[]): boolean;
export function documentTree<T>(entries: Array<{
    item: T;
    folders: FolderSegment[];
}>, registrations?: FolderSegment[][]): DocumentTreeNode<T>[];
export function filenameTitle(filename: string): string;
export function distinctTitle(title: string, filename: string): string;
export function documentTitle(source: string, filename: string): string;
export const documentExtensions: string[];
export const ignoredDirectoryNames: string[];
export type FolderSegment = {
    name: string;
    key: string;
    registered?: boolean;
};
export type DocumentTreeNode<T> = {
    type: "folder";
    name: string;
    key: string;
    orderKey: string;
    path: string[];
    registered: boolean;
    count: number;
    children: DocumentTreeNode<T>[];
} | {
    type: "document";
    item: T;
};
export type TreeBranch<T> = {
    folders: Map<string, TreeBranch<T> & FolderSegment>;
    documents: T[];
};
export type DirectoryEntry = {
    id: string;
    source: string;
    project: string;
    recursive: boolean;
    exclude: string[];
};
