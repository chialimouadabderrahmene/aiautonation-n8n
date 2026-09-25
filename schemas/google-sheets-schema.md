# Eki Launch Database — Google Sheets schema (16 tabs)

Create one spreadsheet named **Eki Launch Database** and add the tabs below **with these exact names and header names in row 1** (header-only CSVs are in [`sheet-templates/`](../sheet-templates) — File → Import → "Insert new sheet"). The machine-readable source of truth is [`sheet-columns.json`](sheet-columns.json): the workflows, the staging mock and `tools/validate-workflows.js` all read it, and the build fails if a workflow writes a column that does not exist.

Rules: keep header names exactly (n8n maps by header name and checks them); never insert columns in the middle of another tab's header without updating the workflows; the Leads/Waitlist/Feedback tabs contain personal data — restrict sheet sharing accordingly. Phone numbers are stored as digits in international format without `+` (e.g. `2348012345678`).

> Google Sheets is the supported store. `airtable-schema.md` is a legacy alternative that was **not** updated or tested for the current workflows.

## Leads (central lead record — one row per person)
Key: `lead_id` (`P<digits>` for phone leads, `E<email>` for email-only leads, `I<instagram handle>` for ManyChat leads). All "upserts" match on `lead_id`, so a person is never duplicated.

| Column | Meaning |
|---|---|
| `lead_id`, `phone`, `email`, `name` | identity |
| `user_type` | `vendor` \| `buyer` \| `unknown` |
| `user_segment`, `country`, `foodstuff_specialty`, `interest_level` | optional descriptive fields (manual) |
| `source` | `web`, `whatsapp`, `instagram`, `referral`, … |
| `intent_level` | `low` \| `medium` \| `high` |
| `status` | `new` (web/form lead in the welcome sequence) → `lead_captured` (engaged on WhatsApp, segmented nurture) → `nurturing` (sequence finished, eligible for re-engagement) → `converted` / `churned` / `unsubscribed` (terminal; never messaged). `active` = app user (feedback flow). |
| `opt_in` | `yes` \| `no`. **Only `yes` + empty `opt_out_at` may be messaged.** |
| `opt_in_source`, `opt_in_at` | `web_form` \| `inbound_whatsapp` and when |
| `opt_out_at` | set when the person sends STOP; cleared only by START or a fresh consented form |
| `signup_date`, `first_contact` | dates |
| `last_message` | last INBOUND WhatsApp message (ISO) |
| `last_wa`, `wa_day` | last outbound template + welcome day counter (05) |
| `last_nurture`, `nurture_day` | last nurture send + last nurture step reached (19) |
| `last_reengage`, `reengage_step` | re-engagement state 0-3 (06) |
| `referral_code` | code of the referrer, if any |
| `feedback_requested_date`, `feedback_received_date`, `last_feedback_rating` | feedback flow (08) |
| `last_wa_error` | last WhatsApp send error (why a lead was skipped) |
| `notes` | manual |

## Waitlist
`email`, `whatsapp`, `name`, `position`, `referral_code`, `referrals_count`, `user_type` (`Vendor`\|`Buyer`), `signup_date`, `consent` (`yes`\|`no`). Position = row count + 1 at signup; concurrent signups in the same second can share a position (documented limitation).

## Referrals
`referral_id`, `referrer_email`, `referred_email`, `referral_code`, `timestamp`, `points_credited`, `status`. Workflow 07 refuses to record the same `referred_email` twice.

## Content Calendar
`day_number` (1-30), `phase`, `pillar`, `suggested_platform`, `topic_brief`, `suggested_hook`, `cta`, `target_audience` — the seeded launch plan (see `content-strategy/30-day-content-calendar.md`).

## Content Drafts
`draft_id`, `day_number`, `platform`, `hook`, `caption`, `hashtags`, `video_script`, `status` (`Draft` → `Approved` / `Rejected` → `Published` / `Notification Sent`), `approval_date`, `published_date`, `publish_time`, `row_number`, `published` (`TRUE`/`FALSE`), `created_date`.

## Feedback
`feedback_id`, `email`, `user_role`, `rating` (1-5), `primary_value`, `pain_point`, `comments`, `would_recommend` (`TRUE`/`FALSE`), `submitted_date`, `action_taken`, `rating_category` (`positive`\|`neutral`\|`negative`).

## Analytics (owned by workflow 09)
`report_date`, `week_start`, `total_leads`, `new_leads`, `conversion_rate`, `content_published`, `avg_feedback_rating`, `waitlist_size`, `total_referrals`, `wow_growth`.

## Agent Reports (owned by workflow 22)
`report_date`, `total_leads`, `vendors`, `buyers`, `posts`, `engagement`, `recommendations`. (Separate from `Analytics` on purpose: two workflows used to write different columns into the same tab.)

## Intelligence (15, 20)
`type`, `content`, `score`, `source`, `created`.

## PainPoints (16)
`pain`, `category`, `intensity`, `persona`, `keywords`, `upvotes`, `source`, `created`.

## ContentQueue (18)
`format`, `content`, `status` (`pending`), `source`, `created`.

## SocialProof (21)
`event`, `vendor`, `content` (JSON), `status` (`pending`), `created`.

## Social Posts (12)
`date`, `platform`, `content_type`, `hook`, `caption`, `hashtags`, `video_script`, `status` (`approved`\|`flagged`), `autopilot_status`, `scheduled_at`, `published_at`, `flag_reason` (why the safety net flagged it). *(The column was called `error` before; n8n's retry logic treats an `error` key on an output item as a failure, which made a successful append run three times.)*

## Automation Logs (12, 13, 14)
`timestamp`, `workflow`, `action`, `platform`, `status`, `details`.

## WhatsApp Conversations (13)
`timestamp`, `phone`, `direction`, `message_text`, `reply_sent`, `conversation_step`, `user_type`, `intent_level`, `message_id`. Contains message text — personal data; prune periodically.

## PublishedContent (20, 22) — filled manually
`hook`, `format`, `platform`, `comments`, `saves`, `shares`, `published_date`. Nothing in this repo writes this tab; copy it from your social analytics exports.

## Example lead row
`P2348012345678`, `2348012345678`, ``, `Funmi Alao`, `vendor`, …, `whatsapp`, ``, `high`, `lead_captured`, `yes`, `inbound_whatsapp`, `2026-09-21T10:12:00.000Z`, ``, … (QA data only in staging — never seed fake rows into the production sheet: they would be messaged).
