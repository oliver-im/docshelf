# DocShelf for Obsidian 0.5.0 — desktop beta

Cite source lines directly from rendered HTML reports.

- Select report text or right-click a block to highlight its source lines and copy a `file.html:line-range` reference. A copy button follows the highlighted selection as the report scrolls, and the view actions switch between the report and its selected source lines.
- Report selections stay current after reloads and script-driven DOM changes. Clipboard actions validate the current selection and the injected button's placement; report scripts remain isolated from Obsidian's privileged environment, but the report DOM itself remains untrusted.
- Report drags avoid activating the sidebar and forward releases outside the report even when the pointer immediately moves. Drifting double- and triple-clicks stop at the last block above the pointer.
- An unset workspace root now defaults to your home directory. Explicit workspace settings still apply, and containment errors identify the requested path, resolved target, and allowed roots. Every source still requires registration and containment checks.
- Contributors can replace an existing local plugin installation with `npm run install:local`. It stages files and retains rollback copies before replacement, preserves settings and recovery drafts, and reloads only a vault Obsidian already has open.

## Install or update

Open the [community listing](https://community.obsidian.md/plugins/docshelf) for the installation link and current scorecard. For a manual install, download `docshelf-0.5.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelf files, routes, settings, read state, and recovery records remain compatible; no migration is required. Set an explicit workspace root if you want to retain a narrower default boundary.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Local runtime checks target macOS with Obsidian 1.13.7. Windows, Linux, and later Obsidian versions remain unverified; mobile is unsupported. Automated CDP input does not reproduce Electron's stray host events, so the runtime suite injects the relevant host event explicitly and unit tests cover delayed release ordering.

The aggregate tests, type and lint checks, builds, and package checks pass. The complete packaged 0.5.0 runtime suite passed in a disposable vault with no renderer errors. Regression tests exercise immediate movement after an outside release, delayed guest notification, failed installer copies and replacements, rollback failure, and preservation of private settings and recovery files.
