# Contributing to DocShelf

DocShelf Web and DocShelf for Obsidian are independent apps in one repository. They catalog explicitly registered documents while preserving their original locations. See the [shared setup and architecture guide](docs/unification.md) before changing behavior shared by both apps.

## Set up a checkout

Use Node.js 24 or newer and run `npm ci` at the repository root. Maintain only the root lockfile. The web app lives at the root, the desktop plugin in `packages/obsidian/`, pure helpers in `packages/core/`, and shared filesystem helpers in `packages/local/`.

For web UI development, run `npm run dev`. For the production search and rebuild loop, use `npm run watch`; keep only one watcher per checkout. See the [local server guide](docs/local-server.md) and the plugin's [development instructions](packages/obsidian/README.md#develop-and-verify) for app-specific setup.

## Preserve document boundaries

The web app must not modify source documents. The plugin may save explicitly registered local Markdown only after its recovery, registration, containment, file identity, and conflict checks pass. Preserve the strict accepted URL formats and each app's rendering isolation. See [Security and file access](SECURITY.md).

Keep private shelves, settings, document contents, recovery files, and local reports out of commits. Use ignored `shelf.local.json` and `.local/` for machine-specific data; tracked `shelf.json` remains an empty template. Do not edit or commit generated `public/artifacts/`, `src/generated/`, `build/`, `dist/`, `.astro/`, `.docshelf-runtime/`, or plugin build output. Generated core declarations under `packages/core/types/` are tracked: regenerate them with `npm run build --workspace @docshelf/core` when the core API changes.

## Verify changes

For web-only changes, run these commands from the repository root:

```sh
npm test
npm run check
npm run lint
npm run build
```

For shared helpers or plugin changes, run the aggregate checks used by CI:

```sh
npm run test:all
npm run check:all
npm run build:all
```

The checks include browser JavaScript type checking and typed lint rules scoped to each app's runtime. Browser tests use an installed Brave, Chrome, or Chromium; set `DOCSHELF_TEST_BROWSER` to its executable when needed. Check test output for skipped browser tests and report any verification you could not run.

After building plugin runtime changes, also run `npm run test:obsidian --workspace obsidian-docshelf`. It uses a disposable profile and vault; see the [runtime requirements](packages/obsidian/README.md#develop-and-verify). Before changing release packaging, run `npm run package:obsidian` and `npm run test:package --workspace obsidian-docshelf`. Keep distribution metadata in `packages/obsidian/` and update its root mirrors with `npm run sync:obsidian-metadata`; the [release guide](docs/releasing.md) covers tags and assets.

## Propose a change

Open an issue with reproduction steps, the affected app and version, expected behavior, and relevant logs with private paths and document contents removed. Report suspected vulnerabilities privately according to the [security policy](SECURITY.md).

Keep pull requests focused. Explain the problem, resulting behavior, and checks you ran; include screenshots for visible UI changes and regression tests when behavior warrants them. Follow the repository's `AGENTS.md` guidance, including keeping each Markdown prose paragraph on one source line.
