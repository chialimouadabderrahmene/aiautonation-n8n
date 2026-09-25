# Buffer integration (optional, EXTERNAL DEPENDENCY — not verified against the live API)

Used by workflows **10** (approved drafts on Instagram/Facebook/LinkedIn) and **12** (autopilot copy on TikTok/Instagram/Facebook) **only when** `AUTOPILOT_SOCIAL_POSTING=true`. Default is off: content goes to Telegram for manual posting.

## Variables
```env
BUFFER_API_KEY=            # access token
BUFFER_PROFILE_ID_TIKTOK=
BUFFER_PROFILE_ID_INSTAGRAM=
BUFFER_PROFILE_ID_FACEBOOK=
BUFFER_PROFILE_ID_LINKEDIN=
```
**One profile id per platform.** The old single `BUFFER_PROFILE_ID` posted the TikTok, Instagram and Facebook copy to the same profile; it was removed. A platform without its profile id stays manual.

## Getting the values
Create a Buffer app / token in Buffer's developer settings and list your connected profiles (`GET https://api.bufferapp.com/1/profiles.json` with the token) — each profile has an `id`. **Check Buffer's current developer documentation before relying on this:** the `bufferapp.com/1` API is the legacy one; whether Buffer still issues tokens for it, and what body format it accepts, must be confirmed with a real account. The workflows send JSON `{ "text": "...", "profile_ids": ["<id>"], "now": true }` (workflow 10) or `scheduled_at` one hour ahead (workflow 12) with `Authorization: Bearer <token>`; staging proved the calls and the fallback logic against a mock only.

## Behaviour
| Situation | Result |
|---|---|
| Autopilot off (default) | Telegram message, no Buffer call |
| Autopilot on, Buffer returns `success: true` | logged `buffer_scheduled` (12) / draft `Published` (10) |
| Autopilot on, Buffer fails (after 2 attempts) | Telegram "Buffer post failed - post manually" for that post only; draft `Notification Sent`; other posts are posted once |
| Safety-flagged post (12) | never sent to Buffer; manual alert with the reason |
| `AUTOPILOT_STOP=true` | nothing happens |

Each post is handled in its own loop iteration so a retry can never re-post posts that already succeeded (regression-tested).

## Limits
Follow Buffer's current rate limits and queue limits; the workflows post at most one draft per run in workflow 10 (every 2 h, 10:00-20:00) and three posts per day in workflow 12.
