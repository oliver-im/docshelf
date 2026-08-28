# Atlas

A local, searchable catalog for explicitly registered HTML artifacts. Source
projects keep ownership of their files; Atlas provides navigation, stable local
URLs, and search without exposing the surrounding workspace.

## Setup

```sh
npm install
cp artifacts.json artifacts.local.json
npm run dev
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

Sources are relative to the Atlas directory. Routes are served below
`/artifacts/`. If no local manifest exists, Atlas uses the tracked, empty
`artifacts.json` default.

`npm run sync`, `dev`, `check`, and `build` validate the manifest and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

## Production verification

```sh
npm run check
npm run build
npm run preview
```

Search is generated during the production build and is unavailable in the Astro
development server.

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
to other machines.

## macOS login service

Install the watcher as a per-user `launchd` service that starts at login and is
kept running:

```sh
npm run daemon:install
npm run daemon:status
```

The installer generates a machine-specific plist in `~/Library/LaunchAgents/`.
It records the current Node executable and Atlas path, so rerun the installer if
either location changes. Runtime builds and service logs stay in the ignored
`.atlas-runtime/` directory.

Remove the service with:

```sh
npm run daemon:uninstall
```

## License

MIT
