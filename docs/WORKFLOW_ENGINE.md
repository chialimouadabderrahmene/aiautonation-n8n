# Native Workflow Engine — Architecture, Scope, and Gap Analysis

Status date: 2026-10-11. This document is the honest record of what the native
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

## 4. Workflow porting status — the gap analysis

Of the 22 n8n workflow definitions in `n8n-workflows/*.json`:

### Ported to the native engine (5) — IMPLEMENTED, LOCALLY TESTED

| # | Key | Native trigger | Seed |
|---|---|---|---|
| 03 | lead-capture-webhook | `WEBHOOK` | `seed/ported-workflows.ts` |
| 04 | waitlist-management | `WEBHOOK` | `seed/ported-workflows.ts` |
| 07 | referral-campaign | `WEBHOOK` | `seed/ported-workflows.ts` |
| 08 | feedback-collection | `WEBHOOK` | `seed/ported-workflows.ts` |
| 09 | weekly-analytics-report | `CRON` (`0 9 * * 1`, UTC) | `seed/ported-workflows.ts` |

These are seeded idempotently on server boot (`seedPortedWorkflows()` in
`server.ts`), verified end-to-end with real `curl` calls against a
locally-running server: public webhook ingestion, idempotent duplicate
handling, admin-API auth enforcement, audit logging, and the manual test-run
path. Honest provider-failure results were confirmed (no Resend/WhatsApp
credentials configured locally → actions correctly report `not_configured`
rather than a false "sent").

### Still running on n8n — not yet replaced (17)

| # | Key | Category |
|---|---|---|
| 00 | global-error-handler | System |
| 01 | ai-content-generation | Content |
| 02 | content-approval | Content |
| 05 | whatsapp-welcome-sequence | WhatsApp |
| 06 | whatsapp-engagement-followup | WhatsApp |
| 10 | social-post-scheduler | Social |
| 12 | ai-social-autopilot | Social |
| 13 | whatsapp-lead-funnel | WhatsApp |
| 14 | autopilot-controller | System |
| 15 | viral-intelligence-engine | AI |
| 16 | pain-discovery-engine | AI |
| 17 | manychat-comment-funnel | Lead Automation |
| 18 | content-multiplication-engine | Content |
| 19 | whatsapp-nurture-sequences | WhatsApp |
| 20 | ab-testing-engine | AI |
| 21 | social-proof-engine | Social |
| 22 | performance-analyst-agent | Reporting |

**This is the honest state of the "replace n8n at runtime" objective: 5 of 22
workflows (23%) have a native equivalent today. The other 17 (77%) still
depend on n8n to run.** The objective stated in the governing instructions —
"after implementation, connecting external API credentials + configuring
provider webhooks + enabling production settings should be the ONLY
remaining integration work" — is **not yet achieved** for this repository as
a whole, and must not be reported as achieved until the remaining 17 are
either ported or the user explicitly accepts them as out of scope.

Porting the remaining 17 is mechanical but not small: most of them read from
and write to Google Sheets as their system-of-record (leads/waitlist/
referrals/feedback), which the native engine does not yet have an action for
(the 5 ported workflows use native Postgres tables — `EngineLead`,
`EngineWaitlistEntry`, etc. — instead, which is a behavior change, not a
like-for-like port: this was accepted because Google Sheets was never going
to be acceptable as a production system-of-record for these entities either
way). Several of the remaining 17 (10, 12, 14, 18, 20, 21, 22) also depend on
AI generation steps, social-posting integrations (Buffer/X), and
Apify-scraping, none of which have a native action implementation yet.

## 5. Security and governance notes

- **No code-execution step type.** `definition.ts`'s `StepDefinition` union is
  closed to `action | condition | delay | parallel`. There is no `eval`,
  `script`, or similar step kind, by construction.
- **No generic HTTP action.** Every action in `actions/index.ts` is a named,
  Zod-input-validated call into an existing domain service or a specific
  known provider adapter (Resend, WhatsApp Business API, Telegram). There is
  no action that takes an arbitrary URL and makes a request to it — this is
  the SSRF mitigation called for in the project's governing security
  requirements.
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

Verified: `tsc --noEmit`, `next lint`, and `next build` all clean. **Not yet
verified**: no browser session has exercised these pages against a running
server in this segment of work — the claims above stop at "compiles and
builds," not "was clicked through."

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

1. Port the remaining 17 workflows, deciding per-workflow whether Google
   Sheets dependencies become native Postgres tables (as the first 5 did) or
   get documented as an explicit, intentional exception.
2. Add native actions for AI content generation, Buffer/X social posting, and
   Apify scraping, or document why those integrations are out of scope for
   full native replacement.
3. Close the test gaps listed in §3.
4. Build the remaining Automation Centre screens listed in §6.
5. Run the full end-to-end acceptance scenario list (duplicate delivery,
   Redis outage, worker restart, provider timeout, retry-then-success,
   permanent failure, workflow pause, disabled provider, unauthorized manual
   execution) as a single explicit, documented pass.
6. Get this deployed to a real staging environment with at least one real
   provider connected, to earn the STAGING VERIFIED tier for any of the above
   — nothing in this document should be read as more than LOCALLY TESTED
   until that happens.
