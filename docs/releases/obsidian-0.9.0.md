# DocShelf for Obsidian 0.9.0 — desktop beta

Pin folders as well as documents above the project list. Right-click a folder, or focus its row and press **Shift+F10**, then choose **Pin folder**. Its **Pinned** shortcut shows the folder path and project; selecting it reveals and focuses the original folder, opening collapsed ancestors. Choose **Unpin folder** from either location to remove the shortcut.

- Folder pins support empty registered folders, distinguish matching folder names in different projects, and survive restarts and temporary absence from the shelf.
- Pins keep following the same folder when single-folder chains merge or split in the sidebar. Unpinning a merged row clears its pinned aliases together.
- Document and folder pins share device-local storage and cross-window updates without overwriting each other. Existing document pins remain intact; no shelf or source document changes are needed.
- DocShelf Web also gains folder pin actions and shortcuts, with separate pins for each app and shelf.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.9.0.zip`, extract it, and copy `main.js`, `manifest.json`, and `styles.css` into the existing `.obsidian/plugins/docshelf/` folder. **Keep `data.json` and `recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelves, routes, settings, recovery records, and document pins remain compatible. Pins are device-local reading preferences stored outside the shared shelf and source documents. No migration is required.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Windows and Linux remain unverified; mobile is unsupported. The [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) distinguish intentional plugin capabilities from hosted scanner findings on the independent web app.
