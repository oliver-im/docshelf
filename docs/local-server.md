# Running and updating DocShelf

## Install with a stable local address

On macOS, after `npm ci`, run:

```sh
npm run setup
```

Setup initializes a new local shelf with the README, preserving an existing
`shelf.local.json` or legacy `artifacts.local.json`. It installs a DocShelf login
service and verifies the first successful build at **https://shelf.localhost/**.
The backend stays on `127.0.0.1:4321`; a shared
[Portless](https://github.com/vercel-labs/portless) proxy provides HTTPS on port
443 and redirects HTTP on port 80.

The installer supports Portless 0.15.6–0.15.x. It reuses a compatible existing
startup service and matching `shelf.localhost` alias. When needed, it asks before
installing Portless globally from npm, creating its startup service, trusting
its local certificate authority, or synchronizing local hostnames in
`/etc/hosts` for system DNS and Safari. Those steps may request an administrator
password. Run setup as your regular user, without `sudo`; the DocShelf watcher
always runs as you. Noninteractive setup proceeds only when no such approval
is needed.

Setup refuses to replace another app's alias, a proxy configured for LAN access,
or a DocShelf service owned by another checkout. It also checks for a conflicting
backend listener. A stopped or incompatible shared proxy is left for its owner
to configure; inspect `portless service status`, `portless list`, and
`portless doctor` before retrying. Setup does not enable LAN access or public
tunnels. It never disables certificate validation to make verification pass.

Automatic setup is macOS-only and uses a LaunchAgent. The proxy starts at boot,
and DocShelf starts when you log in. Other platforms can use the foreground
watcher below.

To install automatic startup without Portless or HTTPS:

```sh
npm run setup -- --direct
```

Open `http://shelf.localhost:4321/`, or `http://127.0.0.1:4321/` if the system
does not resolve the hostname. Declining a privileged setup prompt stops setup
and prints this fallback; it does not silently switch your browser origin.
The direct URL remains available behind an HTTPS installation, too.

For a different backend port, run `DOCSHELF_PORT=4331 npm run setup`. A preexisting
alias for another port is treated as a conflict and is not overwritten. Keep
using the same browser origin: imports and preferences saved at the old HTTP
address do not automatically appear at the HTTPS address. Re-add browser imports
there if migrating; registered local documents are unaffected.

## Foreground server

Run DocShelf with production search and automatic rebuilding in a terminal:

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

Registered symlinks and their resolved targets are both watched, including
symlinked source directories. Retargeting a link rebuilds the document without
requiring a shelf edit. Source reads recheck workspace containment and file
identity when taking and verifying build snapshots; a changed target requires
a fresh shelf load before it can be published.

Set a different port when needed:

```sh
DOCSHELF_PORT=4331 npm run watch
```

The configured host and port are also used for generated canonical and sitemap
URLs unless `DOCSHELF_SITE` specifies the installed address. Setup records
`https://shelf.localhost` in the login service for this purpose.

`DOCSHELF_HOST` can change the listening interface. The default loopback address
keeps DocShelf local; binding to a network interface can expose registered files
to other machines. In loopback mode, DocShelf accepts only loopback and
`*.localhost` Host headers to prevent unrelated domains from reading the local
shelf through DNS rebinding.

`DOCSHELF_WORKSPACE` changes the workspace root, the directory that registered
sources must resolve inside. It defaults to the checkout's parent directory.
Files inside the checkout itself, such as the README that `npm run setup`
registers, are accepted whatever the root is. Give an absolute path or one
relative to the checkout, and set it for every command that reads the shelf,
including `npm run dev`, `npm run build`, and `npm run watch`:

```sh
DOCSHELF_WORKSPACE=../.. npm run watch
```

`npm run setup` records the value in the login service. A wider root lets
DocShelf read and serve registered files from a larger area; unregistered files
are still never served.

The watcher is portable to environments where Node.js and file symlinks are
available. Stop it with Ctrl+C. Stop an installed login service before starting
a foreground watcher in the same checkout.

## Updating an existing installation

Stop the foreground watcher with Ctrl+C before updating. If you installed the
login service, stop it with `npm run daemon:uninstall` instead; the service manager
would restart a process stopped with `kill` alone.

From the DocShelf checkout on `main`:

```sh
git pull --ff-only
npm ci
npm test
npm run check
npm run build
npm run setup
```

Use `npm run setup -- --direct` if you installed with the direct-port address,
or `npm run watch` for a foreground server. Check `npm run daemon:status` after
automatic setup. Reapply a custom `DOCSHELF_PORT` or `DOCSHELF_WORKSPACE` when
reinstalling.

Keep your `shelf.local.json`; setup preserves it.
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

## Managing automatic startup

On macOS, `npm run setup` installs the login service. Manage it with:

```sh
npm run daemon:status
npm run daemon:uninstall
```

Uninstall removes only DocShelf's login service. It preserves your documents,
local shelf, runtime output, and the shared Portless service and alias. If you
are retiring this shelf permanently, inspect `portless list` before removing
its alias with `portless alias --remove shelf`. Manage the shared proxy with
Portless's own commands only when it is no longer needed by other apps.

`npm run daemon:install` is the lower-level service command: it does not
configure Portless or verify HTTPS. Prefer rerunning `npm run setup` to update
the complete installation.

Install the watcher as a per-user `launchd` service that starts at login and is
kept running:

```sh
npm run daemon:install
npm run daemon:status
```

The installer generates a machine-specific plist in `~/Library/LaunchAgents/`.
It records the current Node executable, DocShelf path, host, port, site URL,
and any `DOCSHELF_WORKSPACE`. Rerun the installer after changing Node, the
host, port, site URL, or `DOCSHELF_WORKSPACE`, and after updating DocShelf so
the loaded service definition is current. If you move or rename the checkout,
uninstall the old service from the new checkout by naming its original absolute
path, then run setup again:

```sh
npm run daemon:uninstall -- --from /absolute/old/checkout
npm run setup
```

The old path does not need to exist, but it must match the installed service.
`daemon:status` reports the values loaded by
`launchd`. Runtime builds and service logs stay in the ignored `.docshelf-runtime/`
directory.

The agent runs at standard priority. As a `Background` process type, launchd
would confine it and the Astro builds it spawns to efficiency cores with
throttled I/O, and every rebuild would take several times longer.

The installer refuses to run while a watcher that `launchd` does not manage
holds the watcher lock, because the agent would fail to start and be relaunched
every ten seconds. After bootstrapping it waits for the agent to take the lock
and reports the exit code and log path if the agent exits instead.

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
