# Architecture

The Eki AI Automation Control Center is a **standalone product**, entirely
inside `ai automation italy/`. It shares no code, database, authentication,
or deployment with the Eki marketplace (`ekiapp-backend-main`,
`ekiapp-frontnend-application-ios-android-main`).

```
                    WEB CONTROL CENTER (web/, Next.js)
                           |  Bearer JWT, browser never sees provider secrets
                           v
                  AUTOMATION API (api/, Express)
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
           n8n         AI PROVIDERS   VIDEO WORKER (worker/, BullMQ)
     (separate deploy)  (OpenAI/Groq)         |
                                      +-------+-------+
                                      |               |
                                   Runway        ElevenLabs
                                      |
                                    FFmpeg
                                      |
                                 Final MP4
                                   |
                                   v
                            Telegram Approval
                                   |
                                   v
                              Publishing (n8n)
```

## Services

| Service | Tech | Deploy target | Talks to |
|---|---|---|---|
| `web/` | Next.js 14 (App Router), TypeScript, Tailwind | Static/Node hosting (Vercel, Railway, ...) | `api/` only, over HTTPS, with a JWT |
| `api/` | Express, TypeScript, Prisma | Railway / any Node host | Postgres, Redis (enqueue only), n8n's REST API, every provider's API (for connection tests) |
| `worker/` | BullMQ consumer, TypeScript, ffmpeg | Railway / any Node host with ffmpeg installed | Same Postgres (own generated Prisma client — see below), Redis, OpenAI/Groq, Runway, ElevenLabs |
| n8n | n8n (official image) | Railway (see `N8N_SETUP.md`) | Google Sheets, Telegram, WhatsApp, Resend, Buffer, X, Apify — the 22 existing workflows |

## Why a separate worker

`api/` handles HTTP requests and must respond quickly. Video generation is
minutes of provider polling plus real FFmpeg encoding — running that inside
an HTTP request handler would mean a request that never returns, no way to
show progress, and no recovery if the process restarts mid-job. `worker/` is
a long-running BullMQ consumer instead: `api/` only ever *enqueues* a job
(`POST /api/video/projects` → one row in Postgres + one BullMQ job) and reads
its state back from Postgres; `worker/` does the actual work and writes
progress back to the same rows.

## Two Prisma clients, one database

`api/prisma/schema.prisma` and `worker/prisma/schema.prisma` are byte-for-byte
identical (each file says so). This exists only so each service — deployed
independently, in its own container — can generate its own `@prisma/client`
without a cross-package build dependency. **Only `api/` owns migrations**
(`npm run prisma:migrate:deploy`); the worker's copy is `prisma generate`
only, never `migrate`. If you change the schema, edit both files identically.

## Credentials: two homes, by design

- **Provider credentials the Control Center itself calls** (OpenAI, Groq,
  Runway, ElevenLabs, Telegram send, Resend, Buffer, X, Meta, Apify,
  Google Sheets service-account) live in the Control Center's own encrypted
  `Integration`/`EncryptedCredential` tables (AES-256-GCM, see
  `INTEGRATIONS.md`).
- **Credentials the n8n workflows themselves use** (their Google Sheets
  OAuth2, their Telegram bot, WhatsApp, ...) live in **n8n's own credential
  vault** (`N8N_ENCRYPTION_KEY`), configured through the n8n UI, exactly as
  `ai automation italy/docs/api-keys-required.md` already documented before
  this project existed. The Control Center never reads or writes n8n's
  credential store directly — it only calls n8n's workflow-management REST
  API (activate/deactivate/execute), authenticated with a separate n8n API
  key that *is* stored in the Control Center's vault (provider `n8n`).

This split exists because the two credential sets are consumed by two
different runtimes that don't share a process or a database — duplicating
"the Google Sheets key" into the Control Center's vault would not make n8n's
workflows use it.

## Readiness engine

`api/src/modules/workflows/manifest.ts` declares, per existing n8n workflow,
which providers/settings it needs (sourced from this repo's own
`docs/env-vars.md`, not invented). `api/src/modules/workflows/readiness.ts`
evaluates that against live `Integration.status` rows (and a few
`Setting` booleans for things no API can verify, like "Meta approved these
WhatsApp templates"). Nothing is ever marked READY by writing to the
database directly — only by a real `POST /api/integrations/:provider/test`
that actually called the provider.

## Storage

Generated assets (voiceover, scene clips, final MP4) go through a one-method
`StorageProvider` interface (`worker/src/lib/storage.ts`). It ships with a
local-disk implementation only — no S3/R2 credentials exist yet. Swapping in
object storage later is a one-file change; nothing else references the
filesystem directly.
