# Atlas

A local, searchable catalog for explicitly registered HTML artifacts. Source
projects keep ownership of their files; Atlas provides navigation, stable local
URLs, and search without exposing the surrounding workspace.

## Why Atlas exists

HTML is useful for visual reports, interactive explanations, and other documents
that are awkward to understand as plain text. Those files become difficult to
rediscover when they are spread across projects or opened through ad hoc
`file://` links. Atlas gives explicitly selected files one local catalog without
crawling or serving their owning project directories.

Atlas is intentionally explicit: one manifest entry maps one source HTML file to
one stable route.

## Requirements

- Node.js 22.12 or newer
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
      "source": "../example-project/docs/overview.html",
      "route": "example-project/overview.html",
      "title": "Project overview",
      "description": "A visual overview of the example project."
    }
  ]
}
```

Sources are relative to the Atlas directory and routes are served below
`/artifacts/`. `artifacts.json` is both the copyable manifest template and a
tracked empty fallback, allowing a clean clone to build without local entries.
Machine-specific registrations belong only in the ignored
`artifacts.local.json` file.

`npm run sync`, `dev`, `check`, and `build` validate the manifest and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

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
files and registered HTML sources, and switches to a new isolated build only
after it succeeds. An invalid manifest or failed build leaves the previous site
online.

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
