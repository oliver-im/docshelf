# DocShelf agent guidance

DocShelf catalogs explicitly registered HTML and Markdown files, plus narrowly
validated browser imports, without taking ownership of their source content.

## Repository boundaries

- `shelf.json` is the tracked empty fallback and shelf template.
- `shelf.local.json` contains the machine-specific shelf and must not be
  committed.
- Put local reports, notes, and other private working documents in the ignored
  `.local/` directory. Maintained project documentation belongs in `docs/`.
  Adding a document to the shelf does not imply committing its source.
- `public/artifacts/`, `src/generated/`, `dist/`, `.astro/`, and
  `.docshelf-runtime/` are generated. Do not edit or commit them.
- Local source files belong to their owning projects. DocShelf may create symlinks,
  render Markdown beneath its runtime directory, and alter copied build output,
  but the web app must not modify source artifacts. The Obsidian plugin may edit
  registered Markdown originals under `packages/obsidian/AGENTS.md`.
- Claude sources must be exact published Artifact links. Preserve strict URL
  validation and the cross-origin `/embed` boundary; do not generalize it into
  arbitrary remote HTML loading.
- Browser-imported Markdown must remain limited to public GitHub Markdown file
  URLs. Preserve strict host and extension checks, the size limit, raw-HTML
  omission, sanitization, and generated-document content security policy; do
  not generalize it into arbitrary remote content loading.
- Preserve the safety checks around workspace containment, symlink-only cleanup,
  and build output beneath `.docshelf-runtime/`. Sources must resolve inside the
  workspace root, the checkout's parent directory unless `DOCSHELF_WORKSPACE`
  names another directory, or inside the checkout itself; do not add other ways
  to widen it.

## Repository layout

- DocShelf Web stays at the root so existing services and shelf paths keep working.
- `packages/obsidian/` contains the desktop plugin and its own safety guidance.
- `packages/core/` contains pure helpers used by both apps. Keep filesystem,
  server, editor, and host-specific UI code out of this package.
- Install dependencies at the root with `npm ci`; maintain only the root lockfile.
- `.agents/skills/docshelf/` is the registration skill for both apps.

## Working commands

- `npm run watch` runs the production-search build loop and local server. One
  watcher per checkout holds `.docshelf-runtime/watch.lock`; artifact sync
  (`sync`, `dev`, `check`, `build`, `preview`) serializes on `sync.lock` and
  waits for a rebuilding watcher. Never delete either lock while its owner runs.
- Every watcher update runs a full Astro build into an isolated directory and
  publishes it only after it succeeds and its inputs are still current. Astro's
  output is shown only when a build fails; `DOCSHELF_VERBOSE=1` streams it.
- `npm run dev` is for DocShelf UI development; restart it after shelf changes.
- Before handing off code changes, run `npm test`, `npm run check`, and
  `npm run build`. For shared or plugin changes, also run the workspace checks
  via `npm run test:all`, `npm run check:all`, and `npm run build:all`. Use the
  plugin's disposable Obsidian runtime suite for plugin runtime changes.
- The watcher is the portable runtime. `scripts/launchd.mjs` is an optional
  macOS-only integration.
- On macOS, `npm run setup` installs the normal `https://shelf.localhost/` address and
  login service. Reuse compatible Portless state and aliases. Never replace a
  conflicting shared proxy or route, disable TLS validation, enable LAN/public
  forwarding, or run the DocShelf watcher as root. Privileged setup needs the
  installer's explicit interactive consent; `--direct` skips Portless entirely.
