# Staging test report

Generated 2026-09-25 by `node tools/make-report.js` from the results of `staging/run-tests.js` (**137/137 checks passed**, 0 failed).

## What "staging" means here — read this before trusting a PASS

- **Real:** n8n 2.40.7 (the pinned production image) running in Docker; the real workflow JSON files; real webhook HTTP calls; the real Manual/Schedule triggers; the real Code-node runtime (task runner); real node retry/error behaviour; the real Google Sheets, Telegram, HTTP Request, Crypto and Loop nodes.
- **Mocked:** every external provider (Meta Graph, Google Sheets/OAuth, Telegram, Resend, Groq/OpenAI, Apify, Reddit, Buffer, X). n8n's outbound traffic is forced through `staging/mock/server.js`. The mock enforces Meta's 24-hour free-form rule (error 131047), template well-formedness, provider authentication, Google Sheet tabs/columns, and supports fault injection. **It is not Meta/Google.** Real-provider acceptance (template approval, OAuth, delivery, Buffer/X request formats, ManyChat reply format, Resend domain) is **not** covered.
- **Data:** QA/dummy only (fictional +1-555-01xx numbers, `.invalid` emails). No production customer data.
- **Trigger evidence:** scheduled workflows run through their Manual Run trigger (`n8n execute`); suite t9 separately proves the real Schedule Triggers fire in production mode using every-minute copies and that all 22 real workflows publish. Error-workflow alerting is verified in production (webhook/trigger) mode; `n8n execute` does not reliably call the error workflow.

## Test matrix

Cell = result of the checks for that column (`PASS n/m`, `—` = no check in that column). *Trigger*: webhook workflows = authenticated production webhook calls; scheduled = real Schedule Trigger firing (t9). *Overall* = every check of the workflow passed.

| Workflow | Import | Trigger | Execution | Output | Error handling | Overall |
|---|---|---|---|---|---|---|
| **00** 00 Global Error Handler | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | — | **PASS** (2/2) |
| **01** 01 AI Content Generation | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 3/3 | **PASS** (7/7) |
| **02** 02 Content Approval Handler | PASS 1/1 | PASS 3/3 | PASS 3/3 | — | PASS 2/2 | **PASS** (8/8) |
| **03** 03 Lead Capture Webhook | PASS 1/1 | PASS 3/3 | PASS 2/2 | PASS 2/2 | PASS 2/2 | **PASS** (9/9) |
| **04** 04 Waitlist Management | PASS 1/1 | PASS 3/3 | PASS 2/2 | PASS 1/1 | PASS 1/1 | **PASS** (7/7) |
| **05** 05 WhatsApp Welcome Sequence | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 3/3 | **PASS** (7/7) |
| **06** 06 WhatsApp Engagement Follow-up | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | **PASS** (4/4) |
| **07** 07 Referral Campaign Tracker | PASS 1/1 | PASS 2/2 | PASS 2/2 | PASS 3/3 | — | **PASS** (7/7) |
| **08** 08 Feedback Collection & Routing | PASS 1/1 | PASS 3/3 | PASS 4/4 | PASS 2/2 | PASS 1/1 | **PASS** (10/10) |
| **09** 09 Weekly Analytics Report | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | PASS 1/1 | **PASS** (4/4) |
| **10** 10 Social Post Scheduler | PASS 1/1 | PASS 1/1 (+security PASS 1/1) | PASS 3/3 | PASS 2/2 | PASS 1/1 | **PASS** (9/9) |
| **12** 12 AI Social Autopilot | PASS 1/1 | PASS 1/1 (+security PASS 1/1) | PASS 3/3 | — | PASS 2/2 | **PASS** (8/8) |
| **13** 13 WhatsApp Lead Funnel | PASS 1/1 | PASS 8/8 | PASS 5/5 | PASS 1/1 | PASS 1/1 | **PASS** (15/15) |
| **14** 14 Autopilot Controller | PASS 1/1 | PASS 1/1 (+security PASS 1/1) | PASS 1/1 | PASS 1/1 | — | **PASS** (5/5) |
| **15** 15 Viral Intelligence Engine | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | PASS 1/1 | **PASS** (4/4) |
| **16** 16 Pain Discovery Engine | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | PASS 1/1 | **PASS** (4/4) |
| **17** 17 ManyChat Comment Funnel | PASS 1/1 | PASS 2/2 | PASS 1/1 | PASS 2/2 | — | **PASS** (5/5) |
| **18** 18 Content Multiplication Engine | PASS 1/1 | PASS 2/2 | PASS 2/2 | — | PASS 1/1 | **PASS** (5/5) |
| **19** 19 WhatsApp Nurture Sequences | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | **PASS** (4/4) |
| **20** 20 A/B Testing Engine | PASS 1/1 | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | **PASS** (4/4) |
| **21** 21 Social Proof Engine | PASS 1/1 | PASS 2/2 | PASS 2/2 | — | — | **PASS** (4/4) |
| **22** 22 Performance Analyst Agent | PASS 1/1 | PASS 1/1 | PASS 1/1 | — | — | **PASS** (3/3) |
| **ALL** cross-cutting | PASS 2/2 | — | — | — | — | **PASS** |

## Summary

- Workflow files: 22 (00 error handler + 21 original workflows; **there is no workflow 11**).
- Import PASS: 22/22
- Execution PASS (every check of the workflow passed): 22/22
- Total checks: 137, failed: 0

## Every check

| Wf | Area | Check | Result | Detail |
|---|---|---|---|---|
| ALL | Import | static validator: 0 errors across all workflow files, docs and env documentation | PASS |  |
| 00 | Import | imports into n8n 2.40.7 and round-trips intact (4 nodes): 00 Global Error Handler | PASS |  |
| 01 | Import | imports into n8n 2.40.7 and round-trips intact (10 nodes): 01 AI Content Generation | PASS |  |
| 02 | Import | imports into n8n 2.40.7 and round-trips intact (15 nodes): 02 Content Approval Handler | PASS |  |
| 03 | Import | imports into n8n 2.40.7 and round-trips intact (14 nodes): 03 Lead Capture Webhook | PASS |  |
| 04 | Import | imports into n8n 2.40.7 and round-trips intact (16 nodes): 04 Waitlist Management | PASS |  |
| 05 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 05 WhatsApp Welcome Sequence | PASS |  |
| 06 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 06 WhatsApp Engagement Follow-up | PASS |  |
| 07 | Import | imports into n8n 2.40.7 and round-trips intact (17 nodes): 07 Referral Campaign Tracker | PASS |  |
| 08 | Import | imports into n8n 2.40.7 and round-trips intact (25 nodes): 08 Feedback Collection & Routing | PASS |  |
| 09 | Import | imports into n8n 2.40.7 and round-trips intact (14 nodes): 09 Weekly Analytics Report | PASS |  |
| 10 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 10 Social Post Scheduler | PASS |  |
| 12 | Import | imports into n8n 2.40.7 and round-trips intact (21 nodes): 12 AI Social Autopilot | PASS |  |
| 13 | Import | imports into n8n 2.40.7 and round-trips intact (23 nodes): 13 WhatsApp Lead Funnel | PASS |  |
| 14 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 14 Autopilot Controller | PASS |  |
| 15 | Import | imports into n8n 2.40.7 and round-trips intact (11 nodes): 15 Viral Intelligence Engine | PASS |  |
| 16 | Import | imports into n8n 2.40.7 and round-trips intact (8 nodes): 16 Pain Discovery Engine | PASS |  |
| 17 | Import | imports into n8n 2.40.7 and round-trips intact (9 nodes): 17 ManyChat Comment Funnel | PASS |  |
| 18 | Import | imports into n8n 2.40.7 and round-trips intact (9 nodes): 18 Content Multiplication Engine | PASS |  |
| 19 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 19 WhatsApp Nurture Sequences | PASS |  |
| 20 | Import | imports into n8n 2.40.7 and round-trips intact (9 nodes): 20 A/B Testing Engine | PASS |  |
| 21 | Import | imports into n8n 2.40.7 and round-trips intact (10 nodes): 21 Social Proof Engine | PASS |  |
| 22 | Import | imports into n8n 2.40.7 and round-trips intact (13 nodes): 22 Performance Analyst Agent | PASS |  |
| 01 | Execution | daily run: drafts a post for LAUNCH_DATE day, saves it, asks for approval on Telegram | PASS |  |
| 01 | Output | is idempotent: second run does not create a duplicate draft or call the AI again | PASS |  |
| 01 | Errors | AI provider outage: retried 3x, execution fails loudly, no partial draft (alerting is verified in production mode: see 00/02/04/18 and the trigger-mode stage) | PASS |  |
| 01 | Errors | missing calendar row fails loudly (no silent skip) | PASS |  |
| 02 | Trigger | rejects calls without the Telegram secret token (403) | PASS |  |
| 02 | Execution | /approve marks the draft Approved (+approval_date) and confirms on Telegram | PASS |  |
| 02 | Execution | /reject marks the draft Rejected | PASS |  |
| 02 | Execution | /edit revises the draft through the AI and returns it as Draft | PASS |  |
| 02 | Security | ignores commands from any chat other than TELEGRAM_CHAT_ID | PASS |  |
| 00 | Execution | global error handler: sanitized alert (workflow, node, message) reaches the team chat on a production-mode failure | PASS |  |
| 02 | Errors | Code-node failure in production mode (edit of a draft that does not exist) alerts the team with workflow, node and message | PASS |  |
| 02 | Errors | non-command chatter and edit-without-feedback are ignored safely | PASS |  |
| 03 | Security | rejects requests without / with a wrong shared secret (403) | PASS |  |
| 03 | Execution | validation: bad payload -> 400 with reasons, nothing written | PASS |  |
| 03 | Execution | consented lead: saved (opt_in=yes), welcome sent as an approved TEMPLATE, team alerted | PASS |  |
| 03 | Output | duplicate submission updates the same row and does NOT send a second welcome | PASS |  |
| 03 | Security | without consent: lead is stored with opt_in=no and nothing is sent on WhatsApp | PASS |  |
| 03 | Output | email-only lead is keyed by email and never messaged on WhatsApp | PASS |  |
| 03 | Errors | WhatsApp outage: retried 3x, lead still saved with last_wa_error, no crash | PASS |  |
| 03 | Errors | transient WhatsApp failure recovers on retry (2 failures then success -> sent) | PASS |  |
| 04 | Security | rejects requests without / with a wrong shared secret (403) | PASS |  |
| 04 | Execution | validation: missing name/contact -> 400 | PASS |  |
| 04 | Execution | signup: row + position + referral code, confirmation email (Resend) and WhatsApp TEMPLATE | PASS |  |
| 04 | Output | second signup gets position 2; duplicate returns already_registered without a new row | PASS |  |
| 04 | Security | no WhatsApp message without consent (email-only confirmation still sent) | PASS |  |
| 04 | Errors | email provider outage after signup: API still answers 200, execution error alerts the team | PASS |  |
| 05 | Execution | sends welcome day 1/2/3 as approved templates and advances each lead | PASS |  |
| 05 | Output | rerun in the same window sends nothing (each lead gets each day once) | PASS |  |
| 05 | Errors | transient WhatsApp errors are retried (2 failures then success) | PASS |  |
| 05 | Errors | persistent failure: lead NOT advanced, error recorded, run continues and reports it | PASS |  |
| 05 | Errors | REGRESSION: one lead failing must NOT re-send the leads that already succeeded (no duplicate messages on retry) | PASS |  |
| 06 | Execution | re-engagement 7/14 sent as templates; day-21 template NOT configured -> blocked + one config alert, lead untouched | PASS |  |
| 06 | Output | never re-sends the same step (rerun is a no-op for already-contacted leads) | PASS |  |
| 07 | Security | rejects requests without the shared secret (403) | PASS |  |
| 07 | Execution | validation: missing code / invalid new-user email -> 400 | PASS |  |
| 07 | Execution | valid referral: count 2->3 (VIP Access milestone), referral logged, reward email sent to referrer | PASS |  |
| 07 | Output | idempotent: same referred email again -> duplicate, no second increment or email | PASS |  |
| 07 | Output | unknown referral code is accepted without crediting anyone | PASS |  |
| 07 | Output | referrer without an email is credited but not emailed | PASS |  |
| 08 | Execution | daily request: only ACTIVE users 6-8 days after signup and not yet asked get one email (no PII in the link) | PASS |  |
| 08 | Output | rerun does not ask the same user twice | PASS |  |
| 08 | Security | feedback webhook rejects requests without the shared secret (403) | PASS |  |
| 08 | Execution | validation: bad rating/email -> 400, nothing stored | PASS |  |
| 08 | Execution | rating 5: stored, thank-you + store-review links emailed, lead marked feedback_received | PASS |  |
| 08 | Execution | rating 2: team alerted on Telegram and the user is still thanked | PASS |  |
| 08 | Output | rating 3: stored as neutral, no alert | PASS |  |
| 08 | Errors | feedback for an email that is not a lead does not crash the flow | PASS |  |
| 09 | Execution | weekly report: computes metrics, appends Analytics row, Telegram summary, emails the team (HTML-escaped) | PASS |  |
| 09 | Errors | empty sheets still produce a report (no crash on zero data) | PASS |  |
| 13 | Security | GET verification: correct verify token echoes the challenge, wrong/missing token -> 403 | PASS |  |
| 13 | Security | POST without X-Hub-Signature-256 -> 401, nothing processed | PASS |  |
| 13 | Security | POST with a wrong signature or a tampered body -> 401 | PASS |  |
| 13 | Execution | valid signed greeting: lead created, session reply describes Eki as an African foodstuff marketplace | PASS |  |
| 13 | Execution | BUYER -> opted-in buyer lead_captured (same row, no duplicate) | PASS |  |
| 13 | Execution | VENDOR -> high intent: team alerted on Telegram | PASS |  |
| 13 | Security | STOP persists the unsubscribe on the lead record and confirms once | PASS |  |
| 13 | Security | an unsubscribed lead who writes again is NOT answered | PASS |  |
| 13 | Security | nurture / welcome / re-engagement workflows never target the unsubscribed lead (verified on the real lead record) | PASS |  |
| 13 | Execution | START re-subscribes (status new, opt_in yes, opt_out cleared) and is answered | PASS |  |
| 13 | Execution | signature is computed over the RAW bytes (non-ASCII text: accented letters + emoji) | PASS |  |
| 13 | Output | status-only webhooks (delivery receipts) are acknowledged and ignored | PASS |  |
| 13 | Errors | reply failure (WhatsApp outage) still saves the lead and the opt-out | PASS |  |
| 13 | Security | compliance: no free-form message was ever sent outside the 24h window (mock enforces Meta rule 131047) | PASS |  |
| 10 | Execution | autopilot OFF (default): oldest approved draft goes to Telegram for MANUAL posting, marked Notification Sent, no provider call | PASS |  |
| 10 | Output | next run picks the next approved draft; when none are left it does nothing | PASS |  |
| 12 | Execution | daily run: 3 platform posts generated, safety-checked, saved; autopilot OFF -> manual Telegram (no Buffer) | PASS |  |
| 12 | Execution | safety net: a caption with a false claim is FLAGGED, not approved | PASS |  |
| 12 | Errors | AI returns invalid JSON: execution fails loudly and nothing is saved | PASS |  |
| 14 | Execution | controller: daily report + config health (lists the unconfigured WhatsApp templates), logs the run, sends NO WhatsApp | PASS |  |
| 15 | Execution | scrapes via the configured Apify actor (Bearer header, not URL token), extracts patterns, saves them, reports on Telegram | PASS |  |
| 15 | Errors | Apify outage: retried, execution fails (alert path), nothing written | PASS |  |
| 16 | Execution | batch-categorises Reddit pain points with ONE AI call and saves persona/category/intensity | PASS |  |
| 16 | Errors | Reddit blocking (429): retried then fails loudly, no rows | PASS |  |
| 17 | Security | rejects requests without the shared secret (403) | PASS |  |
| 17 | Execution | VENDOR comment: replies with a ManyChat v2 message (vendor link), logs an instagram lead with opt_in=no, alerts the team | PASS |  |
| 17 | Output | BUY keyword gets the buyer message; same user again updates the same row | PASS |  |
| 17 | Output | unknown keyword still gets a friendly reply and is not misclassified | PASS |  |
| 18 | Security | rejects requests without the shared secret (403) | PASS |  |
| 18 | Execution | validation: missing idea -> 400 and no AI call | PASS |  |
| 18 | Execution | idea is expanded into 11 pending items in ContentQueue | PASS |  |
| 18 | Errors | AI outage: caller gets a 5xx, nothing partially queued, team alerted | PASS |  |
| 19 | Execution | segmented nurture: vendor D1/D7/D14 + buyer D1 sent as templates; buyer D5 template not configured -> blocked + alert | PASS |  |
| 19 | Output | rerun sends nothing new (24h spacing + persisted nurture_day) | PASS |  |
| 20 | Execution | with 6+ published posts: scores winners vs losers, saves insight rows, briefs the team | PASS |  |
| 20 | Output | with too little data (<6 posts) it skips without calling the AI | PASS |  |
| 21 | Security | rejects requests without the shared secret (403) | PASS |  |
| 21 | Execution | validation: vendor is required -> 400 | PASS |  |
| 21 | Execution | milestone event: content generated from the provided facts only, queued as pending, team notified | PASS |  |
| 22 | Execution | weekly analyst: computes lead/vendor/buyer/content metrics, AI analysis, saves to Agent Reports (not Analytics), Telegram + team email | PASS |  |
| 10 | Execution | autopilot ON: X/Twitter draft is posted through the X API (OAuth2 credential) and marked Published | PASS |  |
| 10 | Execution | autopilot ON: Instagram draft goes through Buffer with the PER-PLATFORM profile id | PASS |  |
| 10 | Errors | autopilot ON but Buffer fails: falls back to a manual Telegram alert (status Notification Sent), never marked Published | PASS |  |
| 10 | Output | platform without an API route (TikTok) stays manual even when autopilot is ON | PASS |  |
| 12 | Execution | autopilot ON: each platform post is scheduled on ITS OWN Buffer profile; flagged content is never posted | PASS |  |
| 12 | Errors | a Buffer failure for one platform falls back to manual for THAT post only; the others are posted exactly once | PASS |  |
| 14 | Output | controller reports social auto-posting ON | PASS |  |
| 12 | Security | kill switch: no AI call, nothing generated or posted | PASS |  |
| 10 | Security | kill switch: approved drafts are left untouched (no alert, no API post) | PASS |  |
| 14 | Security | kill switch: controller sends the emergency-stop alert | PASS |  |
| ALL | Import | all real workflows publish (activate) without errors: schedule crons and webhook registrations are valid | PASS |  |
| 01 | Trigger | real Schedule Trigger fires in production (trigger) mode: 01 AI Content Generation | PASS |  |
| 05 | Trigger | real Schedule Trigger fires in production (trigger) mode: 05 WhatsApp Welcome Sequence | PASS |  |
| 06 | Trigger | real Schedule Trigger fires in production (trigger) mode: 06 WhatsApp Engagement Follow-up | PASS |  |
| 08 | Trigger | real Schedule Trigger fires in production (trigger) mode: 08 Feedback Collection & Routing | PASS |  |
| 09 | Trigger | real Schedule Trigger fires in production (trigger) mode: 09 Weekly Analytics Report | PASS |  |
| 10 | Trigger | real Schedule Trigger fires in production (trigger) mode: 10 Social Post Scheduler | PASS |  |
| 12 | Trigger | real Schedule Trigger fires in production (trigger) mode: 12 AI Social Autopilot | PASS |  |
| 14 | Trigger | real Schedule Trigger fires in production (trigger) mode: 14 Autopilot Controller | PASS |  |
| 15 | Trigger | real Schedule Trigger fires in production (trigger) mode: 15 Viral Intelligence Engine | PASS |  |
| 16 | Trigger | real Schedule Trigger fires in production (trigger) mode: 16 Pain Discovery Engine | PASS |  |
| 19 | Trigger | real Schedule Trigger fires in production (trigger) mode: 19 WhatsApp Nurture Sequences | PASS |  |
| 20 | Trigger | real Schedule Trigger fires in production (trigger) mode: 20 A/B Testing Engine | PASS |  |
| 22 | Trigger | real Schedule Trigger fires in production (trigger) mode: 22 Performance Analyst Agent | PASS |  |
| 01 | Errors | trigger mode: a Code-node failure in a SCHEDULED run reaches the team via the global error workflow | PASS |  |

## Not covered by staging (needs real accounts)

Meta template approval and delivery · Google OAuth consent and real Sheets quotas · Resend domain verification · Telegram webhook registration with the real bot · ManyChat External Request/DM format · Buffer/X live APIs · Apify actor · Reddit anti-bot behaviour · production Railway networking/backups.
