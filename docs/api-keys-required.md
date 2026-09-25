# API keys and credentials — Eki n8n automation

Where each secret lives: **n8n credentials vault** (created in the n8n UI, referenced by name/id in the workflow files) or **Railway environment variables** (read with `$env`). Never commit real values. Full variable list: [env-vars.md](env-vars.md).

## 1. Required for the core system
| Service | Purpose | Kind | Where to get it |
|---|---|---|---|
| Google Sheets OAuth2 | database (all tabs) | n8n credential `Eki Google Sheets` | Google Cloud Console (enable Sheets + Drive APIs; OAuth client; redirect `<n8n url>/rest/oauth2-credential/callback`) |
| Telegram bot | approvals, alerts, error workflow | n8n credential `Eki Telegram Bot` + `TELEGRAM_CHAT_ID` | @BotFather; chat id from `getUpdates` |
| AI provider | content, analysis | `AI_API_KEY` (+ `AI_API_BASE_URL`, `AI_MODEL`) | Groq console (default) or OpenAI |
| Shared webhook secret | authenticates callers of 03, 04, 07, 08, 17, 18, 21 | n8n credential `Eki Webhook Shared Secret` (Header Auth `X-Eki-Webhook-Secret`) | generate: `openssl rand -hex 32` |
| Telegram webhook secret | authenticates Telegram → workflow 02 | n8n credential `Eki Telegram Webhook Secret` (Header Auth `X-Telegram-Bot-Api-Secret-Token`) | generate; pass the same value as `secret_token` to `setWebhook` |
| `N8N_ENCRYPTION_KEY` | encrypts the credentials vault | Railway variable | `openssl rand -hex 32`; **back it up** — losing it makes every credential unreadable |

## 2. WhatsApp (EXTERNAL DEPENDENCY)
| Item | Variable | Where |
|---|---|---|
| Permanent access token | `WHATSAPP_ACCESS_TOKEN` | Meta Business Settings → System users → generate token (`whatsapp_business_messaging`, `whatsapp_business_management`) |
| Phone number id | `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup |
| App secret | `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic (used to verify `X-Hub-Signature-256`) |
| Verify token | `WHATSAPP_VERIFY_TOKEN` | any random string; same value in Meta webhook config |
| Approved templates | `WA_TPL_*` | WhatsApp Manager → Message templates ([whatsapp-templates.md](whatsapp-templates.md)) |

## 3. Email (Resend) — EXTERNAL DEPENDENCY
`RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified domain), `TEAM_EMAIL`.

## 4. Optional integrations (all off by default)
| Service | Variables / credential | Notes |
|---|---|---|
| ManyChat (Pro) | none in n8n — ManyChat calls workflow 17 with the shared-secret header and receives the reply message | no ManyChat API key needed |
| Buffer | `BUFFER_API_KEY`, `BUFFER_PROFILE_ID_<PLATFORM>` | request shape not verified against the live API |
| X / Twitter | n8n OAuth2 credential `Eki Twitter X OAuth2`, `TWITTER_POSTING_ENABLED=true` | needs a developer app with write access |
| Apify | `APIFY_TOKEN`, `APIFY_TRENDS_ACTOR_ID`, `APIFY_TRENDS_INPUT_JSON` | check the terms of the platforms you scrape |
| Feedback form | `FEEDBACK_FORM_URL` | Tally/Typeform/Google Forms |

## Security practice
- Keep secrets in the vault / Railway variables only; rotate quarterly and after any staff change.
- The WhatsApp token must be a **permanent** System-User token (temporary ones expire in 24 h).
- Restrict who can open the n8n editor: any editor can read `$env` (that is why `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is a deliberate trade-off).
- Execution data contains phone numbers and message text: production keeps failed executions only and prunes after 14 days.
