# Buffer Integration Setup

## Overview

Buffer is used by the AI Social Autopilot (workflow 12) to schedule and publish posts to TikTok, Instagram, and Facebook when `AUTOPILOT_SOCIAL_POSTING=true`.

---

## Environment Variables

```env
BUFFER_API_KEY=your-buffer-access-token
BUFFER_PROFILE_ID=your-buffer-profile-id
```

Set these in Railway → n8n service → Variables tab.

---

## Getting Your Buffer Credentials

### Access Token

1. Go to [buffer.com/developers](https://buffer.com/developers).
2. Click **Manage Apps** or create a new app.
3. Your access token is shown on the app page.
4. Alternatively, use the token from Buffer → Settings → Apps & Extras.

### Profile IDs

Each connected social account in Buffer has a unique profile ID.

To find your profile IDs:

```bash
curl https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN
```

Response includes an array of profiles. Each has an `id` field — that's your `BUFFER_PROFILE_ID`.

If you have multiple profiles (one per platform), you can use any one. The workflow sends content text and Buffer handles distribution.

---

## Buffer API Request Format

The workflow sends posts using this format:

```
POST https://api.bufferapp.com/1/updates/create.json
Authorization: Bearer <BUFFER_API_KEY>
Content-Type: application/x-www-form-urlencoded

text=<encoded caption + hashtags>&profile_ids[]=<BUFFER_PROFILE_ID>&scheduled_at=<ISO timestamp>
```

### Parameters:

| Parameter | Description |
|-----------|-------------|
| `text` | URL-encoded post content (caption + hashtags) |
| `profile_ids[]` | Buffer profile ID to post to |
| `scheduled_at` | ISO 8601 timestamp for scheduling |

### Success Response:

```json
{
  "success": true,
  "buffer_count": 1,
  "buffer_percentage": 10,
  "updates": [{ "id": "...", "status": "buffer", ... }]
}
```

### Error Response:

```json
{
  "success": false,
  "message": "Access token required",
  "code": 401
}
```

---

## Workflow Behavior

| Condition | Action |
|-----------|--------|
| `AUTOPILOT_SOCIAL_POSTING=true` + `BUFFER_API_KEY` exists | Posts sent to Buffer |
| Buffer returns success | Logged as scheduled |
| Buffer returns error | Telegram fallback with content for manual posting |
| `AUTOPILOT_SOCIAL_POSTING=false` | Content sent to Telegram for review |
| `AUTOPILOT_STOP=true` | Nothing happens (emergency halt) |

---

## Testing Buffer Integration

### Test API key is valid:

```powershell
Invoke-RestMethod -Uri "https://api.bufferapp.com/1/user.json" `
  -Headers @{ "Authorization" = "Bearer YOUR_BUFFER_KEY" }
```

### Test listing profiles:

```powershell
Invoke-RestMethod -Uri "https://api.bufferapp.com/1/profiles.json" `
  -Headers @{ "Authorization" = "Bearer YOUR_BUFFER_KEY" }
```

### Test creating a post:

```powershell
$body = "text=Test+post+from+Eki+automation&profile_ids[]=YOUR_PROFILE_ID&scheduled_at=2025-05-23T10:00:00Z"
Invoke-RestMethod -Uri "https://api.bufferapp.com/1/updates/create.json" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer YOUR_BUFFER_KEY" } `
  -ContentType "application/x-www-form-urlencoded" `
  -Body $body
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Invalid or expired token | Regenerate token in Buffer |
| 403 Forbidden | Token lacks permissions | Check app permissions |
| "No profiles" | No social accounts connected | Connect accounts in Buffer dashboard |
| Post not appearing | Scheduled for future | Check Buffer queue |
| Rate limited | Too many requests | Buffer allows 60 req/min |

---

## Rate Limits

- 60 requests per minute per token
- Max 2000 scheduled posts in queue
- The workflow posts max 3 per day (configurable via `MAX_POSTS_PER_DAY`)
