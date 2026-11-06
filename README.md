<div align="center">

<img src="docs/hero.png" alt="Muse4AI — AI agent bridge, works with Muse" width="100%" />

# Muse4AI

**Let your AI agent make the pictures and the videos.**

Muse4AI runs on your own Windows PC and hands your Muse session to ChatGPT, Claude,
Cursor, Codex, n8n or anything else that speaks **REST**, **MCP** or **OAuth** —
with no cloud middleman and no per-seat fee.

[**Website**](https://muse4ai.andrewbabo.com) ·
[**Download**](https://muse4ai.andrewbabo.com/download) ·
[**Guide**](https://muse4ai.andrewbabo.com/docs) ·
[**For agents**](https://muse4ai.andrewbabo.com/agents) ·
[Tiếng Việt](docs/README-vi.md)

![Website muse4ai.andrewbabo.com](https://img.shields.io/badge/website-muse4ai.andrewbabo.com-1A50D7?style=flat-square)
![MIT licensed](https://img.shields.io/badge/license-MIT-2D664D?style=flat-square)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-1A50D7?style=flat-square)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-5F5A52?style=flat-square)
![841 tests](https://img.shields.io/badge/tests-841-2D664D?style=flat-square)
![v2.0.0-beta.34](https://img.shields.io/badge/version-2.0.0--beta.34-B4762B?style=flat-square)

</div>

---

## How it fits together

```text
   ChatGPT · Claude · Cursor · Codex · n8n · your own script
                       │
                       │  REST  ·  MCP  ·  OAuth
                       ▼
              ┌─────────────────────┐
              │   Muse4AI on your PC│   local library, queue,
              │   (Windows app)     │   keys, tokens, history
              └─────────────────────┘
                       │
                       │  your own signed-in Muse session
                       ▼
                     Muse
```

Nothing is relayed through a server we run. The app talks to Muse from your machine,
with your session, and keeps every result, key and token in
`%APPDATA%\MuseStudio` on that same machine.

## What you can ask an agent to do

<table>
  <tr>
    <td width="50%">
      <h3>🎬 Generate video &amp; images</h3>
      One call, text-only or with reference photos. Repeat a prompt, pick the account,
      watch it appear in the in-app queue.
    </td>
    <td width="50%">
      <h3>💬 Chat that remembers</h3>
      Ask questions or iterate on an idea. The conversation id comes back, so the
      agent can keep the thread going and attach files.
    </td>
  </tr>
  <tr>
    <td>
      <h3>⏱ Extend a finished video</h3>
      Keep a clip rolling, up to <b>6 steps</b> and about <b>60 seconds</b> per chain,
      in the same conversation it was born in.
    </td>
    <td>
      <h3>🛠 Edit a video by describing it</h3>
      Attach an MP4 and say what to change in words — no timeline, no rendering settings.
    </td>
  </tr>
  <tr>
    <td>
      <h3>🔑 Two ways to connect</h3>
      An <b>API key</b> you paste once, or real <b>OAuth</b>: the agent asks, and you
      approve with the 6-digit code the app shows on screen.
    </td>
    <td>
      <h3>📚 Built-in guide</h3>
      Every screen has a bilingual guide (English / Vietnamese) with real screenshots,
      plus a Skill your agent can read.
    </td>
  </tr>
</table>

## See it in action

<table>
  <tr>
    <td width="50%"><img src="docs/screens/studio.png" alt="Studio with a prompt ready to run" width="100%" /></td>
    <td width="50%"><img src="docs/screens/queue.png" alt="Queue with image and video jobs running" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>Studio</b> — write the prompt, attach references, run.</td>
    <td align="center"><b>Queue</b> — live status, thumbnails, quick preview.</td>
  </tr>
  <tr>
    <td><img src="docs/screens/library.png" alt="Library grid of generated images and videos" width="100%" /></td>
    <td><img src="docs/screens/agents.png" alt="Settings screen showing how to connect an agent" width="100%" /></td>
  </tr>
  <tr>
    <td align="center"><b>Library</b> — everything you made, searchable.</td>
    <td align="center"><b>API &amp; agent</b> — connect an agent in one paste.</td>
  </tr>
</table>

## Quick start

### 1. Install (easiest)

Grab the installer from the
[download page](https://muse4ai.andrewbabo.com/download), run it, then add your Muse
account in **Accounts**. Windows will warn that the file is unsigned — choose
**More info → Run anyway**. After that the app checks for new versions
by itself and installs them from **Settings › About** — no need to come back here.

### 2. Run from source

Needs **Node.js 22+**.

```bash
cd desktop
npm install
npm run build
npm start
```

The app opens on your desktop and serves its API on `http://127.0.0.1:47821`.

## Connect an agent

Open **Settings → API & agent** in the app. It shows a ready-made snippet with your
key already filled in — paste it into your agent's config.

### OAuth (no key to copy)

The app is a real OAuth authorization server: it publishes
`/.well-known/oauth-authorization-server`, registers clients dynamically and signs its
own tokens. Point the agent at the MCP endpoint and let it redirect:

```json
{
  "mcpServers": {
    "muse4ai": { "url": "http://127.0.0.1:47821/mcp" }
  }
}
```

The app then shows a **6-digit code**. Type it into the consent page and the token is
issued. Anyone who only knows the link cannot grant themselves access. Revoke any app
later under **Settings → API & agent → Connected apps**.

### API key

Create a key in the same screen (`msk_…`), then send it as a bearer token:

```bash
curl -X POST http://127.0.0.1:47821/v1/jobs \
  -H "Authorization: Bearer msk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"video","prompt":"a coffee cup on an oak desk, warm morning light"}'
```

Keys are scoped, rate-limited and individually revocable.

### What the agent gets

| REST | MCP tool |
| --- | --- |
| `POST /v1/jobs` — image / video | `muse_generate` |
| `POST /v1/jobs` with `kind:"chat"` | `muse_chat` |
| `GET /v1/jobs` · `GET /v1/jobs/{id}` | `muse_list_jobs` · `muse_get_job` |
| `POST /v1/jobs/{id}/cancel` | `muse_cancel_job` |
| `POST /v1/assets/{id}/extend` · `POST /v1/conversations/{id}/extend` | `muse_extend_video` · `muse_get_extend` |
| `GET /v1/status` · `GET /v1/health` | `muse_status` |

Full machine-readable contract: `GET /v1/openapi.json`.
For agents that prefer Markdown: [llms.txt](https://muse4ai.andrewbabo.com/llms.txt).

## Project layout

| Path | What lives there |
| --- | --- |
| `desktop/` | The app itself — main process, renderer, REST/MCP/OAuth API, tests, installer |
| `content/` | Guide, agent and use-case text shared by the app and the website |
| `agent-kit/` | The Muse4AI Skill, so an agent can learn the tool on its own |

## Development

```bash
cd desktop
npm test            # 841 tests
npm run typecheck   # strict TypeScript
npm run package:win # Windows ZIP + installer inputs
```

## Quality checks

Every push, and every Monday at 02:00 UTC, GitHub Actions re-runs the whole suite:
**841 tests**, a type check, a dependency vulnerability scan, a secret scan across the
full git history, and live checks against the public endpoints. If a weekly run fails,
an issue is opened automatically.

- Audit report: [docs/audit/2026-11-06.md](docs/audit/2026-11-06.md)
- Build specs, plans and lab evidence: [docs/build-3.3/](docs/build-3.3/) (updates, rollback, uninstall) ·
  [docs/build-3.2/](docs/build-3.2/)
- What changed in each version: [CHANGELOG.md](CHANGELOG.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md)
- Reporting a vulnerability privately: [SECURITY.md](SECURITY.md)

## Honest notes

- **Unofficial.** Muse4AI is an independent project. It is **not affiliated with,
  endorsed or sponsored by Meta Platforms, Inc.** "Meta" and "Muse" are trademarks of
  their owners.
- **You own the risk.** The app automates *your* Muse session. Automating a web app can
  break when the site changes, and may not fit Meta's terms of service — read them
  before you rely on it.
- **Windows first.** macOS and Linux builds are not packaged or tested yet; the core
  code does not depend on Windows, so porting is on the roadmap.
- **No cloud account.** There is no sign-up, no telemetry server and no subscription.

## License

[MIT](LICENSE) © 2026 Andrew Babo. Third-party notices: `desktop/LICENSES/`.

Questions or ideas: [the website](https://muse4ai.andrewbabo.com) ·
[guide](https://muse4ai.andrewbabo.com/docs) ·
[changelog](https://muse4ai.andrewbabo.com/changelog).
