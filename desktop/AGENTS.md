# Desktop app (Electron) — architecture rules

## Core
- The product's own name lives only in `src/shared/brand.ts` (`BRAND.id` on the wire, `BRAND.name` in UI/installer, `BRAND.tagline` as the sub-title), but `BRAND.dataDir` stays "MuseStudio" — the %APPDATA%/%LOCALAPPDATA% folder that already holds a live store, vault and logins — because renaming it would make an installed app look empty.
- Muse video editing reuses MIME-validated MP4 references with video/reference generation, not continuation; the coordinator rejects video inputs for image/Vibes jobs, because uploaded files need no source-conversation ownership or second queue.
- Muse automation runs inside Electron: one persistent session partition per account with its own proxy (no DIRECT fallback), driven through that account's webContents; no Playwright or extra Chromium, because Muse needs only DOM + in-page fetch and takeover/preview stay native.
- Concurrent Muse UI runs lease distinct pages from an account-scoped pool through their last download; secondary pages close after the configured idle delay and share only that account's partition/proxy, because a shared page can navigate away from another job.
- Production wires only the Muse provider; Vibes adapters and stored site fields remain legacy compatibility code, never enabled by the production main process, so old records load without new Vibes traffic.
- All Muse selectors, URLs and prompt templates live in one adapter module, so a site UI change is fixed in one place.
- Domain rules (state machines, scheduler, parsers, validators) are pure TypeScript in `src/shared` with no Electron imports, so they are unit-tested in plain Node.
- Test-only IPC commands are named `__test.*`, refused unless `MUSE4AI_TEST=1`, and call the same functions as the real trigger, so E2E exercises production paths without a backdoor.
- The renderer only shows main-process data: after a reconnect it re-reads the snapshot and merges per record by the store's monotonic `rev` (newer wins, deletions during the read stick), so no stale copy overwrites a newer event.
- The Guide, the Agent Skill install/ZIP and the MCP `muse4ai://guide` resource read the repository's `content/` and `agent-kit/` through the `@content` alias (Vite, Vitest, tsconfig, and esbuild with a `?raw` text loader), never a copy, so the app, the website and agents always show the same words and bytes.

## Direct channel
- The gateway client wakes a suspended Muse machine (`POST /api/hatch/vm/wake`, bounded wait) before opening the socket, and retries a failed socket once after a wake, because Muse suspends idle accounts' machines and the socket fails until they run.
- Images always go inline (≤ 2 MiB, like Muse's web app); documents and MP4 up to 2 MiB go inline, bigger ones are uploaded into the account workspace (`workspace/user/files/`) in 512 KiB `/fs/write` pieces to a hidden part file, size-checked, renamed and sent as `file_ref`, all before the send intent, because Muse cuts one gateway request above ~4 MiB and a failed upload must stay resend-safe.
- Muse stores a user message with attachments as marker lines (`[image:…]`, `[file:…]`) before the text; main derives the prompt part from the validated history text and turn matching accepts the stored text or that part, because exact matching is the only proof a send landed. Attachment names sent to Muse are the given file name or `ref-<sha>.<ext>`, never a local path.
- An HTTP turn is finished only when its newest non-commentary assistant message carries a terminal status (or a terminal task status); `display_text_ready` is already true while text streams, and `commentary` preambles never finish a turn or form the answer when an answer message exists, because both made long answers complete early on 01/11.
- A channel page streams at most two output files at once and hands main what arrived since the last pull in ≤ 1 MiB pieces (length- and size-checked in main), because whole-file copies of parallel videos pushed the page past its 150 MB budget.
- Main's "socket open" flag is only a hint: a job asks the page (`checkOpen`) before sending and before each reconcile read, and any failed page call refreshes the flag, because Muse silently drops idle sockets (code 1006) and a stale flag left a send stuck in reconcile on 01/11.
- Every successful connect or probe re-subscribes all followed turns, whoever triggered it, because a connection opened by a send or reconcile read left the pump's turns unsubscribed until the 20 s history fallback.
- Each HTTP run holds its account's channel from first step to last download and the idle close (60 s) waits for zero holds and zero followed turns; a closed channel keeps its light page 5 min, unloaded at once only on account removal or anomaly pause, because uploads, pacing waits and downloads follow no turn and a close there made queued sends look lost.
- An HTTP image/video job gets an app conversation handle (owner = its API key or the Studio) that Hỏi đáp may continue; a UI-made video conversation answers chat with 409 while a chain holds it and 422 otherwise, because only `gw:` sessions are addressable over the channel.

## Muse continuation
- A video made on the channel keeps a `gw:` Muse source owned by its account (owner mark `gw:<accountId>`, no page identity), and each extend step runs only on the path that made its source (`extendSource` → `muse.extend.http` / `muse.extend`) after the session history proves the source is its newest video; that path rule is one shared function (`museExtendPathReason`) used by the Library button, the Extend sheet, the API view and the start check, because neither path can address the other's conversation and the channel has no page identity to compare.
- An HTTP extend result is the one new MP4 of the turn after dropping the source locator, earlier-turn files and byte copies of the source, because Muse re-attaches the unchanged source next to the cumulative video (live 03/11).
- Muse continuation is disabled until its main-only output locator, ordered turn attribution and live app PoC pass; blob URLs and guessed attachment attributes are not durable source IDs.
- Muse source extraction reads message-bound presentation metadata and a validated workspace locator, not playback URLs; version-sensitive page internals fail closed when absent because reload can replace blobs without replacing source files.
- New Muse source ownership requires a freshly verified execution identity, never a cached identity after an unavailable check; unresolved sends retain their conversation reservation to prevent duplicate continuation.
- Agents address a Muse conversation only by an app-issued opaque handle resolved to its saved current head; ownership is checked on that head's asset, unknown and foreign handles get the same 404, and Muse thread IDs and locators never leave the main process.
- A run moves its job out of `queued` synchronously, before any await, and the scheduler skips jobs with a live run, because a job still queued during an async pre-check gets leased to a second account and sent twice.
- A proxy change holds an exclusive `proxy` lease for its whole wait and, after the 60 s wait, while the user is asked “Dừng chờ” (lapsing after 2 minutes); it then drops the direct channel, because nothing may be sent between the old and new proxy and the channel socket was opened through the old one.

## Direct channel
- A direct-channel turn is done by its answer message's terminal status, or — when it has output but no final answer message (a file-only reply) — by Muse's conversation list saying `completed` on two reads a stable gap apart, because Muse's history carries no task status for such replies and the fake gateway must model that, not a status real Muse never sends.

## Muse quota
- The account's stored Usage snapshot (weekly part + additional part, read time, failure count, block source) is the only quota truth: reads run under the account's `quota` lease, never during a page (UI/Vibes) turn but alongside live HTTP turns, reasons (b)(c) at most once per 10 minutes, a failed read keeps the previous numbers, and status/REST/MCP only display it, because a read from any other path could race a send or fake fresh numbers while concurrent HTTP turns would otherwise starve or flood reads.
- Quota changes the order of "auto" Muse assignment and may block an account only when the snapshot says nothing is left; an unread or unreadable part never blocks, and a limit Muse reported is lifted only by its time, because the provider's own refusal stays the safety net.
- "Sent since the last read" is counted from stored jobs (`submit_intent_at` after `readAt`, indexed), never kept in memory, so restarts do not reset the read schedule.

## Store and start-up
- Every store open runs `quick_check`; a corrupt store is renamed aside (never deleted) and the newest backup that passes `quick_check` is offered, because library files live outside the store and must survive recovery.
- Start-up creates the main window before opening the store; renderer commands wait for a core-ready gate (queue restored, API started) and the window is shown then. Work not needed for the first frame (backup, profile sweep, shortcut repair, session re-checks) runs after the renderer reports its first frame (5 s fallback), whose log carries main and renderer phase marks, because hidden account pages compete with first paint on GPU-less machines.
- Before the synchronous store open the store file is read once asynchronously (size/time-capped), and `app://` has the V8 code-cache privilege, because the renderer bundle is served on the main thread.
- A removed account's profile folder is deleted by a start-up sweep of unmatched `Partitions/acc-*` folders, because Windows Chromium locks partition files until exit.
- Hidden idle account pages (not shown, previewed, logging in or busy) are throttled after a short quiet period and unloaded after a longer idle; any use lifts the throttle first, because account windows run unthrottled and idle pages cost CPU/GPU; the session keeps the login.

## Windows UI
- Notification IDs are at most 16 alphanumeric characters and stay referenced until clicked or closed, because Electron uses the ID as toast tag and Windows Server 2016 rejects longer tags.
- Notification clicks route through a validated route in the toast launch argument via Electron's toast COM activator (fixed CLSID on the Start Menu link, presenter created at startup), because Action Center or post-restart clicks have no live Notification object.
- Toasts never cover an open overlay's controls: overlays register (modal or side panel), the toast stack moves beneath a modal's scrim or away from a side panel, and only the top focus trap owns Tab.

## Agent API and remote access
- REST `/v1` + MCP `/mcp` are served by the main process, off by default and loopback-only unless the user picks a sharing mode, calling the same coordinator/services as IPC, so there is no second write path.
- API keys are stored only as SHA-256 and each key sees only its own jobs; the named-tunnel token lives only in the encrypted vault and reaches `cloudflared` via environment, never argv, config files or logs.
- Helper binaries (`cloudflared`, Caddy) are downloaded on first use, pinned by SHA-256 and re-verified before every start; a leftover is stopped only when both PID and executable path match the app's copy.
- Remote access is three independent units — loopback API, tunnel, domain HTTPS proxy — applied and monitored separately on the same queue, so one failing never stops the others and agents fall back with the same `Idempotency-Key`; the app never edits DNS or firewall settings.
- The app-managed HTTPS proxy forwards `/v1/*`, `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to `127.0.0.1` (the OAuth paths so an agent can discover and run sign-in on the stable address too) and overwrites an ingress marker header the API requires for domain Host names, so nothing else can impersonate the domain route.
- The app's own health probes carry a random per-run in-memory token, and only `/v1/health` with that token is left out of the request log.
- A busy or reserved API port is reported with a suggested free port and changed only by the user, because agents keep the configured URL.

## Packaging
- Packaging always rebuilds before packing (`npm run package:win`), so a release ZIP never contains stale `dist` output.

## Language and renderer
- UI text is written in Vietnamese and that text is the catalog key; English lives only in `src/shared/i18n/catalog/*`, every renderer/main string goes through `t`/`tc`/`tl`, and an AST coverage test fails on unwrapped or untranslated text, because one source string per message keeps the two languages from drifting.
- App-generated messages are stored in Vietnamese and translated when shown or returned (template reverse match); prompts, Muse answers, names and file names are never translated, because records written before a language switch must follow the current language.
- The UI language is a store setting mirrored to a `ui-locale` file read before the store opens (default from `DEFAULT_LOCALE`), because start-up dialogs run before the store. Native dialogs use `showMessageBoxSync` with the app name as caption and translated buttons, never `showErrorBox`, because Windows gives that one a fixed English “Error” caption and “OK” button. Every app-made word an API request returns (error `detail`, job `label`/`note`/`error.message`, chain `stop_reason`, MCP text) uses that request's `Accept-Language`, else the app language, carried by an AsyncLocalStorage scope around the request (`api/requestLocale.ts`), never the global UI locale, because concurrent agents may ask in different languages while views are built deep inside long waits.
- Queue rows are memoised, only a running row's clock ticks, and quick previews read local files only, because a 10,000-row list must not re-render every second or touch the network on hover.
- Desktop media (logos, avatars) ships inside the package under `src/renderer/assets`, never as web CDN pointers, because the app runs offline from `app://`.
