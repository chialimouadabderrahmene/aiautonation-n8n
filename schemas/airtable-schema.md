> **Legacy / not maintained.** Google Sheets is the supported store (see `google-sheets-schema.md` and `sheet-columns.json`, 16 tabs). This Airtable mapping was written for an earlier, smaller data model and has NOT been updated or tested against the current workflows.

# Eki Marketplace Launch — Airtable Schema

For teams using Airtable as their relational database instead of Google Sheets, this document outlines the exact field types, tables, relationships, and views required. Airtable provides strong relational links and built-in Kanban/Calendar views.

---

## Database Architecture (Relational ERD)

```
  [Leads] ────(1:1)────> [Waitlist]
     │                      │
     │                      └───(Self-Link 1:N)───> Referred Leads
     │
  [Feedback] (N:1) ──> [Leads]
```

---

## 1. Table: Leads
Tracks all signups, tagging segments, geographic location, and interaction logs.

| Field Name | Airtable Field Type | Configurations / Options | Notes |
|:---|:---|:---|:---|
| `lead_id` | Formula | `CONCATENATE("L-", RECORD_ID())` | Unique tracking key |
| `email` | Email | Required | Lowercased |
| `name` | Single line text | Required | User's full name |
| `user_segment` | Single select | `Vendor (Domestic)`, `Vendor (Exporter)`, `Buyer (Local)`, `Buyer (International)` | User segment classification |
| `country` | Single select | `Nigeria`, `Italy`, `Ghana`, `Kenya`, `Other` | Geographic origin |
| `foodstuff_specialty`| Multiple select | `Spices`, `Tuber Crops`, `Palm & Oils`, `Grains & Flour`, `Seafood/Fish`, `Vegetables`, `Other` | Categories of trade interest |
| `source` | Single select | `TikTok`, `Instagram`, `X/Twitter`, `LinkedIn`, `Referral`, `Waitlist` | Marketing source |
| `interest_level` | Single select | `Low`, `Medium`, `High`, `Ready to Onboard` | Lead quality scoring |
| `referral_code` | Single line text | Optional | Code from inviter |
| `signup_date` | Date | `YYYY-MM-DD` | Date of registry |
| `status` | Single select | `New`, `Welcome Sent`, `Active`, `Inactive`, `Churned` | Onboarding lifecycle |
| `last_contacted` | Date/time | `YYYY-MM-DD HH:mm` | Timestamp of Resend log |
| `feedback` | Link to `Feedback` | Link to multiple records | Relations to review logs |

### Views
- **All Leads Grid**: Master spreadsheet view sorted by `signup_date` descending.
- **Vendors Segment**: Filtered by `user_segment = Vendor (Domestic)` or `Vendor (Exporter)`.
- **Buyers Segment**: Filtered by `user_segment = Buyer (Local)` or `Buyer (International)`.

---

## 2. Table: Content Calendar
Seeded launch content pillars and post configurations.

| Field Name | Airtable Field Type | Options / Config | Notes |
|:---|:---|:---|:---|
| `day_number` | Number | Integer | Launch day (1 to 30) |
| `phase` | Single select | `Pre-Launch Hype`, `Launch Week`, `Post-Launch Growth` | Campaign phases |
| `pillar` | Single select | `Problem Awareness`, `Behind the Scenes`, `Social Proof`, `Education`, `Community` | Topic engine |
| `suggested_platform`| Multiple select | `TikTok`, `Instagram`, `X/Twitter`, `LinkedIn` | Platforms target |
| `topic_brief` | Long text | Rich text disabled | Base topic summary |
| `suggested_hook` | Long text | Rich text disabled | Scroll-stopping angle |
| `cta` | Single line text | Target URL / action | Link to waitlist/app store |
| `target_audience` | Single select | `Vendors`, `Buyers`, `Exporters`, `All` | Segment target |
| `drafts` | Link to `Content Drafts` | Link to multiple records | Relational drafts link |

### Views
- **30-Day Master Schedule**: Grid ordered by `day_number` ascending.

---

## 3. Table: Content Drafts
Sandbox for generating, editing, approving, and publishing AI copy.

| Field Name | Airtable Field Type | Options / Formula | Notes |
|:---|:---|:---|:---|
| `draft_id` | Formula | `CONCATENATE("D-", day_number, "-", platform)` | Generated code |
| `day_number` | Link to `Content Calendar` | Limit to 1 record selection | Reference calendar day |
| `platform` | Single select | `TikTok`, `Instagram`, `X/Twitter`, `LinkedIn` | Active platform |
| `hook` | Long text | Required | generated hook |
| `caption` | Long text | Required | Caption text |
| `hashtags` | Single line text | Required | E.g. `#AfricanFood` |
| `video_script` | Long text | Optional | Storyboard script |
| `status` | Single select | `Draft`, `Approved`, `Needs Revision`, `Published` | Approval lifecycle |
| `approval_date` | Date/time | `YYYY-MM-DD HH:mm` | Timestamp on Telegram approval |
| `published_date` | Date/time | `YYYY-MM-DD HH:mm` | Timestamp on social deployment |

### Views
- **Approval Kanban Board**: Stacked columns grouped by `status` (`Draft`, `Needs Revision`, `Approved`, `Published`).
- **Calendar Schedule**: Calendar layout keyed on `published_date` for scheduling.

---

## 4. Table: Waitlist
Waitlist positions and referral loops.

| Field Name | Airtable Field Type | Formula / Options | Notes |
|:---|:---|:---|:---|
| `email` | Email | Required | Primary key |
| `name` | Single line text | Required | User full name |
| `signup_date` | Date | `YYYY-MM-DD` | Registry date |
| `referral_code` | Single line text | Unique | E.g. `WL-EKI-2A8` |
| `referred_by` | Link to `Waitlist` | Limit to 1 record (Self link) | User who invited them |
| `referrals` | Link to `Waitlist` | Link to multiple records (Self link reverse) | Array of users invited |
| `referrals_count` | Formula | `COUNTA(referrals)` | Count of referrals |
| `waitlist_score` | Formula | `DATETIME_DIFF(TODAY(), signup_date, 'days') + (referrals_count * 10)` | Dynamic prioritization score |

### Views
- **Waitlist Leaderboard**: Sorted by `waitlist_score` descending.

---

## 6. Table: Intelligence
Viral patterns, hooks, emotions, and creator analysis — populated by Workflow 15 every 6h.

| Field Name | Type | Options | Notes |
|:---|:---|:---|:---|
| `type` | Single select | `hook`, `emotion`, `format`, `creator`, `audio` | Content type |
| `content` | Long text | | The hook/pattern text |
| `source` | Single select | `instagram`, `tiktok`, `facebook`, `competitor` | Origin platform |
| `emotion` | Single select | `fear`, `pride`, `aspiration`, `frustration`, `trust` | Emotional trigger |
| `engagement_score` | Number | Decimal | Performance metric |
| `date_discovered` | Date | `YYYY-MM-DD` | When found |

## 7. Table: PainPoints
Audience pain points harvested by Workflow 16 daily.

| Field Name | Type | Options | Notes |
|:---|:---|:---|:---|
| `pain_statement` | Long text | | Verbatim from source |
| `persona` | Single select | `vendor`, `buyer` | Who feels this pain |
| `category` | Single select | `DM_Chaos`, `Payment_Fraud`, `Scam_Fear`, `No_Buyers`, `Trust`, `Shipping`, `Price` | Pain category |
| `intensity` | Number | 1–10 | Emotional intensity |
| `source` | Single select | `reddit`, `facebook`, `youtube`, `twitter`, `survey` | Origin |
| `keywords` | Long text | | Exact audience words |
| `usage_count` | Number | | Times used in content |

## 8. Table: SocialProof
Auto-generated proof content from Workflow 21.

| Field Name | Type | Options | Notes |
|:---|:---|:---|:---|
| `event_type` | Single select | `first_sale`, `milestone`, `review`, `new_country`, `order_total` | Trigger event |
| `vendor_name` | Single line text | | Who achieved it |
| `metric` | Single line text | | e.g. "50th order" |
| `content_json` | Long text | | Generated content bundle |
| `status` | Single select | `pending`, `approved`, `published` | Content lifecycle |
| `created_at` | Date/time | | Auto timestamp |

## 9. Table: ContentQueue
Multiplication engine output from Workflow 18.

| Field Name | Type | Options | Notes |
|:---|:---|:---|:---|
| `format` | Single select | `reel`, `tiktok`, `carousel`, `story`, `fb_post`, `caption` | Content format |
| `content` | Long text | | The generated content |
| `hook_variant` | Long text | | Alternative hook |
| `status` | Single select | `pending`, `approved`, `rejected` | Approval status |
| `source_idea` | Long text | | Original core idea |
| `created_at` | Date/time | | Timestamp |

## 5. Table: Feedback
Reviews and marketplace feedback storage.

| Field Name | Airtable Field Type | Options / Config | Notes |
|:---|:---|:---|:---|
| `feedback_id` | Formula | `CONCATENATE("F-", Record_ID())` | Unique ID |
| `lead` | Link to `Leads` | Limit to 1 record selection | Relational link to Leads |
| `email` | Lookup | `lead.email` | Lookup email |
| `rating` | Rating | 5-star metric | Score |
| `primary_value` | Long text | Required | Positives |
| `pain_point` | Long text | Required | Negatives / bugs |
| `would_recommend` | Single select | `Yes`, `No`, `Maybe` | NPS |
| `submitted_date` | Date | `YYYY-MM-DD` | Registry stamp |
| `action_taken` | Single select | `Pending Review`, `Resolved`, `Forwarded to Product` | Progress log |

### Views
- **Critical Issues Grid**: Filtered by `rating` ≤ 2.
- **NPS Promoter Grid**: Filtered by `would_recommend = Yes` and `rating` ≥ 4.
