# Security policy

## Supported versions

DocShelf does not have stable releases yet. Security fixes are applied to the
latest version on `main`.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting feature when it is available. If it is not
available, contact the maintainer privately through the contact method on their
GitHub profile.

Include the affected version or commit, reproduction steps, expected impact,
and any suggested mitigation. Please avoid accessing files or systems that are
not your own while investigating.

## Security boundaries

DocShelf Web and the Obsidian plugin share URL helpers and can share registrations,
but use different rendering and file-access boundaries.

### DocShelf Web and its local server

- Registered local HTML is trusted content. It may execute scripts with the same
  origin and permissions as DocShelf. Registering malicious HTML is outside the
  security model unless it bypasses a documented containment boundary.
- Local sources must remain within the workspace root, the parent directory of
  DocShelf unless `DOCSHELF_WORKSPACE` names another directory, or within the
  DocShelf checkout itself. The web app must never modify those sources.
  Snapshot reads and revision checks revalidate the registered path, canonical
  target, containment, and opened file identity, including after symlink changes.
- Browser-imported Markdown is limited to public HTTPS `.md` and `.markdown`
  file URLs on `github.com` and `raw.githubusercontent.com`. DocShelf fetches
  the raw file without credentials, enforces a 2 MB limit, omits raw HTML,
  sanitizes the rendered markup, and applies a restrictive content security
  policy. Imported documents may still load remote images and link to external
  sites. Private repositories and authenticated fetches are outside this
  boundary.
- Published Claude Artifacts load cross-origin from the strictly validated
  `https://claude.ai/public/artifacts/<id>/embed` endpoint. DocShelf does not
  fetch or frame arbitrary remote pages. Claude controls the embedded content,
  its availability, and its allowed-domain policy; users should open only
  Artifact links they trust.
- Browser-imported GitHub Markdown and Claude Artifact links are stored in
  local storage for the current DocShelf origin. They are not uploaded or
  added to a shelf file.
- Generated cleanup is limited to marked runtime output and the managed
  symlink tree.
- The macOS loopback watcher can reveal a registered local source in Finder.
  This requires a same-origin JSON POST with a watcher-specific token and a
  custom request header. The server resolves the registered route and rechecks
  workspace containment; it does not accept paths or shell commands from the
  browser. Local actions are disabled on non-loopback listeners and never
  included in static hosting. As with the shelf itself, trusted local HTML has
  access to same-origin capabilities.
- The watcher binds to loopback by default and restricts loopback Host headers.
  Setting `DOCSHELF_HOST` to a non-loopback interface deliberately exposes the
  shelf to that network and does not add authentication or transport
  encryption.

### DocShelf for Obsidian

- Local sources and listed assets must resolve within the configured
  **Workspace root** or the shelf file's directory. The workspace defaults to
  the parent of the shelf directory; the plugin does not read the web app's
  `DOCSHELF_WORKSPACE`. Reads recheck canonical containment and enforce size
  limits. Only registered documents and explicitly listed assets are served.
- Local Markdown opens in Obsidian's native editor and saves to the original.
  Before writing, the plugin persists recovery and rechecks registration,
  canonical target, file identity, and baseline contents. It does not recreate
  a deleted source or overwrite a detected conflict without review. Recovery
  reduces data-loss risk; the checks are not an atomic lock against other
  applications writing at exactly the same time.
- Recovery records contain private baseline and draft text under the installed
  plugin's `recovery/` directory. They remain until removed by the user and must
  not be published. HTML, remote documents, and assets are read-only. The plugin
  also stores settings and can create an empty shelf at the user's request.
- Local HTML runs in a sandboxed webview with Node disabled and a nonpersistent
  session separate from Obsidian. Changing the report's route or source identity
  creates a new partition; same-report reloads keep their browser storage.
  Reports load through a `127.0.0.1` server with strict Host checks,
  document-specific read tokens, a file allowlist, and CSP. Navigation links do
  not disclose another report's read token. The server accepts only GET/HEAD,
  exposes no write API, and shuts down on plugin unload.
- Reports can run scripts and contact HTTPS services. **Run HTML scripts**
  disables script execution but does not prevent remote images or styles from
  loading. Reports receive no privileged plugin bridge; external HTTP(S) links
  open in the system browser. Renderer isolation is covered by the disposable
  Obsidian runtime suite; current verification covers Obsidian 1.13.7 on macOS.
- Public GitHub Markdown is registered in the shelf, downloaded without
  authentication under a streaming 2 MB limit, stripped of raw HTML, and
  sanitized. It is cached in memory and becomes searchable after fetching.
  Images and links can contact remote sites. Exact published Claude Artifact
  URLs open as top-level remote pages in a separate webview, without requiring
  the web app's embed allowed-domain setup. Arbitrary remote HTML is rejected.
- `obsidian://docshelf` links look up existing registrations; they cannot
  register or open arbitrary paths. Local links and source references include
  absolute filesystem paths. External documents do not join vault indexing,
  backlinks, graph, or Obsidian Sync.

See the [plugin architecture](packages/obsidian/docs/architecture.md) for the
HTML isolation and Markdown recovery implementation.
