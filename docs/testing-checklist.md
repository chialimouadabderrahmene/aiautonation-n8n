# Testing Checklist — Eki Automation System

This document outlines the step-by-step verification procedures for each n8n workflow. Since the user is running Windows, commands are provided in both **Windows PowerShell (Invoke-RestMethod)** and **standard bash curl** formats.

---

## 1. Webhook Test Payloads & Simulation Commands

### Workflow 03: Lead Capture Webhook
*Tests de-duplication, Google Sheets entry, and welcome trigger.*

*   **Test URL:** `http://localhost:5678/webhook-test/lead-capture` (Replace localhost with production domain in live environments).
*   **Expected Behavior:** Lead appended to the `Leads` sheet. A request forwarded to the Welcome Sequence webhook. If `intent_level` is `High`, a Telegram alert is sent.

**PowerShell Command:**
```powershell
Invoke-RestMethod -Uri "http://localhost:5678/webhook-test/lead-capture" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"name": "Chinedu Obi", "email": "chinedu@eki-marketplace.com", "source": "LinkedIn ad", "intent_level": "High"}'
```

**Bash/Curl Command:**
```bash
curl -X POST http://localhost:5678/webhook-test/lead-capture \
  -H "Content-Type: application/json" \
  -d '{"name": "Chinedu Obi", "email": "chinedu@eki-marketplace.com", "source": "LinkedIn ad", "intent_level": "High"}'
```

---

### Workflow 04: Waitlist Management Webhook
*Tests early-access signup, position generation, custom referral code creation, and confirmation email trigger.*

*   **Test URL:** `http://localhost:5678/webhook-test/waitlist`
*   **Expected Behavior:** Waitlist entry created with unique referral code (e.g. `WL-EKI-CHI-ABCD`), position incremented, confirmation email sent via Resend.

**PowerShell Command:**
```powershell
Invoke-RestMethod -Uri "http://localhost:5678/webhook-test/waitlist" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"name": "Chiara Rossi", "email": "chiara.rossi@example.it", "user_type": "Buyer"}'
```

**Bash/Curl Command:**
```bash
curl -X POST http://localhost:5678/webhook-test/waitlist \
  -H "Content-Type: application/json" \
  -d '{"name": "Chiara Rossi", "email": "chiara.rossi@example.it", "user_type": "Buyer"}'
```

---

### Workflow 07: Referral Campaign Webhook
*Tests attribution loops when a new lead registers via a referral link.*

*   **Test URL:** `http://localhost:5678/webhook-test/referral-signup`
*   **Expected Behavior:** Parent referrer's points incremented. If points hit 3 or 5, an email notification is dispatched to the referrer announcing their trade rewards.

**PowerShell Command:**
```powershell
Invoke-RestMethod -Uri "http://localhost:5678/webhook-test/referral-signup" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"ref": "WL-EKI-CHI-ABCD", "new_user_email": "new.vendor@eki-marketplace.com", "new_user_name": "Kofi Mensah"}'
```

**Bash/Curl Command:**
```bash
curl -X POST http://localhost:5678/webhook-test/referral-signup \
  -H "Content-Type: application/json" \
  -d '{"ref": "WL-EKI-CHI-ABCD", "new_user_email": "new.vendor@eki-marketplace.com", "new_user_name": "Kofi Mensah"}'
```

---

### Workflow 08: Client Feedback Collection Webhook
*Tests routing of client feedback based on numeric score rating.*

*   **Test URL:** `http://localhost:5678/webhook-test/collect-feedback`
*   **Expected Behavior:**
    *   Rating 4-5: Trigger App Store review invitation email.
    *   Rating 3: Log in product queue (No alert).
    *   Rating 1-2: Telegram alert notifying team of low rating for manual intervention.

**PowerShell Command (Simulating Negative Feedback):**
```powershell
Invoke-RestMethod -Uri "http://localhost:5678/webhook-test/collect-feedback" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"email": "chiara.rossi@example.it", "rating": 2, "comments": "The verification page timed out during photo upload.", "would_recommend": false}'
```

**Bash/Curl Command (Simulating Positive Feedback):**
```bash
curl -X POST http://localhost:5678/webhook-test/collect-feedback \
  -H "Content-Type: application/json" \
  -d '{"email": "chinedu@eki-marketplace.com", "rating": 5, "comments": "Excellent onboarding. Fast vendor response!", "would_recommend": true}'
```

---

## 2. Checklists for Cron/Scheduled Workflows

### Workflow 01: AI Content Generation (Cron daily at 9:00 AM)
1.  Verify the `Content Calendar` sheet contains at least 1 row with `status` as `Scheduled`.
2.  Click **Test step** on the schedule trigger or mock input data to trigger.
3.  Ensure OpenAI executes without quota errors.
4.  Confirm a new row with `status` `Pending` is appended to the `Content Drafts` tab.
5.  Check your Telegram group chat for the approval request message showing post options.

### Workflow 02: Content Approval Callback (Webhook)
1.  Send `/approve` or reply to the Telegram message generated in Workflow 01.
2.  Ensure n8n receives the webhook.
3.  Confirm the row status in `Content Drafts` updates from `Pending` to `Approved`.

### Workflow 06: Engagement Follow-up (Cron daily at 10:00 AM)
1.  Verify your `Leads` sheet contains a lead with `status` = `Welcome Sent` and `last_contacted` timestamp older than 7 days.
2.  Trigger the workflow.
3.  Confirm a follow-up email is sent via Resend API.
4.  Confirm the status in Google Sheets changes to `Followup Sent`.

### Workflow 09: Weekly Analytics Report (Cron weekly Mondays at 9:00 AM)
1.  Populate mock rows in `Leads` (various signup dates), `Feedback` (various ratings), and `Content Drafts`.
2.  Trigger the workflow.
3.  Confirm an HTML email containing KPI metrics and visual tables is delivered to your inbox.
4.  Verify the Telegram chat group receives the text summary snapshot.
5.  Confirm a summary snapshot is appended to the `Analytics` spreadsheet tab.

### Workflow 10: Social Post Scheduler (Cron every 2 hours)
1.  Mark a row in the `Content Drafts` sheet as `Approved` (with `published` status empty).
2.  Trigger the workflow.
3.  Ensure it pulls the oldest approved row.
4.  Verify it posts to Twitter/X (if API active) or sends a Telegram manual post alert.
5.  Verify the sheet row status changes to `Published` or `Notification Sent`.
