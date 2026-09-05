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

- Registered local HTML is trusted content. It may execute scripts with the same
  origin and permissions as DocShelf. Registering malicious HTML is outside the
  security model unless it bypasses a documented containment boundary.
- Local sources must remain within the workspace root, defined as the parent
  directory of DocShelf. DocShelf must never modify those sources.
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
- The watcher binds to loopback by default and restricts loopback Host headers.
  Setting `DOCSHELF_HOST` to a non-loopback interface deliberately exposes the
  shelf to that network and does not add authentication or transport
  encryption.
