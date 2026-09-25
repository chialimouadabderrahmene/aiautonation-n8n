# Autopilot testing guide (workflows 10, 12, 14)

## 1. Automated (staging — no real accounts, no internet)
```bash
bash staging/scripts/up.sh
node staging/run-tests.js t3                                      # default: AUTOPILOT_SOCIAL_POSTING=false
bash staging/scripts/stage.sh posting-on && node staging/run-tests.js t5   # guarded posting branch (mock Buffer / X)
bash staging/scripts/stage.sh stop-on    && node staging/run-tests.js t6   # kill switch
bash staging/scripts/stage.sh default
```
What these prove (against a mock of Groq, Buffer, X, Telegram and Google Sheets):
| Check | Suite |
|---|---|
| 12 generates 3 platform posts with an **African-foodstuff-marketplace** prompt, saves them, sends 3 manual Telegram messages and calls **no** Buffer/X API while autopilot is off | t3 |
| A caption with a false claim ("Guaranteed 100% results") is **flagged** (`flag_reason=false_claim`) and never auto-posted | t3, t5 |
| Invalid AI JSON fails the execution loudly and writes nothing | t3 |
| 10 picks the oldest **Approved** draft, alerts Telegram, marks `Notification Sent`, ignores Draft/published rows, does nothing when none are left | t3 |
| 14 reports leads/social/config health including the missing templates, logs a row, sends **no** WhatsApp | t3 |
| posting ON: X draft posted via the OAuth2 credential; Instagram/Facebook/TikTok posts use **their own** Buffer profile ids; TikTok/no-route platforms stay manual | t5 |
| Buffer failure falls back to a manual alert **for that post only**; other posts are posted exactly once (no re-posting on retry) | t5 |
| `AUTOPILOT_STOP=true`: 12 makes no AI call and writes nothing; 10 leaves drafts untouched; 14 sends the emergency alert | t6 |

## 2. Manual smoke test on the real n8n (AUTOPILOT_SOCIAL_POSTING=false)
1. Put one row in `Content Calendar` for today's `day_number` and set `LAUNCH_DATE` so today is inside days 1-30.
2. Open workflow **01** → *Manual Run* → a draft row appears in `Content Drafts` and the team gets the approval message.
3. Reply `/approve <day>` in the team group → row becomes `Approved` (only messages from `TELEGRAM_CHAT_ID` work).
4. Workflow **10** → *Manual Run* → Telegram shows "Ready to post on …"; the row becomes `Notification Sent`. Post manually.
5. Workflow **12** → *Manual Run* → 3 rows in `Social Posts`, 3 Telegram messages, 3 rows in `Automation Logs`.
6. Workflow **14** → *Manual Run* → daily report; check the "WhatsApp templates missing" line.
7. Set `AUTOPILOT_STOP=true`, restart, run 12 → nothing happens; run 14 → emergency alert. Set it back to `false`.

## 3. Turning API posting on (only after the rollout in [SOCIAL_AUTOPILOT_TESTING.md](SOCIAL_AUTOPILOT_TESTING.md))
Needs Buffer/X accounts (EXTERNAL DEPENDENCY). The request shapes are verified against the mock only.
