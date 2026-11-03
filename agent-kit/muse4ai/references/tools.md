# Muse4AI MCP tools

| Tool | What it does | Key fields |
|---|---|---|
| `muse_status` | Current state: enabled kinds, ready accounts, usage limits, your unfinished jobs. Read-only; never triggers a quota read. | — |
| `muse_generate` | Queue an image or video on the user's Muse accounts. Returns job ids at once. | `kind` (`image`/`video`), `prompt` (≤ 4000), `request_id`, `repeat` (1–4), `account` (alias or `auto`), `reference_asset_id`, `reference_id`, `reference_ids`, `reference_image_base64`, `wait_seconds` (≤ 50) |
| `muse_chat` | Send any prompt to Muse; get the answer verbatim, attached files and a `conversation_id`. | `prompt` (≤ 32000), `attachments` (reference ids or inline base64 files), `conversation_id`, `account`, `request_id`, `wait_seconds` |
| `muse_get_job` | One job: status, error, outputs with download links (60 minutes) and a preview. | `job_id`, `wait_seconds` |
| `muse_list_jobs` | Jobs made with this key, newest first. | `status`, `limit`, `cursor` |
| `muse_cancel_job` | Cancel an unfinished job. If Muse already started, it may still finish and count usage. | `job_id` |
| `muse_extend_video` | Make a Muse video longer step by step (only when `muse_status` lists `muse.video.extend`). Gain per step is not guaranteed. | `asset_id` or `conversation_id`, `mode` (`auto`/`directive`), `directive`, `times` (1–6) or `target_seconds` (15–60), `request_id`, `wait_seconds` |
| `muse_get_extend` | One extend chain: status, steps, latest output. | `chain_id`, `wait_seconds` |

## Statuses

`queued` → `running` → `succeeded` | `failed` | `cancelled` | `needs_review`.

- `needs_review`: a person must check it in Muse4AI. Do not resubmit.
- `failed`: read `error.code` (see `troubleshooting.md`).

## REST equivalents

Base `http://127.0.0.1:47821/v1`, header `Authorization: Bearer msk_YOUR_KEY`. The full description is at `GET /v1/openapi.json` (no key needed).

| Endpoint | Use |
|---|---|
| `GET /v1/health` | Is the app running (no key). |
| `GET /v1/status` | Same as `muse_status`. |
| `POST /v1/jobs` / `GET /v1/jobs` | Create jobs (image, video, chat) / list your jobs. |
| `GET /v1/jobs/{id}` | One job, like `muse_get_job`. |
| `POST /v1/jobs/{id}/cancel` | Cancel. |
| `POST /v1/references` | Upload an image or MP4 (raw bytes ≤ 20 MiB) to use as a reference or attachment. |
| `GET /v1/assets/{id}/content` | Download an output. |
