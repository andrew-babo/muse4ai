# Changelog

All notable changes to Muse4AI, newest first. Downloads and the Vietnamese notes:
[muse4ai.andrewbabo.com/download](https://muse4ai.andrewbabo.com/download) · [Tiếng Việt](https://muse4ai.andrewbabo.com/vi/download).

<!-- Generated from content/site.ts (RELEASES) by `bun scripts/changelog.ts`. Edit the release notes there, not here. -->

## 2.0.0-beta.34 — 2026-11-06

- Muse4AI now checks for new versions by itself. When one is out, open Settings › About and choose Download and install: it downloads, checks the file, installs and opens again in about a minute — your accounts, queue and library stay as they are.
- If a new version gives you trouble, go back to the previous one from the same screen. The app only offers this when that version can still read your data.
- Muse4AI now appears in Windows Settings › Apps. Uninstalling opens a small window in your language: your image and video library is always kept, and you choose whether to keep accounts and settings for later.
- Pages opened from the Muse window now show each site's own icon on their tabs.

Installer `muse4ai-setup-win-x64.exe` · 171.8 MB · SHA-256 `B59214CAEDCF71C45F68DDC9ADFE0CCD405F8B9F941E07286A561D844B4655C5`

## 2.0.0-beta.33 — 2026-11-06

- If Muse4AI is open when you install, setup now closes it for you (the normal way, like choosing Quit) and carries on — no need to quit first.
- When setup cannot finish, it now tells you the real reason. It also works on computers where it is started from the newer PowerShell 7.
- A friendlier first screen in the installer, and the app's built-in browser engine (Electron 45.2.1) and other parts are updated to their latest patch releases.

Installer `muse4ai-setup-win-x64.exe` · 171.7 MB · SHA-256 `C650505DD6BFFC6EDCE6E8ED3FB5843C62412CEDD43E3BCFFAFEF2E6E69C2C48`

## 2.0.0-beta.32 — 2026-11-04

- When adding an account, each proxy now says which accounts already use it. Sharing a proxy is allowed — you just see it clearly.
- In the Muse sign-in window, small pop-ups (like a tool's Connect or OAuth step) and links that open a new page now show up — the window itself stays as clean as before.

## 2.0.0-beta.31 — 2026-11-03

- Settings › API & agent now shows a no-key OAuth setup, and OAuth also works through your own domain, not only the temporary tunnel.

## 2.0.0-beta.30 — 2026-11-03

- Agents can now connect with OAuth: you approve each app by typing the 6-digit code shown in the Muse4AI window, and can disconnect it any time.

## 2.0.0-beta.29 — 2026-11-03

- The installer now shows the app's own mascot art and friendly bilingual steps — no command window.
- A video made through HTTP/API can now be extended, and every step follows the video's own path.

## 2.0.0-beta.28 — 2026-11-03

- Extend always follows the source video's path: agents calling REST or MCP never have to change an account setting.

## 2.0.0-beta.27 — 2026-11-03

- The Extend button and the API say why a video cannot be extended before you click.
- A video conversation now reports its extend steps and its newest video.

## 2.0.0-beta.24 — 2026-11-02

- New name: Muse4AI (your data and settings stay where they were).
- Installer and app in English and Vietnamese.

## 2.0.0-beta.23 — 2026-11-02

- Queue shows a picture and the prompt for every job, with a quick preview on hover.
- The whole app is available in English and Vietnamese; English is the default.
- Faster Queue filtering and smooth scrolling with thousands of jobs.

## 2.0.0-beta.19 — 2026-11-02

- Answers in Ask are shown as tidy articles (headings, lists, tables).
- Muse4AI now works with Muse only; support for another site was removed.
