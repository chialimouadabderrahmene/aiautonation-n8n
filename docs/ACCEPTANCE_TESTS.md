# Acceptance tests — Eki AI Automation Control Center

Reproducible checklist. "Evidence" for a PASS row is what was actually observed in this pass (real command output, real browser text/screenshot), not a description of what should happen. Re-run any of these yourself with `docs/DEPLOYMENT.md`'s local dev setup.

| # | Test | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| AT-01 | Admin login | Bootstrap email/password issues a valid JWT; wrong password rejected | Real login via `POST /api/auth/login` and via the actual browser UI both issued a valid JWT and reached `/dashboard` | **PASS** | curl + browser session, this pass |
| AT-02 | Integration configuration | Saving a credential via UI or API persists it, encrypted, and flips status to CONFIGURED | Clicked Configure on OpenAI in the real browser, typed a key, saved → status became `CONFIGURED` | **PASS** | Browser click-through, this pass |
| AT-03 | Credential masking | A saved secret is never returned in full by any API response | Read back OpenAI's stored key: `"maskedPreview": "sk-b••••••••0000"` — never the real value, in both the API response and the rendered UI | **PASS** | `GET /api/integrations` output + browser page text |
| AT-04 | Connection test (real provider) | Test connection makes a real outbound call and reports the real result | OpenAI: real `401` from `api.openai.com` → `"Unauthorized API key"`. Telegram: real `401` from `api.telegram.org` → `"Unauthorized"`. Both with real latency (`1012ms`, `2592ms`) and shown live in the browser UI | **PASS** | curl output + browser Integrations page |
| AT-05 | Readiness calculation | Each of the 22 workflows lists which specific requirements are unmet | `GET /api/workflows` and the real Automations page both show the full per-workflow requirement breakdown (e.g. `"telegram is TEST_FAILED"`) for all 22 | **PASS** | API + browser Automations page |
| AT-06 | Workflow enable (blocked) | `POST /workflows/:key/enable` refuses a BLOCKED workflow with 409 and the reason | `409 {"message":"Workflow is not READY...","readiness":"BLOCKED","detail":[...]}` | **PASS** | curl output, this pass |
| AT-07 | Workflow disable / activate-ready | With zero integrations connected, activate-ready activates 0 and names why each of the 22 was skipped | `{"activated":[],"skipped":[22 entries, each with a "reason"]}` | **PASS** | curl output, this pass |
| AT-08 | n8n execution (real instance) | Import script puts all 22 workflows into a real n8n instance, inactive | Real n8n 2.40.7 container: `22/22 imported`, then confirmed `active:false` for all 22 via a separate `GET /api/v1/workflows` call. Control Center's `n8n` integration then tested `CONNECTED` against the same instance, and the Dashboard showed it live (`n8n: CONNECTED`, `SYSTEM: PARTIALLY READY`) | **PASS** | Full transcript in `docs/N8N_SETUP.md` |
| AT-09 | AI generation (script stage) | `generateScript` calls a real OpenAI/Groq-compatible endpoint and returns a validated script | Not run — no real OpenAI/Groq key available in this pass (the only key used anywhere was intentionally invalid, for AT-04) | **NOT TESTED** | — |
| AT-10 | Video job creation | Creating a project when the pipeline isn't ready is refused (409) with the exact missing providers; when ready, a BullMQ job is enqueued | Refusal path confirmed live via curl and the browser ("Video pipeline is not ready yet ✕ openai or groq ✕ runway ✕ elevenlabs"). Success path (real enqueue) not run — pipeline was never READY in this pass (no real AI/Runway/ElevenLabs key) | **PARTIAL** | curl + browser; success path **NOT TESTED** |
| AT-11 | Voice generation (ElevenLabs) | `generateVoiceover` calls ElevenLabs' TTS endpoint and returns a playable asset | Not run — no ElevenLabs key available | **NOT TESTED** | — |
| AT-12 | Video generation (Runway) | `generateSceneVideo` calls Runway, polls to completion, returns a scene URL | Not run — no Runway key available; request shape itself flagged unverified in-product | **NOT TESTED** | — |
| AT-13 | FFmpeg assembly | Real `ffmpeg`/`ffprobe` concatenate scenes, mix audio, burn subtitles, and pass a real quality check | `ffmpeg`/`ffprobe` 8.1.2 confirmed present and runnable inside the real worker Docker image (`docker run --rm ... ffmpeg -version`). The assembly/QA *code path* itself was not exercised end-to-end (needs real scene/voiceover assets from AT-11/AT-12 first) | **PARTIAL** | `docker run` output, this pass; full pipeline run **NOT TESTED** |
| AT-14 | Telegram approval | Sending a video posts to a real Telegram chat with inline buttons; the webhook records the decision | Not run — no real Telegram bot/chat configured (only a fake token was tested, AT-04) | **NOT TESTED** | — |
| AT-15 | Failure / retry | A failed video job can be retried; a failed integration test is recorded, not silently dropped | Retry endpoint reviewed and its (deliberate, non-automatic) design documented in `docs/VIDEO_PIPELINE.md`; not exercised against a real failed job (needs AT-10's success path first). Failed integration test recording confirmed live (AT-04's Telegram/OpenAI failures both correctly persisted with timestamp + message) | **PARTIAL** | curl/browser for the integration half; job retry **NOT TESTED** |
| AT-16 | Audit logging | Every credential save/test/disconnect and automation action is recorded with actor, never a secret value | Confirmed live: `GET /api/audit` after a real save → test → activate-ready → disconnect sequence showed exactly those actions, each with `actor: "admin@eki-cc.local"`, no secret values in any entry | **PASS** | curl output, this pass |
| AT-17 | Reporting | Reports page shows real (zero, in a fresh instance) execution/video/approval counts, not placeholder numbers | Real browser page text: `TOTAL 0 / SUCCESSFUL 0 / FAILED 0 / SUCCESS RATE —` etc. — genuine zero-state, not fake sample data | **PASS** | Browser Reports page text, this pass |

## Additional checks run beyond the 17 above

| Check | Result |
|---|---|
| `api` — `tsc --noEmit`, `npm run build` | PASS |
| `worker` — `tsc --noEmit`, `npm run build` | PASS |
| `web` — `tsc --noEmit`, `npm run build` (`next build`, 13 routes) | PASS |
| Prisma migration applied to a real, disposable Postgres 16 | PASS |
| `worker` Docker image: real `/health` (DB+Redis ping), Docker `HEALTHCHECK` → `healthy`, real `SIGTERM` → graceful shutdown log lines → exit 0 | PASS (see `docs/DEPLOYMENT.md`) |
| `api` Docker image: same, plus a real login issuing a real JWT through the container | PASS |
| Responsive layout at 375×812 (phone) | FAIL found and fixed — sidebar had no mobile breakpoint, clipped every page; fixed with an off-canvas drawer, re-verified clean |
| Responsive layout at 768×1024 (tablet) | PASS |
| Browser console errors across a full click-through of all 9 screens | None |
| Secret-pattern scan of source (`sk-...`, `gsk_...`, AWS/Meta/Telegram token shapes) | None found |
| `NEXT_PUBLIC_*` scan of `web/src` | Only `NEXT_PUBLIC_AUTOMATION_API_URL` (a plain URL) |
| `console.log` of secret-shaped variable names | None found |
| Tracked `.env` files in git | Only `.env.example` files |

## Summary

- **PASS**: AT-01, AT-02, AT-03, AT-04, AT-05, AT-06, AT-07, AT-08, AT-16, AT-17 (10/17)
- **PARTIAL** (refusal/negative path proven; success path needs real provider credentials): AT-10, AT-13, AT-15 (3/17)
- **NOT TESTED** (needs real OpenAI/Groq + Runway + ElevenLabs + Telegram credentials this pass did not have): AT-09, AT-11, AT-12, AT-14 (4/17)

No test above is marked PASS without the real command/output or real browser evidence it's based on.
