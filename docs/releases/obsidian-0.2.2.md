# DocShelf for Obsidian 0.2.2 — desktop beta

This patch resolves the remaining source-code error found by Obsidian's hosted review of `0.2.1`. The HTML viewer now creates its Electron webview through Obsidian's typed element helper, without a forbidden lint exception. It keeps the guest detached until its sandbox, private session, and navigation guard are configured.

Shelf files, settings, recovery records, and document behavior remain compatible. The [review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) explain the retained capability and CSS advisories.

## Install or update

Download `docshelf-0.2.2.zip`, extract it, and copy the `docshelf` folder into `<vault>/.obsidian/plugins/` for a fresh installation. To update, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three install assets have GitHub provenance attestations.

Requires desktop Obsidian **1.13.7 or later**. Runtime verification targets macOS with Obsidian 1.13.7 and Electron 34.2.0. Windows, Linux, and Obsidian 1.14.2 remain unverified; mobile is unsupported.
