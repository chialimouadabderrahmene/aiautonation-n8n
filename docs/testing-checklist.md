# Testing checklist — Eki n8n automation

Three levels. Level 1 needs no accounts and is what produced [staging-test-report.md](staging-test-report.md); level 3 needs real accounts and dedicated test data.

## 1. Static (no Docker, seconds)
```bash
node tools/validate-workflows.js
```
Checks: JSON validity; every node type/version/parameter exists in n8n 2.40.7 (`tools/n8n-node-catalog.json`, generated from the pinned image); all connections/reachability; credential references; **every webhook authenticated** (only 13's two Meta endpoints are exempt: verify-token handshake and in-flow HMAC); Sheets tabs/columns vs `schemas/sheet-columns.json`; no free-form WhatsApp text outside workflow 13; timezone = Africa/Lagos and Error Workflow set everywhere; forbidden content (wrong brand text, the two legacy domains, stale URLs, localhost, local-file links, placeholders, test emails/phones — the exact patterns are the `FORBIDDEN` list in `tools/validate-workflows.js`); every `$env` used is documented in `.env.railway.example`.

## 2. Staging (Docker + Node) — real n8n, mocked providers
```bash
bash staging/scripts/up.sh                 # fresh stack, imports everything
node staging/run-tests.js                  # t1-t4: workflows 00-22
bash staging/scripts/stage.sh posting-on && node staging/run-tests.js t5
bash staging/scripts/stage.sh stop-on    && node staging/run-tests.js t6
bash staging/scripts/stage.sh default    && node staging/run-tests.js t9   # ~4 min: real schedule triggers, activation of all 22
```
Scheduled workflows are executed through their **Manual Run** trigger (`n8n execute`); t9 additionally proves the real Schedule Triggers fire in production (trigger) mode using every-minute copies, and that all 22 real workflows activate. Webhook workflows are called over HTTP exactly like production callers. The mock enforces the WhatsApp 24-hour rule, template well-formedness, Google Sheet columns and provider authentication, and supports fault injection (outages, 429s) to test retries.

Reading results: each check is `PASS/FAIL` with the assertion text; `staging/out/` holds JSON per suite (git-ignored). The matrix in `docs/staging-test-report.md` is generated from those files by `node tools/make-report.js`.

## 3. Real-account smoke test (dedicated test data only)
Prerequisites: real n8n on Railway, credentials, Sheet, Telegram group, a **test WhatsApp number you own**, a `.test`/own mailbox. **Do not use production customer data.** Use your own numbers/emails and delete the rows afterwards.

Set `N8N=https://<domain>/webhook` and `SECRET=<X-Eki-Webhook-Secret value>`.

| # | Action | Expected |
|---|---|---|
| 1 | `curl -X POST $N8N/lead-capture` **without** the header | 403 |
| 2 | same with header, body `{}` | 400 with reasons |
| 3 | `{"name":"QA Lead","phone":"<your number>","source":"smoke","user_type":"vendor","consent":true}` | 200; `Leads` row (`opt_in=yes`); Telegram alert; welcome **template** arrives (only if `WA_TPL_WELCOME_D1` approved) |
| 4 | repeat #3 | `duplicate:true`, no second WhatsApp |
| 5 | same without `consent` | row `opt_in=no`, nothing sent |
| 6 | `POST $N8N/join-waitlist` `{"name":"QA","email":"<your email>","user_type":"Buyer","consent":true}` | position, referral code, confirmation email |
| 7 | `POST $N8N/track-referral` with that code and a new email | referrer count +1; second call → `duplicate` |
| 8 | `POST $N8N/collect-feedback` rating 2 then 5 | Feedback rows; Telegram alert for 2; thank-you email; 5 includes store links only if configured |
| 9 | send `hi`, `BUYER`, `STOP`, `hello` from your phone to the business number | replies; after `STOP` the row is `unsubscribed` and `hello` gets **no** reply |
| 10 | signed/unsigned WhatsApp POST tests ([WHATSAPP_TEST_PAYLOADS.md](../WHATSAPP_TEST_PAYLOADS.md)) | valid → 200; missing/wrong → 401 |
| 11 | Telegram: `/approve`, `/reject`, `/edit` from the team group and from another chat | only the team group works |
| 12 | run 01, 10, 12, 14 with *Manual Run* | see [AUTOPILOT_TESTING_GUIDE.md](../AUTOPILOT_TESTING_GUIDE.md) §2 |
| 13 | run 05 / 06 / 19 with a seeded test lead (`opt_in=yes`) | one template per run; with templates unset → one Telegram "blocked" alert and no send |
| 14 | break something on purpose (wrong AI key) and run 01 | workflow 00 posts an `n8n workflow error` alert (workflow, node, message) |

## Webhook reference
| Path | Header | Body |
|---|---|---|
| `lead-capture` | `X-Eki-Webhook-Secret` | `name`, `phone` or `email`, `source`, `user_type`, `consent`, `intent_level`, `country` |
| `join-waitlist` | same | `name`, `email` and/or `whatsapp`, `user_type` (Vendor/Buyer), `consent` |
| `track-referral` | same | `referral_code` (or `ref`), `new_user_email` (or `new_email`), `new_user_name` |
| `collect-feedback` | same | `email`, `rating` 1-5, `comments`, `would_recommend`, optional `user_role`, `primary_value`, `pain_point` |
| `manychat-comment` | same | `name`, `username`, `keyword` |
| `content-multiply` | same | `idea` |
| `social-proof` | same | `vendor`, `event`, `metric`, `value` |
| `content-approval` | `X-Telegram-Bot-Api-Secret-Token` | Telegram update JSON |
| `whatsapp-webhook` | `X-Hub-Signature-256` (POST) / verify token (GET) | Meta payload |

Use `/webhook/…` (production) for real callers; `/webhook-test/…` only while the editor is listening.
