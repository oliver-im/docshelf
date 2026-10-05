# DocShelf for Obsidian 0.6.0 — desktop beta

Clear a folder or project's unread documents in one action.

- Right-click a folder or project and choose **Mark all as read**, directly above **Remove from shelf…**. The action includes documents in collapsed subfolders, leaves other groups unread, and is disabled when everything in the group is already read.
- Documents that arrive later still become unread. Read state stays on your device, and the action does not open documents or change their source files or the shared shelf.
- DocShelf Web includes the same menu action, including on static sites where shelf removal is unavailable. Its read state remains separate from Obsidian's.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.6.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelf files, routes, settings, read state, and recovery records remain compatible; no migration is required. Update your web checkout separately to use the web menu action.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Local runtime checks target macOS with Obsidian 1.13.7. Windows, Linux, and later Obsidian versions remain unverified; mobile is unsupported.

Verification covers the aggregate tests, type and lint checks, builds, package checks, and the packaged runtime suite in a disposable vault. The bulk-read checks exercise nested and collapsed folders, project boundaries, persistence, disabled actions, and later arrivals. Browser checks also cover keyboard navigation, static hosting, and read state shared between tabs.
