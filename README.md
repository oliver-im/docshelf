# DocShelf

A local, searchable shelf for explicitly registered HTML and Markdown
artifacts. Source projects keep ownership of their files; DocShelf provides
navigation, stable local URLs, and search without exposing the surrounding
workspace.

## Why DocShelf exists

HTML is useful for visual reports and interactive explanations, while Markdown
is useful for durable notes and documentation. Those files become difficult to
rediscover when they are spread across projects or opened through ad hoc
`file://` links. DocShelf gives explicitly selected files one curated local
shelf without crawling or serving their owning project directories.

DocShelf is intentionally explicit: one manifest entry maps one source file to one
stable route.

## Requirements

- Node.js 24 or newer
- A filesystem that supports symbolic links

DocShelf expects to live inside a workspace alongside the projects it catalogs:

```text
workspace/
├── docshelf/
└── example-project/
```

Registered sources must resolve inside the workspace root, defined as DocShelf's
parent directory. This keeps a misplaced manifest entry from reaching outside
the intended workspace.

## Setup

```sh
npm install
cp artifacts.json artifacts.local.json
npm run watch
```

Register artifacts in the ignored `artifacts.local.json` file:

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

Sources are relative to the DocShelf directory and may end in `.html` or `.md`.
Routes are served below `/artifacts/` and always end in `.html`, including when
the source is Markdown. `artifacts.json` is both the copyable manifest template
and a tracked empty fallback, allowing a clean clone to build without local
entries. Machine-specific registrations belong only in the ignored
`artifacts.local.json` file.

DocShelf reads each registered source into a standalone HTML snapshot beneath
its ignored runtime directory. Markdown is rendered to HTML; existing HTML is
copied into the same generated pipeline. When a relative link resolves to
another registered source, DocShelf rewrites only the generated link to use the
target's stable DocShelf route. External links, same-document anchors, and
unregistered targets remain unchanged. DocShelf never modifies the original
files.

`npm run sync`, `dev`, `check`, and `build` validate the manifest and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

## Using the viewer

Choose an artifact in the left sidebar to load it inside DocShelf. Use a modified
click or the browser's link menu when you want to open the standalone artifact.

- `Command/Ctrl+B` toggles the artifact sidebar.

Drag the divider beside the sidebar to change its width. When the divider has
keyboard focus, the arrow keys resize it in smaller steps. The width and
visibility preferences are stored in the browser.

The selected artifact is written to the page URL, so a viewer state can be
bookmarked. The viewer keeps the current document visible while a selected or
updated artifact loads in a hidden frame, then swaps frames after the new
document is ready. While `npm run watch` is running, content revisions are
checked when the window regains focus and every few seconds while it remains
visible.

## Markdown rendering

Markdown artifacts support GitHub-flavored tables, task lists, strikethrough,
heading anchors, and syntax-highlighted fenced code. YAML or TOML frontmatter is
removed from the rendered document; a valid `lang` frontmatter value sets the
HTML document language.

Rendered Markdown uses an adapted Tokyo Night reading theme with a constrained
line length. Its light or dark appearance follows DocShelf, including theme changes
made while the document is open. Existing HTML artifacts retain their own
styles.

Raw HTML inside Markdown is omitted. Use a registered HTML artifact when a
document needs custom markup or scripts. Remote images work, but relative images
do not yet: DocShelf exposes only registered files and does not serve neighboring
project directories.

## Agent skill

This repository includes a `docshelf` agent skill for registering HTML and
Markdown artifacts. Install it globally when you want to say “add this to
DocShelf” from any project:

```sh
npx skills add oliver-im/docshelf --skill docshelf -g
```

The skill also provides an optional DocShelf HTML theme. Ask for the “DocShelf
theme” when creating a standalone HTML artifact; registering existing HTML does
not alter its styles.

## Security

Registered HTML is treated as trusted content and may execute scripts with the
same origin as DocShelf. Register only HTML files you trust. Keep DocShelf bound to its
default loopback address unless you intentionally want to expose registered
artifacts to the network. See [`SECURITY.md`](SECURITY.md) for the vulnerability
reporting policy and security boundaries.

## Site development

Use Astro's development server while changing DocShelf pages, components, or
styles:

```sh
npm run dev
```

The development server loads the artifact manifest when it starts. Restart it
after editing the manifest, or use `npm run watch` for automatic manifest and
source-file rebuilding. Search is generated only during production builds and
is unavailable in the development server.

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
`127.0.0.1` by default, observes only the manifest files and registered
artifact sources, and switches to a new isolated build only after it succeeds.
An invalid manifest or failed build leaves the previous site online. The watcher
writes its latest attempt to `.docshelf-runtime/build-status.json` and serves the
same state without caching at `/__docshelf/status`. Each attempt has a generation
and watcher-instance ID so automated clients can distinguish it from an earlier
success. The viewer polls this endpoint and shows a banner when a rebuild fails.
Diagnostic output in the status file is bounded; the watcher log receives the
detailed failed Astro build output and is trimmed as described below.

A change that leaves the catalog as it was (the projects, routes, titles, and
descriptions in the manifest) is published without running Astro: the watcher
reuses the active build's site, replaces the artifact snapshots and their
revision state, rewrites the revisions the viewer page embeds, and rebuilds the
search index. Everything else runs a full Astro build: the first build after a
start, a manifest change that alters the catalog, and any change to DocShelf's
own files (`astro.config.mjs`, `package-lock.json`, `tsconfig.json`,
`public/`, `scripts/`, and `src/`), whose contents the watcher fingerprints
before each rebuild rather than watching. Astro's output is printed only when
a build fails; set `DOCSHELF_VERBOSE=1` to stream it.

Files beneath `_astro/` are served as immutable because Astro names them by
content hash. Everything else is served with `no-cache` and an `ETag`, so a
browser revalidates and receives `304 Not Modified` while a file is unchanged;
artifacts use their content revision as the tag.

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
catalog through DNS rebinding.

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
directory. The watcher trims each service log once it grows past 1 MiB, keeping
the most recent 256 KiB, so the logs stay bounded without log rotation.

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
