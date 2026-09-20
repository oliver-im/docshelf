# DocShelf for Obsidian 0.1.0 — desktop beta

The first packaged release brings explicitly registered project documents into Obsidian while keeping the original files in their project folders.

## Included

- Edit registered local Markdown in Obsidian's native editor with Live Preview, source and reading modes, autosave, recovery drafts, and conflict review.
- Browse interactive HTML reports in an isolated viewer and open supported public GitHub Markdown and published Claude Artifacts.
- Organize documents by project, search their contents, and copy links to selected source lines or file-and-line references for an agent.
- Share an existing shelf with DocShelf Web. Each app runs independently.

## Install

Download **`docshelf-0.1.0.zip`** from this release's assets. Extract it and copy the `docshelf` folder into `<vault>/.obsidian/plugins/`. Enable **DocShelf** under Community plugins, run **DocShelf: Open shelf**, and choose **Create empty shelf file** or configure an existing shelf. Register documents with the DocShelf skill or edit the shelf JSON using the [plugin guide](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md#register-documents).

Node.js, Git, and a web server are not required for this packaged build. `SHA256SUMS` lists the checksums of the ZIP and standalone assets. The plugin is not yet listed in Obsidian's community directory.

## Update a local installation

Save or review pending Markdown edits and disable DocShelf before copying the new files into the existing plugin directory. Preserve **`data.json`** and **`recovery/`**; do not replace or delete the whole directory. Re-enable the plugin after copying. No shelf-schema migration is needed for this release.

## Compatibility and boundaries

Requires desktop Obsidian **1.13.7 or later**. Runtime verification covers **macOS, Obsidian 1.13.7, and Electron 34.2.0**. Windows, Linux, and Obsidian 1.14.2 are not yet verified. Mobile is unsupported.

Local Markdown edits save to the registered original. Recovery and conflict checks protect the observed versions, but separate editors do not share a filesystem lock. External documents do not participate in vault search, backlinks, graph, or Obsidian Sync. HTML and remote sources are read-only; source-line links are positional and may move after edits.

Local HTML uses a token-protected loopback server and an isolated viewer. Reports may contact HTTPS services; remote Markdown images may also load over HTTPS. GitHub imports contact `raw.githubusercontent.com`, and Claude views contact `claude.ai` and resources loaded by that page. DocShelf adds no telemetry or account requirement. See the [full file and network disclosure](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md#file-access-and-network-disclosure).

## Feedback

Report problems in [GitHub Issues](https://github.com/oliver-im/docshelf/issues), including your OS and Obsidian version and a small reproducible example. Remove private paths and document contents before sharing logs or recovery files. Use the [security policy](https://github.com/oliver-im/docshelf/blob/main/SECURITY.md) for sensitive reports.
