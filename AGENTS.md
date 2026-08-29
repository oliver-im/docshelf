# Atlas agent guidance

Atlas catalogs explicitly registered HTML files without taking ownership of
their source projects.

## Repository boundaries

- `artifacts.json` is the tracked empty fallback and manifest template.
- `artifacts.local.json` contains machine-specific registrations and must not be
  committed.
- `public/artifacts/`, `src/generated/`, `dist/`, `.astro/`, and
  `.atlas-runtime/` are generated. Do not edit or commit them.
- Source HTML belongs to its owning project. Atlas may create symlinks and alter
  copied build output, but must not modify source artifacts.
- Preserve the safety checks around workspace containment, symlink-only cleanup,
  and build output beneath `.atlas-runtime/`.

## Working commands

- `npm run watch` runs the production-search build loop and local server.
- `npm run dev` is for Atlas UI development; restart it after manifest changes.
- Before handing off code changes, run `npm test`, `npm run check`, and
  `npm run build`.
- The watcher is the portable runtime. `scripts/launchd.mjs` is an optional
  macOS-only integration.
