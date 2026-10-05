# AI Content Engine — status

Pivot from the n8n-based acquisition machine to a standalone content engine on the existing `api`/`worker`/`web` codebase. See [docs/IMPLEMENTATION_GRAPH.md](IMPLEMENTATION_GRAPH.md) for the node-by-node graph and [the pivot gap analysis doc](https://claude.ai/code/artifact/a5764675-6d5d-4e07-8808-ef7e58fd2bb1) for why each decision was made.

## What's real right now

Everything below was exercised live against the real local stack (Postgres, Redis, the actual api/worker containers) — not just typechecked.

- **Brand Brain** (`/brand-brain`): created and activated a real `BrandProfile` + `AudienceProfile` + vocabulary entry through the live API; `GET /api/brand/context` returns exactly what `worker/src/lib/brand.ts` will inject into the next script/slide generation call.
- **Carousel renderer**: rendered a real slide PNG inside the worker container (ffmpeg + a hand-written ASS subtitle track, no new dependency) — brand navy background, white headline, wrapped body text, accent-colored page counter. Caught and fixed a real bug in this pass (line-wrap markers were rendering as a literal backslash).
- **WhatsApp onboarding** (`/whatsapp`): drove the real webhook, HMAC-SHA256 signature verified, through a full conversation — `hi` → `vendor` → name/country → product name → description → price → a `ProductListing` row with status `SUBMITTED`. Also verified `JOIN` returns the configured group invite link, and `STOP` then `START` correctly unsubscribes and re-subscribes (this one needed a fix — `START` wasn't reviving an unsubscribed contact's status, only `optIn`).
- Full `vitest` suites for `api` (43 tests) and `worker` (5 tests) pass with no regressions; `tsc --noEmit` is clean across `api`, `worker`, and `web`.

## Features completed

| Feature | Where |
|---|---|
| Brand voice profile (voice, tone, banned words, CTA style, examples) | `BrandProfile`, `/brand-brain` |
| Audience vocabulary (phrases, pain points, objections, glossary) | `AudienceProfile` + `VocabularyEntry`, `/brand-brain` |
| Automatic injection into every script | `worker/src/lib/brand.ts`, wired into `script.ts` and `slides.ts` |
| AI critic pass (score, flag violations, rewrite if needed) | `worker/src/pipeline/critic.ts` |
| Carousel/slideshow generation (script → N branded slides) | `worker/src/pipeline/{slides,render-slides,carousel-orchestrator}.ts` |
| Carousel Telegram approval (media group + APPROVE/REJECT) | `worker/src/delivery/telegram.ts`, `api/src/routes/carousel.ts` |
| Multiple connected accounts per platform (schema + capture + publish) | `ConnectedAccount`, `api/src/modules/accounts/`, `worker/src/delivery/publish.ts` |
| WhatsApp: keyword → group invite link | `conversation.ts`'s `JOIN` branch + the `whatsappGroupInviteLink` setting |
| WhatsApp: signup → product listing, native, no n8n | `api/src/modules/whatsapp/conversation.ts` |
| Native webhook with real Meta signature verification | `api/src/routes/whatsapp.ts` |

## Features partially completed

| Feature | What's done | What's left |
|---|---|---|
| Multi-account distribution | Schema, capture (reusing the existing OAuth flow), publish-per-account for video | Capturing an account requires reconnecting Integrations each time (no "pick from a list of Pages" UI yet); carousel publishing to connected accounts isn't wired (carousels publish nowhere automatically yet — approval is the current end state) |
| Automation Engine | WhatsApp's flow is fully native; the execution-history/queue infrastructure (`AutomationExecution`, BullMQ) is the one shared engine, proven on 3 job types now (video, carousel, WhatsApp webhook) | The other 20 n8n workflows (trend research, nurture sequences, social proof, A/B testing, analytics reporting) are not ported — n8n still runs them |

## Owner decisions required

Unchanged from the pivot gap analysis, plus two that came up while building:
1. **n8n's fate** — cosmetic-only, or remove it from the stack entirely? Determines whether the remaining 20 workflows get ported or n8n stays as the engine for them.
2. **Brand voice source material** — the two profiles created above are real but neutral placeholders (used to verify the system, not written as Eki's actual voice). Someone needs to supply the real adjectives, banned words, example copy, and audience vocabulary.
3. **Connected-account UX** — is the "reconnect Integrations, then capture" flow acceptable, or is a native "choose which Facebook Pages to add" picker worth building?
4. **Carousel distribution** — should an approved carousel publish automatically to connected accounts (needs `Publication`'s video-only FK generalized), or stay approval-only for now?

## Tests passed

- `api` vitest: 43/43.
- `worker` vitest: 5/5.
- `tsc --noEmit`: clean on `api`, `worker`, `web`.
- Live smoke tests (see "What's real right now"): Brand Brain CRUD + activation, carousel slide rendering, full WhatsApp conversation including a caught-and-fixed bug.

## Remaining blockers

- No AI provider (OpenAI/Groq) is connected in this environment, so `generateScript`/`generateCarouselScript`'s actual AI call + critic pass were not exercised live — only their code path (identical pattern to the already-proven video script generator) and a full compile.
- No real Meta/X/LinkedIn OAuth account was available to exercise `ConnectedAccount` capture or multi-account publish live (same limitation as the original video pipeline's publish code).
- The AI image-rendering path's visual output (the rendered slide) should be reviewed against real brand colors once Owner decision #2 is answered — the neutral default looks correct but hasn't been seen with Eki's actual palette.

## Next graph nodes

1. Port the highest-value remaining n8n workflow next (likely WhatsApp nurture sequences, since the contact/message models already exist) once Owner decision #1 is answered.
2. Build the connected-account OAuth "pick a Page" UI if Owner decision #3 calls for it.
3. Generalize `Publication`'s FK so an approved carousel can publish to connected accounts, closing the loop Owner decision #4 asks about.
4. Once real brand-voice material exists (Owner decision #2), replace the placeholder profiles and re-generate a few pieces of content to sanity-check the critic pass against real copy.

## Explicitly not done this pass (by design)

- Did not touch n8n's removal — that is Owner decision #1, not a technical one.
- Did not port viral intelligence / pain discovery / social proof / A/B testing / analytics workflows — each is its own subsystem (Apify scraping, a continuously-updated intelligence library, transaction-triggered content tied to the Eki marketplace backend, which this change does not touch).
- Did not invent any brand voice, vocabulary, commission/reward rule, or campaign qualification rule — `BrandProfile`/`AudienceProfile` ship with neutral placeholders only, and `ProductListing` has no commission/reward fields at all.
- Did not push or deploy anything — all of the above is uncommitted on the working tree, migrations applied only to the local Docker Postgres used for verification.
