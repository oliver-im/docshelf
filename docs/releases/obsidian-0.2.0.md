# DocShelf for Obsidian 0.2.0 — desktop beta

This release lets you add files and whole folders from inside Obsidian, remove documents from the shelf without touching the originals, and recognize documents in the sidebar by their filenames.

## New

- **Add files and folders.** Use the shelf's **+** button, **DocShelf: Add…**, or right-click. Choose or create a project, then pick files, folders, or a mixture. On macOS a combined picker adds the selection immediately; other desktop platforms accept paths in a form. See [Add files and folders](https://github.com/oliver-im/docshelf/blob/main/docs/folders.md).
- **Folders stay current.** Registered folders are scanned recursively, including subfolders created later. New documents appear, edits refresh open views and search, and deleted documents leave the shelf. Hidden folders, common generated trees such as `node_modules` and `dist`, and descendant symlinks are skipped, and every document must stay inside the selected folder and the workspace root.
- **Remove from shelf.** Right-click a document and choose **Remove from shelf…**. Only the shelf changes; the original file or remote document is untouched. A document removed from a watched folder is excluded by its exact path so it does not reappear. An open unsaved draft is kept and blocked from saving back.
- **Filename-first sidebar rows.** Rows show the source filename, followed by the document's title in muted text when the title says more than the filename. Claude Artifacts keep their title. **Reset to alphabetical** sorts by filename, and search now matches filenames.

## Migration

Existing version 1 shelves keep working without changes. Adding the first folder upgrades the shelf file to version 2, which DocShelf for Obsidian 0.1.0 and older DocShelf Web checkouts reject rather than silently omitting folder contents. If Obsidian and DocShelf Web share a shelf, update both before adding a folder.

## Update a local installation

Save or review pending Markdown edits and disable DocShelf before copying the new files into the existing plugin directory. Preserve **`data.json`** and **`recovery/`**; do not replace or delete the whole directory. Re-enable the plugin after copying.

To install fresh, download **`docshelf-0.2.0.zip`** from this release's assets, extract it, and copy the `docshelf` folder into `<vault>/.obsidian/plugins/`. `SHA256SUMS` lists the checksums of the ZIP and standalone assets.

## Compatibility

Requires desktop Obsidian **1.13.7 or later**. Runtime verification covers **macOS, Obsidian 1.13.7, and Electron 34.2.0**. Windows, Linux, and Obsidian 1.14.2 are not yet verified. Mobile is unsupported. The plugin is not yet listed in Obsidian's community directory. The [0.1.0 release notes](https://github.com/oliver-im/docshelf/releases/tag/0.1.0) describe the file access and network boundaries, which are unchanged.

## Feedback

Report problems in [GitHub Issues](https://github.com/oliver-im/docshelf/issues), including your OS and Obsidian version and a small reproducible example. Remove private paths and document contents before sharing logs or recovery files. Use the [security policy](https://github.com/oliver-im/docshelf/blob/main/SECURITY.md) for sensitive reports.
