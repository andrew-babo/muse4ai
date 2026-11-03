# Recipes

Each recipe: plan with the user first, generate a little, show results, then continue. Label AI-generated content when the user publishes it.

## Affiliate or sales clip (about 24 seconds)

1. Ask for the real product photo and the real facts (name, price, key features, link). Never invent prices or claims.
2. Write a short script: hook, 2–3 benefit shots, call to action, affiliate disclosure.
3. Generate 3 short video clips with `muse_generate` (`kind: "video"`), using the product photo as a reference when the product must appear.
4. Hand the clips to the user's editor (CapCut, Remotion) with the script and subtitles.

## A longer video (20–60 seconds) from one clip

1. Check `muse_status` lists `muse.video.extend`; otherwise make several clips and join them in an editor.
2. Generate one clip (`kind: "video"`) and show it to the user before spending more generations.
3. Call `muse_extend_video` with that output's `conversation_id` (or `asset_id`) and `times` (1–6) or `target_seconds` (15–60); each step uses one generation and Muse decides how much it adds.
4. Wait with `muse_get_extend`. Reading the conversation (`GET /conversations/{id}`) shows the steps, the newest video and `can_extend` with a reason when it cannot continue.
5. Never retry a step that ended in `needs_review`; ask the user to look at it in Muse4AI.

## Lesson visuals for a teacher

1. Ask for the topic, grade and the key idea of the lesson.
2. Generate 3–5 illustrations (`kind: "image"`) and one short opening clip.
3. Check the content is correct; images are illustrations, not evidence.

## B-roll for a Remotion video

1. Read the composition's scenes and where B-roll is needed (duration, mood, aspect).
2. Generate one clip per slot with a unique `request_id` (for example `broll-scene-3`).
3. Download into the project's `public/` folder and reference them in the composition. Clips are about 8–10 seconds; trim in Remotion.

## Product photo set

1. Ask for the product photo and the backgrounds wanted (studio, kitchen, outdoor…).
2. Generate one image per background with the photo as reference; keep the product true to the original.

## Storyboard animatic

1. Turn the script into 6–10 frames with a one-line description each.
2. Generate an image per frame, then short clips for the key frames.
3. Present it as a draft for discussion, not final footage.

## Research question

1. Use `muse_chat` with a precise prompt and ask for sources.
2. Verify the important facts yourself before you use them.
