# Native Workflow Engine — Architecture, Scope, and Gap Analysis

Status date: 2026-10-12 (batch 2). This document is the honest record of what the native
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
| 00 | global-error-handler | **NOT PORTED** | — | n/a | — |
| 01 | ai-content-generation | **NOT PORTED** | — | n/a | — |
| 02 | content-approval | **NOT PORTED** | — | n/a | — |
| 03 | lead-capture-webhook | ✅ Native | `lead-capture-webhook` / WEBHOOK | Google Sheets → `EngineLead` (Postgres) | unit + integration + live curl |
| 04 | waitlist-management | ✅ Native | `waitlist-management` / WEBHOOK | Google Sheets → `EngineWaitlistEntry` | unit + integration + live curl |
| 05 | whatsapp-welcome-sequence | **NOT PORTED** | — | n/a | — |
| 06 | whatsapp-engagement-followup | **NOT PORTED** | — | n/a | — |
| 07 | referral-campaign | ✅ Native | `referral-campaign` / WEBHOOK | Google Sheets → `EngineReferral`/`EngineReferralCode` | unit + integration + live curl |
| 08 | feedback-collection | ✅ Native | `feedback-collection` / WEBHOOK | Google Sheets → `EngineFeedbackRequest` | unit + integration + live curl |
| 09 | weekly-analytics-report | ✅ Native | `weekly-analytics-report` / CRON `0 9 * * 1` UTC | Google Sheets reads → live Postgres aggregation (`report.weeklyAnalytics`); **this batch replaced an earlier placeholder that only emitted an event with no report logic behind it — see the bug note in §3** | unit + integration + live curl (manual test-run → SUCCEEDED) |
| 10 | social-post-scheduler | **NOT PORTED** | — | n/a — needs `buffer`/`x` posting actions (see §7) | — |
| 12 | ai-social-autopilot | **NOT PORTED** | — | n/a — needs posting actions + an "emergency stop" flag | — |
| 13 | whatsapp-lead-funnel | **NOT PORTED** | — | n/a — needs an HMAC-verified inbound WhatsApp webhook + conversational state (see §7) | — |
| 14 | autopilot-controller | **NOT PORTED** | — | n/a — a daily cross-workflow summary; natively trivial once 05/06/10/12/13/19 exist, deferred until they do | — |
| 15 | viral-intelligence-engine | **NOT PORTED** | — | n/a — needs an `apify.runActor` action | — |
| 16 | pain-discovery-engine | **NOT PORTED** | — | n/a — needs a Reddit-fetch action | — |
| 17 | manychat-comment-funnel | ✅ Native | `manychat-comment-funnel` / WEBHOOK | Google Sheets → `EngineSocialLead` (new model, distinct from `EngineLead` since a commenter may have no phone number yet) | unit + integration + live curl |
| 18 | content-multiplication-engine | ✅ Native | `content-multiplication-engine` / WEBHOOK | Google Sheets content queue → `EngineContentDraft`; AI step uses the new `ai.complete` action (OpenAI/Groq, whichever is CONNECTED) | unit + integration (incl. a **labeled simulation** of a connected AI provider — no real OpenAI/Groq credentials exist anywhere in this project's test environments) + live curl (honest "not configured" skip, zero drafts fabricated) |
| 19 | whatsapp-nurture-sequences | **NOT PORTED** | — | n/a — needs per-lead sequence-stage tracking (see §7) | — |
| 20 | ab-testing-engine | **NOT PORTED** | — | n/a — depends on 10/12 (published-post data) existing first | — |
| 21 | social-proof-engine | ✅ Native | `social-proof-engine` / WEBHOOK | Same `ai.complete` + `EngineContentDraft` pipeline as 18, different prompt | unit + integration + live curl |
| 22 | performance-analyst-agent | ✅ Native | `performance-analyst-agent` / CRON `30 9 * * 1` UTC | Google Sheets reads → same aggregation as 09, plus an `ai.complete` insights step (skipped honestly, figures still reported, if no AI provider is connected) | unit + integration + live curl (manual test-run → SUCCEEDED) |

**Totals: 9 of 22 workflows (41%) have a native equivalent today — up from 5
(23%) before this batch. The other 13 (59%) still depend on n8n to run.** The
objective stated in the governing instructions — "after implementation,
connecting external API credentials + configuring provider webhooks +
enabling production settings should be the ONLY remaining integration work"
— is **not yet achieved** for this repository as a whole, and must not be
reported as achieved until the remaining 13 are either ported or the user
explicitly accepts them as out of scope.

All 9 native workflows are seeded idempotently on server boot
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

### What's blocking the remaining 13 — concrete, not hand-waved

- **05, 06, 19 (WhatsApp sequence workflows)** need a per-lead "which stage of
  this sequence have they received" tracker (the n8n originals use
  `splitInBatches` over a Sheets-queried list and write back a timestamp per
  lead/per-stage). The engine's step model has no "for each item, run these
  steps" construct — by design, see `definition.ts`'s step-type comment — so
  this needs either a new step type or (preferred, no engine-format change)
  a composite action that loops internally and persists per-stage progress
  on `EngineLead` so a crash mid-run or a retry only sends to leads not yet
  at that stage. Schema change required; not done this batch.
- **10, 12 (social posting/scheduling)** need `buffer.post`/`x.post` actions
  calling the already-configurable Buffer/X providers. Not written yet —
  `PROVIDERS` in `modules/providers/definitions.ts` already has both, only
  the action-layer call is missing.
- **13 (WhatsApp lead funnel)** needs an inbound WEBHOOK that verifies Meta's
  HMAC signature (the n8n original computes it with a `crypto` node) before
  trusting the payload, plus a GET-verification handshake — a different,
  stricter shape than the existing `/api/hooks/:workflowKey` webhook
  contract, which has no signature-verification step at all today.
- **14 (autopilot controller)** is a cross-workflow daily summary; it is
  mechanically simple once 05/06/10/12/13/19 exist (it just reads their
  data), so porting it before them would either be hollow or duplicate work.
- **15 (viral intelligence)** needs an `apify.runActor` action; **16 (pain
  discovery)** needs a Reddit-fetch action restricted to Reddit's public API
  (never a generic URL — the engine's SSRF stance, §5, forbids that even for
  this). Neither action exists yet.
- **20 (A/B testing)** reads "published content" performance data that only
  exists once 10/12 are posting for real — ordering dependency, not a
  missing primitive.
- **00, 01, 02 (error handler, content calendar, content approval)** — 00 is
  n8n's own error-workflow mechanism and has no native equivalent need (the
  native engine has its own dead-letter/audit path instead, see §2); 01/02
  need a genuine content-calendar system-of-record (not just the single-shot
  `EngineContentDraft` queue 18/21 already use) and a Telegram **command**
  webhook integration merged into the existing `telegramPublicRouter` (which
  currently only handles video approve/reject commands) — deferred, not
  attempted this batch, to avoid a half-correct merge into code outside this
  batch's tested surface.

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

1. Port the remaining 13 workflows per §4's blocker list. In priority order:
   `buffer.post`/`x.post` actions unlock 10 and 12; per-lead sequence-stage
   tracking (a schema change) unlocks 05/06/19; an HMAC-verified inbound
   webhook contract unlocks 13; an `apify.runActor` action unlocks 15; a
   Reddit-fetch action unlocks 16; 14 and 20 become trivial once their
   upstream workflows exist; 00/01/02 need a content-calendar
   system-of-record and a Telegram-command-webhook integration.
2. Add a native action that actually publishes an `APPROVED` content draft
   somewhere (Buffer/X/Meta) — today's Content Drafts review queue (§6) ends
   at "approved in the database."
3. Close the test gaps listed in §3 (version-change-during-execution, a true
   Redis-outage-and-recovery test, provider rate-limit simulation).
4. Build the remaining Automation Centre screens listed in §6 (provider
   status, audit/permission-denied, dedicated queue/worker health).
5. Run the full end-to-end acceptance scenario list (duplicate delivery,
   Redis outage, worker restart, provider timeout, retry-then-success,
   permanent failure, workflow pause, disabled provider, unauthorized manual
   execution) as a single explicit, documented pass.
6. Get this deployed to a real staging environment with at least one real
   provider connected, to earn the STAGING VERIFIED tier for any of the above
   — nothing in this document should be read as more than LOCALLY TESTED
   until that happens.
