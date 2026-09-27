# Acceptance tests

| Suite | Command | Needs | What it proves |
|---|---|---|---|
| API unit tests (43) | `cd api && npx vitest run` | nothing | encryption/tamper detection, masking, secret scrubbing, retry bounds, provider schema + validation, OAuth-only social providers, all 22 workflow transforms (managed credentials, Sheets service account, error-handler id, never active), api/worker shared-code parity, signed media links |
| Worker unit tests (5) | `cd worker && npx vitest run` | nothing | Runway parameter rules per model, subtitle chunking/timing, output sizes |
| Worker self-test | `node dist/tools/selftest.js` (in the worker image) | ffmpeg, storage | real FFmpeg assembly + QA + storage round-trip |
| Production smoke test (20 steps) | `node scripts/smoke-test.mjs` | web URL + admin login (+ optional provider creds / restart command) | the checklist from the production-readiness brief, through the public URL |
| Local end-to-end (test mode) | `node scripts/local-e2e-test-mode.mjs` | local stack with `docker-compose.test.yml` | whole pipeline incl. Telegram approval, OAuth, publishing, retries, cancel — against mock providers |
| Workflow validator | `node tools/validate-workflows.js` | nothing | the 22 workflow files (pre-existing tool) |
| Staging suite | `staging/run-all.sh` | Docker | pre-existing n8n workflow behaviour tests against the staging mock |

## Real video acceptance test (to run once real credentials exist)

1. Integrations: OpenAI, Runway (model gen4.5), ElevenLabs (voice id),
   Telegram — each **Connected**. Storage ONLINE on the Dashboard.
2. Video Generator → New video with exactly this prompt, 30 s, 9:16, subtitles on:
   > Create a 30-second vertical Eki promotional video showing a modern African
   > food marketplace experience, professional commercial style, realistic
   > visuals, natural voiceover, subtitles and a clear call to action.
3. Verify on the job page: every stage reached READY; scenes show Runway task
   ids (`providerJobId`), voice files show ElevenLabs request ids; final
   1080×1920 H.264/AAC, QA checks all true; **Download MP4** plays.
4. Verify Telegram received the video with APPROVE/REJECT; press APPROVE;
   Approvals shows APPROVED by your Telegram user.
5. Executions shows the VIDEO_WORKER run (SUCCESS) and the Telegram send.
