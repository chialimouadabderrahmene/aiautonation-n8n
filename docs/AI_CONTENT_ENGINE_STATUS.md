# AI Content Engine — status

Pivot from the n8n-based acquisition machine to a standalone content engine on the existing `api`/`worker`/`web` codebase. See [docs/IMPLEMENTATION_GRAPH.md](IMPLEMENTATION_GRAPH.md) for the node-by-node graph, [docs/INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) for the provider-by-provider matrix, and [the pivot gap analysis doc](https://claude.ai/code/artifact/a5764675-6d5d-4e07-8808-ef7e58fd2bb1) for why each decision was made.

## What's real right now

Everything below was exercised live against the real local stack (Postgres, Redis, the actual api/worker containers) — not just typechecked.

- **Brand Brain** (`/brand-brain`): real `BrandProfile` + `AudienceProfile` + vocabulary entry created and activated through the live API; versioned with rollback.
- **Carousel renderer + multi-account publish**: rendered real slide PNGs; an approved carousel now actually publishes to Instagram/Facebook/X/LinkedIn and to specific `ConnectedAccount`s, gated by the same autopilot safety switch as video.
- **WhatsApp onboarding** (`/whatsapp`): a full live conversation (`hi` → `vendor` → signup → product listing), HMAC-verified webhook, dedup-safe against Meta retries.
- **Provider abstraction**: OpenAI, Groq and Anthropic behind one `AIProvider` interface, admin-selectable in Settings with auto-fallback — script/slide generation and the brand critic all go through it.
- **Five n8n workflows natively ported** (see the retirement matrix below) and live-verified end to end: a BullMQ job fires, real Postgres queries run, a real Telegram digest/alert is attempted (or correctly skipped when a dependency isn't connected), logged to `AutomationExecution`.
- **ConnectedAccount selection UI**: browser-verified (Playwright against the live containers) on both `/video` and `/carousels`.
- Full `vitest` suites: `api` 70/70, `worker` 30/30. `tsc --noEmit` clean on `api`, `worker`, `web`. All three builds clean.

## Features completed

| Feature | Where |
|---|---|
| Brand voice + audience vocabulary, injected into every script | `BrandProfile`/`AudienceProfile`, `worker/src/lib/brand.ts` |
| AI critic pass | `worker/src/pipeline/critic.ts` |
| One AI provider interface (OpenAI, Groq, Anthropic) | `worker/src/lib/providers/` |
| Carousel generation + Telegram approval | `worker/src/pipeline/{slides,render-slides,carousel-orchestrator}.ts` |
| Multi-account publish (video **and** carousel), account-isolated, retried, audited | `ConnectedAccount`, `worker/src/delivery/{publish,publish-carousel}.ts` |
| ConnectedAccount selection UI (not just platform) | `web/src/app/{video,carousels}/page.tsx` |
| Social-posting autopilot gate (kill switch + opt-in, native) | `api/src/modules/automation/autopilot.ts` — n8n workflow 10 |
| WhatsApp onboarding (native, no n8n) | `api/src/modules/whatsapp/conversation.ts` — supersedes n8n workflow 13 |
| WhatsApp nurture sequences (native, scheduled) | `worker/src/pipeline/whatsapp-nurture.ts` — n8n workflow 19 |
| Generic external lead capture webhook | `api/src/routes/leads.ts` — n8n workflow 03 |
| Waitlist signup + referral codes | `api/src/modules/leads/waitlist.ts` — n8n workflow 04 |
| Weekly growth report (Telegram digest, scheduled) | `worker/src/pipeline/weekly-report.ts` — n8n workflows 09 + 22 |

## n8n workflow retirement matrix (P10)

**Not acted on this pass.** The brief's own sequence — *port → test → switch native execution → verify → remove dependency* — is per workflow, and only a third of the 22 are through all four steps. Pulling n8n now would silently drop whatever the other workflows still serve in production. This table is the readiness assessment the removal decision needs, not the removal itself.

| # | Workflow | Status | Safe to retire in n8n? |
|---|---|---|---|
| 13 | WhatsApp Lead Funnel | Superseded (prior pass) | Yes |
| 19 | WhatsApp Nurture Sequences | Ported + live-verified | Yes |
| 10 | Social Post Scheduler | Core rule (autopilot gate) ported; the Google-Sheets/Buffer posting loop itself is superseded by native `ConnectedAccount` publish, not reimplemented | Yes, for the parts native publish already replaces |
| 03 | Lead Capture Webhook | Ported + live-verified (email-only leads not persisted — see module docstring) | Yes |
| 04 | Waitlist Management | Ported + live-verified (confirmation sends not ported) | Yes |
| 09 | Weekly Analytics Report | Ported + live-verified (feedback/waitlist/referral lines dropped, not faked) | Yes |
| 22 | Performance Analyst Agent | Folded into 09's native port (same metrics, its AI narrative wasn't ported) | Yes |
| 01 | AI Content Generation | Not inspected this pass, but the native script/slide pipeline (brand-reviewed, provider-abstracted) is almost certainly its superior replacement already | Needs a quick confirm, not a port |
| 02 | Content Approval Handler | Not inspected this pass, but native `Approval`/`CarouselApproval` + Telegram buttons almost certainly already replace it | Needs a quick confirm, not a port |
| 05 | WhatsApp Welcome Sequence | **Not ported** — distinct `WELCOME_D1/D2/D3` templates, not covered by workflow 19's nurture sequence | No |
| 06 | WhatsApp Engagement Follow-up | **Not ported** — distinct `REENGAGE_7/14/21` templates | No |
| 07 | Referral Campaign Tracker | **Not ported** — needs a referral-code-on-lead concept this app doesn't have yet | No |
| 08 | Feedback Collection | **Not ported** — may be intentionally out of native scope (`feedbackFormUrl` setting implies an external form) | No, needs an owner decision first |
| 12 | AI Social Autopilot | Not inspected this pass | Unknown |
| 14 | Autopilot Controller | Not inspected this pass — worth checking against P5's native gate before assuming overlap | Unknown |
| 15 | Viral Intelligence Engine | Needs Apify — not an integrated provider | No |
| 16 | Pain Discovery Engine | Needs Reddit API — not an integrated provider | No |
| 17 | ManyChat Comment Funnel | Needs ManyChat — not an integrated provider | No |
| 18 | Content Multiplication Engine | Not inspected this pass | Unknown |
| 20 | A/B Testing Engine | Not inspected this pass | Unknown |
| 21 | Social Proof Engine | Needs an external event-source shape that isn't specified anywhere | No, needs a spec first |

## Owner decisions required

1. **n8n's fate** — the matrix above is the input; a go/no-go per remaining workflow (05/06/07/08/21 especially) is still needed before any removal.
2. **Brand voice source material** — still placeholder, not Eki's real voice/vocabulary.
3. **Workflows 01/02/12/14/18/20** — worth a confirm-and-retire pass (01/02 likely redundant) or a port pass (12/14/18/20 unknown scope) before the retirement matrix can close out.
4. **Email delivery** (weekly report, lead/waitlist confirmations) — no native Resend sender exists yet; everything above ships via Telegram + the synchronous HTTP response only.

## Tests passed

`api` vitest 70/70, `worker` vitest 30/30, `tsc --noEmit` clean on all three packages, all three builds clean. Live-verified this pass: autopilot gate (SKIPPED publications + manual alert), lead capture (401 on bad key, persist + dedupe), waitlist (signup + dedupe), weekly report (manual trigger → real metrics → logged), ConnectedAccount UI (Playwright, both pages).

## Next graph nodes

1. Confirm 01/02 are fully redundant with native generation/approval, then retire them in n8n.
2. Port 05 (WhatsApp Welcome) and 06 (Engagement Follow-up) — same pattern as 19, different template keys/days.
3. Inspect 12/14/18/20 to classify them (confirm-and-retire vs. port vs. blocked).
4. Resolve the owner decisions above, then execute the n8n retirement matrix for whatever is marked "Yes".
