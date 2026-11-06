# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Use GitHub's private report: **Security → Report a vulnerability** on
https://github.com/andrew-babo/muse4ai/security/advisories/new

We aim to acknowledge within 3 days and to ship a fix or mitigation for
confirmed high/critical issues as fast as possible, then credit the reporter
(unless you prefer otherwise).

## Supported versions

Only the latest beta published on https://muse4ai.andrewbabo.com/download
receives fixes.

## Continuous checks

Every push, pull request and a weekly scheduled run execute the `Audit`
workflow: full test suite and type check, dependency vulnerability audit,
secret scanning over the whole history, and a live check of the public
website and API endpoints. A failed weekly run opens an issue automatically.

## Update integrity

The app checks `https://muse4ai.andrewbabo.com/releases/latest.json` (a public file, no data sent) and only downloads
installers over HTTPS from that site. Before anything runs, the app checks the installer's size and SHA-256 against
that file and deletes any mismatch. The same SHA-256 is listed on the download page and in `CHANGELOG.md`, so you can
verify a manual download too:

```powershell
Get-FileHash .\muse4ai-setup-win-x64.exe -Algorithm SHA256
```
