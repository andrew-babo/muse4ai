---
name: muse4ai
description: Create images, short videos and answers with Meta Muse through Muse4AI, a free Windows app that runs on the user's own PC and Muse accounts. Use when the user asks to generate or edit an image or video, make B-roll, storyboards, product shots or lesson visuals, or ask Muse a question, and a "muse4ai" MCP server (tools muse_status, muse_generate, muse_chat, muse_get_job) or the Muse4AI REST API is available.
---

# Muse4AI

Muse4AI is a bridge: you (the agent) send a request, Muse4AI runs it in the user's own Muse account on their Windows PC, and you get the files back. It is not affiliated with Meta. Every generation uses the user's Muse usage limit, so be deliberate.

## Before the first request

1. Call `muse_status`. It tells you which kinds are enabled (image, image edit, video, video from image), how many accounts are ready, each account's usage limit, and your key's unfinished jobs.
2. If no account is ready, stop and tell the user to open Muse4AI › Accounts. Do not retry in a loop.
3. If the MCP tools are missing, the server is not connected: see `references/setup.md`.

## Make an image or a video

1. Write a clear prompt (subject, setting, light, style, aspect if it matters). Any language works.
2. Call `muse_generate` with `kind` (`image` or `video`), `prompt` and a **unique `request_id`** (for example `img-2026-11-02-01`). Reusing the same `request_id` with the same input returns the same jobs instead of creating new ones — use that when you retry after a network error.
3. Wait with `muse_get_job` and `wait_seconds` (up to 50) until `status` is `succeeded`, `failed`, `cancelled` or `needs_review`. Images take about 30–90 seconds; videos take several minutes.
4. Give the user the `download_url` of each output (links stay valid for 60 minutes) and save files they asked for.

Muse videos are short clips (about 8–10 seconds, 1280×720). For a longer piece, plan several clips and let the user (or a tool such as Remotion or CapCut) assemble them. Never promise a long seamless video or perfect character consistency.

## Use a reference image or video

- Your own earlier output: `reference_asset_id`.
- A file the user gives you: upload it with `POST /v1/references` (REST) and pass `reference_id`, or pass `reference_image_base64` (PNG/JPEG/WEBP ≤ 8 MB).
- Several references together: `reference_ids` (one MP4 at most).
- Video editing uses `kind: "video"` with an MP4 reference and an editing prompt; it can take up to 25 minutes.

## Ask Muse a question or get files back

Call `muse_chat` with the `prompt` (sent verbatim), optional `attachments`, and a unique `request_id`. You get Muse's answer text exactly as Muse wrote it, any files it attached, and a `conversation_id` you can pass next time to continue the same conversation. Muse4AI does not check facts: verify important claims yourself. All jobs on one Muse account share that account's Muse memory.

## Rules that protect the user

- Never resubmit a job whose status is `needs_review` or `running`. `needs_review` means a person must look at it in Muse4AI.
- Retry a `failed` job only when `error.code` is `PRE_SUBMIT_TRANSIENT` or `PROXY_FAILED`, or once after a few minutes for `PROVIDER_ERROR`.
- Do not loop generations or create large batches without the user's go-ahead; check usage in `muse_status` first.
- Use `muse_extend_video` only if `muse_status` lists the `muse.video.extend` capability, and explain that the length gained per step is not guaranteed.
- Never put the API key in a URL, a file you share, or your reply.

## More detail

- `references/setup.md` — connect Claude Code, Codex, Cursor and others; local vs public address.
- `references/tools.md` — every tool and its fields.
- `references/workflows.md` — ready recipes (affiliate clip, lesson visuals, B-roll for Remotion, product photos, storyboard).
- `references/troubleshooting.md` — what each error means and what to do.
