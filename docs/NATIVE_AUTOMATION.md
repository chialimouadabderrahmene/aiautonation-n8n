# Native automation runtime

The supported runtime is the native TypeScript API plus BullMQ worker, PostgreSQL, Redis, and object storage. n8n is not provisioned, required, or reachable by the application.

The original n8n/Airtable/ManyChat/Buffer/Apify proposal remains historical source material only. It is not an implementation dependency. Native workflow readiness, enable/disable, scheduling, approvals, publishing, provider calls, retries, and usage recording are owned by the API and worker modules.

The database retains legacy n8n-named columns and the `N8N` execution enum for backward-compatible reads of old records. New records must use native workflow state and `VIDEO_WORKER` or `CONTROL_CENTER` execution sources. A future cleanup migration may remove legacy columns only after a production data-retention decision and a verified backup.

## Eki signup alerts

The Eki marketplace backend posts account-created events to `POST /api/attribution/events` (header `x-eki-webhook-secret` = vault `webhooks.sharedSecret`, `eventType: "registration"`, `metadata.kind` = `user_registered` or `vendor_store_created`). `api/src/modules/signups/processor.ts` turns each one into an operator Telegram message in the approval chat:

- Runs right after ingest and every 60 s from the scheduler (`signup-alerts`), so missed sends are picked up.
- Claims an event by creating an `AutomationExecution` (`source: CONTROL_CENTER`, `externalId: eventId`, `trigger: eki_signup`); the `[source, externalId]` unique index makes delivery exactly-once.
- `metadata.isTest` events are recorded as `CANCELLED` with no message. Telegram errors are recorded as `FAILED` and are not retried.
- `emergencyStop` pauses processing; events from the last 7 days are announced once it is lifted. Older events are never announced.
- Messages carry role, country, signup method, referral and attribution only — no personal data.

Runs appear on Executions (filter "Eki signups") and the Reports page shows signup counts and alert outcomes.

## Verification

- API typecheck/build: `cd api && npm run typecheck && npm run build`
- Web typecheck/build: `cd web && npm run typecheck && npm run build`
- Local Compose topology: `docker compose -f docker/docker-compose.yml config`
- Railway deployment: `node scripts/railway-deploy.mjs --skip-n8n --no-smoke`

The current Railway environment has no n8n service. Provider credentials, customer social accounts, marketplace activation contract details, and staging smoke tests remain external launch prerequisites.
