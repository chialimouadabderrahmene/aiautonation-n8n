# API Keys and Credentials Directory — Eki AI Acquisition Machine

All credentials required to set up and run the Eki AI-powered acquisition system.

---

## 1. Core Credentials (Required)

| Service | Purpose | Format | Where to Obtain |
|:---|:---|:---|:---|
| **Google Sheets OAuth2** | Read/write leads, intelligence, content, analytics | Client ID + Client Secret | [Google Cloud Console](https://console.cloud.google.com/) (Enable Sheets & Drive APIs) |
| **WhatsApp Cloud API Token** | ALL lead communication — welcome, nurture, follow-ups | Permanent System User Token | Meta Business Settings → System Users → Generate Token with `whatsapp_business_messaging` |
| **WhatsApp Phone Number ID** | Identifies your WhatsApp sender | Numeric ID | Meta App Dashboard → WhatsApp → API Setup |
| **OpenAI API Key** | Content generation, trend analysis, pattern extraction | `sk-proj-...` | [OpenAI Platform](https://platform.openai.com/api-keys) (use GPT-4o) |
| **Telegram Bot Token** | Team alerts, content approvals, daily reports | `123456789:ABCdef...` | [@BotFather](https://t.me/BotFather) on Telegram |
| **Telegram Chat ID** | Target group for alerts and approvals | `-100123456789` | `https://api.telegram.org/bot<TOKEN>/getUpdates` |

## 2. Lead Acquisition (Required for Comment Funnel)

| Service | Purpose | Format | Cost |
|:---|:---|:---|:---|
| **ManyChat API** | Instagram comment → DM automation | API Key via ManyChat account | $15-45/mo |
| **Instagram Business Accounts** | @eki.vendors, @eki.buyers, @eki.market | Instagram handles | Free (requires Business conversion) |

## 3. Intelligence Engine (Required for Workflows 15-16)

| Service | Purpose | Format | Cost |
|:---|:---|:---|:---|
| **Apify API Token** | Scrape Instagram/TikTok trends & Reddit pain points | `apify_api_...` | $45/mo (Starter) |

## 4. Social Posting (Optional)

| Service | Purpose | Format |
|:---|:---|:---|
| **Buffer API Token** | Auto-schedule posts to Facebook, Instagram, LinkedIn | `Bearer buf_abc...` |
| **Buffer Profile IDs** | Target account identifiers | `64fa368297491cf32018ea1b` |

## 5. Environment Variables Summary

```env
# --- Required ---
GOOGLE_SHEETS_ID=your-spreadsheet-id
OPENAI_API_KEY=sk-proj-...
TELEGRAM_CHAT_ID=-100123456789
WHATSAPP_ACCESS_TOKEN=EAAxxxx...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_VERIFY_TOKEN=your-secret-string
APIFY_TOKEN=apify_api_...

# --- Optional ---
BUFFER_API_KEY=your-buffer-token
BUFFER_PROFILE_ID=your-profile-id
TEAM_EMAIL=team@eki.app
```

## Security Best Practices

> [!WARNING]
> **Never commit real API keys to GitHub.**
> - Store all keys in n8n credentials vault or Railway env vars
> - WhatsApp token must be a **Permanent** System User token (temporary tokens expire in 24h)
> - Rotate keys quarterly
> - Back up `N8N_ENCRYPTION_KEY` — losing it makes all saved credentials unreadable
