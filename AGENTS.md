# DocShelf agent guidance

DocShelf catalogs explicitly registered HTML and Markdown files without taking
ownership of their source projects.

## Repository boundaries

- `artifacts.json` is the tracked empty fallback and manifest template.
- `artifacts.local.json` contains machine-specific registrations and must not be
  committed.
- `public/artifacts/`, `src/generated/`, `dist/`, `.astro/`, and
  `.docshelf-runtime/` are generated. Do not edit or commit them.
- Source files belong to their owning projects. DocShelf may create symlinks,
  render Markdown beneath its runtime directory, and alter copied build output,
  but must not modify source artifacts.
- Preserve the safety checks around workspace containment, symlink-only cleanup,
  and build output beneath `.docshelf-runtime/`.

## Working commands

- `npm run watch` runs the production-search build loop and local server. One
  watcher per checkout holds `.docshelf-runtime/watch.lock`; artifact sync
  (`sync`, `dev`, `check`, `build`, `preview`) serializes on `sync.lock` and
  waits for a rebuilding watcher. Never delete either lock while its owner runs.
- Every watcher update runs a full Astro build into an isolated directory and
  publishes it only after it succeeds. Astro's output is shown only when a
  build fails; `DOCSHELF_VERBOSE=1` streams it.
- `npm run dev` is for DocShelf UI development; restart it after manifest changes.
- Before handing off code changes, run `npm test`, `npm run check`, and
  `npm run build`.
- The watcher is the portable runtime. `scripts/launchd.mjs` is an optional
  macOS-only integration.
