# DocShelf for Obsidian

This desktop plugin displays explicitly registered external Markdown and HTML.
Keep source files read-only. Do not add mirrors, write-back, implicit folder
registration, or native vault indexing without a deliberate scope change.

- `.local/` holds private feasibility notes and local test output.
- `shelf.local.json` and plugin `data.json` are machine-specific; never commit them.
- `shelf.json` is an empty template. Examples belong in `examples/`.
- Resolve local source paths relative to the shelf file. Canonicalize paths and
  preserve workspace containment on every read, including after symlink changes.
- Serve only registered documents and explicitly listed assets on the plugin's
  token-protected loopback server. Never expose a general filesystem endpoint.
- Interactive HTML belongs in an isolated webview session. Never load it from
  `file://`, Obsidian's `app://` origin, or inline in Obsidian's privileged DOM.
- Only public GitHub Markdown and exact published Claude Artifact URLs are
  accepted remote sources. Preserve size limits and Markdown sanitization.
- URI parameters use `vault` and `source`; `path` is reserved by Obsidian routing.
- Use Obsidian theme variables and accessible native controls.
- Before handing off changes run `npm test`, `npm run check`, `npm run build`.
  Use `npm run test:obsidian` for runtime behavior when Obsidian is available.
  Runtime tests use a disposable profile and vault, never the user's vault.
