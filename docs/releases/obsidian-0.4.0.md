# DocShelf for Obsidian 0.4.0 — desktop beta

See at a glance which documents are new or were changed by an agent since you last read them.

- Documents that arrive on the shelf are unread until you open them, like new mail: the name is bold with a dot, and each folder and project containing it shows a dot. This covers files that appear in watched folders and registrations made elsewhere, such as by an agent or in DocShelf Web. Everything already on the shelf when the plugin first loads it, and anything you add with **Add…**, starts as read.
- When an agent announces an edit to a registered document, for example after you give it feedback, the document turns unread again. Your own edits never do. A document shown in a focused Obsidian window, including a split pane, stays read because you saw it change.
- Agents announce edits by appending to an event log beside the shelf, `shelf.local.events.jsonl` for `shelf.local.json`. A Claude Code hook can do this automatically after every edit; other agents follow a one-line instruction. See [agent edits and the event log](https://github.com/oliver-im/docshelf/blob/main/docs/events.md) for the hook, the instruction, and the format.

Read state stays on your device, per vault and shelf, and is never written to the shelf file. DocShelf Web keeps its own read state per browser, so opening a document in one app does not mark it read in the other. The web app reads the same event log through its local watcher; update the checkout and restart the watcher to enable it. DocShelf Web and the Obsidian plugin are updated separately.

## Install or update

Open the [community listing](https://community.obsidian.md/plugins/docshelf) for the installation link and current scorecard. For a manual install, download `docshelf-0.4.0.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. To update an existing installation, save or review pending Markdown edits, disable DocShelf, and replace the plugin files while preserving **`data.json`** and **`recovery/`**. Re-enable the plugin afterward. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

Existing shelf files, routes, settings, and recovery records remain compatible; no migration is required. After the update, everything already on the shelf starts as read, and the plugin begins at the current end of the event log, so earlier announcements are not replayed.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. Local runtime checks target macOS with Obsidian 1.13.7. Windows, Linux, and later Obsidian versions remain unverified; mobile is unsupported. The runtime test suite now refuses to run on Windows, or on Linux with `XDG_RUNTIME_DIR` set, because it cannot isolate Obsidian's command-line socket there.

The aggregate tests, type and lint checks, builds, and package checks pass. The complete packaged 0.4.0 runtime suite passed in a disposable vault, including fresh installation, preservation of settings and recovery files during plugin replacement, arrival of new documents, and an announced edit to the open document, with no renderer errors. Other local runs failed intermittently at timing-sensitive steps, such as a shelf refresh or a table context menu that opened twice; the same steps also fail intermittently without this release's changes.
