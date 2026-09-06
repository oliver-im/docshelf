# Running and updating DocShelf

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

## Updating an existing installation

Stop the foreground watcher with Ctrl+C before updating. If you installed the
macOS login service, stop it with `npm run daemon:uninstall` instead; launchd
would restart a process stopped with `kill` alone.

From the DocShelf checkout on `main`:

```sh
git pull --ff-only
npm ci
npm test
npm run check
npm run build
npm run watch
```

For a macOS login service, replace the last command with
`npm run daemon:install`, then check `npm run daemon:status`. Reapply any custom
`DOCSHELF_HOST` and `DOCSHELF_PORT` values when installing the service.

Keep your `shelf.local.json`; do not repeat the first-install copy command.
The ignored shelf, source documents, and browser imports survive this update.
Use the same site origin (scheme, host, and port) to keep access to existing
browser imports and preferences. A Git pull that cannot fast-forward needs
your local branch changes resolved before continuing.

Older installations may still use `artifacts.local.json`. If there is no
`shelf.local.json`, rename the old file:

```sh
mv artifacts.local.json shelf.local.json
```

If both files exist, DocShelf uses `shelf.local.json`. Merge any missing entries
into that file before retiring the older file.

After restarting, open the printed URL and confirm your documents appear.
`/__docshelf/status` should report `state: "ready"` for the new watcher instance.

## Why the site can look stale

The production watcher observes shelf files and registered source documents.
It does not reload its own server code, UI components, or configuration when
those files change. Restart it after an update, even if a separate
`npm run build` succeeds: the running watcher serves an isolated runtime build,
not the latest `dist/` directory. Use `npm run dev` for UI work.

## Locks

Only one watcher runs per DocShelf checkout. It holds
`.docshelf-runtime/watch.lock`, a directory whose `owner.json` records the
owning process, its start time, and the launchd service name when there is
one. A second `npm run watch` is refused with the owner's PID while that
process is alive. A lock left behind by a process that died without releasing
it is reclaimed automatically at the next start, including one whose PID has
since been reused by an unrelated process (on macOS and Linux, where the lock
compares the recorded start time and command line). If a start is still
refused, inspect the reported process and resolve its ownership before retrying.
Never delete a watcher or sync lock while its owner is running. When the owner
is the launchd agent, `kill` alone lets launchd restart it; use
`npm run daemon:uninstall` instead.

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

## Development and verification

Use `npm run dev` for pages, components, and styles. Restart it after changing
the shelf. Search is generated only during production builds and is unavailable
in the development server.

Before handing off code changes, run:

```sh
npm test
npm run check
npm run build
```

`npm run preview` serves the standard `dist/` build. The watcher is the runtime
that provides production search, source updates, and macOS Finder actions.

## GitHub Pages demo

Pushes to `main` rebuild the public demo from the README. The Pages workflow
copies `.github/pages-shelf.json` to the ignored local shelf for the build and
sets `DOCSHELF_SITE`, `DOCSHELF_BASE`, and `DOCSHELF_LIVE_UPDATES=false`.
Only the README registered by that shelf is published as a document. Static
assets in `public/`, including the sample screenshot, are also published;
machine-local registrations and neighboring project files are excluded.
Visitors can use the plus button to import supported public links in their own
browser. A fork can register its own documents in the Pages shelf.
