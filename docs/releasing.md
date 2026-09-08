# Releasing DocShelf

DocShelf uses Git tags and GitHub Releases for distribution. It is a clone-and-run
application; `private: true` in `package.json` prevents accidental npm publication.
The planned first announced version is **0.1.0**. The package stays at its current
version until a release preparation branch is created.

## Versioning and cadence

Release when a coherent improvement is ready, rather than on a fixed calendar.
Use `0.MINOR.PATCH` during early development:

- Patch releases contain compatible fixes and documentation corrections.
- Minor releases collect features. During `0.x`, any incompatible change needs
  an explicit migration note and a minor version bump.
- Revisit `1.0.0` after outside users have exercised installation and upgrades
  and the compatibility commitments are ready to be treated as stable.

Treat the shelf JSON format, registered routes and viewer permalink syntax,
browser import storage, and documented commands as compatibility surfaces.
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
3. Run `npm test`, `npm run check`, and `npm run build` on the intended source.
4. Smoke-test a fresh install, an existing shelf after a watcher restart, search,
   a heading link, a line-range link, and a supported browser import. Verify the
   import still loads after reloading that same site origin.
5. For the first release, use **0.1.0** explicitly; `patch` from `0.0.1` would
   produce `0.0.2`.

The first-release notes are prepared in
[v0.1.0.md](https://github.com/oliver-im/docshelf/blob/main/docs/releases/v0.1.0.md).
Their presence does not mean that release has been published.

## Prepare and publish the release

These commands change the public repository. Run them when ready to publish.

```sh
gh workflow run release.yml -f version=0.1.0
```

Later releases can use `version=patch`, `version=minor`, `version=major`, or an
explicit increasing version. Run the workflow from its `main` definition.

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
**A searchable shelf for HTML reports, Markdown notes, and published artifacts.**

Suggested repository homepage: **https://oliver-im.github.io/docshelf/**.
Set these when preparing the public announcement. Also consider enabling GitHub
private vulnerability reporting so the preferred route in `SECURITY.md` is usable.

Use a screenshot containing only deliberately public sample documents. Show
document switching, a search result, and a precise line link. Keep the claims
accurate: full-text search covers registered local documents; remote imports
depend on their host and the current browser's saved links.

The README includes an [overview screenshot](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-overview.png)
and a [line-range screenshot](https://github.com/oliver-im/docshelf/blob/main/public/docshelf-line-range.png).
They show only repository documents, including the sample HTML report at
`docs/examples/project-review.html`. To recreate them, use
`docs/screenshot-shelf.json` as the local shelf in a separate checkout and use
dark mode. For the overview, open `?artifact=reports%2Fproject-review.html`.
For the line-range example, open `?artifact=guides%2Fusage.html#L7-L11` and open
the document's **⋯** menu so **Copy link** is visible. Include the HTML report in the sidebar of both
captures. The production Pages shelf remains README-only.

Draft X post, to tune after the README and release are final:

> I made DocShelf: a home for the HTML reports and Markdown notes scattered
> across my projects. Find them with search, read them in one place, and link
> to exact lines—while the originals stay put.
>
> Try it: https://oliver-im.github.io/docshelf/
