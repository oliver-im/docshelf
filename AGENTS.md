# DocShelf agent guidance

DocShelf Web and DocShelf for Obsidian are independent apps that catalog explicitly registered files and folders without taking ownership of their source content. They share pure helpers and a registration workflow, and can use the same shelf.

## Markdown formatting

Keep each prose paragraph on one source line, including prose within list items, and rely on editor or viewer word wrap. Do not hard-wrap prose to a character or word limit or split it into one source line per sentence. Preserve structural line breaks for headings, separate list items, code blocks, tables, and intentional Markdown line breaks.

## Repository boundaries

- `shelf.json` is the tracked empty fallback and shelf template.
- `shelf.local.json` contains the machine-specific shelf and must not be committed.
- Put local reports, notes, and other private working documents in the ignored `.local/` directory. Maintained project documentation belongs in `docs/`. Adding a document to the shelf does not imply committing its source.
- `public/artifacts/`, `src/generated/`, `dist/`, `.astro/`, and `.docshelf-runtime/` are generated. Do not edit or commit them.
- Local source files belong to their owning projects. DocShelf may create symlinks, render Markdown beneath its runtime directory, and alter copied build output, but the web app must not modify source artifacts. The Obsidian plugin may edit registered Markdown originals under `packages/obsidian/AGENTS.md`.
- Claude sources must be exact published Artifact links. Preserve strict URL validation and the web app's cross-origin `/embed` boundary; do not generalize it into arbitrary remote HTML loading.
- Browser-imported Markdown must remain limited to public GitHub Markdown file URLs. Preserve strict host and extension checks, the size limit, raw-HTML omission, sanitization, and generated-document content security policy; do not generalize it into arbitrary remote content loading.
- Preserve the web app's safety checks around workspace containment, symlink-only cleanup, and build output beneath `.docshelf-runtime/`. Web sources must resolve inside the checkout or the configured workspace root, which defaults to the checkout's parent directory unless `DOCSHELF_WORKSPACE` names another directory. Do not add other ways to widen it. Obsidian uses its shelf directory and configured workspace root, as described in its own guidance.

## Repository layout

- DocShelf Web stays at the root so existing services and shelf paths keep working.
- `packages/obsidian/` contains the desktop plugin and its own safety guidance.
- Root `manifest.json` and `versions.json` are tracked mirrors for Obsidian distribution. Maintain their originals in `packages/obsidian/`, then run `npm run sync:obsidian-metadata`; plugin checks and packaging reject drift. Plugin release tags use plain `X.Y.Z`, while web releases use `vX.Y.Z`.
- `packages/core/` contains pure helpers used by both apps. Keep filesystem, server, editor, DOM, and host-specific UI code out of this package.
- `packages/local/` contains shared Node filesystem discovery, registration, watch scoping, and lock helpers. Keep Obsidian and browser APIs outside it. Folder discovery must preserve workspace and selected-folder containment and skip descendant symlinks.
- `packages/core/types/` contains tracked generated declarations. After changing the core API, regenerate them with `npm run build --workspace @docshelf/core` and include the resulting declaration changes; do not hand-edit them.
- Use Node.js 24 or newer. Install dependencies at the root with `npm ci`; maintain only the root lockfile.
- `.agents/skills/docshelf/` is the registration skill for both apps.
- The imported plugin history crosses a merge-time directory move. To trace it, run `git log -m --follow -- packages/obsidian/FILE`, replacing `FILE` with the target file's path relative to `packages/obsidian/`. See [repository history and shared setup](docs/unification.md).

## Shared shelf compatibility

- Keep a shared `shelf.local.json` at the web checkout root and point Obsidian at that file. Align Obsidian's Workspace root with `DOCSHELF_WORKSPACE` when customized; neither app reads the other's settings.
- Shared shelves support relative local Markdown/HTML sources and published Claude Artifacts, with unique lowercase `.html` routes. GitHub Markdown shelf entries and absolute local sources are Obsidian-only; the web loader rejects them. Web GitHub imports live in browser storage.
- Obsidian's per-document `assets` registrations do not publish files to the web app. Preserve the app-specific validation rules documented in [shared shelf differences](docs/unification.md#differences-that-remain).

## Working commands

- `npm run watch` runs the production-search build loop and local server. One watcher per checkout holds `.docshelf-runtime/watch.lock`; artifact sync (`sync`, `dev`, `check`, `build`, `preview`) serializes on `sync.lock` and waits for a rebuilding watcher. Never delete either lock while its owner runs.
- Every watcher update runs a full Astro build into an isolated directory and publishes it only after it succeeds and its inputs are still current. Astro's output is shown only when a build fails; `DOCSHELF_VERBOSE=1` streams it.
- `npm run dev` is for DocShelf UI development; restart it after shelf changes.
- Before handing off web-only code changes, run `npm test`, `npm run check`, and `npm run build` at the root. For shared or plugin changes, use `npm run test:all`, `npm run check:all`, and `npm run build:all` instead; these include the root checks and match CI.
- For plugin runtime changes, build first, then run `npm run test:obsidian --workspace obsidian-docshelf`. This uses a disposable profile and vault and is separate from the aggregate checks; see the [runtime requirements](packages/obsidian/README.md#develop-and-verify).
- The watcher is the portable runtime. `scripts/launchd.mjs` is an optional macOS-only integration.
- On macOS, `npm run setup` installs the normal `https://shelf.localhost/` address and login service. Reuse compatible Portless state and aliases. Never replace a conflicting shared proxy or route, disable TLS validation, enable LAN/public forwarding, or run the DocShelf watcher as root. Privileged setup needs the installer's explicit interactive consent; `--direct` skips Portless entirely.
