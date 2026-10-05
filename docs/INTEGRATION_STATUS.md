# Integration status

Every provider this system can connect to, with how its "Connected" status is actually earned (never assumed from a saved key) and what still needs real credentials to verify live.

| Provider | Real connection test | Wired into generation/publish? | Live-verified this session | Needs for live verification |
|---|---|---|---|---|
| OpenAI | `GET /v1/models`, checks chosen model is listed | yes — script/slide generation, critic | no (no key available) | an OpenAI API key |
| Groq | `GET /openai/v1/models` | yes — same as OpenAI, first fallback | no | a Groq API key |
| **Anthropic (Claude)** — new this pass | `GET /v1/models` with `x-api-key` | **no** — the generation call sites (`script.ts`, `slides.ts`, `critic.ts`) speak the OpenAI-compatible `/chat/completions` shape only; Anthropic's Messages API has a different request/response shape | no | an Anthropic key, then a scoped change to branch the 3 call sites on provider shape |
| Runway | existing, unchanged | yes — video scenes | no | a Runway key |
| ElevenLabs | existing, unchanged | yes — voiceover | no | an ElevenLabs key |
| S3 / storage | existing, unchanged | yes | yes (last pass — real file round-trip through the worker container) | — |
| WhatsApp Cloud API | `GET /{phoneNumberId}` | yes — native conversation engine | **yes** — full webhook (HMAC-verified) + conversation driven live last pass; this pass's dedup/rate-limit are code-reviewed, not re-verified live (Docker was unavailable at the time) | a real WhatsApp Business number to confirm the live webhook end to end |
| Telegram | existing, unchanged | yes — approvals | yes (prior passes) | — |
| Resend | existing, unchanged | yes — email | no | a Resend key |
| Meta (Instagram/Facebook) | existing, unchanged | yes — publish + multi-account capture | no | a real Meta app + Page |
| X | existing, unchanged | yes | no | a real X app |
| LinkedIn | existing, unchanged | yes | no | a real LinkedIn app |
| TikTok | **none — no integration exists** | no | n/a | not supported; shown honestly as "Not connected" in Connected Apps, never faked |
| Buffer | existing, unchanged (legacy path) | yes, where already wired | no | a Buffer token |

## What "Connected" means here

`Integration.status` only becomes `CONNECTED` after `testConnection()` makes a real HTTP call to the provider and gets a real success response (`api/src/modules/providers/definitions.ts`). Saving a key sets `CONFIGURED`, never `CONNECTED`. `ConnectedAccount` rows (multi-account) are captured from an already-`CONNECTED` Integration's live tokens — never fabricated.

## Known gap

Anthropic is connectable and testable today but does not yet feed content generation. Wiring it in means teaching `script.ts`/`slides.ts`/`critic.ts` to branch on provider (OpenAI-compatible JSON-mode chat vs. Anthropic's Messages API + tool-use for structured output) — a contained, well-scoped next step, not started this pass to avoid shipping a half-tested generation path.
