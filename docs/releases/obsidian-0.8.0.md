# DocShelf for Obsidian 0.8.0 — desktop beta

Pin frequently used documents above the project list. Right-click a document, or focus its row and press **Shift+F10**, then choose **Pin document**. The **Pinned** section shows a shortcut with its project and folder; the original row keeps a pin indicator. Choose **Unpin document** from either location to remove the shortcut.

- Pins follow the source when its title or shelf route changes, survive restarts, and return when a temporarily absent document reappears.
- Vault windows using the same shelf on this device share pins. Concurrent updates preserve each other's changes. Different shelves, devices, and DocShelf Web keep separate pin lists.
- Keyboard focus returns to the original document after unpinning, including when its folder was collapsed. Escape dismisses shelf menus even after a background refresh changes the active keyboard scope.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.8.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelves, routes, settings, and recovery records remain compatible. Pins are device-local reading preferences stored outside the shared shelf and source documents. No migration is required.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. This release is verified on macOS with Obsidian **1.14.5**, including the aggregate checks, package checks, and packaged runtime suite in disposable vaults. Runtime coverage includes pin persistence, renamed routes, separate shelves, nested folder context, keyboard controls, and simultaneous pin changes in two vault windows. Package replacement preserves settings and pending recovery drafts.

Earlier focused shared-read checks covered Obsidian 1.13.7; a complete 1.13.7 runtime run is not claimed for this release. Windows and Linux remain unverified; mobile is unsupported. The [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) distinguish intentional plugin capabilities from hosted scanner findings on the independent web app.
