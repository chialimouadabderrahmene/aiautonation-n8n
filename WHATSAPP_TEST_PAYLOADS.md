# WhatsApp webhook — signed test payloads

Workflow 13 verifies `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(raw request body, `WHATSAPP_APP_SECRET`). Requests without a valid signature get **401**. Use **dedicated test numbers** (your own, or fictional numbers in staging) — never customer data.

Set once (bash):
```bash
N8N="https://<your-n8n-domain>/webhook"      # staging: http://127.0.0.1:5678/webhook
SECRET="<WHATSAPP_APP_SECRET>"                # staging: staging-app-secret-not-real
```

## 1. Verification handshake (GET)
```bash
curl -s "$N8N/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=424242"   # -> 424242
curl -s -o /dev/null -w "%{http_code}\n" "$N8N/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"   # -> 403
```

## 2. Incoming message (POST, signed)
```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550100000","phone_number_id":"100000000000001"},"contacts":[{"profile":{"name":"QA User"},"wa_id":"15550100999"}],"messages":[{"from":"15550100999","id":"wamid.QA1","timestamp":"1790000000","type":"text","text":{"body":"BUYER"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$N8N/whatsapp-webhook" -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" --data-binary "$BODY"    # -> 200
```
PowerShell:
```powershell
$body = '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","contacts":[{"profile":{"name":"QA User"},"wa_id":"15550100999"}],"messages":[{"from":"15550100999","id":"wamid.QA1","timestamp":"1790000000","type":"text","text":{"body":"BUYER"}}]}}]}]}'
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$h = New-Object Security.Cryptography.HMACSHA256; $h.Key = [Text.Encoding]::UTF8.GetBytes($env:WHATSAPP_APP_SECRET)
$sig = 'sha256=' + (([BitConverter]::ToString($h.ComputeHash($bytes))) -replace '-','').ToLower()
Invoke-WebRequest -Uri "$env:N8N/whatsapp-webhook" -Method Post -ContentType 'application/json' -Headers @{ 'X-Hub-Signature-256' = $sig } -Body $bytes
```
Sign **exactly the bytes you send** (no re-formatting). Against the *real* number the reply is a session message and is allowed only within 24 h of the customer's message — for a test number that never wrote to you the send fails with 131047 (expected; the lead is still saved).

## 3. Cases to try
| Body text | Expected |
|---|---|
| `hi` | greeting reply, lead row created (`status=new`) |
| `BUYER` / `VENDOR` | type reply; `opt_in=yes`, `status=lead_captured`; vendor → Telegram high-intent alert |
| `STOP` | unsubscribe confirmation; row: `status=unsubscribed`, `opt_in=no`, `opt_out_at` set |
| any text afterwards | **no reply** |
| `START` | re-subscribed (`status=new`, `opt_in=yes`, `opt_out_at` empty) |
| signature missing / wrong / body altered after signing | HTTP 401, nothing stored |
| a `statuses` (delivery receipt) payload | HTTP 200, ignored |
| text with accents/emoji (e.g. `Ciao è un piacere 🌍`) | processed (signature is over raw UTF-8 bytes) |

## 4. Other webhooks (shared secret)
```bash
curl -s -X POST "$N8N/lead-capture" -H "Content-Type: application/json" -H "X-Eki-Webhook-Secret: <secret>" \
  -d '{"name":"QA Lead","phone":"15550100301","email":"qa@example.invalid","source":"manual-test","user_type":"vendor","consent":true}'
```
Without the header → 403. `consent:false` (or missing) → lead stored with `opt_in=no`, nothing sent. Full request list per workflow: [docs/testing-checklist.md](docs/testing-checklist.md).
