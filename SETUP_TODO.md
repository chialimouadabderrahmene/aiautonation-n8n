# Setup checklist — Eki n8n automation

> **Superseded for normal operation.** Configuration is now entered in the AI Automation Control Center (Integrations + Settings) and delivered to n8n automatically; deployment is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the admin workflow in [CLIENT_SETUP_CHECKLIST.md](CLIENT_SETUP_CHECKLIST.md). Do **not** edit n8n environment variables or n8n credentials by hand. This page remains as background/reference for the workflows' behaviour.


Legend: **EXTERNAL DEPENDENCY** = needs an account, approval or decision from you/the client; the repo cannot do it.

## Launch details
- [ ] **Launch date** (`LAUNCH_DATE=YYYY-MM-DD`) — day 1 of the 30-day content calendar. **Decision needed.**
- [x] Timezone: `Africa/Lagos` for every workflow (decided; see docs/env-vars.md)
- [x] Canonical public URL: `https://culinarytales.app` (`APP_DOWNLOAD_LINK`), vendor page `/sell` (`APP_VENDOR_LINK`)

## Google Sheets (16 tabs)
- [ ] Spreadsheet `Eki Launch Database`; import every file in `sheet-templates/` as its own tab (names and headers must match)
- [ ] Fill `Content Calendar` days 1-30 from `content-strategy/30-day-content-calendar.md` (**review the statistics in the captions first — several are unverified claims**)
- [ ] Google OAuth2 credential in n8n (Sheets + Drive scopes); `GOOGLE_SHEETS_ID` set
- [ ] Sharing restricted (contains phone numbers and message text)

## Telegram
- [ ] Bot from @BotFather; token in the `Eki Telegram Bot` n8n credential
- [ ] Team group id in `TELEGRAM_CHAT_ID`
- [ ] Bot webhook registered with a secret token (workflow 02) — `docs/setup-instructions.md` §2

## WhatsApp Cloud API — EXTERNAL DEPENDENCY
- [ ] Verified Meta Business account, registered WhatsApp number, permanent System-User token (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`)
- [ ] App secret in `WHATSAPP_APP_SECRET` (signature verification) and a verify token in `WHATSAPP_VERIFY_TOKEN`
- [ ] Webhook callback `<N8N_WEBHOOK_URL>webhook/whatsapp-webhook`, field `messages`, verified **after** workflow 13 is published
- [ ] **15 message templates created and approved** (`docs/whatsapp-templates.md`); names entered in `WA_TPL_*` (leave empty = step blocked)
- [ ] Legal sign-off on opt-in wording (forms, waitlist, WhatsApp keywords)

## Email (Resend) — EXTERNAL DEPENDENCY
- [ ] Domain verified; `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `TEAM_EMAIL`

## AI
- [ ] One key: `AI_API_KEY` (+ `AI_API_BASE_URL`, `AI_MODEL` if not using the Groq defaults)

## Instagram / ManyChat — EXTERNAL DEPENDENCY
- [ ] ManyChat Pro connected to the Instagram business accounts; External Request → `<N8N_WEBHOOK_URL>webhook/manychat-comment` with header `X-Eki-Webhook-Secret`
- [ ] Optional `WHATSAPP_CTA_LINK` (wa.me link)

## Forms / callers of the webhooks
- [ ] Landing page / Tally / backend call `lead-capture`, `join-waitlist`, `track-referral`, `collect-feedback` with header `X-Eki-Webhook-Secret` (custom headers must be supported by the caller; otherwise put a small server-side relay in front)
- [ ] `FEEDBACK_FORM_URL` (Tally/Typeform), optional `APP_STORE_REVIEW_URL` / `PLAY_STORE_REVIEW_URL`

## Social (all optional, OFF by default)
- [ ] Buffer token + one profile id per platform (`BUFFER_PROFILE_ID_*`) — request shape unverified against live Buffer
- [ ] X/Twitter OAuth2 credential + `TWITTER_POSTING_ENABLED=true`
- [ ] Apify token + `APIFY_TRENDS_ACTOR_ID`
- [ ] `AUTOPILOT_SOCIAL_POSTING=false` until **one full week of human-reviewed output has passed**

## n8n instance (Railway)
- [ ] Image pinned to `docker.n8n.io/n8nio/n8n:2.40.7` (or a version you re-test with `staging/`)
- [ ] `N8N_ENCRYPTION_KEY` generated and backed up outside Railway; Postgres backups on
- [ ] `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `GENERIC_TIMEZONE=Africa/Lagos`, execution-data retention settings (`docs/env-vars.md`)
- [ ] Credentials created with the exact names/ids in `docs/env-vars.md`; workflows imported with the CLI
- [ ] Workflow 00 published; every other workflow lists it as Error Workflow
- [ ] Publish order: 00 → webhooks (02, 03, 04, 07, 08, 13, 17, 18, 21) → schedules (01, 05, 06, 09, 10, 12, 14, 15, 16, 19, 20, 22), each watched on Telegram
