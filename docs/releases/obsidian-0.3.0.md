# DocShelf for Obsidian 0.3.0 — desktop beta

Browse registered folders as a collapsible tree and remove a folder or an entire project from the shelf without deleting its original files.

- Keep explicitly registered folders visible when they contain no documents, with a muted “No documents” label. Their project stays visible, and newly discovered documents appear in the same folder.
- Preserve registered folder boundaries while compacting other single-folder chains. Unregistered empty descendants stay out of the tree.
- Reorder sibling folders and documents within their containing folder, with saved collapse state and stable folder identities as documents appear or disappear.
- Remove folders and projects through their existing context menus. Confirmations show the affected documents and registrations, protect unsaved drafts, and revalidate the shelf before applying the change. Removed subfolders receive exclusions so their documents do not return through a parent registration.

The corresponding web app improvements are available from the updated checkout, including consistent project grouping when a hand-edited shelf contains surrounding whitespace in project names. DocShelf Web and the Obsidian plugin are updated separately.

## Install or update

Open the [community listing](https://community.obsidian.md/plugins/docshelf) for the installation link and current scorecard. For a manual install, download `docshelf-0.3.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelf files, routes, settings, and recovery records remain compatible; no migration is required. Folder and project removal changes registrations and exclusions, never the original source files.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Local runtime checks target macOS with Obsidian 1.13.7 and Electron 34.2.0. Windows, Linux, and Obsidian 1.14.2 remain unverified; mobile is unsupported.

The aggregate tests, type and lint checks, builds, and package checks pass. The complete packaged 0.3.0 runtime suite passed in a disposable vault, including fresh installation, preservation of settings and recovery files during plugin replacement, and the new folder lifecycle. Earlier local runs intermittently reported `illegal access` renderer errors, also seen on the earlier branch revision; the successful packaged run reported none.
