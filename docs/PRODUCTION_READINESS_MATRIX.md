# Production-readiness audit matrix

`EKI_Requirements_Gathering_Brief.pdf` is now available and has been read in full. It is a blank eight-section questionnaire with 65 questions, so unanswered client facts remain explicitly blocked. The question-level matrix is in `docs/REQUIREMENTS_TRACEABILITY.md`.

| Requirement area | Evidence | Status |
|---|---|---|
| Usage ledger / idempotency | `UsageLedger` with unique `idempotencyKey`, API and worker writers | Implemented and unit-tested; database migration execution unverified |
| Provider usage / cost truth | OpenAI/Groq tokens, ElevenLabs characters, Runway credits; `PROVIDER_REPORTED`, `ESTIMATE`, `UNKNOWN` | Implemented; unknown values remain possible |
| Configurable pricing / aggregation | `ProviderPrice`, `/api/usage`, dashboard cards, provider/campaign grouping | Implemented; operator must configure prices |
| Emergency stop | `emergencyStop` checked at API enqueue and worker execution; worker safety tests cover queued/delayed/retried/replayed cases | Locally tested gate; staging exercise required |
| Product truth / E2E | Video and carousel models, SVG rendering, validation, approval fingerprints, scheduling and delivery queues | Carousel local path is implemented/tested with a simulated adapter; live platform publishing contract and full DB-backed E2E remain blocked |
| Failure/retry | Provider retry classification, bounded BullMQ retries, persisted errors | Implemented; live fault injection remains external |
| Campaign attribution | `Campaign` linked to projects, executions, and usage; contract in `docs/MARKETPLACE_ACTIVATION_CONTRACT.md` | Campaign cost attribution implemented; lead/vendor activation E2E blocked by EKI contract |
| Security | Encrypted credentials, auth, helmet, secret scrubbing, webhook checks; npm audit run in all services | Local production dependency audits now report 0 vulnerabilities in API, worker, and web after reviewed upgrades; external penetration test absent |
| Frontend tests | `web/test/usageDisplay.test.ts`, Vitest, typecheck, and Next production build | Usage/dashboard display covered; broader page/E2E coverage remains |
| Docs/deployment | Deployment, migration, backup/restore and staging emergency-stop steps documented | Target infrastructure, backup/restore execution, customer credentials and migration execution remain |

## Final-audit rule

Do not call the system production-ready until unresolved rows have fresh test or deployment evidence. A green build alone is insufficient.
