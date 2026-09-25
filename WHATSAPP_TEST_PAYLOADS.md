# WhatsApp Funnel Test Payloads

Use these payloads to test the WhatsApp Lead Funnel workflow without needing a real WhatsApp message.

---

## Webhook URL

```
POST https://n8n-production-c3b7.up.railway.app/webhook/whatsapp-webhook
```

For testing in n8n editor (test mode):
```
POST https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook
```

---

## Test 1: New User Says Hello

Simulates a first-time user messaging the bot.

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Mouad Test" },
            "wa_id": "2348012345678"
          }],
          "messages": [{
            "from": "2348012345678",
            "id": "wamid.test001",
            "timestamp": "1716364800",
            "type": "text",
            "text": { "body": "Hello" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

### curl:
```bash
curl -X POST "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Mouad Test" },
            "wa_id": "2348012345678"
          }],
          "messages": [{
            "from": "2348012345678",
            "id": "wamid.test001",
            "timestamp": "1716364800",
            "type": "text",
            "text": { "body": "Hello" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:** Bot replies asking "Are you a Buyer or Vendor?"

---

## Test 2: User Says "Vendor"

Simulates a user identifying as a vendor (high-intent).

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Mouad Test" },
            "wa_id": "2348012345678"
          }],
          "messages": [{
            "from": "2348012345678",
            "id": "wamid.test002",
            "timestamp": "1716364860",
            "type": "text",
            "text": { "body": "Vendor" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:**
- Bot replies: "Great! You're interested as a Vendor. What's your full name?"
- Lead saved with `user_type: vendor`, `intent_level: high`
- Telegram notification sent (high-intent vendor)

---

## Test 3: User Says "Buyer"

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Luigi Rossi" },
            "wa_id": "393331234567"
          }],
          "messages": [{
            "from": "393331234567",
            "id": "wamid.test003",
            "timestamp": "1716364920",
            "type": "text",
            "text": { "body": "Buyer" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:**
- Bot replies: "Great! You're interested as a Buyer. What's your full name?"
- Lead saved with `user_type: buyer`, `intent_level: medium`

---

## Test 4: User Says STOP

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Mouad Test" },
            "wa_id": "2348012345678"
          }],
          "messages": [{
            "from": "2348012345678",
            "id": "wamid.test004",
            "timestamp": "1716365000",
            "type": "text",
            "text": { "body": "STOP" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:**
- Bot replies: "You have been unsubscribed..."
- Lead status updated to `unsubscribed`
- Logged in Automation Logs

---

## Test 5: Webhook Verification (GET)

Meta sends this to verify your webhook during setup.

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=challenge_string_123" `
  -Method GET
```

### curl:
```bash
curl "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=challenge_string_123"
```

**Expected:** Returns `challenge_string_123` with status 200 (if token matches).

---

## Test 6: Status Update (Should Be Ignored)

Meta sends status updates (delivered, read) — workflow should ignore these.

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "statuses": [{
            "id": "wamid.test001",
            "status": "delivered",
            "timestamp": "1716364810",
            "recipient_id": "2348012345678"
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:** Workflow processes but takes no action (no messages array = invalid).

---

## Test 7: Data Collection (Name/Country)

### PowerShell:
```powershell
Invoke-RestMethod `
  -Uri "https://n8n-production-c3b7.up.railway.app/webhook-test/whatsapp-webhook" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "2348001234567",
            "phone_number_id": "PHONE_NUMBER_ID"
          },
          "contacts": [{
            "profile": { "name": "Mouad Chiali" },
            "wa_id": "2348012345678"
          }],
          "messages": [{
            "from": "2348012345678",
            "id": "wamid.test005",
            "timestamp": "1716365100",
            "type": "text",
            "text": { "body": "My name is Mouad, I am from Morocco" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Expected:**
- Bot replies with follow-up questions + app download link
- Conversation step saved as `data_collected`

---

## Verification Checklist

After running tests, verify:

- [ ] Google Sheets "Leads" tab has new/updated rows
- [ ] Google Sheets "WhatsApp Conversations" tab has message logs
- [ ] Google Sheets "Automation Logs" tab has action entries
- [ ] Telegram received high-intent notification (Test 2)
- [ ] STOP test updated lead status to `unsubscribed`
- [ ] Status update (Test 6) did NOT create any lead or reply
- [ ] n8n execution log shows successful runs

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Webhook returns 404 | Workflow not active | Toggle workflow ON |
| Verification fails | Token mismatch | Check `WHATSAPP_VERIFY_TOKEN` matches Meta config |
| Reply not sent | Invalid access token | Regenerate token in Meta Business Settings |
| "Message failed to send" | 24-hour window expired | Use message templates for follow-ups |
| Duplicate processing | Meta retries on timeout | Workflow acknowledges 200 immediately |
| No Telegram alert | Wrong chat ID | Verify with @userinfobot on Telegram |
