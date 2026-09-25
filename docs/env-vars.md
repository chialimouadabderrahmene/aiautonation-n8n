# Environment variables

Generated from the workflows by reading every `$env.X` they use (plus the WhatsApp template keys). Source of truth for the example values is [`.env.railway.example`](../.env.railway.example); `node tools/validate-workflows.js` fails when a workflow reads a variable that is not listed there.

**n8n platform settings (not read by workflows, but required):** `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (n8n 2.x blocks `$env` in expressions/Code nodes by default — every workflow needs it), `N8N_ENCRYPTION_KEY`, `N8N_WEBHOOK_URL` (replaces the deprecated `WEBHOOK_URL`), `GENERIC_TIMEZONE=Africa/Lagos`, `TZ=Africa/Lagos`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` (execution data contains phone numbers and message text), `EXECUTIONS_DATA_SAVE_ON_ERROR=all`, `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336`.

**Timezone decision:** every workflow uses **Africa/Lagos** (WAT, UTC+1, no daylight saving) — it is what the README, SETUP_TODO and `GENERIC_TIMEZONE` already specified, and the primary audience (Nigerian/West-African vendors and diaspora) matches it. Three workflows (08, 09, 10) previously used `Europe/Rome`; they were aligned. Schedules in the docs are therefore Lagos time (Rome is UTC+1 in winter and UTC+2 in summer).

Status legend: **REQUIRED** = workflows fail without it · **EXTERNAL** = needs an account/approval you must create · **safety** = keep the default until told otherwise.

| Variable | Status | Read by workflow(s) | Purpose |
|---|---|---|---|
| `AI_API_BASE_URL` | optional | 01, 02, 12, 15, 16, 18, 20, 21, 22 | OpenAI-compatible base URL. Default `https://api.groq.com/openai/v1`; OpenAI: `https://api.openai.com/v1`. |
| `AI_API_KEY` | REQUIRED | 01, 02, 12, 14, 15, 16, 18, 20, 21, 22 | API key for the AI provider (sent as Bearer). One key for every AI step. |
| `AI_MODEL` | optional | 01, 02, 12, 15, 16, 18, 20, 21, 22 | Model name. Default `llama-3.3-70b-versatile` (Groq); OpenAI e.g. `gpt-4o-mini`. Must support `response_format: json_object`. |
| `APIFY_TOKEN` | EXTERNAL | 15 | Apify API token (15). |
| `APIFY_TRENDS_ACTOR_ID` | EXTERNAL | 15 | Apify actor id/name that returns trending posts (15). Without it 15 does nothing. |
| `APIFY_TRENDS_INPUT_JSON` | optional | 15 | JSON input passed to the actor (default `{}`). |
| `APP_DOWNLOAD_LINK` | REQUIRED | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 | Canonical public/download URL used in messages (`https://culinarytales.app`, same as the app's `EXPO_PUBLIC_APP_DOWNLOAD_LINK`). |
| `APP_STORE_REVIEW_URL` | optional | 08 | App Store "write a review" URL added to positive-feedback emails (08). |
| `APP_VENDOR_LINK` | recommended | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 | Vendor call-to-action URL (`https://culinarytales.app/sell`). Falls back to `APP_DOWNLOAD_LINK`. |
| `AUTOPILOT_SOCIAL_POSTING` | safety | 10, 12, 14 | `false` (default): content only goes to Telegram for manual posting. `true` enables Buffer/X API posting. Keep `false` until a week of human-reviewed output has passed. |
| `AUTOPILOT_STOP` | safety | 10, 12, 14 | `true` = emergency stop: 10 and 12 do nothing, 14 sends the stop alert. |
| `BUFFER_API_KEY` | EXTERNAL | 10, 12, 14 | Buffer access token (request shape NOT verified against the live Buffer API). |
| `BUFFER_PROFILE_ID_FACEBOOK` | EXTERNAL | 10, 12, 14 | Buffer profile id for facebook (one id per platform; the old single `BUFFER_PROFILE_ID` was removed because it posted every platform to one profile). |
| `BUFFER_PROFILE_ID_INSTAGRAM` | EXTERNAL | 10, 12, 14 | Buffer profile id for instagram (one id per platform; the old single `BUFFER_PROFILE_ID` was removed because it posted every platform to one profile). |
| `BUFFER_PROFILE_ID_LINKEDIN` | EXTERNAL | 10, 12, 14 | Buffer profile id for linkedin (one id per platform; the old single `BUFFER_PROFILE_ID` was removed because it posted every platform to one profile). |
| `BUFFER_PROFILE_ID_TIKTOK` | EXTERNAL | 10, 12, 14 | Buffer profile id for tiktok (one id per platform; the old single `BUFFER_PROFILE_ID` was removed because it posted every platform to one profile). |
| `FEEDBACK_FORM_URL` | EXTERNAL | 08 | Tally/Typeform/Google Form URL for the feedback request email (08). Without it the request flow is blocked with a Telegram alert. |
| `FEEDBACK_REWARD_TEXT` | optional | 08 | One sentence added to feedback emails. Leave empty unless a reward really exists. |
| `GOOGLE_SHEETS_ID` | REQUIRED | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 | Spreadsheet id (from the sheet URL). Tabs and columns: `schemas/google-sheets-schema.md`. |
| `LAUNCH_DATE` | REQUIRED (01) | 01 | First day of the 30-day content calendar, `YYYY-MM-DD` (day 1 = this date). Workflow 01 throws a clear error when unset. |
| `PLAY_STORE_REVIEW_URL` | optional | 08 | Google Play review URL added to positive-feedback emails (08). |
| `RESEND_API_KEY` | EXTERNAL | 04, 07, 08, 09, 14, 22 | Resend API key (emails in 04, 07, 08, 09, 22). |
| `RESEND_FROM_EMAIL` | EXTERNAL | 04, 07, 08, 09, 14, 22 | Sender, e.g. `Eki <hello@your-verified-domain>`; the domain must be verified in Resend. |
| `TEAM_EMAIL` | recommended | 09, 22 | Recipient of the weekly reports (09, 22). |
| `TELEGRAM_CHAT_ID` | REQUIRED | 00, 01, 02, 03, 05, 06, 08, 09, 10, 12, 13, 14, 15, 17, 19, 20, 21, 22 | Numeric id of the team Telegram group (negative). Workflow 02 only accepts commands from this chat. |
| `TWITTER_POSTING_ENABLED` | optional | 10 | `true` allows workflow 10 to post to X (also needs the "Eki Twitter X OAuth2" credential). |
| `WA_MAX_PER_RUN` | optional | 05, 06, 19 | Cap of template sends per run per workflow (default 40). |
| `WA_TEMPLATE_LANG` | optional | 03, 04, 05, 06, 19 | Template language code, default `en`. All templates must exist in this language. |
| `WHATSAPP_ACCESS_TOKEN` | EXTERNAL | 03, 04, 05, 06, 13, 14, 19 | Permanent System-User token with `whatsapp_business_messaging`. |
| `WHATSAPP_APP_SECRET` | EXTERNAL | 13 | Meta app secret; every incoming WhatsApp POST must carry a valid `X-Hub-Signature-256`. Empty = every incoming message is rejected (fail closed). |
| `WHATSAPP_CTA_LINK` | optional | 17 | wa.me click-to-chat link offered in Instagram DMs (17). |
| `WHATSAPP_GRAPH_VERSION` | optional | 03, 04, 05, 06, 13, 19 | Graph API version, default `v23.0`. Check Meta's changelog for the currently supported versions before go-live. |
| `WHATSAPP_PHONE_NUMBER_ID` | EXTERNAL | 03, 04, 05, 06, 13, 14, 19 | Sender phone-number id (Meta -> WhatsApp -> API Setup). |
| `WHATSAPP_VERIFY_TOKEN` | EXTERNAL | 13 | Webhook verification token; must equal the value typed in the Meta webhook config. Empty = verification always fails. |
| `WA_TPL_NURTURE_BUYER_D1` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_BUYER_D1` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_BUYER_D3` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_BUYER_D3` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_BUYER_D5` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_BUYER_D5` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_VENDOR_D1` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_VENDOR_D1` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_VENDOR_D14` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_VENDOR_D14` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_VENDOR_D2` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_VENDOR_D2` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_VENDOR_D3` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_VENDOR_D3` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_NURTURE_VENDOR_D7` | EXTERNAL | 14, 19 | Approved WhatsApp template name for `NURTURE_VENDOR_D7` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_REENGAGE_14` | EXTERNAL | 06, 14 | Approved WhatsApp template name for `REENGAGE_14` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_REENGAGE_21` | EXTERNAL | 06, 14 | Approved WhatsApp template name for `REENGAGE_21` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_REENGAGE_7` | EXTERNAL | 06, 14 | Approved WhatsApp template name for `REENGAGE_7` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_WAITLIST_CONFIRM` | EXTERNAL | 04, 14 | Approved WhatsApp template name for `WAITLIST_CONFIRM` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_WELCOME_D1` | EXTERNAL | 03, 05, 14 | Approved WhatsApp template name for `WELCOME_D1` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_WELCOME_D2` | EXTERNAL | 05, 14 | Approved WhatsApp template name for `WELCOME_D2` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |
| `WA_TPL_WELCOME_D3` | EXTERNAL | 05, 14 | Approved WhatsApp template name for `WELCOME_D3` (see [whatsapp-templates.md](whatsapp-templates.md)). Empty = step blocked. |

## Removed / renamed

| Old | Now |
|---|---|
| `GROQ_API_KEY`, `OPENAI_API_KEY`, n8n "OpenAI credential" | `AI_API_KEY` + `AI_API_BASE_URL` + `AI_MODEL` (one OpenAI-compatible HTTP call everywhere; Groq is the default, OpenAI works by changing the base URL/model) |
| `WEBHOOK_URL` | `N8N_WEBHOOK_URL` (n8n 2.40 logs a deprecation warning for the old name) |
| `N8N_RUNNERS_ENABLED` | remove (no longer needed in n8n 2.x) |
| `BUFFER_PROFILE_ID` | `BUFFER_PROFILE_ID_<TIKTOK\|INSTAGRAM\|FACEBOOK\|LINKEDIN>` |
| `MAX_POSTS_PER_DAY`, `MAX_*_POSTS_PER_DAY`, `METRICOOL_API_KEY`, `META_ACCESS_TOKEN`, `TIKTOK_ACCESS_TOKEN` | removed with the unverified multi-provider publishing code (only Buffer/X remain; see workflows 10/12/14) |
| `N8N_BASE_URL` | removed (workflow 08 no longer calls a non-existent internal webhook) |

## n8n credentials (created inside n8n, not env vars)

| Credential name (id) | Type | Used by | Notes |
|---|---|---|---|
| `Eki Google Sheets` (`eki-cred-gsheets`) | Google Sheets OAuth2 | 01-10, 12-14, 15-17, 18-22 | Scopes: Sheets + Drive file. |
| `Eki Telegram Bot` (`eki-cred-telegram`) | Telegram | all workflows with alerts | Bot token from @BotFather. |
| `Eki Webhook Shared Secret` (`eki-cred-webhook-secret`) | Header Auth, name `X-Eki-Webhook-Secret` | 03, 04, 07, 08, 17, 18, 21 | Any long random value; give it to whatever calls the webhooks. |
| `Eki Telegram Webhook Secret` (`eki-cred-telegram-secret`) | Header Auth, name `X-Telegram-Bot-Api-Secret-Token` | 02 | Same value passed as `secret_token` to Telegram `setWebhook`. |
| `Eki Twitter X OAuth2` (`eki-cred-twitter`) | OAuth2 API | 10 (X branch only) | Only needed when `TWITTER_POSTING_ENABLED=true`. |

The workflow files reference these credentials by the ids above. Import with the CLI (`n8n import:workflow --separate --input=n8n-workflows`) or create the credentials with **the same names** and re-select them after a UI import.
