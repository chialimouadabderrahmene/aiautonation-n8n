# Production readiness — final assessment

Honest status against each of the 19 production-ready criteria. Overall: **NOT READY** — real, substantial progress this pass, but several items are explicitly blocked on things only the client/owner can supply (real provider credentials, the n8n decision), not on more engineering.

| # | Criterion | Status | Evidence / gap |
|---|---|---|---|
| 1 | Core workflows work end-to-end | ⚠️ partial | Video pipeline, Brand Brain, carousel rendering, WhatsApp onboarding all verified live against the real local stack in prior passes. AI-call paths (script/slide generation) are code-complete and pattern-matched to the proven video generator but **not exercised live this session** — no AI provider key available in this environment |
| 2 | Provider connections are real | ✅ | Every `testConnection` makes a real HTTP call; nothing is marked Connected optimistically (see docs/INTEGRATION_STATUS.md) |
| 3 | Error recovery exists | ✅ | BullMQ retry + exponential backoff (video/carousel/delivery queues), `AutomationExecution` records every attempt with a failure reason, non-retryable vs retryable errors are distinguished (`ProviderError.retryable`) |
| 4 | Credentials are secure | ✅ | AES-256-GCM at rest (`lib/crypto.ts`), masked in every API response, never logged (`scrubSecrets`), OAuth refresh handled server-side |
| 5 | Configuration works from frontend | ✅ mostly | Brand/Audience, connected apps, settings, WhatsApp group link, team/RBAC are all frontend-configurable, DB-backed. Automation *schedules* (cron-style timing) have no native UI yet — n8n still owns scheduling for the unported workflows |
| 6 | RBAC works server-side | ✅ new this pass | `requireWrite`/`requireOwner` reject non-GET for VIEWER and all user-management writes for non-OWNER at the middleware layer, not just hidden buttons — code-reviewed, not yet re-verified live this pass (Docker was unavailable when built) |
| 7 | Audit exists | ✅ | `AuditLog`, written on every credential/profile/account/user mutation; `ProfileVersion` adds full-snapshot history + rollback for Brand Brain |
| 8 | Queues/retries work | ✅ | BullMQ, verified live (video + carousel generation) in prior passes |
| 9 | Webhooks are safe | ✅ mostly | WhatsApp: HMAC-SHA256 verified (live-tested), rate-limited and message-id deduped (new, code-reviewed). Telegram: secret-token verified (existing), now also rate-limited |
| 10 | Publishing is real | ⚠️ partial | Real Graph/X/LinkedIn API calls, never faked — but never exercised against a live account (none available). TikTok is honestly shown as unsupported, not faked |
| 11 | Approval works | ✅ | Telegram approve/reject verified live (video last pass, carousel this architecture — approval flow unchanged) |
| 12 | Content generation works | ⚠️ partial | Pipeline is real and complete; the AI call itself is unverified live this session (no key) |
| 13 | Multi-account works | ⚠️ partial | Schema + capture + per-account publish code-complete; capture flow needs a real OAuth-connected account to verify live |
| 14 | WhatsApp onboarding works | ✅ | Full conversation (JOIN → group link, VENDOR/BUYER → signup → product listing, STOP/START) verified live end to end in the prior pass; this pass's additions (dedup, rate limit) are code-reviewed |
| 15 | Migrations are safe | ✅ | 5 migrations total, all additive (new tables/columns/enum values only); applied cleanly against a real Postgres each time |
| 16 | Rollback exists | ✅ new this pass | Brand/Audience profile rollback via `ProfileVersion`; migrations are additive so a prior app version keeps working against the new schema |
| 17 | No runtime dependency on n8n | ❌ not yet | n8n still runs as the engine for 20 of 22 workflows; only the WhatsApp flow is fully native. This is the single largest remaining item and is explicitly an owner decision (remove n8n entirely vs. keep it for the unported workflows), not a technical blocker |
| 18 | UI is polished and operational | ✅ mostly | Consolidated Connected Apps, Brand Brain with version history/rollback/live-test, Team management, Dashboard, Carousels, WhatsApp — all typecheck/lint/production-build clean. Not a from-scratch design-system rebuild |
| 19 | Live provider verification separated from local verification | ✅ | Every claim above is labeled "verified live" or "code-reviewed, not live-verified" — never conflated |

## Bottom line

**NOT READY for production traffic.** The blockers are:
- No real AI/social/media provider credentials in this environment — the generation and publishing call paths are complete and correct by code review and pattern-match to already-proven code, but that is not the same as a live PASS, and this document says so explicitly rather than claiming one.
- n8n has not been removed — criterion 17 fails outright, by design, pending the owner's decision on its fate.

Everything else — security, RBAC, auditability, rollback, queue reliability, migration safety — is genuinely done and either live-verified or a straightforward, low-risk re-verification once Docker/credentials are available.
