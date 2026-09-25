# WhatsApp message templates (EXTERNAL DEPENDENCY — Meta account setup required)

**Rule the automation enforces:** WhatsApp only allows free-form text inside the 24-hour customer-service window that opens when the *customer* writes to you. Every business-initiated message (welcome after a form, nurture, re-engagement, waitlist confirmation) must be an **approved message template**. The workflows therefore:

- send **only** templates from workflows 03, 04, 05, 06, 19 (a static check in `tools/validate-workflows.js` fails if any Code node outside workflow 13 builds a free-form WhatsApp text),
- send free-form text **only** in workflow 13, and only as a reply to a message the customer just sent (session reply),
- never send when the template env var is empty: the step is **blocked**, nothing is sent, and the team gets one Telegram alert per run naming the missing variable(s).

**I did not create, submit or invent any template, template ID or Meta credential.** The names below are *env-var keys*; you choose the template names in WhatsApp Manager and put them in the variables. Approval by Meta can take from minutes to days and may be rejected — marketing templates require the recipient's opt-in (see below).

## What you must do (per template)
1. WhatsApp Manager → Message templates → Create template: category as listed, language = `WA_TEMPLATE_LANG` (default `en`), body text below (one `{{n}}` variable per placeholder; add example values when Meta asks for samples).
2. Wait for **Approved**.
3. Put the exact approved template *name* into the matching `WA_TPL_…` variable in Railway and restart n8n.

## Templates used by the workflows

Variables are always plain text without line breaks (the workflows strip newlines/tabs). Suggested body texts are derived from the original campaign copy with **unverifiable claims removed** (no invented vendor statistics, "buyer protection", "free in 15 minutes" etc.); get the client to sign off any product claim before submitting.

| Env var | Workflow | Category | Variables | Suggested body |
|---|---|---|---|---|
| `WA_TPL_WELCOME_D1` | 03, 05 | MARKETING | 1 name, 2 app link | Hi {{1}}! Welcome to Eki, the marketplace connecting African foodstuff vendors with buyers worldwide. Get the app: {{2}}. Reply BUYER or VENDOR so we can help you better. Reply STOP to opt out. |
| `WA_TPL_WELCOME_D2` | 05 | MARKETING | 1 name, 2 app link | Hi {{1}}! Eki makes it easier to buy and sell African foodstuff online: vendors get a storefront, buyers get one place to shop. See how it works: {{2}}. Reply STOP to opt out. |
| `WA_TPL_WELCOME_D3` | 05 | MARKETING | 1 name, 2 app link | Hi {{1}}, ready to get started on Eki? Download the app or set up your store: {{2}}. Need help? Reply HELP and our team will assist. Reply STOP to opt out. |
| `WA_TPL_REENGAGE_7` | 06 | MARKETING | 1 name, 2 app link | Hey {{1}}! Just checking in from Eki. Your profile is still waiting: {{2}}. Reply READY to get started or STOP to opt out. |
| `WA_TPL_REENGAGE_14` | 06 | MARKETING | 1 name, 2 app link | Hi {{1}}, we noticed you haven't been back on Eki yet. Pick up where you left off: {{2}}. Reply STOP to unsubscribe. |
| `WA_TPL_REENGAGE_21` | 06 | MARKETING | 1 name, 2 app link | {{1}}, this is our last message. Your Eki account is ready whenever you are: {{2}}. We won't message again unless you reply. Reply RESTART to begin later. |
| `WA_TPL_NURTURE_VENDOR_D1` | 19 | MARKETING | 1 name, 2 vendor link | Welcome {{1}}! Selling foodstuff online? See how Eki works for vendors: {{2}}. Reply STOP to opt out. |
| `WA_TPL_NURTURE_VENDOR_D2` | 19 | MARKETING | 1 name, 2 vendor link | Hi {{1}}, on Eki vendors can list products, take orders and get paid in one place. Take a look: {{2}}. Reply STOP to opt out. |
| `WA_TPL_NURTURE_VENDOR_D3` | 19 | MARKETING | 1 name, 2 vendor link | Hi {{1}}, getting started on Eki takes three steps: set up your store, share your link, receive orders. Start here: {{2}}. Reply STOP to opt out. |
| `WA_TPL_NURTURE_VENDOR_D7` | 19 | MARKETING | 1 name, 2 vendor link | Hi {{1}}, ready to set up your Eki store? Start here: {{2}}. Need help? Reply HELP and a person will assist. Reply STOP to opt out. |
| `WA_TPL_NURTURE_VENDOR_D14` | 19 | MARKETING | 1 name, 2 vendor link | Hi {{1}}, your Eki store is one step away. Finish setting up: {{2}}. We'll check in less often from now on. Reply STOP to opt out. |
| `WA_TPL_NURTURE_BUYER_D1` | 19 | MARKETING | 1 name, 2 app link | Welcome {{1}}! Eki connects you with African foodstuff vendors. Browse here: {{2}}. Reply STOP to opt out. |
| `WA_TPL_NURTURE_BUYER_D3` | 19 | MARKETING | 1 name, 2 app link | Hi {{1}}, discover garri, palm oil, spices and more from vendors on Eki: {{2}}. Reply STOP to opt out. |
| `WA_TPL_NURTURE_BUYER_D5` | 19 | MARKETING | 1 name, 2 app link | Hi {{1}}, ready to place your first order on Eki? Start here: {{2}}. Reply STOP to opt out. |
| `WA_TPL_WAITLIST_CONFIRM` | 04 | UTILITY | 1 name, 2 position, 3 referral link | Hi {{1}}, you're on the Eki waitlist at position #{{2}}. Share your personal link to move up: {{3}} |

`{{2}}`/`{{3}}` links come from `APP_DOWNLOAD_LINK` / `APP_VENDOR_LINK` (canonical: `https://culinarytales.app`, `/sell`). If the app link variable is empty the workflows pass the words "our app" so the template still renders — set the variable before go-live.

## Payload the workflows send (Cloud API `POST /{version}/{phone_number_id}/messages`)
```json
{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "<digits>", "type": "template",
  "template": { "name": "<WA_TPL_…>", "language": { "code": "en" },
                "components": [ { "type": "body", "parameters": [ { "type": "text", "text": "<name>" }, { "type": "text", "text": "<link>" } ] } ] } }
```
Staging verified this shape against a Meta-rule mock (well-formed template, no line breaks in parameters, 24-hour rule → error 131047 for free-form text outside the window). It has **not** been accepted by the real Cloud API.

## Consent (legal — EXTERNAL DEPENDENCY)
Meta requires opt-in for marketing templates and the audience includes EU/UK contacts (GDPR/PECR). The workflows only message leads with `opt_in=yes`, which is set by (a) a web form / waitlist submitted with `consent: true`, or (b) the person replying `START`, `BUYER` or `VENDOR` on WhatsApp. Whether those mechanisms and the consent wording on your forms satisfy your legal obligations must be confirmed by the client's counsel before launch; Instagram comments (workflow 17) are deliberately **not** treated as WhatsApp consent.

## Configuration when Meta setup is not finished
Leave the `WA_TPL_…` variables empty. Workflows 03/04 still capture leads and send email; 05/06/19 send **nothing** and post one Telegram alert per run; workflow 13 still answers people who message you first.
