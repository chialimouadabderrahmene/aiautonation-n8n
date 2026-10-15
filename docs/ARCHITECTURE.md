# Architecture

Standalone system inside this repository only — it shares no code, database or
deployment with the Eki marketplace backend, mobile app or admin web.

```
browser ──https──► web (Next.js, public)
                    └─ /api/* proxy (request time) ─► api (Express, private)
Telegram ─► web /api/telegram/webhook ─┘                │
OAuth providers ─► web /api/oauth/callback/* ─┘         ├─ Postgres (public schema)
                                                        ├─ Redis / BullMQ ─► worker (FFmpeg)
                                                        └─ S3 bucket (media)
                                                                                   └─ S3, providers
```

## Services

| Service | Code | Responsibilities |
|---|---|---|
| web | `web/` | UI (9 sections + login), same-origin proxy to the API. Holds no secrets; no `NEXT_PUBLIC_*` variables. |
| api | `api/` | Auth, encrypted vault, provider registry + tests, OAuth, native readiness/workflow state, Telegram webhook router, video/carousel/approval/publishing orchestration, health, audit. |
| worker | `worker/` | Video generation (script → voice → Runway → FFmpeg → QA → storage), Telegram approval upload, publishing. Heartbeat with capabilities. |

## Key design decisions

- **Single source of configuration: the Control Center.** Credentials live
  encrypted in the Control Center and are consumed directly by native API and
  worker adapters. No external orchestration service is required.
- **Data-driven providers.** `api/src/modules/providers/definitions.ts` declares
  every provider's fields (type, secret, validation, group), auth type, test,
  and OAuth flow; the UI renders forms from it.
- **Readiness is computed, never asserted.** `modules/workflows/readiness.ts`
  checks tested providers, settings, confirmations, worker FFmpeg and storage.
  Activation always recalculates first.
- **Asynchronous, resumable video jobs.** HTTP returns immediately; BullMQ
  carries the job; every stage is checkpointed in Postgres so retries resume.
- **Private by default.** Only web is public; the API has no external runtime
  orchestrator and its optional internal listener is not exposed by the proxy.

## Security model

| Concern | Implementation |
|---|---|
| Secrets at rest | AES-256-GCM per field, key from `AUTOMATION_SECRET_KEY` (scrypt-derived), unique IV, auth tag |
| Secrets in responses | Only masked previews (`sk-a••••1234`). The single exception: a *generated* webhook secret is returned once when the admin rotates it |
| OAuth tokens | Exchanged server-side, stored encrypted, refreshed server-side, never sent to the browser |
| Logs | pino with redaction of credential-bearing keys; request logs have no query strings or bodies; provider error texts pass through `scrubSecrets` |
| Admin auth | bcrypt (12 rounds), JWT 12 h, failed-login rate limit (10 / 15 min) |
| Webhooks | Telegram: `secret_token` header compared in constant time, callbacks accepted only from the configured team chat; OAuth: single-use expiring state (+PKCE for X); media: HMAC-signed expiring links or S3 presigned URLs |
| Internal API | separate port + `INTERNAL_API_TOKEN` |
| Headers | helmet on the API; X-Frame-Options DENY, nosniff, HSTS, referrer and permissions policies on the web app |
| Test mode | provider redirection requires two explicit env vars and shows a red banner on the Dashboard |

## Data model (Prisma, `api/prisma/schema.prisma`)

AdminUser · Integration (+ authType, connected account, token expiry) ·
EncryptedCredential · WorkflowConfig (native readiness, active state, trigger
kind, last test run) ·
AutomationExecution (unique per source+external id) · VideoProject (+ music,
publish targets) · VideoJob (+ progress) · VideoScene (+ voice key/duration) ·
VideoAsset (+ mime, dimensions, metadata) · Approval (+ rejection reason) ·
Publication · MediaFile · OAuthState · ServiceHeartbeat · Setting · AuditLog.
`worker/prisma/schema.prisma` is an identical copy (a unit test enforces it);
migrations are owned by `api/`.
