# DocShelf for Obsidian 0.4.1 — desktop beta

Fix a stacked context menu when you right-click a source reference twice.

- Right-clicking a selected source range or a line button while its DocShelf menu is still open now replaces that menu instead of opening a second one beside it. This applies across split panes. Other menus that are open at the time, such as Obsidian's editor menu, may still need to be closed separately.

## Install or update

Open the [community listing](https://community.obsidian.md/plugins/docshelf) for the installation link and current scorecard. For a manual install, download `docshelf-0.4.1.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelf files, routes, settings, read state, and recovery records remain compatible; no migration is required.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Local runtime checks target macOS with Obsidian 1.13.7. Windows, Linux, and later Obsidian versions remain unverified; mobile is unsupported.

The aggregate tests, type and lint checks, builds, and package checks pass. The runtime suite has a new check that right-clicks a reference while its menu is open; it fails without this fix and passes with it. The complete packaged 0.4.1 runtime suite passed in a disposable vault with no renderer errors; other local runs still fail intermittently at unrelated timing-sensitive steps.
