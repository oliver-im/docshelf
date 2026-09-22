---
name: docshelf
description: Register finished documents or explicitly selected folders in DocShelf, preserving originals and returning links for the configured apps.
---

# DocShelf

## Find the shared shelf

Use `DOCSHELF_ROOT`, the current DocShelf repository, or an unambiguous sibling
checkout. Read its `AGENTS.md` and the registration instructions for the configured
app: `docs/usage.md` for DocShelf Web or `packages/obsidian/README.md` for Obsidian.
If no checkout is identifiable, ask where DocShelf is installed.

For DocShelf Web, use the checkout's ignored `shelf.local.json` (or existing
legacy `artifacts.local.json`). Create it from the empty `shelf.json` only when
neither local shelf exists. Never put private registrations in the tracked template.

For Obsidian, find the intended vault's
`.obsidian/plugins/docshelf/data.json`. `shelfPath` is absolute or relative to
that vault, defaulting to `shelf.local.json`. Respect an explicitly supplied
shelf path. Do not guess between multiple vaults or change a vault's settings
to make it use a different shelf. Both apps can point to the same file at the
web checkout root. Separate configured shelves are not automatically synchronized.

## Register the document

For a folder request, read `docs/folders.md` in the checkout. Add a version 2 `directories` entry for the explicitly selected folder, preserving existing registrations and stable folder IDs. Discovery is recursive by default; honor requested exclusions. Do not enumerate the folder into individual entries. For a file already discovered through a registered folder, use its existing resolved route unless the user requests a metadata or asset override. Do not register its parent implicitly when the user asked only for that file. Both apps must support version 2 before using directories in a shared shelf.

Resolve the source from the explicit request or the finished document just
created. Ask if ambiguous. Register after authoring and verification; this skill
does not author or restyle source documents. The optional [HTML theme](references/theme.md)
is a separate authoring resource.

Preserve existing entries and update a matching source instead of duplicating it.
Infer project, title, and a stable lowercase `project/document.html` route.
A concise factual description is optional. Keep local source paths relative to
the shelf file; for a shared shelf this file must be at the web checkout root.
Reread before writing if the shelf changed concurrently. Never edit the source,
commit local registrations, or edit generated files.

Local `.md`, `.markdown`, `.html`, and `.htm` files and exact published Claude
Artifact URLs work in both apps. Preserve each app's configured containment
boundary; do not widen it to admit an unrelated file. The web root is controlled
by `DOCSHELF_WORKSPACE`; Obsidian's saved `workspaceRoot` is relative to the shelf
directory. Defaults are the parent of that directory. The checkout/shelf directory
is also allowed. Resolve symlinks before checking containment.

For shared shelves, keep the web-compatible relative source and lowercase route
shape. Obsidian-only shelves also accept absolute paths and public GitHub Markdown
URLs. The web app imports GitHub Markdown into browser storage, not shelf JSON;
do not add a GitHub registration to a shared shelf. Read `docs/unification.md`
in the checkout before using host-specific features.
Obsidian's optional `assets` lists individual files beneath the source directory;
it does not make those neighboring files available to the web app.

A Claude Artifact must be an exact published `claude.ai/public/artifacts/<id>`
link. For the web app's embed, the owner must allow the installed DocShelf origin
in Claude's **Get embed code → Allowed domains**. Obsidian opens it at top level
and does not require that embed setting. Never download or modify the artifact.

## Verify and return links

For DocShelf Web, determine the actual installed site from configuration or a verified
running server. Normal macOS setup uses `https://shelf.localhost/`; direct mode
uses `http://shelf.localhost:<port>/` (default 4321). Preserve any mount path.
Before editing, probe its `/__docshelf/status` endpoint and record `instanceId`
and `generation` if available. Let an existing watcher rebuild; never start a
second watcher or remove locks. Poll for up to 150 seconds for a newer terminal
`ready` or `failed` generation, allowing a replacement instance. Report a failure's
message and useful bounded details. After ready, verify the route. Without a
watcher, run `npm run check` and `npm run build`; do not install a daemon.

For Obsidian, validate from the unified repository root:

```sh
npm run validate:shelf --workspace obsidian-docshelf -- /absolute/shelf.local.json --workspace /absolute/workspace --vault name-or-id
```

Use the configured workspace, and saved `vaultId` when present, otherwise the
vault name. Validation does not launch Obsidian or prove its viewer opened.

For a shared shelf, print both links with:

```sh
npm run links -- project/document.html --site https://shelf.localhost/ --vault name-or-id --lines 7-11
```

Omit `--lines` for the whole document and `--vault` when Obsidian is not configured.
Use the real site address; the command does not infer or start a server. For an
Obsidian-only shelf, use the validator's URLs. Add an ordered positive `lines`
range when requested. URI keys are `vault`, `source`, and `lines`; never `path`,
which Obsidian consumes before dispatch. Encode spaces as `%20`, not `+`.
Return local source references as `/absolute/file.md:7-11`. All line links are
positional; editing can move the passage. State which apps were actually verified.
