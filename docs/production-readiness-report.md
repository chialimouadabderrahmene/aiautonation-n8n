# Production readiness report — Eki n8n automation

**Verdict: staging-verified, NOT production-ready.** The 22 workflow files import and run correctly in a real n8n 2.40.7 against a mock of every external provider ([staging-test-report.md](staging-test-report.md)). Nothing has been run against real Meta / Google / Resend / Buffer / X / Apify / ManyChat / Telegram accounts, no WhatsApp template exists yet, and several business decisions are open. Go live only after the gates in §7 are closed. All workflows ship inactive (`"active": false`); nothing was activated anywhere but the throw-away local staging stack; no real customer data was used.

## 1. Before / after
| | Before (baseline commit `6de6e16`) | After |
|---|---|---|
| Workflow files | 21 (docs claimed 22; no workflow 11 ever existed) | 22 = 00 global error handler + the same 21 numbers (still no 11) |
| Importable / runnable | **13 of 21** files contained a node type or version that does not exist in n8n 2.40 (11 non-existent types; 01 and 02 an invalid `openAi` version), 2 of them (03, 06) also had malformed node entries; 4 files (01, 02, 04, 07) used a Google-Sheets parameter shape n8n ignores; 11 files used string-style credentials | 22/22 import (node types, versions and parameters validated against the n8n 2.40.7 catalog, round-tripped through n8n) and execute in staging |
| Webhook workflows authenticated (9 workflows, 10 endpoints) | 0 of 9 (13's GET only compared a verify token) | 9 of 9: WhatsApp POST by HMAC + GET by verify token (13); Telegram secret token + chat allow-list (02); shared-secret header on 03, 04, 07, 08, 17, 18, 21 |
| WhatsApp business-initiated messages | free-form text to cold leads | approved templates only; missing template = blocked + alert |
| Error handling | none (0 error workflows) | global error workflow + per-node retries + failure states recorded on the lead |

## 2. P0 issues fixed (would not import / run)
1. Invalid node types: `cronTrigger`→`scheduleTrigger` (7 files), `webhookTrigger`→`webhook` (4 files), `openAi@2/@1.6` and `telegram@2` (non-existent versions) → replaced by the OpenAI-compatible HTTP call and `telegram@1.2`.
2. Malformed JSON/nodes: bare coordinate arrays inside `nodes` (workflows 03, 06), connections with wrong target input indexes (02, 04, 07, 09), overlapping nodes, branches that could never run.
3. Credentials referenced as strings / wrong type names (`googleSheetsOAuth2`) → `{id,name}` objects with stable ids; documented.
4. Broken logic: `$json.filter` on a single item (05/06/19/20/22) threw; "Update Progress" **appended** a row per run (duplicate leads every day) → upsert on `lead_id`; status mismatch (`new` vs `lead_captured`); `weekday:[0,0]` schedules; Sheets nodes with the old parameter shape (01, 02, 04, 07, 08, 09, 10); switch outputs never reached (19 buyer branch); `n8n` REST call in 22; webhook to a non-existent `request-review` endpoint (08); email payloads sent to `api.whatsapp.com/emails` / `api.telegram.com/emails` (04, 07, 08, 09, 22).
5. Wrong brand copy ("Eki - AI automation platform for businesses", "We help businesses automate with AI") removed from workflows 12, 13, 14 and docs.
6. Wrong domains (`eki.app` ×21, `eki-marketplace.com` ×11) replaced by `APP_DOWNLOAD_LINK` / `APP_VENDOR_LINK` (canonical `https://culinarytales.app`, taken from the app's own configuration); invented paths (`/how-it-works`, `/showcase`, `/store/example`, `/complete`) and a fabricated vendor testimonial ("50 orders in 3 weeks") removed.

## 3. P1 (hardening) done
Global error workflow (00) · retries on every external HTTP call · one AI configuration (Groq default, OpenAI supported) · one timezone (Africa/Lagos) · complete env documentation checked by a validator · corrected doc links (no local-file links) · git initialised (baseline commit + audit commits) · per-lead send loops (no duplicate messages on retry) · `executeOnce` on unfiltered sheet reads (chained reads multiplied rows) · Telegram Markdown escaping (AI text with `_`/`*` made Telegram reject alerts) · idempotency (drafts, referrals, feedback requests, waitlist) · safety kill-switch · header-only sheet templates (no fake customers).

## 4. Security fixes
- WhatsApp: `X-Hub-Signature-256` HMAC over the raw body, constant-time compare, fails closed when `WHATSAPP_APP_SECRET` is unset; verify-token handshake fails closed. Tested: missing / wrong / tampered / non-ASCII bodies.
- `content-approval` (02): Telegram secret-token header + only `TELEGRAM_CHAT_ID` may issue commands. `join-waitlist`, `track-referral`, `collect-feedback` (+ `lead-capture`, `manychat-comment`, `content-multiply`, `social-proof`): shared-secret header credential; n8n answers 403 before the workflow runs.
- Opt-out: STOP persisted on the lead record and honoured by every sender; verified against the real lead row with all other eligibility rules satisfied.
- PII: no personal data in URLs (feedback link), execution data retention settings, HTML-escaped report/email content, `WhatsApp Conversations` retention note.
- Secrets: none committed; staging values are dummies; `.gitignore` blocks `.env*`.

## 5. WhatsApp compliance status
| Requirement | Status |
|---|---|
| Free-form text only inside the 24 h customer window | **Enforced in code and tested** (only workflow 13 sends free-form, only as a reply; static check forbids it elsewhere; staging mock rejects violations — zero recorded) |
| Templates for business-initiated messages | **Implemented and tested** with the mock; **no template exists yet** → all 15 are an EXTERNAL DEPENDENCY, sends are blocked until configured |
| Opt-in evidence | Recorded (`opt_in`, `opt_in_source`, `opt_in_at`); legal adequacy of the consent wording is **not assessed** |
| STOP/START | Implemented, tested |
| Quality/tier limits, template rejection, real delivery | **Not testable without a real number** |

## 6. External dependencies requiring Meta / provider accounts
1. **Meta**: verified Business account, registered number, System-User token, app secret, webhook subscription, **15 approved templates** ([whatsapp-templates.md](whatsapp-templates.md)).
2. **Google**: Cloud project, OAuth consent, the real spreadsheet (16 tabs).
3. **Resend**: verified sending domain + API key.
4. **Telegram**: bot, team group, `setWebhook` with secret token.
5. **AI provider** key (Groq/OpenAI) and confirmation that the chosen model supports JSON mode.
6. **ManyChat Pro** + Instagram Business (External Request + reply format acceptance).
7. Optional: **Buffer** (request format unverified, legacy API), **X API**, **Apify actor** (+ platform ToS review), Reddit (unauthenticated access may be blocked).
8. **Feedback form** (Tally/Typeform), store review URLs.
9. **Legal**: consent wording, GDPR/PECR retention, message content sign-off.

## 7. Go-live gates (all must be true)
- [ ] Real-account smoke test ([testing-checklist.md](testing-checklist.md) §3) passed with your own test number/mailbox.
- [ ] Templates approved and `WA_TPL_*` set; Meta webhook verified; signature check confirmed with a real Meta call.
- [ ] `LAUNCH_DATE`, `APP_DOWNLOAD_LINK`, `APP_VENDOR_LINK` set; `Content Calendar` filled and its claims reviewed.
- [ ] Workflow 00 published and every workflow's Error Workflow points at it (after a UI import).
- [ ] Client sign-off on: reward promises (VIP Access / Free Escrow in workflow 07), copy claims, consent wording, data retention.
- [ ] Backup/restore of the n8n Postgres tested; `N8N_ENCRYPTION_KEY` stored in a vault.
- [ ] Staging suite re-run on the exact n8n image tag used in production.
- [ ] `AUTOPILOT_SOCIAL_POSTING` still `false`; one week of human-reviewed social output before it is ever enabled ([SOCIAL_AUTOPILOT_TESTING.md](../SOCIAL_AUTOPILOT_TESTING.md)).

## 8. Remaining placeholders
- `.env.railway.example`: every secret/id value is empty by design; `N8N_ENCRYPTION_KEY=REPLACE_WITH_64_CHAR_HEX`, `LAUNCH_DATE=YYYY-MM-DD`, `N8N_HOST`/`N8N_WEBHOOK_URL` use `your-n8n-service.up.railway.app`.
- `WA_TPL_*` (15 names), `FEEDBACK_FORM_URL`, store review URLs, `BUFFER_*`, `APIFY_*`, `WHATSAPP_CTA_LINK`, `RESEND_FROM_EMAIL`, `TEAM_EMAIL`.
- Placeholders inside workflow JSON: none (validator enforces); the sticky notes reference the variables above.
- `staging/credentials.staging.json` / `staging.env` contain dummy staging values only (safe to commit, useless elsewhere).
- Content: `content-strategy/` still contains unverified statistics/claims (banners added).

## 9. Remaining limitations and risks
1. **Not run against real providers** — mocks can be wrong about provider behaviour (e.g., Google Sheets edge cases, Meta error semantics, Buffer legacy API).
2. **Google Sheets as a database**: no locking; read-merge-write of full lead rows can lose an update if two workflows touch the same lead in the same second; ~60 writes/min quota; not suited for high volume.
3. WhatsApp `START`/`BUYER`/`VENDOR` replies as opt-in evidence and the 24 h session model need legal confirmation.
4. Workflow 13 handles the first message of each webhook payload only (Meta can batch several; extremely rare at this volume).
5. Referral rewards (VIP Access at 3, Free Escrow at 5) are announced by email but **not fulfilled by any system here**.
6. Workflows 07, 18, 21 have no caller in the Eki backend yet; 20/22 need `PublishedContent` filled manually.
7. Rome/Lagos: schedules are Lagos time; content assumes Lagos-hour audience.
8. n8n internal JS task runner mode is deprecated (external mode recommended); pin/upgrade deliberately.
9. Telegram alert on a failed *error workflow* is best-effort (if Telegram itself is down nobody is told).
10. `n8n execute` (used for scheduled runs in staging) does not reliably call the error workflow; alerting was verified in production/trigger mode on a representative subset (02, 04, 18, scheduled 01), not on every workflow.
11. Backend automations (System B) verified only by their existing unit tests (338 passed); no device/email delivery test.
12. `/approve` or `/reject` for a day that has no draft is silently ignored (n8n's Sheets *update* returns nothing when no row matches, so no confirmation is sent). Cosmetic; `/edit` of a missing draft raises an error alert.
13. Position numbers in the waitlist are `rows + 1`: two signups in the same second can receive the same position.

## 10. Lessons learned about n8n 2.40 (worth knowing when editing these workflows)
- `retryOnFail` re-runs the **whole node**; combined with `continueRegularOutput` this re-sends items that already succeeded → bulk sends must run one item per loop iteration.
- Any output item with an `error` key makes the engine retry the node (a sheet column named `error` caused triple appends).
- A node runs once **per input item**: chained "read sheet" nodes multiply rows unless `executeOnce` is set.
- The n8n Telegram node sends `parse_mode=Markdown` by default → escape `_ * [ \``.
- The error workflow must be **active**; after a UI import workflow ids change and the Error Workflow setting must be reselected.
- n8n 2.x blocks `$env` in nodes unless `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
- `n8n execute` needs a Manual/Execute-Workflow trigger and a free task-broker port when a server is running.

## 11. Verification runs (what was actually executed)
| Run | Result |
|---|---|
| Static validator `node tools/validate-workflows.js` | 0 errors, 0 warnings (22 workflow files against the n8n 2.40.7 node catalog; 48 doc/config files scanned) |
| Staging full run #1 (fresh stack) | 133/136 — the 3 failures were the error-workflow alert checks (02, 04, 18): `staging/scripts/up.sh` did not publish workflow 00, and n8n refuses to call an inactive error workflow. **Real defect in the staging script, found by the fresh run and fixed** (the workflows themselves were fine; on Railway the same mistake would have silenced every alert — hence the go-live gate "Workflow 00 published") |
| Staging full run #2 (fresh stack, after the fix) | **137/137**, exit 0: t0-t4 default stage (112 = 23 import + 89 workflow checks) · t5 posting-on (7) · t6 stop-on (3) · t9 trigger-mode (15) |
| Backend (`ekiapp-backend-main`) automation tests (read-only, nothing changed there) | 338 passed (automation detectors/service/routes, renewals, notification dedupe, community-buy) |

Reproduce: `bash staging/run-all.sh` (≈35 min, Docker + Node). Details per check: [staging-test-report.md](staging-test-report.md).
