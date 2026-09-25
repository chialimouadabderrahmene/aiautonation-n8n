# n8n Production Deployment on Railway

Complete guide to deploying n8n on Railway with PostgreSQL for the AI Automation Italy project.

---

## 1. Railway Project Setup

1. Go to [railway.app](https://railway.app) and sign in (GitHub recommended).
2. Click **New Project** → **Empty Project**.
3. Name the project (e.g., `ai-automation-italy-n8n`).
4. You'll add two services: **PostgreSQL** and **n8n**.

---

## 2. PostgreSQL Service Setup

1. Inside your Railway project, click **+ New** → **Database** → **Add PostgreSQL**.
2. Railway provisions a managed PostgreSQL instance automatically.
3. Once created, click the PostgreSQL service and go to the **Variables** tab.
4. Note the following reference variables (you'll use them in n8n config):
   - `${{Postgres.PGHOST}}`
   - `${{Postgres.PGPORT}}`
   - `${{Postgres.PGDATABASE}}`
   - `${{Postgres.PGUSER}}`
   - `${{Postgres.PGPASSWORD}}`

> Railway handles networking between services internally — no public exposure needed for the database.

---

## 3. n8n Service Setup

1. In the same project, click **+ New** → **Docker Image**.
2. Enter the image: `n8nio/n8n:latest`
3. Railway will pull and deploy the image.
4. Go to the n8n service **Settings** tab:
   - Under **Networking**, click **Generate Domain** to get a public URL (e.g., `your-app.up.railway.app`).
   - Set the **Port** to `5678` (n8n's default).
5. Go to the **Variables** tab and add all environment variables listed in Section 4.

---

## 4. Required Environment Variables

Add these in the n8n service **Variables** tab on Railway:

```env
# Database Configuration
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${{Postgres.PGHOST}}
DB_POSTGRESDB_PORT=${{Postgres.PGPORT}}
DB_POSTGRESDB_DATABASE=${{Postgres.PGDATABASE}}
DB_POSTGRESDB_USER=${{Postgres.PGUSER}}
DB_POSTGRESDB_PASSWORD=${{Postgres.PGPASSWORD}}

# n8n Host Configuration
N8N_HOST=your-app.up.railway.app
N8N_PROTOCOL=https
N8N_PORT=5678

# Webhook Configuration
WEBHOOK_URL=https://your-app.up.railway.app/

# Security
N8N_ENCRYPTION_KEY=your-generated-encryption-key
N8N_SECURE_COOKIE=true

# Execution
N8N_RUNNERS_ENABLED=true

# Timezone
GENERIC_TIMEZONE=Africa/Lagos
TZ=Africa/Lagos
```

> Replace `your-app.up.railway.app` with your actual Railway-generated domain.

---

## 5. WEBHOOK_URL Configuration

The `WEBHOOK_URL` tells n8n what base URL to use when generating webhook endpoints for your workflows.

- Format: `https://<your-railway-domain>/`
- Example: `https://ai-automation-italy.up.railway.app/`
- The trailing slash is required.

After setting this, all webhook trigger nodes will use this URL. Your lead capture webhook (workflow 03) will be accessible at:

```
https://your-app.up.railway.app/webhook/lead-capture
```

To find your Railway domain:
1. Go to your n8n service → **Settings** → **Networking**.
2. Copy the generated domain.

---

## 6. N8N_ENCRYPTION_KEY Generation

The encryption key protects stored credentials. **If you lose it, all saved credentials become unreadable.**

### Generate a key:

**Option A — OpenSSL (Linux/Mac/WSL):**
```bash
openssl rand -hex 32
```

**Option B — Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option C — Python:**
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Important rules:
- Generate ONCE and store securely (password manager, vault).
- Never change it after credentials are saved — they'll become unreadable.
- Never commit it to version control.
- Back it up separately from the database.

---

## 7. How to Import Workflows

Once n8n is running on Railway:

1. Open your n8n instance at `https://your-app.up.railway.app/`.
2. Create an account on first visit (this becomes the owner account).
3. Go to **Workflows** → **Import from File**.
4. Import each workflow JSON from the `n8n-workflows/` folder in order:
   - `01-ai-content-generation.json`
   - `02-content-approval.json`
   - `03-lead-capture-webhook.json`
   - `04-waitlist-management.json`
   - `05-welcome-email-sequence.json`
   - `06-engagement-followup.json`
   - `07-referral-campaign.json`
   - `08-feedback-collection.json`
   - `09-weekly-analytics-report.json`
   - `10-social-post-scheduler.json`
5. After importing, activate each workflow by toggling it **ON**.

### Bulk import via CLI (optional):

If you have the n8n CLI available locally and API access enabled:
```bash
for file in n8n-workflows/*.json; do
  curl -X POST https://your-app.up.railway.app/api/v1/workflows \
    -H "X-N8N-API-KEY: your-api-key" \
    -H "Content-Type: application/json" \
    -d @"$file"
done
```

---

## 8. Credential Configuration

After deployment, configure these credentials inside n8n (**Settings** → **Credentials** → **Add Credential**):

### Google Sheets

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project → Enable **Google Sheets API** and **Google Drive API**.
3. Create **OAuth 2.0 credentials** (or Service Account for server-to-server).
4. In n8n, add a **Google Sheets OAuth2** credential.
5. Set the OAuth redirect URL to: `https://your-app.up.railway.app/rest/oauth2-credential/callback`
6. Authorize and connect.

### Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot`.
2. Copy the **Bot Token**.
3. In n8n, add a **Telegram** credential → paste the token.
4. Set the webhook URL in the bot to point to your n8n webhook endpoint if using Telegram Trigger nodes.

### Resend (Email)

1. Sign up at [resend.com](https://resend.com).
2. Verify your sending domain (DNS records).
3. Generate an **API Key**.
4. In n8n, add an **HTTP Header Auth** or custom credential:
   - Header Name: `Authorization`
   - Header Value: `Bearer re_your_api_key`
5. Alternatively, use the Resend node if available in your n8n version.

### AI Credentials (OpenAI / OpenRouter)

1. Get your API key from [platform.openai.com](https://platform.openai.com) or [openrouter.ai](https://openrouter.ai).
2. In n8n, add an **OpenAI** credential → paste the API key.
3. For OpenRouter, use an **HTTP Header Auth** credential with:
   - Header Name: `Authorization`
   - Header Value: `Bearer your-openrouter-key`
   - Base URL override in the HTTP Request node: `https://openrouter.ai/api/v1`

---

## 9. Testing Production Webhooks

### Test the lead capture webhook:

```bash
curl -X POST https://your-app.up.railway.app/webhook/lead-capture \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "source": "manual-test"
  }'
```

### Verify it works:
1. Check the workflow execution log in n8n (Executions tab).
2. Confirm the lead appears in your Google Sheet or Airtable.
3. Confirm the welcome email sequence triggers.

### Test other webhooks:
- Check each workflow's trigger node for its specific webhook path.
- Use [webhook.site](https://webhook.site) to debug outgoing webhook calls.
- Use Railway's **Logs** tab to see real-time n8n output.

### Common issues:
| Problem | Solution |
|---------|----------|
| Webhook returns 404 | Ensure the workflow is **active** (toggled ON) |
| Webhook URL mismatch | Verify `WEBHOOK_URL` env var matches your Railway domain |
| SSL errors | Ensure `N8N_PROTOCOL=https` and `N8N_SECURE_COOKIE=true` |
| Timeout on webhook | Check Railway logs for execution errors |

---

## 10. Backup and Maintenance

### Database Backups

Railway PostgreSQL includes automatic backups. To create manual backups:

1. Go to your PostgreSQL service → **Backups** tab.
2. Click **Create Backup** for a point-in-time snapshot.

### Export workflows (recommended before updates):

```bash
# Export all workflows via API
curl https://your-app.up.railway.app/api/v1/workflows \
  -H "X-N8N-API-KEY: your-api-key" \
  -o workflows-backup-$(date +%Y%m%d).json
```

Or manually: **Workflows** → select each → **Download**.

### Updating n8n

1. In Railway, go to your n8n service → **Settings**.
2. The image `n8nio/n8n:latest` will pull the newest version on next deploy.
3. Click **Redeploy** to trigger an update.
4. Monitor logs for migration messages.

> Pin to a specific version (e.g., `n8nio/n8n:1.60.0`) for stability in production.

### Maintenance checklist:

- [ ] Weekly: Check execution logs for failed workflows
- [ ] Weekly: Review Railway usage/billing
- [ ] Monthly: Export workflow backups
- [ ] Monthly: Check for n8n version updates
- [ ] Quarterly: Rotate API keys and credentials
- [ ] Keep `N8N_ENCRYPTION_KEY` backed up in a secure vault

### Monitoring

- Use Railway's built-in **Metrics** (CPU, memory, network).
- Set up Railway **Alerts** for service crashes.
- Enable n8n's built-in error workflow to get notified of failures via Telegram or email.

### Cost Estimate

Railway pricing (as of 2024):
- Starter plan: $5/month includes $5 usage credit
- PostgreSQL: ~$5–10/month depending on storage
- n8n service: ~$5–15/month depending on execution volume
- Total estimate: **$15–30/month** for a light-to-moderate workload

---

## Quick Start Checklist

- [ ] Create Railway project
- [ ] Add PostgreSQL service
- [ ] Add n8n Docker service (`n8nio/n8n:latest`)
- [ ] Generate Railway domain
- [ ] Set all environment variables (Section 4)
- [ ] Generate and securely store `N8N_ENCRYPTION_KEY`
- [ ] Deploy and access n8n
- [ ] Create owner account
- [ ] Configure credentials (Google Sheets, Telegram, Resend, AI)
- [ ] Import all 10 workflows
- [ ] Activate workflows
- [ ] Test webhooks
- [ ] Set up backup routine
