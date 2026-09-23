# DocShelf for Obsidian 0.2.1 — desktop beta

This patch improves settings discovery and addresses the actionable findings from Obsidian's automated community review. Existing shelf files, settings, and recovery records remain compatible.

## Changes

- DocShelf settings now appear in Obsidian's settings search. Shelf changes still use **Save and reload**; the vault's readable-line-length preference still applies immediately.
- Strengthen types at parsing and desktop API boundaries, and use the appropriate window for view timers and animation callbacks.
- Make the plugin build discoverable from the repository root and generate GitHub provenance attestations for the three standard install assets.
- Add repeatable lint checks for the review's type, API, and DOM safety findings. The same repository also sanitizes DocShelf Web's Mermaid output while preserving diagram labels and source fallbacks.

The [review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) explain retained filesystem access, lock-owner process checks, user-triggered clipboard writes, and optional release attachments. The plugin's containment, recovery, and isolated HTML viewer protections remain in place.

## Install or update

Download `docshelf-0.2.1.zip`, extract it, and copy the `docshelf` folder into `<vault>/.obsidian/plugins/` for a fresh installation. To update, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; dependency licenses are included in the ZIP and embedded in `main.js`.

Requires desktop Obsidian **1.13.7 or later**. Runtime verification targets macOS with Obsidian 1.13.7 and Electron 34.2.0. Windows, Linux, and Obsidian 1.14.2 remain unverified; mobile is unsupported. Community review status is shown in the directory after publication and scanning.
