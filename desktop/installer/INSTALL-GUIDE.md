# Muse4AI — installation and troubleshooting

*Tiếng Việt: HUONG-DAN-CAI.md*

Test build for Windows 10/11 and Windows Server 2016 or later, 64-bit. Not code-signed, installed with PowerShell, **no admin rights needed**.

> Muse4AI drives the Muse website for you — this is not an official Meta integration. Use secondary Muse accounts; the app stops as soon as Muse reports a quota limit, a verification request or an unsupported region, and never tries to get around it.

## 1. First install

1. Download `Muse4AI-<version>-win-x64.zip` and extract it into any folder (for example `Downloads\Muse4AI`).
2. Open the extracted folder, click the address bar, type `powershell` and press Enter.
3. Run:

   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   The installer checks the package's SHA-256, installs into `%LOCALAPPDATA%\Programs\Muse4AI`, creates Start Menu and Desktop shortcuts and opens the app. The command does not change the machine's ExecutionPolicy.
4. Follow the four steps in the app: confirm the notice → choose the folder for images/videos → paste your proxy list → add a Muse account and sign in inside the window the app opens (the app does **not** store passwords).

If you see “The package does not match its checksums”: the ZIP is damaged or was modified — download it again and do not continue.

**Or use the EXE installer** `Muse4AI-<version>-Setup-win-x64.exe`: double-click, pick a language (English / Tiếng Việt), click Next. It runs the same PowerShell process as above. The language you pick becomes the app's first language if the app has never had one; change it any time at the bottom of the sidebar or in Settings › General. The app's default is English.

Installer messages follow `-Lang en` or `-Lang vi`; without it they use the app's language, else English.

## 2. Install a new version

1. Quit the app completely: right-click the Muse4AI tray icon → **Quit** (the X button only minimises to the tray).
2. Extract the new package and run the command from step 1.3 again.

Signed-in accounts, the queue, settings and the library are kept. The previous version stays in the install folder so you can roll back. If the app is still open, the installer stops and asks you to quit Muse4AI first.

## 3. Roll back to the previous version

```
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Rollback
```

The installer reminds you: if the new version upgraded the data, anything written after the upgrade (new jobs, setting changes) may be missing in the older version. Images/videos in the library are not affected. Automatic backups are in `%APPDATA%\MuseStudio\backups` (one per day, seven kept, plus one before every data upgrade).

If the older version says **“Data belongs to a newer version”** (for example going back from Build 2.0 to Build 1.0), it cannot read the newer data by itself. Use the pre-upgrade backup:

1. Quit the app completely (tray → **Quit**).
2. Open `%APPDATA%\MuseStudio\data` and rename `muse.sqlite` to `muse.sqlite.new` (also rename `muse.sqlite-wal` and `muse.sqlite-shm` if present) — keep it to upgrade again later.
3. From `%APPDATA%\MuseStudio\backups`, copy the newest `before-v<new>-from-v<old>-….sqlite` into `data` and rename it to `muse.sqlite`.
4. Open the app. Anything written after the upgrade time (in the backup's file name) is lost; the image/video library, account sign-ins and proxies are kept.

## 4. Uninstall

| You want | Command | Result |
|---|---|---|
| Remove the app, keep data | `powershell -ExecutionPolicy Bypass -File .\uninstall.ps1` | App and shortcuts removed; accounts, queue, settings and library stay |
| Remove the app and its data | add `-RemoveData` | Also removes app data (`%APPDATA%\MuseStudio`, `%LOCALAPPDATA%\MuseStudio`); **the image/video folder is kept** |

If the app was ever killed, uninstall also stops the app's own leftover HTTPS/tunnel helper (only copies inside the app's folder, never another Caddy/cloudflared on the machine).

## 5. Troubleshooting

| You see | Meaning | What to do |
|---|---|---|
| A banner “Muse changed its interface”, image or video jobs paused | The Muse page changed and the app no longer recognises its buttons/inputs | Wait for a Muse4AI update; unsent jobs stay in the queue |
| Account shows “Proxy error” | The account's proxy cannot connect; the app does **not** fall back to a direct connection | Settings › Proxy → Test all; change the account's proxy on its card (⋯ → Change proxy). Unsent jobs move to another account |
| Account shows “Needs verification” / “Sign in again” | Muse asks for verification or the session expired | Click **Take over** on the account card, verify/sign in yourself in the window, then click “Done, check session”. If Muse asks for something unusual, stop using that account |
| “Out of quota until …” | Muse limits the number of jobs | The account rests until then and takes work again; nothing to do |
| A job “Needs your review” | The app is not sure Muse received the job (for example the network dropped while sending) | Open the job: “Import from Muse history” if the job is on Muse (gets the result, creates nothing new), or “Send again” (may use more quota). The app never resends by itself, to avoid duplicates |
| “Disk almost full” / “Disk nearly full — downloads paused” | Below 2 GB free on the library drive the app warns; below 500 MB it pauses downloading results | Free up space or change the library folder in Settings › General; downloads resume when there is room |
| A “Muse4AI — restore data” box at start-up | The app's data file is damaged (for example a power cut while writing) | Click **Restore backup**: the app uses the newest good backup; jobs/accounts/settings changed after the backup time may be lost, the library is not affected, and the damaged file is kept next to it for diagnosis. If no backup works, the app reports the error and exits — send the diagnostics file |
| The app does not open after installing a new version | The new version fails on this machine | Roll back (section 3) and report it with the diagnostics file |

**Diagnostics file:** Settings › Diagnostics → **Export diagnostics (.zip)**. IPs, emails, passwords and cookies are masked. If the app does not open, send the `%APPDATA%\MuseStudio\logs` folder.

## 6. Letting other agents call Muse4AI (API & MCP)

The API is **off by default**. Turn it on in Settings › **API & agent**:

1. Turn on **API for agents** — programs on this machine can call `http://127.0.0.1:47821` (if the port is busy, the app suggests a free one; one click to switch).
2. **Create a key** for each agent (name it after the agent; choose “Create and cancel” or “Status only”). A key is shown **once** — copy it right away; if lost, revoke it and create a new one.
3. For agents on **another machine** there are two routes — both can be used **at the same time**:
   - **Quick tunnel** (card “Let other machines call in”): works immediately, the `https://….trycloudflare.com` address changes every time the app opens. A **named tunnel** uses your domain on Cloudflare. The first time, the app downloads `cloudflared` (~55 MB, SHA-256 checked). For a LAN/Tailscale use **Private network**.
   - **A domain pointing at this machine** (card below): direct HTTPS calls to the machine at a fixed address. Create an **A** record pointing the domain at the machine's public IP (the app shows it); the machine must accept ports **80 and 443** from the Internet. With **App runs HTTPS**, the app downloads Caddy (~18 MB, SHA-256 checked) and obtains and renews a Let's Encrypt certificate. If you already run IIS/nginx/Caddy, choose **Existing HTTPS proxy** and paste the configuration the app provides. The app does **not** change DNS or the firewall — four checks (DNS, ports, certificate, test call) tell you what is missing; the firewall command (if needed) has a copy button, run it in an admin PowerShell.
   - While the domain is being set up, keep using the tunnel. Agents should keep both addresses: if one route fails, resend through the other with the **same Idempotency-Key** — the app returns the original job instead of creating a duplicate.
4. The **Connect an agent** card has ready-made snippets for Claude Code, Cursor, VS Code, Claude Desktop, Codex CLI, Gemini CLI, Python, OpenAI, n8n and curl using the address you choose (default: the domain if online, then the tunnel); full documentation at `/v1/openapi.json`. Error `detail` text follows the agent's `Accept-Language` (`en`/`vi`), else the app's language.

Anyone with a key can use your Muse quota. Turning the API off or quitting the app stops sharing immediately (both the tunnel and the domain's HTTPS); revoking a key takes effect from the next call. Agent jobs share the queue, are labelled “API · key name” and follow the app's rules (no automatic resend when unsure Muse received a job, stop when Muse reports quota/verification).

## 7. Vibes (removed in 2.0.0-beta.19)

Muse4AI now uses Muse only. Signing in to Vibes and making videos there were removed; old Vibes data and videos in the library are kept and viewable, but no Vibes job runs again.

## 8. Windows warnings during install

The app is not signed, so Windows SmartScreen or antivirus software may ask again. This is a test build; only install packages you received from us and, if needed, check the SHA-256 in `SHA256SUMS.txt` (`Get-FileHash .\app.zip`).
