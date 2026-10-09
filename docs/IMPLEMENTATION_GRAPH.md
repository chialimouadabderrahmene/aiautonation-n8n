# AI Content Engine pivot — implementation graph

One-time audit, then the dependency graph, node status, owning files, and what each node outputs. See [docs/AI_CONTENT_ENGINE_STATUS.md](AI_CONTENT_ENGINE_STATUS.md) for the narrative status report and [the pivot gap analysis](https://claude.ai/code/artifact/a5764675-6d5d-4e07-8808-ef7e58fd2bb1) for the original decision context.

## Audit (node A)

| Area | Finding |
|---|---|
| Reusable as-is | Video pipeline (`worker/src/pipeline/{script,voice,video,assemble,qa,orchestrator}.ts`), Telegram approval (`worker/src/delivery/telegram.ts`), OAuth + encrypted vault (`api/src/modules/{oauth,integrations}`), `AutomationExecution` (unified execution log — this **is** the native automation-engine's execution history, already shared by n8n and the video worker), BullMQ queue plumbing (`api/src/lib/queue.ts` / `worker/src/lib/queue.ts`), Railway deployment tooling |
| n8n-dependent | The 22 workflows in `n8n-workflows/*.json` — content generation, comment funnels, WhatsApp nurture, viral intelligence, pain discovery, social proof, A/B testing, analytics. n8n itself still runs as an internal engine of the API (provisioned, synced, hidden from the UI) |
| External integrations touched | WhatsApp Cloud API (new native webhook, reusing the existing `whatsapp` Integration's stored credentials), Telegram (reused), OpenAI/Groq (reused), Meta/X/LinkedIn OAuth (reused, extended) |
| DB models affected | See schema diff below — all additive; two migrations, zero breaking changes to existing tables (one new nullable column each on `Publication` and `VideoProject`, one new enum value) |
| APIs affected | New: `/api/brand/*`, `/api/accounts/*`, `/api/carousel/*`, `/api/whatsapp/*` (+ public `/api/whatsapp/webhook`). Changed: `/api/video/projects` (new optional `publishAccountIds`), `/api/approvals` decide() (fans out per connected account too) |
| UI affected | New pages: Brand Brain, Connected Accounts, Carousels, WhatsApp Onboarding. Nav updated |

## Dependency graph

```
A (audit)
├── B (Brand Brain)        — done, blocks C/D/G
├── C (Automation Engine)  — WhatsApp slice done; n8n-workflow porting deferred
├── D (Carousel/Slideshow) — done, depends on B
├── E (Multi-account)      — done
└── F (WhatsApp onboarding)— done, is C's delivered slice

B → D, B → C (brand context available to it), B → G
C → G
D → G
E → G
F → G  (F and C overlap: the WhatsApp conversation IS the native automation this pass ports)
```

## Node status

| Node | Status | Owner (this pass) | Key files | Output |
|---|---|---|---|---|
| A — audit | ✅ done | — | this file | the table above |
| B — Brand Brain | ✅ done | — | `api/src/modules/brand/`, `api/src/routes/brand.ts`, `worker/src/lib/brand.ts`, `worker/src/pipeline/critic.ts`, `web/src/app/brand-brain/` | persistent brand voice + audience vocabulary, auto-injected into every script/slide generation call, with a critic pass that scores and corrects drift |
| C — Automation Engine | ⚠️ partial | — | `api/src/modules/whatsapp/conversation.ts` (the one flow ported), existing `AutomationExecution` + BullMQ (the engine itself, already shared infra) | WhatsApp's keyword/signup/listing logic runs as native TypeScript, no n8n. The other 20 n8n workflows (content research, nurture sequences, social proof, analytics, A/B testing) are **not** ported — see Owner decisions |
| D — Carousel/Slideshow | ✅ done | — | `worker/src/pipeline/{slides,render-slides,carousel-orchestrator}.ts`, `api/src/routes/carousel.ts`, `web/src/app/carousels/` | script → N branded slide PNGs (ffmpeg/ASS renderer, no new dependency) → Telegram media-group approval. Verified by rendering a real slide (see status report) |
| E — Multi-account distribution | ✅ first slice | — | `api/src/modules/accounts/`, `api/src/routes/accounts.ts`, `worker/src/lib/connected-accounts.ts`, `web/src/app/connected-accounts/` | `ConnectedAccount` model + capture flow (reuses the existing OAuth connect, names and stores the resulting tokens separately); `Publication`/publish.ts/approvals.ts extended to publish per account. Capture mechanism is v1 (see Owner decisions for a richer multi-account OAuth UI) |
| F — WhatsApp onboarding | ✅ done | — | `api/src/modules/whatsapp/`, `api/src/routes/whatsapp.ts`, `web/src/app/whatsapp/` | keyword → JOIN gets the group invite link (from Settings) / VENDOR or BUYER starts signup → product listing, all in the compliant 1:1 flow. Verified live end to end (see status report) |
| G — Integration/QA | ✅ this pass | — | — | typecheck + full test suite across api/worker/web, live smoke tests against the real local stack, two real bugs found and fixed |

## Schema diff (both migrations)

`api/prisma/migrations/20261005190342_brand_brain_carousels_multi_account_whatsapp/` and `.../20261005191728_brand_colors_video_publish_accounts/` — additive only:
- New: `BrandProfile`, `AudienceProfile`, `VocabularyEntry`, `ConnectedAccount`, `CarouselProject`, `CarouselJob`, `CarouselSlide`, `CarouselApproval`, `WhatsAppContact`, `WhatsAppMessage`, `ProductListing`.
- Changed: `Publication` gains nullable `connectedAccountId`; `VideoProject` gains `publishAccountIds String[]`; `ExecutionSource` enum gains `AUTOMATION_ENGINE`.
- Nothing removed, nothing required added to an existing table — a pre-pivot install upgrades with zero behavior change until the new features are used.
