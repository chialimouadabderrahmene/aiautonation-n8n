# Video pipeline

```
Web (form) → API POST /api/video/projects ──(201 immediately)──► browser polls job
               │ readiness gate (AI, Runway, ElevenLabs, worker FFmpeg, storage)
               ▼
            BullMQ "video-generation" (attempts from Settings, exponential backoff)
               ▼
            worker orchestrator (worker/src/pipeline/orchestrator.ts)
  SCRIPT_GENERATING   OpenAI (or Groq) JSON-mode script, zod-validated; scenes 4–8 s
  STORYBOARD_READY    scenes persisted (visual prompt, narration, caption, duration)
  VOICE_GENERATING    ElevenLabs TTS per scene → storage, real duration measured (ffprobe)
  VISUAL_GENERATING   Runway text_to_video per scene → poll task → download (URLs expire) → storage
  ASSEMBLING          FFmpeg: normalize clips (size/fps/pix fmt), hold last frame while the
                      narration finishes, concat, narration track, timed burned-in subtitles,
                      optional looped music bed with fade, H.264/AAC MP4 +faststart
  QUALITY_CHECK       file exists; MP4 container; H.264 at exact 1080×1920 / 1920×1080; AAC audio;
                      duration matches timeline; full decode pass with no errors
  READY               final.mp4 + subtitles.srt uploaded; signed URLs on demand
               ▼
            Telegram: multipart sendVideo to the team chat with ✅ APPROVE / ❌ REJECT
               ▼ (button → API webhook, or the job page)
  APPROVED → BullMQ "video-delivery" publish jobs → Instagram Reels / Facebook Page / X / LinkedIn
  REJECTED → "Regenerate" (new job, revision note appended to the brief)
```

## Providers

- **Runway** (`pipeline/video.ts`): `POST /v1/text_to_video` with
  `X-Runway-Version: 2024-11-06`. Models selectable in Integrations: `gen4.5`
  (ratio `720:1280`/`1280:720`, integer 2–10 s), `veo3.1` / `veo3.1_fast`
  (`1080:1920`/`1920:1080`, 4/6/8 s). Task polling `GET /v1/tasks/{id}`
  (PENDING/THROTTLED/RUNNING/SUCCEEDED/FAILED/CANCELLED), cancellation
  `DELETE /v1/tasks/{id}`. Contract taken from `@runwayml/sdk`.
- **ElevenLabs** (`pipeline/voice.ts`): `POST /v1/text-to-speech/{voice}`
  (`mp3_44100_128`, model from Integrations, default `eleven_multilingual_v2`).
  Errors mapped: 401 key, 403 permission/plan, 404 voice, 422 request, 429 quota
  (retried), 5xx (retried), timeouts (retried).
- **Script**: OpenAI preferred, Groq fallback; only CONNECTED providers used.

## Reliability

- Retries: transient errors (timeouts, 429, 5xx, Runway internal failures) are
  retried inside the adapter (3× backoff) and at job level (`videoMaxAttempts`,
  default 2, max 5). Non-retryable errors (bad key, moderation, QA failure) stop
  at once. No infinite retries.
- Resume: completed script, per-scene voice, and per-scene clips are reused on
  retry; a scene whose Runway task was in progress when the worker restarted is
  resumed by polling the same task.
- Cancel: marks the job CANCELLED, removes it from the queue if waiting, and the
  worker cancels the running Runway task at its next poll.
- Each attempt is an `AutomationExecution` row (stage, error, retry count);
  final failures are audited and sent to the Telegram team chat.
- Temp files: per-job temp dir always removed; stale ones (>2 h) removed at
  worker start.

## Storage layout (bucket)

```
jobs/<jobId>/voice/scene-<n>.mp3
jobs/<jobId>/scenes/scene-<n>.mp4
jobs/<jobId>/final.mp4
jobs/<jobId>/subtitles.srt
media/music/<id>.<ext>
```
Private bucket; the UI receives 1-hour presigned URLs; Instagram/Facebook get a
1-hour URL to fetch the file; Telegram receives the bytes (files over Telegram's
50 MB bot limit are sent as a 24-hour link instead).

## Verification

- `node dist/tools/selftest.js` on the worker: real FFmpeg assembly of
  mismatched synthetic clips + narration + music → QA → storage round-trip.
  Local result: 1080×1920 H.264/AAC, 16.9 s, all 8 QA checks true.
- `scripts/local-e2e-test-mode.mjs` (mock providers): full pipeline to READY,
  Telegram upload with buttons, approval, publishing, reject/regenerate,
  retry-resume (1 script call, N voice calls, N+1 Runway tasks after one
  injected failure), cancellation — 15/15 passed.
- **Real Runway + ElevenLabs + OpenAI generation: NOT TESTED** (provider hosts
  blocked from the build sandbox, no accounts). See the report's "Real video
  acceptance test" for the exact command to run once credentials exist.
