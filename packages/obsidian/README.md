# DocShelf for Obsidian

Edit registered local Markdown in Obsidian's native editor, browse HTML reports,
search project documents, and copy source-line references. Files stay in their
original project folders; DocShelf does not create mirrored vault notes.

## Install locally

Requires desktop Obsidian **1.13.7 or later**. The runtime checks currently cover
Obsidian 1.13.7 with Electron 34.2.0 on macOS; Windows and Linux have not yet had
the same runtime verification.

From the unified repository root (Node.js 24 or later):

```sh
npm ci
npm run package:obsidian
```

Copy `packages/obsidian/dist/docshelf/` to `<vault>/.obsidian/plugins/docshelf/`, then enable
**DocShelf** in Obsidian's Community plugins settings. This repository is not
yet listed in the community directory.

Open **DocShelf: Configure shelf** from the command palette. Set **Shelf file**
to a shelf JSON file using its absolute path, or a path relative to the vault.
For a working example, enter the absolute path to this checkout's
`packages/obsidian/examples/shelf.json`. Open the DocShelf ribbon icon or
**DocShelf: Open shelf**.

Under **Display**, **Readable line length** limits the text column's width.
It applies immediately and shares Obsidian's vault-wide preference, so it also
affects ordinary Markdown notes. It is also available in **Settings → DocShelf**.

An existing DocShelf Web `shelf.local.json` can be used in place: its
relative source paths continue to resolve against its containing directory.
The plugin does not start or change the web app's server.

## Update an existing plugin

After updating this repository, run `npm ci` and `npm run package:obsidian`
from its root. Save or review pending Markdown edits, then disable DocShelf in
the vault's Community plugins settings. Copy `main.js`, `manifest.json`,
`styles.css`, `LICENSE`, and `THIRD_PARTY_NOTICES.txt` from
`packages/obsidian/dist/docshelf/` into the
existing `<vault>/.obsidian/plugins/docshelf/` directory and re-enable the plugin.

Keep the installed `data.json` and `recovery/` directory; do not replace or
delete the whole plugin directory. Your configured shelf and original documents
stay in place. The repository's packaging command does not install into a vault
or update its settings. The plugin and web app are updated separately; see the
[shared-shelf guide](../../docs/unification.md#update-existing-installations).

## Register documents

The default shelf is `shelf.local.json` in your vault. Create it using the
empty-state button or copy the empty `shelf.json` template. Edit registrations
with your editor or an agent. DocShelf watches the shelf and registered files.
Missing or unreadable sources and assets are reported without stopping other
documents from refreshing. Their registrations stay on the shelf so they can
recover when the files return. The shelf validation command still requires
every registered file to be available.

```json
{
  "version": 1,
  "artifacts": [
    {
      "project": "Example project",
      "source": "../example-project/docs/review.md",
      "route": "example/review.html",
      "title": "Project review"
    },
    {
      "project": "Example project",
      "source": "../example-project/reports/status.html",
      "route": "example/status.html",
      "title": "Status report",
      "description": "An interactive project status report.",
      "assets": ["assets/chart.js", "assets/report.css", "assets/logo.svg"]
    }
  ]
}
```

- `source` is absolute or relative to the shelf JSON file. Supported local
  extensions are `.md`, `.markdown`, `.html`, and `.htm`.
- `route` is a stable, unique relative `.html` path, including for Markdown.
- `project` and `title` label the sidebar groups and document rows.
- Optional `description` adds searchable metadata. It may be omitted or empty.
  Search results use it as an excerpt when document contents are unavailable.
- Optional `assets` lists individual files relative to the source document's
  directory. Only these assets are served. Nested paths are allowed; `..`,
  hidden paths, wildcards, and directory registration are not.
  Supported extensions are `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`,
  `.svg`, `.ico`, `.css`, `.js`, `.mjs`, `.json`, `.csv`, `.txt`, `.woff`,
  `.woff2`, `.ttf`, and `.otf`.
- Sources and assets must resolve inside **Workspace root** or the shelf file's
  directory. The default workspace is the parent of that directory. Set it
  explicitly when your projects are elsewhere, using an absolute path or one
  relative to the shelf directory. Symlinks are checked on reads.
- Local documents are limited to 8 MB, individual assets to 16 MB, and shelf
  JSON to 2 MB. A shelf supports 2,000 documents and 500 assets per document.

Relative links between registered documents open in DocShelf. Images in local
Markdown use the same explicit `assets` list. A sibling image or stylesheet
is not exposed merely because a registered document refers to it.
Registered image changes and asset-list updates refresh open Markdown embeds,
including when the editor has unsaved text. The refresh preserves that buffer
and its undo history.

For a shelf shared with the web app, use relative sources and lowercase
`.html` routes, and keep GitHub URLs out of the shelf JSON. The web app ignores
`assets` and keeps GitHub imports in browser storage. See
[shared setup and differences](../../docs/unification.md).

## Source-line links

In native Live Preview, edit the text normally or click a number in the left
gutter to select a source reference. Shift-click another number to extend the
range. This highlights the passage without moving the text cursor or changing
the document. **DocShelf: Copy document link** and the header's link icon copy
that range. You can also select text in the editor. With neither kind of
selection, the link opens the whole document:

```text
obsidian://docshelf?vault=My%20vault&source=%2Fprojects%2Fexample%2Freview.md&lines=7-11
```

**DocShelf: Copy source reference** produces `/projects/example/review.md:7-11`
for an agent. The quote icon in the document header does the same thing.
Links open only registered sources. They use `source`, because Obsidian
intercepts `path` before dispatching to plugin handlers.
Spaces must be encoded as `%20`, not `+`, because Obsidian uses percent decoding
instead of form-query decoding.

By default links identify the vault by name. If multiple vaults share a name,
copy the intended vault's ID from the vault switcher and put it in **Vault ID
for links**. The plugin must be enabled in the destination vault.

Local Markdown range links open the native editor with the requested lines
selected. GitHub Markdown retains the read-only viewer with individual line
controls; HTML range links open its read-only Source view. These are positional
links; later edits may move the passage. Out-of-bounds ranges are reported.

Rendered tables show their actual source range, such as
**17–20**, in the gutter. Clicking it references that whole block. Wrapped text
keeps its original source-line number. Source mode exposes individual table rows
and frontmatter lines. Click the same number or block again to clear it when
it is the entire selection; clicking within a larger selection selects just
that line or block. Shift-click continues extending the range. You can also use
**Clear selection** or **Escape**. Gutter buttons support Space/Enter and arrow-key
navigation, with Shift-arrow extending the range. References track source
positions as you edit and are saved with the pane's workspace state.

Selected source ranges form one continuous highlight, including rendered blocks and intervening whitespace. Right-click inside it or on any line number for the same menu: **Copy DocShelf link**, **Copy source reference**, and **Reveal source**. Copy actions use the highlighted range when clicked inside it, or the clicked line/block otherwise. The highlight and editing cursor stay in place. **Reveal source** shows the original file in your system file manager. Left-click text to resume editing normally.

## Edit local Markdown

Click a local Markdown document in the shelf and start typing. This uses
Obsidian's actual `MarkdownView`, including Live Preview, source mode, reading
mode, formatting commands, undo/redo, and native editor extensions. Changes
autosave to the registered original file; **Cmd/Ctrl+S** also saves. A compact
footer appears while saving, when source lines are selected, or when a problem
needs attention. Otherwise it is hidden and reserves no space.
Existing local Markdown reader tabs migrate when restored.
The source-line gutter works in both Live Preview and source mode. Use the
pane's **…** menu to toggle **Reading view**, or **Source mode** while editing.
Turn Source mode off to return to Live Preview. These changes preserve the
external document and its draft; no vault note is created. The toolbar keeps
**Reveal source**, **Copy source reference**, and **Copy DocShelf link** visible.
The gear beside **…** opens **Configure DocShelf**, including the readable line
length preference.

Clean editors refresh after external file changes. If a file changes while you
have unsaved edits, DocShelf keeps your buffer and stops saving. **Review
changes** compares the current file and your edits. You can merge in that dialog,
choose **Save edited version**, or choose **Use disk version**. Saving checks the
file again, so an external change made while the dialog is open also conflicts.
Missing files and removed registrations cannot be recreated by autosave.
When the same registered source becomes available again with unchanged contents,
autosave resumes. Recovered drafts still require review before saving.

Before saving, DocShelf keeps the original snapshot and edited text under
`.obsidian/plugins/docshelf/recovery/`. Each editor pane has its own JSON metadata
record referring to a baseline file and a draft text file. The baseline is reused
until it changes; superseded checkpoint files are removed only after their
replacement is persisted. Older, self-contained JSON records still load.
While typing, recovery is checkpointed at most once every 150 ms, and immediately
before saving or closing the pane. A crash can lose typing since the latest
checkpoint; source writes always wait for recovery to be persisted.
Pending edits are recovered when the document reopens, including plugin reloads;
review is required before writing a recovered draft. A successful save retains
the preceding snapshot and edited text until the next edit in that pane. Choosing
the disk version archives the old draft. **DocShelf: Reveal Markdown recovery
files** opens their location. These records contain document contents and remain
on disk until you remove them; they are not part of shelf registrations.

Writes preserve the file's inode, permissions, UTF-8 BOM, and LF/CRLF convention.
Invalid UTF-8 and documents over 8 MB are rejected. Conflict checks and recovery
reduce data-loss risk, but separate editors do not share a filesystem lock;
exactly simultaneous writes are not guaranteed to be conflict-free.

External refreshes do not become local undo steps. Earlier local undo history is
mapped through the update; history overlapping externally replaced text may no
longer be undoable. This prevents Undo from silently restoring an older file over
an agent's changes.

The editor has no vault `TFile`: native text editing works, but features and
plugins that require a vault file (backlinks, graph,
vault file operations, Obsidian Sync) are not enabled for external documents.
Relative document links still require registration; image embeds still use the
explicit asset list. HTML and remote sources remain read-only.

## Search and remote sources

The sidebar and **DocShelf: Search documents** search titles, project names,
descriptions, and local Markdown/HTML contents. Script and style contents are
excluded. Search indexing uses at most 16 million source characters per refresh
and 200,000 extracted characters per document; remaining metadata stays
searchable. Exceeding the total limit is shown in the sidebar.

With no search query, documents are grouped by their registered project label
and shown as compact rows with a file-type icon and title. Long titles are
truncated; hover over a row to see its full title and source type. Descriptions
stay hidden while browsing. Search results include short content excerpts.
Click a project heading to collapse or expand it, or drag it to reorder projects.
Drag a document row to reorder it within its project. Right-click a heading or
document (or press **Shift+F10** while it is focused) for **Move up**, **Move down**,
and **Reset to alphabetical**. Resetting a document's order resets its project’s
document list. Obsidian saves these orders and collapse state with the workspace;
new projects and documents follow their saved lists alphabetically. Document
orders use stable registration routes, so renaming a title preserves its position.
Reordering does not change registrations or source files, and documents cannot
be dragged between projects. Search shows matches across all projects, including
collapsed ones, ordered by relevance with dragging disabled. Local file changes
refresh automatically. For a manual refresh or setup,
use **DocShelf: Reload shelf and documents** or **DocShelf: Configure shelf** in
Obsidian's command palette.

The `source` field also accepts:

- Public GitHub Markdown file URLs, including
  `https://github.com/owner/repo/blob/main/README.md` and the corresponding
  `raw.githubusercontent.com` URL. Content downloads when opened, is cached in
  memory, and then enters search. **Reload** refreshes the download. Downloads
  enforce a streaming 2 MB limit; raw HTML is omitted and rendering sanitized.
- Exact published Claude Artifact URLs such as
  `https://claude.ai/public/artifacts/<uuid>`. These open as remote pages in a
  separate webview. Their content is not downloaded or included in full-text
  search; only the registered metadata is searchable.

There is no arbitrary remote HTML import. Remote views depend on the service
being reachable and allowing the public page to load.

## File access and network disclosure

DocShelf reads explicitly registered files outside the vault so project-owned
documents can stay in their original folders. Local Markdown editing writes to
the registered original file after recovery and conflict checks. HTML, remote
sources, and assets are read-only. The plugin also writes settings, private
recovery records, and, when you click **Create empty shelf file**, a new shelf
JSON file; it will not overwrite an existing shelf file.

Interactive HTML runs in a separate, nonpersistent Electron webview session
with Node disabled, context isolation, sandboxing, and web security. It loads
through a plugin-owned server bound to `127.0.0.1` on an OS-assigned port. The
server has document-specific URL tokens, strict Host checks, CSP, bounded
reads, and an explicit file allowlist. A report's token grants access only to
that report and its listed assets. Cross-document navigation links cannot be
used to read the destination's contents. It provides no write API and closes on
plugin unload. Report code receives no privileged plugin bridge. This avoids
using `file://` or Obsidian's `app://` resource origin for reports.

Local reports stay in their viewer when following external HTTP(S) links;
those links open in the system browser. Registered document links open in
DocShelf, and same-report anchors remain in the page. Popups are disabled.
Unrelated shelf errors do not reset a report's interactive state.
Reloading the same report preserves its viewer session, including localStorage.
Opening a different report or reassigning its route to a different source starts
a fresh session, so reports do not inherit each other's browser storage. These
sessions are not persisted across application restarts.

Registered HTML can run its own scripts and load HTTPS resources or contact
remote services named by the report. Disable **Run HTML scripts** to view it
without script execution; remote images and styles can still load. Markdown
images may also use HTTPS. Public GitHub imports contact
`raw.githubusercontent.com`; Claude views contact `claude.ai` and resources
loaded by that page. DocShelf adds no telemetry or account requirement.

External documents are not indexed by core Obsidian search, backlinks, or graph,
and do not join Obsidian Sync. This plugin is desktop-only. Mirroring and mobile
support are outside this version's scope. Local Markdown uses Obsidian's native
rendering; the read-only GitHub viewer displays Mermaid fences as code.

## Develop and verify

Install with `npm ci` at the repository root using Node 24 or later. The commands
below run from `packages/obsidian/`; from the root, add `--workspace obsidian-docshelf`.

```sh
npm test
npm run check
npm run build
npm run test:obsidian
```

The runtime test starts a separate Obsidian process with a disposable profile,
vault, and external fixtures. It covers UI interactions, copied links, actual
Obsidian URI dispatch, live refresh, HTML isolation, script-free mode, and unload
cleanup. Screenshots and results are written under ignored `.local/runtime/`.
It does not install into your existing vault. On another installation, set
`OBSIDIAN_EXECUTABLE` and `OBSIDIAN_BUNDLE_DIRECTORY`; the runner currently
defaults to macOS paths. `DOCSHELF_KEEP_TEST_PROFILE=1` keeps the disposable
profile and fixtures after the run.
Build first: the runtime runner copies the existing `main.js` into its test vault.

`npm run dev` rebuilds the plugin bundle when source code changes. Reload the
plugin in Obsidian to pick up a new bundle. `npm run validate:shelf --
/absolute/path/to/shelf.local.json --workspace /absolute/workspace` validates a
shelf without launching Obsidian.

From the repository root, run `npm run test:all`, `npm run check:all`, and
`npm run build:all` before handing off changes. These include the web app, shared
helpers, and plugin; they do not run the actual Obsidian runtime suite.

The shared registration skill lives at the repository root in
[`.agents/skills/docshelf/`](../../.agents/skills/docshelf/SKILL.md). It can return
web app and Obsidian links from the same shelf; see [shared setup and differences](../../docs/unification.md).

## License

MIT. URL and line-range helpers are shared with the web app through
`@docshelf/core`. The plugin bundle includes those helpers and its `LICENSE`.
Bundled third-party dependencies retain their own licenses. Each build generates
`THIRD_PARTY_NOTICES.txt` with their license and notice texts, and packaging
includes it beside `main.js`. Keep both license files with the installed or
redistributed plugin.
See the repository [security policy](../../SECURITY.md) and
[plugin architecture](docs/architecture.md) for the file-access boundaries.
