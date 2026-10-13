# Final architecture graph

Component-by-component status for the production-hardening pass. Builds on [docs/IMPLEMENTATION_GRAPH.md](IMPLEMENTATION_GRAPH.md) (the pivot pass that built Brand Brain/Carousel/Multi-account/WhatsApp) — that doc's audit and schema diff still hold; this one adds what changed this pass and the full component inventory.

## Component inventory

| Component | Current status | Reusable code | Target state | Dependencies | Tests | Production requirement |
|---|---|---|---|---|---|---|
| Video pipeline | ✅ unchanged | `worker/src/pipeline/{script,voice,video,assemble,qa,orchestrator}.ts` | kept as-is, not rebuilt | Runway, ElevenLabs, S3 | existing + regression-clean | real Runway/ElevenLabs creds (not available here) |
| Carousel/slideshow | ✅ built last pass | `worker/src/pipeline/{slides,render-slides,carousel-orchestrator}.ts` | done | Brand Brain, ffmpeg | slide render verified live (PNG inspected) | AI provider creds for script gen |
| Brand Brain | ✅ extended this pass | `api/src/modules/brand/*`, `worker/src/lib/brand.ts`, `worker/src/pipeline/critic.ts` | versioning + rollback + live test added | — | CRUD+activate+rollback verified live last pass; versioning code-reviewed, not yet re-verified live this pass (docker was down) | AI provider for "test profile" |
| Native Automation Engine | ⚠️ partial | `AutomationExecution` + BullMQ (video/carousel/delivery queues), WhatsApp conversation state machine | one WhatsApp flow fully native; 20 n8n workflows not ported | Redis | WhatsApp flow verified live last pass | owner decision on n8n's fate |
| Multi-account distribution | ⚠️ partial | `ConnectedAccount`, `api/src/modules/accounts/`, `worker/src/delivery/publish.ts` | capture + per-account video publish works; carousel publish-to-account not wired | OAuth providers | code-reviewed; no live OAuth account available | real Meta/X/LinkedIn account |
| WhatsApp onboarding | ✅ extended this pass | `api/src/modules/whatsapp/*` | + message-id dedup/replay guard, rate limiting | WhatsApp Cloud API | full conversation verified live last pass; dedup code-reviewed | real WhatsApp number for live verification |
| RBAC | ✅ new this pass | `modules/auth/auth.ts` (`requireWrite`, `requireOwner`), `routes/users.ts` | OWNER/ADMIN write, VIEWER read-only, enforced server-side on every mutating router | — | code-reviewed; not yet re-verified live this pass | — |
| Connected Apps UI | ✅ new this pass | `web/src/app/connected-apps` | one consolidated view: provider status + connected accounts + honest "not supported" (TikTok) | `/api/integrations`, `/api/accounts` | tsc+lint+build clean | — |
| Anthropic/Claude provider | ✅ new this pass | `providers/definitions.ts` | real, tested connection; **not yet wired into the generation call path** (OpenAI-compatible chat-completions shape only — see Integration status doc) | — | code-reviewed | real Anthropic key |
| Webhook security | ✅ extended this pass | WhatsApp HMAC verification (existing) + rate limiting + message-id dedup (new) | signature-verified, rate-limited, replay-guarded | — | signature check verified live last pass; rate limit/dedup code-reviewed | — |
| Env validation | ✅ already existed | `api/src/server.ts` (`REQUIRED_ENV`, `REQUIRED_TABLES`, secret-length checks) | fails fast on missing/weak secrets or un-migrated DB | — | exercised on every boot | — |
| Frontend | ⚠️ partial | existing `Card`/`Badge`/`Notice`/`PageHeader` design system, Dashboard, Brand Brain, Carousels, WhatsApp, Connected Apps, Settings/Team | functional and on-brand visually; not a from-scratch redesign | — | tsc + lint + production build all clean | — |

## Graph (this pass)

```
A (re-audit: RBAC, rate limiting, env validation, webhook replay — gaps found and closed)
├── B (Brand Brain: + versioning, rollback, live test)          done
├── H (Connected Apps: consolidated UI, Anthropic provider, TikTok honest state)  done
├── K (Production: RBAC, webhook dedup/rate-limit)              done
└── G (Team/Settings UI for RBAC)                                done
        all → I (QA: full typecheck/test/lint/build + migration)  done
```

n8n's removal, carousel-to-account publishing, and the remaining 20 workflow ports are **not** in this pass — see Owner decisions in [docs/AI_CONTENT_ENGINE_STATUS.md](AI_CONTENT_ENGINE_STATUS.md).
