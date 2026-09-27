# Integrations

## Adding a provider

Everything about a provider — its category, its credential fields, and what
"test connection" actually does — lives in one place:
`api/src/modules/providers/registry.ts`. Adding a provider means adding one
entry to the `PROVIDERS` array; nothing else in the codebase hardcodes a
provider name. The UI (Integrations screen) and the readiness engine both
read this registry, so a new provider automatically gets a config form and
becomes usable in `WORKFLOW_MANIFEST` requirements.

## Credential security

- Every secret field is AES-256-GCM encrypted (`api/src/lib/crypto.ts`) with
  a key derived from `AUTOMATION_SECRET_KEY` — an env var, never committed,
  never logged.
- The API never returns a decrypted secret. `GET /api/integrations` returns
  `maskedPreview` only (e.g. `sk-b••••••••real`). Plaintext exists in memory
  only for the duration of a save or a test-connection call.
- `pino-http` request logging redacts `Authorization` headers and
  `req.body.secrets`/`req.body.password` explicitly (`api/src/app.ts`).
- Saving credentials never marks a provider "Connected" — only a real,
  successful `POST /api/integrations/:provider/test` does (see status
  vocabulary below).

## Status vocabulary

| Status | Meaning |
|---|---|
| `NOT_CONFIGURED` | No credentials saved yet |
| `CONFIGURED` | Credentials saved, never successfully tested (or changed since the last test) |
| `TEST_FAILED` | The most recent test call failed — `lastTestMessage` has the real provider error |
| `CONNECTED` | The most recent test call succeeded |
| `ACTION_REQUIRED` | Reserved for provider-specific manual steps (not currently set by any provider in this pass; workflows use it for `setting:*` requirements — see below) |

## Providers implemented (13)

AI: OpenAI, Groq. Orchestration: n8n, Google Sheets (service-account key, not
n8n's own OAuth2 — see `ARCHITECTURE.md` "Credentials"). Messaging: Telegram,
WhatsApp Cloud API. Email: Resend. Social: Buffer, X, Meta. Research: Apify.
Media: Runway, ElevenLabs.

Every `testConnection` makes a real, read-only, lightweight call to the
provider (listed per-provider in `registry.ts`) — never a fake success.
Two are explicitly flagged with a `caveat` shown in the UI because they
could not be verified against a real account in this pass:

- **Buffer** — its legacy `bufferapp.com/1` API is what the existing n8n
  workflows already target; whether it still issues tokens to new
  integrations is unconfirmed (the existing `BUFFER_SETUP.md` says the same).
- **Runway** — the test call and the video-generation adapter both target
  Runway's documented async-task API shape; confirm against
  `https://docs.dev.runwayml.com` before relying on it, since no real Runway
  account was available to verify against.

## Requirements no API can check

Some workflow dependencies aren't verifiable by calling an API — "have these
15 WhatsApp templates actually been approved by Meta?" is a human judgment.
Those are modelled as boolean `Setting` rows (`Settings` screen), referenced
in the manifest as `setting:whatsappTemplatesApproved` etc. A workflow
blocked only on one of these shows `ACTION_REQUIRED` rather than `BLOCKED` —
it's a "go confirm this is real," not "something is broken."

## Workflow → provider mapping

`api/src/modules/workflows/manifest.ts` — sourced directly from this
project's own `docs/env-vars.md` (which env var each of the 22 workflows
reads), not invented. If a workflow's actual dependencies change, update
both files.
