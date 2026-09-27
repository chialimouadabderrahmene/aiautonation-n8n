# Client setup checklist — Eki AI Automation Control Center

No source code editing needed for anything below. Do these in order; each step tells you what to check before moving to the next.

**Before you start:** someone technical needs to deploy the four services once (n8n, the API, the worker, the web app) on Railway or similar — see `docs/DEPLOYMENT.md` and `docs/N8N_SETUP.md`. That is a one-time setup step, not something you do from the Control Center itself. Once it's deployed and you have its web address, everything below is done by you, in the browser.

---

### STEP 1 — Open the Control Center
Go to the web address your developer gave you (e.g. `https://your-control-center.up.railway.app`). Sign in with the admin email and password you were given.

### STEP 2 — Go to Integrations
Click **Integrations** in the left menu. You'll see a card for every connected service (OpenAI, n8n, WhatsApp, Telegram, Resend, Runway, ElevenLabs, and others). Every one starts as **NOT CONFIGURED** — that's expected on day one.

### STEP 3 — Configure OpenAI (or Groq)
On the **OpenAI** card, click **Configure**, paste your OpenAI API key, click **Save credentials**.

### STEP 4 — Click Test Connection
Click **Test connection** on the same card. Wait a moment. It will show either:
- **CONNECTED** (green) — the key works.
- **TEST FAILED** (red) with a plain-English reason (e.g. "Unauthorized API key") — the key is wrong or expired; fix it and test again.

Never assume a saved key works until you see **CONNECTED**.

### STEP 5 — Configure Runway
Same as Step 3–4, on the **Runway** card. This is what generates the video scenes.

### STEP 6 — Configure ElevenLabs
Same again, on the **ElevenLabs** card. This is what generates the voiceover.

### STEP 7 — Configure Telegram
Same again, on the **Telegram** card — this is how you'll approve/reject generated videos and how the team gets error alerts. You'll need a bot token from @BotFather and your team's chat ID (your developer can help with this one — see `docs/api-keys-required.md`).

### STEP 8 — Check the Dashboard
Click **Dashboard**. You'll see:
- **System status**: BLOCKED / PARTIALLY READY / READY
- **Integrations connected**: how many of the cards above show CONNECTED
- **Action required**: a plain list of exactly what's still broken, and why

Nothing on this page is ever shown as working unless it's actually been tested — a green checkmark here means it's real.

### STEP 9 — Fix any BLOCKED integrations
Go back to **Integrations**, find anything still red or grey, and fix it (usually a typo'd key or an expired token). Repeat Steps 3–4 for each one until the Dashboard's "Action required" list is empty (or only lists things you're intentionally not using yet).

### STEP 10 — Activate Ready Automations
Click **Automations**. Each of the 22 workflows lists exactly what it still needs. Once a workflow's requirements are all satisfied, click **Enable** on it individually, or click **Activate ready automations** at the top to enable every workflow that's currently ready in one click. Workflows that aren't ready yet stay off — this button never force-activates something broken.

*(One-time technical step your developer must do first: the workflows have to be imported into your n8n instance before they appear here as enable-able. See `docs/N8N_SETUP.md`.)*

### STEP 11 — Create your first video
Click **Video Generator** → **New project**. Fill in the project name, pick a content type (Reel, TikTok, etc.), topic, and a short prompt describing what you want. Click **Generate video**. You'll see a live progress bar move through: Script → Storyboard → Voiceover → Visuals → Assembly → Quality check.

### STEP 12 — Approve through Telegram
Once the video is ready, click **Send to Telegram** on it. It'll arrive in your configured Telegram chat with **Approve** / **Reject** buttons. Tap one — the decision shows up back in the Control Center's **Approvals** page automatically.

### STEP 13 — Publish
Approved videos are ready to post manually to your social channels (or, once you've configured Buffer/X under Integrations and enabled the relevant automation in Step 10, some posting can happen automatically — check `docs/VIDEO_PIPELINE.md` and `SOCIAL_AUTOPILOT_TESTING.md` for what's automatic vs. manual today, and keep automatic social posting **off** until you've reviewed a week of output by hand).

---

## If something looks wrong
- **A card never goes to CONNECTED** → re-check the key/token you pasted (copy-paste errors are the #1 cause); read the red error text, it's the real error from that provider, not a generic message.
- **A workflow won't enable** → read its blocker list on the Automations page; it names exactly what's missing.
- **A video gets stuck** → open it in Video Generator and check which stage it failed at; you can retry it from there.
- **Anything else** → Executions and Reports pages show every run and every failure with a plain-English reason. Send a screenshot of that to your developer.
