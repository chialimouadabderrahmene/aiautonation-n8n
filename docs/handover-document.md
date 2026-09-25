# Handover — Eki n8n launch automation

## 1. What this is
An **n8n 2.40.7** automation (22 workflow files) around the Eki marketplace launch: AI-assisted content with human approval, lead capture, template-compliant WhatsApp funnels, waitlist and referrals, feedback, reporting, and optional social posting. Data lives in Google Sheets. It is separate from the Eki app's own in-app lifecycle automations (push/in-app, run by the backend) — see [business-flows.md](business-flows.md).

**Readiness:** verified in a local staging n8n against mocked providers; **not** verified against real Meta/Google/Resend/Buffer/X/Apify/ManyChat accounts. Gates and limitations: [production-readiness-report.md](production-readiness-report.md).

## 2. Inventory
| # | Workflow | Trigger |
|---|---|---|
| 00 | Global Error Handler | any workflow error (must be active) |
| 01 | AI Content Generation | daily 09:00 |
| 02 | Content Approval Handler | Telegram webhook (secret token) |
| 03 | Lead Capture | POST `lead-capture` |
| 04 | Waitlist Management | POST `join-waitlist` |
| 05 | WhatsApp Welcome Sequence | daily 09:00 |
| 06 | WhatsApp Engagement Follow-up | daily 10:00 |
| 07 | Referral Campaign Tracker | POST `track-referral` |
| 08 | Feedback Collection & Routing | daily 11:00 + POST `collect-feedback` |
| 09 | Weekly Analytics Report | Mondays 09:00 |
| 10 | Social Post Scheduler | every 2 h, 10:00-20:00 |
| 12 | AI Social Autopilot | daily 09:00 |
| 13 | WhatsApp Lead Funnel | Meta webhook (HMAC) |
| 14 | Autopilot Controller (report + kill-switch alert) | daily 08:00 |
| 15 | Viral Intelligence Engine | every 6 h |
| 16 | Pain Discovery Engine | daily 06:00 |
| 17 | ManyChat Comment Funnel | POST `manychat-comment` |
| 18 | Content Multiplication Engine | POST `content-multiply` |
| 19 | WhatsApp Nurture Sequences | daily 08:00 |
| 20 | A/B Testing Engine | every 72 h |
| 21 | Social Proof Engine | POST `social-proof` |
| 22 | Performance Analyst Agent | Mondays 09:30 |

There is **no workflow 11**: the numbering skips it (earlier docs said 22 workflows; 21 existed; the 22nd file is the new error handler, numbered 00 to avoid pretending an 11th existed). All times are Africa/Lagos.

Other assets: `content-strategy/` (launch copy; **contains unverified statistics — review before publishing**), `schemas/` + `sheet-templates/`, `staging/` (test stack), `tools/` (validator, generators).

## 3. Behaviour changes made during the production audit (know these before comparing with older notes)
- Invalid node types (`cronTrigger`, `webhookTrigger`, `openAi@2`, `telegram@2`), malformed nodes and wrong Google-Sheets parameter shapes fixed — the original files could not import/run.
- Email nodes that had been corrupted by a search-and-replace (email payloads posted to non-existent WhatsApp and Telegram "email" endpoints) restored to Resend.
- **WhatsApp compliance:** business-initiated messages are now approved templates only (previously free-form text to cold leads, forbidden by Meta outside 24 h); missing template = blocked + alert.
- **Opt-out** persisted on the lead row and honoured by every sender (previously STOP appended a second row and old rows stayed eligible).
- **Webhook security:** WhatsApp HMAC verification; shared-secret header on every other webhook; Telegram secret token + chat allow-list on 02.
- **No duplicate sends:** bulk senders loop one lead at a time (n8n retry re-runs the whole node).
- Overlapping workflows deconflicted: 14 no longer posts or messages customers (10/12 own posting; 05/06/13/19 own WhatsApp); 05/19 use distinct statuses (`new` vs `lead_captured`).
- Wrong brand copy (Eki described as an AI/business-automation product instead of an African foodstuff marketplace) replaced everywhere; invented testimonials/stats and non-existent URLs removed from messages; all links come from `APP_DOWNLOAD_LINK` / `APP_VENDOR_LINK`.
- One AI configuration (`AI_API_KEY`/`AI_API_BASE_URL`/`AI_MODEL`, Groq default, OpenAI supported); one timezone (Africa/Lagos).
- Removed unverifiable integrations (Metricool, Meta Graph feed and TikTok posting from workflow 14; a call to n8n's internal REST API in 22; a call to a non-existent `request-review` webhook in 08).
- Removed promises the system cannot honour (promo code `EKIFEEDBACK`, "premium status"): feedback rewards are now `FEEDBACK_REWARD_TEXT`, empty by default.

## 4. Operations
See [setup-instructions.md](setup-instructions.md) §10-12 and [RAILWAY_N8N_DEPLOYMENT.md](../RAILWAY_N8N_DEPLOYMENT.md). Daily: read the 08:00 controller report and any `n8n workflow error` alert. Weekly: failed executions, Resend/Meta quality dashboards. Monthly: workflow export + backup restore test. Upgrade n8n only after re-running `staging/` on the new tag.

## 5. Recommendations (not done)
1. Move the lead store from Sheets to PostgreSQL (rate limits, concurrent writes).
2. Wire the Eki backend to `track-referral`, `social-proof` and `lead-capture` (sign-ups) so those flows are event-driven.
3. Add an executions-based alert for "no workflow ran today" (dead-man switch).
4. Move the JS task runner to external mode (n8n logs a deprecation for internal mode) before n8n removes it.
5. Legal review of consent wording and the retention of `WhatsApp Conversations`.
