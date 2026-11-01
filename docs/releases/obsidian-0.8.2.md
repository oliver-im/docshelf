# DocShelf for Obsidian 0.8.2 — desktop beta

Fix content search dropping documents when large HTML reports use up the shelf's search budget. The budget now counts extracted searchable text instead of raw source characters, so scripts, styles, and embedded image data no longer crowd other documents out of search. The search cache retains bounded text and file revisions instead of full sources.

The existing limits remain 16,777,216 extracted text characters across the shelf and 200,000 per document. Documents that do not fit the remaining total budget keep metadata search; later smaller documents can still fit. A muted **Limited text search** note appears beside the result count only during a search when text is omitted or shortened. Hover over it for the limits and affected counts. Browsing has no persistent banner or diagnostic dialog; shelf and source errors remain separate.

The folder guide now explains how to keep several projects on a focused shelf using selected documentation folders and individual entry points. Existing registrations, pins, settings, and recovery records need no migration. Personal shelf configurations are not included in the release.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.8.2.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. Preserve **`data.json`** and **`recovery/`** when replacing an existing installation. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Aggregate tests, type and lint checks, builds, package checks, and the packaged runtime suite cover extracted HTML text, budget exhaustion, metadata search, compact search-only diagnostics, and recovery after space is freed. Runtime verification uses macOS with Obsidian **1.14.5**. Windows and Linux runtime behavior remain unverified; mobile is unsupported. See the [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) for the last completed hosted review and remaining advisory findings; a previous version's scorecard does not verify this release.
