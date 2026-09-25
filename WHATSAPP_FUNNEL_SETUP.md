# WhatsApp Lead Funnel Setup Guide

Complete setup guide for the WhatsApp Lead Funnel workflow (13-whatsapp-lead-funnel.json).

---

## Overview

This workflow creates an automated WhatsApp onboarding funnel for Eki using the Meta WhatsApp Cloud API. When someone messages your WhatsApp Business number, the bot:

1. Asks if they're a Buyer or Vendor
2. Collects name, country, and interest
3. Saves them as a lead
4. Sends the app download link
5. Notifies you on Telegram for high-intent leads
6. Respects STOP/unsubscribe requests

---

## Prerequisites

- Meta Business Account (verified)
- WhatsApp Business API access
- A phone number registered with WhatsApp Business
- n8n instance with public webhook URL (Railway deployment)
- Google Sheets with required tabs
- Telegram Bot for notifications

---

## Step 1: Meta Developer App Setup

1. Go to [developers.facebook.com](https://developers.facebook.com).
2. Click **My Apps** → **Create App**.
3. Select **Business** type → Next.
4. Name it (e.g., "Eki WhatsApp Bot") → Select your Business Account.
5. On the app dashboard, click **Add Product** → **WhatsApp** → **Set Up**.

---

## Step 2: WhatsApp Business API Configuration

### Get your credentials:

1. In the Meta App Dashboard → **WhatsApp** → **API Setup**.
2. Note these values:
   - **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary Access Token** → `WHATSAPP_ACCESS_TOKEN` (for testing)
3. For production, generate a **Permanent Token**:
   - Go to **Business Settings** → **System Users**.
   - Create a system user with `whatsapp_business_messaging` permission.
   - Generate a token → this is your permanent `WHATSAPP_ACCESS_TOKEN`.

### Register your phone number:

1. In **WhatsApp** → **API Setup** → **Add Phone Number**.
2. Verify via SMS or voice call.
3. The verified number's ID becomes your `WHATSAPP_PHONE_NUMBER_ID`.

---

## Step 3: Webhook Configuration

### Your webhook URL:

```
https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook
```

### Configure in Meta:

1. Go to **WhatsApp** → **Configuration** → **Webhook**.
2. Click **Edit** (or **Subscribe**).
3. Enter:
   - **Callback URL**: `https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook`
   - **Verify Token**: Your `WHATSAPP_VERIFY_TOKEN` value (any string you choose)
4. Click **Verify and Save**.
5. Subscribe to webhook fields:
   - ✅ `messages`
   - ✅ `messaging_postbacks` (optional)

### Important:
- The n8n workflow must be **ACTIVE** before you verify the webhook.
- The GET webhook handler responds to Meta's verification challenge automatically.

---

## Step 4: Environment Variables

Add these to your Railway n8n service:

```env
# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx...        # Permanent system user token
WHATSAPP_PHONE_NUMBER_ID=1234567890        # From API Setup page
WHATSAPP_VERIFY_TOKEN=my-secret-verify-123 # Any string you choose
WHATSAPP_APP_SECRET=abcdef123456           # App Settings → Basic → App Secret

# App link sent to users
APP_DOWNLOAD_LINK=https://eki.app/download

# Telegram notifications
TELEGRAM_CHAT_ID=your-chat-id
```

---

## Step 5: Google Sheets Setup

### Tab: Leads

Required columns:
```
phone | name | country | user_type | interest | intent_level | source | status | first_contact | last_message
```

### Tab: WhatsApp Conversations

Required columns:
```
timestamp | phone | direction | message_text | reply_sent | conversation_step | user_type | intent_level
```

### Tab: Automation Logs

Required columns:
```
timestamp | workflow | action | platform | status | phone | conversation_step | error | details
```

---

## Step 6: Import & Activate Workflow

1. Open n8n → **Workflows** → **Import from File**.
2. Select `n8n-workflows/13-whatsapp-lead-funnel.json`.
3. Link credentials:
   - All Google Sheets nodes → your Google Sheets OAuth2 credential
   - Telegram node → your Telegram Bot credential
4. Update the `documentId` in all Google Sheets nodes to your spreadsheet ID.
5. **Activate the workflow** (toggle ON) — required before Meta webhook verification.
6. Go back to Meta and verify the webhook.

---

## Step 7: Test the Integration

### Quick test from Meta:

1. In Meta App Dashboard → **WhatsApp** → **API Setup**.
2. Use the **Send Test Message** feature to send a message TO your bot number.
3. Or message your WhatsApp Business number from any personal WhatsApp.

### Test with curl (simulating Meta webhook):

See `WHATSAPP_TEST_PAYLOADS.md` for full test payloads.

---

## Safety & Compliance Rules

| Rule | Implementation |
|------|---------------|
| Only reply to opt-in users | Bot only responds to incoming messages |
| No cold messaging | No outbound initiation without user message first |
| Respect STOP | STOP/unsubscribe/quit immediately halts messaging |
| No spam | One reply per incoming message, no loops |
| Token security | Token stored in env vars, never in workflow JSON |
| 24-hour window | WhatsApp requires template messages after 24h (handled by follow-up logic) |

---

## Architecture

```
[User sends WhatsApp message]
         │
         ▼
[Meta Cloud API Webhook] ──► POST to n8n
         │
         ▼
[Parse Message] → [Valid?] → No → (ignore)
         │
        Yes
         │
         ▼
[Check STOP] ──► Yes → [Confirm + Unsubscribe + Log]
         │
        No
         │
         ▼
[Conversation Router]
  - greeting → ask Buyer/Vendor
  - type_collected → ask name
  - data_collected → send app link
         │
         ▼
[Send WhatsApp Reply via Cloud API]
         │
         ▼
[Save Lead to Sheets] → [Save Conversation]
         │
         ▼
[High Intent?] ──► Yes → [Telegram Alert]
         │
         ▼
[Log to Automation Logs]
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook verification fails | Ensure workflow is ACTIVE and `WHATSAPP_VERIFY_TOKEN` matches |
| Messages not received | Check Meta webhook subscriptions (must include `messages`) |
| Reply not sent | Verify `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` |
| 24-hour window expired | Use approved message templates for follow-ups |
| Duplicate messages | Meta may retry; workflow handles idempotently via phone key |
| Token expired | Regenerate permanent token from System User |
