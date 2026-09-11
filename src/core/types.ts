export interface ShelfEntry {
  project: string;
  source: string;
  route: string;
  title: string;
  description: string;
  /** Asset paths relative to this local document's directory. */
  assets?: string[];
}

export interface Shelf { version: 1; artifacts: ShelfEntry[] }

export interface Artifact extends ShelfEntry {
  id: string;
  kind: 'markdown' | 'html' | 'github' | 'claude';
  sourcePath?: string;
  canonicalPath?: string;
  rawUrl?: string;
  linkBaseUrl?: string;
}

export interface Catalog {
  artifacts: Artifact[];
  shelfPath: string;
  roots: string[];
}

export interface LineRange { start: number; end: number }

export interface Settings {
  shelfPath: string;
  workspaceRoot: string;
  runHtmlScripts: boolean;
  vaultId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  shelfPath: 'shelf.local.json',
  workspaceRoot: '',
  runHtmlScripts: true,
  vaultId: '',
};

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_REMOTE_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
