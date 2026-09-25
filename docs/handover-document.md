# Handover Document — Eki launch automation system

This document summarizes the final delivery of the Eki launch automation and organic user acquisition system. It outlines what is automated, how data flows, operational instructions for the marketing and tech teams, and recommendations for future enhancements.

---

## 1. System Summary

The **Eki AI Acquisition Machine** is built on **n8n** with **Google Sheets** as database, **WhatsApp Cloud API** for all lead communication, **OpenAI** for content generation, and **Telegram** for alerts and approvals.

This system is designed specifically for **Eki** — a foodstuff marketplace connecting African vendors and exporters with global buyers. It automates:
- Target market lead capture and categorization.
- Early-access waitlist positions and custom referral loops.
- **WhatsApp-only** multi-day onboarding and nurture sequences (no email).
- Daily content generation with human-in-the-loop approvals.
- Comment-to-DM-to-WhatsApp conversion funnels via ManyChat.
- Viral trend intelligence and pain point discovery (self-improving).
- A/B testing and content optimization every 72 hours.
- Social proof generation from marketplace milestones.
- Weekly performance reporting with AI recommendations.

---

## 2. Inventory of Delivered Assets

The project contains the following components:

### A. n8n Workflows (`n8n-workflows/`) — 21 workflows
1.  `01-ai-content-generation.json`: Chronologically generates drafts from calendar topics daily, pushes to sheets, and requests Telegram approval.
2.  `02-content-approval.json`: Receives Telegram bot command buttons (`/approve`, `/reject`, `/edit`), updates sheets, and calls OpenAI to refine drafts.
3.  `03-lead-capture-webhook.json`: De-duplicates incoming leads, appends to Sheets, sends **WhatsApp welcome message** via Cloud API, and fires alerts on high-intent candidates.
4.  `04-waitlist-management.json`: Captures waitlist signups, increments positioning, generates unique referral codes, and fires confirmations via WhatsApp.
5.  `05-whatsapp-welcome-sequence.json`: 3-part WhatsApp sequence (Day 1 Welcome, Day 2 Social Proof, Day 3 CTA) sent via Cloud API.
6.  `06-whatsapp-engagement-followup.json`: Scans leads daily, detects inactive states, sends 7/14/21-day WhatsApp re-engagement messages.
7.  `07-referral-campaign.json`: Credits referring accounts, triggers Resend reward notifications on point milestones (3 & 5 referrals).
8.  `08-feedback-collection.json`: Collects survey rating hook callbacks. Routes ratings >=4 to App Store review requests and <=2 to urgent Telegram alerts.
9.  `09-weekly-analytics-report.json`: Monday cron aggregating weekly signups, leads count, posts created, and NPS rating into a weekly HTML email report.
10. `10-social-post-scheduler.json`: Scans approved drafts every 2 hours, triggers direct Twitter/X posts, queues Buffer API items, or alerts team for manual post fallback.

### B. Content Strategy Assets (`content-strategy/`)
- `30-day-content-calendar.md`: Pre-seeded calendar structure including target dates, platforms, pillars, hooks, captions, and CTAs.
- `content-pillars.md`: 5 strategy pillars (Behind the Scenes, Problem Awareness, Educational Value, Social Proof, Community), platform guidelines, hooks library, video script templates, and referral campaigns.
- `launch-announcement-sequence.md`: Pre-written 7-step sequence counting down from pre-launch teaser (T-7) to launch day and post-launch milestone.
- **Email Copy Templates** (`content-strategy/email-sequences/`):
  - `welcome-sequence.md`: 3-part onboarding html email copies.
  - `follow-up-sequence.md`: 3-part re-engagement html email copies.
  - `referral-invitation.md`: Referral explanation copy.
  - `feedback-request.md`: 7-day feedback request html copy.
  - `app-review-request.md`: NPS promoter review request email.

### C. Database Schemas (`schemas/`)
- `google-sheets-schema.md`: 6 sheets schemas defining columns, types, and relationships.
- `airtable-schema.md`: Airtable schema mapping with field types and linked records if migrating to Airtable.

### D. Documentation (`docs/`)
- `setup-instructions.md`: Deployment manual.
- `api-keys-required.md`: Directory of API credentials.
- `workflow-diagram.md`: Mermaid flow charts.
- `testing-checklist.md`: Simulation payloads and curl instructions.

---

## 3. Operational Guidelines

### Daily Content Flow
1.  **AI Generation**: At 9:00 AM Africa/Lagos timezone, workflow 01 runs. It picks the day's topic, creates drafts, and posts them to your team Telegram group chat.
2.  **Approval Step**: A manager reviews the draft.
    - Click **Approve** (via bot interface buttons) -> Post queue.
    - Click **Reject** -> Sent back to OpenAI for a clean rewrite.
3.  **Posting**: Every 2 hours, workflow 10 checks for approved posts.
    - Twitter/X: Auto-posted.
    - Facebook/Instagram/LinkedIn: Auto-queued via Buffer.
    - TikTok/Reddit: Pushed to Telegram as a copy-paste warning. Manually upload video/text on target app.

### Handling Errors & Outages
- **n8n Executions log**: Periodically check n8n's Execution History. Filter by "Failed" to verify if any HTTP request timed out.
- **Rate Limits**: Resend limits free accounts to 100 emails/day. If signup velocity spikes, upgrade your Resend subscription. OpenAI rate limits can be avoided by maintaining API account balances.

---

## 4. Next Phase Recommendations

1.  **Direct API Posting**: Upgrade manual TikTok/Reels posting using the official TikTok Content Posting API and Meta Graph API once Eki obtains verified developer organization status.
2.  **Interactive AI Agent**: Set up an n8n AI Agent node (using OpenAI Assistants or LangChain memory nodes) to handle custom incoming customer queries from Typeform/Tally webhooks dynamically before routing to manual support.
3.  **CRM Syncing**: Integrate HubSpot or ActiveCampaign nodes alongside Google Sheets to track vendor lead lifecycles through pipeline deals.

---

## 5. Advanced Workflows (New — Acquisition Machine)

### 15. Viral Intelligence Engine
- **Schedule**: Every 6 hours
- **Function**: Scrapes Instagram/TikTok/competitor trends via Apify, analyzes with GPT-4o, extracts hook patterns/emotional triggers/content formats
- **Output**: Updates Intelligence DB, sends Telegram summary
- **Triggers**: Content Engine (provides fresh patterns)

### 16. Pain Discovery Engine
- **Schedule**: Daily at 6:00 AM
- **Function**: Scrapes Reddit/Facebook for audience pain points, GPT-4o categorizes by persona/intensity
- **Output**: Populates PainPoints DB with tagged entries

### 17. ManyChat Comment Funnel
- **Trigger**: Webhook (ManyChat sends comment data)
- **Function**: Detects keyword from Instagram comment → routes to vendor/buyer journey → sends WhatsApp link via DM
- **Output**: Logs lead, alerts Telegram for high-intent
- **Setup**: Requires ManyChat Pro ($15-45/mo) connected to Instagram Business accounts

### 18. Content Multiplication Engine
- **Trigger**: Webhook (on content approval)
- **Function**: Takes 1 core idea → expands to 15-25 format variations (reel, TikTok, carousel, story, FB post, caption variants)
- **Output**: Queues all variations to ContentQueue sheet

### 19. WhatsApp Nurture Sequences
- **Schedule**: Daily at 8:00 AM
- **Function**: Sends personalized 14-day vendor sequence (Welcome→Proof→How It Works→Demo→Objections→CTA→Final Push) and 7-day buyer sequence (Trust→Proof→Browse→Incentive→Nudge)
- **Output**: Sends WhatsApp messages via Cloud API, tracks nurture day in Leads sheet

### 20. A/B Testing Engine
- **Schedule**: Every 72 hours
- **Function**: Scores posted content by engagement, identifies winners/losers, GPT-4o analyzes patterns
- **Output**: Updates Hook Library with winning patterns, sends Telegram briefing

### 21. Social Proof Engine
- **Trigger**: Webhook (from Eki backend events)
- **Function**: Detects milestones (1st order, 50th order, new country, positive review) → GPT-4o generates proof content → queues for review
- **Output**: SocialProof DB entries, Telegram notification

### 22. Performance Analyst Agent
- **Schedule**: Every Monday at 9:00 AM
- **Function**: Aggregates all system data (leads, content, engagement), GPT-4o deep analysis, generates recommendations
- **Output**: Weekly report logged to Analytics, emailed via Resend, Telegram summary

---

## 6. New Database Tables in Google Sheets / Airtable

Add these sheets/tables to your existing database:

| Table | Populated By | Purpose |
|-------|-------------|---------|
| `Intelligence` | Workflow 15 | Viral patterns, hooks, emotions |
| `PainPoints` | Workflow 16 | Audience pain points |
| `ContentQueue` | Workflow 18 | Multiplied content awaiting approval |
| `SocialProof` | Workflow 21 | Auto-generated proof content |

### Intelligence Columns:
`type | content | source | emotion | engagement_score | date_discovered`

### PainPoints Columns:
`pain_statement | persona | category | intensity | source | keywords | usage_count`

### ContentQueue Columns:
`format | content | hook_variant | status | source_idea | created_at`

### SocialProof Columns:
`event_type | vendor_name | metric | content_json | status | created_at`
