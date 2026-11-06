# Contributing to Muse4AI

Thanks for helping. Muse4AI is a Windows desktop app (MIT) that lets AI agents use Muse through your own signed-in
accounts. Bug reports, translations, guide fixes and code are all welcome.

> Tiếng Việt: bạn cứ viết issue hoặc PR bằng tiếng Việt — người duy trì đọc được cả hai thứ tiếng.

## Before you start

- **Security problems:** never open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Never paste secrets.** API keys (`m4a_…`), OAuth tokens, cookies, proxy passwords, e-mail addresses or phone
  numbers do not belong in issues, logs, screenshots or test fixtures. The diagnostics ZIP from
  *Settings › Diagnostics* already leaves prompts, answers and Muse IDs out — still read it before you attach it.
- Muse4AI is not affiliated with Meta. Do not send real messages from accounts you do not own, and test with
  accounts you are allowed to use.

## Repository layout

| Folder | What it is |
| --- | --- |
| `desktop/` | The Electron app — its own package (`package.json`, lockfile, tests). Read `desktop/AGENTS.md` first. |
| `content/` | The guide, agent list, use cases and release notes, shared by the app and the website. Edit content here only. |
| `agent-kit/` | The Muse4AI Agent Skill (Markdown) that agents install. |
| `docs/` | Build documents. In each `docs/build-<version>/`, `spec.md` is the only source of rules and AC-IDs. |
| `scripts/` | Generators (sample media, share images, this repo's `CHANGELOG.md`). Generated files are never hand-edited. |

## Develop

Node.js 24 is used in CI. The app has no native modules, so it builds and tests on Linux, macOS or Windows.

```sh
cd desktop
npm ci
npm test            # vitest, ~800 tests, plain Node (no Electron needed)
npm run typecheck   # tsc --noEmit
npm start           # build first: npm run build
npm run package:win # Windows ZIP (works from Linux); package:setup adds the EXE (needs Inno Setup)
```

## Rules the tests enforce

- **Every rule has a test.** Domain rules (scheduler, state machines, parsers, validators) are pure TypeScript in
  `desktop/src/shared` with no Electron imports, so they are unit-tested in plain Node.
- **Bilingual UI.** Source strings are Vietnamese; every one needs an English entry in
  `desktop/src/shared/i18n/catalog/` (`test/i18n-catalog.test.ts` lists missing keys).
- **One place per concern.** Muse selectors, URLs and prompt templates live in one adapter module; the product name
  lives only in `desktop/src/shared/brand.ts`.
- **Generated files.** `CHANGELOG.md` comes from `content/site.ts` via `bun scripts/changelog.ts`; guide screenshots,
  sample media and share images come from their scripts. A hand edit fails the tests.

## Pull requests

1. Keep a PR to one change, with a test that fails without it.
2. Run `npm test` and `npm run typecheck` in `desktop/`.
3. Describe what a user sees differently. Screenshots must not show real accounts, keys or personal data.
4. The `Audit` workflow (tests, type check, dependency audit, secret scan, live endpoint checks) must be green.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) and that you follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
