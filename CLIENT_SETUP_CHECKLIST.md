# Client setup checklist — Eki AI Automation Control Center

Everything below happens in your web browser, in the Control Center. You never
edit code, workflow files, server settings or `.env` files, and you never need
to open n8n or restart anything.

> The one-time technical deployment (done once by your developer) is in
> `docs/DEPLOYMENT.md`. When it is finished you receive two things: the
> Control Center web address and your admin email + password.

---

## 1. Log in

Open the Control Center address (for example
`https://eki-control-center.up.railway.app`) and sign in.

Go to **Settings → Admin password** and change the password you were given.

## 2. Look at the Dashboard

**Dashboard → System health** must show **Online** for API, Video worker,
Database, Queue (Redis), n8n and Media storage. These are checked live. If one
shows Offline for more than a few minutes after a deployment, send a screenshot
to your developer — nothing on this list is something you fix yourself.

n8n is connected automatically; it already shows **Connected** and
"22/22 workflows present, 0 active".

## 3. Open Integrations

Every provider starts as **Not configured** (except n8n and "Inbound webhook
security", which are set up automatically). Each card shows its status:

| Status | Meaning |
|---|---|
| Not configured | Nothing entered yet |
| Configured | Saved (encrypted) but not tested yet |
| Testing… | The Control Center is calling the provider right now |
| Connected | The provider accepted the credentials in a real test |
| Test failed | The provider rejected them — the red text is the provider's own reason |
| Action required | Something changed (for example an expired login) — reconnect or re-test |

## 4. Configure each provider you use

**Providers with an API key** (OpenAI, Groq, Telegram, WhatsApp, Resend,
Apify, Runway, ElevenLabs, Google Sheets, Buffer):

1. Click **Configure** — each field explains what to paste and links to where
   you get it.
2. Click **Save (encrypted)**. The key is encrypted on the server; afterwards
   you only ever see a masked version like `sk-a••••••••1234`.
3. Click **Test connection**.

**Providers you connect with your account** (X, Meta — Facebook Page and
Instagram, LinkedIn):

1. Click **Configure**. The card shows a *redirect URL* — paste it into your
   app in that platform's developer portal (link on the card).
2. Paste the app's Client/App ID and Secret, click **Save**.
3. Click **Connect account**, approve access on the platform's own page, and
   you are brought back to Integrations. The card then shows the connected
   account, the connected date and when it was last verified. Tokens renew
   automatically; **Disconnect account** removes them.

Minimum for video automation: **OpenAI** (or Groq), **Runway**,
**ElevenLabs** (enter a default Voice ID) and **Telegram** (bot token + your
team chat ID, with the bot added to that chat).

## 5. Test and fix blockers

Only **Connected** counts. If a test fails, read the red message (it is the
provider's own answer — typically a mistyped key, an expired token, missing
permissions, or the bot not being in the chat), click **Edit**, fix it, test
again.

Then open **Automations** (and the **Video Generator** / **Dashboard** for
video). Everything lists exactly what it still needs, for example:

```
Video automation                          BLOCKED
✓ OpenAI or Groq
✓ Runway
✕ ElevenLabs — ElevenLabs is not configured
✓ Video worker with FFmpeg
✓ Media storage
```

Some items are filled in on **Settings**, not Integrations: the launch date of
the content calendar, app/vendor links, the feedback survey link, and the
confirmation that Meta approved your WhatsApp templates. Settings marked for
n8n reach the automations by themselves within about a minute.

## 6. Activate ready automations

On **Automations**, click **Activate ready automations**. The Control Center
re-checks everything, switches on **only** the workflows that are READY, and
shows the result, e.g. *Activated: 17 · Skipped: 5*, with the exact reason for
every skipped one. Nothing blocked is ever switched on.

Per workflow you can also **Enable**, **Disable**, or **Test run**:

- *Test run* on a scheduled workflow runs it once for real (real messages,
  real sheet rows).
- *Test webhook* on a webhook workflow checks it is live and rejects
  unauthenticated calls (no fake leads are sent).

**Stop all** switches every automation off immediately. For social posting
there is also an **Emergency stop** switch in Settings.

## 7. Create content

**AI Content Studio** shows every content project and how far it is:
script → voice → video → subtitles → ready → approved.

## 8. Generate a video

**Video Generator → New video**: project name, topic, prompt, platform,
audience, language, tone, duration, aspect ratio, visual style, voice,
subtitles, music (upload tracks in **Settings → Music library**), call to
action, and where to publish after approval. Click **GENERATE VIDEO**.

The job page updates live: Queued → Script → Storyboard → Voice → Visuals →
Assembly → Quality check → **Ready**. You can close the page; generation
continues. If a provider hiccups, the job retries automatically from the step
that failed (finished steps are not paid for twice). If it still fails, the
page shows the step and the reason, and **Retry** resumes from there.

## 9. Approve

When a video is **Ready** it is sent automatically to your Telegram team chat
with **✅ APPROVE** and **❌ REJECT** buttons (you can also decide on the
video's page). The decision appears on **Approvals**.

- **Reject** → on the video page, write what should change and click
  **Regenerate video**.
- **Approve** → publishing starts (next step).

## 10. Publish

Approved videos are published to the platforms you ticked when creating them
(Instagram Reels, Facebook Page, X, LinkedIn) through your connected accounts.
The video page shows each platform's status with a link to the live post, and
a **Retry** button if a platform refused it. If you ticked none, click
**Download MP4** and post it yourself.

## 11. Monitor

- **Dashboard** — live health, what is ready, what needs attention.
- **Executions** — every run (n8n workflows, video jobs, Telegram sends,
  publishing) with trigger, start/end time, duration, retries and the error
  if any.
- **Reports** — success rate, runs per day, per-workflow results, videos
  generated, approvals, publications.
- Failures are also sent to your Telegram team chat (switch in Settings →
  Notifications).

---

### When something looks wrong

| You see | Do this |
|---|---|
| A card says *Test failed* | Read the red message, fix the key/permission, test again |
| A card says *Action required* on X/Meta/LinkedIn | Click **Connect account** again (the platform ended the session) |
| A workflow stays *Blocked* | Its blocker list says exactly what is missing (Integrations or Settings) |
| A video *Failed* | Open it: the failed step and reason are shown; click **Retry** |
| System health shows *Offline* for a long time | Send your developer a screenshot of the Dashboard |
