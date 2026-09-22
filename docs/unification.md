# One repository, two apps

DocShelf Web and DocShelf for Obsidian share a repository, registration
workflow, and URL helpers. They can read the same shelf JSON. Original documents
stay in their owning projects.

```text
docshelf/
├── src/, public/, scripts/       DocShelf Web and local server
├── shelf.local.json              Ignored, shared local registrations
├── packages/
│   ├── core/                     Pure URL and source-reference helpers
│   ├── local/                    Folder discovery, registration, and watch scopes
│   └── obsidian/                 Native editor and isolated report viewer
└── .agents/skills/docshelf/       One registration skill
```

The web app remains at the root to preserve installed services, browser origins,
and relative source paths. The plugin was imported with its full Git history;
earlier commits still show its original root layout. Neither app requires the
other to be running. The packaged plugin bundles the shared helpers, so end users
do not need this checkout or Node.js to run it in Obsidian.

The import moved the plugin into its subdirectory inside a merge commit. Plain
path-filtered history can hide earlier plugin commits, and `git log --follow`
may show only later edits or nothing for an unchanged imported file. From the
repository root, inspect both merge parents while following the rename:

```sh
git log -m --follow -- packages/obsidian/src/core/files.ts
git blame packages/obsidian/src/core/files.ts
```

The original plugin commit IDs are preserved; its older paths are relative to
the original repository root.

## Use one shelf

Both apps support [explicit folder registrations](folders.md) in version 2 shelves, with recursive discovery and automatic updates. Existing version 1 file registrations remain supported. Update both apps before adding folders to a shared shelf.

Keep `shelf.local.json` at the web checkout root. Point Obsidian's **Shelf file**
at its absolute path, and align **Workspace root** with `DOCSHELF_WORKSPACE` if
customized. Source paths in this shared file are relative to its directory.
Keep unique lowercase `.html` routes even for Markdown. Descriptions are optional.

The web app does not read the plugin's settings, and the plugin does not read the
web service's environment. Separate configured shelves remain separate. This
change does not copy registrations, move documents, or change existing settings.

Use `npm run links -- <route-or-source> --site <installed-site> --vault <vault>`
at the repository root to print both links. Add `--lines 7-11` for a Markdown source range.
`DOCSHELF_SITE` can supply the web app's address; otherwise `--site` is required.
The command uses this checkout's active shelf and does not guess a vault or start
either app. Web app URLs identify the route, while Obsidian URLs identify the
registered canonical source. Local Obsidian links expose the absolute file path.

The web app's address remains `https://shelf.localhost/` after normal
macOS setup. No `docshelf.localhost` alias or OS-level `docshelf://` handler is
introduced here. Current application links use `obsidian://docshelf`. A future
neutral scheme needs an installed dispatcher and an explicit host preference.

## Differences that remain

| Capability | DocShelf Web | DocShelf for Obsidian |
| --- | --- | --- |
| Local Markdown | Rendered snapshot, read-only | Native editor; saves the original with conflict checks |
| Local HTML | Generated snapshot on the web origin | Isolated read-only webview, document-scoped access |
| Public GitHub Markdown | Browser import stored in that origin's browser storage | Explicit shelf registration, fetched read-only |
| Published Claude Artifact | Cross-origin embed; requires allowed-domain setup | Top-level isolated webview |
| Neighboring assets | Only assets already published under the web app's `public/` directory | Explicit per-document `assets` registration |
| Search | Pagefind over built local documents; no remote full-text search | Metadata and local contents; GitHub contents after opening and fetching |
| Ordering and preferences | Browser storage | Shelf ordering and collapse state in the Obsidian workspace; settings in plugin data |

For a shelf used by both apps, register local Markdown/HTML or published Claude
Artifacts, use relative source paths, and keep the web-compatible lowercase route
shape. Public GitHub shelf entries and absolute sources remain Obsidian-only.
Do not add them to a shared shelf: the web loader rejects them. Registering an
asset for Obsidian does not publish it in the web app.

Both apps accept `.md`, `.markdown`, `.html`, and `.htm` local sources. Obsidian
also enforces limits of 2,000 documents, 2 MB of shelf JSON, 8 MB per local
document, and 500 explicitly listed assets per document, each at most 16 MB.
A shared shelf must satisfy both apps' validation rules. See the
[plugin registration guide](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md#register-documents)
for asset paths and supported types.

The initial README entry works in both apps. To display its screenshots and download badge in Obsidian too, add `"assets": ["public/docshelf-web-markdown.jpg", "public/docshelf-obsidian.png", "public/docshelf-html-comparison.svg", "public/obsidian-download.svg"]` to that entry. Web app image rendering already uses those bundled public files. The version badge loads from Shields.io over HTTPS.

## Update existing installations

Keep using the web checkout at its installed path. After pulling the unified
repository, run `npm ci` there to install all workspaces. Follow the
[web upgrade procedure](https://github.com/oliver-im/docshelf/blob/main/docs/local-server.md#updating-an-existing-installation)
to restart its watcher or login service. A separate checkout does not inherit
the ignored shelf, installed service, or browser origin from the existing one.

Build the plugin with `npm run package:obsidian` from that same repository root,
then follow the
[plugin update procedure](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md#update-an-existing-plugin).
Installing the web dependencies does not replace a plugin already in a vault.
Keep the vault's plugin settings and recovery files. Repointing **Shelf file**
is only needed when you choose to share a different shelf; preserve its existing
entries and keep relative source paths anchored to the shelf directory.

## Development boundary

`@docshelf/core` owns GitHub and Claude URL validation, source-line fragments, and
web app and Obsidian link construction. It has no filesystem, Electron, Obsidian,
server, or DOM dependencies. Both apps consume the package through npm workspaces.
The private consumers use `"@docshelf/core": "*"` so a core version bump keeps
resolving to the workspace. Refresh the root lockfile after version changes.
Keep one root lockfile. CI runs `test:all`, `check:all`, and `build:all`; the real
Obsidian suite runs locally with a disposable profile and vault.
Core's small generated type declarations are tracked so a fresh checkout can
typecheck before building. Regenerate them with `npm run build --workspace
@docshelf/core` after changing its API.

The web watcher fingerprints shared core source as a build input. Root scripts
and web release automation retain their existing meanings. Plugin packaging is
separate: `npm run package:obsidian` produces
`packages/obsidian/dist/docshelf/`. Moving source into one repository does not
publish either app or change their version numbers.

Next, agree on shared catalog identity and schema before extracting more code.
Then make registration and link lookup host-independent, decide how remote
registrations should work in the web app, and design an optional `docshelf://`
dispatcher. Filesystem writes, recovery, HTTP serving, and UI rendering stay with
their respective hosts until there is a concrete reason to share them.
