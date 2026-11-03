# Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| Unauthorized / 401 | Key missing or wrong | Ask the user to check the key in Settings › API & agent (create a new one if needed). |
| Connection refused / timeout | Muse4AI closed, API server off, wrong port, or a cloud agent using `127.0.0.1` | Ask the user to open Muse4AI, turn the API server on, or use the public address from Remote access. |
| `capability_unavailable` | That kind (for example video from image) is not enabled now | Call `muse_status` and pick an enabled kind. |
| No account ready | Accounts need sign-in, are busy, or paused | Tell the user to open Muse4AI › Accounts. Do not retry in a loop. |
| `needs_review` | The app could not prove the result; a person must check | Stop. Ask the user to review it in Muse4AI. Never resubmit. |
| `failed` with `PRE_SUBMIT_TRANSIENT` or `PROXY_FAILED` | Nothing reached Muse | Safe to retry with the same `request_id`. |
| `failed` with `PROVIDER_ERROR` | Muse reported a technical failure | Retry once after a few minutes. |
| Usage limit reached | The account has no generations left now | Tell the user; wait for the reset shown in `muse_status`. |
| `conversation_busy` | Another turn is still open in that conversation | Wait for it; do not retry in a loop. |
| `source_not_extendable` | That video has no Muse conversation the app can continue (made before sources were saved, its account was removed, or a newer video now ends the conversation) | Read `detail` to the user; extend the newest video of that conversation or make a new one. Do not retry. |
| `capability_unavailable` on extend | The video's account runs on a path that cannot reach its conversation (an HTTP-made video needs Auto or HTTP; a page-made one needs Auto or UI) | Ask the user to set that account to Auto in Muse4AI › Accounts, then send once more with a new `request_id`. |
| Video shorter than expected | Muse clips are about 8–10 seconds | Plan several clips and assemble them. |
| Download link expired | Links last 60 minutes | Call `muse_get_job` again for fresh links. |
