# Autopilot controller (workflow 14) and the kill switch

Workflow 14 is a **reporting and safety** workflow. It does **not** publish posts and does **not** message customers. (Earlier versions scheduled posts through Buffer/Metricool/Meta/TikTok and sent WhatsApp follow-ups to every lead silent for 24 h. That is removed: it double-posted with workflows 10/12, used unverified provider endpoints, and sent free-form WhatsApp text outside the 24-hour window.)

## What it does — daily 08:00 (Africa/Lagos)
1. Reads `AUTOPILOT_STOP`. If true → Telegram **emergency-stop alert** and nothing else.
2. Otherwise builds the **daily report** from the sheets and sends it to Telegram + logs a row in `Automation Logs`:
   - leads: captured today, total, opted-in, unsubscribed
   - social posts today: generated / approved / flagged
   - WhatsApp conversations today
   - **config health**: social auto-posting ON/OFF, AI key present, WhatsApp API configured, **which `WA_TPL_*` templates are still missing**, Buffer configured, Resend configured

## Who does what
| Job | Workflow |
|---|---|
| Generate social copy, safety-check, save (`Social Posts`) and (only if enabled) post through Buffer | 12 |
| Post approved drafts from `Content Drafts` (manual Telegram alert by default; Buffer / X only if enabled) | 10 |
| WhatsApp sequences | 05, 06, 19 (templates) · 13 (session replies) |
| Report + kill-switch alert | **14** |

## Environment
| Variable | Default | Meaning |
|---|---|---|
| `AUTOPILOT_SOCIAL_POSTING` | `false` | `true` allows API posting (10, 12) when provider settings exist. Keep `false` until a week of human-reviewed output has passed. |
| `AUTOPILOT_STOP` | `false` | `true` = emergency stop for 10 and 12; 14 alerts. Set it in Railway and restart n8n. To stop customer messaging unpublish 05/06/19 (they are governed by templates + opt-out state). |

## Resuming after a stop
Set `AUTOPILOT_STOP=false`, restart n8n, check the next 08:00 report (no emergency alert, health lines as expected).

Tests: staging suites `t3` (default), `t5` (posting on), `t6` (stop on) — see [AUTOPILOT_TESTING_GUIDE.md](AUTOPILOT_TESTING_GUIDE.md).
