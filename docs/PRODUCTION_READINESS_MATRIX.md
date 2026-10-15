# Production-readiness audit matrix

This repository does not include the client's full original scope document in this conversation. The matrix uses the requirement areas explicitly supplied in the implementation brief and records repository evidence without claiming external-provider or deployment results.

| Requirement area | Evidence | Status |
|---|---|---|
| Usage ledger / idempotency | `UsageLedger` with unique `idempotencyKey`, API and worker writers | Implemented; migration required |
| Provider usage / cost truth | OpenAI/Groq tokens, ElevenLabs characters, Runway credits; `PROVIDER_REPORTED`, `ESTIMATE`, `UNKNOWN` | Implemented; unknown values remain possible |
| Configurable pricing / aggregation | `ProviderPrice`, `/api/usage`, dashboard cards, provider/campaign grouping | Implemented; operator must configure prices |
| Emergency stop | `emergencyStop` checked at API enqueue and worker execution | Implemented; staging exercise required |
| Product truth / E2E | Existing readiness gates and local video/approval/publishing evidence; requirements brief lists Reels and Carousels as priority formats | Video covered; carousel model/rendering/approval/publishing path is absent and must be implemented before full-scope readiness |
| Failure/retry | Provider retry classification, bounded BullMQ retries, persisted errors | Implemented; live fault injection remains external |
| Campaign attribution | `Campaign` linked to projects, executions, and usage | Implemented |
| Security | Encrypted credentials, auth, helmet, secret scrubbing, webhook checks | Repository review complete; no external penetration test |
| Frontend tests | `web/test/usageDisplay.test.ts`, Vitest, typecheck, and Next production build | Usage/dashboard display covered; broader page/E2E coverage remains |
| Docs/deployment | Migration and operational notes documented | External credentials, permissions, and migration execution remain |

## Final-audit rule

Do not call the system production-ready until unresolved rows have fresh test or deployment evidence. A green build alone is insufficient.
