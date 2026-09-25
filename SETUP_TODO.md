# Setup Checklist: Configuration & Key Requirements for Eki AI Acquisition Machine

To make the Eki automation system fully operational, you must collect, configure, and provide the credentials and settings detailed below.

---

## 📅 Launch Details & Context
- [ ] **App Name**: Eki (African Foodstuff Marketplace)
- [ ] **Launch Date**: `[ENTER LAUNCH DATE]`
- [ ] **Target Timezone**: `Africa/Lagos`

---

## 📊 Database (Google Sheets)
- [ ] **Google Account**: Used for n8n Google Sheets integration.
- [ ] **Google Sheet ID**: Create spreadsheet named `Eki Launch Database` — copy ID from URL.
- [ ] **Tab Structure** (10 sheets total):
  - `Leads` | `Waitlist` | `Content Calendar` | `Content Drafts` | `Feedback`
  - `Analytics` | `Intelligence` | `PainPoints` | `ContentQueue` | `SocialProof`

---

## 💬 WhatsApp Cloud API (PRIMARY — all leads go through WhatsApp)
- [ ] **Meta Business Account** (verified)
- [ ] **WhatsApp Business Phone Number** (registered & verified)
- [ ] **Permanent Access Token** (from System Users, not temporary)
- [ ] **Phone Number ID** (from API Setup page)
- [ ] **Webhook configured** → n8n endpoint `/webhook/whatsapp-webhook`
- [ ] **WHATSAPP_ACCESS_TOKEN** set in Railway/n8n env vars
- [ ] **WHATSAPP_PHONE_NUMBER_ID** set in Railway/n8n env vars
- [ ] **WHATSAPP_VERIFY_TOKEN** set in Railway/n8n env vars

---

## 📱 ManyChat (Comment → DM → WhatsApp Funnel)
- [ ] **ManyChat Pro subscription** ($15-45/mo for Instagram)
- [ ] **Instagram Business Account @eki.vendors** connected
- [ ] **Instagram Business Account @eki.buyers** connected
- [ ] **Instagram Business Account @eki.market** connected
- [ ] **Comment automation** configured: keyword → auto-DM → WhatsApp link
- [ ] **Webhook pointing to**: `/webhook/manychat-comment`

---

## 🕸️ Apify (Trend Intelligence)
- [ ] **Apify account** (Starter $45/mo)
- [ ] **Instagram/TikTok scraper actors** configured
- [ ] **APIFY_TOKEN** set in Railway/n8n env vars

---

## 💬 Team Notifications (Telegram)
- [ ] **Telegram Bot Token** (from @BotFather)
- [ ] **Telegram Chat ID** (group with bot + team)
- [ ] **Telegram credential** linked in n8n

---

## 🤖 AI (Content Generation & Analysis)
- [ ] **OpenAI API Key** (GPT-4o recommended)
- [ ] **OpenAI credential** linked in n8n

---

## ⚙️ n8n Instance
- [ ] **n8n deployed** (Railway or self-hosted)
- [ ] **Timezone**: `GENERIC_TIMEZONE=Africa/Lagos`
- [ ] **GOOGLE_SHEETS_ID** env var set
- [ ] **All 22 workflows imported** and credentials linked
- [ ] **Webhooks active** (workflows toggled ON)

---

## 📱 Social Accounts (Content Distribution)
- [ ] **TikTok account** @eki_official
- [ ] **Facebook Group** "Eki Foodstuff Community"
- [ ] **Buffer account** connected to all platforms (optional)
- [ ] **BUFFER_API_KEY** set (optional for auto-posting)
