# Autopilot System Testing Guide

End-to-end testing guide for all three production workflows.

---

## Pre-Test Checklist

Ensure these are set in Railway env vars:

```env
OPENAI_API_KEY=sk-...
GOOGLE_SHEETS_ID=your-spreadsheet-id
TELEGRAM_CHAT_ID=your-chat-id
BUFFER_API_KEY=your-buffer-token
BUFFER_PROFILE_ID=your-profile-id
WHATSAPP_ACCESS_TOKEN=your-wa-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-id
WHATSAPP_VERIFY_TOKEN=your-verify-string
APP_DOWNLOAD_LINK=https://eki.app/download
AUTOPILOT_SOCIAL_POSTING=false
AUTOPILOT_STOP=false
MAX_POSTS_PER_DAY=3
GENERIC_TIMEZONE=Africa/Lagos
TZ=Africa/Lagos
```

---

## Google Sheets Tabs Required

Your spreadsheet must have these tabs with exact names:

| Tab Name | Used By |
|----------|---------|
| Social Posts | Workflow 12, 14 |
| Leads | Workflow 13, 14 |
| WhatsApp Conversations | Workflow 13, 14 |
| Automation Logs | All workflows |

### Social Posts columns:
```
date | platform | content_type | hook | caption | hashtags | video_script | status | autopilot_status | scheduled_at | published_at | error
```

### Leads columns:
```
phone | name | country | user_type | interest | intent_level | source | status | first_contact | last_message
```

### WhatsApp Conversations columns:
```
timestamp | phone | direction | message_text | reply_sent | conversation_step | user_type | intent_level
```

### Automation Logs columns:
```
timestamp | workflow | action | platform | status | details | error
```

---

## Test 1: AI Social Autopilot (Workflow 12)

### 1A: Manual mode (AUTOPILOT_SOCIAL_POSTING=false)

1. Set `AUTOPILOT_SOCIAL_POSTING=false` in Railway.
2. Open workflow 12 in n8n editor.
3. Click **Execute Workflow**.
4. Expected:
   - OpenAI generates content for 3 platforms.
   - Safety checks pass.
   - 3 rows added to "Social Posts" tab.
   - 3 Telegram messages received (manual post content).
   - 1 row in "Automation Logs".

### 1B: Autopilot mode with Buffer

1. Set `AUTOPILOT_SOCIAL_POSTING=true`.
2. Ensure `BUFFER_API_KEY` and `BUFFER_PROFILE_ID` are set.
3. Execute workflow.
4. Expected:
   - Content generated and saved.
   - Posts sent to Buffer API.
   - If Buffer succeeds → logged as scheduled.
   - If Buffer fails → Telegram fallback message.

### 1C: Emergency stop

1. Set `AUTOPILOT_STOP=true`.
2. Execute workflow.
3. Expected: Workflow exits immediately, nothing generated.

---

## Test 2: WhatsApp Lead Funnel (Workflow 13)

### Webhook URL:
```
Production: https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook
Test mode:  https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook
```

### 2A: Webhook verification

```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=abc123" `
  -Method GET
```

Expected: Returns `abc123`

### 2B: New user says Hello

```powershell
$body = '{"object":"whatsapp_business_account","entry":[{"id":"BIZ","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"123","phone_number_id":"PH"},"contacts":[{"profile":{"name":"Test User"},"wa_id":"2348000000001"}],"messages":[{"from":"2348000000001","id":"wamid.t1","timestamp":"1716400000","type":"text","text":{"body":"Hello"}}]},"field":"messages"}]}]}'

Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST -ContentType "application/json" -Body $body
```

Expected:
- WhatsApp reply sent: "Welcome to Eki! Are you a Buyer or Vendor?"
- Lead saved in Sheets with status=new
- Conversation logged

### 2C: User says "Vendor" (high intent)

```powershell
$body = '{"object":"whatsapp_business_account","entry":[{"id":"BIZ","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"123","phone_number_id":"PH"},"contacts":[{"profile":{"name":"Test Vendor"},"wa_id":"2348000000002"}],"messages":[{"from":"2348000000002","id":"wamid.t2","timestamp":"1716400100","type":"text","text":{"body":"Vendor"}}]},"field":"messages"}]}]}'

Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST -ContentType "application/json" -Body $body
```

Expected:
- Reply: "Awesome! You're a Vendor..."
- Lead saved with user_type=vendor, intent_level=high
- Telegram notification received (high-intent alert)

### 2D: User says STOP

```powershell
$body = '{"object":"whatsapp_business_account","entry":[{"id":"BIZ","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"123","phone_number_id":"PH"},"contacts":[{"profile":{"name":"Test User"},"wa_id":"2348000000001"}],"messages":[{"from":"2348000000001","id":"wamid.t3","timestamp":"1716400200","type":"text","text":{"body":"STOP"}}]},"field":"messages"}]}]}'

Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST -ContentType "application/json" -Body $body
```

Expected:
- Unsubscribe confirmation sent
- Lead marked as unsubscribed
- Logged in Automation Logs

---

## Test 3: Autopilot Controller (Workflow 14)

### 3A: Normal daily run

1. Open workflow 14 in n8n editor.
2. Click **Execute Workflow**.
3. Expected:
   - Reads Social Posts, Leads, WhatsApp Conversations.
   - Processes pending posts (respects max per day).
   - Sends WhatsApp follow-ups if applicable.
   - Telegram daily summary received.
   - Logged in Automation Logs.

### 3B: Emergency stop

1. Set `AUTOPILOT_STOP=true`.
2. Execute workflow 14.
3. Expected: Telegram emergency alert, no other actions.

---

## Validation Checklist

After all tests, verify:

- [ ] All 3 workflow JSON files import without errors
- [ ] No secrets hardcoded in any workflow file
- [ ] Google Sheets tab names match exactly (case-sensitive)
- [ ] `AUTOPILOT_STOP=true` halts all workflows
- [ ] Buffer posts only when `AUTOPILOT_SOCIAL_POSTING=true` AND key exists
- [ ] WhatsApp webhook verification works (GET returns challenge)
- [ ] STOP command immediately unsubscribes user
- [ ] High-intent leads trigger Telegram notification
- [ ] All actions logged to Automation Logs tab
- [ ] No posting happens without explicit API keys
- [ ] Telegram fallback works when Buffer fails

---

## Webhook URLs Summary

| Workflow | URL | Method |
|----------|-----|--------|
| WhatsApp Verify | `https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook` | GET |
| WhatsApp Messages | `https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook` | POST |

---

## Remaining Blockers (if any)

| Blocker | Resolution |
|---------|-----------|
| Google Sheets OAuth2 not linked | Must link credential manually in n8n UI after import |
| Telegram Bot credential not linked | Must link credential manually in n8n UI after import |
| Buffer profile ID unknown | Run `GET /1/profiles.json` to find it |
| WhatsApp 24h window | Use Message Templates for follow-ups after 24h |
| GOOGLE_SHEETS_ID not set | Copy spreadsheet ID from URL and add to Railway env |

---

## Production Go-Live Steps

1. Import all 3 workflows into n8n.
2. Link credentials (Google Sheets OAuth2, Telegram Bot).
3. Set all env vars in Railway.
4. Activate workflow 13 first (needed for webhook verification).
5. Verify WhatsApp webhook in Meta dashboard.
6. Activate workflow 12 and 14.
7. Set `AUTOPILOT_SOCIAL_POSTING=false` initially.
8. Run workflow 12 manually once to verify content generation.
9. Check Telegram for the content.
10. If satisfied, set `AUTOPILOT_SOCIAL_POSTING=true`.
11. Monitor daily via Telegram summaries from workflow 14.
