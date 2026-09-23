# Releasing DocShelf

DocShelf Web uses Git tags and GitHub Releases for clone-and-run distribution.
The Obsidian plugin is built separately as an installable folder. The root and
workspace packages are private to prevent accidental npm publication.

DocShelf Web's first release is `v0.1.0`, and DocShelf for Obsidian's prepared release is `0.2.2`, with a minimum Obsidian version of `1.13.7`. The two apps share a repository but are versioned and released independently.

## Versioning and cadence

Release when a coherent improvement is ready, rather than on a fixed calendar.
Use `0.MINOR.PATCH` during early development:

- Patch releases contain compatible fixes and documentation corrections.
- Minor releases collect features. During `0.x`, any incompatible change needs
  an explicit migration note and a minor version bump.
- Revisit `1.0.0` after outside users have exercised installation and upgrades
  and the compatibility commitments are ready to be treated as stable.

Treat the shelf JSON format, registered routes, web app and Obsidian permalink
syntax, browser import storage, plugin settings and recovery records, and
documented commands as compatibility surfaces.
Do not silently discard shelf entries or browser imports. Document migrations
and how users can preserve their data when changing these surfaces. Source
authors control their own headings and line numbers, so editing a document can
change what a section or line permalink points to.

The shelf schema's `"version": 1` is independent of the application version.
The current workflow accepts plain `X.Y.Z` versions without prerelease suffixes.
This policy follows [Semantic Versioning](https://semver.org/), with the limited
stability expectations of an initial development series.

## Prepare the content

Before dispatching a release:

1. Finish the README and check the hosted-demo links against the files to publish.
2. Write `docs/releases/vX.Y.Z.md`: the user-facing changes, limitations, migration
   steps, and upgrade instructions. The workflow prepends this text to generated
   GitHub release notes when the file exists.
3. Run `npm run test:all`, `npm run check:all`, and `npm run build:all` from the
   repository root. For plugin changes, also run
   `npm run test:obsidian --workspace obsidian-docshelf` after building and check
   `npm run package:obsidian` produces the expected installable files.
4. Smoke-test a fresh install, an existing shelf after a watcher restart, search,
   a heading link, a line-range link, and a supported browser import. Verify the
   import still loads after reloading that same site origin.

## Prepare and publish the release

The workflow below publishes the web app. These commands change the public
repository; run them when ready to publish.

```sh
gh workflow run release.yml -f version=patch
```

Use `version=patch`, `version=minor`, `version=major`, or an explicit increasing
version. Run the workflow from its `main` definition.

The prepare job updates `package.json` and `package-lock.json`, runs verification,
and pushes `release/vX.Y.Z`. Open the pull-request link from the workflow summary.
Check that the branch changes only the intended version fields in those two
files and that the notes already exist on `main`; then squash-merge after CI.

The version-changing push to `main` runs verification again, tags that exact
merged commit, and creates the GitHub Release. An existing tag is accepted only
if it resolves to that commit. A mismatch fails without moving the tag.
The GitHub Release command uses `--verify-tag`, so it cannot silently create a
missing tag from the default branch. See the
[GitHub CLI release documentation](https://cli.github.com/manual/gh_release_create).

The release workflow verifies the web app; pull-request CI runs the aggregate
workspace checks. It does not bump the plugin or shared-core versions, build a
plugin distribution, or upload plugin assets. Squash-merging here applies to the
version-only release branch. The consolidation branch imported the plugin's full
history and needs a merge commit to retain that ancestry.

## Package the Obsidian plugin

The root `npm run build` builds both applications and copies the plugin’s three install files to ignored `build/` so the community build verifier can find `build/main.js`. Use `npm run build:web` for an Astro-only build; `npm run watch` still builds only the web app.

Run `npm run package:obsidian` at the repository root. It rebuilds the plugin and creates `packages/obsidian/dist/docshelf/`, containing `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `THIRD_PARTY_NOTICES.txt`. The `packages/obsidian/dist/release/` directory contains those standalone release assets, an installable `docshelf-X.Y.Z.zip`, and `SHA256SUMS`. The ZIP includes the `docshelf/` folder and `INSTALL.txt`; it has no settings, recovery records, local shelf, source map, or source documents. These are generated outputs; do not commit them. Packaging does not install into a vault or publish a release.

Each build collects the full licenses and notices of bundled dependencies, including transitive dependencies, from esbuild's module list. It embeds those texts and the plugin's MIT license as comments in `main.js`, so Obsidian's three-file installation carries them. The ZIP also includes the separate license files. Host-provided externals are excluded; missing or empty dependency licenses fail the build.

Maintain the plugin version in `packages/obsidian/package.json` and `packages/obsidian/manifest.json`, refresh the root lockfile with `npm install --package-lock-only`, and add the minimum Obsidian requirement to `packages/obsidian/versions.json`. Preserve older compatibility entries. Run `npm run sync:obsidian-metadata` to update the tracked root `manifest.json` and `versions.json` mirrors required by Obsidian, plus the `obsidian-download` and `obsidian-release` link definitions in both READMEs. Checks and packaging reject stale metadata or README release links. Web versions remain independent.

Before handing the build to testers or recording a release video, run the aggregate checks, then verify the actual package:

```sh
npm run package:obsidian
npm run test:package --workspace obsidian-docshelf
npm run test:obsidian:package --workspace obsidian-docshelf
```

The package check verifies ZIP contents, matching standalone assets, embedded licenses, and checksums. The runtime check installs the ZIP into a disposable vault, exercises the normal suite, and replaces the three plugin files while a conflict draft exists. It verifies settings, shelf, and recovery bytes survive replacement, then checks the recovered draft after re-enabling. This tests an update/reinstall of the initial release; cross-version migrations need their own fixtures when formats change. Runtime output stays under `packages/obsidian/.local/runtime/`. Follow the [runtime requirements](../packages/obsidian/README.md#develop-and-verify); neither command installs into your own vault.

## Prepare an Obsidian release draft

The manually dispatched **Prepare Obsidian release** workflow (`release-obsidian.yml`) packages the exact commit selected on `main`, verifies its version and release notes, runs aggregate and package checks, creates the plain `X.Y.Z` tag, and uploads a GitHub release draft. It does not run on a push and does not publish the draft. The initial version is `0.1.0`; plugin tags omit `v` to match the manifest, while web tags keep `vX.Y.Z`. Notes belong in `docs/releases/obsidian-X.Y.Z.md`.

Finish the code, metadata, notes, and runtime verification before dispatching. Creating the tag and draft changes the public repository, so dispatch only when that action is intended:

```sh
gh workflow run release-obsidian.yml --ref main -f version=0.2.2
```

The workflow generates [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) for `main.js`, `manifest.json`, and `styles.css`. Verify a downloaded file with `gh attestation verify main.js --repo oliver-im/docshelf`. Optional ZIP, license, notice, and checksum attachments remain available for manual installs; Obsidian downloads only its three standard files. See [community review findings](obsidian-review.md) for the reviewed capabilities and retained advisory findings.

The workflow refuses a requested version that differs from the checked-out manifest. It never moves an existing tag or replaces an uploaded asset. Rerunning the original workflow run verifies matching assets and uploads missing draft assets; differences fail for investigation. A published release is only verified, never repaired or edited. If `main` has advanced since the tag was created, rerun the original run instead of dispatching against a new commit with the same version.

Use the packaged build for the README video. Before publishing, review the draft notes and assets, compare the tag commit with the verified workflow commit, and confirm the installation instructions and compatibility claims are accurate. Publish the reviewed draft in GitHub when ready as a full release that is marked Latest, not a prerelease. The community directory rejected the 0.2.0 prerelease while the web app's `v0.1.0` was GitHub's latest release, so plugin releases keep the Latest label and web releases are created with `--latest=false`. Call out beta status in the release title and notes instead. The video, directory listing, and public announcement can follow separately.

Review the minimum Obsidian version and tested platforms in both READMEs for each release. Their Shields.io version badges follow published plugin releases, including betas, and exclude the web app's `v`-prefixed tags. The Download ZIP badges reuse a static graphic; their destinations and the install sections' release-note links are maintained by `npm run sync:obsidian-metadata`. Commit those link updates with release preparation and publish the matching release promptly after merging; the prepared links will not resolve until publication, while Shields.io continues showing the previous published version until its cache refreshes. GitHub's latest release is reserved for the plugin, so a generic latest-release link points to the newest plugin release, never the web app.

## Submit the Obsidian plugin

The current [Obsidian submission process](https://docs.obsidian.md/plugins/releasing/submit-plugin) uses [community.obsidian.md](https://community.obsidian.md). Sign in with an Obsidian account, link GitHub, and submit the repository. The root manifest on the default branch must match a published release whose tag is exactly its version. That release must attach `main.js`, `manifest.json`, and `styles.css` individually in addition to the convenient ZIP. The directory performs automated review; resolve its findings before announcing in-app installation. A GitHub beta release can be offered for manual installation before directory approval.

## Verify the published result

A successful push-triggered run that says the version is unchanged is a no-op;
it does not verify release publication. Before announcing a new version:

1. Confirm the prepare and publish jobs both completed for this version.
2. Confirm the release PR's merged commit passed CI and the Pages deployment.
3. Fetch tags, then compare `git rev-parse 'refs/tags/vX.Y.Z^{commit}'` with the
   merged commit ID. The `^{commit}` suffix resolves annotated tags to their
   commits; see [Git's revision documentation](https://git-scm.com/docs/git-rev-parse).
4. Open the GitHub Release and check its title, human-written notes, generated
   changes, source archive, and upgrade steps.
5. Open the deployed demo, search for a README term, and follow a result and
   supporting-document link before posting the announcement.

If a publish run fails after pushing the correct tag, rerun that failed run.
Matching tags and existing GitHub Releases are preserved. A rerun does not edit
the notes of an already-created release. Investigate mismatched tags instead of
force-moving them.

## Announcement preparation

Suggested repository description:
**Browse project documents with DocShelf Web or DocShelf for Obsidian.**

Suggested repository homepage: **https://oliver-im.github.io/docshelf/**.
Set these when preparing the public announcement. Also consider enabling GitHub
private vulnerability reporting so the preferred route in `SECURITY.md` is usable.

Use a screenshot containing only deliberately public sample documents. Show
document switching, a search result, and a precise line link. Keep the claims
accurate: web app full-text search covers registered local documents, and browser
imports depend on their host and that browser's saved links. Obsidian also indexes
registered GitHub Markdown after it has been fetched; Claude content is not indexed.

The README shows [Web Markdown](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-web-markdown.jpg) and [Obsidian Markdown](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-obsidian.png) first, followed by the same HTML report in [DocShelf Web](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-web-html.jpg) and [Obsidian](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-obsidian-html.jpg). The web app usage guide keeps its separate [line-range screenshot](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-line-range.png).

`public/docshelf-html-comparison.svg` embeds both original HTML screenshots side by side at equal heights, separated by a transparent gap. When either capture changes, update its embedded JPEG data and dimensions in the SVG too. This keeps the README comparison borderless and compatible with Markdown renderers that omit raw HTML.

The Web captures show only repository documents. Use `docs/screenshot-shelf.json` as the local shelf in a separate checkout, dark mode, and a wide internal-browser window with the `shelf.localhost` address visible. Hide the workspace sidebar and keep personal browser profiles, extension toolbars, bookmarks, and unrelated tabs out of the capture. For Markdown, open `?artifact=guides%2Fusage.html#L3-L8`; for HTML, open `?artifact=reports%2Fproject-review.html`. Use the configured loopback address and preserve existing proxy routes. The production Pages shelf remains README-only.

The Obsidian image uses Tokyo Night 1.1.6 in dark mode. To recreate it, install
the plugin and theme in a disposable vault named **DocShelf demo**, using copies
of the documents in `packages/obsidian/examples/`. Open the release report and
field notes in separate tabs, select source line 11 in the field notes' native
editor, and capture at 1180 × 860. Inspect the capture before saving it to
`public/docshelf-obsidian.png`; use only sample documents and exclude private
paths or vault contents. The regular runtime suite uses the default Obsidian
theme, so its screenshots are not a replacement for this themed capture.

For the Obsidian HTML example, copy `docs/examples/project-review.html` into a temporary public demo workspace, register it as an HTML document in a disposable demo vault, and open its Report view with Tokyo Night. Keep the source path generic, such as a directory under `/tmp`, and exclude private files and paths. Capture a wide window with the report and shelf visible. If a tiling window manager constrains the aspect ratio, temporarily pause it and restore its previous state after capture.

Draft X post, to tune after the README and release are final:

> I made DocShelf: a home for the HTML reports and Markdown notes scattered
> across my projects. Find them with search, read them in one place, and link
> to exact lines—while the originals stay put.
>
> Try it: https://oliver-im.github.io/docshelf/
