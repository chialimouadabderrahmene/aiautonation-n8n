# AI Content Engine — status

Pivot from the n8n-based acquisition machine to a standalone content engine on the existing `api`/`worker`/`web` codebase. See [docs/IMPLEMENTATION_GRAPH.md](IMPLEMENTATION_GRAPH.md) for the node-by-node graph, [docs/INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) for the provider-by-provider matrix, [docs/N8N_RETIREMENT_MATRIX.md](N8N_RETIREMENT_MATRIX.md) for the workflow-by-workflow n8n classification (the single source of truth for that — not duplicated here), and [the pivot gap analysis doc](https://claude.ai/code/artifact/a5764675-6d5d-4e07-8808-ef7e58fd2bb1) for why each decision was made.

## What's real right now

Everything below was exercised live against the real local stack (Postgres, Redis, the actual api/worker containers) — not just typechecked.

- **Brand Brain** (`/brand-brain`): real `BrandProfile` + `AudienceProfile` + vocabulary entry created and activated through the live API; versioned with rollback.
- **Carousel renderer + multi-account publish**: rendered real slide PNGs; an approved carousel now actually publishes to Instagram/Facebook/X/LinkedIn and to specific `ConnectedAccount`s, gated by the same autopilot safety switch as video.
- **WhatsApp onboarding** (`/whatsapp`): a full live conversation (`hi` → `vendor` → signup → product listing), HMAC-verified webhook, dedup-safe against Meta retries.
- **Provider abstraction**: OpenAI, Groq and Anthropic behind one `AIProvider` interface, admin-selectable in Settings with auto-fallback — script/slide generation and the brand critic all go through it.
- **10 n8n workflows natively ported, all done and live-verified** (03, 04, 05, 06, 07, 09, 10, 14, 18, 19 — full detail and the other 12's classification in [docs/N8N_RETIREMENT_MATRIX.md](N8N_RETIREMENT_MATRIX.md)): a BullMQ job fires, real Postgres queries run, a real Telegram digest/alert is attempted (or correctly skipped when a dependency isn't connected), logged to `AutomationExecution`.
- **ConnectedAccount selection UI**: browser-verified (Playwright against the live containers) on both `/video` and `/carousels`.
- Full `vitest` suites: `api` 79/79, `worker` 49/49. `tsc --noEmit` clean on `api`, `worker`, `web`. All three builds clean.

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
| WhatsApp welcome sequence (native, scheduled) | `worker/src/pipeline/whatsapp-welcome.ts` — n8n workflow 05 |
| WhatsApp engagement follow-up (native, scheduled) | `worker/src/pipeline/whatsapp-engagement.ts` — n8n workflow 06 |
| Referral crediting + milestones | `api/src/modules/leads/referral.ts` — n8n workflow 07 |
| Daily autopilot status + health digest | `worker/src/pipeline/autopilot-controller.ts` — n8n workflow 14 |
| Content idea → format multiplication | `worker/src/pipeline/content-multiplication.ts` — n8n workflow 18 |
| Carousel regenerate-with-feedback (parity with video) | `api/src/routes/carousel.ts` (`/projects/:id/regenerate`) |

## n8n workflow retirement matrix

See [docs/N8N_RETIREMENT_MATRIX.md](N8N_RETIREMENT_MATRIX.md) for the full, current, single-source-of-truth classification of all 22 workflows — not duplicated here to avoid the two docs drifting out of sync (which happened once already; this section used to hold its own copy of that table). Summary: 10 of 22 are ported and live-verified, 6 are REDUNDANT (native equivalents already exist), 4 are PROVIDER_BLOCKED, 2 are SPEC_BLOCKED. n8n is untouched and still running everything — nothing has been retired yet, that's an owner decision per workflow.

## Owner decisions required

1. **n8n's fate** — the retirement matrix is the input; a go/no-go per workflow (especially the 2 SPEC_BLOCKED ones, 08 and 21) is still needed before any removal.
2. **Brand voice source material** — still placeholder, not Eki's real voice/vocabulary.
3. **Workflows 01/02/12** — classified REDUNDANT but not reconfirmed against their exact n8n node logic; worth a quick confirm before retiring them.
4. **08 Feedback Collection** — build a native feedback webhook + storage model, or keep routing to the external form already configured in `feedbackFormUrl`?
5. **21 Social Proof Engine** — what system/event actually triggers a "social proof" moment? No such event source exists anywhere in this codebase or its docs.
6. **Email delivery** (weekly report, lead/waitlist/referral confirmations) — no native Resend sender exists yet; everything ships via Telegram + the synchronous HTTP response only.

## Tests passed

`api` vitest 79/79, `worker` vitest 49/49, `tsc --noEmit` clean on all three packages, all three builds clean. Live-verified across all passes: autopilot gate (SKIPPED publications + manual alert), lead capture (401 on bad key, persist + dedupe), waitlist (signup + dedupe), weekly report (manual trigger → real metrics → logged), ConnectedAccount UI (Playwright, both pages), WhatsApp welcome/engagement (manual trigger → correct fail-closed with no live WhatsApp credentials), referral crediting (unmatched / credited with milestone / duplicate), autopilot controller digest (manual trigger → real config + count queries → logged), content multiplication (manual trigger → correct fail-closed with no live AI credentials).

## Next graph nodes

1. Confirm 01/02/12 are fully redundant with native generation/approval/publish, then retire them in n8n.
2. Resolve the two SPEC_BLOCKED decisions (08, 21) above, then port whichever side of each decision is chosen.
3. Resolve the n8n's-fate decision, then execute retirement for whatever the matrix marks REDUNDANT or done-and-verified.
