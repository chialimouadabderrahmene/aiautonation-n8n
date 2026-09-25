# Social Autopilot Testing Guide

Testing documentation for workflow `12-ai-social-autopilot.json`.

---

## Required Credentials

| Credential | Type | Required | Purpose |
|-----------|------|----------|---------|
| `ANTHROPIC_API_KEY` | Environment Variable | One of Claude/OpenAI | AI content generation (primary) |
| `OPENAI_API_KEY` | Environment Variable | One of Claude/OpenAI | AI content generation (fallback) |
| `TELEGRAM_CHAT_ID` | Environment Variable | Yes | Notification delivery |
| Telegram Bot | n8n Credential | Yes | Send messages to Telegram |
| Google Sheets OAuth2 | n8n Credential | Yes | Save content + logs |
| `AUTOPILOT_SOCIAL_POSTING` | Environment Variable | Yes | `true` or `false` |
| `BUFFER_API_KEY` | Environment Variable | Optional | Auto-post via Buffer |
| `METRICOOL_API_KEY` | Environment Variable | Optional | Auto-post via Metricool |
| `META_ACCESS_TOKEN` | Environment Variable | Optional | Direct Meta API posting |
| `TIKTOK_ACCESS_TOKEN` | Environment Variable | Optional | Direct TikTok API posting |

---

## How to Import

1. Open your n8n instance.
2. Go to **Workflows** → **Import from File**.
3. Select `n8n-workflows/12-ai-social-autopilot.json`.
4. Configure credentials:
   - Link your **Google Sheets OAuth2** credential to both Google Sheets nodes.
   - Link your **Telegram Bot** credential to both Telegram nodes.
5. Set environment variables in Railway (or n8n Settings → Environment).
6. Update the Google Sheets `documentId` in both Sheets nodes to your spreadsheet ID.
7. Toggle the workflow **ON** to activate the daily cron.

---

## Google Sheets Setup

Create a tab called **Social Posts** with these columns:

```
date | platform | content_type | hook | caption | hashtags | video_script | status | autopilot_status | scheduled_at | published_at | error
```

Create a tab called **Automation Logs** with these columns:

```
timestamp | workflow | action | platform | status | autopilot_status | safety_passed | error | details
```

---

## Test Scenarios

### Test 1: Manual Trigger (No Autopilot)

**Setup:**
```
AUTOPILOT_SOCIAL_POSTING=false
ANTHROPIC_API_KEY=sk-ant-your-key (or OPENAI_API_KEY)
TELEGRAM_CHAT_ID=your-chat-id
```

**Expected behavior:**
1. AI generates content for TikTok, Instagram, Facebook.
2. Safety checks pass.
3. Content saved to Google Sheets "Social Posts" tab.
4. All 3 posts sent to Telegram for manual approval.
5. Actions logged in "Automation Logs".

**How to test:**
- Click "Execute Workflow" manually in n8n editor.
- Check Telegram for 3 messages (one per platform).
- Check Google Sheets for 3 new rows.

---

### Test 2: Autopilot ON, No Posting APIs

**Setup:**
```
AUTOPILOT_SOCIAL_POSTING=true
ANTHROPIC_API_KEY=sk-ant-your-key
TELEGRAM_CHAT_ID=your-chat-id
# No BUFFER_API_KEY, METRICOOL_API_KEY, META_ACCESS_TOKEN, or TIKTOK_ACCESS_TOKEN
```

**Expected behavior:**
1. AI generates content.
2. Safety checks pass.
3. Content saved to Sheets.
4. Autopilot is ON but no APIs available.
5. Content sent to Telegram with "ready_manual" status.
6. No auto-posting attempted.

---

### Test 3: Autopilot ON, With Buffer API

**Setup:**
```
AUTOPILOT_SOCIAL_POSTING=true
BUFFER_API_KEY=your-buffer-key
ANTHROPIC_API_KEY=sk-ant-your-key
TELEGRAM_CHAT_ID=your-chat-id
```

**Expected behavior:**
1. AI generates content.
2. Safety checks pass.
3. Content saved to Sheets.
4. Auto Publish node fires for all 3 platforms via Buffer.
5. Status updated to "scheduled".
6. Logged in Automation Logs.

---

### Test 4: Safety Check Failure

**How to simulate:**
- Temporarily modify the AI prompt to include "guaranteed results" or offensive words.
- Or manually edit the Code node to inject test content with flagged terms.

**Expected behavior:**
- Content flagged with `status: flagged`.
- `safety_issues` field populated.
- Content still saved to Sheets (with error noted).
- Telegram still receives the content (for review).

---

## Test Payload (for Code Node Testing)

Use this in the n8n Code node "Parse AI Response" to test without calling AI:

```javascript
// Test payload - paste into a Set node before Safety Checks
return [
  {
    json: {
      date: "2025-05-22",
      platform: "tiktok",
      content_type: "short_video",
      hook: "Stop scrolling if you run an Italian business",
      caption: "Here's how AI automation saves 10+ hours/week for Italian SMBs. Eki handles your content, leads, and follow-ups while you focus on growth.",
      hashtags: "#AIautomation #ItalianBusiness #SmallBusiness #TechItaly #Eki",
      video_script: "Scene 1: Show overwhelmed business owner. Scene 2: Introduce Eki dashboard. Scene 3: Show automated content being generated. Scene 4: Show time saved metrics. CTA: Link in bio to join waitlist.",
      status: "generated",
      autopilot_status: "pending",
      scheduled_at: "",
      published_at: "",
      error: ""
    }
  },
  {
    json: {
      date: "2025-05-22",
      platform: "instagram",
      content_type: "reel",
      hook: "Italian businesses are switching to AI — here's why",
      caption: "Running a business in Italy is tough. Between admin, marketing, and customer follow-ups, there's no time left. That's why we built Eki — your AI automation partner that handles the repetitive stuff so you can focus on what matters. Join 200+ businesses on our waitlist.",
      hashtags: "#AIItalia #AutomazioneAI #PMIitaliane #BusinessAutomation #Eki #DigitalTransformation #ItalianStartup #SmartBusiness #AItools #MarketingAutomation",
      video_script: "Hook: Italian businesses are switching to AI. Show: Quick cuts of manual tasks. Reveal: Eki automating each one. Proof: Metrics and testimonials. CTA: Join the waitlist today.",
      status: "generated",
      autopilot_status: "pending",
      scheduled_at: "",
      published_at: "",
      error: ""
    }
  },
  {
    json: {
      date: "2025-05-22",
      platform: "facebook",
      content_type: "post",
      hook: "What if your marketing ran itself?",
      caption: "We asked 50 Italian business owners their biggest challenge. The answer? Time. Not money, not ideas — time. That's exactly why Eki exists. Our AI automation platform handles your social content, lead follow-ups, email sequences, and analytics — automatically. No more hiring extra staff for repetitive tasks. No more forgetting to post. No more leads going cold. Join our waitlist and see what AI can do for your business.",
      hashtags: "#Eki #AIforBusiness #ItalianSMB",
      video_script: "",
      status: "generated",
      autopilot_status: "pending",
      scheduled_at: "",
      published_at: "",
      error: ""
    }
  }
];
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No content generated | Missing AI API key | Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` |
| Parse error | AI returned non-JSON | Check AI response in execution log; adjust prompt |
| Telegram not received | Wrong chat ID | Verify `TELEGRAM_CHAT_ID` with @userinfobot |
| Sheets not updating | Credential not linked | Re-link Google Sheets OAuth2 in both nodes |
| Auto-post fails silently | API key invalid/expired | Check posting API credentials; workflow continues via `continueOnFail` |
| Safety flags everything | Overly strict regex | Review patterns in Safety Checks code node |
| Cron not firing | Workflow not active | Toggle workflow ON in n8n |
| Wrong timezone | Env var missing | Ensure `GENERIC_TIMEZONE=Africa/Lagos` is set |

---

## Environment Variables Summary

Add these to Railway or n8n environment:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-xxx          # or OPENAI_API_KEY
TELEGRAM_CHAT_ID=123456789
AUTOPILOT_SOCIAL_POSTING=false        # start with false for safety

# Optional (for auto-posting)
BUFFER_API_KEY=
METRICOOL_API_KEY=
META_ACCESS_TOKEN=
TIKTOK_ACCESS_TOKEN=
```

---

## Workflow Flow Diagram

```
[Daily 9AM Cron]
       │
       ▼
[Check AI Provider] ──► ANTHROPIC_API_KEY exists? 
       │                        │
       │ Yes                    │ No
       ▼                        ▼
[Claude API]            [OpenAI API]
       │                        │
       └────────┬───────────────┘
                ▼
       [Parse AI Response]
       (3 items: TikTok, Instagram, Facebook)
                │
                ▼
        [Safety Checks]
        (offensive, claims, spam, duplicates)
                │
                ▼
      [Save to Google Sheets]
      (Social Posts tab)
                │
                ▼
      [Autopilot Enabled?]
       /              \
    Yes                No
     │                  │
     ▼                  ▼
[Check APIs]    [Telegram: Approval Required]
     │                  │
     ▼                  │
[Can Post?]             │
  /      \              │
Yes       No            │
 │         │            │
 ▼         ▼            │
[Publish] [Telegram:    │
           Manual]      │
 │         │            │
 └────┬────┘────────────┘
      ▼
[Log to Automation Logs]
```
