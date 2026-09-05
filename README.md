# DocShelf

A shelf for explicitly registered HTML and Markdown, published Claude
Artifacts, and browser-imported public GitHub Markdown. Source projects and
content hosts keep ownership of their content; DocShelf provides one place to
navigate it without crawling the surrounding workspace or accepting arbitrary
web pages.

[Open the README in the live DocShelf demo](https://oliver-im.github.io/docshelf/?artifact=docshelf%2Freadme.html).

## Why DocShelf exists

HTML is useful for visual reports and interactive explanations, while Markdown
is useful for durable notes and documentation. Those files become difficult to
rediscover when they are spread across projects or opened through ad hoc
`file://` links. DocShelf gives explicitly selected content one curated shelf
without crawling or serving its owning project directories.

DocShelf is intentionally explicit: one shelf entry maps one local file or
published Claude Artifact to one stable route. Browser imports are separate,
local to one browser, and limited to known source types.

## Requirements

- Node.js 24 or newer
- A filesystem that supports symbolic links

For local HTML and Markdown, DocShelf expects to live inside a workspace
alongside the projects it catalogs:

```text
workspace/
├── docshelf/
└── example-project/
```

Registered sources must resolve inside the workspace root, defined as DocShelf's
parent directory. This keeps a misplaced shelf entry from reaching outside
the intended workspace.

## Setup

```sh
npm install
cp shelf.json shelf.local.json
npm run watch
```

Your shelf lives in the ignored `shelf.local.json` file. Register artifacts in
its `artifacts` array:

```json
{
  "version": 1,
  "artifacts": [
    {
      "project": "Example Project",
      "source": "../example-project/docs/overview.md",
      "route": "example-project/overview.html",
      "title": "Project overview",
      "description": "A visual overview of the example project."
    }
  ]
}
```

Existing installations using `artifacts.local.json` continue to load with a
deprecation warning. Rename the file to adopt the current terminology:

```sh
mv artifacts.local.json shelf.local.json
```

Local sources are relative to the DocShelf directory and may end in `.html` or
`.md`. Routes always end in `.html`, including when the source is Markdown.
`shelf.json` is both the copyable shelf template and a tracked empty fallback,
allowing a clean clone to build without local entries. Machine-specific
registrations belong only in the ignored `shelf.local.json` file.

DocShelf reads each registered local source into a standalone HTML snapshot
beneath its ignored runtime directory. Markdown is rendered to HTML; existing
HTML is copied into the same generated pipeline. When a relative link resolves
to another registered source, DocShelf rewrites only the generated link to use
the target's stable DocShelf route. External links, same-document anchors, and
unregistered targets remain unchanged. DocShelf never modifies the original
files.

`npm run sync`, `dev`, `check`, and `build` validate the shelf and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

### Browser imports

Use the plus button in the DocShelf header on either the local site or the
hosted GitHub Pages site. Paste a public GitHub Markdown file or published
Claude Artifact URL, optionally give it a name, and DocShelf remembers it in
that browser. Browser imports do not change a shelf file or make the imported
link available to other visitors.

For Markdown, DocShelf accepts only HTTPS `.md` and `.markdown` file URLs on
`github.com` and `raw.githubusercontent.com`. It fetches the public raw file
directly in the browser, omits raw HTML, sanitizes the result, and renders it
with the DocShelf Markdown theme. Relative images resolve from the raw file's
directory, while relative links from a GitHub file-view URL point back into the
same repository. General GitHub pages and arbitrary remote hosts are rejected.
Private repositories and authenticated requests are not supported.

Imported Markdown is fetched again after a page reload. It is not copied into
the built site, available offline, or included in full-text search. It retains
DocShelf's source-line selection and permalink behavior, while its repository
remains the source of truth.

#### Published Claude Artifacts

Unlike browser-imported Markdown, a published Claude Artifact can also be
included for everyone who uses a built shelf by registering its public link in
the shelf JSON:

```json
{
  "project": "Claude Artifacts",
  "source": "https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef",
  "route": "claude/system-explorer.html",
  "title": "System explorer",
  "description": "An interactive system explorer published from Claude."
}
```

DocShelf accepts only exact HTTPS links of the form
`claude.ai/public/artifacts/<id>` (the `/embed` form is accepted and normalized
too). It embeds Claude's dedicated cross-origin `/embed` page; a Claude chat,
home page, or other arbitrary URL is rejected. The Artifact owner must use
Claude's **Get embed code** settings to add the complete DocShelf origin—such
as `https://oliver-im.github.io` or `http://shelf.localhost:4321`—to **Allowed
domains**. See Claude's
[publishing and sharing instructions](https://support.claude.com/en/articles/9547008-publish-and-share-artifacts).

Claude remains the content host. These entries are therefore not copied into
DocShelf, included in full-text search, given Markdown source-line links, or
available offline. Unpublishing an Artifact or removing the DocShelf origin
from its allowed domains makes the embedded content unavailable.

## Using the viewer

Choose an artifact in the left sidebar to load it inside DocShelf. For local
artifacts, use a modified click or the browser's link menu when you want to open
the standalone generated page.

- `Command/Ctrl+B` toggles the artifact sidebar.

Drag the divider beside the sidebar to change its width. When the divider has
keyboard focus, the arrow keys resize it in smaller steps. The width and
visibility preferences are stored in the browser.

The selected artifact is written to the page URL, so a viewer state can be
bookmarked. For a browser-imported document, that bookmark works in the same
browser because the source link is stored locally; the bookmark alone does not
transfer the import to someone else. The viewer keeps the current document
visible while a selected or updated artifact loads in a hidden frame, then
swaps frames after the new document is ready. While `npm run watch` is running,
local content revisions are checked when the window regains focus and every few
seconds while it remains visible.

Rendered Markdown also supports source-line links. Its gutter shows every source
line, including blank lines and lines omitted from the rendered document. Click
a number to select that exact source line, then Shift-click another number to
extend the range. DocShelf paints each selected source line as a horizontal
band; when the range covers an entire rendered element, it outlines that element
as additional context. The range is written to the URL using the familiar
`#L14-L20` form. Use **Copy link** in the selection bar to share the exact
artifact and range.

## Markdown rendering

Registered Markdown artifacts support GitHub-flavored tables, task lists,
strikethrough, heading anchors, syntax-highlighted fenced code, and Mermaid
diagrams. Put Mermaid syntax in a fenced code block with the `mermaid` language
identifier, as on GitHub. DocShelf loads its bundled Mermaid runtime only for
Markdown documents that contain one of these blocks. YAML or TOML frontmatter
is removed from the rendered document; a valid `lang` frontmatter value sets
the HTML document language.

Both registered and browser-imported Markdown use an adapted Tokyo Night
reading theme that fills the available viewer width. Its light or dark
appearance follows DocShelf, including theme changes made while the document
is open. Browser imports support GitHub-flavored Markdown, heading anchors, and
source-line links, but do not run Mermaid or syntax-highlighting scripts.
Existing HTML artifacts retain their own styles.

Raw HTML inside Markdown is omitted. Use a registered HTML artifact when a
document needs custom markup or scripts. Browser-imported GitHub Markdown
resolves relative images through GitHub's raw file host. A registered local
Markdown artifact cannot load an unregistered neighboring image because
DocShelf does not serve surrounding project directories.

## Agent skill

This repository includes a `docshelf` agent skill for registering HTML,
Markdown, and published Claude Artifacts. Install it globally when you want to
say “add this to DocShelf” from any project:

```sh
npx skills add oliver-im/docshelf --skill docshelf -g
```

The skill also provides an optional DocShelf HTML theme. Ask for the “DocShelf
theme” when creating a standalone HTML artifact; registering existing HTML does
not alter its styles.

## GitHub Pages demo

Pushes to `main` rebuild the public demo from this README and deploy the
generated site to GitHub Pages. The workflow copies
`.github/pages-shelf.json` to the ignored local shelf during the build, so the
README remains the single source of truth and generated HTML is never
committed. A fork can register published Claude Artifacts in that Pages shelf;
visitors can also import public GitHub Markdown or their own Claude Artifacts
with the header's plus button.

The hosted build sets `DOCSHELF_SITE` and `DOCSHELF_BASE` from GitHub Pages and
disables the local watcher's live-update polling. Only the README registered by
the demo shelf is published; machine-local registrations remain ignored.

## Security

Registered local HTML is treated as trusted content and may execute scripts
with the same origin as DocShelf. Register only HTML files you trust.
Browser-imported GitHub Markdown is sanitized and rendered in a generated
document, but it may still load remote images and links. Published Claude
Artifacts remain in a cross-origin Claude frame but can still present
interactive content, so open only links you trust. Keep DocShelf bound to its
default loopback address unless you intentionally want to expose registered
artifacts to the network. See [`SECURITY.md`](SECURITY.md) for the vulnerability
reporting policy and security boundaries.

## Site development

Use Astro's development server while changing DocShelf pages, components, or
styles:

```sh
npm run dev
```

The development server loads the shelf when it starts. Restart it after editing
the shelf, or use `npm run watch` to rebuild automatically after shelf or source
file changes. Search is generated only during production builds and is
unavailable in the development server.

## Production verification

```sh
npm test
npm run check
npm run build
npm run preview
```

## Always-on local server

Run DocShelf with production search and automatic rebuilding:

```sh
npm run watch
```

The watcher is available at `http://shelf.localhost:4321/`, binds to
`127.0.0.1` by default, observes only the shelf files and registered
artifact sources, and switches to a new isolated build only after it succeeds.
An invalid shelf or failed build leaves the previous site online. The watcher
writes its latest attempt to `.docshelf-runtime/build-status.json` and serves the
same state without caching at `/__docshelf/status`. Each attempt has a generation
and watcher-instance ID so automated clients can distinguish it from an earlier
success. The viewer polls this endpoint and shows a banner when a rebuild fails.
Diagnostic output in the status file is bounded; the watcher log receives the
detailed failed Astro build output. Every update runs a full Astro build into
an isolated directory, then publishes it only after the build succeeds and its
registered sources and DocShelf-owned inputs are still current. Files with
content-hash names beneath `_astro/` are served as immutable. Everything else
uses `no-cache` with an `ETag`, allowing unchanged files to receive a
`304 Not Modified` response. Set `DOCSHELF_VERBOSE=1` to stream Astro's output
for every build.

Set a different port when needed:

```sh
DOCSHELF_PORT=4331 npm run watch
```

The configured host and port are also used for generated canonical and sitemap
URLs.

`DOCSHELF_HOST` can change the listening interface. The default loopback address
keeps DocShelf local; binding to a network interface can expose registered files
to other machines. In loopback mode, DocShelf accepts only loopback and
`*.localhost` Host headers to prevent unrelated domains from reading the local
shelf through DNS rebinding.

The watcher is portable to environments where Node.js and file symlinks are
available. The login-service integration below is macOS-only.

### Locks

Only one watcher runs per DocShelf checkout. It holds
`.docshelf-runtime/watch.lock`, a directory whose `owner.json` records the
owning process, its start time, and the launchd service name when there is
one. A second `npm run watch` is refused with the owner's PID while that
process is alive. A lock left behind by a process that died without releasing
it is reclaimed automatically at the next start, including one whose PID has
since been reused by an unrelated process (on macOS and Linux, where the lock
compares the recorded start time and command line). If a start is still
refused for a PID that is not a DocShelf watcher, delete
`.docshelf-runtime/watch.lock` and retry. When the owner is the launchd agent,
`kill` alone lets launchd restart it; use `npm run daemon:uninstall` instead.

Artifact synchronization takes `.docshelf-runtime/sync.lock`. The sync step
that `npm run sync`, `dev`, `check`, `build`, and `preview` run first waits for
a rebuilding watcher to finish (up to two minutes) before it replaces
`public/artifacts`, and the watcher waits for a running sync before it
rebuilds. The lock covers the sync step only: a watcher rebuild that starts
while a manual `npm run build` is already copying `public/artifacts` can still
make that manual build fail with a revision mismatch. Rerun it.

## macOS login service

Install the watcher as a per-user `launchd` service that starts at login and is
kept running:

```sh
npm run daemon:install
npm run daemon:status
```

The installer generates a machine-specific plist in `~/Library/LaunchAgents/`.
It records the current Node executable, DocShelf path, host, and port, so rerun the
installer if any of them change, and after updating DocShelf so the loaded
service definition is current. `daemon:status` reports the values loaded by
`launchd`. Runtime builds and service logs stay in the ignored `.docshelf-runtime/`
directory.

The agent runs at standard priority. As a `Background` process type, launchd
would confine it and the Astro builds it spawns to efficiency cores with
throttled I/O, and every rebuild would take several times longer.

The installer refuses to run while a watcher that `launchd` does not manage
holds the watcher lock, because the agent would fail to start and be relaunched
every ten seconds. After bootstrapping it waits for the agent to take the lock
and reports the exit code and log path if the agent exits instead.

Remove the service with:

```sh
npm run daemon:uninstall
```

## Releases

Prepare a release with an explicit semantic version or a bump keyword:

```sh
gh workflow run release.yml -f version=patch
# or: version=minor, version=major, version=0.1.0
```

The workflow updates `package.json` and `package-lock.json`, verifies the build,
and pushes a `release/vX.Y.Z` branch. Open the pull-request link in the workflow
summary and squash-merge it after CI passes. The merge to `main` tags that exact
commit and creates the corresponding GitHub Release.

## License

MIT

The Markdown and optional HTML themes adapt colors from Tokyo Night for Obsidian,
and the optional HTML theme includes matcha.css. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for their MIT notices.
