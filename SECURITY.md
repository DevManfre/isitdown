# Security Policy

## Supported versions

Only the latest published release is supported: the most recent tag and the
`ghcr.io/devmanfre/isitdown:light-latest` and
`ghcr.io/devmanfre/isitdown:ui-latest` images built from it. A fix lands in
the next release; older versions are not patched.

## Reporting a vulnerability

Report it privately through GitHub: on the repository, open
**Security → Report a vulnerability**
([direct link](https://github.com/DevManfre/isitdown/security/advisories/new)).
This uses GitHub's private vulnerability reporting, so the report is visible
only to the maintainer until an advisory is published.

**Do not open a public issue, pull request or discussion for a
vulnerability.** Include what is needed to reproduce it: the edition (Light or
UI), the version, the configuration involved and the steps. Never paste a real
bot token, webhook URL or other secret into the report.

## What to expect

IsItDown is maintained by one person. Reports are read and handled on a best
effort basis: you will get an answer once the report has been looked at, the
fix ships in a regular release, and the advisory is published after it. There
is no guaranteed response or fix time.

## Threat model

What IsItDown trusts, what it stores where, and what is out of scope (several
users, exposure to the Internet without a proxy) is in
[docs/security.md](docs/security.md).
