/** Desktop host APIs used by this desktop-only plugin; never exposed to report guests. */
declare module 'electron' {
  export const shell: {
    showItemInFolder(path: string): void;
    openExternal(url: string): Promise<void>;
  };
  export const webFrame: {
    getZoomFactor(): number;
  };
}

declare module '@electron/remote' {
  export const dialog: {
    showOpenDialog(options: { title: string; buttonLabel: string; properties: string[]; defaultPath: string }): Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  export const webContents: {
    fromId(id: number): {
      getZoomFactor(): number;
      executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>;
    } | undefined;
  };
  export const session: {
    fromPartition(partition: string): {
      webRequest: {
        onBeforeRequest(filter: { urls: string[] }, listener: ((details: { url: string; resourceType: string }, callback: (response: { cancel?: boolean }) => void) => void) | null): void;
      };
    };
  };
}
