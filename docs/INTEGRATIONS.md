# Integrations

All configured in the Control Center → Integrations. Definitions:
`api/src/modules/providers/definitions.ts`.

| Provider | Auth | What the test really calls | Used by |
|---|---|---|---|
| OpenAI | API key | `GET /v1/models` (+ checks the chosen model is available) | video scripts; n8n AI steps when selected |
| Groq | API key | `GET /openai/v1/models` | n8n AI steps (default), video scripts fallback |
| n8n | automatic | `GET /api/v1/workflows` | all 22 workflows |
| Google Sheets | service-account JSON | OAuth JWT grant + `GET spreadsheets/{id}` | workflow database (pushed into n8n) |
| Inbound webhook security | generated | secret present & ≥ 24 chars | header auth on webhook workflows |
| Telegram | bot token + chat id | `getMe` + `getChat` (bot must be in the chat) | alerts, content approval, video approval |
| WhatsApp Cloud API | token + ids + template names | `GET /{phone-number-id}` | lead funnel and sequences |
| Resend | API key + from address | `GET /domains` + from-domain verified | email, weekly reports |
| Buffer | access token | `GET /1/user.json` | workflows 10/12/14 |
| X | **OAuth 2.0 + PKCE** | `GET /2/users/me` | workflow 10 (pushed as n8n credential), video publishing |
| Meta | **Facebook Login** | `GET /{page}?fields=name,instagram_business_account` | Instagram Reels + Facebook Page publishing |
| LinkedIn | **OAuth 2.0** | `GET /v2/userinfo` | video publishing |
| Apify | API token + actor | `GET /v2/users/me` | workflow 15 |
| Runway | API secret + model | `GET /v1/organization` (reports credit balance) | video scenes |
| ElevenLabs | API key + voice id | `GET /v1/voices/{id}` + subscription | voiceover |

Statuses: NOT_CONFIGURED → (save) CONFIGURED → (test) CONNECTED | TEST_FAILED;
ACTION_REQUIRED when stored credentials can't be decrypted, an OAuth refresh
fails, or automatic n8n connection needs help. A save never sets CONNECTED.

## Adding a provider

Add one object to `PROVIDERS` in `definitions.ts` (fields, `testConnection`,
optionally `oauth`). The Integrations page, validation, encryption, masking,
readiness (`"<key>"` in a workflow's requirements) and audit all work without
further changes. If n8n needs it, add a `MANAGED_CREDENTIALS` entry
(`modules/n8n/credentials.ts`) and/or map it in `modules/n8n/runtimeEnv.ts`.

## OAuth apps (client side, once per platform)

The redirect URL to register is shown on each OAuth card:
`https://<web domain>/api/oauth/callback/<provider>`.

- **X**: developer portal → project app → User authentication settings: OAuth
  2.0, type *Web App / confidential client*, scopes are requested by the
  Control Center (`tweet.read tweet.write users.read media.write offline.access`).
- **Meta**: app with *Facebook Login for Business*; permissions
  `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic,
  instagram_content_publish, business_management`. Publishing to accounts other
  than the app's admins requires Meta App Review.
- **LinkedIn**: app with *Sign In with LinkedIn using OpenID Connect* and *Share
  on LinkedIn* products (`openid profile w_member_social`). Organization pages
  need `w_organization_social` (LinkedIn partner approval).

## Verification status

Provider hosts were unreachable from the build sandbox (egress policy), so no
provider accepted a real credential during this pass. Google Sheets was the
exception: its real endpoints answered (`invalid_grant: account not found` for
an unregistered key → TEST FAILED, as expected). All adapters follow the
providers' documented APIs; Runway and ElevenLabs shapes were taken from their
official SDKs (`@runwayml/sdk` 4.20, `@elevenlabs/elevenlabs-js` 2.69).
