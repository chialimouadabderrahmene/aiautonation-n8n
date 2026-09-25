# WhatsApp lead funnel — how the workflows fit together

Five workflows share one lead record (`Leads` tab, key `lead_id`). Only the **opted-in** are ever contacted, and only with approved templates (or, inside the 24 h window, a session reply from workflow 13).

## Entry points
| Entry | Workflow | Result on the lead row |
|---|---|---|
| Landing page / form POST (`lead-capture`) with `consent:true` | 03 | `status=new`, `opt_in=yes (web_form)`; welcome template `WELCOME_D1` sent immediately (`wa_day=1`) |
| Form without consent | 03 | `status=new`, `opt_in=no` — saved, never messaged |
| Waitlist signup (`join-waitlist`) | 04 | waitlist row + email (+ WhatsApp template if consent) — not a `Leads` row |
| Person messages the WhatsApp number | 13 | row created (`source=whatsapp`); replying `BUYER` / `VENDOR` / `START` sets `opt_in=yes (inbound_whatsapp)`; `BUYER`/`VENDOR` → `status=lead_captured` |
| Instagram comment (ManyChat) | 17 | `source=instagram`, `opt_in=no` (Instagram comment ≠ WhatsApp consent) |

## Lifecycle
```
new ──05 (welcome D1→D2→D3)──▶ nurturing ──06 (re-engage 7/14/21 days)──▶ churned
lead_captured ──19 (vendor 1/2/3/7/14 · buyer 1/3/5)──▶ nurturing
any ──STOP──▶ unsubscribed (terminal; START re-subscribes)      converted (set by a human) = never messaged
```
Any inbound WhatsApp message sets `last_message`, resets `reengage_step` and revives a `churned` lead to `nurturing`.

## Conversation logic in workflow 13 (session replies only)
| Incoming text | Reply | Lead update |
|---|---|---|
| `hi`, `hello`, `ciao`, `hey`, `start` | greeting: Eki is a marketplace connecting African foodstuff vendors with buyers worldwide — "Buyer or Vendor?" | `START` also opts in |
| contains `buyer`, `buy`, `acquirente`, `comprare`, `customer`, `shopping` | asks for full name and country | `user_type=buyer`, `intent=medium`, opt-in, `lead_captured` |
| contains `vendor`, `sell`, `venditore`, `vendere`, `seller`, `business`, `shop owner` | asks for name, country and what they sell | `user_type=vendor`, `intent=high`, opt-in, `lead_captured`, **Telegram high-intent alert** |
| anything else | "Thanks for the info! A member of the Eki team will follow up." (+ app link) | `intent` raised to medium |
| `stop`, `unsubscribe`, `quit`, `cancel`, `opt out`, `optout`, `basta`, `stop all` | confirmation; **no further messages** | `status=unsubscribed`, `opt_in=no`, `opt_out_at` |
| any text from an unsubscribed lead (except `START`) | **no reply** | last_message only |

Every reply also ends with "Reply STOP anytime to opt out." Each processed message appends a row to `WhatsApp Conversations` and `Automation Logs`.

## Setup order
1. Sheet + credentials + variables ([docs/setup-instructions.md](docs/setup-instructions.md)).
2. Meta app, webhook, app secret ([WHATSAPP_CLOUD_API_SETUP.md](WHATSAPP_CLOUD_API_SETUP.md)).
3. Templates approved ([docs/whatsapp-templates.md](docs/whatsapp-templates.md)) → `WA_TPL_*`.
4. Publish 13, then 03/04, then the schedules 05, 06, 19 (each stays inert until its templates are configured).
5. Watch the 08:00 controller report on Telegram: it lists missing templates and the opted-in / unsubscribed counts.

## Guarantees checked in staging
Unsubscribed, opted-out, non-opted-in and terminal-status leads are never selected by 05/06/19 even when every other eligibility rule is satisfied; a persistent failure for one lead never re-sends the others; free-form text is never sent to a number that has not written within 24 h (the mock rejects it with 131047 and the suite asserts zero violations).
