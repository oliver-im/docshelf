# Atlas

A local, searchable catalog for explicitly registered HTML and Markdown
artifacts. Source projects keep ownership of their files; Atlas provides
navigation, stable local URLs, and search without exposing the surrounding
workspace.

## Why Atlas exists

HTML is useful for visual reports and interactive explanations, while Markdown
is useful for durable notes and documentation. Those files become difficult to
rediscover when they are spread across projects or opened through ad hoc
`file://` links. Atlas gives explicitly selected files one local catalog without
crawling or serving their owning project directories.

Atlas is intentionally explicit: one manifest entry maps one source file to one
stable route.

## Requirements

- Node.js 24 or newer
- A filesystem that supports symbolic links

Atlas expects to live inside a workspace alongside the projects it catalogs:

```text
workspace/
├── atlas/
└── example-project/
```

Registered sources must resolve inside the workspace root, defined as Atlas's
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

Sources are relative to the Atlas directory and may end in `.html` or `.md`.
Routes are served below `/artifacts/` and always end in `.html`, including when
the source is Markdown. `artifacts.json` is both the copyable manifest template
and a tracked empty fallback, allowing a clean clone to build without local
entries. Machine-specific registrations belong only in the ignored
`artifacts.local.json` file.

HTML sources are passed through unchanged. Markdown sources are rendered into
standalone HTML snapshots beneath Atlas's ignored runtime directory; Atlas never
modifies the original files.

`npm run sync`, `dev`, `check`, and `build` validate the manifest and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

## Using the viewer

Choose an artifact in the left sidebar to load it inside Atlas. Use a modified
click or the browser's link menu when you want to open the standalone artifact.

- `Command/Ctrl+B` toggles the artifact sidebar.

Drag the divider beside the sidebar to change its width. When the divider has
keyboard focus, the arrow keys resize it in smaller steps. The width and
visibility preferences are stored in the browser.

The selected artifact is written to the page URL, so a viewer state can be
bookmarked.

## Markdown rendering

Markdown artifacts support GitHub-flavored tables, task lists, strikethrough,
heading anchors, and syntax-highlighted fenced code. YAML or TOML frontmatter is
removed from the rendered document; a valid `lang` frontmatter value sets the
HTML document language.

Rendered Markdown uses an adapted Tokyo Night reading theme with a constrained
line length. Its light or dark appearance follows Atlas, including theme changes
made while the document is open. Existing HTML artifacts retain their own
styles.

Raw HTML inside Markdown is omitted. Use a registered HTML artifact when a
document needs custom markup or scripts. Remote images work, but relative images
do not yet: Atlas exposes only registered files and does not serve neighboring
project directories.

## Security

Registered HTML is treated as trusted content and may execute scripts with the
same origin as Atlas. Register only HTML files you trust. Keep Atlas bound to its
default loopback address unless you intentionally want to expose registered
artifacts to the network.

## Site development

Use Astro's development server while changing Atlas pages, components, or
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

Run Atlas with production search and automatic rebuilding:

```sh
npm run watch
```

The watcher listens on `http://127.0.0.1:4321/`, observes only the manifest
files and registered artifact sources, and switches to a new isolated build
only after it succeeds. An invalid manifest or failed build leaves the previous
site online.

Set a different port when needed:

```sh
ATLAS_PORT=4331 npm run watch
```

`ATLAS_HOST` can change the listening interface. The default loopback address
keeps Atlas local; binding to a network interface can expose registered files
to other machines. In loopback mode, Atlas accepts only loopback and
`*.localhost` Host headers to prevent unrelated domains from reading the local
catalog through DNS rebinding.

The watcher is portable to environments where Node.js and file symlinks are
available. The login-service integration below is macOS-only.

## macOS login service

Install the watcher as a per-user `launchd` service that starts at login and is
kept running:

```sh
npm run daemon:install
npm run daemon:status
```

The installer generates a machine-specific plist in `~/Library/LaunchAgents/`.
It records the current Node executable, Atlas path, host, and port, so rerun the
installer if any of them change. `daemon:status` reports the values loaded by
`launchd`. Runtime builds and service logs stay in the ignored `.atlas-runtime/`
directory.

Remove the service with:

```sh
npm run daemon:uninstall
```

## License

MIT

The Markdown theme is adapted from Tokyo Night for Obsidian. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for its MIT notice.
