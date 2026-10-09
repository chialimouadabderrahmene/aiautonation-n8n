# Production integration matrix

The 12 providers named in the current build brief. Three states only:

- **CODE READY** — the adapter/call path exists, is typechecked and (where applicable) unit-tested, and is wired into real generation/publish/send code — not a stub, not a TODO.
- **LIVE CREDENTIAL REQUIRED** — code-ready, but this sandbox has no real account/API key for it, so it has never made a real outbound call to the provider.
- **LIVE VERIFIED** — actually exercised against the real provider (or, where noted, a real local S3-compatible/API-compatible stand-in) from this codebase, this session or a prior one.

| Provider | Status | Wired into | Notes |
|---|---|---|---|
| OpenAI | CODE READY · LIVE CREDENTIAL REQUIRED | `worker/src/lib/providers/openai-compatible.ts` → script/slide generation + critic | Shared OpenAI-compatible adapter (also backs Groq). Unit-tested (request shape, response mapping, retry, error mapping) — never called with a real key here. |
| Anthropic (Claude) | CODE READY · LIVE CREDENTIAL REQUIRED | `worker/src/lib/providers/anthropic.ts` → same 3 call sites as OpenAI/Groq, via the shared `AIProvider` interface | Newly wired this pass (previously connectable/testable but **not** in the generation path — that gap is now closed). JSON enforced by system-prompt instruction (Messages API has no native JSON mode). Unit-tested; no real Anthropic key in this sandbox. |
| Groq | CODE READY · LIVE CREDENTIAL REQUIRED | same adapter/call sites as OpenAI | Default first-choice provider in Settings. No real Groq key in this sandbox. |
| Runway | CODE READY · LIVE CREDENTIAL REQUIRED | `worker/src/pipeline/video.ts` → scene generation | Unchanged this pass. No real Runway key. |
| ElevenLabs | CODE READY · LIVE CREDENTIAL REQUIRED | voiceover generation | Unchanged this pass. No real ElevenLabs key. |
| Instagram | CODE READY · LIVE CREDENTIAL REQUIRED | `worker/src/delivery/publish.ts` (video Reels) + `worker/src/delivery/publish-carousel.ts` (carousel, new this pass) | Carousel container/children flow follows Meta's documented Graph API; never exercised against a real IG business account. |
| Facebook | CODE READY · LIVE CREDENTIAL REQUIRED | same two files (video post + new multi-photo feed post) | Same caveat as Instagram — documented API, not live-exercised. |
| X | CODE READY · LIVE CREDENTIAL REQUIRED | same two files (video tweet + new up-to-4-image tweet) | Chunked media upload for both video and image, same v2 endpoints. No real X app. |
| LinkedIn | CODE READY · LIVE CREDENTIAL REQUIRED | same two files (video post + new multi-image post) | No real LinkedIn app. |
| WhatsApp (Cloud API) | CODE READY · **LIVE VERIFIED** (conversation engine) · LIVE CREDENTIAL REQUIRED (nurture sends) | `api/src/modules/whatsapp/conversation.ts` (onboarding) + `worker/src/pipeline/whatsapp-nurture.ts` (new this pass, native port of n8n workflow 19) | Onboarding webhook (HMAC-verified) + conversation state machine live-verified in a prior pass. This pass's nurture sweep was exercised end-to-end on the live local stack (admin-triggered → BullMQ job picked up by the worker → ran real selection logic → correctly failed closed with "WhatsApp is not connected", logged to `AutomationExecution`) — the selection/scheduling/audit path is proven; no real WhatsApp Business number exists here to verify an actual template send. |
| Resend | CODE READY · LIVE CREDENTIAL REQUIRED | transactional email | Unchanged this pass. No real Resend key. |
| S3 / object storage | CODE READY · **LIVE VERIFIED** | video/carousel asset storage, signed URLs | Verified live every worker startup via its own capability probe (confirmed again this session: `"S3 bucket \"eki-media\" at storage:8333 — write/delete verified"`) — against the local S3-compatible storage in this sandbox, not real AWS S3. The client's production deploy should re-verify against its real bucket/credentials once configured; the code path is identical either way (same S3 API). |

## What "Connected" means

`Integration.status` only becomes `CONNECTED` after `testConnection()` makes a real HTTP call to the provider and gets a real success response (`api/src/modules/providers/definitions.ts`). Saving a key sets `CONFIGURED`, never `CONNECTED`. `ConnectedAccount` rows (multi-account publishing, video and carousel) are captured from an already-`CONNECTED` Integration's live tokens — never fabricated.

## Resolved this pass

Anthropic is no longer just connectable-but-unused: `chooseProvider()` (`worker/src/lib/providers/index.ts`) treats OpenAI, Groq and Anthropic as interchangeable behind one `AIProvider` interface, selectable from Settings → "AI provider", with auto-fallback to the next connected provider.
