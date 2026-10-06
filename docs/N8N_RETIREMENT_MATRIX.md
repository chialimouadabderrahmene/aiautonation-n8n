# n8n retirement matrix

Classification of every n8n workflow (00-22) against the native TypeScript Automation Engine, per the client decision: **n8n must not be the production runtime, but is not removed yet.** n8n stays running, untouched, until each workflow below is ported, tested and verified — this matrix is the input to that decision, not the decision itself.

Four classes:
- **REDUNDANT** — a native replacement already exists. Eligible for retirement in n8n once the owner confirms.
- **PORT_REQUIRED** — no blocker; ported natively this pass (unless noted).
- **PROVIDER_BLOCKED** — needs a third-party integration this system does not have.
- **SPEC_BLOCKED** — needs one precise decision only an owner/product call can make.

## Already native (from earlier passes, listed for completeness)

| # | Workflow | Class | Native replacement |
|---|---|---|---|
| 13 | WhatsApp Lead Funnel | REDUNDANT | `api/src/modules/whatsapp/conversation.ts` |
| 19 | WhatsApp Nurture Sequences | PORT_REQUIRED (done) | `worker/src/pipeline/whatsapp-nurture.ts` |
| 10 | Social Post Scheduler | PORT_REQUIRED (done, partial) | Posting loop superseded by `ConnectedAccount` publish; its one real rule (autopilot gate) ported to `api/src/modules/automation/autopilot.ts` |
| 03 | Lead Capture Webhook | PORT_REQUIRED (done) | `api/src/routes/leads.ts` (`/capture`) |
| 04 | Waitlist Management | PORT_REQUIRED (done) | `api/src/routes/leads.ts` (`/waitlist`), `WaitlistEntry` |
| 09 | Weekly Analytics Report | PORT_REQUIRED (done) | `worker/src/pipeline/weekly-report.ts` |
| 22 | Performance Analyst Agent | REDUNDANT | Folded into 09's native port (same metrics; its AI narrative not ported) |

## Classified and ported this pass

| # | Workflow | Class | Native replacement | Notes |
|---|---|---|---|---|
| 05 | WhatsApp Welcome Sequence | PORT_REQUIRED — **done** | `worker/src/pipeline/whatsapp-welcome.ts`, daily 09:00 UTC | Gates on `status: "NEW"` (distinct from nurture's `COMPLETE`) — never double-messages the same contact |
| 06 | WhatsApp Engagement Follow-up | PORT_REQUIRED — **done** | `worker/src/pipeline/whatsapp-engagement.ts`, daily 10:00 UTC | "Finished nurture" computed from `nurtureDay`, not a redundant status flag |
| 07 | Referral Campaign Tracker | PORT_REQUIRED — **done** | `api/src/modules/leads/referral.ts`, `POST /api/leads/referral`, new `Referral` model | Referrer is always a `WaitlistEntry` (the only referral-code holder in this app) |
| 14 | Autopilot Controller | PORT_REQUIRED — **done** | `worker/src/pipeline/autopilot-controller.ts`, daily 08:00 UTC | Counts remapped onto this app's own publish-status vocabulary (no "flagged" state exists here) |
| 18 | Content Multiplication Engine | PORT_REQUIRED — **done** | `worker/src/pipeline/content-multiplication.ts`, `POST /api/content/multiply`, new `ContentVariant` model | Async (202 + BullMQ), not synchronous like n8n's webhook — the AI provider abstraction only exists in the worker process, by design |

## Blocked

| # | Workflow | Class | Exact blocker |
|---|---|---|---|
| 01 | AI Content Generation | REDUNDANT (not reconfirmed this pass) | Native `worker/src/pipeline/{script,slides}.ts` + brand critic almost certainly already supersede it — needs a quick confirm, not a port |
| 02 | Content Approval Handler | REDUNDANT (not reconfirmed this pass) | Native Telegram approve/reject (`vid:`/`car:` callbacks) already supersede the approve/reject core; the one gap found and closed this pass — carousel regenerate-with-feedback (`POST /api/carousel/projects/:id/regenerate`), mirroring video's existing endpoint |
| 12 | AI Social Autopilot | REDUNDANT | Composite: content generation → 01's native replacement; autopilot decision → `autopilot.ts` (from workflow 10's port); posting → native `ConnectedAccount` publish |
| 08 | Feedback Collection | SPEC_BLOCKED | **Decision needed:** build a native feedback webhook + storage model, or keep routing feedback to the external form already configured in the `feedbackFormUrl` setting? (That setting's existence suggests feedback was always meant to go through a third-party form, not this engine — but it was never confirmed.) |
| 21 | Social Proof Engine | SPEC_BLOCKED | **Decision needed:** what system and event triggers a "social proof" moment (a review platform? an order-completion system?) — no such event source exists anywhere in this codebase or its docs. |
| 15 | Viral Intelligence Engine | PROVIDER_BLOCKED | Apify (web-scraping actor platform) — not one of this system's 12 integrated providers |
| 16 | Pain Discovery Engine | PROVIDER_BLOCKED | Reddit API (OAuth2 script app) — not integrated |
| 17 | ManyChat Comment Funnel | PROVIDER_BLOCKED | ManyChat — not integrated |
| 20 | A/B Testing Engine | PROVIDER_BLOCKED | Needs real engagement/performance data (likes, views, shares) from each platform's own Insights/Analytics API — none of Instagram/Facebook/X/LinkedIn's analytics APIs are integrated; `Publication` only tracks publish status, not engagement |

## Infrastructure-only (not a port candidate)

| # | Workflow | Class | Notes |
|---|---|---|---|
| 00 | Global Error Handler | REDUNDANT | Native `AutomationExecution` logging + `notifyTeam`/`notifyAdmin` error paths are already pervasive across every pipeline function in `api`/`worker` — n8n's own error-trigger mechanism has no native equivalent to port, because the native engine's error handling was never n8n-shaped to begin with |

## What this pass added (schema + architecture)

- `WhatsAppContact`: `welcomeDay`/`lastWelcomeAt` (05), `reengageStep`/`lastReengageAt` (06) — kept separate from `nurtureDay`/`lastNurtureAt` (19), same reasoning as the original: each is its own lifecycle axis, not an overloaded status flag.
- New models: `Referral` (07), `ContentVariant` (18).
- New BullMQ queues, all following the established pattern (repeatable schedule matching n8n's own trigger time + an admin manual-trigger endpoint mirroring n8n's Manual Run node): `whatsapp-welcome` (daily 09:00 UTC), `whatsapp-engagement` (daily 10:00 UTC), `autopilot-controller` (daily 08:00 UTC), `content-multiplication` (on-demand only).
- Bug found and fixed during this pass: every `AUTOMATION_ENGINE`-sourced job (nurture, weekly report, welcome, engagement, content multiplication, autopilot controller) built its `AutomationExecution` idempotency key as `${job.id}#${attempt}` with no queue name in it — since BullMQ job IDs are per-queue counters, two different scheduled jobs could land on the same key and silently merge into one execution row. Fixed by prefixing every key with its mode name; confirmed live (distinct rows, correct `mode`/`status`/`error` per run).
- RBAC gap found and fixed: `/api/reports` was mounted with `requireAdmin` only, no `requireWrite` — meaning a VIEWER-role admin could already trigger `POST /weekly/run` (from a prior pass) and would have been able to trigger the new `POST /autopilot/run` too. Fixed by adding `requireWrite` to that router's mount.

## Verification

Every PORT_REQUIRED item above has unit tests for its pure selection/business-rule logic (worker: 49/49 passing across `whatsapp-welcome`, `whatsapp-engagement`, `content-multiplication`, `autopilot-controller`, plus the existing suites; api: 79/79 across `referral` plus existing suites) and was live-verified end to end on the local stack: a manual-trigger endpoint queues a real BullMQ job, the worker picks it up, runs real Postgres queries (and a real WhatsApp/AI provider call where applicable, correctly failing closed since no live credentials exist in this sandbox), and logs the result to `AutomationExecution`. Referral crediting was verified with a real `WaitlistEntry` fixture: unmatched code, a credited 3rd referral correctly hitting the "VIP Access" milestone, and a duplicate correctly rejected.
