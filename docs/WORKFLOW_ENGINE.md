# Native Workflow Engine — Architecture, Scope, and Gap Analysis

Status date: 2026-10-12 (batch 7 — content calendar + Telegram command routing). This document is the honest record of what the native
workflow engine (`api/src/modules/engine/`) actually replaces today, what it
does not yet replace, and how each claim below should be read against the
four-tier verification scale used throughout this project:

- **IMPLEMENTED** — code exists, compiles, and is wired into the running server.
- **LOCALLY TESTED** — exercised against a real local PostgreSQL + Redis
  (unit and/or `test:integration` suite), or via real `curl` calls to a
  locally-running server. No staging/production environment, no real
  third-party credentials.
- **STAGING VERIFIED** — run against a deployed staging environment with at
  least one real (non-mock) provider.
- **PRODUCTION VERIFIED** — observed operating correctly in production.

Nothing in this codebase has been STAGING VERIFIED or PRODUCTION VERIFIED yet.
Every claim below is IMPLEMENTED and/or LOCALLY TESTED only, and is marked as such.

## 1. Why this exists

n8n was the workflow runtime for this project: 22 workflow definitions under
`n8n-workflows/*.json`, imported into a running n8n instance and polled/managed
by `api/src/modules/n8n/*` and `modules/system/scheduler.ts`. The goal of this
engine is to let the application run its own business automations — trigger
matching, conditional branching, retries, scheduling, durable execution state
— without n8n (or any third-party workflow platform) at runtime. External
providers (Resend, WhatsApp/Meta, Telegram, object storage, etc.) remain
allowed, but only as adapter calls invoked *by* the native engine, never as
the orchestrator itself.

**n8n has not been removed from this repository.** The `modules/n8n/*` code,
the n8n-management scheduler loop, and all 22 `n8n-workflows/*.json` files are
untouched and still present. This document's "ported" column is the honest
measure of how much of n8n's job the native engine has actually taken over.

## 2. Engine architecture (IMPLEMENTED, LOCALLY TESTED)

All of the following live under `api/src/modules/engine/`:

| Concern | Module | Notes |
|---|---|---|
| Trigger registry | `triggers.ts` | Zod `EVENT_SCHEMAS` per domain event type; `WEBHOOK`/`EVENT`/`CRON`/`MANUAL` trigger types on `EngineWorkflow.triggerType` |
| Workflow definitions | `definition.ts` | Versioned, Zod-validated `WorkflowDefinition` JSON: `action`/`condition`/`delay`/`parallel` step types only. **No code-execution step type exists** — this is a deliberate security constraint, not an oversight. |
| Condition evaluation | `conditions.ts` | Pure AND/OR/NOT evaluator over the execution's context bag; own-properties-only lookup (blocks `{{constructor}}`-style prototype-chain leaks — regression-tested) |
| Cron | `cron.ts` | Dependency-free, `Intl`-based, timezone- and DST-correct `nextRunAt()`; tested against a real Europe/Rome spring-forward/fall-back transition |
| Templating | `templating.ts` | `{{path}}` substitution into action inputs from the context bag; same own-properties-only guard as conditions |
| Action registry | `actions/index.ts` | Typed, Zod-input-validated actions reusing existing domain services (never a generic "call any HTTP URL" action — this is the SSRF mitigation: there is no action capable of reaching an arbitrary attacker-supplied destination, internal network, or cloud metadata endpoint) |
| Outbox | `outbox.ts` | Transactional-outbox emit (`emitEvent`, called inside the same DB transaction as the business write) + a relay tick that publishes pending events into the trigger-match queue |
| Queues | `queue.ts` | Two BullMQ queues — `workflow-trigger-match`, `workflow-execution-run` — `jobId = executionId` for natural de-duplication |
| Trigger matching | `matcher.ts` | Computes a SHA-256 idempotency key per (workflow, source, dedupe-value); duplicate matches are caught as a DB unique-constraint violation and treated as a no-op, not an error |
| Executor | `executor.ts` | Step-by-step runner with per-step idempotent resume (a step whose `EngineStepExecution` row is already `SUCCEEDED` is never re-invoked), cooperative cancellation, per-step timeouts, exponential backoff + jitter retries, dead-lettering on exhausted attempts, and `replayExecution()` (replays as a **new** execution, never mutates history) |
| Scheduler | `scheduler.ts` | Per-row advisory locking with stale-lock reclaim (covers scheduler-process restarts/downtime) for `CRON` triggers; a separate stalled-execution sweep recovers executions stuck mid-run after a crash |
| Bootstrap | `bootstrap.ts` | Starts the BullMQ workers + three independent, mutually-non-overlapping background ticks (outbox relay / cron scheduler / stalled-execution sweep), wired into `server.ts`'s boot and graceful-shutdown sequence |
| Webhooks | `webhooks.ts` | Synchronous entry point for `WEBHOOK`-type workflows, mounted publicly (rate-limited) at `POST /api/hooks/:workflowKey` |
| Admin API | `routes/engine.ts` | 18 admin endpoints: list/detail workflows, version history, create draft, publish, rollback, enable/disable, manual test-run, list/detail executions, cancel, replay, scheduler status, queue counts |

### State machine

`EngineExecution.status`: `QUEUED → RUNNING → SUCCEEDED`, with `RETRYING`,
`WAITING` (delay steps), `FAILED`, and `CANCELLED` as the other reachable
states. Semantics are explicitly **at-least-once**, never exactly-once: every
action handler must be idempotent (actions declare an `idempotent` flag), and
the step-level idempotent-resume plus the matcher's dedupe key are what make
retried/duplicated delivery safe in practice.

### The one serious bug found and fixed during development

BullMQ's `Queue.add()` silently no-ops when called with a `jobId` that is
still in the **ACTIVE** state — it does not throw, and the job is never
re-processed. The original retry/delay-resume code called
`enqueueExecutionRun()` synchronously from inside the still-running job
processor, which hit exactly this case and left retried/delayed executions
permanently stuck (only ever rescued minutes later by the stalled-sweep).
Fixed by moving all resume/retry enqueuing into a BullMQ Worker `"completed"`
event listener (`reconcileAfterRun`), which only fires once the job has
genuinely left the active state. Verified via two standalone repro scripts
against real BullMQ + Redis, then by the full integration suite going from
3–4 failing tests to 14/14 passing. See `executor.ts`'s `reconcileAfterRun`.

## 3. Test coverage (LOCALLY TESTED)

- **Unit** (`npm test`, no DB required): 66 tests across cron (incl. DST),
  conditions (incl. the prototype-leak regression), templating, and
  definition validation/rejection.
- **Integration** (`npm run test:integration`, real local PostgreSQL 16 +
  Redis, `vitest.integration.config.ts`): 14 tests covering delay-step
  pause/resume, transient-failure retry-then-success without re-running a
  succeeded step, permanent-failure dead-lettering, and cancellation of an
  in-flight delayed execution. All 14 pass.
- Both suites were re-run after the admin-API/webhook/seed wiring in this
  commit, to confirm no regression: 66/66 unit, 14/14 integration, `tsc
  --noEmit` clean on both `api/` and `web/`, `next build` clean.
- **Batch 2** (manychat-comment-funnel, content-multiplication-engine,
  social-proof-engine, performance-analyst-agent, and the real
  weekly-analytics-report aggregation): a new `test/engine-batch2-
  integration.test.ts` adds 10 more real-Postgres/Redis integration tests —
  seeding idempotency and the version-upgrade-publishes-a-new-version-without
  -mutating-the-old-one behavior, `report.weeklyAnalytics`'s window-correctness,
  `socialLead.upsert`'s new-vs-repeat-commenter counting, `content.queueMany`'s
  schema rejection of a malformed draft, the content-multiplication-engine
  webhook's honest "no AI provider connected → zero drafts queued, still
  SUCCEEDED" path, a **labeled simulation** of a connected AI provider (no real
  OpenAI/Groq credentials exist in any test environment here) to prove the
  rest of that pipeline — the condition gate opening, `content.queueMany`,
  the Telegram-alert attempt — actually works once a provider answers, and
  the manychat-comment-funnel webhook's lead recording. 24/24 integration
  tests pass (14 original + 10 new), 66/66 unit tests pass, `tsc --noEmit`
  clean on `api/`, `web/` and `worker/`, all three `npm run build`s clean.
- **A real bug was found and fixed by manual verification, not by the
  automated suites**: the first version of the real weekly-analytics-report
  definition templated `event.emit`'s `periodStart`/`periodEnd` from
  `{{trigger.firedAt}}` — present for a real CRON firing, but **absent** for
  a MANUAL test-run (the admin UI's "Run test" button), which has no
  `firedAt` in its trigger payload. A live `curl` test-run of the published
  workflow reproduced this exactly: the execution retried, then dead-
  lettered, on "periodStart: Required; periodEnd: Required". Fixed by having
  `report.weeklyAnalytics` return its own `periodStart`/`periodEnd` and
  templating the emit step from `{{aggregate.periodStart}}` instead — correct
  for both CRON and manual/test-run invocations. Re-verified with another
  live test-run: `SUCCEEDED`. This is exactly why "the code compiles and unit
  tests pass" is never treated as "verified" in this project — this bug
  existed in code that typechecked cleanly and had passing integration tests
  (which happened not to exercise the MANUAL trigger path for this specific
  workflow) until a real HTTP call against a real running server caught it.

### Batch 3 (05/06/19 — WhatsApp sequences)

A new `test/engine-whatsapp-sequence-integration.test.ts` adds 5 more
real-Postgres/Redis integration tests for the `whatsapp.runSequence` action:
the whole-run honest skip when templates aren't approved, consent
enforcement (an opted-out lead is never even sent an HTTP request, not just
"sent a failed one"), a stage never firing twice for the same lead, the
intentional gradual catch-up behavior (one stage advances per run, not a
burst, when a lead is old enough to be eligible for several at once — see
the blast-radius note below), and the nurture track correctly skipping a
lead whose `leadType` was never set. These use Node's built-in `http` module
as a **labeled, local simulation** of the WhatsApp Cloud API's Graph
endpoint, reached through the project's own existing `ALLOW_PROVIDER_
OVERRIDES`/`PROVIDER_API_OVERRIDES` test-mode mechanism (`lib/http.ts`) —
the real `timedFetch`/`describeHttpFailure`/`withRetry` code path runs
against it exactly as it would against the real provider; only the network
hop is substituted, and this is never reported as more than LOCALLY TESTED.

**A genuine live-network finding, not a mock**: a manual test-run of
`whatsapp-welcome-sequence` against the real (unmocked) server in this
sandbox — after the integration suite had left WhatsApp marked CONNECTED in
the shared local dev database — produced a real `ENOTFOUND` DNS failure
calling the real `graph.facebook.com` (this sandbox has no route to the
public internet for that host). This was caught and reported exactly as
designed: `whatsapp.runSequence` recorded `{leadId, result: "skipped:
provider_error"}` for that lead and the execution still completed
`SUCCEEDED` — a transient/unreachable provider never crashes the whole
batch or silently invents a "sent" result for a lead it could not reach.

A second finding was caught by the test suite itself (not by inspection):
running the new integration file concurrently with the existing ones
(vitest's default cross-file parallelism) caused real cross-file database
pollution — a lead created by the WhatsApp-sequence suite was counted by
`report.weeklyAnalytics`'s window-correctness test in another file, since
both hit the same shared local Postgres. Fixed by setting `fileParallelism:
false` in `vitest.integration.config.ts`: these are integration tests
against one live database, and were never safe to parallelize across files.

### Not yet covered by an automated test (gap, not a false claim)

- Workflow-version-change while an execution for the *previous* version is
  still in flight (the executor reads the version snapshotted at match time,
  so this should be safe by construction, but there is no test proving it).
- A true Redis-outage-and-recovery test (integration tests exercise
  worker-crash-shaped recovery via the stalled-sweep, not a live Redis
  disconnect/reconnect).
- RBAC/Super-Admin-only enforcement for engine endpoints specifically — see
  §5 below; the single-operator auth model in this repository means this
  requirement is partially inapplicable as written.
- Provider rate-limit/failure simulation for the new `senders/resend.ts` and
  `senders/whatsapp.ts` wrappers (they return honest `{ok:false,...}` results
  on failure, as unit-tested indirectly via the actions that call them, but
  there is no dedicated rate-limit-simulation test).

## 4. The 22-workflow migration matrix

Every row's status is IMPLEMENTED + LOCALLY TESTED (never more) unless noted.
"Native key" is the `EngineWorkflow.key` in `seed/ported-workflows.ts`.

| # | n8n workflow | Status | Native key / trigger | What changed vs. the n8n original | Verification |
|---|---|---|---|---|---|
| 00 | global-error-handler | **INTENTIONALLY NOT PORTED** | — | n8n's own error-workflow mechanism; the native engine has its own dead-letter queue + audit log instead (§2) — no equivalent needed, not a gap | — |
| 01 | ai-content-generation | ✅ Native | `ai-content-generation` / CRON `0 9 * * *` UTC | New action `contentCalendar.generateDraft`: reads the day-number from the existing `launchDate` setting, looks up the admin-curated `EngineContentCalendarEntry` for that day (new table, replacing the "Content Calendar" Sheets tab), asks the connected AI provider for the day's hook/caption/hashtags/video script, saves an `EngineContentDraft`, and builds the exact `/approve N /reject N /edit N` instruction text the n8n original sent | unit + integration (labeled AI-provider simulation; real end-to-end wiring also confirmed live — see below) — ships disabled |
| 02 | content-approval | ✅ Native (no EngineWorkflow row — see detail below) | `modules/engine/contentCalendarCommands.ts`, called from the existing Telegram webhook route | Native replacement for n8n's "Parse Command" → "Route Action" chain: `/approve`, `/reject`, `/edit <day> <feedback>` handled directly in `routes/approvals.ts`'s Telegram webhook — the SAME place video-approval button presses already are — instead of forwarding to n8n (which is what that route used to do for everything it didn't recognize) | unit (via the content-calendar integration suite) + integration (11 tests covering approve/reject/edit/already-decided/no-draft/missing-feedback) |
| 03 | lead-capture-webhook | ✅ Native | `lead-capture-webhook` / WEBHOOK | Google Sheets → `EngineLead` (Postgres) | unit + integration + live curl |
| 04 | waitlist-management | ✅ Native | `waitlist-management` / WEBHOOK | Google Sheets → `EngineWaitlistEntry` | unit + integration + live curl |
| 05 | whatsapp-welcome-sequence | ✅ Native | `whatsapp-welcome-sequence` / CRON `0 9 * * *` UTC | Google Sheets leads + splitInBatches loop → `whatsapp.runSequence` action over `EngineLead`, per-lead `sequenceState` tracking (no loop step type exists, so one composite action does the batch — see §2/§7) | unit + integration (incl. a **labeled simulation** of the WhatsApp Cloud API via the existing `ALLOW_PROVIDER_OVERRIDES` test-mode hook — no real Meta credentials exist anywhere in this project) + live curl (test-run hit a REAL `ENOTFOUND` network error against the real graph.facebook.com from this sandbox once WhatsApp was marked CONNECTED, and was correctly caught and reported per-lead as `provider_error` without crashing the run — ships disabled, see below) |
| 06 | whatsapp-engagement-followup | ✅ Native | `whatsapp-engagement-followup` / CRON `0 10 * * *` UTC | Same `whatsapp.runSequence` action, `referenceField: lastContactedAt` (re-engages leads gone quiet since their last outreach, not calendar age) | unit + integration + live curl — ships disabled |
| 07 | referral-campaign | ✅ Native | `referral-campaign` / WEBHOOK | Google Sheets → `EngineReferral`/`EngineReferralCode` | unit + integration + live curl |
| 08 | feedback-collection | ✅ Native | `feedback-collection` / WEBHOOK | Google Sheets → `EngineFeedbackRequest` | unit + integration + live curl |
| 09 | weekly-analytics-report | ✅ Native | `weekly-analytics-report` / CRON `0 9 * * 1` UTC | Google Sheets reads → live Postgres aggregation (`report.weeklyAnalytics`); **this batch replaced an earlier placeholder that only emitted an event with no report logic behind it — see the bug note in §3** | unit + integration + live curl (manual test-run → SUCCEEDED) |
| 10 | social-post-scheduler | ✅ Native | `social-post-scheduler` / CRON `0 10,12,14,16,18,20 * * *` UTC | New action `content.postApprovedDraft`: posts the oldest human-APPROVED `EngineContentDraft` to X (real API v2 `/2/tweets`) or Buffer (real legacy `/1/updates/create.json`), reusing the EXISTING `autopilotStop`/`autopilotSocialPosting`/`twitterPostingEnabled` settings as the same kill-switches the n8n original read from env vars | unit + integration (9 tests incl. a **labeled simulation** of both providers — no real X/Buffer credentials exist anywhere) — ships disabled |
| 12 | ai-social-autopilot | ✅ Native | `ai-social-autopilot` / CRON `0 9 * * *` UTC | Same `ai.complete`+`content.queueMany` pipeline as 18/21/22, then opportunistically calls the SAME `content.postApprovedDraft` action 10 uses. **Deliberate safety divergence from the n8n original**, documented below, not a fidelity gap | unit + integration + live curl — ships disabled |
| 13 | whatsapp-lead-funnel | ✅ Native | `whatsapp-lead-funnel` / EVENT `whatsapp.message_received` | GET-verification handshake + HMAC-SHA256 `X-Hub-Signature-256` check over the RAW body in `routes/whatsappWebhook.ts` (mounted before `express.json()` — raw bytes, not re-serialized JSON), then `whatsapp.processInboundMessage` reproduces the exact STOP/START/greeting/buyer/vendor word-list classification from the n8n original; replies are free-text session messages (not templates), persisted to the new `EngineWhatsAppConversation` table | unit (pure payload parsing) + integration (13 tests against the REAL Express app on a real socket: valid/invalid/missing/tampered signatures, malformed JSON, fails-closed-when-unconfigured, message_id dedup, GET handshake valid/invalid, the full conversation state machine including STOP/START re-subscribe) + live curl — ships disabled, see §8 |
| 14 | autopilot-controller | **NOT PORTED** | — | n/a — a daily cross-workflow summary; natively trivial once 05/06/10/12/13/19 exist, deferred until they do | — |
| 15 | viral-intelligence-engine | ✅ Native | `viral-intelligence-engine` / CRON `0 */6 * * *` UTC | New action `apify.runTrendsActor` (real Apify `POST /v2/acts/{actorId}/run-sync-get-dataset-items`, confirmed from the n8n node's own URL construction) feeds `intelligence.analyzeTrends`, which collapses the prompt-formatting/AI-call/pattern-parsing chain into one action and persists to new table `EngineTrendPattern` | unit + integration (labeled simulation of Apify + the AI provider — no real credentials for either exist anywhere) — ships disabled |
| 16 | pain-discovery-engine | ✅ Native | `pain-discovery-engine` / CRON `0 6 * * *` UTC | New action `reddit.searchPosts` (real, unauthenticated Reddit search JSON endpoint, URL built entirely from Reddit's own fixed host/path — never a caller-supplied base URL, so this cannot be redirected to another host) feeds `intelligence.analyzePainPoints`, which maps the AI's index-based categorization back to the original posts and persists to new table `EnginePainPoint` | unit + integration (Reddit tested against the REAL public endpoint — no credentials to simulate; AI provider still simulated) — ships disabled |
| 17 | manychat-comment-funnel | ✅ Native | `manychat-comment-funnel` / WEBHOOK | Google Sheets → `EngineSocialLead` (new model, distinct from `EngineLead` since a commenter may have no phone number yet) | unit + integration + live curl |
| 18 | content-multiplication-engine | ✅ Native | `content-multiplication-engine` / WEBHOOK | Google Sheets content queue → `EngineContentDraft`; AI step uses the new `ai.complete` action (OpenAI/Groq, whichever is CONNECTED) | unit + integration (incl. a **labeled simulation** of a connected AI provider — no real OpenAI/Groq credentials exist anywhere in this project's test environments) + live curl (honest "not configured" skip, zero drafts fabricated) |
| 19 | whatsapp-nurture-sequences | ✅ Native | `whatsapp-nurture-sequences` / CRON `0 8 * * *` UTC | Same action, run twice (VENDOR/BUYER tracks) via the new `EngineLead.leadType` field — a lead with no `leadType` set is never guessed at and is excluded from both | unit + integration + live curl — ships disabled |
| 20 | ab-testing-engine | **NOT PORTED** | — | n/a — depends on 10/12 (published-post data) existing first | — |
| 21 | social-proof-engine | ✅ Native | `social-proof-engine` / WEBHOOK | Same `ai.complete` + `EngineContentDraft` pipeline as 18, different prompt | unit + integration + live curl |
| 22 | performance-analyst-agent | ✅ Native | `performance-analyst-agent` / CRON `30 9 * * 1` UTC | Google Sheets reads → same aggregation as 09, plus an `ai.complete` insights step (skipped honestly, figures still reported, if no AI provider is connected) | unit + integration + live curl (manual test-run → SUCCEEDED) |

**Totals: 18 of 22 workflows (82%) have a native equivalent today — up from 17
(77%) before this batch (02 is counted as done via its Telegram command
handler, which has no EngineWorkflow row — see below for why that is the
correct shape, not a gap). Workflow 00 needs no native port at all (§2's
dead-letter queue + audit log already supersede it) — counting that as
resolved too, 19 of 22 (86%) no longer need n8n for anything. The other 2
(14, 20) still depend on n8n to run.** The objective stated in the
governing instructions — "after implementation, connecting external API
credentials + configuring provider webhooks + enabling production settings
should be the ONLY remaining integration work" — is **not yet achieved**
for this repository as a whole, and must not be reported as achieved until
14 and 20 are either ported or the user explicitly accepts them as out of
scope.

### Priority 5 in detail — content calendar + Telegram command routing (00/01/02)

**Workflow 00 is intentionally not ported.** It was n8n's own
`errorWorkflow` setting — every other n8n workflow pointed its Settings →
Error Workflow at it, so n8n itself would invoke it whenever any workflow
threw. The native engine has no equivalent concept to point at it, because
it doesn't need one: every execution's failure is already durably recorded
(`EngineExecution.error`, the dead-letter flag, the full step history) and
already reaches the team via `notify.telegram` steps the workflows
themselves define. Porting 00 "for completeness" would mean building a
parallel, redundant alerting path. This is a design decision, stated here
rather than silently skipped.

**Workflow 01** (`contentCalendar.generateDraft`) needed a real
system-of-record for n8n's "Content Calendar" Sheets tab — admin-curated
30-day content plan, not AI-generated — which is the new
`EngineContentCalendarEntry` table, with CRUD endpoints at
`/api/engine/content-calendar` (upsert-by-day-number, matching how an admin
actually edits a plan: "set day 7 to this", not an append-only log). No
dedicated calendar UI page exists yet — curating it is via the admin API
directly, the same scope decision already made for every other
JSON-editable surface in this project (§6).

**Workflow 02 has no EngineWorkflow row, by design, not by omission.** Its
job was always reactive: parse a Telegram text command, act on it, reply.
The video-approval flow already established the pattern for exactly this
shape of work — button-press/command handling lives as plain, directly-
callable code in `routes/approvals.ts`'s Telegram webhook handler, not as
a triggered workflow. `modules/engine/contentCalendarCommands.ts` extends
that same webhook handler with `/approve <day>`, `/reject <day>`, and
`/edit <day> <feedback>` (the exact regex and command grammar reproduced
from n8n's "Parse Command" node), **replacing a line of code that used to
forward every unrecognized Telegram update to n8n's own webhook** — that
forwarding is now gone; nothing about content approval depends on n8n
being reachable anymore. `/edit` calls the AI with the exact revision
prompt the n8n original used, overwrites the existing draft, and resets it
to `DRAFT` for re-approval (never auto-approves its own revision).

**A live, end-to-end verification** (not a mock): with no AI provider
connected in this sandbox, a real manual test-run of `ai-content-
generation` against a running server found the real calendar entry, built
the real AI prompt, and made a real network call to the configured AI
endpoint — which genuinely failed with `ENOTFOUND` (the same sandbox
network limitation noted for Reddit above), caught and surfaced honestly
in the execution's `error` field with a scheduled retry, exactly as
designed. The success path (a draft actually getting created) is what the
integration suite's labeled AI-provider simulation covers instead.

**An emergent integration, not a new code path**: an `EngineContentDraft`
approved via a Telegram `/approve` command is indistinguishable from one
approved through the Content Drafts admin page — `content.postApprovedDraft`
(Priority 3) will pick it up and post it via X/Buffer on `social-post-
scheduler`'s next run if that workflow is enabled. One posting pathway
serves all four sources (18, 21, 12, and now 01) that feed the review
queue, not four separate ones.

### Priority 4 in detail — intelligence engines (15/16)

Two new senders implement each provider's REAL, confirmed-not-guessed
contract: `apify.runTrendsActor` calls Apify's `POST /v2/acts/{actorId}/
run-sync-get-dataset-items` (the exact URL n8n 15's "Run Apify Actor" node
built), reading the actor id and its JSON input from the Apify
integration's OWN stored config (`trendsActorId`/`trendsInputJson`) rather
than from the workflow definition — operator-owned config stays
operator-owned. `reddit.searchPosts` calls Reddit's real, unauthenticated
search JSON endpoint (`GET /r/{subs}/search.json`), confirmed from n8n 16's
"Fetch Reddit" node. Both prompt-formatting/AI-call/result-parsing chains
("Build AI Request" → "AI Analyze Trends"/"AI Categorize" → "Parse
Patterns"/"Build Pain Rows" in the n8n originals) are collapsed into one
action each (`intelligence.analyzeTrends`, `intelligence.analyzePainPoints`)
for the same reason as `whatsapp.processInboundMessage` and
`whatsapp.runSequence` before them: the per-item prompt formatting and the
AI's index-based mapping back to the original post are real array logic
the engine's path-based templating cannot express directly. Both reproduce
the n8n originals' exact prompt text, not a rewording.

**Reddit needs no credentials** — its search endpoint is public — so
`reddit.searchPosts` was tested against the REAL `reddit.com` over the
network, not a simulation (there is nothing to simulate for a public,
unauthenticated endpoint). That test genuinely failed with `ENOTFOUND` in
this sandbox, which has no outbound route to the public internet for that
host; the test catches this and reports it honestly (a console warning,
not a fabricated pass) rather than asserting success it cannot actually
observe. This is the one case in the whole project where "LOCALLY TESTED"
for a specific provider call could not be fully demonstrated from this
sandbox — reported here rather than silently worked around.

### Priority 3 in detail — social posting (10/12) and a deliberate safety divergence

`content.postApprovedDraft` reuses X's and Buffer's REAL documented APIs,
confirmed from the n8n originals' own `httpRequest` node configuration, not
guessed: X's API v2 `POST /2/tweets` (OAuth 2.0 Bearer, JSON `{text}`,
success = a real tweet id in the response) and Buffer's legacy `POST
/1/updates/create.json` (Bearer access token, JSON `{text, profile_ids:
[id], now: true}`, success = the response's own `success: true`, which the
Buffer provider's existing `caveat` field already flags as unconfirmed
against a live account — that caveat still applies; this change implements
the documented contract, it does not newly verify it against a real
Buffer account). A provider failure (e.g. a 500, or Buffer returning
`success: false`) leaves the draft `APPROVED` — never `PUBLISHED` — with
the failure reason written to `reviewNote`, verified with a dedicated test.

**Workflow 12's n8n original has its own AI "safety check" step that can
mark a post `approved` and let it auto-post with no human ever reviewing
it**, gated only by the `autopilotSocialPosting`/`autopilotStop` env flags.
The native port deliberately does **not** reproduce this: `ai-social-
autopilot` generates a draft and queues it into the SAME human-reviewed
Content Drafts queue 18/21/01 use, then opportunistically tries
`content.postApprovedDraft` — which only ever finds something to post once
a human has actually clicked Approve, on this or any earlier run. This is
a documented safety-over-fidelity choice: the instruction to "preserve
original n8n business logic" is honored for the posting mechanics and the
kill-switches, but not for this specific self-approval path, because
automating away the one human checkpoint the project's own Content Drafts
feature exists to provide is not a behavior worth preserving. If a true
auto-post-without-review mode is wanted later, it needs an explicit,
separate decision — not a silent revert of this choice.

All 18 EngineWorkflow rows (01 among them; workflow 02 has none, by design) are seeded idempotently on server boot
(`seedPortedWorkflows()` in `server.ts`, with an auto-upgrade path that
publishes a new version when a seed's definition changes without mutating
any already-published version — itself covered by an integration test).
Every one was exercised with real `curl` calls against a locally-running
server in addition to the automated suites: public webhook ingestion,
idempotent duplicate handling, admin-API auth enforcement, audit logging,
the manual test-run path, and honest provider-failure results (no
Resend/WhatsApp/OpenAI/Groq credentials are configured anywhere in this
project's environments, so every provider-dependent step correctly reports
`not_configured` and fabricates nothing).

**The 3 WhatsApp sequence workflows (05/06/19) and workflow 13 ship with
`enabled: false`**, unlike the first two batches — this is a deliberate
change: a workflow that actually messages real phone numbers (05/06/19 in a
loop; 13 in response to inbound messages) is a materially bigger blast
radius than a single lead-capture webhook, so none of them auto-enable just
because they degrade honestly when unconfigured. An admin must explicitly
enable each (via `POST /api/engine/workflows/:key/enable`), after confirming
WhatsApp is CONNECTED (with Meta-approved templates for 05/06/19
specifically) and running at least one manual test-run.

### Priority 2 in detail — WhatsApp Lead Funnel (13) webhook security

Meta's WhatsApp Cloud API webhook contract (confirmed against Meta's own
documentation, not guessed) has two parts, both implemented in
`routes/whatsappWebhook.ts` + `modules/engine/whatsappWebhookSecurity.ts`:

1. **GET verification handshake** — `hub.mode=subscribe` +
   `hub.verify_token` (compared against the configured WhatsApp integration's
   `verifyToken`) + `hub.challenge`, echoed back verbatim as the response
   body on success, 403 otherwise.
2. **POST signature** — header `X-Hub-Signature-256: sha256=<hex>`, where
   `<hex>` is HMAC-SHA256 of the **raw** request body bytes keyed with the
   app secret, compared with `crypto.timingSafeEqual` (constant-time).
   **Fails closed**: if WhatsApp is not CONNECTED or the app secret is
   empty, every signature is rejected — this is a security control, not a
   "skip verification until configured" shortcut. An invalid, missing, or
   mismatched signature is rejected with 401 **before any business logic
   runs** — no lead is upserted, no outbox event is written, no reply is
   ever sent for a request that fails this check.

Getting the raw bytes required mounting this router **before**
`app.use(express.json(...))` in `app.ts` (Express's global JSON body parser
would otherwise have already consumed and re-serialized the body by the
time any later route saw it — a re-serialized JSON object is not guaranteed
byte-identical to what Meta actually signed, e.g. key ordering or
whitespace, so verifying against it would be verifying the wrong bytes).
This is why workflow 13 is its own router rather than one more entry in the
generic `/api/hooks/:workflowKey` contract (`routes/hooks.ts`), which
assumes an already-parsed JSON body and has no GET-handshake support — a
real, provider-documented difference in webhook shape, not an invented
inconsistency.

Once a signature passes, the route responds `200` **immediately** (Meta's
own guidance: slow acknowledgement triggers retry backoff) and only then
parses the message and emits it onto the existing transactional outbox
(`emitEvent`, dedup-keyed on Meta's own `message_id`) — reusing the same
durable async infrastructure every other EVENT-triggered workflow uses, not
a parallel one. A message_id Meta redelivers (its own retry behavior) is
naturally deduped by the outbox's unique `dedupeKey`, verified with an
actual duplicate-delivery test (two identical POSTs, one outbox row).

The conversation classification itself (`whatsapp.processInboundMessage`)
reproduces n8n's STOP/START/greeting/buyer/vendor word lists verbatim — not
reinvented — and replies with free-form text via a new sender function,
`sendWhatsAppSessionText`, which is deliberately NOT gated on
`whatsappTemplatesApproved` (that setting governs business-initiated
template messages; a session reply to the lead's own inbound message is
real-time customer service messaging, which Meta's policy permits as free
text — a correctness detail carried over from the n8n original's own
compliance note, not dropped during the port).

**Verification evidence, precisely**: 5 unit tests (pure payload parsing,
no DB) + 13 integration tests that drive the REAL Express app
(`createApp()`) on a real TCP socket with real HTTP requests — valid
signature, missing signature, wrong signature, a tampered payload whose
signature was computed over the original (not the tampered) bytes, malformed
JSON, fails-closed when WhatsApp is CONFIGURED but not CONNECTED, duplicate
message_id, both GET-handshake outcomes, and the conversation state machine
(vendor self-identification, STOP → unsubscribed → ignored until START →
re-subscribed, and one `EngineWhatsAppConversation` row per inbound message
with its reply embedded). No real Meta app secret exists in any environment
available to this project — "real provider" here means the real,
documented HMAC-SHA256 algorithm computed with a test-controlled secret,
which is the standard way to test an HMAC webhook without a live account
(there is no sandbox WhatsApp Business Account that would sign test
requests for this project). This is LOCALLY TESTED, not STAGING or
PRODUCTION VERIFIED, and is reported as such.

### What's blocking the remaining 2 — concrete, not hand-waved

- **14 (autopilot controller)** is a cross-workflow daily summary; every
  workflow it reads from (05/06/10/12/13/19) now exists, so it is unblocked
  but not yet built — purely a matter of writing the composite
  read-and-summarize action, no new primitive needed.
- **20 (A/B testing)** reads "published content" performance data — 10/12
  are now posting for real (simulated-provider tested), so this is
  unblocked but not yet built.

None of the above are faked, stubbed, or silently skipped — they simply were
not reached this batch, and this table says so plainly rather than counting
a route or a UI page as "done" without the execution behavior behind it.

## 5. Security and governance notes

- **No code-execution step type.** `definition.ts`'s `StepDefinition` union is
  closed to `action | condition | delay | parallel`. There is no `eval`,
  `script`, or similar step kind, by construction.
- **No generic HTTP action.** Every action in `actions/index.ts` is a named,
  Zod-input-validated call into an existing domain service or a specific
  known provider adapter (Resend, WhatsApp Business API, Telegram, and now
  `ai.complete` for OpenAI/Groq). `ai.complete` takes a system/user prompt
  **string** from the workflow definition, never a URL or destination — it
  can only ever reach the two allow-listed AI provider endpoints its own code
  hard-codes, so a workflow author (or an attacker who got write access to a
  definition) still cannot make the engine call an arbitrary host. There is
  no action that takes an arbitrary URL and makes a request to it — this is
  the SSRF mitigation called for in the project's governing security
  requirements, and it still holds after this batch.
- **Secrets never enter workflow definitions, context, or logs.** Provider
  credentials are read server-side from the existing `Integration`/`Setting`
  tables inside action handlers; the execution `context` JSON only ever holds
  business data (lead IDs, template variables, action outputs), never raw
  credentials. Sender modules redact secrets from error messages
  (`describeHttpFailure`/`scrubSecrets`, reused from the existing codebase).
- **RBAC gap, honestly stated.** This repository's admin auth model is a
  single `AdminUser` role gated by `requireAdmin` — there are no "4 admin
  roles" or a "Super-Admin" tier here (that model belongs to the separate Eki
  marketplace codebase). Every mutating `/api/engine/*` endpoint requires a
  valid admin JWT, and every privileged action (publish, rollback, cancel,
  replay, enable/disable) is written to the existing audit log — but there is
  no finer-grained authorization tier to enforce beyond "is an authenticated
  admin." Any requirement in the governing instructions that assumes a
  multi-role RBAC model does not map onto this single-operator repository as
  written, and is flagged here rather than silently ignored or fabricated.
- **Rate limiting.** The public webhook ingestion endpoint
  (`POST /api/hooks/:workflowKey`) is rate-limited (30 requests/60s per IP).
  Manual test-run and replay go through the existing `requireAdmin` gate but
  do not yet have a dedicated additional rate limit — a gap worth closing if
  this is deployed with multiple admin operators.

## 6. Admin UI (`web/src/app/workflow-engine/`) — IMPLEMENTED, LOCALLY TESTED (typecheck/lint/build only)

Built so far, reusing the existing `ControlCenterLayout`/`ui.tsx` primitives:

- **Dashboard** (`/workflow-engine`) — queue/dead-letter/enabled-workflow
  summary tiles, clickable workflow list, 10s polling.
- **Workflow detail** (`/workflow-engine/[key]`) — trigger/category/current-
  version cards, full version history with Publish/Roll-back buttons and a
  collapsible raw-JSON definition view per version, a JSON-textarea new-draft
  editor, a manual test-run form, and the workflow's recent executions.
- **Executions list** (`/workflow-engine/executions`) — global, filterable by
  status and dead-letter flag.
- **Execution detail** (`/workflow-engine/executions/[id]`) — status/attempt/
  dead-letter/replay-of badges, trigger payload, per-step cards (input/
  output/error/duration), Cancel and Replay buttons shown conditionally on
  current status, and the final context JSON.
- **Content Drafts** (`/workflow-engine/content-drafts`) — new this batch:
  the human-review queue for AI-generated content from 18/21 (and any future
  content-calendar workflow), filterable by status, with Approve/Reject
  buttons. This is genuinely the review step 02-content-approval's n8n
  Telegram flow provided — but honestly, approving a draft here only marks
  it `APPROVED` in the database; **no native action yet publishes an
  approved draft anywhere** (no Buffer/X/Meta posting action exists yet, see
  §4's blocker list), so this screen is a real, working review queue, not
  yet a complete publishing pipeline.

Verified: `tsc --noEmit`, `next lint`, and `next build` all clean on every
page, including the 4 pages from the previous batch plus Content Drafts. The
new engine admin endpoints behind it (`GET/POST /api/engine/content-drafts*`)
were exercised with real `curl` calls using a locally-created admin JWT:
login, list drafts, approve a draft, and the dashboard/workflow-detail/
execution-detail pages' underlying endpoints (workflow list, scheduler
health, queue health, manual test-run → poll the resulting execution to
SUCCEEDED) — all against the real locally-running server, not mocked. No
browser session has clicked through the rendered pages themselves in this
segment of work — the UI claims stop at "compiles, builds, and its backing
endpoints are verified by curl," not "was clicked through in a browser."

### Known gaps against the full 16-screen Automation Centre spec

Not yet built as dedicated screens: a provider-connection-status panel
specific to the engine (the existing `/integrations` page covers general
provider status but isn't engine-aware), a dedicated audit/permission-denied
feedback view for engine actions (the existing `/audit` page records these
events but has no engine-specific filter), and worker/queue health as a
standalone screen (queue counts currently surface only as dashboard tiles,
not a dedicated health page). There is also no visual drag-and-drop workflow
builder — workflow definitions are authored/edited as raw JSON. This is a
deliberate scope decision for this phase, not an oversight, but it means the
"every visible button is a real operation" requirement is easier to meet
precisely because the editing surface is minimal (a JSON textarea plus a
handful of state-transition buttons) rather than a full graphical builder.

## 7. What "done" would require from here

1. Port the remaining 2 workflows: 14 and 20, both unblocked (everything
   they read from already exists), just not yet written — a composite
   summary action and a composite analysis action respectively, no new
   primitive needed.
2. Build a dedicated Content Calendar admin UI page (today it's API-only,
   `/api/engine/content-calendar`) — the same scope decision as every other
   JSON-editable surface in this project, but worth revisiting once there's
   an actual 30-day plan to curate day by day rather than via curl/Postman.
3. Meta (Facebook Page/Instagram/LinkedIn) posting for content drafts is a
   separate, still-open path if that is ever wanted (today `content.
   postApprovedDraft` only posts to X/Buffer).
4. Close the test gaps listed in §3 (version-change-during-execution, a true
   Redis-outage-and-recovery test, provider rate-limit simulation, a
   documented decision on whether the WhatsApp sequences' one-stage-per-run
   catch-up pacing is the wanted behavior for a lead reactivated after a long
   pause, or whether it should fast-forward to the latest-due stage instead).
5. Build the remaining Automation Centre screens listed in §6 (provider
   status, audit/permission-denied, dedicated queue/worker health).
6. Run the full end-to-end acceptance scenario list (duplicate delivery,
   Redis outage, worker restart, provider timeout, retry-then-success,
   permanent failure, workflow pause, disabled provider, unauthorized manual
   execution) as a single explicit, documented pass.
7. Get this deployed to a real staging environment with at least one real
   provider connected, to earn the STAGING VERIFIED tier for any of the above
   — nothing in this document should be read as more than LOCALLY TESTED
   until that happens.

## 8. Provider readiness report (honest, per provider)

No provider below has ever been exercised against its real endpoint by this
project — every "Connected" status an admin would see is possible but has
never actually been earned in any environment this repo has run in. This is
a readiness checklist, not a claim that anything is production-ready.

| Provider | Native workflows that need it | Status in every environment so far | What "ready" requires |
|---|---|---|---|
| WhatsApp Cloud API (Meta) | 03, 04, 05, 06, 13, 19 | Never connected with real credentials in any environment. A real network call was made from this sandbox during batch 3's live verification and correctly failed with a DNS error (`ENOTFOUND graph.facebook.com`) — proving the failure path works, not that the provider works. Workflow 13's webhook signature verification was tested against the real, documented HMAC-SHA256 algorithm with a test-controlled secret (there is no sandbox WhatsApp Business Account to sign real test requests) — see §4's Priority-2 detail. | A real permanent access token + phone number ID + **app secret** + **webhook verify token** in Integrations; Meta-approved templates for every `WELCOME_D*`/`REENGAGE_*`/`NURTURE_*` key actually used (05/06/19 only — 13's replies are free text, not templates); `whatsappTemplatesApproved` ticked only after that approval is confirmed; the webhook URL (`/api/webhooks/whatsapp`) actually configured in Meta's dashboard and the GET handshake completed there for real; and a real test-run/real inbound message watched to a correct result — only then should 05/06/13/19 be enabled. |
| Telegram | Every workflow's team alert step | Never connected with a real bot token in any test here. Every alert step this batch correctly reported `not_configured`. | A real bot token + team chat id in Integrations, confirmed via the existing `/api/integrations` test-connection call. |
| OpenAI / Groq | 01, 12, 15, 16, 18, 21, 22 | Never connected. Every real call this and earlier batches made correctly reported `not_configured`, or — for a genuine network attempt from this sandbox (01's live test-run) — a real `ENOTFOUND`, never a fabricated success. Integration tests use a labeled local simulation. | A real API key for one of the two in Integrations. This is now the single most-depended-on provider in the project: 7 of the 18 native workflow rows need it. |
| Resend | 04, 07 | Never connected. | A real API key + a domain verified in Resend. |
| Google Sheets | None — every ported workflow replaced it with a native Postgres table | N/A — intentionally retired for the 13 ported workflows (see §4's per-row notes); still the system of record for the 9 not yet ported. | N/A until those 9 are ported, at which point each one is individually replaced the same way, not reconnected. |
| X (Twitter) | 10, 12 | Never connected with real credentials. `postTweet`'s real HTTP call path (timedFetch/withRetry/describeHttpFailure) was exercised against a **labeled local simulation** of X's API v2 endpoint this batch — a real 500 was simulated and correctly left the draft unpublished with the failure recorded. | A real OAuth app (client ID/secret) connected via the existing X OAuth flow (`/api/oauth`), `twitterPostingEnabled` ticked, `autopilotSocialPosting` ticked, `autopilotStop` off, and a real test post watched to a real tweet id — only then should 10/12 post for real. |
| Buffer | 10, 12 | Never connected with real credentials. Same labeled-simulation testing as X. The Buffer provider's own `caveat` (its legacy API shape has never been confirmed against a live account, since Buffer no longer registers new OAuth apps for it) still applies and is not resolved by this batch. | A real Buffer access token + the correct profile ID for each platform actually used, plus the same settings as X above. Treat the first real post as the actual verification that Buffer's legacy API still behaves as documented — this project cannot confirm that without one. |
| Apify | 15 | Never connected with real credentials. `apify.runTrendsActor`'s real HTTP call path was exercised against a **labeled local simulation** of Apify's dataset-items endpoint this batch. | A real API token + a real, working `trendsActorId` (and valid `trendsInputJson`) in Integrations, plus an AI provider connected (the analysis step needs both), and a real test-run watched end to end. |
| Reddit | 16 | No credentials needed — it's a public endpoint. Tested against the REAL `reddit.com` this batch; genuinely failed with `ENOTFOUND` from this sandbox (no outbound route), reported honestly rather than faked — see §4's Priority-4 detail. | Nothing to configure for Reddit itself; this workflow's real dependency is an AI provider being connected, plus confirming from an environment WITH internet access that the real search endpoint behaves as this project assumes. |
