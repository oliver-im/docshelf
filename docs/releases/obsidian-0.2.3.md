# DocShelf for Obsidian 0.2.3 — desktop beta

This maintenance release addresses repository findings from Obsidian's review and improves contributor verification. The independent web app now has strict browser JavaScript type checking and typed lint checks, explicit DOM and library types, and validated message payloads. Its reader also tolerates malformed outline fragments and incomplete table markup. The installation guides link to the community listing, and a contributing guide explains setup and required checks.

The plugin's runtime behavior, supported sources, shelf format, settings, and recovery records are unchanged. The [review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) distinguish the fixes from intentional filesystem, clipboard, release-attachment, and CSS capabilities, plus scanner findings on code outside the plugin. Local verification does not predict the next hosted review's warning count.

## Install or update

Open the [community listing](https://community.obsidian.md/plugins/docshelf) for the installation link and current scorecard. For a manual install, download `docshelf-0.2.3.zip`, extract it, and copy the `docshelf` folder into `<vault>/.obsidian/plugins/`. To update manually, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three install assets have GitHub provenance attestations.

Requires desktop Obsidian **1.13.7 or later**. Runtime verification targets macOS with Obsidian 1.13.7 and Electron 34.2.0. Windows, Linux, and Obsidian 1.14.2 remain unverified; mobile is unsupported.
