# DocShelf for Obsidian 0.8.3 — desktop beta

Fix Obsidian's native Back and Forward navigation between registered documents. Citation links reuse the same tab, including HTML-to-HTML, Markdown-to-Markdown, and mixed HTML/Markdown transitions. Reloads, source selections, and mode changes do not add document history entries.

Registered HTML links retain query parameters and anchors. A report's observation date now survives following a return link, reloading the report, and navigating Back or Forward. Links and script-driven reloads that change only the query on the same report also enter native history. Markdown links to HTML reports retain their queries, and links without a query do not inherit the previous report's parameters.

Before leaving Markdown with unsaved edits, DocShelf saves the source or verifies an exact pending recovery copy. Returning to a conflicted draft restores its text and requires review before saving. The checks apply both when changing Markdown documents and when switching to another view type. Saving can resume after a temporary recovery-storage failure; source conflicts still require review.

Existing registrations, pins, settings, and recovery records need no migration. Personal shelf configurations and documents are not included in the release.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.8.3.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. Preserve **`data.json`** and **`recovery/`** when replacing an existing installation. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Aggregate tests, type and lint checks, builds, package checks, and the packaged runtime suite cover native history, report queries, repeated cross-document navigation, conflicted drafts, and failed recovery storage. Runtime verification uses macOS with Obsidian **1.14.5**. Windows and Linux runtime behavior remain unverified; mobile is unsupported.

Returning to an HTML report reloads it. Transient script state and manual scroll position are not restored; native Markdown uses Obsidian's cursor and scroll restoration. If recovery storage fails, navigation stops and the editor keeps its unsaved text, but Obsidian may already have advanced its history position. External HTTP(S) links still open in the system browser. See the [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) for the last completed hosted review and remaining advisory findings; a previous version's scorecard does not verify this release.
