# Eki Marketplace Launch — Google Sheets Schema

This document outlines the exact database schema required for the **Eki** mobile app launch automation system. Eki is an African/Italian marketplace connecting foodstuff vendors (domestic and exporters) with international and local buyers.

To set this up, create a single Google Spreadsheet named **Eki Launch Database** and add the following 6 sheets (tabs).

---

## 1. Sheet: Leads
Tracks all signups, their segment, and their stage in the onboarding funnel.

### Columns Definition
| Column Name | Data Type | Validation Rules / Options | Description |
|:---|:---|:---|:---|
| `lead_id` | Text (Primary Key) | Auto-generated in n8n (e.g. `L-1001`) | Unique identifier for each lead. |
| `email` | Email | Required, Must be unique, lowercase | The primary contact email of the user. |
| `name` | Text | Required | Full name of the contact. |
| `user_segment` | Single Select | `Vendor (Domestic)`, `Vendor (Exporter)`, `Buyer (Local)`, `Buyer (International)` | Identifies target user segment. |
| `country` | Text | E.g. `Nigeria`, `Italy`, `Ghana`, `Kenya` | Country of operation. |
| `foodstuff_specialty`| Text | E.g. `Spices`, `Flour/Tubers`, `Palm Oil`, `Dried Fish`, `Fresh Veg` | Main product categories interest. |
| `source` | Text | E.g. `tiktok`, `instagram`, `linkedin`, `referral`, `waitlist` | Acquisition channel. |
| `interest_level` | Single Select | `Low`, `Medium`, `High`, `Ready to Onboard` | Inferred level of intent. |
| `referral_code` | Text | Optional (e.g. `WL-JOH-12a`) | Code of the person who referred them. |
| `signup_date` | Date | `YYYY-MM-DD` | Date of registration. |
| `status` | Single Select | `New`, `Welcome Sent`, `Active`, `Inactive`, `Churned` | Onboarding/Engagement state. |
| `last_contacted` | Date/Time | `YYYY-MM-DD HH:MM:SS` | Timestamp of the last email sent via Resend. |
| `notes` | Long Text | Optional | Manual follow-up notes. |

### Example Row
`L-1001`, `funmi.bakes@gmail.com`, `Funmi Alao`, `Vendor (Exporter)`, `Nigeria`, `Yam flour & spices`, `instagram`, `High`, ``, `2026-05-21`, `New`, `2026-05-21 20:30:00`, `Wants to export spices to Italy`

---

## 2. Sheet: Content Calendar
A pre-seeded list of daily posting ideas mapping out the 30-day content launch strategy for Eki.

### Columns Definition
| Column Name | Data Type | Validation Rules | Description |
|:---|:---|:---|:---|
| `day_number` | Number | 1 to 30 | Day index of the launch strategy. |
| `phase` | Single Select | `Pre-Launch Hype`, `Launch Week`, `Post-Launch Growth` | Launch stage. |
| `pillar` | Single Select | `Problem Awareness`, `Behind the Scenes`, `Social Proof`, `Education`, `Community` | Content category. |
| `suggested_platform`| Text | `TikTok`, `Instagram Reels`, `X/Twitter`, `LinkedIn` | Primary platforms. |
| `topic_brief` | Text | Short description | Content theme/focus. |
| `suggested_hook` | Text | Scroll-stopping hook suggestion | Input for the AI generator node. |
| `cta` | Text | Call-to-action details | Target link or user action. |
| `target_audience` | Single Select | `Vendors`, `Buyers`, `Exporters`, `All` | Segment targeted. |

### Example Row
`1`, `Pre-Launch Hype`, `Problem Awareness`, `TikTok, Instagram`, `Exporters struggling with payment trust`, `Finding a trusted buyer in Italy shouldn't feel like a lottery.`, `Join the Eki Waitlist to sell safely`, `Exporters`

---

## 3. Sheet: Content Drafts
Where generated drafts are saved for approval and scheduling.

### Columns Definition
| Column Name | Data Type | Options / Validation | Description |
|:---|:---|:---|:---|
| `draft_id` | Text (Primary Key) | Auto-generated (e.g. `D-201`) | Unique draft ID. |
| `day_number` | Number | References `Content Calendar` | Day number of calendar. |
| `platform` | Text | `TikTok`, `Instagram`, `X/Twitter`, `LinkedIn` | Chosen platform. |
| `hook` | Text | Generated hook | Scroll-stopper. |
| `caption` | Long Text | Generated post content | The main body of the post. |
| `hashtags` | Text | Generated hashtags | E.g. `#AfricanFood #EkiMarket` |
| `video_script` | Long Text | Generated short-form video script | Video storyboard/audio cues. |
| `status` | Single Select | `Draft`, `Approved`, `Needs Revision`, `Published` | Workflow state. |
| `approval_date` | Date/Time | Timestamp | Filled on Telegram approval. |
| `published_date` | Date/Time | Timestamp | Filled by scheduler. |

---

## 4. Sheet: Waitlist
Manages pre-launch waitlist positions and referral points.

### Columns Definition
| Column Name | Data Type | Formula / Rule | Description |
|:---|:---|:---|:---|
| `email` | Email | Primary Key, Lowercase | Waitlist contact. |
| `name` | Text | Required | User's name. |
| `position` | Number | Auto-increment or lookup formula | Current position in waitlist line. |
| `referral_code` | Text | Unique (e.g. `WL-EKI-2A8`) | Referral link token. |
| `referrals_count` | Number | Default: `0` | Number of friends referred who signed up. |
| `user_type` | Single Select | `Vendor`, `Buyer` | User segment. |
| `signup_date` | Date | `YYYY-MM-DD` | Waitlist registration date. |

### Waitlist Ranking Formula
To dynamically move users up based on referrals, use this formula in a `current_position` helper sheet or sort query:
`=RANK(signup_date, signup_date, 1) - (referrals_count * 5)` (every referral moves them up 5 positions).

---

## 5. Sheet: Feedback
Stores feedback collected from active users on Eki.

### Columns Definition
| Column Name | Data Type | Options / Range | Description |
|:---|:---|:---|:---|
| `feedback_id` | Text | Unique ID | Feedback instance ID. |
| `email` | Email | Required | User email. |
| `user_role` | Single Select | `Vendor`, `Buyer` | Role on the marketplace. |
| `rating` | Number | 1 to 5 stars | Overall rating of marketplace usability. |
| `primary_value` | Text | Long text | What they love most about Eki. |
| `pain_point` | Text | Long text | What was difficult (e.g. shipping, payment). |
| `would_recommend` | Boolean | `TRUE`/`FALSE` | NPS style question. |
| `submitted_date` | Date | `YYYY-MM-DD` | Submission date. |
| `action_taken` | Text | `Pending Review`, `Resolved`, `Forwarded to Dev` | Status of feedback. |

---

## 6. Sheet: Weekly Analytics
Stores weekly performance summaries generated by the analytics workflow.

### Columns Definition
| Column Name | Data Type | Formula / Source | Description |
|:---|:---|:---|:---|
| `week_ending` | Date | Weekly interval date | Last day of the reporting week. |
| `new_leads` | Number | Count from Leads sheet | Total new leads acquired. |
| `new_vendors` | Number | Count from Leads segment | Active vendors onboarded. |
| `new_buyers` | Number | Count from Leads segment | Active buyers onboarded. |
| `total_waitlist` | Number | Count from Waitlist sheet | Total size of pre-launch list. |
| `referral_signups` | Number | Sum of referrals | Leads generated via referral. |
| `conversion_rate` | Percentage | `(New Active Leads / New Leads) * 100` | Percentage of leads who activated. |
| `posts_approved` | Number | Count from Drafts sheet | Count of content items approved. |
| `avg_feedback` | Number | Average of rating from Feedback | Weekly average star rating. |
