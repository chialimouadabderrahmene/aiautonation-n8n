# Setup instructions — Eki n8n automation

> **Superseded for normal operation.** Configuration is now entered in the AI Automation Control Center (Integrations + Settings) and delivered to n8n automatically; deployment is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the admin workflow in [CLIENT_SETUP_CHECKLIST.md](CLIENT_SETUP_CHECKLIST.md). Do **not** edit n8n environment variables or n8n credentials by hand. This page remains as background/reference for the workflows' behaviour.


End-to-end runbook for a fresh production (or shared staging) deployment. Items marked **EXTERNAL DEPENDENCY** need an account/approval that this repo cannot create. Rehearse everything locally first with [`staging/`](../staging) (see [testing-checklist.md](testing-checklist.md)).

## 0. Prerequisites
Google account · Telegram account · verified Meta Business account with a WhatsApp Business number (EXTERNAL) · Resend account with a verified domain (EXTERNAL) · Groq or OpenAI API key · Railway account (or any host for `docker.n8n.io/n8nio/n8n:2.40.7` + PostgreSQL) · optional: ManyChat Pro, Buffer, Apify.

## 1. Google Sheet
1. Create the spreadsheet **Eki Launch Database**.
2. For every file in [`sheet-templates/`](../sheet-templates) import it as a new tab named exactly like the schema ([schemas/google-sheets-schema.md](../schemas/google-sheets-schema.md)): `Leads, Waitlist, Referrals, Content Calendar, Content Drafts, Feedback, Analytics, Agent Reports, Intelligence, PainPoints, ContentQueue, SocialProof, Social Posts, Automation Logs, WhatsApp Conversations, PublishedContent`.
3. Fill `Content Calendar` days 1-30 from `content-strategy/30-day-content-calendar.md` (review claims/statistics before use).
4. Copy the spreadsheet id from the URL into `GOOGLE_SHEETS_ID`.

## 2. Telegram
1. @BotFather → `/newbot` → token → n8n credential **Eki Telegram Bot**.
2. Add the bot to the team group; send a message; open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the group's `chat.id` (negative number) into `TELEGRAM_CHAT_ID`.
3. After workflow 02 is published, register the bot webhook **with a secret token** so only Telegram can call it:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<N8N_WEBHOOK_URL>webhook/content-approval&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
   and create the n8n credential **Eki Telegram Webhook Secret** (Header Auth, name `X-Telegram-Bot-Api-Secret-Token`, value = that secret).

## 3. WhatsApp Cloud API (EXTERNAL DEPENDENCY)
Follow [WHATSAPP_CLOUD_API_SETUP.md](../WHATSAPP_CLOUD_API_SETUP.md): credentials, webhook (with signature verification), and the **15 message templates** in [whatsapp-templates.md](whatsapp-templates.md). Until templates are approved leave `WA_TPL_*` empty.

## 4. Email (Resend)
Verify your domain; set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `TEAM_EMAIL`.

## 5. AI provider
Set `AI_API_KEY` (and `AI_API_BASE_URL` / `AI_MODEL` unless you use the Groq defaults).

## 6. ManyChat (optional, EXTERNAL DEPENDENCY)
Connect the Instagram business accounts; build the comment automation (keywords `VENDOR`, `SELL`, `INFO`, `JOIN`, `BUY`) with an **External Request** to `<N8N_WEBHOOK_URL>webhook/manychat-comment`, header `X-Eki-Webhook-Secret: <secret>`, body `{"name":"{{first_name}}","username":"{{ig_username}}","keyword":"{{last_input_text}}"}`, and let ManyChat send the response as the DM (workflow 17 answers in ManyChat's v2 dynamic-block format).

## 7. Deploy n8n
Follow [RAILWAY_N8N_DEPLOYMENT.md](../RAILWAY_N8N_DEPLOYMENT.md). Set every variable from [`.env.railway.example`](../.env.railway.example), including `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

## 8. n8n credentials
Create these **with the exact names** (workflow files reference them by id/name — [env-vars.md](env-vars.md#n8n-credentials-created-inside-n8n-not-env-vars)): `Eki Google Sheets`, `Eki Telegram Bot`, `Eki Webhook Shared Secret`, `Eki Telegram Webhook Secret`, and (only if posting to X) `Eki Twitter X OAuth2`.
Preferred: import a credentials file with the CLI so the ids match (`n8n import:credentials --input=credentials.json`; see `staging/credentials.staging.json` for the exact shape — never commit real values). After a UI-only setup, open each workflow and re-select the credential on every node that shows a warning.

## 9. Import workflows (keeps ids, so the Error Workflow link works)
```bash
n8n import:workflow --separate --input=n8n-workflows
```
(Importing through the UI creates new ids: then open each workflow → Settings → **Error Workflow** and select "Eki - 00 Global Error Handler".)

## 10. Publish in this order — watching Telegram after each step
1. **00 Global Error Handler** (must be active for n8n to call it).
2. Webhook workflows: 02, 03, 04, 07, 08, 13, 17, 18, 21. Register the Telegram and Meta webhooks only after their workflow is active. Point your landing page / forms / backend at the production URLs with the `X-Eki-Webhook-Secret` header.
3. Scheduled workflows: 14, 09, 22, 01, 05, 06, 19, 10, 12, 15, 16, 20. Each also has a **Manual Run** trigger for on-demand runs from the editor.
4. Keep `AUTOPILOT_SOCIAL_POSTING=false`.

## 11. Smoke test (real accounts, dedicated test data)
See [testing-checklist.md](testing-checklist.md) §3. Use your own phone number and a `.test` email; delete the test rows afterwards. Expect: lead appears in `Leads`, Telegram shows the alert, and a WhatsApp **template** arrives only when the template is approved and `consent:true` was sent.

## 12. Operations
- Daily: read the 08:00 controller report on Telegram (config health, opted-in/unsubscribed counts, missing templates).
- Watch for `n8n workflow error` alerts (workflow 00) — they contain workflow, node and message only.
- Kill switch: `AUTOPILOT_STOP=true` (restart n8n) halts social generation/posting (10, 12) — customer WhatsApp sequences are governed by their templates and opt-out state, not by this switch: to stop them, unpublish 05/06/19.
- Backups: Railway Postgres backups + an export of the workflows (`n8n export:workflow --backup --output=backup/`); keep `N8N_ENCRYPTION_KEY` in a vault.
