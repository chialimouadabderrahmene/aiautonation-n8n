# Video generation pipeline

`Idea → Script → Storyboard → Voiceover → Visual generation → Assembly →
Subtitles → Quality check → MP4 → Telegram approval → Publish`

## Trigger

`POST /api/video/projects` (Video Generator screen) — refuses with 409 if
`evaluateRequirements(["openai|groq", "runway", "elevenlabs"])` isn't READY.
On success it creates one `VideoProject` + one `VideoJob` (state `QUEUED`)
and enqueues one BullMQ job (`video-generation` queue, `worker/src/index.ts`
consumes it). The HTTP request returns immediately — generation happens
entirely in `worker/`.

## Stages (`worker/src/index.ts` orchestrates; each stage is its own file)

1. **`SCRIPT_GENERATING`** (`pipeline/script.ts`) — calls whichever of
   OpenAI/Groq is connected, `response_format: json_object`, validated with
   zod (`scriptSchema`) before anything downstream touches it. Produces a
   hook, 3–8 scenes (visual prompt + voiceover text + subtitle text +
   duration), a caption, and hashtags.
2. **`STORYBOARD_READY`** — the validated script is persisted; `VideoScene`
   rows are created (one per scene, `status: PENDING`).
3. **`VOICE_GENERATING`** (`pipeline/voice.ts`) — ElevenLabs
   text-to-speech over the full concatenated narration, saved as one
   `VideoAsset` (`type: VOICEOVER`).
4. **`VISUAL_GENERATING`** (`pipeline/video.ts`) — one Runway job per scene,
   sequential (not parallel — no per-provider rate-limit handling exists yet
   for concurrent generation), polled to completion, each result downloaded
   into local storage and recorded as a `VideoAsset` (`type: SCENE`). A
   single scene failure fails the whole job (no partial video is produced or
   presented as done).
5. **`ASSEMBLING`** (`pipeline/assemble.ts`) — `ffmpeg` concatenates the
   scene clips, mixes in the voiceover, and (if `subtitles` is on) burns in
   an `.srt` built from each scene's subtitle text and duration
   (`buildSrt`). Shells out to the real `ffmpeg` binary — no video-editing
   library dependency.
6. **`QUALITY_CHECK`** (`pipeline/qa.ts`) — real `ffprobe` on the actual
   output file: file exists and is non-empty, has a video stream, has an
   audio stream, duration is at least ~70% of the requested duration. A
   failing check fails the job — nothing is marked `READY` on a rubber stamp.
7. **`READY`** — final MP4 saved as a `VideoAsset` (`type: FINAL`),
   `VideoJob.finalVideoUrl` set.

Any stage can fail into `FAILED` with `errorStage` + `error` recorded (never
silently swallowed), and every attempt is logged as an `AutomationExecution`
(`source: VIDEO_WORKER`) for the Executions/Reports screens.

## Cancellation

The job state is checked between stages (`isCancelled`) — setting a job to
`CANCELLED` via `POST /api/video/jobs/:id/cancel` stops the worker from
progressing it further, though a stage already in flight (e.g. a Runway call
already sent) is not aborted mid-call in this pass.

## Retry

`POST /api/video/jobs/:id/retry` only accepts a `FAILED` job and re-runs the
**entire** pipeline from `QUEUED` (increments `retryCount`). Per-stage retry
(e.g. "just regenerate this one scene") is not implemented — the UI's
storyboard tab shows per-scene status/error for diagnosis, but the retry
action is whole-job only in this pass.

## Provider abstraction

`VideoProvider` (`pipeline/video.ts`) and `VoiceProvider` (`pipeline/voice.ts`)
are one-method-family interfaces; `RunwayVideoProvider` and
`ElevenLabsVoiceProvider` are the only implementations. Adding a second video
provider (Pika, Luma, ...) means implementing the interface once — the
orchestrator in `index.ts` never references Runway by name outside
`pipeline/video.ts`.

**Runway status: not verified against a real account.** The request/response
shapes (`POST /v1/text_to_video`, `GET /v1/tasks/:id`, `X-Runway-Version`
header) follow Runway's publicly documented async-task pattern but have
never round-tripped against a real API key — confirm against
`https://docs.dev.runwayml.com` before production use, and update only
`pipeline/video.ts` if the shape differs.

## Storage

Local disk only (`worker/src/lib/storage.ts`, `StorageProvider` interface).
Does **not** survive a redeploy on most PaaS (Railway included, without an
attached volume) — see `ARCHITECTURE.md` "Storage" and `DEPLOYMENT.md` step 5.

## Known limitations (this pass)

- **Background/custom music is not implemented.** `VideoProject.music`
  accepts `"none" | "background" | <asset id>` in the schema, but the worker
  always assembles with `musicPath: null` — passing an unresolved value like
  `"background"` straight to ffmpeg would corrupt every assembly, so it was
  deliberately left out rather than shipped broken. `assemble.ts`'s `amix`
  path is written and ready for when a real music-asset library exists.
- Parallel scene generation, per-stage retry, and image-to-video (vs.
  text-to-video) are not implemented.
- No FFmpeg execution has happened in this environment — `ffmpeg`/`ffprobe`
  are not installed on the dev machine this was built on. The commands are
  standard and the code is typechecked and reviewed, but "the actual ffmpeg
  invocation runs correctly end-to-end" is **not tested** here — see the
  final report's "Testing performed" section.
