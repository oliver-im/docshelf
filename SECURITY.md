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

- Registered HTML is trusted content. It may execute scripts with the same
  origin and permissions as DocShelf. Registering malicious HTML is outside the
  security model unless it bypasses a documented containment boundary.
- Registered sources must remain within the workspace root, defined as the
  parent directory of DocShelf. DocShelf must never modify those sources.
- Generated cleanup is limited to marked runtime output and the managed
  symlink tree.
- The watcher binds to loopback by default and restricts loopback Host headers.
  Setting `DOCSHELF_HOST` to a non-loopback interface deliberately exposes the
  catalog to that network and does not add authentication or transport
  encryption.
