# Setup Instructions — Eki Automation System

This document provides step-by-step instructions to deploy, configure, and connect the end-to-end launch automation system for **Eki** (connecting African foodstuff vendors, exporters, and international buyers).

---

## Prerequisites

Before starting, ensure you have:
1. An **n8n** instance (self-hosted Docker, n8n Cloud, or desktop app).
2. A **Google Account** (for Google Sheets database).
3. A **Telegram** account (for team alerts and manual approvals).
4. A **WhatsApp Business API** account (WATI or 360dialog) — all lead communication goes through WhatsApp.
5. An **OpenAI API Key** (for AI content generation and analysis).
6. A **ManyChat Pro** account ($15-45/mo) — for Instagram comment-to-DM automation.
7. An **Apify** account ($45/mo) — for social media scraping (trend intelligence).
8. Optional: **Buffer API Token** (for automated social media scheduling).

---

## Step 1: Set Up Google Sheets Database

1. Open Google Sheets and create a new spreadsheet named `Eki Launch Database`.
2. Create **six (6) tabs** with the exact names below. Add the headers in row 1 of each tab:

### 1. `Leads`
*Used to track landing page and sign-up leads.*
- **Headers:** `email`, `name`, `source`, `intent_level`, `status`, `referral_code`, `signup_date`, `last_contacted`, `feedback_requested_date`, `feedback_received_date`, `last_feedback_rating`, `notes`

### 2. `Waitlist`
*Tracks users queued up for early access prior to public launch.*
- **Headers:** `email`, `name`, `position`, `referral_code`, `referrals_count`, `user_type`, `signup_date`

### 3. `Content Calendar`
*Pre-populated list of content ideas, hooks, and strategy pillars (mapped to the 30-Day Content Calendar).*
- **Headers:** `day`, `platform`, `pillar`, `topic`, `hook`, `caption`, `hashtags`, `video_script`, `status`, `target_date`

### 4. `Content Drafts`
*Generated post drafts awaiting review, edit, approval, or publishing.*
- **Headers:** `date`, `platform`, `caption`, `hashtags`, `video_script`, `status`, `created_date`, `approved_by`, `approved_date`, `publish_date`, `publish_time`, `row_number`, `published`

### 5. `Feedback`
*Tracks client/vendor ratings and survey comments.*
- **Headers:** `email`, `rating`, `comments`, `would_recommend`, `timestamp`, `rating_category`

### 6. `Analytics`
*Stores weekly snapshots of system growth and KPIs.*
- **Headers:** `report_date`, `week_start`, `total_leads`, `new_leads`, `conversion_rate`, `content_published`, `avg_feedback_rating`, `waitlist_size`, `total_referrals`, `wow_growth`

*Note: Copy the full URL of your spreadsheet. You will need it as `EKI_SPREADSHEET_ID_PLACEHOLDER` or sheet URL in the workflows.*

---

## Step 2: Configure Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow instructions to create a bot named `Eki Launch Assistant`.
3. Save the **HTTP API Token** (e.g. `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
4. To get your team Chat ID:
   - Create a group in Telegram containing your team members and the bot.
   - Send a message in the group: `test`.
   - Open your browser and go to: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find the chat object in the JSON output and copy the `id` (usually a negative number starting with `-100`, e.g. `-100123456789`). This is your `YOUR_TELEGRAM_CHAT_ID`.

---

## Step 3: Setup WhatsApp Cloud API

1. Go to [Meta Developers](https://developers.facebook.com) and create a Business app.
2. Add the **WhatsApp** product and get your **Phone Number ID** from API Setup.
3. Generate a **Permanent Access Token** via Business Settings → System Users.
4. Set these env vars in Railway/n8n:
   - `WHATSAPP_ACCESS_TOKEN` — your permanent token
   - `WHATSAPP_PHONE_NUMBER_ID` — from API Setup page
   - `WHATSAPP_VERIFY_TOKEN` — any secret string for webhook verification
5. Configure the webhook in Meta dashboard to point to: `https://your-n8n-domain.com/webhook/whatsapp-webhook`

> **IMPORTANT**: All lead communication goes through WhatsApp. No email is used for nurture sequences.

For detailed WhatsApp setup, see [WHATSAPP_CLOUD_API_SETUP.md](../WHATSAPP_CLOUD_API_SETUP.md).

---

## Step 4: Setup ManyChat (Comment Funnel)

1. Subscribe to [ManyChat Pro](https://manychat.com) ($15-45/mo for Instagram).
2. Connect your Instagram Business accounts (@eki.vendors, @eki.buyers, @eki.market).
3. Set up the **Comment Funnel** automation:
   - Trigger: User comments keyword (VENDOR/SELL/BUY/INFO/JOIN)
   - Action: Send auto-DM with WhatsApp link
4. Configure ManyChat to POST webhook data to: `https://your-n8n-domain.com/webhook/manychat-comment`

> The ManyChat webhook triggers Workflow 17 which routes keywords to the correct WhatsApp journey.

---

## Step 5: Import Workflows into n8n

For each of the 22 JSON files in `n8n-workflows/`:
1. In n8n, click **Workflows** > **Add Workflow** > **Create from scratch**.
2. Click the top-right menu (three dots) and select **Import from File**.
3. Choose the appropriate `.json` file from `n8n-workflows/`.
4. Replace placeholder parameters in the nodes:
   - **Google Sheet ID**: Set via `GOOGLE_SHEETS_ID` env var.
   - **Credentials**: Set up OAuth for Google Sheets and OpenAI API.
   - **Telegram Credentials**: Create a Telegram Bot credential in n8n with your Bot Token.
   - **WhatsApp API**: The workflows use `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` env vars automatically.
5. Click **Save** and click the toggle to **Active** (for webhook and cron triggers).

---

## Step 6: Connect Forms and Webhooks

To receive lead and waitlist signups automatically:
1. In n8n, open workflow `03-lead-capture-webhook` and click the **Webhook Trigger** node.
2. Copy the **Production Webhook URL**.
3. In your landing page software, Typeform, or Tally, configure webhook integrations to POST data to that URL.
4. Ensure the JSON payload matches expected properties:
   - Phone: `phone` (primary identifier — all leads need a phone for WhatsApp)
   - Name: `name`
   - Source: `source`
   - User Type: `user_type` (vendor/buyer)
5. Repeat for ManyChat webhook pointing to Workflow 17 (`manychat-comment` path).

---

## Step 7: Verify and Run a Test

1. Add a dummy content row to your `Content Calendar` sheet.
2. Manually trigger the `01-ai-content-generation` workflow by clicking "Test step" on the trigger.
3. Check if a Telegram message is sent requesting approval.
4. Click `/approve` to confirm.
5. Simulate a lead: POST to the lead-capture webhook with a phone number → verify WhatsApp welcome message arrives.
6. Check the new `Intelligence`, `PainPoints`, `ContentQueue`, and `SocialProof` sheets are being populated by the new workflows.

For granular testing procedures, see the [Testing Checklist](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/testing-checklist.md).
