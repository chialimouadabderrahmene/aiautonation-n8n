# Eki Marketplace Launch Automation System

Eki is a digital marketplace connecting African foodstuff vendors with global buyers. 

This repository contains the end-to-end **n8n AI-powered acquisition machine** — 22 automated workflows that research, create, distribute, and optimize organic content while funneling all leads through WhatsApp for conversion.

---

## 📂 Project Structure

```
ai automation italy/
├── n8n-workflows/                 # 22 Importable JSON n8n workflows
│   ├── 01-ai-content-generation.json
│   ├── 02-content-approval.json
│   ├── 03-lead-capture-webhook.json
│   ├── 04-waitlist-management.json
│   ├── 05-whatsapp-welcome-sequence.json
│   ├── 06-whatsapp-engagement-followup.json
│   ├── 07-referral-campaign.json
│   ├── 08-feedback-collection.json
│   ├── 09-weekly-analytics-report.json
│   ├── 10-social-post-scheduler.json
│   ├── 12-ai-social-autopilot.json
│   ├── 13-whatsapp-lead-funnel.json
│   ├── 14-autopilot-controller.json
│   ├── 15-viral-intelligence-engine.json
│   ├── 16-pain-discovery-engine.json
│   ├── 17-manychat-comment-funnel.json
│   ├── 18-content-multiplication-engine.json
│   ├── 19-whatsapp-nurture-sequences.json
│   ├── 20-ab-testing-engine.json
│   ├── 21-social-proof-engine.json
│   └── 22-performance-analyst-agent.json
├── content-strategy/              # Pre-seeded launch copy and calendar content
│   ├── 30-day-content-calendar.md # Complete daily post schedules with copy
│   ├── content-pillars.md         # Video script formats, hooks, pillars definitions
│   ├── launch-announcement-sequence.md # Announcement sequence T-7 to T+3
│   └── email-sequences/           # HTML-styled onboarding, follow-up, referral, feedback emails
│       ├── welcome-sequence.md
│       ├── follow-up-sequence.md
│       ├── referral-invitation.md
│       ├── feedback-request.md
│       └── app-review-request.md
├── schemas/                       # Database structures
│   ├── google-sheets-schema.md    # Specifications for 6 database tabs (Primary)
│   └── airtable-schema.md         # Alternative Airtable schema map
├── docs/                          # Detailed guides and manuals
│   ├── setup-instructions.md      # Deployment walkthrough
│   ├── api-keys-required.md       # Directory of required credentials
│   ├── workflow-diagram.md        # Mermaid flow charts of data mapping
│   ├── testing-checklist.md       # Curl/PowerShell test payloads
│   └── handover-document.md       # Operational log & recommendations
└── README.md                      # Main project guide
```

---

## ⚡ Quick Start

### 1. Database Setup
1. Create a Google Sheet named `Eki Launch Database` with six tabs: `Leads`, `Waitlist`, `Content Calendar`, `Content Drafts`, `Feedback`, and `Analytics`.
2. Add column headers to each tab as detailed in the [Google Sheets Schema](file:///c:/Users/PC SOFT/Desktop/ai automation italy/schemas/google-sheets-schema.md).

### 2. Infrastructure Setup
1. Deploy your n8n instance and set the timezone parameter to `Africa/Lagos`.
2. Generate API credentials for **WhatsApp Cloud API**, **OpenAI** (post drafting), and **Telegram Bot** (approvals/alerts). Get your required credentials ready using the [API Keys Required Guide](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/api-keys-required.md).

### 3. Workflow Deployment
1. Import all 22 workflow JSON files from `n8n-workflows/` into n8n.
2. In each workflow, configure the corresponding credentials and substitute the placeholder strings (e.g. `EKI_SPREADSHEET_ID_PLACEHOLDER`, `WHATSAPP_ACCESS_TOKEN`, `YOUR_TELEGRAM_CHAT_ID`) with your active keys and URLs.
3. Turn on the workflows (switch to Active).

### 4. Integration & Testing
1. Configure webhooks from your landing page form, waitlist page, and feedback surveys (Tally/Typeform) to point to n8n's webhook URL.
2. Simulate registration payloads using the [Testing Checklist](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/testing-checklist.md) to verify that leads populate the sheet, WhatsApp welcome messages send, and Telegram notifications trigger correctly.

---

## 🛠️ Technology Stack

*   **Automation Platform:** [n8n](https://n8n.io/)
*   **Database / Storage:** [Google Sheets](https://www.google.com/sheets/about/) (Airtable schema provided as alternative)
*   **AI Translation / Drafting:** [OpenAI API (GPT-4o)](https://openai.com/)
*   **WhatsApp Cloud API:** [Meta WhatsApp API](https://developers.facebook.com/)
*   **Lead Conversion:** ManyChat + WhatsApp Cloud API
*   **Notifications / Manual Approvals:** [Telegram Bot API](https://core.telegram.org/bots)
*   **Social Schedulers:** [Twitter/X API](https://developer.twitter.com/) & [Buffer API](https://buffer.com/)

---

## 📘 Documentation Directory

- For detailed deployment steps: [Setup Instructions](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/setup-instructions.md)
- For API key formats and links: [API Keys Required](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/api-keys-required.md)
- For system diagrams and flows: [n8n Workflow Diagrams](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/workflow-diagram.md)
- For testing procedures and commands: [Testing Checklist](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/testing-checklist.md)
- For general handover & future milestones: [Handover Document](file:///c:/Users/PC SOFT/Desktop/ai automation italy/docs/handover-document.md)
