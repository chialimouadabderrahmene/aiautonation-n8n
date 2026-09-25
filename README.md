# Eki Launch Automation (n8n)

Eki is a digital marketplace connecting African foodstuff vendors with buyers worldwide (public site / app: `https://culinarytales.app`). This repository is the **n8n acquisition and lead-nurture automation** around it: content generation with human approval, lead capture, WhatsApp funnels (template-compliant), waitlist/referrals, feedback, reporting and social-post preparation.

> **Status:** all 22 workflow files import and execute in a **local staging n8n 2.40.7 against a mock of every external provider** (see [docs/staging-test-report.md](docs/staging-test-report.md)). That proves the logic, wiring, security checks and failure handling. It does **not** prove that Meta, Google, Resend, Telegram, Buffer/X, Apify or ManyChat accept the requests — those need real accounts. The go-live gates are in [docs/production-readiness-report.md](docs/production-readiness-report.md). **Do not call this production-ready until they are closed.**
>
> The Eki app itself (backend, mobile, admin) lives in sibling folders and has its own automations (push / in-app lifecycle messages) documented in [docs/business-flows.md](docs/business-flows.md) §B; it does not use n8n.

## Repository layout

```
n8n-workflows/        22 importable workflows: 00 global error handler + 01-10, 12-22 (there is NO workflow 11)
schemas/              google-sheets-schema.md (16 tabs) + sheet-columns.json (machine-readable) + legacy Airtable note
sheet-templates/      header-only CSVs for every tab (import into the Google Sheet)
docs/                 setup, env vars, WhatsApp templates, business flows, testing, staging report, readiness report
staging/              local staging stack: docker-compose (n8n 2.40.7 + provider mock), test harness and 9 test suites
tools/                validate-workflows.js (static checks), node catalog builder, sheet-template generator
content-strategy/     launch copy: 30-day calendar, pillars, announcement sequence, email copy drafts (not wired to workflows)
.env.railway.example  every environment variable the workflows read
```

## Quick start — staging (needs Docker + Node 20+)

```bash
bash staging/scripts/up.sh                 # fresh n8n + mock, imports credentials and all 22 workflows
node staging/run-tests.js                  # suites t1-t4 (workflows 00-22)
bash staging/scripts/stage.sh posting-on && node staging/run-tests.js t5   # guarded social-posting branch
bash staging/scripts/stage.sh stop-on    && node staging/run-tests.js t6   # AUTOPILOT_STOP kill switch
bash staging/scripts/stage.sh default    && node staging/run-tests.js t9   # real schedule triggers + activation
node tools/validate-workflows.js           # static validation (no Docker needed)
```
Staging uses only dummy data (`staging/staging.env`, `.invalid` emails, fictional +1-555-01xx numbers). Nothing reaches the internet.

## Quick start — production
1. Follow [docs/setup-instructions.md](docs/setup-instructions.md) (Google Sheet from `sheet-templates/`, Telegram bot, Meta WhatsApp, Resend, AI key, Railway).
2. Fill the variables in [.env.railway.example](.env.railway.example) — reference: [docs/env-vars.md](docs/env-vars.md).
3. Create the WhatsApp templates ([docs/whatsapp-templates.md](docs/whatsapp-templates.md)) — until they are approved, leave `WA_TPL_*` empty: nothing is sent to cold leads.
4. Import with the CLI so workflow/credential ids are preserved: `n8n import:credentials …` then `n8n import:workflow --separate --input=n8n-workflows`.
5. Publish **00 (error handler) first**, then the webhook workflows, then the scheduled ones — one at a time, watching Telegram. Keep `AUTOPILOT_SOCIAL_POSTING=false` until a full week of human-reviewed output has passed.

## Documentation
- [Setup instructions](docs/setup-instructions.md) · [API keys & credentials](docs/api-keys-required.md) · [Environment variables](docs/env-vars.md)
- [Railway deployment](RAILWAY_N8N_DEPLOYMENT.md) · [WhatsApp Cloud API setup](WHATSAPP_CLOUD_API_SETUP.md) · [WhatsApp templates](docs/whatsapp-templates.md) · [WhatsApp funnel](WHATSAPP_FUNNEL_SETUP.md) · [WhatsApp test payloads](WHATSAPP_TEST_PAYLOADS.md)
- [Business flows (trigger → outcome)](docs/business-flows.md) · [Workflow diagrams](docs/workflow-diagram.md)
- [Testing checklist](docs/testing-checklist.md) · [Staging test report](docs/staging-test-report.md) · [Production readiness report](docs/production-readiness-report.md)
- [Autopilot controller](AUTOPILOT_CONTROLLER_GUIDE.md) · [Autopilot testing](AUTOPILOT_TESTING_GUIDE.md) · [Social autopilot rollout](SOCIAL_AUTOPILOT_TESTING.md) · [Buffer setup](BUFFER_SETUP.md) · [Sheets template](GOOGLE_SHEETS_TEMPLATE.md)
- [Handover document](docs/handover-document.md) · [Setup checklist](SETUP_TODO.md)

## Technology
n8n 2.40.7 (pinned) · Google Sheets (data) · one OpenAI-compatible AI endpoint (Groq default, OpenAI supported via `AI_API_BASE_URL`) · WhatsApp Cloud API (templates + session replies) · Resend (email) · Telegram (approvals, alerts, error workflow) · ManyChat (Instagram comment → DM reply) · Buffer / X API (optional, off by default) · Apify (optional trend data).
