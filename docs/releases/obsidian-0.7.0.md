# DocShelf for Obsidian 0.7.0 — desktop beta

Read status now follows the shelf across Obsidian vaults on the same device. Opening the same shelf in another vault no longer brings back unread dots from that vault's separate history.

- Vault windows using the same absolute shelf path share read status and receive each other's updates. Opening a document or using **Mark all as read** clears its unread status across those windows.
- Existing vault histories migrate automatically. Each history processes pending announcements before the histories merge, so an older read flag cannot hide a newer document update. New documents and later announced updates still become unread.
- Read status and the announcement position save together under a shared lock, so simultaneous reads do not overwrite each other. Storage errors appear in the shelf status, and malformed saved records show a clear error without being overwritten.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.7.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Update DocShelf in every vault that uses the shared shelf. Read status is shared within one local Obsidian profile and the same absolute shelf path; separate devices, separate profiles, and DocShelf Web keep independent histories. Existing shelf files, routes, settings, and recovery records stay compatible. Read-history migration is automatic and retains the original vault records.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. The full packaged runtime suite passes on macOS with Obsidian **1.14.4**; focused shared-read checks pass on **1.13.7**. Windows and Linux remain unverified; mobile is unsupported.

Verification covers the aggregate tests, type and lint checks, builds, package checks, and the packaged runtime suite in disposable vaults. The shared-read checks use two real vault windows to exercise migration, concurrent reads, live sidebar updates, focused documents, and reload persistence. Package replacement checks preserve settings and pending recovery drafts. A regression test verifies that malformed saved JSON reports an invalid read status and leaves the stored record intact.

An initial Obsidian 1.14.4 run completed its functional checks but recorded six renderer `illegal access` errors. A full rerun with immediate error logging passed without renderer errors; the earlier failure remains unexplained.

The full Obsidian 1.13.7 runs stopped at an open menu intercepting a click and a tooltip that did not appear. Neither run reported renderer errors. A focused run of the shared-read checks passed, but a complete packaged 1.13.7 run has not passed for this release.
