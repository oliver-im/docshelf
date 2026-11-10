# DocShelf for Obsidian 0.10.0: desktop beta

Pin whole projects alongside folders and documents. Right-click a project heading, or focus it and press **Shift+F10**, then choose **Pin project**. Its shortcut appears in **Pinned** above the project list. Selecting the shortcut opens and focuses the original project. Choose **Unpin project** from either location to remove it.

- Projects containing only empty registered folders can be pinned. Temporarily absent projects regain their shortcut when they return under the same exact name. Renaming a project creates a different identity.
- Project, folder, and document pins use one shared set of pin helpers, with independent identities and storage records. Pinning a project does not pin its folders or documents, and unpinning one kind leaves the other kinds intact.
- Separate device-local storage records and shared cross-window coordination preserve existing pins, including when older app windows update document or folder pins. No shelf or source document changes are needed.
- DocShelf Web also gains project pin actions and shortcuts, while keeping separate pins for each app and shelf.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf).

For a fresh manual install, download `docshelf-0.10.0.zip`, extract it, and copy its `docshelf` folder into your vault's `.obsidian/plugins/` folder, creating the parent folder if necessary. Enable DocShelf in Community plugins afterward.

For a manual update, save or review pending Markdown edits, then disable DocShelf before replacing files. Copy `main.js`, `manifest.json`, and `styles.css` from the ZIP into the existing `.obsidian/plugins/docshelf/` folder. **Keep `data.json` and `recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelves, routes, settings, recovery records, and document and folder pins remain compatible. Pins are device-local reading preferences stored outside the shared shelf and source documents. No migration is required.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Native runtime tests pass on macOS with Obsidian **1.15.0**, including project, folder, and document pin persistence, keyboard actions, empty registrations, and concurrent vault windows. Browser pin interactions, package integrity, and aggregate checks/builds pass. A full 1.13.7 runtime run is not claimed. Windows and Linux remain unverified; mobile is unsupported. The [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) distinguish intentional plugin capabilities from hosted scanner findings on the independent web app.
