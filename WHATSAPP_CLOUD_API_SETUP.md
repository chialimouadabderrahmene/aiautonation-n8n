# WhatsApp Cloud API setup (EXTERNAL DEPENDENCY)

The automation uses Meta's WhatsApp Cloud API for two different things — keep them apart:

| Message kind | Allowed when | Used by | Format |
|---|---|---|---|
| **Session reply** (free-form text) | within 24 h after the *customer* last wrote to you | workflow 13 (replies) | `type: text` |
| **Business-initiated** (welcome after a form, nurture, re-engagement, waitlist confirmation) | any time, but **only** with an approved template and the person's opt-in | workflows 03, 04, 05, 06, 19 | `type: template` |

`tools/validate-workflows.js` fails if any workflow other than 13 builds free-form WhatsApp text. Templates: [docs/whatsapp-templates.md](docs/whatsapp-templates.md).

## Variables (Railway → n8n service)
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_VERSION` (default `v23.0` — check Meta's changelog for supported versions), `WA_TEMPLATE_LANG`, `WA_MAX_PER_RUN`, `WA_TPL_*`, `APP_DOWNLOAD_LINK`, `APP_VENDOR_LINK`. See [docs/env-vars.md](docs/env-vars.md).

## Step 1 — Meta app
developers.facebook.com → My Apps → Create App → **Business** → add the **WhatsApp** product. You need a **verified Meta Business account** and a phone number registered with WhatsApp Business (not already used in the consumer app).

## Step 2 — credentials
- **Phone number id**: WhatsApp → API Setup.
- **Permanent token**: Business Settings → System users → (Admin) → add the app → permissions `whatsapp_business_messaging`, `whatsapp_business_management` → Generate token. Temporary tokens expire in 24 h.
- **App secret**: App → Settings → Basic → *App secret*. It signs every webhook call; workflow 13 verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body) and answers **401** if it is missing/wrong. If `WHATSAPP_APP_SECRET` is empty, *all* incoming messages are rejected (fail closed).
- **Verify token**: any random string, same value in Meta and in `WHATSAPP_VERIFY_TOKEN`.

## Step 3 — webhook
1. Publish workflow **13** first (Meta verifies immediately).
2. WhatsApp → Configuration → Webhook → **Edit**: Callback URL `<N8N_WEBHOOK_URL>webhook/whatsapp-webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN` → Verify and save.
3. Subscribe to the `messages` field.
Use the **production** URL (`/webhook/…`), not `/webhook-test/…`.

Verification handshake (GET): Meta calls `…/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; the workflow echoes the challenge only when the token matches, otherwise 403.

## Step 4 — templates
Create and get approved the 15 templates in [docs/whatsapp-templates.md](docs/whatsapp-templates.md), then set the `WA_TPL_*` variables. Until then keep them empty: no business-initiated message is sent.

## What the workflows send
Session reply (13): `POST /{version}/{phone_number_id}/messages` with `{ "messaging_product":"whatsapp", "recipient_type":"individual", "to":"<digits>", "type":"text", "text":{ "preview_url":false, "body":"…" } }`.
Template (03, 04, 05, 06, 19): see the payload in [docs/whatsapp-templates.md](docs/whatsapp-templates.md).

## Safety rules implemented
| Rule | Where |
|---|---|
| Only opted-in leads (`opt_in=yes`, no `opt_out_at`) get business-initiated messages | 03, 05, 06, 19 |
| STOP / unsubscribe / quit / cancel / opt out / optout / basta / stop all → persisted opt-out on the lead row + one confirmation | 13 |
| An unsubscribed lead who writes again is not answered (unless START) | 13 |
| No free-form text outside the 24 h window; template missing → blocked + Telegram alert | 03, 04, 05, 06, 19 |
| Per-lead send loop: a failure never re-sends other leads' messages | 05, 06, 19 |
| Signature verification, fail closed | 13 |

## Testing
Signed example requests and a step-by-step checklist: [WHATSAPP_TEST_PAYLOADS.md](WHATSAPP_TEST_PAYLOADS.md). Local end-to-end run against a Meta-rule mock: `staging/` (suite t3).

## Troubleshooting
| Issue | Fix |
|---|---|
| Webhook verification fails | workflow 13 not published, or token mismatch |
| 401 from the webhook | wrong/missing `WHATSAPP_APP_SECRET`, or a proxy re-serialised the JSON body (the signature is over the exact raw bytes) |
| Nothing arrives | `messages` field not subscribed; wrong callback URL |
| Error 131047 | free-form message outside the 24 h window → use a template (the automation never does this) |
| Error 132001 / 132000 | template name/language/parameters do not match the approved template |
| Error 131026 | recipient cannot receive the message (not on WhatsApp / blocked) |
| Rate limits | the workflows cap sends per run (`WA_MAX_PER_RUN`); Meta enforces messaging-tier limits per number |
