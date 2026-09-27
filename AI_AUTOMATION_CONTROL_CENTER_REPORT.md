# Eki AI Automation Control Center — production-readiness report

Date: 2026-09-27 · Branch: `claude/eager-galileo-q266au` · Scope: this repository only (no Eki marketplace backend, mobile app, admin-web, Community Buy or Vendor Automation code was touched).

## 0. Honest summary

The system is now **deployment-ready and self-provisioning**: from a fresh
deployment it migrates its database, creates its admin, connects itself to n8n
(owner + API key), imports the 22 workflows inactive, creates the n8n
credentials from its own encrypted vault, and delivers all configuration to n8n
— the client only enters/connects provider accounts in the browser. This was
verified end to end on a local stack built from the **same Dockerfiles** that
Railway uses.

Two things could **not** be done from this environment, and nothing below
pretends otherwise:

1. **No Railway deployment was performed.** No Railway account/token was
   available to this session. Railway config-as-code, a provisioning script and
   a step-by-step guide are delivered; the local stack mirrors the production
   topology. Railway itself: **BLOCKED** (needs the client's Railway access).
2. **No real provider accepted a real credential.** The session's network
   policy blocked OpenAI, Groq, Telegram, Runway, ElevenLabs, Meta, X,
   LinkedIn, Resend, Apify and Buffer (HTTP 403 at the egress proxy), and no
   accounts were provided. Google's APIs were reachable and answered for real
   (error path). The full pipeline was instead exercised against a local mock
   of the providers in an explicit, visibly-flagged **test mode** — labelled as
   such everywhere. The **real video acceptance test is NOT TESTED**.

## 1. Architecture

`web` (public, Next.js) → same-origin proxy → `api` (private, Express/Prisma)
→ Postgres (schemas `public` + `n8n`), Redis/BullMQ, S3 bucket, n8n public API;
`worker` (private, BullMQ + FFmpeg); `n8n` 2.40.7 with the Eki supervisor.
Details: `docs/ARCHITECTURE.md`.

## 2. Railway deployment

- `railway/{api,worker,web,n8n}.json` — Dockerfile builds, healthchecks, restart policy, watch paths.
- `scripts/railway-setup.sh` — creates Postgres, Redis, 4 services, public domains (web + n8n only), n8n volume, every variable (private-domain references, shared secrets).
- `docs/DEPLOYMENT.md` — automated and manual paths, variable-by-variable.
- Private networking: api/worker/Postgres/Redis have no public domain; the API's service-to-service endpoints listen on a separate internal port; Redis clients resolve IPv6 (`family: 0`); n8n and the supervisor listen on `::` by default.

Status: configuration delivered; **deployment not executed (BLOCKED — no Railway access)**.

## 3. Web Control Center

Sections: Dashboard, Integrations, AI Content Studio, Video Generator (+ live job page), Automations, Approvals, Executions, Reports, Settings, Login. `next build` + `next lint` clean. Driven in headless Chromium (Playwright): every page loaded with zero console errors after a favicon fix; screenshot `docs/evidence/ui-dashboard.png`. Mobile layout checked at 390 px.

## 4. Integrations

15 providers from one data-driven registry (`api/src/modules/providers/definitions.ts`): OpenAI, Groq, n8n, Google Sheets, inbound webhook security, Telegram, WhatsApp (incl. the 15 template names), Resend, Buffer, X, Meta, LinkedIn, Apify, Runway, ElevenLabs. Each declares typed fields, secret/non-secret, validation (patterns, URL/email/JSON/number/select), groups, docs link, auth type and a real read-only test. Statuses: Not configured / Configured / Testing / Connected / Test failed / Action required. Saving never sets Connected.

## 5. Credential security

AES-256-GCM per field (`AUTOMATION_SECRET_KEY`); responses carry masked previews only. Verified on the running stack: pg_dump of the database contains no plaintext test secrets; API/worker/web logs (141 lines) contain none of 12 secret values checked; audit log contains none; the frontend bundles contain no secret names, internal hosts or keys. OAuth tokens are exchanged, stored, refreshed server-side and never returned. Repository + full git history scan: only placeholders (`sk-proj-...`) found.

## 6. OAuth

X (OAuth 2.0 + PKCE, auto-refresh, token pushed into n8n's "Eki X Bearer"), Meta (Facebook Login → long-lived Page token + Instagram business account), LinkedIn (OAuth 2.0). Single-use expiring state; redirect URL shown on each card. Test-mode run: Meta connect succeeded through the real callback route, a replayed state was rejected, tokens absent from responses. Real platform consent screens: **NOT TESTED**.

## 7. n8n

Real n8n 2.40.7 in every test. Verified: owner + API key created automatically on first boot; key reused (not re-minted) on restart; 22/22 imported inactive; re-sync idempotent (22 unchanged); credentials created from the vault; Sheets nodes switched to service-account auth; error-handler reference resolved; configuration change → supervisor restart with new env; drift protection. Details: `docs/N8N_SETUP.md`.

## 8. The 22 workflows

Unit test transforms all 22 files (managed credentials only, never active, error handler resolved). In n8n: 22 present, 0 active initially; after full restarts still 22, and exactly the enabled set active. Workflow logic itself is unchanged (validated earlier in the staging suite).

## 9. Readiness system

READY only when: required providers CONNECTED (tested), settings/fields filled, confirmations ticked, n8n connected, workflow present in n8n, every n8n credential it uses synced; video additionally needs a live worker with FFmpeg and reachable storage. Each unmet requirement is listed with the fix. Verified: 22/22 BLOCKED with reasons on an empty system; workflow 00 became READY once Telegram was connected (test mode).

## 10. Activation

`ACTIVATE READY AUTOMATIONS` recalculates readiness, enables only READY workflows in n8n, reports `Activated / Already active / Skipped` with every reason. Verified: 0 activated / 22 skipped (empty system); 1 activated / 21 skipped with Telegram connected; enabling a BLOCKED workflow → 409 with reasons; per-workflow Enable/Disable/Test run verified against n8n (enable right after a restart triggers a sync instead of failing).

## 11. Video Generator

All requested inputs (name, topic, prompt, platform, audience, language, tone, duration, aspect ratio, visual style, voice, subtitles, music, CTA, publish targets). Asynchronous (HTTP 201 immediately, BullMQ, live page), states QUEUED → … → READY / FAILED / CANCELLED. Resumable stages, bounded retries, cancellation. `docs/VIDEO_PIPELINE.md`.

## 12. Runway

Adapter built from the official `@runwayml/sdk` contract: `POST /v1/text_to_video`, `X-Runway-Version: 2024-11-06`, gen4.5 / veo3.1 / veo3.1_fast with their ratio and duration rules, task polling, `DELETE` cancel, output downloaded immediately (URLs expire) and stored. The old adapter sent `ratio: "9:16"` (invalid for Runway) — fixed. Real Runway call: **NOT TESTED** (blocked).

## 13. ElevenLabs

Per-scene TTS (`POST /v1/text-to-speech/{voice}`), audio stored with duration and provider request id; 401/403/404/422/429/5xx/timeouts mapped, secrets scrubbed. Real call: **NOT TESTED** (blocked).

## 14. FFmpeg

Worker image (Ubuntu 24.04) ships `ffmpeg version 6.1.1-3ubuntu5` and ffprobe, with libass subtitles and DejaVu fonts. `dist/tools/selftest.js` in the real worker container: mismatched synthetic clips (720×1280@24, 768×1280@30, 1080×1920@25) + narration + music → 1080×1920 H.264 / AAC 48 kHz stereo MP4, 16.9 s (freeze-frame hold applied), QA checks exists/container/video/resolution/aspect/audio/duration/full-decode all **true**, uploaded to S3 and downloaded byte-identical. Frame with burned subtitles: `docs/evidence/selftest-frame.png`. On the Railway worker: **NOT TESTED** (not deployed) — run `node dist/tools/selftest.js` there.

## 15. Storage

S3-compatible (Railway Bucket / R2 / S3) with presigned URLs, optional public endpoint for presigning, local-volume driver for single-host dev, bucket auto-create, health probe, temp-file cleanup. Verified against SeaweedFS (real S3 API): uploads, downloads, range requests (206), unsigned/tampered URLs → 403.

## 16. Telegram approval

READY video uploaded automatically (multipart `sendVideo`, APPROVE/REJECT inline buttons; >50 MB → signed link). The Control Center owns the bot webhook, handles video buttons (constant-time secret check, only from the team chat) and forwards everything else to workflow 02. APPROVE → publish jobs; REJECT → reason stored, Regenerate. Verified in test mode (forged → 403, foreign chat ignored, team chat → APPROVED). Real bot: **NOT TESTED**.

## 17. Publishing

Instagram Reels (container → status → publish → permalink), Facebook Page video, X (v2 chunked media upload + tweet), LinkedIn (videos API + posts). Test mode: Instagram + Facebook PUBLISHED through the mocks (Instagram mock fetched the video via the signed URL). X/LinkedIn publishing and every real platform: **NOT TESTED**.

## 18. Execution monitoring

`AutomationExecution` unifies n8n executions (mirrored every 30 s: workflow, trigger/mode, start, finish, duration, status, failing node + message), video attempts (stage, error, retry count) and delivery jobs. n8n now keeps successful executions for 7 days so successes are visible. Verified: real n8n test-run executions appear with their error text; video retry shows FAILED/retry0 + SUCCESS/retry1.

## 19. Reports

Period 24 h / 7 d / 30 d: executions, success rate, average duration, runs per day, per workflow, per source, videos generated/failed, failures by stage, average generation time, approvals, publications. Verified populated after the E2E run.

## 20. Security

Helmet, strict CORS, no `x-powered-by`, HSTS/frame/nosniff headers on web, internal routes unreachable from the public proxy (404), failed-login rate limit, bcrypt, JWT, audit trail incl. failed logins, test-mode requires two explicit variables and shows a red banner. Findings fixed this pass: OAuth-style social providers accepting pasted tokens (replaced with OAuth), secrets possibly echoed by provider errors (scrubbed), `console.log` of admin email (structured logger).

## 21. Backups

`scripts/backup-db.sh` / `scripts/restore-db.sh`, `docs/BACKUP_RESTORE.md`. Drill: 760 KB dump → fresh Postgres → 17 tables + 22 n8n workflows → API image against it: migrations up to date, credentials decrypt, 22 links, 5 videos. Railway scheduled backups: **NOT TESTED**.

## 22. Testing

| Suite | Result |
|---|---|
| API unit tests | 43/43 pass (`docs/evidence/unit-tests.txt`) |
| Worker unit tests | 5/5 pass |
| TypeScript (api, worker, web), `next lint` | clean |
| Workflow validator | no workflow errors (only intentional placeholders in example files, as before) |
| Local production smoke test (20 steps, incl. full restart) | 18 pass, 2 skipped (no manual-trigger workflow can be READY without real Google Sheets) — `docs/evidence/smoke-test-local.txt` |
| Local end-to-end, test mode | 15/15 pass — `docs/evidence/local-e2e-test-mode.txt` |
| Worker FFmpeg self-test | pass — `docs/evidence/worker-selftest.json` |
| Full restart of all services | back ONLINE in 62 s; 22 workflows; active set unchanged |

## 23. Production smoke test

`scripts/smoke-test.mjs` implements the 20-step checklist through the public URL. Run locally (evidence above). **On Railway: NOT TESTED** (not deployed). Command in `docs/DEPLOYMENT.md`.

## 24. Real video E2E test

**NOT TESTED** — requires real OpenAI, Runway, ElevenLabs and Telegram accounts and outbound access to them. Exact procedure with the required prompt: `docs/ACCEPTANCE_TESTS.md`. The same pipeline code ran end to end in test mode and its FFmpeg/QA/storage stages ran for real.

## 25. Final status

Legend — **TESTED**: exercised for real on the local production-identical stack (real Postgres, Redis, n8n 2.40.7, S3, FFmpeg, same images); **CONFIGURED**: delivered and statically checked but not executed; **BLOCKED**: cannot be completed without something only the client can provide; **NOT TESTED**: implemented, not exercised. Nothing is marked READY: READY would require evidence from the deployed Railway environment with real accounts, which does not exist yet.

| COMPONENT | STATUS | EVIDENCE | CLIENT ACTION |
|---|---|---|---|
| Railway deployment (6 services) | BLOCKED | no Railway access in this session; `railway/*.json`, `scripts/railway-setup.sh` | Give Railway access or run `scripts/railway-setup.sh` once |
| Docker images api/worker/web/n8n | TESTED | built and run; healthchecks healthy | — |
| Startup migrations + table verification | TESTED | fresh DB → 2 migrations applied on first boot, 16 tables verified before listening | — |
| Web Control Center | TESTED | Playwright run, 0 console errors, all pages | — |
| API | TESTED | smoke 18/18 applicable, E2E 15/15 | — |
| Worker | TESTED | heartbeat, jobs, self-test | — |
| Postgres | TESTED | health ONLINE, backup/restore drill | — |
| Redis / BullMQ | TESTED | queues, retries, restart recovery | — |
| n8n (connect, persistence) | TESTED | auto owner+key, key reused across restarts | — |
| 22 workflows import (inactive, idempotent) | TESTED | 22/22 present, 0 active, no duplicates after 4 restarts | — |
| n8n credential + config delivery | TESTED | credentials created; supervisor restart on change | — |
| Credential encryption / masking | TESTED | DB dump + logs + responses scanned | — |
| Secrets never reach frontend | TESTED | bundle scan clean; no NEXT_PUBLIC vars | — |
| Provider configuration + validation | TESTED | field errors returned; saves encrypted | — |
| Provider tests against real providers | BLOCKED | egress 403 here; Google real error path only | Enter real keys and click Test |
| OAuth (X / Meta / LinkedIn) | NOT TESTED | Meta flow via mock in test mode only | Create the platform apps, click Connect account |
| Readiness engine | TESTED | 22 blocked with reasons → 00 READY after Telegram | — |
| Activation / disable / test run | TESTED | activate-ready 1/21, enable/disable in n8n, real `n8n execute` run | — |
| Execution logs | TESTED | n8n + worker executions visible with errors | — |
| Reports | TESTED | populated after runs | — |
| FFmpeg in worker | TESTED | ffmpeg/ffprobe 6.1.1, self-test MP4 all QA true | Run self-test once on Railway |
| Video jobs (pipeline, retry, cancel) | TESTED | test-mode E2E with mock providers | — |
| Runway adapter (real API) | NOT TESTED | built from @runwayml/sdk; host blocked | Enter Runway key |
| ElevenLabs adapter (real API) | NOT TESTED | built from official SDK; host blocked | Enter key + voice ID |
| Storage (S3) | TESTED | SeaweedFS S3, signed URLs, 403 on tampering | Create Railway Bucket, set S3_* |
| Telegram approval | NOT TESTED | test-mode only (mock Telegram) | Bot token + team chat ID |
| Publishing IG/FB/X/LinkedIn | NOT TESTED | IG/FB via mocks only | Connect accounts; Meta App Review if needed |
| Failure / retry handling | TESTED | injected Runway failure → resume, no re-billing; bounded | — |
| Backup / restore | TESTED | local drill | Enable Railway backups; store the two keys |
| Production smoke test on Railway | BLOCKED | not deployed | Run `scripts/smoke-test.mjs` after deploy |
| Real 30-second Eki video | BLOCKED | no provider access/accounts | Run the procedure in `docs/ACCEPTANCE_TESTS.md` |
| Documentation | TESTED | checklist, deployment, n8n, integrations, video, operations, backup, acceptance | — |

**Remaining client dependency after deployment:** enter/connect real provider accounts and credentials in the Control Center. No application code changes are required.

## 26. Required client credentials

OpenAI (or Groq) API key · Runway API secret · ElevenLabs API key + voice ID · Telegram bot token + team chat ID · Google Cloud service-account JSON + spreadsheet ID (sheet shared with it) · WhatsApp Cloud API token, phone-number ID, app secret, verify token, template names · Resend API key + verified from address · Apify token + actor · Buffer token + profile IDs (if used) · X, Meta, LinkedIn developer apps (client id/secret) for OAuth · Railway account (deployment) · an S3-compatible bucket (Railway Bucket).

## 27. Commits in this pass

`82139ee` api · `1a9bf50` worker · `6909369` web · `8139846` deployment + tooling · docs commit (this report, checklist, docs, evidence).
