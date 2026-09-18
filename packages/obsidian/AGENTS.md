# DocShelf for Obsidian

This desktop plugin opens explicitly registered local Markdown in Obsidian's
native editor and displays HTML and supported remote sources read-only.
Local Markdown edits save to the original file, with recovery and conflict
checks. Do not add mirrors, implicit folder registration, or native vault
indexing without a deliberate scope change.

- `.local/` holds private feasibility notes and local test output.
- `shelf.local.json` and plugin `data.json` are machine-specific; never commit them.
- `shelf.json` is an empty template. Examples belong in `examples/`.
- Resolve local source paths relative to the shelf file. Canonicalize paths and
  preserve workspace containment on every read, including after symlink changes.
- Before Markdown writes, revalidate registration, canonical target, file
  identity, and baseline contents. Persist recovery first; never recreate a
  deleted source or overwrite a detected external change without user review.
- Recovery files contain private document text. Keep them under the installed
  plugin's `recovery/` directory, never in the shelf or workspace layout.
- Serve only registered documents and explicitly listed assets on the plugin's
  token-protected loopback server. Never expose a general filesystem endpoint.
- Interactive HTML belongs in an isolated webview session. Never load it from
  `file://`, Obsidian's `app://` origin, or inline in Obsidian's privileged DOM.
- Only public GitHub Markdown and exact published Claude Artifact URLs are
  accepted remote sources. Preserve size limits and Markdown sanitization.
- URI parameters use `vault` and `source`; `path` is reserved by Obsidian routing.
- Use Obsidian theme variables and accessible native controls.
- Install dependencies with `npm ci` at the repository root; keep only the root
  lockfile. Run `npm run test:all`, `npm run check:all`, and `npm run build:all`
  there before handing off changes. To target the plugin from the root, add
  `--workspace obsidian-docshelf` to its npm commands.
- After building, use `npm run test:obsidian --workspace obsidian-docshelf` from
  the root for runtime behavior when Obsidian is available. Runtime tests use a
  disposable profile and vault, never the user's vault.
