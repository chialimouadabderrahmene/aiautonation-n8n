# Autopilot Controller Guide

Documentation for workflow `14-autopilot-controller.json` — the central brain of Eki's launch automation.

---

## Overview

The Autopilot Controller runs daily at 8:00 AM (Africa/Lagos) and orchestrates all automation:

- Checks system status and API availability
- Schedules or surfaces social posts
- Follows up with WhatsApp leads
- Sends a daily Telegram summary
- Logs everything
- Respects emergency stop and safety limits

---

## How It Works

```
[8:00 AM Cron]
      │
      ▼
[Emergency Stop Check] ──► AUTOPILOT_STOP=true → Alert & Halt
      │
     OK
      │
      ▼
[Gather Env Status] → Check all API keys & settings
      │
      ├──► [Read Social Posts]  → Process pending posts
      ├──► [Read Leads]         → Find follow-up candidates
      └──► [Read WhatsApp]      → Count conversations
              │
              ▼
      ┌─── [Social Autopilot ON?]
      │           │
     Yes          No
      │           │
      ▼           │
[Has Posting API?]│
   │       │      │
  Yes      No     │
   │       │      │
   ▼       ▼      │
[Publish] [Telegram│
 to API]  Summary] │
   │       │       │
   └───┬───┘───────┘
       │
       ├──► [WhatsApp Follow-ups] (if pending leads)
       │
       ▼
[Build Daily Summary]
       │
       ▼
[Telegram Daily Report]
       │
       ▼
[Log to Automation Logs]
```

---

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_CHAT_ID` | Daily summary + alerts destination |
| `AUTOPILOT_SOCIAL_POSTING` | `true` or `false` — controls social posting |
| `AUTOPILOT_STOP` | `true` = emergency halt all automation |

### Optional (Posting APIs)

| Variable | Purpose |
|----------|---------|
| `BUFFER_API_KEY` | Auto-post via Buffer |
| `METRICOOL_API_KEY` | Auto-post via Metricool |
| `META_ACCESS_TOKEN` | Direct Meta Graph API posting |
| `TIKTOK_ACCESS_TOKEN` | Direct TikTok API posting |

### Optional (WhatsApp Follow-ups)

| Variable | Purpose |
|----------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Send follow-up messages |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business number |
| `APP_DOWNLOAD_LINK` | Link included in follow-ups |

### Optional (Limits)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_POSTS_PER_DAY` | `3` | Max posts per platform per day |

---

## Safety Mechanisms

### 1. Emergency Stop

Set `AUTOPILOT_STOP=true` in Railway to immediately halt all automation.

- Controller sends a Telegram alert and exits.
- No posts scheduled, no follow-ups sent.
- To resume: set `AUTOPILOT_STOP=false` and redeploy.

### 2. Max Posts Per Platform

- Default: 3 posts per platform per day.
- Configurable via `MAX_POSTS_PER_DAY` env var.
- Posts exceeding the limit are blocked with reason `max_posts_reached`.

### 3. No Duplicate Posts Within 24h

- Compares captions against all posts from the last 24 hours.
- Identical captions are blocked with reason `duplicate_within_24h`.

### 4. WhatsApp Anti-Spam

- Only follows up users who messaged first (opted in).
- Never messages unsubscribed users.
- Max 10 follow-ups per controller run.
- Only follows up if last message is older than 24 hours.
- Every follow-up includes "Reply STOP to unsubscribe."

### 5. Graceful Failures

- All HTTP nodes use `continueOnFail: true`.
- Missing APIs don't crash the workflow.
- Errors are captured and reported in the daily summary.

---

## Import & Setup

1. Import `n8n-workflows/14-autopilot-controller.json` into n8n.
2. Link credentials:
   - All Google Sheets nodes → Google Sheets OAuth2
   - All Telegram nodes → Telegram Bot
3. Set `documentId` in all Google Sheets nodes to your spreadsheet.
4. Ensure these tabs exist in your spreadsheet:
   - **Social Posts** (populated by workflow 12)
   - **Leads** (populated by workflow 13)
   - **WhatsApp Conversations** (populated by workflow 13)
   - **Automation Logs** (shared across all workflows)
5. Set environment variables in Railway.
6. Activate the workflow.

---

## Daily Telegram Summary

You'll receive a message like this every day at ~8:00 AM:

```
📊 Eki Autopilot Daily Report
📅 2025-05-22

━━━━━━━━━━━━━━━━━━━━
👥 Leads
• Captured today: 5
• Total leads: 47
• Unsubscribed: 2

━━━━━━━━━━━━━━━━━━━━
📱 Social Posts
• Generated today: 3
• Scheduled: 3
• Ready (manual): 0
• Blocked: 0

━━━━━━━━━━━━━━━━━━━━
💬 WhatsApp
• Conversations today: 8
• Follow-ups sent: 3

━━━━━━━━━━━━━━━━━━━━
⚙️ Status
• Social autopilot: ✅ ON
• Posting API: ✅ Connected
• Errors: none

━━━━━━━━━━━━━━━━━━━━
🤖 Eki Autopilot Controller v1.0
```

---

## Testing

### Manual Test

1. Open the workflow in n8n editor.
2. Click **Execute Workflow**.
3. Check:
   - Telegram receives the daily summary.
   - Automation Logs has a new entry.
   - If posts are pending, they're processed correctly.

### Test Emergency Stop

1. Set `AUTOPILOT_STOP=true` in Railway.
2. Execute workflow manually.
3. Verify: Telegram receives emergency alert, no other actions taken.
4. Set back to `false`.

### Test With No APIs

1. Remove all posting API keys.
2. Set `AUTOPILOT_SOCIAL_POSTING=true`.
3. Execute workflow.
4. Verify: Telegram receives "ready-to-post" summary instead of publishing.

---

## Interaction With Other Workflows

| Workflow | Relationship |
|----------|-------------|
| 12 - AI Social Autopilot | Generates posts → Controller schedules them |
| 13 - WhatsApp Lead Funnel | Captures leads → Controller follows up |
| 09 - Weekly Analytics | Controller checks report status |
| All workflows | Controller reads Automation Logs for error detection |

### Execution Order (Daily)

```
8:00 AM → 14-autopilot-controller (orchestrates)
9:00 AM → 12-ai-social-autopilot (generates new content)
```

The controller runs first to handle yesterday's pending items. The social autopilot runs after to generate today's fresh content.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No summary received | Telegram credential not linked | Re-link Telegram Bot credential |
| "Emergency stop" every day | `AUTOPILOT_STOP` stuck on true | Set to `false` in Railway |
| Posts not scheduling | `AUTOPILOT_SOCIAL_POSTING=false` | Set to `true` |
| Follow-ups not sending | No `WHATSAPP_ACCESS_TOKEN` | Add token to Railway env |
| "0 posts generated" | Workflow 12 hasn't run yet | Controller runs at 8AM, content at 9AM — check yesterday's posts |
| Blocked posts | Max limit or duplicates | Check `blocked_posts` in execution log |
| Sheets read fails | Credential expired | Re-authorize Google Sheets OAuth2 |

---

## Recommended Startup Configuration

For initial launch, use these conservative settings:

```env
AUTOPILOT_SOCIAL_POSTING=false    # Review posts manually first
AUTOPILOT_STOP=false              # System running
MAX_POSTS_PER_DAY=2               # Conservative limit
```

Once you're confident in the content quality:

```env
AUTOPILOT_SOCIAL_POSTING=true     # Enable auto-posting
BUFFER_API_KEY=your-key           # Add a posting API
MAX_POSTS_PER_DAY=3               # Standard limit
```
