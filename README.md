# DocShelf for Obsidian

Browse registered Markdown and HTML documents from their original project
folders, search their contents, and copy source-line references from Obsidian.
DocShelf never edits the registered documents or copies them into your vault.

## Install locally

Requires desktop Obsidian **1.13.7 or later**. The runtime checks currently cover
Obsidian 1.13.7 with Electron 34.2.0 on macOS; Windows and Linux have not yet had
the same runtime verification.

```sh
npm install
npm run package
```

Copy `dist/docshelf/` to `<vault>/.obsidian/plugins/docshelf/`, then enable
**DocShelf** in Obsidian's Community plugins settings. This repository is not
yet listed in the community directory.

Open **DocShelf: Configure shelf** from the command palette. Set **Shelf file**
to a shelf JSON file. For a working example, select this checkout's
`examples/shelf.json`. Open the DocShelf ribbon icon or **DocShelf: Open shelf**.

An existing standalone DocShelf `shelf.local.json` can be used in place: its
relative source paths continue to resolve against its containing directory.
The plugin does not start or change the standalone server.

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
- Sources and assets must resolve inside **Workspace root** or the shelf file's
  directory. The default workspace is the parent of that directory. Set it
  explicitly when your projects are elsewhere. Symlinks are checked on reads.
- Local documents are limited to 8 MB, individual assets to 16 MB, and shelf
  JSON to 2 MB. A shelf supports 2,000 documents and 500 assets per document.

Relative links between registered documents open in DocShelf. Images in local
Markdown use the same explicit `assets` list. A sibling image or stylesheet
is not exposed merely because a registered document refers to it.

## Source-line links

Click a line number, then Shift-click another to select a range. Use the arrow
keys to move between line controls, Shift-arrow to extend a selection, and
Escape to clear it. **Copy link** produces an Obsidian URI:

```text
obsidian://docshelf?vault=My%20vault&source=%2Fprojects%2Fexample%2Freview.md&lines=7-11
```

**Copy reference** produces `/projects/example/review.md:7-11` for an agent.
Links open only registered sources. They use `source`, because Obsidian
intercepts `path` before dispatching to plugin handlers.
Spaces must be encoded as `%20`, not `+`, because Obsidian uses percent decoding
instead of form-query decoding.

By default links identify the vault by name. If multiple vaults share a name,
copy the intended vault's ID from the vault switcher and put it in **Vault ID
for links**. The plugin must be enabled in the destination vault.

Reading mode shows individual source-line controls with bands distributed
across rendered blocks. Placement is approximate where Markdown layout differs
from the source. **Source** displays exact text and line numbers, in pages of
400 lines. Documents with more than 20,000 lines use this source view. HTML
range links also open in Source. These are positional links; later edits may
move the referenced passage. Out-of-bounds ranges are reported explicitly.

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
documents can stay in their original folders. Registered sources and assets
are never written. The plugin writes only its settings and, when you click
**Create empty shelf file**, a new shelf JSON file; it will not overwrite an
existing file.

Interactive HTML runs in a separate, nonpersistent Electron webview session
with Node disabled, context isolation, sandboxing, and web security. It loads
through a plugin-owned server bound to `127.0.0.1` on an OS-assigned port. The
server has a per-session random URL token, strict Host checks, CSP, bounded
reads, and an explicit file allowlist. It provides no write API and closes on
plugin unload. Report code receives no privileged plugin bridge. This avoids
using `file://` or Obsidian's `app://` resource origin for reports.

Registered HTML can run its own scripts and load HTTPS resources or contact
remote services named by the report. Disable **Run HTML scripts** to view it
without script execution; remote images and styles can still load. Markdown
images may also use HTTPS. Public GitHub imports contact
`raw.githubusercontent.com`; Claude views contact `claude.ai` and resources
loaded by that page. DocShelf adds no telemetry or account requirement.

External documents are not part of core Obsidian search, backlinks, graph,
native editing, or Obsidian Sync. This plugin is desktop-only. Mirroring,
write-back, and mobile support are outside this version's scope. Mermaid fences
currently display as code; they are not rendered as diagrams.

## Develop and verify

Use Node 22 or later for development.

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
defaults to macOS paths. `DOCSHELF_KEEP_TEST_PROFILE=1` preserves failed fixtures.

`npm run dev` rebuilds the plugin bundle when source code changes. Reload the
plugin in Obsidian to pick up a new bundle. `npm run validate:shelf --
/absolute/path/to/shelf.local.json --workspace /absolute/workspace` validates a
shelf without launching Obsidian.

The project registration skill lives in `.agents/skills/obsidian-docshelf/`.
The revised private feasibility note is in `.local/`.

## License

MIT. URL and line-range helpers were adapted from the sibling DocShelf project;
its copyright notice is retained in `LICENSE`.
