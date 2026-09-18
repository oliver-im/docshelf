---
name: obsidian-docshelf
description: Register external Markdown or HTML documents and supported public URLs in the Obsidian DocShelf plugin when asked to add documents to its shelf, then return Obsidian and source-line links.
---

# Obsidian DocShelf

Find the intended vault and its DocShelf settings in
`<vault>/.obsidian/plugins/docshelf/data.json`. The `shelfPath` setting is
absolute or relative to that vault; it defaults to `shelf.local.json`.
If the current task already supplies a shelf path, use it. Do not guess between
multiple vaults. This skill targets the Obsidian plugin; a request specifically
for the standalone DocShelf site should use that project's workflow.

Read this checkout's `README.md` for the registration schema and current limits.
Preserve existing entries and update a matching registration instead of adding
a duplicate. Infer project, title, a concise description, and a stable
`project/document.html` route from the finished source document.

Local source paths are relative to the shelf file's directory, not this plugin
checkout. Absolute paths also work. Sources must be Markdown/HTML inside the
configured workspace or shelf directory. The workspace defaults to the parent
of the shelf directory. Do not widen the workspace merely to admit an unrelated
file. Optional `assets` lists individual files beneath the source directory;
register only the assets the document needs, not a whole folder.

Remote sources are restricted to public GitHub Markdown file URLs and exact
published Claude Artifact URLs. Never generalize this to arbitrary HTML URLs.
The plugin loads Claude pages at top level, so the standalone site's iframe
allowed-domain instructions do not apply.

Write registrations to the selected shelf JSON. Keep the source content
unchanged and avoid adding machine-local shelves to version control. When
creation and registration are requested together, register the completed
document after checking it. If the shelf has changed while preparing an edit,
reread it and preserve those changes before applying the registration.

Validate using the plugin checkout:

```sh
npm run validate:shelf -- /absolute/path/to/shelf.local.json --workspace /absolute/workspace --vault vault-name-or-id
```

Omit `--workspace` to use the default. Use the saved `vaultId` setting when
present, otherwise the vault name. This command does not launch Obsidian or
prove that its viewer is open. The plugin watches the shelf while enabled;
report any runtime verification actually performed without implying more.

Return `obsidian://docshelf?vault=<encoded-vault>&source=<encoded-source>` and
append `&lines=7-11` for a requested source range. Use `URLSearchParams` for
encoding, then replace literal `+` characters in the generated query with `%20`;
Obsidian percent-decodes values without interpreting `+` as a space. Do not use
`path=`: Obsidian consumes it before plugin dispatch.
For local documents also return `/absolute/source.md:7-11` when a range is
requested. These are positional references, not revision-pinned permalinks.
