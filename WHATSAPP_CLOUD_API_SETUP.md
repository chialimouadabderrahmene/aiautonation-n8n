# WhatsApp Cloud API Setup

## Overview

The WhatsApp Lead Funnel (workflow 13) uses Meta's WhatsApp Cloud API to receive and send messages for lead onboarding.

---

## Environment Variables

```env
WHATSAPP_ACCESS_TOKEN=your-permanent-system-user-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_VERIFY_TOKEN=any-secret-string-you-choose
WHATSAPP_APP_SECRET=your-app-secret-for-hmac
APP_DOWNLOAD_LINK=https://eki.app/download
```

Set these in Railway → n8n service → Variables tab.

---

## Step 1: Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com).
2. **My Apps** → **Create App** → **Business** type.
3. Name: "Eki WhatsApp Bot" → select your Business Account.
4. On dashboard → **Add Product** → **WhatsApp** → **Set Up**.

---

## Step 2: Get Credentials

### Phone Number ID

1. Meta App Dashboard → **WhatsApp** → **API Setup**.
2. Under "From" phone number, note the **Phone Number ID**.
3. This is your `WHATSAPP_PHONE_NUMBER_ID`.

### Access Token (Permanent)

Temporary tokens expire in 24h. For production:

1. Go to **Business Settings** → **System Users**.
2. Create a system user (Admin role).
3. Add the WhatsApp app to the system user.
4. Grant permission: `whatsapp_business_messaging`, `whatsapp_business_management`.
5. **Generate Token** → select your app → copy token.
6. This is your permanent `WHATSAPP_ACCESS_TOKEN`.

### App Secret

1. Meta App Dashboard → **Settings** → **Basic**.
2. Copy **App Secret**.
3. This is your `WHATSAPP_APP_SECRET` (used for webhook HMAC verification).

### Verify Token

Choose any random string. This is shared between your n8n webhook and Meta's webhook config. Example: `eki-wa-verify-2025`

---

## Step 3: Configure Webhook

### Your webhook URL:

```
https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook
```

### In Meta Developer Dashboard:

1. **WhatsApp** → **Configuration** → **Webhook**.
2. Click **Edit** or **Subscribe to Webhook**.
3. Enter:
   - **Callback URL**: `https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook`
   - **Verify Token**: same value as your `WHATSAPP_VERIFY_TOKEN` env var
4. Click **Verify and Save**.
5. Subscribe to fields:
   - ✅ `messages`

### CRITICAL: The n8n workflow MUST be active (toggled ON) before you verify.

---

## Step 4: Webhook Verification Flow

When Meta verifies your webhook, it sends:

```
GET /webhook/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=RANDOM_STRING
```

The workflow:
1. Receives the GET request.
2. Compares `hub.verify_token` with `$env.WHATSAPP_VERIFY_TOKEN`.
3. If match → returns `hub.challenge` with 200.
4. If no match → returns 403.

---

## Step 5: Message Flow

### Incoming message payload from Meta:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BUSINESS_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
        "contacts": [{ "profile": { "name": "User Name" }, "wa_id": "PHONE" }],
        "messages": [{
          "from": "PHONE_NUMBER",
          "id": "wamid.xxx",
          "timestamp": "1716364800",
          "type": "text",
          "text": { "body": "Hello" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

### Outgoing message format (Send Reply):

```json
POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "RECIPIENT_PHONE",
  "type": "text",
  "text": { "preview_url": true, "body": "Your message here" }
}
```

---

## Safety & Compliance

| Rule | Implementation |
|------|---------------|
| Only reply to opt-in users | Bot only responds to incoming messages |
| No cold messaging | Never initiates conversation |
| Respect STOP | Immediately stops on STOP/unsubscribe/quit/cancel/basta |
| 24-hour window | Can only send free-form messages within 24h of last user message |
| After 24h | Must use approved Message Templates |
| Token security | Stored in env vars only, never in workflow JSON |

---

## Testing

### Test webhook verification:

```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123" `
  -Method GET
```

Expected: returns `test123`

### Test incoming message:

```powershell
$payload = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BIZ_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "1234567890", "phone_number_id": "PH_ID" },
        "contacts": [{ "profile": { "name": "Test User" }, "wa_id": "2348012345678" }],
        "messages": [{ "from": "2348012345678", "id": "wamid.test1", "timestamp": "1716364800", "type": "text", "text": { "body": "Hello" } }]
      },
      "field": "messages"
    }]
  }]
}
'@

Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body $payload
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook verification fails | Ensure workflow is ACTIVE and verify token matches |
| Messages not arriving | Check Meta webhook subscriptions include `messages` |
| Reply not sent | Check access token validity and phone number ID |
| 131030 error | 24-hour window expired, use message templates |
| 131047 error | Re-register phone number |
| Rate limited | Meta allows 80 messages/second for business tier |
