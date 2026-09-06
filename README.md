# DocShelf

A home for the HTML reports and Markdown notes scattered across your projects.
Keep the originals where they belong, then use one shelf to find, read, and link
to them. You can also bring in public GitHub Markdown and published Claude Artifacts.

**[Try the live demo](https://oliver-im.github.io/docshelf/?artifact=docshelf%2Freadme.html)**
or [run your own shelf](#run-locally).

The demo opens this README. Use its **+** button to try a public GitHub Markdown
file or a published Claude Artifact. Imports stay in your browser; the hosted
demo cannot access your local files.

![DocShelf in dark mode with grouped documents, a public import, and selected Markdown source lines](public/docshelf-overview.png)

A sample shelf using public documentation, with a source-line range selected.

## What you can do

- Collect selected documents from several projects without moving their sources.
- Search the full text of registered local documents and jump to matching sections.
- Read Markdown with tables, code highlighting, Mermaid diagrams, and a page outline.
- Bookmark a document, heading, or exact source-line range.
- Ask an agent to “add this to DocShelf” with the included registration skill.

## Run locally

You need **Git, Node.js 24 or newer**, and a filesystem that supports symbolic
links. The commands below use a macOS or Linux shell. CI runs on Ubuntu and local
verification has covered macOS; Windows has not yet been verified.

Put DocShelf beside the projects you want to catalog:

```text
workspace/
├── docshelf/
└── example-project/
```

For a new installation:

```sh
mkdir -p ~/workspace
cd ~/workspace
git clone https://github.com/oliver-im/docshelf.git
cd docshelf
npm ci
cp .github/pages-shelf.json shelf.local.json
npm run watch
```

Open **[http://shelf.localhost:4321/](http://shelf.localhost:4321/)** after the
first build finishes. If your browser does not resolve that hostname, use
`http://127.0.0.1:4321/`. Keep using the same address: browser imports and
preferences belong to that site origin.

Your first shelf already contains DocShelf's README, so navigation and search
work immediately. The watcher rebuilds when a registered document or the shelf
changes. Stop it with Ctrl+C.

Already installed? Follow the
[upgrade instructions](https://github.com/oliver-im/docshelf/blob/main/docs/local-server.md#updating-an-existing-installation).

## Register local documents

Edit the `artifacts` array in your ignored `shelf.local.json`. Keep the README
entry if you want it, and add entries for files that already exist:

```json
{
  "project": "Example Project",
  "source": "../example-project/docs/overview.md",
  "route": "example-project/overview.html",
  "title": "Project overview",
  "description": "An overview of the example project."
}
```

`source` is relative to the DocShelf checkout and must end in `.html` or `.md`.
The file must resolve inside DocShelf's parent directory, the workspace root.
`route` is a unique, lowercase path ending in `.html`, even for Markdown.
Keep routes stable so bookmarks keep working.

DocShelf creates generated HTML snapshots and never edits the original files.
Links between registered sources are rewritten only in the generated output.
It does not crawl or serve unregistered neighboring files, including images.
The tracked `shelf.json` stays an empty template; your registrations belong in
`shelf.local.json`.

To register a published Claude Artifact in the shelf, see
[supported links and embed setup](https://github.com/oliver-im/docshelf/blob/main/docs/usage.md#published-claude-artifacts).

## Read and navigate

Choose a document in the sidebar, or search for a word inside a registered local
document. Drag the sidebar divider to resize it; `Command/Ctrl+B` hides or shows
the sidebar.

Use a document's **⋯** menu to open it in a new tab or copy its viewer link.
Remote documents offer **View source**. Local files offer **Reveal in Finder**
when the macOS loopback watcher is running. Native browser right-click remains
available.

For Markdown, click a gutter line number and Shift-click another to select a
range. **Copy link** preserves that selection, such as `#L14-L20`. The **On this
page** outline navigates longer documents by heading.

Read the [viewer and Markdown guide](https://github.com/oliver-im/docshelf/blob/main/docs/usage.md)
for keyboard controls, browser import behavior, and rendering details.

## Add documents with an agent

Install the included `docshelf` skill globally:

```sh
npx skills add oliver-im/docshelf --skill docshelf -g
```

After creating a report or note, ask your agent to **“add this to DocShelf.”**
The skill registers the finished source, preserves existing shelf entries, and
verifies the result. It does not author or restyle documents.
The optional [HTML theme](https://github.com/oliver-im/docshelf/blob/main/.agents/skills/docshelf/references/theme.md)
is a separate authoring resource.

## Content boundaries

| Source | Stored content | Full-text search | Requirements |
| --- | --- | --- | --- |
| Registered local HTML or Markdown | Generated local snapshot; original stays in its project | Yes | File inside the workspace |
| Browser-imported GitHub Markdown | Source link in browser storage; fetched again on reload | No | Public HTTPS `.md` or `.markdown` file |
| Published Claude Artifact | Claude-hosted cross-origin embed | No | Exact published Artifact URL and DocShelf origin allowed by its owner |

Browser-import bookmarks depend on that browser's saved source link. Sharing
the bookmark alone does not transfer the import to another visitor. Private
GitHub repositories, arbitrary remote pages, and offline remote imports are
not supported.

Register only local HTML you trust: it can run scripts with DocShelf's origin.
GitHub Markdown is sanitized, but its images and links can contact remote sites.
Keep the server's default loopback binding unless you intend to expose your
registered documents to the network. See the
[security policy](https://github.com/oliver-im/docshelf/blob/main/SECURITY.md).

## Running, developing, and releasing

- [Local server, upgrades, troubleshooting, and macOS login service](https://github.com/oliver-im/docshelf/blob/main/docs/local-server.md)
- [Versioning, release notes, and release procedure](https://github.com/oliver-im/docshelf/blob/main/docs/releasing.md)

Use `npm run dev` while changing DocShelf's UI. Before handing off code changes,
run `npm test`, `npm run check`, and `npm run build`. Use `npm run watch` for
production search and automatic source updates.

## License

MIT. The Markdown and optional HTML themes adapt Tokyo Night for Obsidian;
the optional HTML theme also includes matcha.css. See the
[third-party notices](https://github.com/oliver-im/docshelf/blob/main/THIRD_PARTY_NOTICES.md).
